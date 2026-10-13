#import <AppKit/AppKit.h>
#import <RNDesktopApp/SparkWindowTransitions.h>

NS_ASSUME_NONNULL_BEGIN

/** What a view draws now, at its window's backing scale. */
@interface SparkMotionSnapshot : NSObject
/** At most `largest` points (the largest box it shows in) at the backing scale; nil for a view with an empty box. */
+ (nullable instancetype)snapshotOf:(NSView *)view largest:(CGSize)largest;
@property (nonatomic, readonly) id image;  // CGImageRef
@end

/**
 * The window a cross-window shared element flies in, between windows and displays in screen coordinates
 * (docs/motion.md#cross-window-shared-elements). Borderless and transparent; it never becomes key or main, ignores the
 * mouse, stays out of the Window menu, Mission Control, window cycling and state restoration, and is not a Spark window,
 * so window lists, sessions and workspaces never see it. It shows the source's snapshot crossfading into the
 * destination's. Main thread only.
 */
@interface SparkMotionFlightWindow : NSPanel
- (instancetype)initWithFrom:(nullable SparkMotionSnapshot *)from to:(nullable SparkMotionSnapshot *)to;
/** Puts it at `frame` (screen coordinates), showing the destination's snapshot by `progress` (0–1) over the source's. */
- (void)place:(NSRect)frame progress:(double)progress;
/** Shows it above `windows` (at the highest of their levels), without activating the app. */
- (void)showAbove:(NSArray<NSWindow *> *)windows;
@end

NS_ASSUME_NONNULL_END
