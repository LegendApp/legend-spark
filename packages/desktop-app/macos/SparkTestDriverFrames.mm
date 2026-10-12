#import "SparkTestDriverPrivate.h"
#import "SparkFrameTimeline.h"

// Frame counting (docs/test-driver.md#frame-timing) on the frame timeline (SparkFrameTimeline.mm), which the development
// profiler records too: startFrames starts it; stopFrames reports its frame counts and, with `timeline: true`, the
// timeline itself (each frame and the MotionViews animating), which the runner's assertFrames writes as a Chrome trace.
static SparkFrameTimeline *recording;

NSArray<NSString *> *SparkDriverFrameCommandNames(void) {
  static NSArray *names = @[@"startFrames", @"stopFrames"];
  return names;
}

void SparkDriverFrames(NSString *command, NSDictionary *request, SparkTestDriverReply reply) {
  if ([command isEqual:@"startFrames"]) {
    if (recording) { reply(SparkDriverFailure(@"E_BUSY", @"Frame counting has already started; stopFrames first")); return; }
    NSString *error;
    recording = [SparkFrameTimeline startWithError:&error];
    if (!recording) { reply(SparkDriverFailure(@"E_UNAVAILABLE", error)); return; }
    reply(@{ @"ok": @YES, @"refreshRate": @(recording.refreshRate) });
    return;
  }
  if (!recording) { reply(SparkDriverFailure(@"E_INVALID_STATE", @"Frame counting has not started; startFrames first")); return; }
  NSMutableDictionary *report = [[recording stop] mutableCopy];
  recording = nil;
  if ([report[@"frames"] integerValue] < 2) {
    reply(SparkDriverFailure(@"E_UNAVAILABLE", [NSString stringWithFormat:@"The display link delivered %@ frames, so frame timing could not be measured", report[@"frames"]]));
    return;
  }
  if (![request[@"timeline"] isEqual:@YES]) [report removeObjectForKey:@"timeline"];
  report[@"ok"] = @YES;
  reply(report);
}
