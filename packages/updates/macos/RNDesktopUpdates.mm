#import "RNDesktopUpdates.h"
#import <RNDesktopApp/SparkDesktop.h>
#import <Sparkle/Sparkle.h>
#import "SparkUpdateState.h"

@interface SparkUpdater : NSObject <SPUUpdaterDelegate>
@property SPUStandardUpdaterController *controller;
@property BOOL started;
+ (instancetype)shared;
- (NSDictionary *)status;
- (BOOL)start:(NSError **)error;
@end
static NSString *UnavailableReason(void) {
  NSString *mode = SparkContext()[@"runtime"][@"mode"];
  if ([mode isEqual:@"go"]) return @"go";
  if (![mode isEqual:@"release"]) return @"development";
  NSURL *url = [NSURL URLWithString:[NSBundle.mainBundle objectForInfoDictionaryKey:@"SUFeedURL"] ?: @""];
  NSData *key = [[NSData alloc] initWithBase64EncodedString:[NSBundle.mainBundle objectForInfoDictionaryKey:@"SUPublicEDKey"] ?: @"" options:0];
  if (![url.scheme isEqual:@"https"] || !url.host.length || url.user.length || url.password.length || key.length != 32) return @"unconfigured";
  return nil;
}
@implementation SparkUpdater
+ (instancetype)shared { static SparkUpdater *updater; static dispatch_once_t once; dispatch_once(&once, ^{ updater = [SparkUpdater new]; }); return updater; }
- (NSDictionary *)status {
  NSString *reason = UnavailableReason();
  if (reason) return @{ @"available": @NO, @"reason": reason, @"started": @NO, @"canCheck": @NO, @"automaticallyChecks": @NO, @"checkIntervalSeconds": NSNull.null, @"skippedBuild": NSNull.null, @"skippedMajorBuild": NSNull.null, @"lastCheckedAt": NSNull.null };
  // Settings read the persisted preferences without starting Sparkle.
  SPUUpdater *updater = self.started ? self.controller.updater : nil;
  SPUUpdaterSettings *settings = updater ? nil : [[SPUUpdaterSettings alloc] initWithHostBundle:NSBundle.mainBundle];
  NSDate *checked = updater.lastUpdateCheckDate;
  NSMutableDictionary *status = [SparkSkippedUpdates(NSUserDefaults.standardUserDefaults) mutableCopy];
  [status addEntriesFromDictionary:@{ @"available": @YES, @"started": @(self.started), @"canCheck": @(updater.canCheckForUpdates),
    @"automaticallyChecks": @(updater ? updater.automaticallyChecksForUpdates : settings.automaticallyChecksForUpdates),
    @"checkIntervalSeconds": @(updater ? updater.updateCheckInterval : settings.updateCheckInterval),
    @"feedURL": [NSBundle.mainBundle objectForInfoDictionaryKey:@"SUFeedURL"],
    @"lastCheckedAt": checked ? [[NSISO8601DateFormatter new] stringFromDate:checked] : NSNull.null }];
  return status;
}
- (BOOL)start:(NSError **)error {
  if (self.started) return YES;
  if (!self.controller) self.controller = [[SPUStandardUpdaterController alloc] initWithStartingUpdater:NO updaterDelegate:self userDriverDelegate:nil];
  self.started = [self.controller.updater startUpdater:error];
  return self.started;
}
- (void)event:(NSString *)state item:(SUAppcastItem *)item error:(NSError *)error { SparkEmit(SparkUpdateEvent(state, item, error)); }
- (BOOL)updater:(SPUUpdater *)updater mayPerformUpdateCheck:(SPUUpdateCheck)check error:(NSError **)error { [self event:@"checking" item:nil error:nil]; return YES; }
- (void)updater:(SPUUpdater *)updater didFindValidUpdate:(SUAppcastItem *)item { [self event:@"available" item:item error:nil]; }
- (void)updaterDidNotFindUpdate:(SPUUpdater *)updater error:(NSError *)error { [self event:@"notAvailable" item:nil error:nil]; }
- (void)updater:(SPUUpdater *)updater willDownloadUpdate:(SUAppcastItem *)item withRequest:(NSMutableURLRequest *)request { [self event:@"downloading" item:item error:nil]; }
- (void)updater:(SPUUpdater *)updater userDidMakeChoice:(SPUUserUpdateChoice)choice forUpdate:(SUAppcastItem *)item state:(SPUUserUpdateState *)state {
  if (choice == SPUUserUpdateChoiceSkip) [self event:@"skipped" item:item error:nil];
}
- (void)updater:(SPUUpdater *)updater didDownloadUpdate:(SUAppcastItem *)item { [self event:@"downloaded" item:item error:nil]; }
- (void)updater:(SPUUpdater *)updater willInstallUpdate:(SUAppcastItem *)item { [self event:@"installing" item:item error:nil]; }
- (void)updater:(SPUUpdater *)updater didAbortWithError:(NSError *)error { if (SparkReportsAbort(error)) [self event:@"error" item:nil error:error]; }
@end
@implementation RNDesktopUpdates
RCT_EXPORT_MODULE(NativeDesktopUpdates)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  // Sparkle can enter a modal UI loop; do not hold the main dispatch queue.
  [NSRunLoop.mainRunLoop performBlock:^{
    SparkUpdater *updater = [SparkUpdater shared];
    if ([method isEqual:@"status"]) { resolve(SparkJSON([updater status])); return; }
    if (![@[@"start", @"check", @"background", @"configure", @"clearSkipped"] containsObject:method]) { SparkInvalid(reject, @"Unknown update operation"); return; }
    NSDictionary *args = SparkArgs(json);
    if ([method isEqual:@"configure"]) {
      id enabled = args[@"automaticallyChecks"], interval = args[@"checkIntervalSeconds"];
      if ((enabled && (![enabled isKindOfClass:NSNumber.class] || CFGetTypeID((__bridge CFTypeRef)enabled) != CFBooleanGetTypeID())) ||
          (interval && (![interval isKindOfClass:NSNumber.class] || CFGetTypeID((__bridge CFTypeRef)interval) == CFBooleanGetTypeID() || !isfinite([interval doubleValue]) || [interval doubleValue] < 3600))) {
        SparkInvalid(reject, @"Invalid updater configuration"); return;
      }
    }
    NSString *reason = UnavailableReason();
    if (reason) { reject(@"E_UNAVAILABLE", [@"Updates require a configured standalone release app; current state: " stringByAppendingString:reason], nil); return; }
    if ([method isEqual:@"clearSkipped"]) {
      SparkClearSkippedUpdates(NSUserDefaults.standardUserDefaults);
      resolve(@"null"); return;
    }
    NSError *error = nil;
    if (![updater start:&error]) { reject(@"E_NATIVE", error.localizedDescription ?: @"Could not start updater", error); return; }
    if ([method isEqual:@"check"]) {
      if (!updater.controller.updater.canCheckForUpdates) { reject(@"E_BUSY", @"An update session is already running", nil); return; }
      [updater.controller checkForUpdates:nil]; resolve(@"null");
    } else if ([method isEqual:@"background"]) {
      if (!updater.controller.updater.canCheckForUpdates) { reject(@"E_BUSY", @"An update session is already running", nil); return; }
      [updater.controller.updater checkForUpdatesInBackground]; resolve(@"null");
    } else if ([method isEqual:@"configure"]) {
      if (args[@"automaticallyChecks"]) updater.controller.updater.automaticallyChecksForUpdates = [args[@"automaticallyChecks"] boolValue];
      if (args[@"checkIntervalSeconds"]) updater.controller.updater.updateCheckInterval = [args[@"checkIntervalSeconds"] doubleValue];
      resolve(@"null");
    } else resolve(@"null");
  }];
}
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params { return std::make_shared<facebook::react::NativeDesktopUpdatesSpecJSI>(params); }
@end
