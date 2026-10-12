#import "RNDesktopBiometrics.h"
#import "SparkBiometrics.h"
#import <RNDesktopApp/SparkDesktop.h>
#import <RNDesktopApp/SparkTestDriver.h>

// One instance per process (main thread), shared by every runtime and the test driver. In driver mode it is
// simulated: no LAContext, prompt or keychain is ever reached (docs/biometrics.md#testing).
static SparkBiometrics *Shared(void) {
  static SparkBiometrics *biometrics;
  if (!biometrics) biometrics = [[SparkBiometrics alloc] initWithService:[SparkNamespace() stringByAppendingString:@".biometrics"] simulated:SparkTestDriverActive()];
  return biometrics;
}

#if SPARK_TEST_DRIVER
// Reachable only through an authenticated driver session: {"command": "simulateBiometrics", "biometryType"?,
// "biometrics"?, "password"?, "answer"?, "enrollmentChanged"?} and {"command": "testBiometrics"}.
@interface SparkBiometricsDriver : NSObject
@end
@implementation SparkBiometricsDriver
+ (void)load {
  SparkTestDriverRegisterCommand(@"simulateBiometrics", ^(NSDictionary *request, SparkTestDriverReply reply) {
    NSMutableDictionary *state = [request mutableCopy];
    [state removeObjectsForKeys:@[@"command", @"id"]]; // The driver protocol's own fields.
    NSError *error = nil;
    if ([Shared() simulate:state error:&error]) reply(@{ @"ok": @YES, @"biometrics": Shared().simulation });
    else reply(@{ @"ok": @NO, @"error": @{ @"code": SparkBiometricErrorCode(error), @"message": error.localizedDescription } });
  });
  SparkTestDriverRegisterCommand(@"testBiometrics", ^(NSDictionary *, SparkTestDriverReply reply) {
    if (Shared().simulated) reply(@{ @"ok": @YES, @"biometrics": Shared().simulation });
    else reply(@{ @"ok": @NO, @"error": @{ @"code": @"E_UNAVAILABLE", @"message": @"Biometric simulation needs the test driver" } });
  });
}
@end
#endif

@implementation RNDesktopBiometrics {
  NSMutableSet<NSString *> *_pending; // This runtime's prompts, cancelled when the bridge is invalidated.
}
RCT_EXPORT_MODULE(NativeDesktopBiometrics)

- (void)invalidate
{
  // _pending belongs to the main thread (the method queue); invalidation may arrive on another.
  dispatch_block_t cancel = ^{
    NSArray *pending = self->_pending.allObjects;
    [self->_pending removeAllObjects];
    for (NSString *identifier in pending) [Shared() cancel:identifier];
  };
  if (NSThread.isMainThread) cancel(); else dispatch_async(dispatch_get_main_queue(), cancel);
}
+ (BOOL)requiresMainQueueSetup { return NO; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }

- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  NSDictionary *args = SparkArgs(json);
  SparkBiometrics *biometrics = Shared();
  // Prompt identifiers are unique per runtime; the module's address keeps runtimes apart in the shared instance.
  NSString *identifier = [args[@"id"] isKindOfClass:NSString.class] ? [NSString stringWithFormat:@"%p:%@", self, args[@"id"]] : @"";
  NSString *key = [args[@"key"] isKindOfClass:NSString.class] ? args[@"key"] : @"";
  NSMutableDictionary *options = [NSMutableDictionary dictionary];
  for (NSString *name in @[@"reason", @"fallback", @"fallbackLabel", @"cancelLabel"]) if (args[name] && args[name] != NSNull.null) options[name] = args[name];
  _pending = _pending ?: [NSMutableSet set];
  __weak RNDesktopBiometrics *weakSelf = self;
  SparkBiometricCompletion answer = ^(id result, NSError *error) {
    [weakSelf forget:identifier];
    if (error) reject(SparkBiometricErrorCode(error), error.localizedDescription, error);
    else resolve(SparkJSON(result));
  };
  if ([method isEqual:@"status"]) [biometrics status:answer];
  else if ([method isEqual:@"authenticate"]) { [_pending addObject:identifier]; [biometrics authenticate:options identifier:identifier completion:answer]; }
  else if ([method isEqual:@"getSecret"]) { [_pending addObject:identifier]; [biometrics secret:key options:options identifier:identifier completion:answer]; }
  else if ([method isEqual:@"setSecret"]) [biometrics setSecret:key value:args[@"value"] access:args[@"access"] completion:answer];
  else if ([method isEqual:@"deleteSecret"]) [biometrics deleteSecret:key completion:answer];
  else if ([method isEqual:@"cancel"]) { if ([_pending containsObject:identifier]) [biometrics cancel:identifier]; resolve(@"null"); }
  else SparkInvalid(reject, @"Unknown biometrics operation");
}
- (void)forget:(NSString *)identifier { [_pending removeObject:identifier]; }

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeDesktopBiometricsSpecJSI>(params);
}
@end
