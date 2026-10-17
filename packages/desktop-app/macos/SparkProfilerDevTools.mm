#import "SparkProfilerDevTools.h"
#if RCT_DEV
#import <objc/message.h>
#import <objc/runtime.h>
#include <string_view>

// Per debugged page (the development server's pageId), the DevTools domains recording with Hermes's sampling profiler.
static NSMutableDictionary<NSString *, NSMutableSet<NSString *> *> *pages;
// Each request that starts or stops sampling: its domain, and whether it starts.
static NSDictionary<NSString *, NSArray *> *const Requests = @{ @"Profiler.start": @[@"Profiler", @YES], @"Profiler.stop": @[@"Profiler", @NO], @"Tracing.start": @[@"Tracing", @YES], @"Tracing.end": @[@"Tracing", @NO] };
static NSDictionary<NSString *, NSString *> *const Descriptions = @{ @"Profiler": @"the JavaScript profiler (Profiler.start)", @"Tracing": @"a Performance panel trace (Tracing.start)" };

NSString *SparkProfilerDevToolsRecording(void) {
  NSMutableSet<NSString *> *domains = [NSMutableSet new];
  for (NSSet *recording in pages.allValues) [domains unionSet:recording];
  if (!domains.count) return nil;
  NSMutableArray *described = [NSMutableArray new];
  for (NSString *domain in [domains.allObjects sortedArrayUsingSelector:@selector(compare:)]) [described addObject:Descriptions[domain]];
  return [described componentsJoinedByString:@" and "];
}

static id SparkJSONObject(id text) {
  if (![text isKindOfClass:NSString.class]) return nil;
  id value = [NSJSONSerialization JSONObjectWithData:[text dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
  return [value isKindOfClass:NSDictionary.class] ? value : nil;
}
static NSString *SparkJSONString(id value) {
  return [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:value options:0 error:nil] encoding:NSUTF8StringEncoding];
}

/** Forgets `page`'s recordings; whether that left sampling on with nothing to turn it off. */
static BOOL SparkForget(NSString *page, BOOL sparkRecording) {
  if (!pages[page].count) { [pages removeObjectForKey:page]; return NO; }
  [pages removeObjectForKey:page];
  return !sparkRecording && !SparkProfilerDevToolsRecording();
}

BOOL SparkProfilerInspectorReceived(NSString *message, BOOL sparkRecording, NSString **reply, BOOL *orphaned) {
  *reply = nil;
  *orphaned = NO;
  // Most messages are other requests: only these names can matter.
  if (![message containsString:@"Profiler.st"] && ![message containsString:@"Tracing."] && ![message containsString:@"connect\""]) return YES;
  NSDictionary *envelope = SparkJSONObject(message);
  NSDictionary *payload = [envelope[@"payload"] isKindOfClass:NSDictionary.class] ? envelope[@"payload"] : nil;
  NSString *page = [payload[@"pageId"] isKindOfClass:NSString.class] ? payload[@"pageId"] : nil;
  if (!page) return YES;
  if (!pages) pages = [NSMutableDictionary new];
  NSString *event = envelope[@"event"];
  if ([event isEqual:@"connect"] || [event isEqual:@"disconnect"]) { *orphaned = SparkForget(page, sparkRecording); return YES; }
  if (![event isEqual:@"wrappedEvent"]) return YES;
  NSDictionary *request = SparkJSONObject(payload[@"wrappedEvent"]);
  NSArray *kind = [request[@"method"] isKindOfClass:NSString.class] ? Requests[request[@"method"]] : nil;
  if (!kind || ![request[@"id"] isKindOfClass:NSNumber.class]) return YES;
  NSString *domain = kind[0];
  BOOL starts = [kind[1] boolValue];
  NSMutableSet *recording = pages[page] ?: (pages[page] = [NSMutableSet new]);
  if (starts && !sparkRecording) { [recording addObject:domain]; return YES; }
  if (!starts && [recording containsObject:domain]) { [recording removeObject:domain]; return YES; }
  if (!sparkRecording) return YES;
  // A start would share Spark's sampling (Hermes ignores a second enable); a stop of a recording DevTools does not have
  // would turn Spark's sampling off.
  NSString *why = starts
    ? @"Spark's profiler is recording (startProfiling or Developer › Start Profiling) with Hermes's sampling profiler, which React Native DevTools shares: stop it first"
    : @"React Native DevTools is not recording; Spark's profiler is, with the same Hermes sampling profiler, and stopping it here would end Spark's samples";
  NSDictionary *error = @{ @"id": request[@"id"], @"error": @{ @"code": @(-32000), @"message": why } };
  *reply = SparkJSONString(@{ @"event": @"wrappedEvent", @"payload": @{ @"pageId": page, @"wrappedEvent": SparkJSONString(error) } });
  return NO;
}

BOOL SparkProfilerInspectorClosed(BOOL sparkRecording) {
  BOOL recorded = SparkProfilerDevToolsRecording() != nil;
  [pages removeAllObjects];
  return recorded && !sparkRecording;
}

/** Replaces `selector`'s implementation in `adapter` with `make(original)`; NO if `adapter` does not define it. */
static BOOL SparkReplace(Class adapter, SEL selector, id (^make)(IMP original)) {
  Method method = class_getInstanceMethod(adapter, selector);
  if (!method) return NO;
  method_setImplementation(method, imp_implementationWithBlock(make(method_getImplementation(method))));
  return YES;
}

NSString *SparkProfilerWatchInspector(Class adapter, BOOL (^recording)(void), void (^orphaned)(void)) {
  if (!adapter) return @"React Native's inspector connection (RCTCxxInspectorWebSocketAdapter) is missing, so React Native DevTools' recordings cannot be told apart from Spark's";
  SEL receive = @selector(webSocket:didReceiveMessageWithString:), close = @selector(webSocket:didCloseWithCode:reason:wasClean:), fail = @selector(webSocket:didFailWithError:), send = @selector(send:);
  for (NSValue *selector in @[[NSValue valueWithPointer:receive], [NSValue valueWithPointer:close], [NSValue valueWithPointer:fail], [NSValue valueWithPointer:send]])
    if (!class_getInstanceMethod(adapter, (SEL)selector.pointerValue))
      return [NSString stringWithFormat:@"React Native's inspector connection (%@) has no -%@, so React Native DevTools' recordings cannot be told apart from Spark's", NSStringFromClass(adapter), NSStringFromSelector((SEL)selector.pointerValue)];
  SparkReplace(adapter, receive, ^id(IMP original) {
    return ^(id self, id socket, NSString *message) {
      NSString *reply;
      BOOL orphans;
      BOOL forward = SparkProfilerInspectorReceived(message, recording(), &reply, &orphans);
      if (forward) ((void (*)(id, SEL, id, NSString *))original)(self, receive, socket, message);
      if (reply) ((void (*)(id, SEL, std::string_view))objc_msgSend)(self, send, std::string_view(reply.UTF8String));
      if (orphans) orphaned();
    };
  });
  SparkReplace(adapter, close, ^id(IMP original) {
    return ^(id self, id socket, NSInteger code, NSString *reason, BOOL clean) {
      ((void (*)(id, SEL, id, NSInteger, NSString *, BOOL))original)(self, close, socket, code, reason, clean);
      if (SparkProfilerInspectorClosed(recording())) orphaned();
    };
  });
  SparkReplace(adapter, fail, ^id(IMP original) {
    return ^(id self, id socket, NSError *error) {
      ((void (*)(id, SEL, id, NSError *))original)(self, fail, socket, error);
      if (SparkProfilerInspectorClosed(recording())) orphaned();
    };
  });
  return nil;
}
#endif
