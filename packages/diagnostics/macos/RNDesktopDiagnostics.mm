#import "RNDesktopDiagnostics.h"
#import "SparkHangWatchdog.h"
#import <RNDesktopApp/SparkDesktop.h>

@implementation RNDesktopDiagnostics {
  NSMutableDictionary<NSString *, SparkHangWatchdog *> *_watchdogs; // By JavaScript owner token; main queue only.
}
RCT_EXPORT_MODULE(NativeDesktopDiagnostics)
+ (BOOL)requiresMainQueueSetup { return NO; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (instancetype)init { if ((self = [super init])) _watchdogs = [NSMutableDictionary new]; return self; }
// TurboModuleManager invalidates on the method queue (main), as on reload.
- (void)invalidate {
  for (SparkHangWatchdog *watchdog in _watchdogs.allValues) [watchdog stop];
  [_watchdogs removeAllObjects];
}

- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  NSDictionary *args = SparkArgs(json);
  NSString *owner = args[@"owner"];
  if ([method isEqual:@"startHangWatchdog"]) {
    NSNumber *threshold = args[@"thresholdMs"];
    if (![owner isKindOfClass:NSString.class] || ![threshold isKindOfClass:NSNumber.class]) { SparkInvalid(reject, @"Expected an owner and thresholdMs"); return; }
    if (_watchdogs[owner]) { reject(@"E_ALREADY_EXISTS", @"This hang watchdog is already running", nil); return; }
    _watchdogs[owner] = [[SparkHangWatchdog alloc] initWithThreshold:threshold.unsignedIntegerValue handler:^(NSDictionary *report) {
      NSMutableDictionary *event = [report mutableCopy];
      event[@"type"] = @"hang";
      event[@"owner"] = owner;
      SparkEmit(event);
    }];
  } else if ([method isEqual:@"stopHangWatchdog"]) {
    if (![owner isKindOfClass:NSString.class]) { SparkInvalid(reject, @"Expected an owner"); return; }
    [_watchdogs[owner] stop];
    [_watchdogs removeObjectForKey:owner];
  } else if ([method isEqual:@"simulateHang"]) {
    NSNumber *duration = args[@"durationMs"];
    if (![duration isKindOfClass:NSNumber.class]) { SparkInvalid(reject, @"Expected durationMs"); return; }
    SparkSimulateHang(duration.unsignedIntegerValue);
  } else { SparkInvalid(reject, @"Unknown diagnostics operation"); return; }
  resolve(SparkJSON(NSNull.null));
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeDesktopDiagnosticsSpecJSI>(params);
}
@end
