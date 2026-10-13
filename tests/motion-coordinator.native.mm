// Drives the real macOS motion coordinator without React Native: malformed requests must reject
// (never raise), plans bake onto the host layer, the virtual clock pauses and advances layer time,
// and completions resolve exactly once. Compiled and run by tests/motion-native.test.ts.
#import <AppKit/AppKit.h>
#import <Metal/Metal.h>
#import <QuartzCore/QuartzCore.h>
#import "SparkMotionCoordinator.h"
#include <cstdio>
#include <vector>
using namespace spark::motion;

static int failures = 0;
#define CHECK(condition) do { if (!(condition)) { std::printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #condition); failures++; } } while (0)

@interface TestHost : NSView <SparkMotionHost>
@property (nonatomic) NSInteger motionTag;
@property (nonatomic) Values motionModel;
@property (nonatomic, strong) NSString *motionLayout;
@property (nonatomic, strong) NSString *motionSharedId;
@property (nonatomic, strong) NSDictionary *motionTransition;
@property (nonatomic) BOOL motionRightToLeft;
@property (nonatomic) uint32_t motionOwnedChannels;
@property (nonatomic) uint32_t motionStyleChannels;
@end
@implementation TestHost
- (void)applyMotionModel:(const Values &)values
{
  _motionModel = values;
  self.layer.transform = SparkMotionTransform(values);
  SparkMotionApplyLayer(self, values);
}
@end

/** A MotionMaterial: a host with a backdrop material stack. */
@interface MaterialHost : TestHost
@property (nonatomic, strong) SparkMotionMaterialStack *motionMaterial;
@property (nonatomic, strong) NSDictionary *motionCrossfade;
@end
@implementation MaterialHost
@synthesize motionMaterial = _motionMaterial, motionCrossfade = _motionCrossfade;
@end

/** A MotionShape: a host with a shape layer view. */
@interface ShapeHost : TestHost
@property (nonatomic, strong) SparkMotionShapeView *motionShape;
@end
@implementation ShapeHost
@synthesize motionShape = _motionShape;
@end

/** A MotionShader or a MotionEmitter: a host with a built-in effect or particles. */
@interface EffectHost : TestHost
@property (nonatomic, strong) SparkMotionShader *motionShader;
@property (nonatomic, strong) SparkMotionEmitter *motionEmitter;
@end
@implementation EffectHost
@synthesize motionShader = _motionShader, motionEmitter = _motionEmitter;
@end

/**
 * What Core Animation itself draws for `view`'s layer tree now (filters, Metal layers and paused layer time included), as
 * BGRA pixels, rendered in-process with CARenderer; empty without a Metal device. The view must have no window.
 */
static std::vector<uint8_t> Render(NSView *view)
{
  id<MTLDevice> device = MTLCreateSystemDefaultDevice();
  if (!device) return {};
  const NSUInteger width = (NSUInteger)NSWidth(view.bounds), height = (NSUInteger)NSHeight(view.bounds);
  MTLTextureDescriptor *descriptor = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm width:width height:height mipmapped:NO];
  descriptor.usage = MTLTextureUsageRenderTarget | MTLTextureUsageShaderRead;
  descriptor.storageMode = MTLStorageModeShared;
  id<MTLTexture> texture = [device newTextureWithDescriptor:descriptor];
  id<MTLCommandQueue> queue = [device newCommandQueue];
  CARenderer *renderer = [CARenderer rendererWithMTLTexture:texture options:@{ kCARendererMetalCommandQueue: queue }];
  // A root of its own: the view's layer keeps its timing (paused by the virtual clock) inside it.
  CALayer *layer = view.layer, *root = [CALayer layer];
  const CGPoint position = layer.position;
  root.frame = CGRectMake(0, 0, width, height);
  renderer.layer = root;
  renderer.bounds = root.frame;
  // The renderer draws what transactions commit after it takes the layer.
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  [root addSublayer:layer];
  layer.position = CGPointMake(width * layer.anchorPoint.x, height * layer.anchorPoint.y);  // AppKit anchors layers at their corner
  [CATransaction commit];
  [CATransaction flush];
  [renderer beginFrameAtTime:CACurrentMediaTime() timeStamp:NULL];
  [renderer addUpdateRect:renderer.bounds];
  [renderer render];
  [renderer endFrame];
  id<MTLCommandBuffer> done = [queue commandBuffer];
  [done commit];
  [done waitUntilCompleted];
  std::vector<uint8_t> pixels(width * height * 4);
  [texture getBytes:pixels.data() bytesPerRow:width * 4 fromRegion:MTLRegionMake2D(0, 0, width, height) mipmapLevel:0];
  renderer.layer = nil;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  [layer removeFromSuperlayer];
  layer.position = position;
  [CATransaction commit];
  return pixels;
}
/** Pixels that differ between two renders by more than a rounding step. */
static size_t Changed(const std::vector<uint8_t> &a, const std::vector<uint8_t> &b)
{
  size_t changed = 0;
  for (size_t i = 0; i + 3 < std::min(a.size(), b.size()); i += 4)
    if (std::abs(a[i] - b[i]) + std::abs(a[i + 1] - b[i + 1]) + std::abs(a[i + 2] - b[i + 2]) + std::abs(a[i + 3] - b[i + 3]) > 12) changed++;
  return changed;
}
/** Black and white stripes 8 points apart, for distortions to bend. */
static void Stripes(NSView *view)
{
  for (CGFloat x = 0; x < NSWidth(view.bounds); x += 8) {
    CALayer *stripe = [CALayer layer];
    stripe.frame = CGRectMake(x, 0, 4, NSHeight(view.bounds));
    stripe.backgroundColor = CGColorGetConstantColor(kCGColorBlack);
    [view.layer addSublayer:stripe];
  }
  view.layer.backgroundColor = CGColorGetConstantColor(kCGColorWhite);
}

@interface TestSymbol : NSView <SparkMotionSymbolHost>
@property (nonatomic) NSInteger motionTag;
@property (nonatomic, strong) NSImageView *symbolImageView;
@end
@implementation TestSymbol @end

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
    // A driver run follows only simulated system state: the Mac's Reduce Motion, Low Power Mode, display and occlusion
    // observers are not installed (only window close is), and the pinned values hold whatever the Mac reports.
    CHECK([[motion valueForKey:@"observers"] count] == 1 && ![motion valueForKey:@"accessibilityObserver"]);
    CHECK([JSON(Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion environment:7 resolve:resolve reject:reject]; })->value)
      isEqual:(@{ @"reduceMotion": @NO, @"reduceTransparency": @NO, @"lowPowerMode": @NO, @"maximumFrameRate": @60, @"frameRate": @60, @"windowVisible": @YES })]);

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
    // The frame timeline's compositor track names animating views by testID, else by tag.
    CHECK([[motion animatingViews] isEqual:@[@"MotionView 7"]]);
    host.accessibilityIdentifier = @"slider";
    CHECK([[motion animatingViews] isEqual:@[@"slider"]]);
    host.accessibilityIdentifier = nil;
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:100 resolve:resolve reject:reject]; });
    CHECK(slide->resolved && [JSON(slide->value)[@"finished"] isEqual:@YES]);
    CHECK([motion animatingViews].count == 0);

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
    // Only the lower bound: a loaded machine can run the 2 ms check late, so the reply can come well past the point.
    CHECK(half->resolved && reached >= 0.5 && reached <= 1);
    Outcome *rest = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion waitForMotion:7 until:@{ @"settled": @YES } timeout:2 resolve:resolve reject:reject]; });
    while (!rest->code && !rest->resolved) [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.005]];
    CHECK(rest->resolved && [JSON0(rest->value)[@"motion"][@"settled"] isEqual:@YES] && std::abs([JSON0(rest->value)[@"values"][@"opacity"] doubleValue] - 0.2) < 1e-9);
    Outcome *bounds = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion setClock:@"slow" resolve:resolve reject:reject]; });
    CHECK([bounds->code isEqual:@"E_INVALID_ARGUMENT"]);

    // Layout and shared-element hand-offs, on the virtual clock. The content view is not flipped (y up); boxes are compared top-left.
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion setClock:@"virtual" resolve:resolve reject:reject]; });
    NSDictionary *smooth = @{ @"type": @"spring", @"mass": @1, @"stiffness": @157.91367041742973, @"damping": @25.132741228718345 };
    auto mounted = [&](NSInteger tag, NSRect frame, NSString *layout, NSString *sharedId) {
      TestHost *view = [[TestHost alloc] initWithFrame:frame];
      view.wantsLayer = YES;
      view.motionTag = tag;
      view.motionLayout = layout;
      view.motionSharedId = sharedId;
      view.motionTransition = smooth;
      [window.contentView addSubview:view];
      [motion registerHost:view initial:kIdentity];
      [motion hostDidMount:view surface:1 transaction:tag];  // its own mounting transaction: nothing to hand off
      return view;
    };
    auto value = [&](NSInteger tag, NSString *property) {
      return [JSON(Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion state:tag resolve:resolve reject:reject]; })->value)[@"values"][property] doubleValue];
    };
    auto relayout = [&](TestHost *view, NSRect frame, NSInteger transaction) {
      [motion hostWillMount:view surface:1 transaction:transaction];
      view.frame = frame;
      [motion hostDidMount:view surface:1 transaction:transaction];
    };
    TestHost *row = mounted(20, NSMakeRect(0, 0, 50, 20), @"position", nil);
    CHECK(value(20, @"translateY") == 0 && !row.layer.animationKeys.count);
    relayout(row, NSMakeRect(0, 30, 50, 20), 100);  // 30 pt up: it starts 30 pt below, where it was
    CHECK(std::abs(value(20, @"translateY") - 30) < 1e-9 && value(20, @"translateX") == 0 && [row.layer animationForKey:@"spark.motion.transform"]);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:100 resolve:resolve reject:reject]; });
    const double partway = value(20, @"translateY");
    CHECK(partway > 0 && partway < 30);
    // Moving again mid-flight carries on from where it shows.
    relayout(row, NSMakeRect(0, 0, 50, 20), 101);
    CHECK(std::abs(value(20, @"translateY") - (partway - 30)) < 1e-9);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:3000 resolve:resolve reject:reject]; });
    CHECK(std::abs(value(20, @"translateY")) < 0.01);
    // A transaction that does not match the mark, or no layout change, hands off nothing.
    [motion hostWillMount:row surface:1 transaction:102];
    row.frame = NSMakeRect(0, 40, 50, 20);
    [motion hostDidMount:row surface:1 transaction:103];
    relayout(row, row.frame, 104);
    CHECK(value(20, @"translateY") == 0);
    // `frame` keeps the centre and scales from the previous size; `position` in right-to-left keeps the top-right corner.
    TestHost *card = mounted(21, NSMakeRect(100, 0, 40, 40), @"frame", nil);
    relayout(card, NSMakeRect(100, 0, 80, 40), 105);
    CHECK(std::abs(value(21, @"translateX") + 20) < 1e-9 && std::abs(value(21, @"scaleX") - 0.5) < 1e-9 && value(21, @"scaleY") == 1);
    TestHost *rtl = mounted(22, NSMakeRect(0, 60, 50, 20), @"position", nil);
    rtl.motionRightToLeft = YES;
    relayout(rtl, NSMakeRect(0, 60, 30, 20), 106);
    CHECK(std::abs(value(22, @"translateX") - 20) < 1e-9);
    // A shared element mounting in the transaction that removes its source starts at the source's box and velocity.
    TestHost *thumb = mounted(30, NSMakeRect(10, 10, 20, 20), nil, @"photo");
    [motion hostWillMount:thumb surface:1 transaction:107];
    [thumb removeFromSuperview];
    [motion unregisterTag:30];
    TestHost *detail = [[TestHost alloc] initWithFrame:NSMakeRect(100, 50, 80, 40)];
    detail.wantsLayer = YES;
    detail.motionTag = 31;
    detail.motionSharedId = @"photo";
    detail.motionTransition = smooth;
    [window.contentView addSubview:detail];
    [motion registerHost:detail initial:kIdentity];
    [motion hostDidMount:detail surface:1 transaction:107];
    CHECK(std::abs(value(31, @"translateX") + 120) < 1e-9 && std::abs(value(31, @"translateY") - 50) < 1e-9);
    CHECK(std::abs(value(31, @"scaleX") - 0.25) < 1e-9 && std::abs(value(31, @"scaleY") - 0.5) < 1e-9);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:3000 resolve:resolve reject:reject]; });
    CHECK(std::abs(value(31, @"translateX")) < 0.01 && std::abs(value(31, @"scaleX") - 1) < 0.001);
    // One that mounts in a later transaction has no source.
    TestHost *late2 = mounted(32, NSMakeRect(0, 0, 10, 10), nil, @"photo");
    CHECK(value(32, @"translateX") == 0);
    // Shared marks keep only the latest transaction's: each distinct id does not stay behind.
    NSDictionary *marks = [motion valueForKey:@"sharedMarks"];
    CHECK(marks.count == 1 && marks[@"photo"]);
    late2.motionSharedId = @"other";
    [motion hostWillMount:late2 surface:1 transaction:108];
    [motion hostDidMount:late2 surface:1 transaction:108];
    marks = [motion valueForKey:@"sharedMarks"];
    CHECK(marks.count == 1 && marks[@"other"] && !marks[@"photo"]);
    // Under Reduce Motion a layout hand-off plays the alternate: the row is at its new place at once and fades in there.
    [motion simulate:@{ @"reduceMotion": @YES }];
    relayout(row, NSMakeRect(0, 0, 50, 20), 109);
    CHECK(value(20, @"translateY") == 0 && value(20, @"opacity") == 0 && [row.layer animationForKey:@"spark.motion.opacity"]);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:200 resolve:resolve reject:reject]; });
    CHECK(value(20, @"opacity") == 1);
    [motion simulate:@{ @"reduceMotion": @NO }];
    // In a hidden window the hand-off completes at once: nothing animates there.
    [motion simulateWindow:window visible:NO];
    relayout(row, NSMakeRect(0, 40, 50, 20), 110);
    CHECK(value(20, @"translateY") == 0 && row.layer.animationKeys.count == 0);
    [motion simulateWindow:window visible:YES];
    for (NSInteger tag : {20, 21, 22, 31, 32}) [motion unregisterTag:tag];
    (void)late2;
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion setClock:@"real" resolve:resolve reject:reject]; });

    // Unmounting settles in-flight animations unfinished.
    Outcome *orphan = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"orphan", 7, @{ @"opacity": Timing(0, 5000) }) resolve:resolve reject:reject]; });
    [motion unregisterTag:7];
    CHECK(orphan->resolved && [JSON(orphan->value)[@"finished"] isEqual:@NO]);

    // Accessibility, power and lifecycle (docs/motion.md#reduce-motion and the sections after it), on the virtual clock.
    // Reduce Motion, Low Power Mode and the display's rate are simulated: the Mac's settings are untouched.
    TestHost *lifecycleCard = [[TestHost alloc] initWithFrame:NSMakeRect(0, 0, 40, 40)];
    lifecycleCard.wantsLayer = YES;
    lifecycleCard.motionTag = 9;
    NSWindow *other = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 200, 100) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
    other.releasedWhenClosed = NO;
    [other.contentView addSubview:lifecycleCard];
    [motion registerHost:lifecycleCard initial:kIdentity];
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion setClock:@"virtual" resolve:resolve reject:reject]; });
    auto environment = [&](NSInteger tag) { return JSON(Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion environment:tag resolve:resolve reject:reject]; })->value); };
    [motion simulate:@{ @"reduceMotion": @NO, @"lowPowerMode": @NO, @"maximumFramesPerSecond": @120 }];
    NSDictionary *promotion = environment(9);
    CHECK([promotion[@"frameRate"] isEqual:@120] && [promotion[@"maximumFrameRate"] isEqual:@120] && [promotion[@"windowVisible"] isEqual:@YES] && [promotion[@"reduceMotion"] isEqual:@NO]);
    CHECK([environment(0)[@"windowVisible"] isEqual:NSNull.null]);
    Outcome *unmounted = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion environment:77 resolve:resolve reject:reject]; });
    while (!unmounted->code && !unmounted->resolved) [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
    CHECK([unmounted->code isEqual:@"E_NOT_FOUND"]);  // after the bounded wait for a mount
    // 120 Hz on ProMotion: one sample per 1/120 s and a 120 Hz compositor request; 60 Hz displays and Low Power Mode cap it.
    Outcome *fast = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"fast", 9, @{ @"translateX": Timing(50, 500) }) resolve:resolve reject:reject]; });
    CAKeyframeAnimation *baked = (CAKeyframeAnimation *)[lifecycleCard.layer animationForKey:@"spark.motion.transform"];
    CHECK(baked.values.count == 61 && baked.preferredFrameRateRange.preferred == 120 && baked.preferredFrameRateRange.maximum == 120);
    [motion simulate:@{ @"lowPowerMode": @YES }];  // re-bakes the running animation at 60 Hz, from now, with the same end
    baked = (CAKeyframeAnimation *)[lifecycleCard.layer animationForKey:@"spark.motion.transform"];
    CHECK(baked.values.count == 31 && baked.preferredFrameRateRange.preferred == 60 && std::abs(baked.duration - 0.5) < 1e-9);
    CHECK([environment(9)[@"frameRate"] isEqual:@60] && [environment(9)[@"lowPowerMode"] isEqual:@YES]);
    [motion simulate:@{ @"lowPowerMode": @NO, @"maximumFramesPerSecond": @60 }];
    CHECK([environment(9)[@"frameRate"] isEqual:@60] && ((CAKeyframeAnimation *)[lifecycleCard.layer animationForKey:@"spark.motion.transform"]).values.count == 31);
    CHECK([JSON0(Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion telemetry:9 resolve:resolve reject:reject]; })->value)[@"frameRate"] isEqual:@60]);
    // null (simulateDisplays' restore) returns to the driver's 60 Hz, never the real display's rate.
    [motion simulate:@{ @"maximumFramesPerSecond": @120 }];
    [motion simulate:@{ @"maximumFramesPerSecond": NSNull.null }];
    CHECK([environment(9)[@"maximumFrameRate"] isEqual:@60]);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:500 resolve:resolve reject:reject]; });
    CHECK(fast->resolved && [JSON(fast->value)[@"finished"] isEqual:@YES]);

    // Reduce Motion: the slide becomes a jump plus a 200 ms fade-in at the destination; cues follow the alternate.
    [motion simulate:@{ @"reduceMotion": @YES }];
    CHECK([environment(9)[@"reduceMotion"] isEqual:@YES]);
    [motion noteInput];
    NSDictionary *spring = @{ @"type": @"spring", @"to": @0, @"mass": @1, @"stiffness": @157.9, @"damping": @10.4 };
    NSMutableDictionary *cued = [Request(@"reduced", 9, @{ @"translateX": spring }) mutableCopy];
    cued[@"cues"] = @[@{ @"at": @0, @"haptic": @"alignment" }, @{ @"at": @"end", @"haptic": @"levelChange", @"sound": @"Tink" }];
    Outcome *reduced = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:cued resolve:resolve reject:reject]; });
    CHECK(!reduced->code && lifecycleCard.motionModel[TranslateX] == 0 && lifecycleCard.motionModel[Opacity] == 1);
    NSDictionary *fading = JSON0(Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion telemetry:9 resolve:resolve reject:reject]; })->value);
    CHECK([fading[@"motion"][@"kinds"][@"translateX"] isEqual:@"jump"] && [fading[@"motion"][@"kinds"][@"opacity"] isEqual:@"timing"]);
    CHECK([fading[@"values"][@"opacity"] doubleValue] == 0 && [fading[@"values"][@"translateX"] doubleValue] == 0);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:200 resolve:resolve reject:reject]; });
    CHECK(reduced->resolved && [JSON(reduced->value)[@"finished"] isEqual:@YES]);
    NSArray *cues = JSON0(Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion telemetry:9 resolve:resolve reject:reject]; })->value)[@"cues"];
    // In a driver run cues are recorded instead of played, each at the frame that shows its time.
    CHECK(cues.count == 2 && [cues[0][@"haptic"] isEqual:@"alignment"] && [cues[1][@"sound"] isEqual:@"Tink"] && [cues[1][@"at"] isEqual:@"end"]);
    CHECK([cues[1][@"played"] isEqual:@NO] && std::abs([cues[1][@"frameMs"] doubleValue] - [cues[0][@"frameMs"] doubleValue] - 200) < 1e-6);
    [motion simulate:@{ @"reduceMotion": @NO }];
    for (NSArray *bad in @[@[@{ @"at": @0, @"sound": @"No Such Sound Spark" }], @[@{ @"at": @0, @"haptic": @"thud" }], @[@{ @"at": @0 }], @[@{ @"at": @9000, @"haptic": @"generic" }], @[@{ @"at": @-1, @"haptic": @"generic" }]]) {
      NSMutableDictionary *request = [Request(@"bad cue", 9, @{ @"opacity": Timing(0.5, 100) }) mutableCopy];
      request[@"cues"] = bad;
      Outcome *outcome = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:request resolve:resolve reject:reject]; });
      CHECK([outcome->code isEqual:bad == nil ? @"" : [bad[0][@"sound"] length] ? @"E_NOT_FOUND" : @"E_INVALID_ARGUMENT"]);
    }
    NSMutableDictionary *badMode = [Request(@"bad mode", 9, @{ @"opacity": Timing(0.5, 100) }) mutableCopy];
    badMode[@"reducedMotion"] = @"slow";
    CHECK([Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:badMode resolve:resolve reject:reject]; })->code isEqual:@"E_INVALID_ARGUMENT"]);

    // A hidden window: the finite animation jumps to its end and finishes, the loop pauses; shown again, it resumes.
    NSMutableDictionary *spinPlan = [Request(@"spin", 9, @{ @"rotate": @{ @"type": @"timing", @"to": @360, @"durationMs": @1000, @"easing": @[@0, @0, @1, @1], @"repeat": @"infinite" } }) mutableCopy];
    spinPlan[@"cues"] = @[@{ @"at": @750, @"haptic": @"generic" }];
    auto telemetry = [&](NSInteger tag) { return JSON0(Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion telemetry:tag resolve:resolve reject:reject]; })->value); };
    const double spinStart = [telemetry(9)[@"timeMs"] doubleValue];
    Outcome *spin = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:spinPlan resolve:resolve reject:reject]; });
    Outcome *slideAway = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"away", 9, @{ @"translateX": Timing(80, 1000) }) resolve:resolve reject:reject]; });
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:250 resolve:resolve reject:reject]; });
    [motion simulateWindow:other visible:NO];
    CHECK(slideAway->resolved && [JSON(slideAway->value)[@"finished"] isEqual:@YES] && lifecycleCard.motionModel[TranslateX] == 80 && !spin->resolved);
    CHECK([environment(9)[@"windowVisible"] isEqual:@NO] && lifecycleCard.layer.animationKeys.count == 0 && std::abs(lifecycleCard.motionModel[Rotate] - 90) < 1e-6);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:1000 resolve:resolve reject:reject]; });
    // An operation on the hidden view resumes it while it runs: its cue moves with the loop's tracks, not only at show.
    CHECK(!Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion set:@{ @"tag": @9, @"values": @{ @"translateY": @5 } } resolve:resolve reject:reject]; })->code);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:1000 resolve:resolve reject:reject]; });
    NSDictionary *frozen = JSON0(Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion telemetry:9 resolve:resolve reject:reject]; })->value);
    CHECK([frozen[@"paused"] isEqual:@YES] && [frozen[@"hidden"] isEqual:@YES] && std::abs([frozen[@"values"][@"rotate"] doubleValue] - 90) < 1e-6);
    CHECK([[frozen[@"cues"] lastObject][@"frameMs"] isEqual:NSNull.null]);  // the cue at 750 ms waits for the paused loop
    [motion simulateWindow:other visible:YES];
    CHECK([lifecycleCard.layer animationForKey:@"spark.motion.transform.loop"] != nil);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:500 resolve:resolve reject:reject]; });
    NSDictionary *resumed = JSON0(Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion telemetry:9 resolve:resolve reject:reject]; })->value);
    CHECK([resumed[@"paused"] isEqual:@NO] && std::abs([resumed[@"values"][@"rotate"] doubleValue] - 270) < 1e-6 && [[resumed[@"cues"] lastObject][@"frameMs"] isKindOfClass:NSNumber.class]);
    // It played 750 ms of loop time after the start, plus the 2 s the window was hidden.
    CHECK(std::abs([[resumed[@"cues"] lastObject][@"frameMs"] doubleValue] - (spinStart + 750 + 2000)) < 1e-6);
    // Pause instead of completing: the plan's whenHidden.
    NSMutableDictionary *held = [Request(@"held", 9, @{ @"opacity": Timing(0, 1000) }) mutableCopy];
    held[@"whenHidden"] = @"pause";
    Outcome *holding = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:held resolve:resolve reject:reject]; });
    [motion simulateWindow:other visible:NO];
    CHECK(!holding->resolved && std::abs(lifecycleCard.motionModel[Opacity] - 1) < 1e-9);

    // Closing the window cancels its motion: the loop and the held fade stop where they are, finished false.
    [other close];
    CHECK(spin->resolved && [JSON(spin->value)[@"finished"] isEqual:@NO] && holding->resolved && [JSON(holding->value)[@"finished"] isEqual:@NO]);
    CHECK(lifecycleCard.layer.animationKeys.count == 0);
    [motion unregisterTag:9];
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion setClock:@"real" resolve:resolve reject:reject]; });

    // Visual effects (docs/motion.md#visual-effects), on the virtual clock: each channel bakes onto its own layer key paths,
    // the blur filter and the mask exist while they show something or animate, and the mask's edges follow the direction.
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion setClock:@"virtual" resolve:resolve reject:reject]; });
    TestHost *effects = [[TestHost alloc] initWithFrame:NSMakeRect(0, 0, 100, 40)];
    effects.wantsLayer = YES;
    effects.motionTag = 12;
    [window.contentView addSubview:effects];
    Values start = kIdentity;
    start[BackgroundColorL] = 1; start[BackgroundColorAlpha] = 1; start[BorderRadius] = 4;  // white, rounded
    effects.motionOwnedChannels = SparkMotionChannelBit(Channel::BackgroundColor) | SparkMotionChannelBit(Channel::BorderRadius);  // `initial` sets them
    [motion registerHost:effects initial:start];
    const CGFloat *white = CGColorGetComponents(effects.layer.backgroundColor);
    CHECK(std::abs(white[0] - 1) < 1e-4 && std::abs(white[2] - 1) < 1e-4 && white[3] == 1 && effects.layer.cornerRadius == 4);
    CHECK(effects.layer.filters.count == 0 && effects.layer.mask == nil);
    NSDictionary *lift = @{ @"backgroundColorL": Timing(0.627955, 400), @"backgroundColorC": Timing(0.257683, 400), @"backgroundColorH": Timing(29.2339, 400),
      @"borderRadius": Timing(20, 400), @"shadowOpacity": Timing(0.5, 400), @"shadowRadius": Timing(10, 400), @"shadowOffsetY": Timing(6, 400),
      @"blur": Timing(4, 400), @"rotateY": Timing(180, 400), @"perspective": Timing(500, 400), @"maskInsetEnd": Timing(30, 400), @"maskRadius": Timing(8, 400) };
    Outcome *lifted = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"lift", 12, lift) resolve:resolve reject:reject]; });
    CHECK(!lifted->code);
    for (NSString *key in @[@"spark.motion.backgroundColor", @"spark.motion.cornerRadius", @"spark.motion.shadowOpacity", @"spark.motion.shadowRadius",
                            @"spark.motion.shadowOffset", @"spark.motion.filters.sparkBlur.inputRadius", @"spark.motion.transform"])
      CHECK([effects.layer animationForKey:key] != nil);
    CALayer *mask = effects.layer.mask;
    CHECK(mask && [mask animationForKey:@"spark.motion.bounds"] && [mask animationForKey:@"spark.motion.position"] && [mask animationForKey:@"spark.motion.cornerRadius"]);
    CHECK(effects.layer.filters.count == 1 && [[effects.layer.filters.firstObject name] isEqual:@"sparkBlur"] && effects.layerUsesCoreImageFilters);
    // The model holds the final values: red, round corners, a shadow, the blur, the mask inset from the trailing (right) edge.
    const CGFloat *red = CGColorGetComponents(effects.layer.backgroundColor);
    CHECK(std::abs(red[0] - 1) < 1e-3 && std::abs(red[1]) < 1e-3 && std::abs(red[2]) < 1e-3);
    CHECK(effects.layer.cornerRadius == 20 && std::abs(effects.layer.shadowOpacity - 0.5) < 1e-6 && effects.layer.shadowRadius == 10 && effects.layer.shadowOffset.height == 6);
    CHECK([[effects.layer valueForKeyPath:@"filters.sparkBlur.inputRadius"] doubleValue] == 4);
    CHECK(NSEqualRects(NSRectFromCGRect(mask.frame), [effects convertRectToLayer:NSMakeRect(0, 0, 70, 40)]) && mask.cornerRadius == 8);
    CHECK(std::abs(effects.layer.transform.m11 - -1) < 1e-9 && effects.layer.transform.m34 != 0);  // turned 180° about y, in perspective
    // Halfway, a capture shows the presented color: the OKLCH midpoint of white and red, not their sRGB average.
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:200 resolve:resolve reject:reject]; });
    __block NSArray<NSNumber *> *presentedColor = nil;
    [motion presenting:^{ const CGFloat *c = CGColorGetComponents(effects.layer.backgroundColor); presentedColor = @[@(c[0]), @(c[1]), @(c[2])]; }];
    const double halfway[3] = {presentedColor[0].doubleValue, presentedColor[1].doubleValue, presentedColor[2].doubleValue};
    const Rgba expected = oklchToSrgb((1 + 0.627955) / 2, 0.257683 / 2, 29.2339, 1);
    CHECK(std::abs(halfway[0] - expected.red) < 1e-6 && std::abs(halfway[1] - expected.green) < 1e-6 && std::abs(halfway[2] - expected.blue) < 1e-6);
    CHECK(std::abs(halfway[1] - 0.5) > 0.05);  // an sRGB blend would be (1, 0.5, 0.5)
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:200 resolve:resolve reject:reject]; });
    CHECK(lifted->resolved && [JSON(lifted->value)[@"finished"] isEqual:@YES] && effects.layer.filters.count == 1 && effects.layer.mask == mask);
    // Animating the blur and the mask back to nothing removes them once that settles; while it runs they stay.
    effects.motionRightToLeft = YES;
    Outcome *clear = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) {
      [motion run:Request(@"clear", 12, @{ @"blur": Timing(0, 100), @"maskInsetEnd": Timing(0, 100), @"maskRadius": Timing(0, 100), @"maskInsetStart": Timing(10, 50) }) resolve:resolve reject:reject];
    });
    CHECK(effects.layer.filters.count == 1 && effects.layer.mask == mask);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:50 resolve:resolve reject:reject]; });
    // Right to left, the start edge is the right one.
    [motion presenting:^{
      const NSRect frame = NSRectFromCGRect(effects.layer.mask.frame), expected = [effects convertRectToLayer:NSMakeRect(15, 0, 75, 40)];
      CHECK(std::abs(NSMinX(frame) - NSMinX(expected)) < 1e-6 && std::abs(NSWidth(frame) - NSWidth(expected)) < 1e-6 && NSHeight(frame) == 40);
    }];
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:50 resolve:resolve reject:reject]; });
    CHECK(clear->resolved && effects.layer.filters.count == 0 && !effects.layerUsesCoreImageFilters && effects.layer.mask == mask);  // insetStart 10 still masks
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion set:@{ @"tag": @12, @"values": @{ @"maskInsetStart": @0 } } resolve:resolve reject:reject]; });
    CHECK(effects.layer.mask == nil);
    [motion unregisterTag:12];

    // Backdrop materials (docs/motion.md#backdrop-materials): intensity, tint opacity and the crossfade bake onto the
    // stack's, the tint's and the incoming material's layers; a material change crossfades in over the one showing, which
    // is removed once covered; plain MotionViews reject the material properties.
    NSString *materialError = nil;
    CHECK(SparkMotionMaterialSupported(@"hudWindow") && !SparkMotionMaterialSupported(@"frosted"));
    CHECK(![SparkMotionMaterialStack materialView:@{ @"material": @"frosted" } error:&materialError] && [materialError containsString:@"Unknown material"]);
    NSDictionary *badBlending = @{ @"material": @"sidebar", @"blendingMode": @"over" };
    CHECK(![SparkMotionMaterialStack materialView:badBlending error:&materialError]);
    NSVisualEffectView *sidebar = (NSVisualEffectView *)[SparkMotionMaterialStack materialView:@{ @"material": @"sidebar", @"blendingMode": @"withinWindow", @"state": @"active" } error:&materialError];
    CHECK([sidebar isKindOfClass:NSVisualEffectView.class] && sidebar.material == NSVisualEffectMaterialSidebar && sidebar.blendingMode == NSVisualEffectBlendingModeWithinWindow && sidebar.state == NSVisualEffectStateActive);
    if (SparkMotionMaterialSupported(@"glass")) CHECK([[SparkMotionMaterialStack materialView:@{ @"material": @"glass" } error:&materialError] isKindOfClass:NSClassFromString(@"NSGlassEffectView")]);
    else CHECK(![SparkMotionMaterialStack materialView:@{ @"material": @"glass" } error:&materialError] && [materialError containsString:@"macOS 26"]);
    MaterialHost *panel = [[MaterialHost alloc] initWithFrame:NSMakeRect(0, 0, 100, 40)];
    panel.wantsLayer = YES;
    panel.motionTag = 15;
    panel.motionMaterial = [[SparkMotionMaterialStack alloc] initWithFrame:panel.bounds];
    [panel addSubview:panel.motionMaterial];
    [window.contentView addSubview:panel];
    [motion host:panel crossfadeTo:sidebar];  // before it registers: shown at once
    Values faint = kIdentity;
    faint[MaterialIntensity] = 0.25;
    [motion registerHost:panel initial:faint];
    SparkMotionMaterialStack *stack = panel.motionMaterial;
    CHECK(stack.materialCount == 1 && stack.incomingLayer == sidebar.layer && std::abs(stack.materialsLayer.opacity - 0.25) < 1e-6 && stack.layer.opacity == 1 && stack.tintLayer.opacity == 1 && sidebar.layer.opacity == 1);
    Outcome *intensity = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"intensity", 15, @{ @"materialIntensity": Timing(1, 200), @"materialTintOpacity": Timing(0, 200) }) resolve:resolve reject:reject]; });
    CHECK(!intensity->code && [stack.materialsLayer animationForKey:@"spark.motion.opacity"] && ![stack.layer animationForKey:@"spark.motion.opacity"] && [stack.tintLayer animationForKey:@"spark.motion.opacity"] && ![panel.layer animationForKey:@"spark.motion.opacity"]);
    CHECK(stack.materialsLayer.opacity == 1 && stack.tintLayer.opacity == 0);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:200 resolve:resolve reject:reject]; });
    CHECK(intensity->resolved && [JSON(intensity->value)[@"finished"] isEqual:@YES]);
    // Intensity fades only the material: at intensity 0 the tint still shows, over what is behind the view.
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion set:@{ @"tag": @15, @"values": @{ @"materialIntensity": @0, @"materialTintOpacity": @1 } } resolve:resolve reject:reject]; });
    CHECK(stack.materialsLayer.opacity == 0 && stack.tintLayer.opacity == 1 && stack.layer.opacity == 1);
    NSView *tintView = (NSView *)stack.tintLayer.delegate, *materialsView = (NSView *)stack.materialsLayer.delegate;
    CHECK(tintView.superview == stack && materialsView.superview == stack && [stack.subviews indexOfObject:tintView] > [stack.subviews indexOfObject:materialsView]);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion set:@{ @"tag": @15, @"values": @{ @"materialIntensity": @1, @"materialTintOpacity": @0 } } resolve:resolve reject:reject]; });
    // A crossfade, interrupted halfway by another: the first stays as far as it got under the second until that covers it.
    NSView *hud = [SparkMotionMaterialStack materialView:@{ @"material": @"hudWindow" } error:&materialError];
    panel.motionCrossfade = @{ @"type": @"timing", @"durationMs": @400, @"easing": @[@0, @0, @1, @1] };
    [motion host:panel crossfadeTo:hud];
    CHECK(stack.materialCount == 2 && stack.incomingLayer == hud.layer && [hud.layer animationForKey:@"spark.motion.opacity"] && sidebar.layer.opacity == 1);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:200 resolve:resolve reject:reject]; });
    __block float halfwayCrossfade = 0;
    [motion presenting:^{ halfwayCrossfade = hud.layer.opacity; }];
    CHECK(std::abs(halfwayCrossfade - 0.5) < 1e-6);
    NSView *popover = [SparkMotionMaterialStack materialView:@{ @"material": @"popover" } error:&materialError];
    [motion host:panel crossfadeTo:popover];
    CHECK(stack.materialCount == 3 && std::abs(hud.layer.opacity - 0.5) < 1e-6 && ![hud.layer animationForKey:@"spark.motion.opacity"] && [popover.layer animationForKey:@"spark.motion.opacity"]);
    auto panelTelemetry = [&]() { return JSON0(Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion telemetry:15 resolve:resolve reject:reject]; })->value); };
    NSDictionary *crossfading = panelTelemetry();
    CHECK([crossfading[@"animating"] containsObject:@"materialCrossfade"] && [crossfading[@"values"][@"materialCrossfade"] doubleValue] == 0);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:400 resolve:resolve reject:reject]; });
    CHECK(stack.materialCount == 1 && stack.incomingLayer == popover.layer && popover.superview.superview == stack && !hud.superview && !sidebar.superview);
    // Rapid changes keep at most three materials: the oldest, under the partly faded ones, is dropped.
    NSMutableArray<NSView *> *rapid = [NSMutableArray new];
    for (NSString *name in @[@"sidebar", @"menu", @"sheet", @"toolTip", @"titlebar", @"hudWindow"]) {
      NSView *next = [SparkMotionMaterialStack materialView:@{ @"material": name } error:&materialError];
      [rapid addObject:next];
      [motion host:panel crossfadeTo:next];
      CHECK(stack.materialCount <= kSparkMotionMaterialLimit && stack.incomingLayer == next.layer);
      Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:50 resolve:resolve reject:reject]; });
    }
    CHECK(stack.materialCount == 3 && rapid[3].superview && rapid[4].superview && rapid[5].superview && !rapid[2].superview && !popover.superview);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:400 resolve:resolve reject:reject]; });
    CHECK(stack.materialCount == 1 && stack.incomingLayer == rapid[5].layer);
    // Under Reduce Motion a crossfade is the 200 ms fade, without overshoot.
    [motion simulate:@{ @"reduceMotion": @YES }];
    panel.motionCrossfade = @{ @"type": @"spring", @"mass": @1, @"stiffness": @100, @"damping": @5 };
    [motion host:panel crossfadeTo:[SparkMotionMaterialStack materialView:@{ @"material": @"menu" } error:&materialError]];
    CHECK([panelTelemetry()[@"motion"][@"kinds"][@"materialCrossfade"] isEqual:@"timing"]);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:200 resolve:resolve reject:reject]; });
    CHECK(stack.materialCount == 1);
    [motion simulate:@{ @"reduceMotion": @NO }];
    // Only material changes drive the crossfade; a view without a material has no material properties.
    Outcome *driven = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"crossfade", 15, @{ @"materialCrossfade": Timing(0, 100) }) resolve:resolve reject:reject]; });
    CHECK([driven->code isEqual:@"E_INVALID_ARGUMENT"]);
    TestHost *plain = [[TestHost alloc] initWithFrame:NSMakeRect(0, 0, 40, 40)];
    plain.wantsLayer = YES;
    plain.motionTag = 16;
    [window.contentView addSubview:plain];
    [motion registerHost:plain initial:kIdentity];
    Outcome *unmaterial = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"plain", 16, @{ @"materialIntensity": Timing(0, 100) }) resolve:resolve reject:reject]; });
    CHECK([unmaterial->code isEqual:@"E_UNSUPPORTED_OPTION"]);
    Outcome *unmaterialSet = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion set:@{ @"tag": @16, @"values": @{ @"materialTintOpacity": @0 } } resolve:resolve reject:reject]; });
    CHECK([unmaterialSet->code isEqual:@"E_UNSUPPORTED_OPTION"]);
    // Reduce Transparency is reported (a driver run pins it off until simulated).
    auto transparency = [&]() { return JSON(Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion environment:15 resolve:resolve reject:reject]; })->value)[@"reduceTransparency"]; };
    CHECK([transparency() isEqual:@NO]);
    [motion simulate:@{ @"reduceTransparency": @YES }];
    CHECK([transparency() isEqual:@YES]);
    [motion simulate:@{ @"reduceTransparency": @NO }];
    [motion unregisterTag:15];
    [motion unregisterTag:16];

    // Shapes (docs/motion.md#shapes): the morph bakes whole paths onto the shape layer, which the compositor interpolates
    // point by point; the trim, width and colors bake onto its other key paths; plain MotionViews reject them.
    SparkMotionShapeView *shapeView = [[SparkMotionShapeView alloc] initWithFrame:NSMakeRect(0, 0, 80, 40)];
    NSString *shapeError = nil;
    // A square, and a triangle whose base is halved: the structure JavaScript sends for paths that morph.
    NSArray *squarePath = @[@0, @0, @10, @0, @20, @0, @30, @0, @30, @10, @30, @20, @30, @30, @20, @30, @10, @30, @0, @30, @0, @20, @0, @10, @0, @0];
    NSArray *trianglePath = @[@0, @0, @10, @0, @20, @0, @30, @0, @40, @0, @50, @0, @60, @0, @50, @10, @40, @20, @30, @30, @20, @20, @10, @10, @0, @0];
    NSDictionary *shapeConfig = @{ @"paths": @[squarePath, trianglePath], @"subpaths": @[@[@4, @YES]], @"lineCap": @"round" };
    auto withShapeKey = [](NSDictionary *object, NSString *key, id value) { NSMutableDictionary *copy = [object mutableCopy]; copy[key] = value; return (NSDictionary *)copy; };
    NSMutableArray *tooMany = [NSMutableArray new];
    for (int i = 0; i < 17; i++) [tooMany addObject:squarePath];
    for (NSDictionary *bad in @[withShapeKey(shapeConfig, @"paths", @[squarePath, [trianglePath subarrayWithRange:NSMakeRange(0, 20)]]), withShapeKey(shapeConfig, @"paths", tooMany),
         withShapeKey(shapeConfig, @"subpaths", @[@[@129, @YES]]), withShapeKey(shapeConfig, @"subpaths", @[@[@0, @YES]]), withShapeKey(shapeConfig, @"lineCap", @"pointed"),
         withShapeKey(shapeConfig, @"paths", @[@[@0, @0, @1, @1, @2, @2, @"x", @3]]), withShapeKey(shapeConfig, @"paths", @[])]) {
      CHECK(![shapeView setConfig:bad error:&shapeError] && shapeError.length);
    }
    CHECK(shapeView.pathCount == 0);
    CHECK([shapeView setConfig:shapeConfig error:&shapeError] && shapeView.pathCount == 2 && [shapeView.shapeLayer.lineCap isEqual:kCALineCapRound]);
    // Bounding boxes to a hundredth of a point: curves are evaluated in floating point.
    auto box = [&](CGPathRef path) { const CGRect r = CGPathGetPathBoundingBox(path); auto round = [](CGFloat v) { return std::round(v * 100) / 100; };
      return CGRectMake(round(r.origin.x), round(r.origin.y), round(r.size.width), round(r.size.height)); };
    CGPathRef halfwayPath = [shapeView copyPathAt:0.5], beyond = [shapeView copyPathAt:1.5];
    // Halfway the corners are at (0,0), (30,0), (45,15) and (15,30); past the last path the pair continues (a spring's
    // overshoot): at 1.5 they are at (0,0), (30,0), (75,-15) and (45,30).
    CHECK(CGRectEqualToRect(box(halfwayPath), CGRectMake(0, 0, 45, 30)) && CGRectEqualToRect(box(beyond), CGRectMake(0, -15, 75, 45)));
    // Below 0 the first pair continues backwards: at -0.5 the corners are at (0,0), (30,0), (15,45) and (-15,30).
    CGPathRef before = [shapeView copyPathAt:-0.5];
    CHECK(CGRectEqualToRect(box(before), CGRectMake(-15, 0, 45, 45)));
    CGPathRelease(before);
    CGPathRelease(halfwayPath);
    CGPathRelease(beyond);
    // Three paths: 1.5 is halfway along the interior pair, from the triangle to the square moved 100 points right.
    NSMutableArray *movedSquare = [NSMutableArray new];
    for (NSUInteger i = 0; i < squarePath.count; i++) [movedSquare addObject:@([squarePath[i] doubleValue] + (i % 2 == 0 ? 100 : 0))];
    SparkMotionShapeView *three = [[SparkMotionShapeView alloc] initWithFrame:NSMakeRect(0, 0, 80, 40)];
    CHECK([three setConfig:withShapeKey(shapeConfig, @"paths", @[squarePath, trianglePath, movedSquare]) error:&shapeError] && three.pathCount == 3);
    CGPathRef interior = [three copyPathAt:1.5], last = [three copyPathAt:2];
    CHECK(CGRectEqualToRect(box(interior), CGRectMake(50, 0, 45, 30)) && CGRectEqualToRect(box(last), CGRectMake(100, 0, 30, 30)));
    CGPathRelease(interior);
    CGPathRelease(last);
    CHECK(![three setConfig:withShapeKey(shapeConfig, @"subpaths", @[@[@1e300, @YES]]) error:&shapeError] && three.pathCount == 3);
    ShapeHost *shaped = [[ShapeHost alloc] initWithFrame:NSMakeRect(0, 0, 80, 40)];
    shaped.wantsLayer = YES;
    shaped.motionTag = 18;
    shaped.motionShape = shapeView;
    [shaped addSubview:shapeView];
    [window.contentView addSubview:shaped];
    Values drawn = kIdentity;
    drawn[StrokeEnd] = 0;
    drawn[StrokeColorL] = 0.6; drawn[StrokeColorC] = 0.2; drawn[StrokeColorH] = 250; drawn[StrokeColorAlpha] = 1;
    [motion registerHost:shaped initial:drawn];
    CAShapeLayer *shapeLayer = shapeView.shapeLayer;
    CHECK(CGRectEqualToRect(box(shapeLayer.path), CGRectMake(0, 0, 30, 30)) && shapeLayer.strokeEnd == 0 && shapeLayer.strokeColor && CGColorGetAlpha(shapeLayer.strokeColor) == 1);
    CHECK(shapeLayer.fillColor && CGColorGetAlpha(shapeLayer.fillColor) == 0 && shapeLayer.lineWidth == 1);
    Outcome *morph = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) {
      [motion run:Request(@"morph", 18, @{ @"morph": Timing(1, 200), @"strokeEnd": Timing(1, 200), @"fillColorAlpha": Timing(1, 200) }) resolve:resolve reject:reject];
    });
    CAKeyframeAnimation *paths = (CAKeyframeAnimation *)[shapeLayer animationForKey:@"spark.motion.path"];
    CHECK(!morph->code && paths.values.count > 2 && CFGetTypeID((__bridge CFTypeRef)paths.values.firstObject) == CGPathGetTypeID());
    CHECK([shapeLayer animationForKey:@"spark.motion.strokeEnd"] && [shapeLayer animationForKey:@"spark.motion.fillColor"] && ![shaped.layer animationForKey:@"spark.motion.path"]);
    CHECK(CGRectEqualToRect(box(shapeLayer.path), CGRectMake(0, 0, 60, 30)) && shapeLayer.strokeEnd == 1);  // the model holds the end
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:100 resolve:resolve reject:reject]; });
    __block CGRect presentedBox = CGRectZero;
    __block float presentedEnd = 0;
    [motion presenting:^{ presentedBox = box(shapeLayer.path); presentedEnd = shapeLayer.strokeEnd; }];
    CHECK(CGRectEqualToRect(presentedBox, CGRectMake(0, 0, 45, 30)) && std::abs(presentedEnd - 0.5) < 1e-6);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:100 resolve:resolve reject:reject]; });
    CHECK(morph->resolved && [JSON(morph->value)[@"finished"] isEqual:@YES]);
    // New paths show at the current morph at once.
    CHECK([shapeView setConfig:withShapeKey(shapeConfig, @"paths", @[trianglePath, squarePath]) error:&shapeError]);
    [motion hostDidReshape:shaped];
    CHECK(CGRectEqualToRect(box(shapeLayer.path), CGRectMake(0, 0, 30, 30)));
    // Under Reduce Motion the morph and the drawn stroke jump, and the shape fades in where they land.
    [motion simulate:@{ @"reduceMotion": @YES }];
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"reduced-morph", 18, @{ @"morph": Timing(0, 400), @"strokeEnd": Timing(0.5, 400) }) resolve:resolve reject:reject]; });
    NSDictionary *reducedKinds = JSON0(Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion telemetry:18 resolve:resolve reject:reject]; })->value)[@"motion"][@"kinds"];
    CHECK([reducedKinds[@"morph"] isEqual:@"jump"] && [reducedKinds[@"strokeEnd"] isEqual:@"jump"] && [reducedKinds[@"opacity"] isEqual:@"timing"]);
    CHECK(CGRectEqualToRect(box(shapeLayer.path), CGRectMake(0, 0, 60, 30)) && shapeLayer.strokeEnd == 0.5f);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:200 resolve:resolve reject:reject]; });
    [motion simulate:@{ @"reduceMotion": @NO }];
    // A view without a shape has no shape properties.
    [motion registerHost:plain initial:kIdentity];
    Outcome *unshaped = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"unshaped", 16, @{ @"strokeEnd": Timing(0, 100) }) resolve:resolve reject:reject]; });
    Outcome *unshapedSet = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion set:@{ @"tag": @16, @"values": @{ @"morph": @1 } } resolve:resolve reject:reject]; });
    CHECK([unshaped->code isEqual:@"E_UNSUPPORTED_OPTION"] && [unshapedSet->code isEqual:@"E_UNSUPPORTED_OPTION"]);
    [motion unregisterTag:16];
    [motion unregisterTag:18];
    // Shader effects (docs/motion.md#shader-effects-and-particles): engine properties baked onto Core Image filters and a
    // gradient overlay, or rendered by the precompiled Metal dissolve on the clock's frames; each is installed only while
    // it shows something or animates. Frozen virtual-clock frames are rendered by Core Animation itself (CARenderer).
    const BOOL metal = MTLCreateSystemDefaultDevice() != nil;
    if (!metal) std::puts("NOTE no Metal device: dissolve and the rendered-frame checks report the device's absence instead");
    CHECK(SparkMotionShaderSupported(@"ripple") && SparkMotionShaderSupported(@"distortion") && SparkMotionShaderSupported(@"specular") && !SparkMotionShaderSupported(@"plasma"));
    CHECK(SparkMotionShaderSupported(@"dissolve") == metal);
    NSString *shaderError = nil;
    CHECK(![SparkMotionShader shader:@{ @"type": @"plasma" } error:&shaderError] && [shaderError containsString:@"Unknown shader effect"]);
    NSDictionary *wide = @{ @"type": @"ripple", @"width": @"wide" }, *offCentre = @{ @"type": @"distortion", @"center": @{ @"x": @1 } };
    CHECK(![SparkMotionShader shader:wide error:&shaderError] && [shaderError containsString:@"width"]);
    CHECK(![SparkMotionShader shader:offCentre error:&shaderError] && [shaderError containsString:@"center"]);
    // Effect hosts have no window, so CARenderer can render their layer trees as their own roots (nothing turns the run
    // loop, which would drop the animations of windowless layers); particles need the window for its visibility.
    auto effectHost = [&](NSInteger tag, NSDictionary *config, BOOL inWindow = NO) {
      EffectHost *effect = [[EffectHost alloc] initWithFrame:NSMakeRect(0, 0, 96, 48)];
      effect.wantsLayer = YES;
      effect.motionTag = tag;
      Stripes(effect);
      NSString *error = nil;
      effect.motionShader = config ? [SparkMotionShader shader:config error:&error] : nil;
      if (inWindow) [window.contentView addSubview:effect];
      [motion registerHost:effect initial:kIdentity];
      return effect;
    };
    auto telemetryOf = [&](NSInteger tag) { return JSON0(Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion telemetry:tag resolve:resolve reject:reject]; })->value); };
    auto filterNamed = [](NSView *view, NSString *name) -> CIFilter * { for (CIFilter *filter in view.layer.filters) if ([filter.name isEqual:name]) return filter; return nil; };

    // Ripple: a ring from the origin. At rest nothing is installed; while it travels the filter is, and its radius and
    // refraction animate on the compositor; once it settles the filter comes off.
    EffectHost *ripple = effectHost(20, @{ @"type": @"ripple", @"origin": @{ @"x": @24, @"y": @12 }, @"width": @16, @"refraction": @2 });
    const std::vector<uint8_t> flat = Render(ripple);
    CHECK(!filterNamed(ripple, @"sparkRipple") && !ripple.layerUsesCoreImageFilters);
    Outcome *rippled = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"ripple", 20, @{ @"rippleProgress": Timing(1, 400) }) resolve:resolve reject:reject]; });
    CIFilter *ring = filterNamed(ripple, @"sparkRipple");
    CHECK(!rippled->code && [ring.attributes[kCIAttributeFilterName] isEqual:@"CITorusLensDistortion"] && ripple.layerUsesCoreImageFilters);
    CHECK([ripple.layer animationForKey:@"spark.motion.filters.sparkRipple.inputRadius"] && [ripple.layer animationForKey:@"spark.motion.filters.sparkRipple.inputRefraction"]);
    const CGPoint origin = [ripple convertPointToLayer:NSMakePoint(24, ripple.isFlipped ? 12 : 48 - 12)];
    CHECK([[ring valueForKey:kCIInputCenterKey] X] == origin.x && [[ring valueForKey:kCIInputCenterKey] Y] == origin.y && [[ring valueForKey:kCIInputWidthKey] doubleValue] == 16);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:200 resolve:resolve reject:reject]; });
    __block double halfwayRadius = 0, halfwayRefraction = 0;
    [motion presenting:^{ halfwayRadius = [[filterNamed(ripple, @"sparkRipple") valueForKey:kCIInputRadiusKey] doubleValue]; halfwayRefraction = [[filterNamed(ripple, @"sparkRipple") valueForKey:@"inputRefraction"] doubleValue]; }];
    const double reach = std::hypot(96 - 24, 48 - 12) + 16;
    CHECK(std::abs(halfwayRadius - reach / 2) < 1e-6 && std::abs(halfwayRefraction - 1.5) < 1e-6);  // 1 + (2 − 1) · (1 − ½) at full strength
    const std::vector<uint8_t> rippling = Render(ripple);
    CHECK(!metal || Changed(flat, rippling) > 50);  // the frozen frame: the ring bends the stripes
    NSDictionary *rippleTelemetry = telemetryOf(20);
    CHECK([rippleTelemetry[@"shader"][@"type"] isEqual:@"ripple"] && [rippleTelemetry[@"shader"][@"renderer"] isEqual:@"coreAnimation"] && [rippleTelemetry[@"shader"][@"installed"] isEqual:@YES]);
    CHECK(std::abs([rippleTelemetry[@"values"][@"rippleProgress"] doubleValue] - 0.5) < 1e-9);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:200 resolve:resolve reject:reject]; });
    CHECK(rippled->resolved && !filterNamed(ripple, @"sparkRipple") && !ripple.layerUsesCoreImageFilters && ripple.motionModel[RippleProgress] == 1);
    CHECK(!metal || Changed(flat, Render(ripple)) == 0);
    // Under Reduce Motion the ring does not travel: it changes at once and the view fades in where it is (the fade alternate).
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion set:@{ @"tag": @20, @"values": @{ @"rippleProgress": @0 } } resolve:resolve reject:reject]; });
    [motion simulate:@{ @"reduceMotion": @YES }];
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"ripple-reduced", 20, @{ @"rippleProgress": Timing(1, 400) }) resolve:resolve reject:reject]; });
    NSDictionary *reducedRipple = telemetryOf(20)[@"motion"][@"kinds"];
    CHECK([reducedRipple[@"rippleProgress"] isEqual:@"jump"] && [reducedRipple[@"opacity"] isEqual:@"timing"]);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:250 resolve:resolve reject:reject]; });
    CHECK(!filterNamed(ripple, @"sparkRipple") && ripple.layer.opacity == 1);
    [motion simulate:@{ @"reduceMotion": @NO }];
    // Effect properties belong to their effect: another effect's, or a plain MotionView's, are E_UNSUPPORTED_OPTION.
    EffectHost *plainView = effectHost(25, nil);
    Outcome *wrongEffect = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"wrong", 20, @{ @"distortion": Timing(1, 100) }) resolve:resolve reject:reject]; });
    Outcome *plainEffect = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion set:@{ @"tag": @25, @"values": @{ @"dissolveProgress": @0.5 } } resolve:resolve reject:reject]; });
    CHECK([wrongEffect->code isEqual:@"E_UNSUPPORTED_OPTION"] && [plainEffect->code isEqual:@"E_UNSUPPORTED_OPTION"]);

    // Distortion: a bulge that stays while it is not 0, clamped to ±1; it follows a change of the effect's options.
    EffectHost *bulge = effectHost(21, @{ @"type": @"distortion" });
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion set:@{ @"tag": @21, @"values": @{ @"distortion": @3 } } resolve:resolve reject:reject]; });
    CIFilter *bump = filterNamed(bulge, @"sparkDistortion");
    CHECK([bump.attributes[kCIAttributeFilterName] isEqual:@"CIBumpDistortion"] && [[bump valueForKey:kCIInputScaleKey] doubleValue] == 1 && [[bump valueForKey:kCIInputRadiusKey] doubleValue] == 24);
    CHECK(!metal || Changed(flat, Render(bulge)) > 50);
    // A resize moves the default centre and radius with the view.
    [bulge setFrameSize:NSMakeSize(120, 60)];
    [motion hostDidResize:bulge];
    const CGPoint resized = [bulge convertPointToLayer:NSMakePoint(60, 30)];
    CIVector *centre = [bulge.layer valueForKeyPath:@"filters.sparkDistortion.inputCenter"];
    CHECK(centre.X == resized.x && centre.Y == resized.y && [[bulge.layer valueForKeyPath:@"filters.sparkDistortion.inputRadius"] doubleValue] == 30);
    [bulge setFrameSize:NSMakeSize(96, 48)];
    [motion hostDidResize:bulge];
    SparkMotionShader *previousShader = bulge.motionShader;
    bulge.motionShader = [SparkMotionShader shader:@{ @"type": @"distortion", @"center": @{ @"x": @10, @"y": @10 }, @"radius": @8 } error:&shaderError];
    [motion host:bulge shaderChangedFrom:previousShader];
    bump = filterNamed(bulge, @"sparkDistortion");
    CHECK(bump && [[bump valueForKey:kCIInputRadiusKey] doubleValue] == 8 && bulge.layer.filters.count == 1);
    Outcome *pinch = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"pinch", 21, @{ @"distortion": Timing(0, 100) }) resolve:resolve reject:reject]; });
    CHECK([bulge.layer animationForKey:@"spark.motion.filters.sparkDistortion.inputScale"] != nil);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:100 resolve:resolve reject:reject]; });
    CHECK(pinch->resolved && !filterNamed(bulge, @"sparkDistortion") && !bulge.layer.filters);

    // Specular: a light band sweeps across; an overlay over the content while it travels. A capture renders the band.
    EffectHost *glass = effectHost(22, @{ @"type": @"specular", @"angle": @0, @"width": @0.2, @"intensity": @1 });
    glass.layer.cornerRadius = 6;
    Outcome *swept = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"sweep", 22, @{ @"specularProgress": Timing(1, 400) }) resolve:resolve reject:reject]; });
    CAGradientLayer *band = nil;
    for (CALayer *sublayer in glass.layer.sublayers) if ([sublayer isKindOfClass:CAGradientLayer.class]) band = (CAGradientLayer *)sublayer;
    CHECK(!swept->code && band && band.zPosition > 0 && band.masksToBounds && band.cornerRadius == 6 && [band animationForKey:@"spark.motion.locations"]);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:200 resolve:resolve reject:reject]; });
    __block NSArray<NSNumber *> *locations = nil;
    __block NSBitmapImageRep *capture = nil;
    [motion presenting:^{
      locations = band.locations;
      capture = [glass bitmapImageRepForCachingDisplayInRect:glass.bounds];
      [glass cacheDisplayInRect:glass.bounds toBitmapImageRep:capture];
    }];
    CHECK(std::abs(locations[1].doubleValue - 0.5) < 1e-6 && std::abs(locations[0].doubleValue - 0.3) < 1e-6 && std::abs(locations[2].doubleValue - 0.7) < 1e-6);
    // At the band's centre a black stripe shows lit; at the edge it stays black (the capture is at the backing scale).
    const double scale = capture.pixelsWide / 96.0;
    NSColor *lit = [capture colorAtX:(NSInteger)(49 * scale) y:(NSInteger)(24 * scale)], *dark = [capture colorAtX:(NSInteger)(1 * scale) y:(NSInteger)(24 * scale)];
    CHECK(lit.brightnessComponent > 0.6 && dark.brightnessComponent < 0.1);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:200 resolve:resolve reject:reject]; });
    CHECK(swept->resolved && !band.superlayer);

    // Dissolve: the Metal mask is rendered on each frame of the virtual clock at the engine's value for it; at rest at 1 an
    // empty mask hides the view without Metal, at 0 there is none. A lost device is rebuilt on the next frame.
    if (metal) {
      EffectHost *dust = effectHost(23, @{ @"type": @"dissolve", @"cellSize": @6, @"softness": @0.2 });
      Outcome *dissolved = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"dissolve", 23, @{ @"dissolveProgress": Timing(1, 400) }) resolve:resolve reject:reject]; });
      CHECK(!dissolved->code && [dust.layer.mask isKindOfClass:CAMetalLayer.class] && dust.motionShader.renderedFrames == 1 && dust.motionShader.renderedValue == 0);
      Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:200 resolve:resolve reject:reject]; });
      CHECK(dust.motionShader.renderedFrames == 2 && std::abs(dust.motionShader.renderedValue - 0.5) < 1e-9);
      const std::vector<uint8_t> half = Render(dust);
      size_t shown = 0;
      for (size_t i = 3; i < half.size(); i += 4) shown += half[i] > 128;
      CHECK(shown > half.size() / 4 / 5 && shown < half.size() / 4 * 4 / 5);  // part of the view shows, part has dissolved
      NSDictionary *dustTelemetry = telemetryOf(23)[@"shader"];
      CHECK([dustTelemetry[@"renderer"] isEqual:@"metal"] && [dustTelemetry[@"renderedFrames"] isEqual:@2] && std::abs([dustTelemetry[@"renderedValue"] doubleValue] - 0.5) < 1e-9);
      // A frozen frame renders once: reading state or capturing does not render again.
      Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion state:23 resolve:resolve reject:reject]; });
      CHECK(dust.motionShader.renderedFrames == 2);
      SparkMotionShaderDeviceLost();
      Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:100 resolve:resolve reject:reject]; });
      CHECK(dust.motionShader.renderedFrames == 3 && std::abs(dust.motionShader.renderedValue - 0.75) < 1e-9);
      // A new drawable size renders the same value again, for that size.
      [dust setFrameSize:NSMakeSize(120, 60)];
      [motion hostDidResize:dust];
      CHECK(dust.motionShader.renderedFrames == 4 && CGSizeEqualToSize(((CAMetalLayer *)dust.layer.mask).drawableSize, CGSizeMake(120, 60)));
      [dust setFrameSize:NSMakeSize(96, 48)];
      [motion hostDidResize:dust];
      CHECK(dust.motionShader.renderedFrames == 5);
      Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:100 resolve:resolve reject:reject]; });
      CHECK(dissolved->resolved && dust.layer.mask && ![dust.layer.mask isKindOfClass:CAMetalLayer.class] && ![dust.motionShader installedOn:dust]);
      Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion set:@{ @"tag": @23, @"values": @{ @"dissolveProgress": @0 } } resolve:resolve reject:reject]; });
      CHECK(!dust.layer.mask);
      // Under Reduce Motion a dissolve is not travel: it plays as the 200 ms fade of its threshold.
      [motion simulate:@{ @"reduceMotion": @YES }];
      Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"dissolve-reduced", 23, @{ @"dissolveProgress": @{ @"type": @"spring", @"to": @1, @"mass": @1, @"stiffness": @100, @"damping": @5 } }) resolve:resolve reject:reject]; });
      CHECK([telemetryOf(23)[@"motion"][@"kinds"][@"dissolveProgress"] isEqual:@"timing"]);
      Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:200 resolve:resolve reject:reject]; });
      [motion simulate:@{ @"reduceMotion": @NO }];
      // The dissolve is the view's mask: the motion mask's properties are E_UNSUPPORTED_OPTION on it.
      Outcome *masked = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion set:@{ @"tag": @23, @"values": @{ @"maskInsetTop": @4 } } resolve:resolve reject:reject]; });
      CHECK([masked->code isEqual:@"E_UNSUPPORTED_OPTION"]);
      [motion unregisterTag:23];
      CHECK(!dust.layer.mask);
    } else {
      CHECK(![SparkMotionShader shader:@{ @"type": @"dissolve" } error:&shaderError] && [shaderError containsString:@"Metal device"]);
    }
    [motion unregisterTag:20];
    [motion unregisterTag:21];
    [motion unregisterTag:22];

    // Particles: a CAEmitterLayer on the view's layer that emits between start and stop, or for a burst on the layer's
    // clock; nothing under Reduce Motion unless asked to play; held while the window is hidden; stopped on unmount.
    NSString *emitterError = nil;
    CHECK(![SparkMotionEmitter emitter:@{ @"cells": @[] } error:&emitterError] && [emitterError containsString:@"cells"]);
    NSDictionary *cell = @{ @"birthRate": @10, @"lifetimeMs": @1000 };
    auto withImage = [&](id image) { NSMutableDictionary *copy = [cell mutableCopy]; copy[@"image"] = image; return @{ @"cells": @[copy] }; };
    CHECK(![SparkMotionEmitter emitter:withImage(@"triangle") error:&emitterError] && [emitterError containsString:@"image"]);
    CHECK(![SparkMotionEmitter emitter:withImage(@{ @"symbol": @"no.such.symbol" }) error:&emitterError]);
    // The budget holds natively too: rates and lifetimes in range, at most 1,000 particles alive and eight cells.
    NSDictionary *crowded = @{ @"cells": @[@{ @"birthRate": @500, @"lifetimeMs": @1500 }, @{ @"birthRate": @400, @"lifetimeMs": @1000 }] };
    CHECK(![SparkMotionEmitter emitter:crowded error:&emitterError] && [emitterError containsString:@"at most 1000"]);
    NSDictionary *speedy = @{ @"cells": @[@{ @"birthRate": @600, @"lifetimeMs": @100 }] }, *full = @{ @"cells": @[@{ @"birthRate": @500, @"lifetimeMs": @2000 }] };
    NSDictionary *many = @{ @"cells": [NSArray arrayWithObjects:cell, cell, cell, cell, cell, cell, cell, cell, cell, nil] };
    CHECK(![SparkMotionEmitter emitter:speedy error:&emitterError] && [emitterError containsString:@"birthRate"]);
    CHECK(![SparkMotionEmitter emitter:many error:&emitterError] && [emitterError containsString:@"eight"]);
    CHECK([SparkMotionEmitter emitter:full error:&emitterError] != nil);
    EffectHost *confetti = effectHost(24, nil, YES);
    confetti.motionEmitter = [SparkMotionEmitter emitter:@{ @"shape": @"line", @"position": @{ @"x": @48, @"y": @0 }, @"size": @{ @"width": @96, @"height": @0 }, @"seed": @7, @"cells": @[
      @{ @"image": @"star", @"birthRate": @40, @"lifetimeMs": @1500, @"velocity": @60, @"emissionAngle": @90, @"emissionRange": @60, @"spin": @180, @"color": @[@0.7, @0.2, @30, @1], @"acceleration": @{ @"x": @0, @"y": @100 } },
      @{ @"image": @{ @"symbol": @"heart.fill" }, @"birthRate": @5, @"lifetimeMs": @1000 } ] } error:&emitterError];
    CHECK(confetti.motionEmitter != nil);
    auto particles = [&](NSDictionary *request) { return Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion startParticles:request resolve:resolve reject:reject]; }); };
    Outcome *emitted = particles(@{ @"tag": @24 });
    CAEmitterLayer *emitterLayer = confetti.motionEmitter.layer;
    CAEmitterCell *star = emitterLayer.emitterCells.firstObject;
    CHECK(emitted->resolved && [JSON(emitted->value)[@"played"] isEqual:@"particles"] && emitterLayer.superlayer == confetti.layer && emitterLayer.birthRate == 1);
    CHECK(emitterLayer.emitterCells.count == 2 && star.birthRate == 40 && std::abs(star.lifetime - 1.5) < 1e-9 && star.contents && emitterLayer.seed == 7 && emitterLayer.emitterShape == kCAEmitterLayerLine);
    // Angles are on screen: 90° and gravity point down, whichever way the layer's geometry runs.
    const BOOL down = [confetti convertPointToLayer:NSMakePoint(0, confetti.isFlipped ? 1 : 47)].y > [confetti convertPointToLayer:NSMakePoint(0, confetti.isFlipped ? 0 : 48)].y;
    CHECK(std::abs(star.emissionLongitude - (down ? 1 : -1) * M_PI / 2) < 1e-9 && star.yAcceleration == (down ? 100 : -100));
    NSDictionary *emitting = telemetryOf(24)[@"particles"];
    CHECK([emitting[@"emitting"] isEqual:@YES] && [emitting[@"cells"] isEqual:@2] && [emitting[@"paused"] isEqual:@NO]);
    [motion simulateWindow:window visible:NO];
    CHECK(confetti.motionEmitter.paused && [telemetryOf(24)[@"particles"][@"paused"] isEqual:@YES]);
    [motion simulateWindow:window visible:YES];
    CHECK(!confetti.motionEmitter.paused);
    Outcome *quiet = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion stopParticles:@{ @"tag": @24 } resolve:resolve reject:reject]; });
    CHECK(quiet->resolved && emitterLayer.birthRate == 0 && [telemetryOf(24)[@"particles"][@"emitting"] isEqual:@NO]);
    // A burst emits for its duration on the layer's clock, which the virtual clock holds and advances.
    particles(@{ @"tag": @24, @"durationMs": @300 });
    CHECK(emitterLayer.birthRate == 0 && [emitterLayer animationForKey:@"spark.particles.burst"] && [confetti.motionEmitter emitting:confetti]);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:200 resolve:resolve reject:reject]; });
    CHECK([confetti.motionEmitter emitting:confetti]);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:200 resolve:resolve reject:reject]; });
    CHECK(![confetti.motionEmitter emitting:confetti]);
    // Reduce Motion: nothing is emitted, unless the request asks to play.
    [motion simulate:@{ @"reduceMotion": @YES }];
    Outcome *reducedParticles = particles(@{ @"tag": @24 });
    CHECK([JSON(reducedParticles->value)[@"played"] isEqual:@"none"] && emitterLayer.birthRate == 0);
    Outcome *playedParticles = particles(@{ @"tag": @24, @"reducedMotion": @"play" });
    CHECK([JSON(playedParticles->value)[@"played"] isEqual:@"particles"] && emitterLayer.birthRate == 1);
    [motion simulate:@{ @"reduceMotion": @NO }];
    // Turning Reduce Motion on stops what was not started to play under it.
    [motion simulate:@{ @"reduceMotion": @YES }];
    CHECK(emitterLayer.birthRate == 1);
    [motion simulate:@{ @"reduceMotion": @NO }];
    particles(@{ @"tag": @24 });
    [motion simulate:@{ @"reduceMotion": @YES }];
    CHECK(emitterLayer.birthRate == 0 && ![confetti.motionEmitter emitting:confetti]);
    [motion simulate:@{ @"reduceMotion": @NO }];
    // A resize lays the emitter out again: it fills the view, its default size follows.
    [confetti setFrameSize:NSMakeSize(120, 60)];
    [motion hostDidResize:confetti];
    CHECK(CGRectEqualToRect(emitterLayer.frame, confetti.layer.bounds) && emitterLayer.bounds.size.width == 120);
    [confetti setFrameSize:NSMakeSize(96, 48)];
    [motion hostDidResize:confetti];
    CHECK([particles(@{ @"tag": @24, @"durationMs": @-1 })->code isEqual:@"E_INVALID_ARGUMENT"] && [particles(@{ @"tag": @24, @"reducedMotion": @"skip" })->code isEqual:@"E_INVALID_ARGUMENT"]);
    CHECK([particles(@{ @"tag": @25 })->code isEqual:@"E_UNSUPPORTED_OPTION"] && plainView.layer.sublayers.count == 12);  // the stripes' layers only
    [motion unregisterTag:25];
    [motion unregisterTag:24];
    CHECK(emitterLayer.birthRate == 0);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion setClock:@"real" resolve:resolve reject:reject]; });
    // On the real clock a display link renders dissolves while they animate. It follows one of them: when that one stops,
    // it is made again for the next, and it ends with the last.
    if (metal) {
      EffectHost *first = effectHost(26, @{ @"type": @"dissolve" }, YES), *second = effectHost(27, @{ @"type": @"dissolve" }, YES);
      for (NSNumber *tag in @[@26, @27])
        Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request([NSString stringWithFormat:@"link-%@", tag], tag.integerValue, @{ @"dissolveProgress": Timing(1, 5000) }) resolve:resolve reject:reject]; });
      id link = [motion valueForKey:@"_effectLink"];
      CHECK([link isKindOfClass:CADisplayLink.class] && [first.motionShader installedOn:first] && [second.motionShader installedOn:second]);
      Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion set:@{ @"tag": @26, @"values": @{ @"dissolveProgress": @1 } } resolve:resolve reject:reject]; });
      id next = [motion valueForKey:@"_effectLink"];
      CHECK([next isKindOfClass:CADisplayLink.class] && next != link);
      [motion unregisterTag:26];
      [motion unregisterTag:27];
      CHECK([motion valueForKey:@"_effectLink"] == nil);
    }

    // Until motion drives them, the background, corners and shadow follow the view's style: the engine takes what the
    // style put on the layer, so an animation starts from it, and motion leaves the layer alone until it owns the channel.
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion setClock:@"virtual" resolve:resolve reject:reject]; });
    TestHost *styled = [[TestHost alloc] initWithFrame:NSMakeRect(0, 0, 100, 40)];
    styled.wantsLayer = YES;
    styled.motionTag = 13;
    [window.contentView addSubview:styled];
    [motion registerHost:styled initial:kIdentity];
    styled.layer.backgroundColor = CGColorGetConstantColor(kCGColorWhite);  // as React Native applies a style
    styled.layer.cornerRadius = 6;
    styled.layer.shadowOpacity = 0.3f;
    [styled applyMotionModel:[motion styledModel:styled model:styled.motionModel]];
    CHECK(styled.motionOwnedChannels == 0 && styled.layer.cornerRadius == 6 && CGColorEqualToColor(styled.layer.backgroundColor, CGColorGetConstantColor(kCGColorWhite)));
    Outcome *styledState = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion state:13 resolve:resolve reject:reject]; });
    NSDictionary *styledValues = JSON(styledState->value)[@"values"];
    CHECK(std::abs([styledValues[@"backgroundColorL"] doubleValue] - 1) < 1e-4 && [styledValues[@"backgroundColorAlpha"] doubleValue] == 1);
    CHECK([styledValues[@"borderRadius"] doubleValue] == 6 && std::abs([styledValues[@"shadowOpacity"] doubleValue] - 0.3) < 1e-6);
    const Oklch roundTrip = srgbToOklch(oklchToSrgb(0.7, 0.12, 250, 0.5));
    CHECK(std::abs(roundTrip.lightness - 0.7) < 1e-6 && std::abs(roundTrip.chroma - 0.12) < 1e-6 && std::abs(roundTrip.hue - 250) < 1e-4 && roundTrip.alpha == 0.5);
    // Animating the corner radius takes that channel only: it animates from 6, and the style's background stays.
    Outcome *round = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"round", 13, @{ @"borderRadius": Timing(20, 100) }) resolve:resolve reject:reject]; });
    CHECK(!round->code && styled.motionOwnedChannels == SparkMotionChannelBit(Channel::BorderRadius));
    CHECK([styled.layer animationForKey:@"spark.motion.cornerRadius"] && ![styled.layer animationForKey:@"spark.motion.backgroundColor"]);
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:50 resolve:resolve reject:reject]; });
    Outcome *rounding = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion state:13 resolve:resolve reject:reject]; });
    CHECK(std::abs([JSON(rounding->value)[@"values"][@"borderRadius"] doubleValue] - 13) < 1e-6);
    styled.layer.cornerRadius = 2;  // a later style change of an owned channel: motion keeps its value
    [styled applyMotionModel:[motion styledModel:styled model:styled.motionModel]];
    CHECK(styled.layer.cornerRadius == 20 && CGColorEqualToColor(styled.layer.backgroundColor, CGColorGetConstantColor(kCGColorWhite)));
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:50 resolve:resolve reject:reject]; });
    CHECK(round->resolved);
    // React Native's shadow path follows the style's radii: motion's corners and shadow drop it.
    styled.layer.shadowPath = CGPathCreateWithRect(CGRectMake(0, 0, 10, 10), NULL);
    [styled applyMotionModel:styled.motionModel];
    CHECK(styled.layer.shadowPath == NULL);
    // A channel React Native draws for the style on another layer is E_UNSUPPORTED_OPTION, before anything changes.
    styled.motionStyleChannels = SparkMotionChannelBit(Channel::BackgroundColor) | SparkMotionChannelBit(Channel::Mask);
    Outcome *refused = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion run:Request(@"tint", 13, @{ @"backgroundColorL": Timing(0.5, 100), @"opacity": Timing(0.5, 100) }) resolve:resolve reject:reject]; });
    CHECK([refused->code isEqual:@"E_UNSUPPORTED_OPTION"] && styled.layer.opacity == 1);
    Outcome *refusedSet = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion set:@{ @"tag": @13, @"values": @{ @"maskRadius": @4 } } resolve:resolve reject:reject]; });
    CHECK([refusedSet->code isEqual:@"E_UNSUPPORTED_OPTION"] && styled.layer.mask == nil);
    styled.motionStyleChannels = 0;
    // Under Reduce Motion a step's own alternate plays instead of its tracks: only what plays is taken.
    [motion simulate:@{ @"reduceMotion": @YES }];
    Outcome *alternate = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) {
      [motion run:@{ @"id": @"alt", @"groups": @[@{ @"tag": @13, @"tracks": @{ @"shadowRadius": Timing(8, 100) }, @"reducedTracks": @{ @"opacity": Timing(0.9, 100) } }] } resolve:resolve reject:reject];
    });
    CHECK(!alternate->code && !(styled.motionOwnedChannels & SparkMotionChannelBit(Channel::Shadow)));
    [motion simulate:@{ @"reduceMotion": @NO }];
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion advanceClock:100 resolve:resolve reject:reject]; });
    // Stopping every property takes nothing.
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion stop:@{ @"tag": @13, @"properties": @[@"backgroundColorL", @"shadowOpacity"] } resolve:resolve reject:reject]; });
    CHECK(!(styled.motionOwnedChannels & (SparkMotionChannelBit(Channel::BackgroundColor) | SparkMotionChannelBit(Channel::Shadow))) && CGColorEqualToColor(styled.layer.backgroundColor, CGColorGetConstantColor(kCGColorWhite)));
    [motion unregisterTag:13];
    Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion setClock:@"real" resolve:resolve reject:reject]; });

    // Symbol effects (docs/motion.md#symbol-effects): the effect plays on the image view, or its Reduce Motion alternate.
    TestSymbol *bell = [[TestSymbol alloc] initWithFrame:NSMakeRect(0, 0, 32, 32)];
    bell.motionTag = 14;
    bell.wantsLayer = YES;
    bell.symbolImageView = [NSImageView imageViewWithImage:[NSImage imageWithSystemSymbolName:@"bell.fill" accessibilityDescription:nil]];
    bell.symbolImageView.wantsLayer = YES;
    [bell addSubview:bell.symbolImageView];
    [window.contentView addSubview:bell];
    [motion registerSymbol:bell];
    auto play = [&](NSDictionary *request) { return Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion playSymbolEffect:request resolve:resolve reject:reject]; }); };
    CHECK([JSON(play(@{ @"tag": @14, @"effect": @"bounce", @"direction": @"up" })->value)[@"played"] isEqual:@"bounce"]);
    CHECK([play(@{ @"tag": @14, @"effect": @"spin" })->code isEqual:@"E_INVALID_ARGUMENT"]);
    CHECK([play(@{ @"tag": @14, @"effect": @"bounce", @"direction": @"left" })->code isEqual:@"E_INVALID_ARGUMENT"]);
    CHECK([play(@{ @"tag": @14, @"effect": @"pulse", @"repeat": @-1 })->code isEqual:@"E_INVALID_ARGUMENT"]);
    CHECK(SparkSymbolEffectSupported(@"pulse") && !SparkSymbolEffectSupported(@"spin"));
    if (SparkSymbolEffectSupported(@"drawOff")) CHECK([play(@{ @"tag": @14, @"effect": @"drawOff", @"repeat": @1 })->code isEqual:@"E_UNSUPPORTED_OPTION"]);
    else CHECK([play(@{ @"tag": @14, @"effect": @"drawOff" })->code isEqual:@"E_UNAVAILABLE"]);
    [motion simulate:@{ @"reduceMotion": @YES }];
    CHECK([JSON(play(@{ @"tag": @14, @"effect": @"bounce", @"repeat": @"infinite" })->value)[@"played"] isEqual:@"pulse"]);
    CHECK([JSON(play(@{ @"tag": @14, @"effect": @"bounce", @"reducedMotion": @"instant" })->value)[@"played"] isEqual:@"none"]);
    CHECK([JSON(play(@{ @"tag": @14, @"effect": @"bounce", @"reducedMotion": @"play" })->value)[@"played"] isEqual:@"bounce"]);
    if (SparkSymbolEffectSupported(@"drawOff")) {
      CHECK([JSON(play(@{ @"tag": @14, @"effect": @"drawOff", @"reducedMotion": @"instant" })->value)[@"played"] isEqual:@"none"] && bell.symbolImageView.alphaValue == 0);
      CHECK([JSON(play(@{ @"tag": @14, @"effect": @"drawOn", @"reducedMotion": @"instant" })->value)[@"played"] isEqual:@"none"] && bell.symbolImageView.alphaValue == 1);
    }
    [motion simulate:@{ @"reduceMotion": @NO }];
    Outcome *removed = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [motion removeSymbolEffect:@{ @"tag": @14 } resolve:resolve reject:reject]; });
    CHECK(removed->resolved);
    // A name change with a transition while Reduce Motion is on cross-fades instead.
    [motion simulate:@{ @"reduceMotion": @YES }];
    [motion replaceSymbol:bell image:[NSImage imageWithSystemSymbolName:@"bell.slash.fill" accessibilityDescription:nil] transition:@"downUp"];
    CHECK([[bell.symbolImageView.layer animationForKey:kCATransition] isKindOfClass:CATransition.class]);
    [motion simulate:@{ @"reduceMotion": @NO }];
    [motion unregisterSymbolTag:14];

    // Outside a driver run, visibility is the window's occlusion state, read when needed: a window that is not on screen
    // (never shown here) is hidden from the first view that mounts in it, with no notification.
    SparkMotionCoordinator *app = [SparkMotionCoordinator new];
    TestHost *offscreen = [[TestHost alloc] initWithFrame:NSMakeRect(0, 0, 40, 40)];
    offscreen.wantsLayer = YES;
    offscreen.motionTag = 11;
    NSWindow *unshown = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 100, 100) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
    unshown.releasedWhenClosed = NO;
    [unshown.contentView addSubview:offscreen];
    CHECK((unshown.occlusionState & NSWindowOcclusionStateVisible) == 0);
    [app registerHost:offscreen initial:kIdentity];
    // Outside a driver run motion follows the Mac: power, screen parameters, window screens, occlusion, close and Reduce Motion.
    CHECK([[app valueForKey:@"observers"] count] == 5 && [app valueForKey:@"accessibilityObserver"]);
    CHECK([JSON(Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [app environment:11 resolve:resolve reject:reject]; })->value)[@"windowVisible"] isEqual:@NO]);
    Outcome *offscreenSlide = Call(^(SparkMotionResolve resolve, SparkMotionReject reject) { [app run:Request(@"offscreen", 11, @{ @"translateX": Timing(30, 5000) }) resolve:resolve reject:reject]; });
    CHECK(offscreenSlide->resolved && [JSON(offscreenSlide->value)[@"finished"] isEqual:@YES] && offscreen.motionModel[TranslateX] == 30 && offscreen.layer.animationKeys.count == 0);
    [app unregisterTag:11];
  }
  if (failures) { std::printf("%d motion coordinator checks failed\n", failures); return 1; }
  std::puts("Motion coordinator tests passed");
}
