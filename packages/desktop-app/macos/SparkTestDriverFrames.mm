#import "SparkTestDriverPrivate.h"
#import <QuartzCore/QuartzCore.h>
#include <cmath>

// Frame counting (docs/test-driver.md#frame-timing): a display link on the main run loop, in the common modes, for
// the display's maximum rate. Each callback is a frame the main thread was free to produce; a gap of more than one
// refresh interval between callbacks counts the missed intervals as dropped. It measures the app's main-thread
// cadence against the display's refresh, not what the window server composited (that needs out-of-process
// instrumentation), and a driven app's windows are never on screen, so the display link belongs to the screen.
@interface SparkDriverFrameCounter : NSObject
@property (nonatomic, strong) CADisplayLink *link;
@property (nonatomic) NSInteger frames, dropped, refreshRate;
@property (nonatomic) CFTimeInterval first, last, maxGap;
@end
@implementation SparkDriverFrameCounter
- (void)tick:(CADisplayLink *)link
{
  const CFTimeInterval timestamp = link.timestamp, interval = link.targetTimestamp - link.timestamp;
  if (_frames == 0) _first = timestamp;
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
}
@end

static SparkDriverFrameCounter *counter;

NSArray<NSString *> *SparkDriverFrameCommandNames(void) {
  static NSArray *names = @[@"startFrames", @"stopFrames"];
  return names;
}

void SparkDriverFrames(NSString *command, NSDictionary *request, SparkTestDriverReply reply) {
  if ([command isEqual:@"startFrames"]) {
    if (counter) { reply(SparkDriverFailure(@"E_BUSY", @"Frame counting has already started; stopFrames first")); return; }
    NSScreen *screen = NSScreen.mainScreen ?: NSScreen.screens.firstObject;
    if (!screen) { reply(SparkDriverFailure(@"E_UNAVAILABLE", @"No display is connected, so frame timing cannot be measured")); return; }
    counter = [SparkDriverFrameCounter new];
    counter.refreshRate = screen.maximumFramesPerSecond;
    counter.link = [screen displayLinkWithTarget:counter selector:@selector(tick:)];
    const float rate = (float)screen.maximumFramesPerSecond;
    counter.link.preferredFrameRateRange = CAFrameRateRangeMake(rate, rate, rate);
    [counter.link addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
    reply(@{ @"ok": @YES, @"refreshRate": @(counter.refreshRate) });
    return;
  }
  if (!counter) { reply(SparkDriverFailure(@"E_INVALID_STATE", @"Frame counting has not started; startFrames first")); return; }
  SparkDriverFrameCounter *done = counter;
  counter = nil;
  [done.link invalidate];
  if (done.frames < 2) {
    reply(SparkDriverFailure(@"E_UNAVAILABLE", [NSString stringWithFormat:@"The display link delivered %ld frames, so frame timing could not be measured", (long)done.frames]));
    return;
  }
  const CFTimeInterval duration = done.last - done.first;
  reply(@{ @"ok": @YES, @"frames": @(done.frames), @"droppedFrames": @(done.dropped), @"maxFrameGapMs": @(done.maxGap * 1000),
    @"durationMs": @(duration * 1000), @"fps": @((done.frames - 1) / duration), @"refreshRate": @(done.refreshRate) });
}
