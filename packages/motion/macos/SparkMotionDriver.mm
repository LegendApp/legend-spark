#import <Foundation/Foundation.h>
#import <RNDesktopApp/SparkTestDriver.h>
#import "SparkMotionCoordinator.h"

#if SPARK_TEST_DRIVER

// The in-app test driver's virtual clock and motion telemetry (docs/motion.md#virtual-clock-for-the-test-driver,
// docs/motion.md#motion-telemetry). They are reachable only through an authenticated driver session.
//   {"command": "setClock", "mode": "virtual" | "real"}, {"command": "advanceClock", "durationMs": n} → {"mode", "timeMs"}
//   {"command": "motionState", "testID"} → engine state and the view's latest motion
//   {"command": "waitForMotion", "testID", "progress" | "elapsedMs" | "settled": true, "timeoutMs"} → motionState
//   {"command": "sampleMotion", "testID", "fromMs", "toMs", "intervalMs"} → {"samples": [{"tMs", "values", "velocities"}]}
//   {"command": "simulateOcclusion", "testID", "visible"} → {"mode", "timeMs"}: the window of that view counts as hidden or visible
// simulateSystemEvent's reduceMotion and lowPowerMode, and simulateDisplays' primary refresh rate, reach motion through
// SparkTestDriverObserveSimulatedState. Clock changes go to SparkTestDriverDidChangeClock, which window choreography follows.
static SparkMotionReject SparkMotionDriverFailure(SparkTestDriverReply reply)
{
  return ^(NSString *code, NSString *message) { reply(@{ @"ok": @NO, @"error": @{ @"code": code, @"message": message } }); };
}
static SparkMotionResolve SparkMotionDriverSuccess(SparkTestDriverReply reply)
{
  return ^(id) {
    [SparkMotionCoordinator.shared clock:^(NSString *json) {
      NSMutableDictionary *result = [[NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil] mutableCopy];
      result[@"ok"] = @YES;
      reply(result);
    }];
  };
}
static SparkMotionResolve SparkMotionDriverReply(SparkTestDriverReply reply)
{
  return ^(NSDictionary *result) {
    NSMutableDictionary *message = [result mutableCopy];
    message[@"ok"] = @YES;
    reply(message);
  };
}
static BOOL SparkMotionDriverNumber(id value) { return [value isKindOfClass:NSNumber.class] && CFGetTypeID((__bridge CFTypeRef)value) != CFBooleanGetTypeID(); }
/** The MotionView a request's testID names (the view with that testID, or the MotionView containing it); 0 after replying with a failure. */
static NSInteger SparkMotionDriverTarget(NSDictionary *request, SparkTestDriverReply reply)
{
  NSString *testID = request[@"testID"];
  if (![testID isKindOfClass:NSString.class] || !testID.length) { SparkMotionDriverFailure(reply)(@"E_INVALID_ARGUMENT", @"Expected testID"); return 0; }
  NSView *view = SparkTestDriverFindView(testID);
  if (!view) { SparkMotionDriverFailure(reply)(@"E_NOT_FOUND", [NSString stringWithFormat:@"No visible view has testID %@", testID]); return 0; }
  NSView<SparkMotionHost> *host = [SparkMotionCoordinator.shared hostForView:view];
  if (!host) { SparkMotionDriverFailure(reply)(@"E_NOT_FOUND", [NSString stringWithFormat:@"The view with testID %@ is not a MotionView or inside one", testID]); return 0; }
  return host.motionTag;
}

@interface SparkMotionDriver : NSObject
@end
@implementation SparkMotionDriver
+ (void)load
{
  SparkMotionCoordinator *motion = SparkMotionCoordinator.shared;
  SparkTestDriverObserveStart(^{ [motion recordTelemetry]; });
  SparkTestDriverObserveInput(^{ [motion noteInput]; });
  // Every advance of virtual time (advanceClock, waitForMotion) moves window choreography by the same time.
  motion.clockAdvanced = ^(double milliseconds) { SparkTestDriverDidChangeClock(YES, milliseconds); };
  SparkTestDriverObserveSimulatedState(^(NSDictionary *values) { [motion simulate:values]; });
  // Captures render the presented frame of running animations: the compositor plays them, in-process rendering does not.
  SparkTestDriverWrapRender(^(dispatch_block_t render) { [motion presenting:render]; });
  SparkTestDriverRegisterCommand(@"setClock", ^(NSDictionary *request, SparkTestDriverReply reply) {
    id mode = request[@"mode"];
    if (![mode isKindOfClass:NSString.class]) { SparkMotionDriverFailure(reply)(@"E_INVALID_ARGUMENT", @"setClock expects mode real or virtual"); return; }
    SparkMotionResolve success = SparkMotionDriverSuccess(reply);
    [motion setClock:mode resolve:^(id result) { SparkTestDriverDidChangeClock([mode isEqual:@"virtual"], 0); success(result); } reject:SparkMotionDriverFailure(reply)];
  });
  SparkTestDriverRegisterCommand(@"advanceClock", ^(NSDictionary *request, SparkTestDriverReply reply) {
    id duration = request[@"durationMs"];
    if (!SparkMotionDriverNumber(duration)) { SparkMotionDriverFailure(reply)(@"E_INVALID_ARGUMENT", @"advanceClock expects durationMs"); return; }
    SparkMotionResolve success = SparkMotionDriverSuccess(reply);
    [motion advanceClock:[duration doubleValue] resolve:success reject:SparkMotionDriverFailure(reply)];
  });
  SparkTestDriverRegisterCommand(@"motionState", ^(NSDictionary *request, SparkTestDriverReply reply) {
    NSInteger tag = SparkMotionDriverTarget(request, reply);
    if (tag) [motion telemetry:tag resolve:SparkMotionDriverReply(reply) reject:SparkMotionDriverFailure(reply)];
  });
  SparkTestDriverRegisterCommand(@"waitForMotion", ^(NSDictionary *request, SparkTestDriverReply reply) {
    id timeout = request[@"timeoutMs"] ?: @10000;
    if (!SparkMotionDriverNumber(timeout) || [timeout doubleValue] < 0 || [timeout doubleValue] > 120000) { SparkMotionDriverFailure(reply)(@"E_INVALID_ARGUMENT", @"timeoutMs is 0-120000"); return; }
    NSInteger tag = SparkMotionDriverTarget(request, reply);
    if (!tag) return;
    NSMutableDictionary *until = [NSMutableDictionary new];
    for (NSString *key in @[@"progress", @"elapsedMs", @"settled"]) until[key] = request[key];
    [motion waitForMotion:tag until:until timeout:[timeout doubleValue] / 1000 resolve:SparkMotionDriverReply(reply) reject:SparkMotionDriverFailure(reply)];
  });
  SparkTestDriverRegisterCommand(@"simulateOcclusion", ^(NSDictionary *request, SparkTestDriverReply reply) {
    id visible = request[@"visible"];
    if (![visible isKindOfClass:NSNumber.class] || CFGetTypeID((__bridge CFTypeRef)visible) != CFBooleanGetTypeID()) { SparkMotionDriverFailure(reply)(@"E_INVALID_ARGUMENT", @"simulateOcclusion expects visible: true or false"); return; }
    NSInteger tag = SparkMotionDriverTarget(request, reply);
    if (!tag) return;
    NSWindow *window = SparkTestDriverFindView(request[@"testID"]).window;
    if (!window) { SparkMotionDriverFailure(reply)(@"E_NOT_FOUND", @"The MotionView is not in a window"); return; }
    [motion simulateWindow:window visible:[visible boolValue]];
    SparkMotionDriverSuccess(reply)(nil);
  });
  SparkTestDriverRegisterCommand(@"sampleMotion", ^(NSDictionary *request, SparkTestDriverReply reply) {
    NSInteger tag = SparkMotionDriverTarget(request, reply);
    if (tag) [motion sample:tag request:request resolve:SparkMotionDriverReply(reply) reject:SparkMotionDriverFailure(reply)];
  });
}
@end
#endif
