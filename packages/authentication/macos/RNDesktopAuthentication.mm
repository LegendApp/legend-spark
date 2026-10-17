#import "RNDesktopAuthentication.h"
#import "SparkAuthorization.h"
#import <RNDesktopApp/SparkDesktop.h>
#import <RNDesktopApp/SparkTestDriver.h>

// One instance per process, shared by every runtime and the test driver. In driver mode it is simulated: no
// ASAuthorizationController is created, nothing is presented and neither Apple nor a relying party is reached
// (docs/authentication.md#testing). The synchronous availability call may create it on the JavaScript thread.
static SparkAuthorization *Shared(void) {
  static SparkAuthorization *authorization;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ authorization = [[SparkAuthorization alloc] initWithSimulated:SparkTestDriverActive()]; });
  return authorization;
}

#if SPARK_TEST_DRIVER
// Reachable only through an authenticated driver session: {"command": "simulateAuthorization", "appleId"?,
// "webCredentials"?, "answer"?, "credentialState"?, "choice"?, "unavailableFeatures"?} and {"command": "testAuthorization"}.
@interface SparkAuthorizationDriver : NSObject
@end
@implementation SparkAuthorizationDriver
+ (void)load {
  SparkTestDriverRegisterCommand(@"simulateAuthorization", ^(NSDictionary *request, SparkTestDriverReply reply) {
    NSMutableDictionary *state = [request mutableCopy];
    [state removeObjectsForKeys:@[@"command", @"id"]]; // The driver protocol's own fields.
    NSError *error = nil;
    if ([Shared() simulate:state error:&error]) reply(@{ @"ok": @YES, @"authorization": Shared().simulation });
    else reply(@{ @"ok": @NO, @"error": @{ @"code": SparkAuthorizationErrorCode(error), @"message": error.localizedDescription } });
  });
  SparkTestDriverRegisterCommand(@"testAuthorization", ^(NSDictionary *, SparkTestDriverReply reply) {
    if (Shared().simulated) reply(@{ @"ok": @YES, @"authorization": Shared().simulation });
    else reply(@{ @"ok": @NO, @"error": @{ @"code": @"E_UNAVAILABLE", @"message": @"Authorization simulation needs the test driver" } });
  });
}
@end
#endif

// The window a request presents over: the one named windowId (useWindowId(); "main" is the main window), else the key
// window. nil when there is none.
static NSWindow *Anchor(id windowId) {
  if (![windowId isKindOfClass:NSString.class]) return NSApp.keyWindow;
  for (NSWindow *window in NSApp.windows)
    if ([window.identifier isEqual:windowId] || [window.identifier isEqual:[@"spark." stringByAppendingString:windowId]]) return window;
  return nil;
}

@implementation RNDesktopAuthentication {
  NSMutableSet<NSString *> *_pending; // This runtime's requests, cancelled when the bridge is invalidated.
}
RCT_EXPORT_MODULE(NativeDesktopAuthentication)

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

- (NSString *)availability:(NSString *)json
{
  NSDictionary *args = SparkArgs(json);
  id relyingParty = args[@"relyingPartyId"], passkeyFeature = args[@"passkeyFeature"];
  return [Shared() availability:[args[@"feature"] isKindOfClass:NSString.class] ? args[@"feature"] : @"" relyingPartyId:[relyingParty isKindOfClass:NSString.class] ? relyingParty : nil
    passkeyFeature:[passkeyFeature isKindOfClass:NSString.class] ? passkeyFeature : nil];
}

- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  NSDictionary *args = SparkArgs(json);
  SparkAuthorization *authorization = Shared();
  // Request identifiers are unique per runtime; the module's address keeps runtimes apart in the shared instance.
  NSString *identifier = [args[@"id"] isKindOfClass:NSString.class] ? [NSString stringWithFormat:@"%p:%@", self, args[@"id"]] : @"";
  _pending = _pending ?: [NSMutableSet set];
  __weak RNDesktopAuthentication *weakSelf = self;
  SparkAuthorizationCompletion answer = ^(id result, NSError *error) {
    [weakSelf forget:identifier];
    if (error) reject(SparkAuthorizationErrorCode(error), error.localizedDescription, error);
    else resolve(SparkJSON(result));
  };
  if ([method isEqual:@"perform"]) {
    NSWindow *window = Anchor(args[@"windowId"]);
    if (!window) { reject(@"E_NOT_FOUND", args[@"windowId"] ? @"No window has that windowId" : @"No key window to present over; pass windowId", nil); return; }
    NSMutableDictionary *options = [args mutableCopy];
    [options removeObjectsForKeys:@[@"id", @"operation", @"windowId"]];
    [_pending addObject:identifier];
    [authorization perform:[args[@"operation"] isKindOfClass:NSString.class] ? args[@"operation"] : @"" options:options window:window identifier:identifier completion:answer];
  }
  else if ([method isEqual:@"cancel"]) { if ([_pending containsObject:identifier]) [authorization cancel:identifier]; resolve(@"null"); }
  else if ([method isEqual:@"credentialState"]) [authorization credentialState:args[@"user"] completion:answer];
  else if ([method isEqual:@"signal"]) {
    NSMutableDictionary *options = [args mutableCopy];
    [options removeObjectForKey:@"kind"];
    [authorization signal:[args[@"kind"] isKindOfClass:NSString.class] ? args[@"kind"] : @"" options:options completion:answer];
  }
  else SparkInvalid(reject, @"Unknown authentication operation");
}
- (void)forget:(NSString *)identifier { [_pending removeObject:identifier]; }

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeDesktopAuthenticationSpecJSI>(params);
}
@end
