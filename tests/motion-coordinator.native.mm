// Drives the real macOS motion coordinator without React Native: malformed requests must reject
// (never raise), plans bake onto the host layer, the virtual clock pauses and advances layer time,
// and completions resolve exactly once. Compiled and run by tests/motion-native.test.ts.
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import "SparkMotionCoordinator.h"
#include <cstdio>
using namespace spark::motion;

static int failures = 0;
#define CHECK(condition) do { if (!(condition)) { std::printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #condition); failures++; } } while (0)

@interface TestHost : NSView <SparkMotionHost>
@property (nonatomic) NSInteger motionTag;
@property (nonatomic) Values motionModel;
@end
@implementation TestHost
- (void)applyMotionModel:(const Values &)values
{
  _motionModel = values;
  self.layer.transform = SparkMotionTransform(values);
  self.layer.opacity = values[Opacity];
}
@end

/** Stands in for a React Native view with `nativeID`. */
@interface NativeIDView : NSView
@property (nonatomic, copy) NSString *nativeId;
@end
@implementation NativeIDView
@end

/** Outcome of one coordinator call; the coordinator settles synchronously on the calling (main) thread. */
struct Outcome { bool resolved = false; id value = nil; NSString *code = nil; };
typedef void (^Command)(SparkMotionResolve, SparkMotionReject);
static Outcome *Call(Command command)
{
  Outcome *outcome = new Outcome();
  command(^(id value) { outcome->resolved = true; outcome->value = value; }, ^(NSString *code, NSString *message) { outcome->code = code; });
  return outcome;
}
static NSDictionary *JSON(id value) { return [NSJSONSerialization JSONObjectWithData:[value dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]; }
/** Telemetry replies are dictionaries already; module replies are JSON strings. */
static NSDictionary *JSON0(id value) { return [value isKindOfClass:NSDictionary.class] ? value : JSON(value); }
static NSDictionary *Timing(double to, double durationMs) { return @{ @"type": @"timing", @"to": @(to), @"durationMs": @(durationMs), @"easing": @[@0, @0, @1, @1] }; }
static NSDictionary *Request(NSString *identifier, NSInteger tag, NSDictionary *tracks) { return @{ @"id": identifier, @"groups": @[@{ @"tag": @(tag), @"tracks": tracks }] }; }

int main()
{
  @autoreleasepool {
    SparkMotionCoordinator *motion = SparkMotionCoordinator.shared;
    [motion recordTelemetry];
    TestHost *host = [[TestHost alloc] initWithFrame:NSMakeRect(0, 0, 100, 40)];
    host.wantsLayer = YES;
    host.motionTag = 7;
    // In a window that is never shown: once the run loop has turned, Core Animation drops animations added to windowless layers.
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 200, 100) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
    window.releasedWhenClosed = NO;
    [window.contentView addSubview:host];
    Values initial = kIdentity;
    initial[Opacity] = 0.5;
    [motion registerHost:host initial:initial];
    CHECK(host.layer.opacity == 0.5f);

    // Malformed requests reject with E_INVALID_ARGUMENT instead of raising.
    NSDictionary *keyframes = @{ @"type": @"keyframes", @"durationMs": @200, @"values": @[@1, @2], @"offsets": @[@0.5, @1], @"easings": @[@[@0, @0, @1, @1]] };
    auto withKey = [](NSDictionary *object, NSString *key, id value) {
      NSMutableDictionary *copy = [object mutableCopy];
      if (value) copy[key] = value; else [copy removeObjectForKey:key];
      return (NSDictionary *)copy;
    };
    NSArray<NSDictionary *> *badPlans = @[
      @{ @"id": @"bad", @"groups": @"x" },
      @{ @"id": @"bad", @"groups": @[@"x"] },
      @{ @"id": @"bad", @"groups": @[@{ @"tag": NSNull.null, @"tracks": @{ @"opacity": Timing(1, 100) } }] },
      @{ @"id": @"bad", @"groups": @[@{ @"tag": @-1, @"tracks": @{ @"opacity": Timing(1, 100) } }] },
      @{ @"id": @"bad", @"groups": @[@{ @"tag": @7, @"tracks": @"opacity" }] },
      @{ @"id": @"bad", @"groups": @[@{ @"tag": @7, @"after": @"later", @"tracks": @{ @"opacity": Timing(1, 100) } }] },
      @{ @"id": @"", @"groups": @[@{ @"tag": @7, @"tracks": @{ @"opacity": Timing(1, 100) } }] },
      Request(@"bad", 7, @{ @"wobble": Timing(1, 100) }),
      Request(@"bad", 7, @{ @"opacity": withKey(Timing(1, 100), @"reverse", NSNull.null) }),
      Request(@"bad", 7, @{ @"opacity": withKey(Timing(1, 100), @"reverse", @1) }),
      Request(@"bad", 7, @{ @"opacity": withKey(Timing(1, 100), @"to", @YES) }),
      Request(@"bad", 7, @{ @"opacity": withKey(Timing(1, 100), @"durationMs", @-5) }),
      Request(@"bad", 7, @{ @"opacity": withKey(Timing(1, 100), @"easing", @[@1.5, @0, @1, @1]) }),
      Request(@"bad", 7, @{ @"opacity": withKey(Timing(1, 100), @"easing", @"linear") }),
      Request(@"bad", 7, @{ @"opacity": withKey(Timing(1, 100), @"repeat", @"forever") }),
      Request(@"bad", 7, @{ @"opacity": withKey(keyframes, @"easings", nil) }),
      Request(@"bad", 7, @{ @"opacity": withKey(keyframes, @"easings", NSNull.null) }),
      Request(@"bad", 7, @{ @"opacity": withKey(keyframes, @"easings", @{ @"a": @1 }) }),
      Request(@"bad", 7, @{ @"opacity": withKey(keyframes, @"easings", @[]) }),
      Request(@"bad", 7, @{ @"opacity": withKey(keyframes, @"offsets", @[@1, @0.5]) }),
      Request(@"bad", 7, @{ @"opacity": withKey(keyframes, @"offsets", @[@0.5]) }),
      Request(@"bad", 7, @{ @"opacity": @{ @"type": @"decay", @"deceleration": @0.998, @"clamp": @[@0] } }),
      Request(@"bad", 7, @{ @"opacity": @{ @"type": @"decay", @"deceleration": @0.998, @"clamp": @[@0, @1] } }),
      Request(@"bad", 7, @{ @"opacity": @{ @"type": @"sequence", @"steps": NSNull.null } }),
      Request(@"bad", 7, @{ @"opacity": @{ @"type": @"spring", @"to": @1, @"mass": @1, @"stiffness": @100 } }),
      // A plan whose steps all lack properties would never settle.
      @{ @"id": @"empty", @"groups": @[@{ @"tag": @7, @"tracks": @{} }] },
      @{ @"id": @"empty", @"groups": @[] },
    ];
    for (NSDictionary *plan in badPlans) {
      Outcome *outcome = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:plan resolve:resolve reject:reject]; });
      CHECK(!outcome->resolved && [outcome->code isEqual:@"E_INVALID_ARGUMENT"]);
      if (![outcome->code isEqual:@"E_INVALID_ARGUMENT"]) std::printf("  plan %s -> %s\n", plan.description.UTF8String, outcome->code.UTF8String);
    }
    CHECK(host.layer.animationKeys.count == 0);
    // A request for a view that is not registered waits for the next mount, then rejects after a bounded wait.
    const CFTimeInterval asked = CACurrentMediaTime();
    Outcome *missing = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"missing", 99, @{ @"opacity": Timing(1, 100) }) resolve:resolve reject:reject]; });
    CHECK(!missing->code && !missing->resolved);
    Outcome *early = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion set:@{ @"tag": @8, @"values": @{ @"opacity": @0.25 } } resolve:resolve reject:reject]; });
    CHECK(!early->code && !early->resolved);
    TestHost *late = [[TestHost alloc] initWithFrame:NSMakeRect(0, 0, 10, 10)];
    late.wantsLayer = YES;
    late.motionTag = 8;
    [motion registerHost:late initial:kIdentity];  // the mount transaction arrives after the module call
    CHECK(early->resolved && late.motionModel[Opacity] == 0.25 && !missing->code);
    while (!missing->code && CACurrentMediaTime() - asked < 3) [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
    CHECK([missing->code isEqual:@"E_NOT_FOUND"] && CACurrentMediaTime() - asked >= 0.9);
    [motion unregisterTag:8];
    for (NSDictionary *request in @[@{ @"tag": @7, @"values": NSNull.null }, @{ @"tag": @7, @"values": @{ @"opacity": @"1" } }, @{ @"values": @{ @"opacity": @1 } }]) {
      Outcome *outcome = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion set:request resolve:resolve reject:reject]; });
      CHECK([outcome->code isEqual:@"E_INVALID_ARGUMENT"]);
    }
    Outcome *badStop = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion stop:@{ @"tag": @7, @"properties": @"opacity" } resolve:resolve reject:reject]; });
    CHECK([badStop->code isEqual:@"E_INVALID_ARGUMENT"]);
    NSDictionary *link = @{ @"id": @"l", @"tag": @7, @"nativeID": @"scroller", @"axis": @"y", @"clamp": @YES, @"input": @[@0, @100], @"output": @{ @"opacity": @[@1, @0] } };
    for (NSDictionary *request in @[withKey(link, @"input", @[]), withKey(link, @"input", @[@0, @0]), withKey(link, @"output", @{ @"opacity": @[@1] }),
                                    withKey(link, @"output", @{}), withKey(link, @"output", @[@1, @0]), withKey(link, @"axis", @"z"), withKey(link, @"clamp", NSNull.null)]) {
      Outcome *outcome = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion link:request resolve:resolve reject:reject]; });
      CHECK([outcome->code isEqual:@"E_INVALID_ARGUMENT"]);
    }
    Outcome *noScroller = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion link:link resolve:resolve reject:reject]; });
    CHECK([noScroller->code isEqual:@"E_NOT_FOUND"]);

    // A scroll link maps the clip view's offset onto the model on the main thread, owns its properties until unlinked.
    NativeIDView *source = [[NativeIDView alloc] initWithFrame:NSMakeRect(0, 0, 100, 100)];
    source.nativeId = @"scroller";
    NSScrollView *scroller = [[NSScrollView alloc] initWithFrame:source.bounds];
    scroller.documentView = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 100, 1000)];
    [source addSubview:scroller];
    [window.contentView addSubview:source];
    Outcome *linked = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion link:link resolve:resolve reject:reject]; });
    CHECK(linked->resolved && host.motionModel[Opacity] == 1);
    [scroller.contentView scrollToPoint:NSMakePoint(0, 50)];
    CHECK(std::abs(host.motionModel[Opacity] - 0.5) < 1e-9);
    [scroller.contentView scrollToPoint:NSMakePoint(0, 400)];
    CHECK(host.motionModel[Opacity] == 0);  // clamped beyond the last stop
    Outcome *busy = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"busy", 7, @{ @"opacity": Timing(1, 100) }) resolve:resolve reject:reject]; });
    CHECK([busy->code isEqual:@"E_BUSY"]);
    Outcome *again = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion link:withKey(link, @"id", @"l2") resolve:resolve reject:reject]; });
    CHECK([again->code isEqual:@"E_BUSY"]);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion unlink:@"l" resolve:resolve reject:reject]; });
    [scroller.contentView scrollToPoint:NSMakePoint(0, 50)];
    CHECK(host.motionModel[Opacity] == 0);  // unlinked: scrolling no longer drives it
    Outcome *reset = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion set:@{ @"tag": @7, @"values": @{ @"opacity": @0.5 } } resolve:resolve reject:reject]; });
    CHECK(reset->resolved && host.motionModel[Opacity] == 0.5);
    Outcome *badRecord = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion recordFrames:@{ @"tag": @7, @"durationMs": @0 } resolve:resolve reject:reject]; });
    CHECK([badRecord->code isEqual:@"E_INVALID_ARGUMENT"]);
    // The window is never shown (as in driver mode): frames are recorded on the screen's display link.
    Outcome *recorded = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion recordFrames:@{ @"tag": @7, @"durationMs": @150 } resolve:resolve reject:reject]; });
    const CFTimeInterval recording = CACurrentMediaTime();
    while (!recorded->code && !recorded->resolved && CACurrentMediaTime() - recording < 3) [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
    CHECK(recorded->resolved && [JSON(recorded->value)[@"frames"] intValue] >= 5 && [JSON(recorded->value)[@"refreshRate"] intValue] >= 30);
    Outcome *realAdvance = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:16 resolve:resolve reject:reject]; });
    CHECK([realAdvance->code isEqual:@"E_UNAVAILABLE"]);

    // Virtual clock: layers pause; advancing moves layer time and the engine together.
    Outcome *clock = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion setClock:@"virtual" resolve:resolve reject:reject]; });
    CHECK(clock->resolved && host.layer.speed == 0);
    const CFTimeInterval paused = host.layer.timeOffset;
    Outcome *slide = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"slide", 7, @{ @"translateX": Timing(100, 200), @"opacity": Timing(1, 200) }) resolve:resolve reject:reject]; });
    CHECK(!slide->resolved && !slide->code);
    CHECK([host.layer animationForKey:@"spark.motion.transform"] && [host.layer animationForKey:@"spark.motion.opacity"]);
    CHECK(host.motionModel[TranslateX] == 100 && host.motionModel[Opacity] == 1);  // the model holds the final value
    Outcome *step = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:100 resolve:resolve reject:reject]; });
    CHECK(step->resolved && std::abs(host.layer.timeOffset - paused - 0.1) < 1e-9);
    Outcome *state = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion state:7 resolve:resolve reject:reject]; });
    NSDictionary *snapshot = JSON(state->value);
    CHECK(std::abs([snapshot[@"values"][@"translateX"] doubleValue] - 50) < 1e-6 && std::abs([snapshot[@"velocities"][@"translateX"] doubleValue] - 500) < 1e-6);
    CHECK([snapshot[@"animating"] containsObject:@"translateX"] && !slide->resolved);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:100 resolve:resolve reject:reject]; });
    CHECK(slide->resolved && [JSON(slide->value)[@"finished"] isEqual:@YES]);

    // Interruption resolves the replaced animation unfinished; ids are released for reuse.
    Outcome *first = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"again", 7, @{ @"translateX": Timing(0, 400) }) resolve:resolve reject:reject]; });
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:50 resolve:resolve reject:reject]; });
    Outcome *second = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"empty", 7, @{ @"translateX": @{ @"type": @"spring", @"to": @20, @"mass": @1, @"stiffness": @300, @"damping": @30 } }) resolve:resolve reject:reject]; });
    CHECK(first->resolved && [JSON(first->value)[@"finished"] isEqual:@NO] && !second->code);
    Outcome *stopped = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion stopAnimation:@"empty" resolve:resolve reject:reject]; });
    CHECK(stopped->resolved && second->resolved && [JSON(second->value)[@"finished"] isEqual:@NO]);

    // Telemetry: the driver waits for motion after its last input, advances the virtual clock exactly to progress
    // points, samples the motion's history and renders presented values.
    NSView *child = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 5, 5)];
    [host addSubview:child];
    CHECK([motion hostForView:child] == host && [motion hostForView:window.contentView] == nil);
    [motion noteInput];
    Outcome *none = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion waitForMotion:7 until:@{ @"progress": @0.5 } timeout:0.05 resolve:resolve reject:reject]; });
    while (!none->code && !none->resolved) [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
    CHECK([none->code isEqual:@"E_TIMEOUT"]);  // the earlier motions started before the input
    Outcome *badUntil = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion waitForMotion:7 until:@{ @"progress": @0.5, @"settled": @YES } timeout:0 resolve:resolve reject:reject]; });
    CHECK([badUntil->code isEqual:@"E_INVALID_ARGUMENT"]);
    Outcome *glide = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"glide", 7, @{ @"translateX": Timing(200, 400) }) resolve:resolve reject:reject]; });
    NSDictionary *started = JSON0(Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion telemetry:7 resolve:resolve reject:reject]; })->value);
    const double startMs = [started[@"motion"][@"startMs"] doubleValue], from = [started[@"motion"][@"startValues"][@"translateX"] doubleValue];
    auto at = [from](double fraction) { return from + (200 - from) * fraction; };
    CHECK([started[@"motion"][@"progress"] isEqual:@0] && [started[@"motion"][@"afterInput"] isEqual:@YES] && [started[@"motion"][@"kinds"][@"translateX"] isEqual:@"timing"]);
    CHECK(std::abs([started[@"motion"][@"endMs"] doubleValue] - startMs - 400) < 1e-6 && [started[@"animating"] isEqual:@[@"translateX"]]);
    Outcome *quarter = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion waitForMotion:7 until:@{ @"progress": @0.25 } timeout:1 resolve:resolve reject:reject]; });
    CHECK(quarter->resolved && std::abs([JSON0(quarter->value)[@"timeMs"] doubleValue] - startMs - 100) < 1e-6);
    CHECK(std::abs([JSON0(quarter->value)[@"values"][@"translateX"] doubleValue] - at(0.25)) < 1e-6);  // linear
    // A capture renders the presented value, not the model (the final value), then restores the model.
    __block CGFloat rendered = 0;
    [motion presenting:^{ rendered = host.layer.transform.m41; }];
    CHECK(std::abs(rendered - at(0.25)) < 1e-6 && host.motionModel[TranslateX] == 200 && host.layer.transform.m41 == 200);
    Outcome *passed = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion waitForMotion:7 until:@{ @"progress": @0.1 } timeout:1 resolve:resolve reject:reject]; });
    CHECK([passed->code isEqual:@"E_PASSED"]);
    Outcome *done = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion waitForMotion:7 until:@{ @"settled": @YES } timeout:1 resolve:resolve reject:reject]; });
    CHECK(done->resolved && [JSON0(done->value)[@"motion"][@"settled"] isEqual:@YES] && glide->resolved);
    Outcome *sampled = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion sample:7 request:@{ @"intervalMs": @100 } resolve:resolve reject:reject]; });
    NSArray *samples = JSON0(sampled->value)[@"samples"];
    CHECK(samples.count == 5 && std::abs([samples[2][@"values"][@"translateX"] doubleValue] - at(0.5)) < 1e-6 && std::abs([samples[2][@"velocities"][@"translateX"] doubleValue] - (200 - from) / 0.4) < 1e-6);
    CHECK([samples[4][@"values"][@"translateX"] isEqual:@200]);
    Outcome *future = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion sample:7 request:@{ @"toMs": @(startMs + 1e6) } resolve:resolve reject:reject]; });
    CHECK([future->code isEqual:@"E_INVALID_ARGUMENT"]);

    // Returning to real time resumes layers and re-bakes from the shifted schedule.
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion setClock:@"real" resolve:resolve reject:reject]; });
    CHECK(host.layer.speed == 1 && host.layer.timeOffset == 0);
    // On the real clock the wait follows wall time; the reply reports where the motion was when it resolved.
    [motion noteInput];
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"real", 7, @{ @"opacity": Timing(0.2, 300) }) resolve:resolve reject:reject]; });
    Outcome *half = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion waitForMotion:7 until:@{ @"progress": @0.5 } timeout:2 resolve:resolve reject:reject]; });
    while (!half->code && !half->resolved) [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.005]];
    const double reached = [JSON0(half->value)[@"motion"][@"progress"] doubleValue];
    CHECK(half->resolved && reached >= 0.5 && reached < 0.9);
    Outcome *rest = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion waitForMotion:7 until:@{ @"settled": @YES } timeout:2 resolve:resolve reject:reject]; });
    while (!rest->code && !rest->resolved) [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.005]];
    CHECK(rest->resolved && [JSON0(rest->value)[@"motion"][@"settled"] isEqual:@YES] && std::abs([JSON0(rest->value)[@"values"][@"opacity"] doubleValue] - 0.2) < 1e-9);
    Outcome *bounds = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion setClock:@"slow" resolve:resolve reject:reject]; });
    CHECK([bounds->code isEqual:@"E_INVALID_ARGUMENT"]);

    // Unmounting settles in-flight animations unfinished.
    Outcome *orphan = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"orphan", 7, @{ @"opacity": Timing(0, 5000) }) resolve:resolve reject:reject]; });
    [motion unregisterTag:7];
    CHECK(orphan->resolved && [JSON(orphan->value)[@"finished"] isEqual:@NO]);
  }
  if (failures) { std::printf("%d motion coordinator checks failed\n", failures); return 1; }
  std::puts("Motion coordinator tests passed");
}
