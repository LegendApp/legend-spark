#import "SparkFrameTimeline.h"
#if RCT_DEV || SPARK_TEST_DRIVER
#import <QuartzCore/QuartzCore.h>
#include <cmath>
#include <vector>

// Each display-link callback is a frame the main thread was free to produce; a gap of more than one refresh interval
// between callbacks counts the missed intervals as dropped. It measures the app's main-thread cadence against the
// display's refresh, not what the window server composited (that needs out-of-process instrumentation).
static SparkFrameTimelineMotion motionSource;
void SparkFrameTimelineSetMotion(SparkFrameTimelineMotion motion) { motionSource = [motion copy]; }

// A recording keeps the timestamps of its first 72,000 frames (10 minutes at 120 Hz) and its first 10,000 motion
// slices; it counts every frame.
static const size_t SparkTimelineFrameLimit = 72000;
static const NSUInteger SparkTimelineMotionLimit = 10000;

@interface SparkFrameTimeline ()
@property (nonatomic, strong) CADisplayLink *link;
@end
@implementation SparkFrameTimeline {
  NSInteger _frames, _dropped;
  CFTimeInterval _first, _last, _maxGap, _interval;
  std::vector<double> _timestamps;
  NSMutableDictionary<NSString *, NSNumber *> *_moving;  // view → its slice's start, while it animates
  NSMutableArray<NSDictionary *> *_motion;
  BOOL _truncated, _recordsTimeline;
}

+ (instancetype)startWithMotion:(BOOL)motion error:(NSString **)error
{
  NSScreen *screen = NSScreen.mainScreen ?: NSScreen.screens.firstObject;
  if (!screen) { *error = @"No display is connected, so frame timing cannot be measured"; return nil; }
  SparkFrameTimeline *timeline = [SparkFrameTimeline new];
  timeline->_refreshRate = screen.maximumFramesPerSecond;
  timeline->_start = CACurrentMediaTime();
  timeline->_moving = [NSMutableDictionary new];
  timeline->_motion = [NSMutableArray new];
  timeline->_recordsTimeline = motion;
  timeline.link = [screen displayLinkWithTarget:timeline selector:@selector(tick:)];
  const float rate = (float)screen.maximumFramesPerSecond;
  timeline.link.preferredFrameRateRange = CAFrameRateRangeMake(rate, rate, rate);
  [timeline.link addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
  return timeline;
}

- (double)ms:(CFTimeInterval)time { return (time - _start) * 1000; }

- (void)tick:(CADisplayLink *)link
{
  const CFTimeInterval timestamp = link.timestamp, interval = link.targetTimestamp - link.timestamp;
  if (_frames == 0) { _first = timestamp; _interval = interval; }
  else {
    const CFTimeInterval gap = timestamp - _last;
    _maxGap = MAX(_maxGap, gap);
    if (interval > 0) {
      const long missed = lround(gap / interval) - 1;
      if (missed > 0) _dropped += missed;
    }
  }
  _frames++;
  _last = timestamp;
  if (!_recordsTimeline) return;
  if (_timestamps.size() < SparkTimelineFrameLimit) _timestamps.push_back([self ms:timestamp]);
  else _truncated = YES;
  if (!motionSource) return;
  NSSet<NSString *> *now = [NSSet setWithArray:motionSource()];
  for (NSString *view in now) if (!_moving[view]) _moving[view] = @([self ms:timestamp]);
  for (NSString *view in _moving.allKeys) if (![now containsObject:view]) [self endMotion:view at:[self ms:timestamp]];
}

- (void)endMotion:(NSString *)view at:(double)end
{
  if (_motion.count < SparkTimelineMotionLimit) [_motion addObject:@{ @"view": view, @"startMs": _moving[view], @"endMs": @(end) }];
  else _truncated = YES;
  [_moving removeObjectForKey:view];
}

- (NSDictionary *)stop
{
  [_link invalidate];
  _link = nil;
  const CFTimeInterval duration = _frames > 1 ? _last - _first : 0;
  NSMutableDictionary *report = [@{
    @"frames": @(_frames), @"droppedFrames": @(_dropped), @"maxFrameGapMs": @(_maxGap * 1000), @"durationMs": @(duration * 1000),
    @"fps": @(duration > 0 ? (_frames - 1) / duration : 0), @"refreshRate": @(_refreshRate),
  } mutableCopy];
  if (!_recordsTimeline) return report;
  for (NSString *view in _moving.allKeys) [self endMotion:view at:[self ms:_last]];
  NSMutableArray<NSNumber *> *timestamps = [NSMutableArray arrayWithCapacity:_timestamps.size()];
  for (double timestamp : _timestamps) [timestamps addObject:@(timestamp)];
  report[@"timeline"] = @{ @"timestamps": timestamps, @"intervalMs": @(_interval > 0 ? _interval * 1000 : 1000.0 / MAX(_refreshRate, 1)), @"motion": [_motion copy], @"truncated": @(_truncated) };
  return report;
}
@end
#endif
