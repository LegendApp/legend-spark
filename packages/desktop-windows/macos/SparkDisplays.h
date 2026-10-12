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
// Whether `displays` is a list the driver can simulate: non-empty, unique string IDs, exactly one primary
// display, and each with an origin, a positive size, a work area and a positive scale factor.
FOUNDATION_EXPORT BOOL SparkValidSimulatedDisplays(id displays);

// A display as window geometry sees it (@legendapp/spark/windows): AppKit global frames, upward Y.
// In driver mode with simulated displays these are the simulated displays, so windows can be placed and
// measured on them; the windows are never on screen there (docs/test-driver.md). `screen` is the real
// NSScreen, nil for a simulated display.
@interface SparkScreen : NSObject
@property (readonly) NSString *identifier;
@property (readonly, nullable) NSString *persistentId;
@property (readonly) NSString *name;
@property (readonly) BOOL primary;
@property (readonly) NSRect frame;
@property (readonly) NSRect visibleFrame;
@property (readonly) CGFloat scaleFactor;
@property (readonly, nullable) NSScreen *screen;
@end
FOUNDATION_EXPORT NSArray<SparkScreen *> *SparkScreens(void);
FOUNDATION_EXPORT SparkScreen *_Nullable SparkScreenForId(NSString *_Nullable identifier);
FOUNDATION_EXPORT SparkScreen *SparkPrimary(void);
// The display with the largest share of `frame`; the primary display breaks a tie.
FOUNDATION_EXPORT SparkScreen *SparkOwning(NSRect frame);
// Outer frame in logical units from the owning display's top-left corner (WindowBounds).
FOUNDATION_EXPORT NSDictionary *SparkWindowBounds(NSWindow *window);
// The window API's DisplayInfo list and pointer position, over SparkScreens().
FOUNDATION_EXPORT NSArray<NSDictionary *> *SparkWindowDisplays(void);
FOUNDATION_EXPORT NSDictionary *SparkPointer(void);

// Calls `changed` on the main thread after AppKit reports new screen parameters (connect, disconnect,
// arrangement, resolution, scale, work area, EDR headroom), a screen color space change, a Core Graphics
// display reconfiguration (mode and refresh rate) or a simulation change. Not every call is a change.
@interface SparkDisplayObserver : NSObject
- (instancetype)initWithHandler:(void (^)(void))changed;
- (void)stop;
@end

NS_ASSUME_NONNULL_END
