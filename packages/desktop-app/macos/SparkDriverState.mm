#import "SparkDesktop.h"
#import "SparkTestDriverPrivate.h"
#include <atomic>

// Driver commands the app's JavaScript answers: `state` (docs/test-driver.md#exposed-state), a value the app exposes with
// exposeTestState from @legendapp/spark/app, and `listeners` (docs/test-driver.md#leak-counters), its desktop event
// subscriptions. The request is a desktop event; the answer comes back through SparkReplyDriverState. Reachable only
// through an authenticated driver session. Main thread.
static NSMutableDictionary<NSNumber *, SparkTestDriverReply> *pending;
static NSUInteger lastRequest = 0;
static std::atomic<NSInteger> observers{0}; // NativeDesktopApp modules whose JavaScript observes desktop events.

BOOL SparkReplyDriverState(NSDictionary *answer) {
  id requestId = answer[@"requestId"];
  if (![requestId isKindOfClass:NSNumber.class]) return NO;
  SparkTestDriverReply reply = pending[requestId];
  if (!reply) return NO; // Timed out, or never asked.
  [pending removeObjectForKey:requestId];
  NSDictionary *error = answer[@"error"];
  if (![error isKindOfClass:NSDictionary.class]) reply(@{ @"ok": @YES, @"value": answer[@"value"] ?: NSNull.null });
  else reply(SparkDriverFailure([error[@"code"] isKindOfClass:NSString.class] ? error[@"code"] : @"E_STATE", [error[@"message"] isKindOfClass:NSString.class] ? error[@"message"] : @"The app could not read the state"));
  return YES;
}

void SparkSetDesktopObserved(BOOL observed) { observers += observed ? 1 : -1; }

// Posts `event` with a new requestId and replies with what the JavaScript answers, or E_TIMEOUT.
static void SparkAskJavaScript(NSDictionary *event, NSDictionary *request, SparkTestDriverReply reply) {
  id limit = request[@"timeoutMs"];
  const double timeoutMs = [limit isKindOfClass:NSNumber.class] ? MIN(MAX([limit doubleValue], 0), 120000) : 5000;
  NSNumber *requestId = @(++lastRequest);
  pending[requestId] = [reply copy];
  NSMutableDictionary *message = [event mutableCopy];
  message[@"requestId"] = requestId;
  [NSNotificationCenter.defaultCenter postNotificationName:SparkDesktopEvent object:nil userInfo:message];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(timeoutMs * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
    SparkTestDriverReply unanswered = pending[requestId];
    if (!unanswered) return;
    [pending removeObjectForKey:requestId];
    unanswered(SparkDriverFailure(@"E_TIMEOUT", [NSString stringWithFormat:@"The app's JavaScript did not answer %@ within %.0f ms%@", event[@"type"], timeoutMs,
      [event[@"type"] isEqual:@"driverState"] ? @"; apps expose state with exposeTestState from @legendapp/spark/app" : @""]));
  });
}

@interface SparkDriverState : NSObject
@end
@implementation SparkDriverState
+ (void)load {
  pending = [NSMutableDictionary new];
  SparkTestDriverRegisterCommand(@"state", ^(NSDictionary *request, SparkTestDriverReply reply) {
    NSString *path = request[@"path"];
    if (![path isKindOfClass:NSString.class] || !path.length) { reply(SparkDriverFailure(@"E_INVALID_ARGUMENT", @"state expects a path")); return; }
    SparkAskJavaScript(@{ @"type": @"driverState", @"path": path }, request, reply);
  });
  // The JavaScript's desktop event subscriptions (onDesktopEvent): none while no JavaScript observes desktop events.
  SparkTestDriverRegisterCommand(@"listeners", ^(NSDictionary *request, SparkTestDriverReply reply) {
    if (!observers) { reply(@{ @"ok": @YES, @"listeners": @0 }); return; }
    SparkAskJavaScript(@{ @"type": @"driverListeners" }, request, ^(NSDictionary *answer) {
      reply([answer[@"ok"] boolValue] ? @{ @"ok": @YES, @"listeners": answer[@"value"] } : answer);
    });
  });
}
@end
