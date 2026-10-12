#import "RNDesktopPermissions.h"
#import "SparkPermissions.h"
#import <RNDesktopApp/SparkDesktop.h>
#import <RNDesktopApp/SparkTestDriver.h>

// One instance per process (main thread), shared by every runtime and the test driver. In driver mode it is
// simulated: no TCC API, prompt or System Settings is ever reached (docs/permissions.md#testing).
static NSUInteger Observers;
static double Sequence;
static NSDictionary *Reported;
static SparkPermissions *Shared(void) {
  static SparkPermissions *permissions;
  if (!permissions) {
    permissions = [[SparkPermissions alloc] initWithInfo:NSBundle.mainBundle.infoDictionary ?: @{} simulated:SparkTestDriverActive()];
    permissions.changeHandler = ^{
      if (!Observers) return;
      NSDictionary *snapshot = permissions.snapshot;
      if ([snapshot isEqual:Reported]) return;
      Reported = snapshot;
      SparkEmit(@{ @"type": @"permissionsChanged", @"sequence": @(++Sequence), @"permissions": snapshot });
    };
  }
  return permissions;
}

#if SPARK_TEST_DRIVER
// Reachable only through an authenticated driver session: {"command": "simulatePermission", "kind", "authorization"?,
// "answer"?: "allow" | "deny" | null} and {"command": "testPermission", "kind"}.
@interface SparkPermissionsDriver : NSObject
@end
@implementation SparkPermissionsDriver
+ (void)load {
  SparkTestDriverRegisterCommand(@"simulatePermission", ^(NSDictionary *request, SparkTestDriverReply reply) {
    id kind = request[@"kind"], authorization = request[@"authorization"], answer = request[@"answer"];
    NSError *error = nil;
    if (![kind isKindOfClass:NSString.class] || (authorization && ![authorization isKindOfClass:NSString.class]) || (answer && answer != NSNull.null && ![answer isKindOfClass:NSString.class]))
      error = [NSError errorWithDomain:SparkPermissionErrorDomain code:0 userInfo:@{ @"code": @"E_INVALID_ARGUMENT", NSLocalizedDescriptionKey: @"simulatePermission expects kind, and authorization or answer" }];
    else [Shared() simulate:kind authorization:authorization answer:answer error:&error];
    if (error) reply(@{ @"ok": @NO, @"error": @{ @"code": SparkPermissionErrorCode(error), @"message": error.localizedDescription } });
    else reply(@{ @"ok": @YES, @"permission": [Shared() simulation:kind] });
  });
  SparkTestDriverRegisterCommand(@"testPermission", ^(NSDictionary *request, SparkTestDriverReply reply) {
    id kind = request[@"kind"];
    NSDictionary *simulation = [kind isKindOfClass:NSString.class] && Shared().simulated ? [Shared() simulation:kind] : nil;
    if (simulation) reply(@{ @"ok": @YES, @"permission": simulation });
    else reply(@{ @"ok": @NO, @"error": @{ @"code": @"E_INVALID_ARGUMENT", @"message": @"testPermission expects a permission kind" } });
  });
}
@end
#endif

@implementation RNDesktopPermissions
RCT_EXPORT_MODULE(NativeDesktopPermissions)
+ (BOOL)requiresMainQueueSetup { return NO; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }

- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  NSDictionary *args = SparkArgs(json);
  SparkPermissions *permissions = Shared();
  NSString *kind = [args[@"kind"] isKindOfClass:NSString.class] ? args[@"kind"] : @"";
  NSString *target = [args[@"target"] isKindOfClass:NSString.class] ? args[@"target"] : nil;
  SparkPermissionCompletion answer = ^(NSString *authorization, NSError *error) {
    if (error) reject(SparkPermissionErrorCode(error), error.localizedDescription, error);
    else resolve(SparkJSON(authorization));
  };
  if ([method isEqual:@"status"]) [permissions status:kind target:target completion:answer];
  else if ([method isEqual:@"request"]) [permissions request:kind target:target completion:answer];
  else if ([method isEqual:@"openSettings"]) {
    NSError *error = nil;
    if ([permissions openSettings:kind error:&error]) resolve(@"null");
    else reject(SparkPermissionErrorCode(error), error.localizedDescription, error);
  } else if ([method isEqual:@"observe"]) {
    // Earlier listeners hear about a change this fresh snapshot reveals; the new one starts from it.
    NSDictionary *snapshot = permissions.snapshot;
    if (Observers > 0 && ![snapshot isEqual:Reported]) SparkEmit(@{ @"type": @"permissionsChanged", @"sequence": @(++Sequence), @"permissions": snapshot });
    Reported = snapshot;
    if (Observers++ == 0) permissions.observing = YES;
    resolve(SparkJSON(@{ @"sequence": @(Sequence), @"permissions": snapshot }));
  } else if ([method isEqual:@"unobserve"]) {
    if (Observers > 0 && --Observers == 0) { permissions.observing = NO; Reported = nil; }
    resolve(@"null");
  } else SparkInvalid(reject, @"Unknown permissions operation");
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeDesktopPermissionsSpecJSI>(params);
}
@end
