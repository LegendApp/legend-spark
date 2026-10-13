#import "RNDesktopPrivilegedHelper.h"
#import "SparkPrivilegedHelpers.h"
#import <RNDesktopApp/SparkDesktop.h>
#import <RNDesktopApp/SparkTestDriver.h>

// One instance per process, shared by every runtime and the test driver. In driver mode it is simulated: SMAppService,
// Authorization Services and launchd are never reached (docs/privileged-helper.md#testing). The synchronous availability
// call may create it on the JavaScript thread.
static SparkPrivilegedHelpers *Shared(void) {
  static SparkPrivilegedHelpers *helpers;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSString *team = SparkPrivilegedHelperSigningTeam(), *bundle = NSBundle.mainBundle.bundleIdentifier;
    // The helper must be signed by this app's team with its launchd label as signing identifier (spark package signs it so).
    helpers = [[SparkPrivilegedHelpers alloc] initWithSimulated:SparkTestDriverActive() signed:team != nil
      helperRequirement:^NSString *(NSString *name) { return SparkPrivilegedHelperRequirement(team, SparkPrivilegedHelperLabel(bundle, name)); } connector:nil];
  });
  return helpers;
}

#if SPARK_TEST_DRIVER
// Reachable only through an authenticated driver session: {"command": "simulatePrivilegedHelper", "signed"?, "helpers"?,
// "approval"?, "promptAnswer"?, "connection"?} and {"command": "testPrivilegedHelper"}.
@interface SparkPrivilegedHelperDriver : NSObject
@end
@implementation SparkPrivilegedHelperDriver
+ (void)load {
  SparkTestDriverRegisterCommand(@"simulatePrivilegedHelper", ^(NSDictionary *request, SparkTestDriverReply reply) {
    NSMutableDictionary *state = [request mutableCopy];
    [state removeObjectsForKeys:@[@"command", @"id"]]; // The driver protocol's own fields.
    NSError *error = nil;
    if ([Shared() simulate:state error:&error]) reply(@{ @"ok": @YES, @"privilegedHelper": Shared().simulation });
    else reply(@{ @"ok": @NO, @"error": @{ @"code": SparkPrivilegedHelperErrorCode(error), @"message": error.localizedDescription } });
  });
  SparkTestDriverRegisterCommand(@"testPrivilegedHelper", ^(NSDictionary *, SparkTestDriverReply reply) {
    if (Shared().simulated) reply(@{ @"ok": @YES, @"privilegedHelper": Shared().simulation });
    else reply(@{ @"ok": @NO, @"error": @{ @"code": @"E_UNAVAILABLE", @"message": @"Privileged helper simulation needs the test driver" } });
  });
}
@end
#endif

static NSString *_Nullable Text(id value) { return [value isKindOfClass:NSString.class] && [value length] ? value : nil; }

@implementation RNDesktopPrivilegedHelper {
  // This runtime's admin authorizations and requests, released and cancelled when the bridge is invalidated.
  NSMutableSet<NSString *> *_authorizations;
  NSMutableSet<NSString *> *_requests;
  BOOL _invalidated;
}
RCT_EXPORT_MODULE(NativeDesktopPrivilegedHelper)
+ (BOOL)requiresMainQueueSetup { return NO; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }

- (void)invalidate
{
  dispatch_block_t release = ^{
    self->_invalidated = YES;
    for (NSString *identifier in self->_requests.allObjects) [Shared() cancel:identifier];
    for (NSString *identifier in self->_authorizations) [Shared() releaseAuthorization:identifier];
    [self->_requests removeAllObjects];
    [self->_authorizations removeAllObjects];
  };
  if (NSThread.isMainThread) release(); else dispatch_async(dispatch_get_main_queue(), release);
}

- (NSString *)availability { return [Shared() availability]; }

- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  NSDictionary *args = SparkArgs(json);
  SparkPrivilegedHelpers *helpers = Shared();
  _authorizations = _authorizations ?: [NSMutableSet set];
  _requests = _requests ?: [NSMutableSet set];
  // Named failures resolve, so their reason reaches JavaScript; the rest reject with their code.
  SparkPrivilegedHelperCompletion answer = ^(id result, NSError *error) {
    if (error.userInfo[@"reason"]) resolve(SparkJSON(@{ @"type": @"failure", @"reason": error.userInfo[@"reason"], @"code": SparkPrivilegedHelperErrorCode(error), @"message": error.localizedDescription }));
    else if (error) reject(SparkPrivilegedHelperErrorCode(error), error.localizedDescription, error);
    else resolve(SparkJSON(result ?: NSNull.null));
  };
  NSString *name = Text(args[@"name"]);
  // Request identifiers are unique per runtime; the module's address keeps runtimes apart in the shared instance.
  NSString *request = Text(args[@"id"]) ? [NSString stringWithFormat:@"%p:%@", self, args[@"id"]] : nil;
  if ([method isEqual:@"status"] && name) [helpers status:name completion:answer];
  else if ([method isEqual:@"register"] && name) [helpers registerHelper:name completion:answer];
  else if ([method isEqual:@"unregister"] && name) [helpers unregisterHelper:name completion:answer];
  else if ([method isEqual:@"openSettings"]) [helpers openSettings:answer];
  else if ([method isEqual:@"authorize"] && Text(args[@"prompt"])) {
    [helpers authorize:args[@"prompt"] completion:^(id result, NSError *error) {
      // A prompt answered after this runtime was torn down has nobody to hold its rights: destroy them at once.
      if ([result[@"type"] isEqual:@"authorized"] && self->_invalidated) [Shared() releaseAuthorization:result[@"id"]];
      else if ([result[@"type"] isEqual:@"authorized"]) [self->_authorizations addObject:result[@"id"]];
      answer(result, error);
    }];
  }
  else if ([method isEqual:@"release"] && Text(args[@"id"])) {
    if ([_authorizations containsObject:args[@"id"]]) [helpers releaseAuthorization:args[@"id"]];
    [_authorizations removeObject:args[@"id"]];
    resolve(@"null");
  }
  else if ([method isEqual:@"send"] && name && request && [args[@"timeoutMs"] isKindOfClass:NSNumber.class] && args[@"message"]) {
    id authorization = args[@"authorization"];
    if (authorization && !(Text(authorization) && [_authorizations containsObject:authorization])) { reject(@"E_CLOSED", @"The admin authorization was released", nil); return; }
    [_requests addObject:request];
    [helpers send:args[@"message"] helper:name authorization:authorization timeoutMs:[args[@"timeoutMs"] unsignedIntegerValue] identifier:request completion:^(id result, NSError *error) {
      [self->_requests removeObject:request];
      answer(result, error);
    }];
  }
  else if ([method isEqual:@"cancel"] && request) { if ([_requests containsObject:request]) [helpers cancel:request]; resolve(@"null"); }
  else SparkInvalid(reject, @"Unknown privileged helper operation");
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeDesktopPrivilegedHelperSpecJSI>(params);
}
@end
