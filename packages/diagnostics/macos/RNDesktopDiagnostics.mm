#import "RNDesktopDiagnostics.h"
#import "SparkCrashReporter.h"
#import "SparkHangWatchdog.h"
#import <RNDesktopApp/SparkDesktopError.h>
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
    if (!SparkSimulateHang(duration.unsignedIntegerValue)) { reject(@"E_UNAVAILABLE", @"simulateHang exists only in Debug builds and builds with the test driver (macos.testDriverInRelease)", nil); return; }
  } else if ([method isEqual:@"getConsent"]) {
    resolve(SparkJSON(@(SparkCrashConsent()))); return;
  } else if ([method isEqual:@"setConsent"]) {
    NSNumber *granted = args[@"granted"];
    if (![granted isKindOfClass:NSNumber.class]) { SparkInvalid(reject, @"Expected granted"); return; }
    SparkSetCrashConsent(granted.boolValue);
    // On the main thread, which gets the alternate signal stack.
    if (granted.boolValue) SparkInstallCrashHandlers(SparkDefaultCrashDirectory());
    SparkSetCrashRecording(granted.boolValue);
  } else if ([method isEqual:@"getReports"] || [method isEqual:@"deleteReports"] || [method isEqual:@"simulateCrash"]) {
    NSArray *ids = args[@"ids"];
    NSString *kind = args[@"kind"];
    if ((ids && ![ids isKindOfClass:NSArray.class]) || ([method isEqual:@"simulateCrash"] && ![kind isKindOfClass:NSString.class])) { SparkInvalid(reject, @"Expected ids or a kind"); return; }
    // File work, and a helper process that can take seconds to crash: off the main thread.
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      NSString *directory = SparkDefaultCrashDirectory();
      NSError *error = nil;
      id result = [method isEqual:@"getReports"] ? SparkCrashReports(directory, &error)
        : [method isEqual:@"simulateCrash"] ? SparkSimulateCrash(directory, kind, &error)
        : SparkDeleteCrashReports(directory, ids, &error) ? NSNull.null : nil;
      if (result) resolve(SparkJSON(result));
      else reject(error.userInfo[SparkCrashCodeKey] ?: SparkDesktopErrorCode(error), error.localizedDescription ?: @"Crash reporting failed", error);
    });
    return;
  } else { SparkInvalid(reject, @"Unknown diagnostics operation"); return; }
  resolve(SparkJSON(NSNull.null));
}

// Synchronous, on the JavaScript thread: the report is on disk before React Native's fatal handler runs.
// Returns the report's id, or "" when crash reporting is off.
- (NSString *)recordJavaScriptError:(NSString *)json
{
  if (!SparkCrashRecording()) return @"";
  NSDictionary *error = SparkArgs(json);
  NSError *failure = nil;
  NSString *identifier = SparkRecordJavaScriptCrash(SparkDefaultCrashDirectory(), error, &failure);
  if (!identifier) NSLog(@"Spark crash reporting: could not write a JavaScript crash report: %@", failure.localizedDescription);
  return identifier ?: @"";
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeDesktopDiagnosticsSpecJSI>(params);
}
@end
