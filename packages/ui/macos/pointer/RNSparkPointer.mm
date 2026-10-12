#import "RNSparkPointer.h"
#import "SparkPointer.h"
#import <AppKit/AppKit.h>

/** Every method runs on the main queue, where AppKit's cursor and haptics live. */
@implementation RNSparkPointer
RCT_EXPORT_MODULE(NativeSparkPointer)
+ (BOOL)requiresMainQueueSetup { return NO; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }

// In driver mode the test driver records this instead of hiding the real cursor (docs/test-driver.md#cursor).
- (void)hideCursorUntilMoved:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [NSCursor setHiddenUntilMouseMoves:YES];
  resolve(nil);
}

- (void)performHapticFeedback:(NSString *)pattern performanceTime:(NSString *)performanceTime resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  if (SparkPointerPerformHaptic(NSHapticFeedbackManager.defaultPerformer, pattern, performanceTime)) resolve(nil);
  else reject(@"E_INVALID_ARGUMENT", @"Unknown haptic pattern or performance time", nil);
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeSparkPointerSpecJSI>(params);
}
@end
