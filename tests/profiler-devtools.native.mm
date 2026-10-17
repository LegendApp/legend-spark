// SparkProfilerDevTools.mm against a stand-in for React Native's inspector connection, compiled and run by
// tests/profiler-devtools-native.test.ts.
#import <Foundation/Foundation.h>
#import "SparkProfilerDevTools.h"
#include <cstdio>
#include <string>
#include <string_view>

static int failures = 0;
#define CHECK(condition) do { if (!(condition)) { std::printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #condition); failures++; } } while (0)

// React Native's RCTCxxInspectorWebSocketAdapter, as far as the watcher uses it: what reached React Native, what was sent.
@interface Adapter : NSObject
@property NSMutableArray<NSString *> *received, *sent;
@property NSInteger closes, failures;
@end
@implementation Adapter
- (instancetype)init { if ((self = [super init])) { _received = [NSMutableArray new]; _sent = [NSMutableArray new]; } return self; }
- (void)send:(std::string_view)message { [_sent addObject:[[NSString alloc] initWithBytes:message.data() length:message.size() encoding:NSUTF8StringEncoding]]; }
- (void)webSocket:(id)socket didReceiveMessageWithString:(NSString *)message { [_received addObject:message]; }
- (void)webSocket:(id)socket didCloseWithCode:(NSInteger)code reason:(NSString *)reason wasClean:(BOOL)clean { _closes++; }
- (void)webSocket:(id)socket didFailWithError:(NSError *)error { _failures++; }
@end
@interface NoSend : NSObject @end
@implementation NoSend
- (void)webSocket:(id)socket didReceiveMessageWithString:(NSString *)message {}
- (void)webSocket:(id)socket didCloseWithCode:(NSInteger)code reason:(NSString *)reason wasClean:(BOOL)clean {}
- (void)webSocket:(id)socket didFailWithError:(NSError *)error {}
@end

static NSString *JSON(id value) { return [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:value options:0 error:nil] encoding:NSUTF8StringEncoding]; }
static id Parse(NSString *text) { return [NSJSONSerialization JSONObjectWithData:[text dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]; }
/** The development server's wrapping of a CDP request to `page`. */
static NSString *Request(NSString *page, int identifier, NSString *method) {
  return JSON(@{ @"event": @"wrappedEvent", @"payload": @{ @"pageId": page, @"wrappedEvent": JSON(@{ @"id": @(identifier), @"method": method, @"params": @{} }) } });
}
static NSString *Event(NSString *event, NSString *page) { return JSON(@{ @"event": event, @"payload": @{ @"pageId": page } }); }
/** The CDP error a reply carries to `page`, or nil. */
static NSDictionary *ErrorReply(NSString *reply, NSString *page, int identifier) {
  NSDictionary *envelope = Parse(reply);
  if (![envelope[@"event"] isEqual:@"wrappedEvent"] || ![envelope[@"payload"][@"pageId"] isEqual:page]) return nil;
  NSDictionary *response = Parse(envelope[@"payload"][@"wrappedEvent"]);
  return [response[@"id"] isEqual:@(identifier)] ? response[@"error"] : nil;
}

int main() { @autoreleasepool {
  CHECK([SparkProfilerWatchInspector(nil, ^{ return NO; }, ^{}) containsString:@"RCTCxxInspectorWebSocketAdapter"]);
  CHECK([SparkProfilerWatchInspector(NoSend.class, ^{ return NO; }, ^{}) containsString:@"-send:"]);

  __block BOOL spark = NO;
  __block int orphans = 0;
  CHECK(SparkProfilerWatchInspector(Adapter.class, ^{ return spark; }, ^{ orphans++; }) == nil);
  Adapter *adapter = [Adapter new];
  void (^deliver)(NSString *) = ^(NSString *message) { [adapter webSocket:nil didReceiveMessageWithString:message]; };

  // Idle: everything reaches React Native, and DevTools' recordings are followed per page.
  CHECK(SparkProfilerDevToolsRecording() == nil);
  deliver(Event(@"connect", @"1"));
  deliver(Request(@"1", 1, @"Profiler.start"));
  CHECK([SparkProfilerDevToolsRecording() isEqual:@"the JavaScript profiler (Profiler.start)"]);
  deliver(Request(@"1", 2, @"Tracing.start"));
  CHECK([SparkProfilerDevToolsRecording() isEqual:@"the JavaScript profiler (Profiler.start) and a Performance panel trace (Tracing.start)"]);
  deliver(Request(@"1", 3, @"Profiler.stop"));
  deliver(Request(@"1", 4, @"Tracing.end"));
  CHECK(SparkProfilerDevToolsRecording() == nil);
  CHECK(adapter.received.count == 5 && adapter.sent.count == 0);

  // Other requests pass untouched, even when they name the methods.
  NSString *evaluate = JSON(@{ @"event": @"wrappedEvent", @"payload": @{ @"pageId": @"1", @"wrappedEvent": JSON(@{ @"id": @5, @"method": @"Runtime.evaluate", @"params": @{ @"expression": @"'Profiler.start'" } }) } });
  deliver(evaluate);
  deliver(@"not json Tracing.");
  CHECK([adapter.received.lastObject isEqual:@"not json Tracing."] && [adapter.received[adapter.received.count - 2] isEqual:evaluate]);
  CHECK(SparkProfilerDevToolsRecording() == nil && adapter.sent.count == 0);

  // While Spark records, DevTools can neither start sampling nor stop it: each request gets a CDP error and never
  // reaches React Native.
  spark = YES;
  NSUInteger before = adapter.received.count;
  deliver(Request(@"1", 6, @"Profiler.start"));
  deliver(Request(@"1", 7, @"Tracing.start"));
  deliver(Request(@"1", 8, @"Profiler.stop"));
  deliver(Request(@"1", 9, @"Tracing.end"));
  CHECK(adapter.received.count == before && adapter.sent.count == 4);
  NSDictionary *started = ErrorReply(adapter.sent[0], @"1", 6), *stopped = ErrorReply(adapter.sent[2], @"1", 8);
  CHECK([started[@"code"] isEqual:@(-32000)] && [started[@"message"] containsString:@"Spark's profiler is recording"]);
  CHECK(ErrorReply(adapter.sent[1], @"1", 7) && ErrorReply(adapter.sent[3], @"1", 9));
  CHECK([stopped[@"message"] containsString:@"React Native DevTools is not recording"]);
  CHECK(SparkProfilerDevToolsRecording() == nil);
  spark = NO;

  // A session that ends while recording leaves Hermes sampling: orphaned once no other page records.
  deliver(Request(@"1", 10, @"Profiler.start"));
  deliver(Request(@"2", 1, @"Tracing.start"));
  deliver(Event(@"disconnect", @"1"));
  CHECK(orphans == 0 && [SparkProfilerDevToolsRecording() isEqual:@"a Performance panel trace (Tracing.start)"]);
  deliver(Event(@"connect", @"2"));
  CHECK(orphans == 1 && SparkProfilerDevToolsRecording() == nil);
  deliver(Event(@"disconnect", @"2"));
  CHECK(orphans == 1);
  // Closing or failing the connection ends every session.
  deliver(Request(@"3", 1, @"Profiler.start"));
  [adapter webSocket:nil didCloseWithCode:1000 reason:@"" wasClean:YES];
  CHECK(orphans == 2 && adapter.closes == 1 && SparkProfilerDevToolsRecording() == nil);
  [adapter webSocket:nil didFailWithError:[NSError errorWithDomain:@"test" code:1 userInfo:nil]];
  CHECK(orphans == 2 && adapter.failures == 1);
  deliver(Request(@"3", 2, @"Tracing.start"));
  [adapter webSocket:nil didFailWithError:[NSError errorWithDomain:@"test" code:1 userInfo:nil]];
  CHECK(orphans == 3 && SparkProfilerDevToolsRecording() == nil);

  if (failures) { std::printf("%d failures\n", failures); return 1; }
  std::printf("Profiler DevTools tests passed\n");
  return 0;
} }
