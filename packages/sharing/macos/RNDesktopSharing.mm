#import "RNDesktopSharing.h"
#import "SparkSharing.h"
#import <RNDesktopApp/SparkDesktop.h>
#import <RNDesktopApp/SparkTestDriver.h>
#import <CoreSpotlight/CoreSpotlight.h>

// One instance per process (main thread), shared by every runtime and the test driver. In driver mode it is simulated:
// no picker appears, the Services provider is never set and the Spotlight index is never written (docs/sharing.md#testing).
static SparkSharing *Shared(void) {
  static SparkSharing *sharing;
  if (!sharing) {
    sharing = [[SparkSharing alloc] initWithInfo:NSBundle.mainBundle.infoDictionary ?: @{} simulated:SparkTestDriverActive()];
    sharing.serviceHandler = ^(NSDictionary *invocation) {
      NSMutableDictionary *event = [invocation mutableCopy];
      event[@"type"] = @"serviceInvoked";
      SparkEmit(event);
    };
  }
  return sharing;
}
static NSDictionary *Error(NSError *error) { return @{ @"ok": @NO, @"error": @{ @"code": SparkSharingErrorCode(error), @"message": error.localizedDescription } }; }

#if SPARK_TEST_DRIVER
// Reachable only through an authenticated driver session: {"command": "simulateSharing", "shareAnswer"?, "services"?,
// "invokeService"?: { name, text }, "openSpotlightItem"?, "openUniversalLink"?} and {"command": "testSharing"}.
@interface SparkSharingDriver : NSObject
@end
@implementation SparkSharingDriver
// Delivers a user activity to the app delegate as macOS does when the person opens a Spotlight result or a universal link.
+ (NSError *)continueActivity:(NSUserActivity *)activity
{
  id<NSApplicationDelegate> delegate = NSApp.delegate;
  if (![delegate respondsToSelector:@selector(application:continueUserActivity:restorationHandler:)]
      || ![delegate application:NSApp continueUserActivity:activity restorationHandler:^(NSArray *) {}])
    return [NSError errorWithDomain:SparkSharingErrorDomain code:0 userInfo:@{ @"code": @"E_UNAVAILABLE", NSLocalizedDescriptionKey: @"The app delegate did not continue the activity" }];
  return nil;
}
+ (void)load {
  SparkTestDriverRegisterCommand(@"simulateSharing", ^(NSDictionary *request, SparkTestDriverReply reply) {
    SparkSharing *sharing = Shared();
    NSError *error = nil;
    id invoke = request[@"invokeService"], spotlight = request[@"openSpotlightItem"], link = request[@"openUniversalLink"];
    if (![sharing simulateAnswer:request[@"shareAnswer"] services:request[@"services"] error:&error]) return reply(Error(error));
    if (invoke && (![invoke isKindOfClass:NSDictionary.class] || ![sharing invokeService:invoke[@"name"] text:invoke[@"text"] error:&error]))
      return reply(Error(error ?: [NSError errorWithDomain:SparkSharingErrorDomain code:0 userInfo:@{ @"code": @"E_INVALID_ARGUMENT", NSLocalizedDescriptionKey: @"invokeService is { name, text }" }]));
    if (spotlight) {
      if (![spotlight isKindOfClass:NSString.class]) return reply(Error([NSError errorWithDomain:SparkSharingErrorDomain code:0 userInfo:@{ @"code": @"E_INVALID_ARGUMENT", NSLocalizedDescriptionKey: @"openSpotlightItem is an item id" }]));
      NSUserActivity *activity = [[NSUserActivity alloc] initWithActivityType:CSSearchableItemActionType];
      activity.userInfo = @{ CSSearchableItemActivityIdentifier: spotlight };
      if ((error = [self continueActivity:activity])) return reply(Error(error));
    }
    if (link) {
      NSURL *url = [link isKindOfClass:NSString.class] ? [NSURL URLWithString:link] : nil;
      if (![url.scheme isEqual:@"https"]) return reply(Error([NSError errorWithDomain:SparkSharingErrorDomain code:0 userInfo:@{ @"code": @"E_INVALID_ARGUMENT", NSLocalizedDescriptionKey: @"openUniversalLink is an https URL" }]));
      NSUserActivity *activity = [[NSUserActivity alloc] initWithActivityType:NSUserActivityTypeBrowsingWeb];
      activity.webpageURL = url;
      if ((error = [self continueActivity:activity])) return reply(Error(error));
    }
    reply(@{ @"ok": @YES, @"sharing": sharing.simulation });
  });
  SparkTestDriverRegisterCommand(@"testSharing", ^(NSDictionary *request, SparkTestDriverReply reply) {
    if (!Shared().simulated) reply(@{ @"ok": @NO, @"error": @{ @"code": @"E_UNAVAILABLE", @"message": @"Sharing simulation needs the test driver" } });
    else reply(@{ @"ok": @YES, @"sharing": Shared().simulation });
  });
}
@end
#endif

@implementation RNDesktopSharing {
  NSMutableSet<NSString *> *_services; // This runtime's service listeners, released when the bridge is invalidated.
}
RCT_EXPORT_MODULE(NativeDesktopSharing)

- (instancetype)init { if ((self = [super init])) _services = [NSMutableSet set]; return self; }
- (void)invalidate
{
  NSSet *services = [_services copy];
  [_services removeAllObjects];
  dispatch_block_t release = ^{ for (NSString *name in services) [Shared() unregisterService:name]; };
  if (NSThread.isMainThread) release(); else dispatch_async(dispatch_get_main_queue(), release);
}
+ (BOOL)requiresMainQueueSetup { return NO; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }

- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  NSDictionary *args = SparkArgs(json);
  SparkSharing *sharing = Shared();
  void (^fail)(NSError *) = ^(NSError *error) { reject(SparkSharingErrorCode(error), error.localizedDescription, error); };
  SparkSharingCompletion done = ^(NSError *error) { if (error) fail(error); else resolve(@"null"); };
  NSString *name = [args[@"name"] isKindOfClass:NSString.class] ? args[@"name"] : @"";
  if ([method isEqual:@"share"]) {
    NSView *view = nil;
    if (args[@"tag"]) {
      view = [args[@"tag"] isKindOfClass:NSNumber.class] ? SparkFindReactView([args[@"tag"] integerValue]) : nil;
      if (!view) { reject(@"E_NOT_FOUND", @"The anchor view is not mounted in a window (a flattened View needs collapsable={false})", nil); return; }
    }
    [sharing share:args[@"items"] view:view completion:^(NSString *service, NSError *error) {
      if (error) fail(error); else resolve(SparkJSON(@{ @"service": service ?: NSNull.null }));
    }];
  } else if ([method isEqual:@"registerService"]) {
    NSError *error = nil;
    if (![sharing registerService:name error:&error]) { fail(error); return; }
    [_services addObject:name];
    resolve(@"null");
  } else if ([method isEqual:@"unregisterService"]) {
    if ([_services containsObject:name]) { [_services removeObject:name]; [sharing unregisterService:name]; }
    resolve(@"null");
  } else if ([method isEqual:@"index"]) [sharing index:args[@"items"] completion:done];
  else if ([method isEqual:@"delete"]) [sharing deleteIdentifiers:args[@"ids"] domains:args[@"domains"] completion:done];
  else if ([method isEqual:@"takeSpotlightItems"]) resolve(SparkJSON(SparkTakeSpotlightItems()));
  else SparkInvalid(reject, @"Unknown sharing operation");
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeDesktopSharingSpecJSI>(params);
}
@end
