#pragma once
#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

// Display details for @legendapp/spark/displays (docs/displays.md): the window API's display info plus
// arrangement origin, safe area, refresh rate, color space and EDR headroom. Main thread only.
FOUNDATION_EXPORT NSArray<NSDictionary *> *SparkDisplayDetails(void);
// Driver mode only: report `displays` instead of the real screens until called with nil. Observers are
// told at once. The OS display configuration is never touched.
FOUNDATION_EXPORT void SparkSimulateDisplays(NSArray<NSDictionary *> *_Nullable displays);
FOUNDATION_EXPORT BOOL SparkDisplaysSimulated(void);

// Calls `changed` on the main thread after AppKit reports new screen parameters (connect, disconnect,
// arrangement, resolution, scale, work area, EDR headroom), a screen color space change, a Core Graphics
// display reconfiguration (mode and refresh rate) or a simulation change. Not every call is a change.
@interface SparkDisplayObserver : NSObject
- (instancetype)initWithHandler:(void (^)(void))changed;
- (void)stop;
@end

NS_ASSUME_NONNULL_END
