#import <AppKit/AppKit.h>
// RCT_DEV comes from React Native; the driver's standalone native tests compile this without it.
#if __has_include(<React/RCTDefines.h>)
#import <React/RCTDefines.h>
#endif

// The frame timeline (docs/devtools.md#frame-timeline): main-thread display-link frames and the MotionViews animating in
// each, recorded by the development profiler (SparkProfiler.mm) and the in-app test driver's startFrames/stopFrames
// (SparkTestDriverFrames.mm), so the release gate's frame budgets and a developer's trace measure the same thing.
// Development builds and builds with the test driver only.
#if RCT_DEV || SPARK_TEST_DRIVER
NS_ASSUME_NONNULL_BEGIN

// Main thread, each frame: the MotionViews animating now, by testID (or "MotionView <tag>"). @legendapp/spark-motion sets it.
typedef NSArray<NSString *> *_Nonnull (^SparkFrameTimelineMotion)(void);
FOUNDATION_EXPORT void SparkFrameTimelineSetMotion(SparkFrameTimelineMotion _Nullable motion);

@interface SparkFrameTimeline : NSObject
// Main thread. Adds a display link for the main screen (a driven app's windows are never on screen, so the link belongs to
// the screen) at the display's maximum rate, in the common run loop modes. Nil with `error` when no display is connected.
+ (nullable instancetype)startWithError:(NSString *_Nullable *_Nonnull)error;
// CACurrentMediaTime when it started: timeline times are milliseconds from it.
@property (nonatomic, readonly) CFTimeInterval start;
// The display's maximum frames per second.
@property (nonatomic, readonly) NSInteger refreshRate;
// Main thread. Stops and reports `frames`, `droppedFrames`, `maxFrameGapMs`, `durationMs`, `fps` and `refreshRate`, as
// the driver's stopFrames does, and `timeline`: `timestamps` (each frame), `intervalMs`, `motion` ({view, startMs, endMs})
// and `truncated`.
- (NSDictionary *)stop;
@end

NS_ASSUME_NONNULL_END
#endif
