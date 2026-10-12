#import <RNDesktopApp/SparkFrameTimeline.h>
#import "SparkMotionCoordinator.h"

// The frame timeline's compositor track (docs/devtools.md#frame-timeline): each frame, the MotionViews animating. Built
// with the frame timeline only: development builds and builds with the test driver.
#if RCT_DEV || SPARK_TEST_DRIVER
@interface SparkMotionTimeline : NSObject
@end
@implementation SparkMotionTimeline
+ (void)load
{
  SparkFrameTimelineSetMotion(^{ return [SparkMotionCoordinator.shared animatingViews]; });
}
@end
#endif
