#import "RNDesktopUpdates.h"
#import <RNDesktopApp/SparkDesktop.h>
#import <Sparkle/Sparkle.h>

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
  NSMutableDictionary *result = [@{ @"available": @(!reason), @"started": @(self.started), @"canCheck": @(self.started && self.controller.updater.canCheckForUpdates), @"automaticallyChecks": @(self.started && self.controller.updater.automaticallyChecksForUpdates), @"updateCheckInterval": @(self.started ? self.controller.updater.updateCheckInterval : 3600) } mutableCopy];
  if (reason) result[@"reason"] = reason;
  if (!reason) result[@"feedURL"] = [NSBundle.mainBundle objectForInfoDictionaryKey:@"SUFeedURL"];
  return result;
}
- (BOOL)start:(NSError **)error {
  if (self.started) return YES;
  if (!self.controller) self.controller = [[SPUStandardUpdaterController alloc] initWithStartingUpdater:NO updaterDelegate:self userDriverDelegate:nil];
  self.started = [self.controller.updater startUpdater:error];
  return self.started;
}
- (void)event:(NSString *)state item:(SUAppcastItem *)item error:(NSError *)error {
  NSMutableDictionary *event = [@{ @"type": @"update", @"state": state } mutableCopy];
  if (item) event[@"version"] = item.displayVersionString;
  if (error) event[@"message"] = error.localizedDescription;
  SparkEmit(event);
}
- (BOOL)updater:(SPUUpdater *)updater mayPerformUpdateCheck:(SPUUpdateCheck)check error:(NSError **)error { [self event:@"checking" item:nil error:nil]; return YES; }
- (void)updater:(SPUUpdater *)updater didFindValidUpdate:(SUAppcastItem *)item { [self event:@"available" item:item error:nil]; }
- (void)updaterDidNotFindUpdate:(SPUUpdater *)updater error:(NSError *)error { [self event:@"notAvailable" item:nil error:nil]; }
- (void)updater:(SPUUpdater *)updater willDownloadUpdate:(SUAppcastItem *)item withRequest:(NSMutableURLRequest *)request { [self event:@"downloading" item:item error:nil]; }
- (void)updater:(SPUUpdater *)updater didDownloadUpdate:(SUAppcastItem *)item { [self event:@"downloaded" item:item error:nil]; }
- (void)updater:(SPUUpdater *)updater willInstallUpdate:(SUAppcastItem *)item { [self event:@"installing" item:item error:nil]; }
- (void)updater:(SPUUpdater *)updater didAbortWithError:(NSError *)error { [self event:@"error" item:nil error:error]; }
@end
@implementation RNDesktopUpdates
RCT_EXPORT_MODULE(NativeDesktopUpdates)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (NSNumber *)isAvailable { return @(UnavailableReason() == nil); }
- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  // Sparkle can enter a modal UI loop; do not hold the main dispatch queue.
  [NSRunLoop.mainRunLoop performBlock:^{
    SparkUpdater *updater = [SparkUpdater shared];
    if ([method isEqual:@"status"]) { resolve(SparkJSON([updater status])); return; }
    if (![@[@"start", @"check", @"background", @"automatic", @"interval"] containsObject:method]) { SparkInvalid(reject, @"Unknown update operation"); return; }
    NSString *reason = UnavailableReason();
    if (reason) { reject(@"E_UPDATES_UNAVAILABLE", [@"Updates require a configured standalone release app; current state: " stringByAppendingString:reason], nil); return; }
    NSError *error = nil;
    if (![updater start:&error]) { reject(@"E_UPDATES_START", error.localizedDescription ?: @"Could not start updater", error); return; }
    if ([method isEqual:@"check"]) {
      if (!updater.controller.updater.canCheckForUpdates) { reject(@"E_UPDATES_BUSY", @"An update session is already running", nil); return; }
      [updater.controller checkForUpdates:nil]; resolve(@"null");
    } else if ([method isEqual:@"background"]) {
      if (!updater.controller.updater.canCheckForUpdates) { reject(@"E_UPDATES_BUSY", @"An update session is already running", nil); return; }
      [updater.controller.updater checkForUpdatesInBackground]; resolve(@"null");
    } else if ([method isEqual:@"interval"]) {
      double interval = [SparkArgs(json)[@"seconds"] doubleValue];
      if (!isfinite(interval) || interval <= 0) { SparkInvalid(reject, @"Update interval must be positive and finite"); return; }
      updater.controller.updater.updateCheckInterval = interval; resolve(@"null");
    } else if ([method isEqual:@"automatic"]) {
      updater.controller.updater.automaticallyChecksForUpdates = [SparkArgs(json)[@"enabled"] boolValue]; resolve(@"null");
    } else resolve(SparkJSON([updater status]));
  }];
}
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params { return std::make_shared<facebook::react::NativeDesktopUpdatesSpecJSI>(params); }
@end
