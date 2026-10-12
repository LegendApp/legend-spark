#import "SparkMotionCoordinator.h"
#import <QuartzCore/QuartzCore.h>
#include <algorithm>
#include <cmath>
#include <exception>
#include <vector>
using namespace spark::motion;

static NSString *const kTransformLead = @"spark.motion.transform";
static NSString *const kTransformLoop = @"spark.motion.transform.loop";
static NSString *const kOpacityLead = @"spark.motion.opacity";
static NSString *const kOpacityLoop = @"spark.motion.opacity.loop";

CATransform3D SparkMotionTransform(const Values &values)
{
  CATransform3D transform = CATransform3DMakeTranslation(values[TranslateX], values[TranslateY], 0);
  transform = CATransform3DRotate(transform, values[Rotate] * M_PI / 180, 0, 0, 1);
  return CATransform3DScale(transform, values[ScaleX], values[ScaleY], 1);
}

/** AppKit pins layer anchors at {0,0}; rotate and scale about the centre like React Native's transform3D. */
static CATransform3D SparkMotionCentered(CATransform3D transform, NSView *view)
{
  if (!CGPointEqualToPoint(view.layer.anchorPoint, CGPointZero)) return transform;
  CATransform3D adjust = CATransform3DMakeTranslation(view.frame.size.width / 2, view.frame.size.height / 2, 0);
  return CATransform3DConcat(CATransform3DConcat(CATransform3DInvert(adjust), transform), adjust);
}

static Failure SparkMotionInvalid(NSString *message) { return {"E_INVALID_ARGUMENT", message.UTF8String}; }
static Failure SparkMotionUnmounted(NSInteger tag) { return {"E_NOT_FOUND", "No mounted MotionView has tag " + std::to_string(tag), true}; }
/** How long a request naming a not-yet-mounted MotionView waits for its mount transaction. */
static const double SparkMotionMountWait = 1;

// Typed readers for JSON requests. Every value is checked before use: a malformed request rejects
// with E_INVALID_ARGUMENT instead of raising an Objective-C exception (NSNull, strings or objects
// where numbers, booleans or arrays belong).
static BOOL SparkIsBoolean(id value) { return [value isKindOfClass:NSNumber.class] && CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID(); }
static NSDictionary *SparkObject(id value, NSString *name)
{
  if (![value isKindOfClass:NSDictionary.class]) throw SparkMotionInvalid([NSString stringWithFormat:@"%@ must be an object", name]);
  return value;
}
static NSArray *SparkArray(id value, NSString *name)
{
  if (![value isKindOfClass:NSArray.class]) throw SparkMotionInvalid([NSString stringWithFormat:@"%@ must be an array", name]);
  return value;
}
static NSString *SparkString(NSDictionary *object, NSString *key)
{
  id value = object[key];
  if (![value isKindOfClass:NSString.class] || ![value length]) throw SparkMotionInvalid([NSString stringWithFormat:@"%@ must be a non-empty string", key]);
  return value;
}
static double SparkNumberValue(id value, NSString *name)
{
  if (![value isKindOfClass:NSNumber.class] || SparkIsBoolean(value)) throw SparkMotionInvalid([NSString stringWithFormat:@"%@ must be a number", name]);
  return [value doubleValue];
}
static double SparkNumber(NSDictionary *object, NSString *key, double fallback)
{
  id value = object[key];
  return value == nil ? fallback : SparkNumberValue(value, key);
}
static double SparkRequiredNumber(NSDictionary *object, NSString *key)
{
  if (object[key] == nil) throw SparkMotionInvalid([NSString stringWithFormat:@"%@ is required", key]);
  return SparkNumberValue(object[key], key);
}
static BOOL SparkBool(NSDictionary *object, NSString *key, BOOL fallback)
{
  id value = object[key];
  if (value == nil) return fallback;
  if (!SparkIsBoolean(value)) throw SparkMotionInvalid([NSString stringWithFormat:@"%@ must be a boolean", key]);
  return [value boolValue];
}
static NSInteger SparkTag(NSDictionary *object)
{
  const double tag = SparkRequiredNumber(object, @"tag");
  if (tag <= 0 || tag != std::floor(tag) || tag > (double)NSIntegerMax) throw SparkMotionInvalid(@"tag must be a positive integer");
  return (NSInteger)tag;
}
static std::vector<double> SparkNumbers(id value, NSString *name)
{
  std::vector<double> numbers;
  for (id item in SparkArray(value, name)) numbers.push_back(SparkNumberValue(item, name));
  return numbers;
}
static Easing SparkEasing(id value)
{
  std::vector<double> points = SparkNumbers(value, @"easing");
  if (points.size() != 4) throw SparkMotionInvalid(@"An easing is four cubic Bézier numbers");
  return {points[0], points[1], points[2], points[3]};
}
static SpringParams SparkSpring(NSDictionary *object)
{
  return {SparkRequiredNumber(object, @"mass"), SparkRequiredNumber(object, @"stiffness"), SparkRequiredNumber(object, @"damping")};
}
static Property SparkProperty(id name)
{
  auto property = [name isKindOfClass:NSString.class] ? propertyFromName([name UTF8String]) : std::nullopt;
  if (!property) throw SparkMotionInvalid([NSString stringWithFormat:@"Unknown motion property %@", name]);
  return *property;
}

/** Parses one animation for `property`; rest thresholds default per property. The engine validates ranges. */
static Spec SparkSpec(id value, Property property)
{
  NSDictionary *object = SparkObject(value, @"An animation");
  Spec spec;
  const Rest rest = restThreshold(property);
  NSString *type = SparkString(object, @"type");
  if ([type isEqual:@"spring"]) {
    spec.kind = Spec::Kind::Spring;
    spec.spring = SparkSpring(object);
    spec.to = SparkRequiredNumber(object, @"to");
  } else if ([type isEqual:@"timing"]) {
    spec.kind = Spec::Kind::Timing;
    spec.to = SparkRequiredNumber(object, @"to");
    spec.duration = SparkRequiredNumber(object, @"durationMs") / 1000;
    spec.easing = SparkEasing(object[@"easing"]);
  } else if ([type isEqual:@"keyframes"]) {
    spec.kind = Spec::Kind::Keyframes;
    spec.duration = SparkRequiredNumber(object, @"durationMs") / 1000;
    spec.values = SparkNumbers(object[@"values"], @"values");
    spec.offsets = SparkNumbers(object[@"offsets"], @"offsets");
    for (id easing in SparkArray(object[@"easings"], @"easings")) spec.easings.push_back(SparkEasing(easing));
  } else if ([type isEqual:@"decay"]) {
    spec.kind = Spec::Kind::Decay;
    spec.deceleration = SparkRequiredNumber(object, @"deceleration");
    if (object[@"clamp"] != nil) {
      std::vector<double> clamp = SparkNumbers(object[@"clamp"], @"clamp");
      if (clamp.size() != 2) throw SparkMotionInvalid(@"clamp is [min, max]");
      spec.clamp = std::make_pair(clamp[0], clamp[1]);
      spec.bounce = SparkSpring(SparkObject(object[@"bounce"], @"bounce"));
    }
  } else if ([type isEqual:@"sequence"]) {
    spec.kind = Spec::Kind::Sequence;
    for (id step in SparkArray(object[@"steps"], @"steps")) spec.steps.push_back(SparkSpec(step, property));
  } else {
    throw SparkMotionInvalid([NSString stringWithFormat:@"Unknown animation type %@", type]);
  }
  if (object[@"velocity"] != nil) spec.velocity = SparkNumberValue(object[@"velocity"], @"velocity");
  spec.restDelta = SparkNumber(object, @"restDelta", rest.delta);
  spec.restSpeed = SparkNumber(object, @"restSpeed", rest.speed);
  spec.delay = SparkNumber(object, @"delayMs", 0) / 1000;
  spec.repeat = [object[@"repeat"] isEqual:@"infinite"] ? INFINITY : SparkNumber(object, @"repeat", 0);
  spec.reverse = SparkBool(object, @"reverse", NO);
  return spec;
}

static NSDictionary *SparkValuesObject(const Values &values)
{
  NSMutableDictionary *object = [NSMutableDictionary new];
  for (int i = 0; i < PropertyCount; i++) object[@(propertyName(Property(i)))] = @(values[i]);
  return object;
}

static NSString *SparkJSONString(id object)
{
  return [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:object options:0 error:nil] encoding:NSUTF8StringEncoding];
}

@interface SparkMotionLink : NSObject {
@public
  std::vector<double> input;
  std::vector<std::pair<Property, std::vector<double>>> outputs;
}
@property (nonatomic) NSInteger tag;
@property (nonatomic, weak) NSClipView *clip;
@property (nonatomic, strong) id observer;
@property (nonatomic) BOOL horizontal;
@property (nonatomic) BOOL clamp;
@end
@implementation SparkMotionLink @end

@interface SparkMotionFrameRecorder : NSObject
@property (nonatomic, weak) NSView<SparkMotionHost> *host;
@property (nonatomic, strong) CADisplayLink *displayLink;
@property (nonatomic, copy) SparkMotionResolve resolve;
@property (nonatomic, copy) SparkMotionReject reject;
@property (nonatomic) double duration;
@property (nonatomic) double start;
@property (nonatomic) double last;
@property (nonatomic) double interval;
@property (nonatomic) double maxGap;
@property (nonatomic) NSInteger frames;
@property (nonatomic) NSInteger dropped;
@property (nonatomic) NSInteger stalled;
@property (nonatomic) NSInteger active;
@property (nonatomic) BOOL previousMoving;
@property (nonatomic) CATransform3D previousTransform;
@property (nonatomic) float previousOpacity;
@end
@implementation SparkMotionFrameRecorder @end

/** Where a host's layout box was before a mounting transaction, in its layout reference. */
@interface SparkMotionLayoutMark : NSObject
@property (nonatomic) NSInteger surface, transaction;
@property (nonatomic, weak) NSView *reference;
@property (nonatomic) NSRect rect;
@end
@implementation SparkMotionLayoutMark @end

/** A shared element as it showed before a mounting transaction: its visual centre and size in its window's content view, and their velocities. */
@interface SparkMotionSharedMark : NSObject {
@public
  double box[4], velocity[4];  // centre x, centre y, width, height
}
@property (nonatomic) NSInteger surface, transaction;
@property (nonatomic, weak) NSWindow *window;
@property (nonatomic, weak) NSView *host;
@end
@implementation SparkMotionSharedMark @end

/** A haptic or sound cue of a running plan, due at an engine time (docs/motion.md#cues). */
@interface SparkMotionCue : NSObject
@property (nonatomic, copy) NSString *batch;
@property (nonatomic) NSInteger tag;
@property (nonatomic) double time;
@property (nonatomic, strong) id at;  // milliseconds, or "end"
@property (nonatomic, copy, nullable) NSString *haptic;
@property (nonatomic, copy, nullable) NSString *sound;
@end
@implementation SparkMotionCue @end

#if SPARK_TEST_DRIVER
static const NSUInteger SparkMotionCueLogLimit = 256;
#endif
static NSDictionary<NSString *, NSNumber *> *SparkHapticPatterns(void)
{
  return @{ @"generic": @(NSHapticFeedbackPatternGeneric), @"alignment": @(NSHapticFeedbackPatternAlignment), @"levelChange": @(NSHapticFeedbackPatternLevelChange) };
}

@interface SparkMotionCoordinator ()
- (BOOL)isAnimating:(NSInteger)tag;
@end

@implementation SparkMotionCoordinator {
  Engine _engine;
  NSMapTable<NSNumber *, NSView<SparkMotionHost> *> *_hosts;
  NSMutableDictionary<NSString *, SparkMotionResolve> *_completions;
  NSMutableDictionary<NSString *, SparkMotionLink *> *_links;
  NSMutableSet<SparkMotionFrameRecorder *> *_recorders;
  NSMutableArray<dispatch_block_t> *_awaitingMount;
  NSMapTable<NSView *, SparkMotionLayoutMark *> *_layoutMarks;
  NSMutableDictionary<NSString *, SparkMotionSharedMark *> *_sharedMarks;  // only the latest transaction's
  NSHashTable<NSView *> *_mounting;  // registered, not yet past their first mounting transaction
  NSUInteger _sweepGeneration;
  uint64_t _inputEvent;
  NSMutableArray<SparkMotionCue *> *_cues;     // pending, in no particular order
  CADisplayLink *_cueLink;                     // only within two frames of the next cue
  NSUInteger _cueGeneration;
#if SPARK_TEST_DRIVER
  BOOL _driven;                                // a driver run: cues are recorded, not played; windows count as visible
  NSMutableDictionary *_simulated;             // driver overrides of reduceMotion, lowPowerMode, maximumFramesPerSecond
  NSMutableArray<NSDictionary *> *_cueLog;     // cues a driver run recorded instead of playing
  NSHashTable<NSWindow *> *_hiddenWindows;     // windows simulateWindow:visible: hides (driven windows are never on screen)
#endif
  NSArray *_observers;                         // system and window observers, while a MotionView is registered
}

+ (instancetype)shared
{
  static SparkMotionCoordinator *shared;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ shared = [SparkMotionCoordinator new]; });
  return shared;
}

- (instancetype)init
{
  if ((self = [super init])) {
    _hosts = [NSMapTable strongToWeakObjectsMapTable];
    _completions = [NSMutableDictionary new];
    _links = [NSMutableDictionary new];
    _recorders = [NSMutableSet new];
    _awaitingMount = [NSMutableArray new];
    _layoutMarks = [NSMapTable weakToStrongObjectsMapTable];
    _sharedMarks = [NSMutableDictionary new];
    _mounting = [NSHashTable weakObjectsHashTable];
    _cues = [NSMutableArray new];
#if SPARK_TEST_DRIVER
    _simulated = [NSMutableDictionary new];
    _cueLog = [NSMutableArray new];
    _hiddenWindows = [NSHashTable weakObjectsHashTable];
#endif
  }
  return self;
}

- (double)now { return _engine.time(CACurrentMediaTime()); }

#pragma mark - Environment

/** A driver run's simulated value of `key` (docs/motion.md#simulation-in-the-test-driver); nil in apps. */
- (nullable id)simulated:(NSString *)key
{
#if SPARK_TEST_DRIVER
  return _simulated[key];
#else
  return nil;
#endif
}
- (BOOL)driven
{
#if SPARK_TEST_DRIVER
  return _driven;
#else
  return NO;
#endif
}
- (BOOL)reduceMotion
{
  id simulated = [self simulated:@"reduceMotion"];
  return simulated ? [simulated boolValue] : NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion;
}
- (BOOL)lowPower
{
  id simulated = [self simulated:@"lowPowerMode"];
  return simulated ? [simulated boolValue] : NSProcessInfo.processInfo.lowPowerModeEnabled;
}
/** The refresh rate of the display showing `view`'s window (the main display without one); 0 without a display. */
- (NSInteger)maximumFrameRate:(nullable NSView *)view
{
  if (id simulated = [self simulated:@"maximumFramesPerSecond"]) return [simulated integerValue];
  NSScreen *screen = view.window.screen ?: NSScreen.mainScreen;
  return screen ? screen.maximumFramesPerSecond : 0;
}
/** What motion bakes and asks the compositor for: the display's rate, at most 120 Hz, and at most 60 Hz in Low Power Mode. */
- (double)frameRate:(nullable NSView *)view
{
  const double cap = self.lowPower ? 60 : Engine::kSampleRate;
  const NSInteger maximum = [self maximumFrameRate:view];
  return maximum > 0 ? MIN((double)maximum, cap) : cap;
}
/**
 * Whether `window` is hidden, minimized or fully occluded, read from its occlusion state each time (nothing cached, so
 * a window already occluded when its first view mounts counts as hidden). A driver run's windows are never on screen:
 * there only simulateWindow:visible: hides them.
 */
- (BOOL)windowHidden:(nullable NSWindow *)window
{
  if (!window) return NO;
#if SPARK_TEST_DRIVER
  if (_driven) return [_hiddenWindows containsObject:window];
#endif
  return (window.occlusionState & NSWindowOcclusionStateVisible) == 0;
}

/** Cues follow their view's tracks: when a paused view resumed (shown, or for an operation), they move by as much. */
- (void)moveResumedCues
{
  for (const auto &[tag, shift] : _engine.takeResumeShifts())
    for (SparkMotionCue *cue in _cues) if (cue.tag == tag) cue.time += shift;
}

/**
 * Brings the engine's hidden state of a view in line with its window, re-baking and settling what changed. Operations
 * call it first: a view can mount into, or move to, an already hidden window.
 */
- (void)syncHidden:(NSInteger)tag
{
  NSView<SparkMotionHost> *host = [_hosts objectForKey:@(tag)];
  if (!host || !_engine.hasView(tag)) return;
  const BOOL hidden = [self windowHidden:host.window];
  if (hidden == _engine.hidden(tag)) return;
  std::vector<Settled> concealed;
  _engine.setHidden(tag, hidden, self.now, concealed);
  [self moveResumedCues];
  // A finished animation of a hidden window has no cue to play.
  for (const Settled &item : concealed) [self dropCues:@(item.id.c_str())];
  [self applyAll:tag];
  [self settle:concealed];
}

/** Applies a window's visibility to its views: hidden ones complete or pause, shown ones resume. */
- (void)windowVisibilityChanged:(NSWindow *)window
{
  for (NSView<SparkMotionHost> *host in [_hosts.objectEnumerator allObjects]) if (host.window == window) [self syncHidden:host.motionTag];
  [self scheduleSweep];
  [self scheduleCues];
}

/** A closing window's motion is cancelled: animations stop where they are (finished false), links and recordings end. */
- (void)windowWillClose:(NSWindow *)window
{
  std::vector<Settled> settled;
  std::vector<Property> all;
  for (int i = 0; i < PropertyCount; i++) all.push_back(Property(i));
  for (NSView<SparkMotionHost> *host in [_hosts.objectEnumerator allObjects]) {
    if (host.window != window) continue;
    const NSInteger tag = host.motionTag;
    for (NSString *identifier in [_links allKeys]) if (_links[identifier].tag == tag) [self removeLink:identifier];
    for (SparkMotionFrameRecorder *recorder in [_recorders allObjects]) if (recorder.host == host) [self finishRecorder:recorder failure:@"The MotionView's window closed during recording"];
    _engine.stop(tag, all, self.now, settled);
    [self applyAll:tag];
  }
  [self moveResumedCues];
#if SPARK_TEST_DRIVER
  [_hiddenWindows removeObject:window];
#endif
  [self settle:settled];
  [self scheduleSweep];
  [self scheduleCues];
}

/** Re-bakes running animations, for example at a new frame rate; `window` nil means every window. */
- (void)rebake:(nullable NSWindow *)window
{
  for (NSView<SparkMotionHost> *host in [_hosts.objectEnumerator allObjects])
    if ((!window || host.window == window) && [self isAnimating:host.motionTag]) [self applyAll:host.motionTag];
}

/** Observes what motion follows while a MotionView is registered, and stops with the last one. */
- (void)observeSystem:(BOOL)observe
{
  if (observe == (_observers != nil)) return;
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  if (!observe) {
    for (id observer in _observers) [center removeObserver:observer];
    _observers = nil;
    return;
  }
  __weak SparkMotionCoordinator *weakSelf = self;
  NSOperationQueue *main = NSOperationQueue.mainQueue;
  _observers = @[
    // Process info notifications arrive on arbitrary threads; the main queue owns the engine.
    [center addObserverForName:NSProcessInfoPowerStateDidChangeNotification object:nil queue:main usingBlock:^(NSNotification *) {
      SparkMotionCoordinator *coordinator = weakSelf;
      if (coordinator && ![coordinator simulated:@"lowPowerMode"]) [coordinator rebake:nil];
    }],
    [center addObserverForName:NSApplicationDidChangeScreenParametersNotification object:nil queue:main usingBlock:^(NSNotification *) { [weakSelf rebake:nil]; }],
    [center addObserverForName:NSWindowDidChangeScreenNotification object:nil queue:main usingBlock:^(NSNotification *note) { [weakSelf rebake:note.object]; }],
    [center addObserverForName:NSWindowDidChangeOcclusionStateNotification object:nil queue:main usingBlock:^(NSNotification *note) {
      SparkMotionCoordinator *coordinator = weakSelf;
      NSWindow *window = note.object;
      // A driven app's windows are never on screen; their visibility is simulated (windowHidden:).
      if (coordinator && !coordinator.driven) [coordinator windowVisibilityChanged:window];
    }],
    [center addObserverForName:NSWindowWillCloseNotification object:nil queue:main usingBlock:^(NSNotification *note) { [weakSelf windowWillClose:note.object]; }],
  ];
}

- (void)environment:(NSInteger)tag resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject
{
  [self perform:^{
    NSView<SparkMotionHost> *host = nil;
    if (tag != 0) {
      host = [self->_hosts objectForKey:@(tag)];
      if (!host) throw SparkMotionUnmounted(tag);
    }
    const NSInteger maximum = [self maximumFrameRate:host];
    resolve(SparkJSONString(@{
      @"reduceMotion": @(self.reduceMotion), @"lowPowerMode": @(self.lowPower),
      @"maximumFrameRate": maximum > 0 ? @(maximum) : (id)NSNull.null, @"frameRate": @([self frameRate:host]),
      @"windowVisible": host.window ? @(![self windowHidden:host.window]) : (id)NSNull.null,
    }));
  } reject:reject];
}

#pragma mark - Hosts

- (void)registerHost:(NSView<SparkMotionHost> *)host initial:(const Values &)initial
{
  [self observeSystem:YES];
  _engine.addView(host.motionTag, initial);
  [_hosts setObject:host forKey:@(host.motionTag)];
  [host applyMotionModel:initial];
  [_mounting addObject:host];
  if (_engine.virtualClock()) {
    CALayer *layer = host.layer;
    layer.timeOffset = [layer convertTime:CACurrentMediaTime() fromLayer:nil];
    layer.speed = 0;
  }
  NSArray<dispatch_block_t> *waiting = [_awaitingMount copy];
  [_awaitingMount removeAllObjects];
  for (dispatch_block_t retry in waiting) retry();
}

- (void)unregisterTag:(NSInteger)tag
{
  if (!_engine.hasView(tag)) return;
  for (NSString *identifier in [_links allKeys]) if (_links[identifier].tag == tag) [self removeLink:identifier];
  for (SparkMotionFrameRecorder *recorder in [_recorders allObjects])
    if (!recorder.host || recorder.host.motionTag == tag) [self finishRecorder:recorder failure:@"The MotionView unmounted during recording"];
  std::vector<Settled> settled;
  _engine.removeView(tag, settled);
  [_hosts removeObjectForKey:@(tag)];
  [self settle:settled];
  [self scheduleSweep];
  [self scheduleCues];
  if (![_hosts.objectEnumerator nextObject]) [self observeSystem:NO];
}

- (void)hostDidResize:(NSView<SparkMotionHost> *)host
{
  if ([_hosts objectForKey:@(host.motionTag)] != host) return;
  for (int i = 0; i < PropertyCount; i++)
    if (channelOf(Property(i)) == Channel::Transform && _engine.animating(host.motionTag, Property(i), self.now)) {
      [self apply:host.motionTag channel:Channel::Transform];
      return;
    }
}

- (BOOL)isAnimating:(NSInteger)tag
{
  for (int i = 0; i < PropertyCount; i++) if (_engine.animating(tag, Property(i), self.now)) return YES;
  return NO;
}

- (NSArray<NSString *> *)animatingViews
{
  NSMutableArray<NSString *> *views = [NSMutableArray new];
  for (NSView<SparkMotionHost> *host in _hosts.objectEnumerator)
    if ([self isAnimating:host.motionTag]) [views addObject:host.accessibilityIdentifier.length ? host.accessibilityIdentifier : [NSString stringWithFormat:@"MotionView %ld", (long)host.motionTag]];
  return views;
}

#pragma mark - Baking

- (CAKeyframeAnimation *)animation:(const Bake &)bake channel:(Channel)channel host:(NSView *)host begin:(double)begin rate:(double)rate
{
  CAKeyframeAnimation *animation = [CAKeyframeAnimation animationWithKeyPath:channel == Channel::Transform ? @"transform" : @"opacity"];
  NSMutableArray *values = [NSMutableArray arrayWithCapacity:bake.samples.size()];
  for (const Values &sample : bake.samples)
    [values addObject:channel == Channel::Transform ? [NSValue valueWithCATransform3D:SparkMotionCentered(SparkMotionTransform(sample), host)] : @(sample[Opacity])];
  animation.values = values;
  animation.duration = bake.duration;
  animation.beginTime = begin;
  animation.calculationMode = kCAAnimationLinear;
  // ProMotion displays run motion at 120 Hz only when asked; others (and Low Power Mode) cap it (docs/motion.md#frame-rate-and-power).
  animation.preferredFrameRateRange = CAFrameRateRangeMake(rate / 2, rate, rate);
  return animation;
}

/** Replaces one channel's compositor animations with a bake from now. */
- (void)apply:(NSInteger)tag channel:(Channel)channel
{
  NSView<SparkMotionHost> *host = [_hosts objectForKey:@(tag)];
  if (!host) return;
  const double now = self.now, rate = [self frameRate:host];
  const ChannelBake bake = _engine.bake(tag, channel, now, rate);
  const BOOL transform = channel == Channel::Transform;
  CALayer *layer = host.layer;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  [layer removeAnimationForKey:transform ? kTransformLead : kOpacityLead];
  [layer removeAnimationForKey:transform ? kTransformLoop : kOpacityLoop];
  Values model = host.motionModel;
  for (int i = 0; i < PropertyCount; i++) if (channelOf(Property(i)) == channel) model[i] = bake.model[i];
  [host applyMotionModel:model];
  const double local = [layer convertTime:CACurrentMediaTime() fromLayer:nil];
  if (bake.loop) {
    CAKeyframeAnimation *loop = [self animation:*bake.loop channel:channel host:host begin:local + bake.loop->begin - now rate:rate];
    loop.repeatCount = HUGE_VALF;
    [layer addAnimation:loop forKey:transform ? kTransformLoop : kOpacityLoop];
  }
  // Added last so it wins over the loop until the loop's begin time.
  if (bake.lead) [layer addAnimation:[self animation:*bake.lead channel:channel host:host begin:local + bake.lead->begin - now rate:rate] forKey:transform ? kTransformLead : kOpacityLead];
  auto rotates = [](const std::optional<Bake> &part) {
    if (part) for (const Values &sample : part->samples) if (sample[Rotate] != 0) return true;
    return false;
  };
  if (transform && (model[Rotate] != 0 || rotates(bake.lead) || rotates(bake.loop))) layer.allowsEdgeAntialiasing = YES;
  [CATransaction commit];
}

- (void)applyAll:(NSInteger)tag
{
  [self apply:tag channel:Channel::Opacity];
  [self apply:tag channel:Channel::Transform];
}

#pragma mark - Completion

- (void)settle:(const std::vector<Settled> &)settled
{
  for (const Settled &item : settled) {
    NSString *identifier = @(item.id.c_str());
    SparkMotionResolve resolve = _completions[identifier];
    [_completions removeObjectForKey:identifier];
    // An interrupted, stopped or unmounted animation plays none of its remaining cues; a finished one plays its end cue.
    if (!item.finished) [self dropCues:identifier];
    if (resolve) resolve(SparkJSONString(@{ @"finished": @(item.finished) }));
  }
}

/** One-shot timer for the next completion; a timeout bounds work, it never polls. */
- (void)scheduleSweep
{
  NSUInteger generation = ++_sweepGeneration;
  if (_engine.virtualClock()) return;
  auto next = _engine.nextCompletion();
  if (!next) return;
  const double delay = MAX(0, *next - CACurrentMediaTime()) + 0.001;
  __weak SparkMotionCoordinator *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    SparkMotionCoordinator *coordinator = weakSelf;
    if (!coordinator || coordinator->_sweepGeneration != generation) return;
    [coordinator sweep];
  });
}

- (void)sweep
{
  std::vector<Settled> settled;
  _engine.sweep(self.now, settled);
  [self settle:settled];
  [self scheduleSweep];
}

#pragma mark - Commands

/** Runs a command, turning every C++ failure into a rejection: no request can throw past the module. */
- (void)perform:(void (^)(void))operation reject:(SparkMotionReject)reject
{
  [self perform:operation reject:reject until:CACurrentMediaTime() + SparkMotionMountWait];
}

/**
 * Fabric can deliver a module call made from a mount effect before the mount transaction that
 * registers its MotionView. Operations validate before any side effect, so one that names an
 * unregistered view is retried when the next view registers, and rejected at `deadline`.
 */
- (void)perform:(void (^)(void))operation reject:(SparkMotionReject)reject until:(double)deadline
{
  // An operation on a paused view resumes it while it runs (also when it then fails): its cues move with its tracks.
  try { operation(); [self moveResumedCues]; return; }
  catch (const Failure &failure) {
    [self moveResumedCues];
    if (!failure.unmounted || CACurrentMediaTime() >= deadline) { reject(@(failure.code.c_str()), @(failure.message.c_str())); return; }
  }
  catch (const std::exception &error) { [self moveResumedCues]; reject(@"E_NATIVE", [NSString stringWithFormat:@"Motion engine failure: %s", error.what()]); return; }
  __block BOOL done = NO;
  __weak SparkMotionCoordinator *weakSelf = self;
  dispatch_block_t retry = ^{
    if (done) return;
    done = YES;
    [weakSelf perform:operation reject:reject until:deadline];
  };
  [_awaitingMount addObject:retry];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)((deadline - CACurrentMediaTime()) * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    SparkMotionCoordinator *coordinator = weakSelf;
    if (done || !coordinator) return;
    done = YES;
    [coordinator->_awaitingMount removeObject:retry];
    [coordinator perform:operation reject:reject until:0];
  });
}

static Tracks SparkTracks(id value, NSString *name)
{
  Tracks parsed;
  NSDictionary *tracks = SparkObject(value, name);
  for (id property in tracks) parsed.emplace_back(SparkProperty(property), SparkSpec(tracks[property], SparkProperty(property)));
  return parsed;
}
static NSString *SparkOneOf(NSDictionary *object, NSString *key, NSArray<NSString *> *values)
{
  id value = object[key] ?: values.firstObject;
  if (![values containsObject:value]) throw SparkMotionInvalid([NSString stringWithFormat:@"%@ is %@", key, [values componentsJoinedByString:@", "]]);
  return value;
}
/** A cue's shape; its time is checked against the plan by the engine. */
static SparkMotionCue *SparkCue(id value)
{
  NSDictionary *object = SparkObject(value, @"A cue");
  SparkMotionCue *cue = [SparkMotionCue new];
  cue.at = [object[@"at"] isEqual:@"end"] ? @"end" : @(SparkRequiredNumber(object, @"at"));
  if (id haptic = object[@"haptic"]) {
    if (!SparkHapticPatterns()[haptic]) throw SparkMotionInvalid(@"haptic is generic, alignment or levelChange");
    cue.haptic = haptic;
  }
  if (object[@"sound"]) {
    cue.sound = SparkString(object, @"sound");
    if (![NSSound soundNamed:cue.sound]) throw Failure{"E_NOT_FOUND", std::string("No sound is named ") + cue.sound.UTF8String};
  }
  if (!cue.haptic && !cue.sound) throw SparkMotionInvalid(@"A cue needs a haptic or a sound");
  return cue;
}

- (void)run:(NSDictionary *)request resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject
{
  [self perform:^{
    Plan plan;
    NSString *identifier = SparkString(request, @"id");
    plan.id = identifier.UTF8String;
    for (id value in SparkArray(request[@"groups"], @"groups")) {
      NSDictionary *group = SparkObject(value, @"A step");
      Group parsed;
      parsed.view = SparkTag(group);
      id after = group[@"after"];
      if (after != nil && ![after isEqual:@"previous"] && ![after isEqual:@"start"]) throw SparkMotionInvalid(@"after is start or previous");
      parsed.afterPrevious = [after isEqual:@"previous"];
      parsed.offset = SparkNumber(group, @"offsetMs", 0) / 1000;
      parsed.tracks = SparkTracks(group[@"tracks"], @"tracks");
      if (group[@"reducedTracks"]) parsed.reduced = SparkTracks(group[@"reducedTracks"], @"reducedTracks");
      plan.groups.push_back(parsed);
    }
    NSString *reduce = SparkOneOf(request, @"reducedMotion", @[@"fade", @"instant", @"play"]);
    plan.reduce = [reduce isEqual:@"fade"] ? Reduce::Fade : [reduce isEqual:@"instant"] ? Reduce::Instant : Reduce::Play;
    plan.pauseWhenHidden = [SparkOneOf(request, @"whenHidden", @[@"complete", @"pause"]) isEqual:@"pause"];
    plan.reduceMotion = self.reduceMotion;
    NSMutableArray<SparkMotionCue *> *cues = [NSMutableArray new];
    for (id value in request[@"cues"] ? SparkArray(request[@"cues"], @"cues") : @[]) {
      SparkMotionCue *cue = SparkCue(value);
      plan.cues.push_back([cue.at isEqual:@"end"] ? std::nullopt : std::optional<double>([cue.at doubleValue] / 1000));
      [cues addObject:cue];
    }
    for (const Group &group : plan.groups) [self syncHidden:group.view];
    std::vector<Settled> settled;
    std::vector<int64_t> touched;
    const double now = self.now;
    const Started started = self->_engine.run(plan, now, settled, touched);
    [self moveResumedCues];  // before this plan's cues, which are timed from now
    self->_completions[identifier] = resolve;
    for (NSUInteger i = 0; i < cues.count; i++) {
      cues[i].batch = identifier;
      cues[i].tag = plan.groups.front().view;
      cues[i].time = now + started.cues[i];
      [self->_cues addObject:cues[i]];
    }
    for (int64_t tag : touched) [self applyAll:tag];
    // Cues of an animation that finished at once in a hidden window are not played.
    for (const Settled &item : settled) if (item.id == plan.id) [self dropCues:identifier];
    [self settle:settled];
    [self scheduleSweep];
    [self scheduleCues];
  } reject:reject];
}

- (void)stopAnimation:(NSString *)identifier resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject
{
  [self perform:^{
    std::vector<Settled> settled;
    std::vector<int64_t> touched;
    self->_engine.stopBatch(identifier.UTF8String, self.now, settled, touched);
    for (int64_t tag : touched) [self applyAll:tag];
    [self settle:settled];
    [self scheduleSweep];
    resolve(nil);
  } reject:reject];
}

- (void)set:(NSDictionary *)request resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject
{
  [self perform:^{
    const NSInteger tag = SparkTag(request);
    std::vector<std::pair<Property, double>> values;
    NSDictionary *input = SparkObject(request[@"values"], @"values");
    for (id name in input) values.emplace_back(SparkProperty(name), SparkNumberValue(input[name], name));
    [self syncHidden:tag];
    std::vector<Settled> settled;
    self->_engine.set(tag, values, self.now, settled);
    [self applyAll:tag];
    [self settle:settled];
    [self scheduleSweep];
    resolve(nil);
  } reject:reject];
}

- (void)stop:(NSDictionary *)request resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject
{
  [self perform:^{
    const NSInteger tag = SparkTag(request);
    std::vector<Property> properties;
    for (id name in SparkArray(request[@"properties"], @"properties")) properties.push_back(SparkProperty(name));
    [self syncHidden:tag];
    std::vector<Settled> settled;
    self->_engine.stop(tag, properties, self.now, settled);
    [self applyAll:tag];
    [self settle:settled];
    [self scheduleSweep];
    resolve(nil);
  } reject:reject];
}

- (void)state:(NSInteger)tag resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject
{
  [self perform:^{
    const double now = self.now;
    Values values, velocities;
    NSMutableArray *animating = [NSMutableArray new];
    for (int i = 0; i < PropertyCount; i++) {
      const State state = self->_engine.state(tag, Property(i), now);
      values[i] = state.value;
      velocities[i] = state.velocity;
      if (self->_engine.animating(tag, Property(i), now)) [animating addObject:@(propertyName(Property(i)))];
    }
    resolve(SparkJSONString(@{ @"values": SparkValuesObject(values), @"velocities": SparkValuesObject(velocities), @"animating": animating }));
  } reject:reject];
}

#pragma mark - Cues

- (void)dropCues:(NSString *)batch
{
  [_cues filterUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(SparkMotionCue *cue, NSDictionary *) { return ![cue.batch isEqual:batch]; }]];
}

/**
 * Cues play on the display frame that first shows their time (the link's target timestamp), so a haptic or sound lands
 * with the frame it belongs to. Haptics are performed when that frame's drawing completes. On the virtual clock they
 * play as the clock passes them. A cue of a paused view waits; one of a hidden window's finished animation is dropped.
 */
- (void)scheduleCues
{
  NSUInteger generation = ++_cueGeneration;
  SparkMotionCue *next = nil;
  NSView *host = nil;
  for (SparkMotionCue *cue in _cues) {
    NSView *owner = [_hosts objectForKey:@(cue.tag)];
    if (owner && !_engine.paused(cue.tag) && (!next || cue.time < next.time)) { next = cue; host = owner; }
  }
  // A display link runs only within two frames of the next cue; until then one one-shot timer waits (nothing polls).
  const double lead = next ? next.time - self.now - 2 / [self frameRate:host] : 0;
  if (!next || _engine.virtualClock() || lead > 0) { [_cueLink invalidate]; _cueLink = nil; }
  if (!next || _engine.virtualClock()) return;
  if (lead > 0) {
    __weak SparkMotionCoordinator *weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(lead * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      SparkMotionCoordinator *coordinator = weakSelf;
      if (coordinator && coordinator->_cueGeneration == generation) [coordinator scheduleCues];
    });
    return;
  }
  if (_cueLink) return;
  // As for frame recording: a window that is not on screen has no display link of its own.
  NSScreen *screen = host.window.isVisible ? nil : host.window.screen ?: NSScreen.mainScreen;
  if (!host.window.isVisible && !screen) return;
  _cueLink = screen ? [screen displayLinkWithTarget:self selector:@selector(cueFrame:)] : [host displayLinkWithTarget:self selector:@selector(cueFrame:)];
  const double rate = [self frameRate:host];
  _cueLink.preferredFrameRateRange = CAFrameRateRangeMake(rate / 2, rate, rate);
  [_cueLink addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
}

- (void)cueFrame:(CADisplayLink *)link
{
  [self playCuesUntil:link.targetTimestamp frame:link.targetTimestamp];
  [self scheduleCues];
}

/** Plays the cues due by `time`; `frame` is the presentation time of the frame they play on (nil: the cue's own time). */
- (void)playCuesUntil:(double)time frame:(double)frame
{
  NSMutableArray<SparkMotionCue *> *due = [NSMutableArray new];
  for (SparkMotionCue *cue in _cues) if (cue.time <= time + 1e-6 && !_engine.paused(cue.tag)) [due addObject:cue];
  [due sortUsingComparator:^NSComparisonResult(SparkMotionCue *a, SparkMotionCue *b) { return [@(a.time) compare:@(b.time)]; }];
  [_cues removeObjectsInArray:due];
  for (SparkMotionCue *cue in due) {
#if SPARK_TEST_DRIVER
    if (_driven) {
      [_cueLog addObject:@{ @"tag": @(cue.tag), @"animation": cue.batch, @"at": cue.at, @"haptic": cue.haptic ?: NSNull.null, @"sound": cue.sound ?: NSNull.null,
        @"timeMs": @(cue.time * 1000), @"frameMs": @((std::isnan(frame) ? cue.time : frame) * 1000), @"played": @NO }];
      if (_cueLog.count > SparkMotionCueLogLimit) [_cueLog removeObjectAtIndex:0];
      continue;
    }
#endif
    if (cue.haptic) [NSHapticFeedbackManager.defaultPerformer performFeedbackPattern:(NSHapticFeedbackPattern)SparkHapticPatterns()[cue.haptic].integerValue performanceTime:NSHapticFeedbackPerformanceTimeDrawCompleted];
    if (cue.sound) [[[NSSound soundNamed:cue.sound] copy] play];
  }
}

#pragma mark - Scroll links

static NSView *SparkFindNativeID(NSView *view, NSString *nativeID)
{
  if ([view respondsToSelector:NSSelectorFromString(@"nativeId")] && [[view valueForKey:@"nativeId"] isEqual:nativeID]) return view;
  for (NSView *child in view.subviews) if (NSView *found = SparkFindNativeID(child, nativeID)) return found;
  return nil;
}
static NSScrollView *SparkFindScrollView(NSView *view)
{
  if ([view isKindOfClass:NSScrollView.class]) return (NSScrollView *)view;
  for (NSView *child in view.subviews) if (NSScrollView *found = SparkFindScrollView(child)) return found;
  return nil;
}

- (void)link:(NSDictionary *)request resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject
{
  [self perform:^{
    NSString *identifier = SparkString(request, @"id"), *nativeID = SparkString(request, @"nativeID"), *axis = SparkString(request, @"axis");
    if (self->_links[identifier]) throw Failure{"E_ALREADY_EXISTS", "A scroll link with this id exists"};
    if (![axis isEqual:@"x"] && ![axis isEqual:@"y"]) throw SparkMotionInvalid(@"axis is x or y");
    const NSInteger tag = SparkTag(request);
    SparkMotionLink *link = [SparkMotionLink new];
    link.tag = tag;
    link.horizontal = [axis isEqual:@"x"];
    link.clamp = SparkBool(request, @"clamp", YES);
    link->input = SparkNumbers(request[@"input"], @"input");
    NSDictionary *output = SparkObject(request[@"output"], @"output");
    if (!output.count) throw SparkMotionInvalid(@"A scroll link needs at least one output property");
    std::vector<Property> properties;
    for (id name in output) {
      const Property property = SparkProperty(name);
      link->outputs.emplace_back(property, SparkNumbers(output[name], name));
      validateRange(link->input, link->outputs.back().second);
      properties.push_back(property);
    }
    NSView<SparkMotionHost> *host = [self->_hosts objectForKey:@(tag)];
    if (!host) throw SparkMotionUnmounted(tag);
    for (Property property : properties)
      if (self->_engine.linked(tag, property)) throw Failure{"E_BUSY", std::string(propertyName(property)) + " already has a scroll link"};
    if (!host.window) throw Failure{"E_NOT_FOUND", "The MotionView is not in a window"};
    NSView *source = SparkFindNativeID(host.window.contentView, nativeID);
    NSScrollView *scrollView = source ? SparkFindScrollView(source) : nil;
    if (!scrollView) throw Failure{"E_NOT_FOUND", std::string("No scroll view with nativeID ") + nativeID.UTF8String + " is in the MotionView's window"};
    link.clip = scrollView.contentView;
    std::vector<Settled> settled;
    self->_engine.stop(tag, properties, self.now, settled);
    for (Property property : properties) self->_engine.link(tag, property, true);
    scrollView.contentView.postsBoundsChangedNotifications = YES;
    __weak SparkMotionCoordinator *weakSelf = self;
    __weak SparkMotionLink *weakLink = link;
    link.observer = [NSNotificationCenter.defaultCenter addObserverForName:NSViewBoundsDidChangeNotification object:scrollView.contentView queue:nil usingBlock:^(NSNotification *) {
      SparkMotionLink *current = weakLink;
      if (current) [weakSelf updateLink:current];
    }];
    self->_links[identifier] = link;
    [self updateLink:link];
    [self settle:settled];
    [self scheduleSweep];
    resolve(nil);
  } reject:reject];
}

- (void)updateLink:(SparkMotionLink *)link
{
  NSClipView *clip = link.clip;
  if (!clip) return;
  const double offset = link.horizontal ? clip.bounds.origin.x : clip.bounds.origin.y;
  BOOL transform = NO, opacity = NO;
  for (const auto &[property, values] : link->outputs) {
    _engine.setModel(link.tag, property, interpolate(link->input, values, offset, link.clamp));
    (channelOf(property) == Channel::Transform ? transform : opacity) = YES;
  }
  if (opacity) [self apply:link.tag channel:Channel::Opacity];
  if (transform) [self apply:link.tag channel:Channel::Transform];
}

- (void)removeLink:(NSString *)identifier
{
  SparkMotionLink *link = _links[identifier];
  if (!link) return;
  [NSNotificationCenter.defaultCenter removeObserver:link.observer];
  [_links removeObjectForKey:identifier];
  if (_engine.hasView(link.tag)) for (const auto &[property, values] : link->outputs) _engine.link(link.tag, property, false);
}

- (void)unlink:(NSString *)identifier resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject
{
  [self removeLink:identifier];
  resolve(nil);
}

#pragma mark - Layout and shared elements

/** The view's layout box (motion transforms excluded) in `reference`, with a top-left origin. */
static NSRect SparkLayoutRect(NSView *view, NSView *reference)
{
  NSRect rect = [view convertRect:view.bounds toView:reference];
  if (!reference.isFlipped) rect.origin.y = NSHeight(reference.bounds) - NSMaxY(rect);
  return rect;
}

/** Layout boxes are compared in the nearest ancestor that animates its own layout (it carries this view), or the window. */
- (NSView *)layoutReference:(NSView *)host
{
  for (NSView *view = host.superview; view; view = view.superview)
    if ([view conformsToProtocol:@protocol(SparkMotionHost)] && ((NSView<SparkMotionHost> *)view).motionLayout && [_hosts objectForKey:@(((NSView<SparkMotionHost> *)view).motionTag)] == view) return view;
  return host.window.contentView;
}

- (BOOL)isRegistered:(NSView<SparkMotionHost> *)host { return host.window && [_hosts objectForKey:@(host.motionTag)] == host; }

- (void)hostWillMount:(NSView<SparkMotionHost> *)host surface:(NSInteger)surface transaction:(NSInteger)transaction
{
  if (![self isRegistered:host]) return;
  if (host.motionLayout) {
    SparkMotionLayoutMark *mark = [SparkMotionLayoutMark new];
    mark.surface = surface;
    mark.transaction = transaction;
    mark.reference = [self layoutReference:host];
    mark.rect = SparkLayoutRect(host, mark.reference);
    [_layoutMarks setObject:mark forKey:host];
  }
  if (NSString *sharedId = host.motionSharedId) {
    const double now = self.now;
    const NSRect rect = SparkLayoutRect(host, host.window.contentView);
    const Property properties[4] = {TranslateX, TranslateY, ScaleX, ScaleY};
    State states[4];
    for (int i = 0; i < 4; i++) states[i] = _engine.state(host.motionTag, properties[i], now);
    SparkMotionSharedMark *mark = [SparkMotionSharedMark new];
    mark.surface = surface;
    mark.transaction = transaction;
    mark.window = host.window;
    mark.host = host;
    const double layout[4] = {NSMidX(rect), NSMidY(rect), NSWidth(rect), NSHeight(rect)};
    for (int i = 0; i < 4; i++) {
      // Motion transforms are about the centre: translation moves it, scale multiplies the size.
      mark->box[i] = i < 2 ? layout[i] + states[i].value : layout[i] * states[i].value;
      mark->velocity[i] = i < 2 ? states[i].velocity : layout[i] * states[i].velocity;
    }
    // A destination only matches marks of its own transaction, and transactions mount one after another, so marks of
    // an earlier transaction are dropped: the dictionary holds at most the shared elements of one transaction.
    SparkMotionSharedMark *any = _sharedMarks.allValues.firstObject;
    if (any && (any.surface != surface || any.transaction != transaction)) [_sharedMarks removeAllObjects];
    _sharedMarks[sharedId] = mark;
  }
}

- (void)hostDidMount:(NSView<SparkMotionHost> *)host surface:(NSInteger)surface transaction:(NSInteger)transaction
{
  const BOOL mounted = [_mounting containsObject:host];
  [_mounting removeObject:host];
  SparkMotionLayoutMark *before = [_layoutMarks objectForKey:host];
  [_layoutMarks removeObjectForKey:host];
  if (![self isRegistered:host]) return;
  std::vector<std::pair<Property, State>> from;
  if (mounted) {
    // A shared element animates from where another one with its id showed when this transaction began.
    SparkMotionSharedMark *source = host.motionSharedId ? _sharedMarks[host.motionSharedId] : nil;
    if (!source || source.surface != surface || source.transaction != transaction || source.window != host.window || source.host == host) return;
    const NSRect rect = SparkLayoutRect(host, host.window.contentView);
    if (NSWidth(rect) <= 0 || NSHeight(rect) <= 0) return;
    from = {{TranslateX, {source->box[0] - NSMidX(rect), source->velocity[0]}}, {TranslateY, {source->box[1] - NSMidY(rect), source->velocity[1]}},
      {ScaleX, {source->box[2] / NSWidth(rect), source->velocity[2] / NSWidth(rect)}}, {ScaleY, {source->box[3] / NSHeight(rect), source->velocity[3] / NSHeight(rect)}}};
  } else {
    // A live window resize re-lays out on every step; following it with springs would trail the window edge.
    if (!before || before.surface != surface || before.transaction != transaction || host.window.inLiveResize) return;
    NSView *reference = [self layoutReference:host];
    if (reference != before.reference) return;
    const NSRect old = before.rect, rect = SparkLayoutRect(host, reference);
    if (NSEqualRects(old, rect)) return;
    const double now = self.now;
    const BOOL frame = [host.motionLayout isEqual:@"frame"];
    // `frame` keeps the centre (transforms are about it) and scales the size; `position` keeps the leading top corner.
    const NSPoint was = frame ? NSMakePoint(NSMidX(old), NSMidY(old)) : NSMakePoint(host.motionRightToLeft ? NSMaxX(old) : NSMinX(old), NSMinY(old));
    const NSPoint is = frame ? NSMakePoint(NSMidX(rect), NSMidY(rect)) : NSMakePoint(host.motionRightToLeft ? NSMaxX(rect) : NSMinX(rect), NSMinY(rect));
    auto shifted = [&](Property property, double by, double ratio) {
      const State state = _engine.state(host.motionTag, property, now);
      from.emplace_back(property, State{state.value * ratio + by, state.velocity * ratio});
    };
    shifted(TranslateX, was.x - is.x, 1);
    shifted(TranslateY, was.y - is.y, 1);
    if (frame && NSWidth(rect) > 0 && NSHeight(rect) > 0) {
      shifted(ScaleX, 0, NSWidth(old) / NSWidth(rect));
      shifted(ScaleY, 0, NSHeight(old) / NSHeight(rect));
    }
  }
  [self handoff:host from:from];
}

/** Starts the host's transition from `from` to where each property was heading. */
- (void)handoff:(NSView<SparkMotionHost> *)host from:(const std::vector<std::pair<Property, State>> &)from
{
  NSDictionary *transition = host.motionTransition;
  if (!transition) return;
  try {
    NSMutableDictionary *template_ = [transition mutableCopy];
    template_[@"to"] = @0;  // each property's own target replaces it
    // A view in a hidden window completes its hand-off at once, like any plan; under Reduce Motion it plays the alternate.
    [self syncHidden:host.motionTag];
    std::vector<Settled> settled;
    const BOOL handed = _engine.handoff(host.motionTag, from, SparkSpec(template_, TranslateX), self.now, settled, self.reduceMotion);
    [self moveResumedCues];
    if (!handed) return;
    [self applyAll:host.motionTag];  // the Reduce Motion alternate also fades opacity
    [self settle:settled];
    [self scheduleSweep];
  } catch (const Failure &failure) {
    [self moveResumedCues];
    // JavaScript validated the transition; only a malformed native prop gets here, and no caller awaits a hand-off.
    NSLog(@"Spark motion: layout transition rejected: %s", failure.message.c_str());
  }
}

#if SPARK_TEST_DRIVER
#pragma mark - Clock

- (void)setClock:(NSString *)mode resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject
{
  const BOOL virtualClock = [mode isEqual:@"virtual"];
  if (!virtualClock && ![mode isEqual:@"real"]) { reject(@"E_INVALID_ARGUMENT", @"The motion clock mode is real or virtual"); return; }
  if (virtualClock == _engine.virtualClock()) { resolve(nil); return; }
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  if (virtualClock) {
    _engine.setVirtualClock(true, CACurrentMediaTime());
    for (NSView *host in _hosts.objectEnumerator) {
      host.layer.timeOffset = [host.layer convertTime:CACurrentMediaTime() fromLayer:nil];
      host.layer.speed = 0;
    }
  } else {
    for (NSView *host in _hosts.objectEnumerator) { host.layer.speed = 1; host.layer.timeOffset = 0; }
    const double shift = _engine.setVirtualClock(false, CACurrentMediaTime());
    for (SparkMotionCue *cue in _cues) cue.time += shift;
    for (NSView<SparkMotionHost> *host in _hosts.objectEnumerator) [self applyAll:host.motionTag];
  }
  [CATransaction commit];
  [self scheduleSweep];
  [self scheduleCues];
  resolve(nil);
}

- (void)advanceClock:(double)milliseconds resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject
{
  [self perform:^{
    [self advance:milliseconds / 1000];
    resolve(nil);
  } reject:reject];
}

/** Moves engine time and every motion layer's time forward together; throws Failure on the real clock. */
- (void)advance:(double)seconds
{
  _engine.advance(seconds);
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  for (NSView *host in _hosts.objectEnumerator) host.layer.timeOffset += seconds;
  [CATransaction commit];
  [self playCuesUntil:self.now frame:NAN];
  [self sweep];
}

- (void)clock:(SparkMotionResolve)resolve
{
  resolve(SparkJSONString(@{ @"mode": _engine.virtualClock() ? @"virtual" : @"real", @"timeMs": @(self.now * 1000) }));
}

#pragma mark - Motion telemetry

static id SparkMilliseconds(double seconds) { return std::isfinite(seconds) ? @(seconds * 1000) : (id)NSNull.null; }
static NSDictionary *SparkStateObject(const State &state) { return @{ @"value": @(state.value), @"velocity": @(state.velocity) }; }

- (NSView<SparkMotionHost> *)hostForView:(NSView *)view
{
  for (NSView *candidate = view; candidate; candidate = candidate.superview)
    if ([candidate conformsToProtocol:@protocol(SparkMotionHost)]) {
      NSView<SparkMotionHost> *host = (NSView<SparkMotionHost> *)candidate;
      if ([_hosts objectForKey:@(host.motionTag)] == host) return host;
    }
  return nil;
}

- (void)recordTelemetry
{
  _engine.setTelemetry(true);
  _driven = YES;
  // Pinned like the driver's other host settings: flows behave the same on a Mac with Reduce Motion or Low Power Mode
  // on, until simulateSystemEvent changes them.
  _simulated[@"reduceMotion"] = @NO;
  _simulated[@"lowPowerMode"] = @NO;
}

- (void)simulate:(NSDictionary *)values
{
  // null stops simulating a value (simulateDisplays' restore).
  for (NSString *key in @[@"reduceMotion", @"lowPowerMode", @"maximumFramesPerSecond"]) {
    if (values[key] == NSNull.null) [_simulated removeObjectForKey:key];
    else if (values[key]) _simulated[key] = values[key];
  }
  [self rebake:nil];
  [self scheduleCues];
}

- (void)simulateWindow:(NSWindow *)window visible:(BOOL)visible
{
  if (visible) [_hiddenWindows removeObject:window]; else [_hiddenWindows addObject:window];
  [self windowVisibilityChanged:window];
}
- (void)noteInput { _inputEvent = _engine.events(); }

- (NSDictionary *)telemetry:(NSInteger)tag now:(double)now
{
  [self sweep];  // what ended by now settles first (its timer may not have fired yet), so values are final values
  Values values, velocities;
  NSMutableArray *animating = [NSMutableArray new];
  for (int i = 0; i < PropertyCount; i++) {
    const State state = _engine.state(tag, Property(i), now);
    values[i] = state.value;
    velocities[i] = state.velocity;
    if (_engine.animating(tag, Property(i), now)) [animating addObject:@(propertyName(Property(i)))];
  }
  NSMutableArray *cues = [NSMutableArray new];
  const Episode *episode = _engine.episode(tag);
  for (NSDictionary *cue in _cueLog) if ([cue[@"tag"] integerValue] == tag && (!episode || [cue[@"timeMs"] doubleValue] >= episode->start * 1000 - 1e-6)) [cues addObject:cue];
  for (SparkMotionCue *cue in _cues)
    if (cue.tag == tag) [cues addObject:@{ @"tag": @(tag), @"animation": cue.batch, @"at": cue.at, @"haptic": cue.haptic ?: NSNull.null, @"sound": cue.sound ?: NSNull.null,
      @"timeMs": @(cue.time * 1000), @"frameMs": NSNull.null, @"played": @NO }];
  NSView<SparkMotionHost> *host = [_hosts objectForKey:@(tag)];
  NSMutableDictionary *reply = [@{ @"tag": @(tag), @"clock": _engine.virtualClock() ? @"virtual" : @"real", @"timeMs": @(now * 1000),
    @"values": SparkValuesObject(values), @"velocities": SparkValuesObject(velocities), @"animating": animating, @"motion": NSNull.null,
    @"frameRate": @([self frameRate:host]), @"hidden": @(_engine.hidden(tag)), @"paused": @(_engine.paused(tag)), @"cues": cues } mutableCopy];
  if (!episode) return reply;
  const BOOL settled = animating.count == 0;
  NSMutableDictionary *kinds = [NSMutableDictionary new];
  NSMutableArray *moved = [NSMutableArray new];
  for (int i = 0; i < PropertyCount; i++) {
    if (episode->kinds[i]) kinds[@(propertyName(Property(i)))] = @(kindName(*episode->kinds[i]));
    if (episode->segments[i].size() > 1 || episode->segments[i].front().track) [moved addObject:@(propertyName(Property(i)))];
  }
  NSMutableArray *interruptions = [NSMutableArray new];
  for (const Interruption &interruption : episode->interruptions)
    [interruptions addObject:@{ @"timeMs": @(interruption.time * 1000), @"property": @(propertyName(interruption.property)),
      @"before": SparkStateObject(interruption.before), @"after": SparkStateObject(interruption.after) }];
  const double span = episode->end - episode->start;
  id progress = settled ? @1 : !std::isfinite(span) ? (id)NSNull.null : @(span > 0 ? std::clamp((now - episode->start) / span, 0.0, 1.0) : 1.0);
  reply[@"motion"] = @{
    @"startMs": @(episode->start * 1000), @"endMs": SparkMilliseconds(episode->end), @"latestMs": @(episode->latest * 1000),
    @"settled": @(settled), @"progress": progress, @"afterInput": @(episode->event > _inputEvent),
    @"startValues": SparkValuesObject(episode->startValues), @"properties": moved, @"kinds": kinds, @"interruptions": interruptions,
    @"truncated": @(episode->truncated),
  };
  return reply;
}

- (void)telemetry:(NSInteger)tag resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject
{
  [self perform:^{
    if (![self->_hosts objectForKey:@(tag)]) throw SparkMotionUnmounted(tag);
    resolve([self telemetry:tag now:self.now]);
  } reject:reject];
}

/** When an episode reaches `until`, in engine time; throws Failure when it never does. */
static double SparkMotionTarget(const Episode &episode, NSDictionary *until)
{
  if (until[@"progress"]) {
    const double progress = SparkNumberValue(until[@"progress"], @"progress");
    if (!(progress >= 0 && progress <= 1)) throw SparkMotionInvalid(@"progress is between 0 and 1");
    if (std::isinf(episode.end)) throw Failure{"E_UNSUPPORTED_OPTION", "The motion repeats forever, so it has no progress; wait for elapsedMs instead"};
    return episode.start + progress * (episode.end - episode.start);
  }
  if (until[@"elapsedMs"]) {
    const double elapsed = SparkNumberValue(until[@"elapsedMs"], @"elapsedMs");
    if (!(elapsed >= 0 && std::isfinite(elapsed))) throw SparkMotionInvalid(@"elapsedMs is a finite number of at least 0");
    return std::min(episode.start + elapsed / 1000, episode.end);
  }
  if (std::isinf(episode.end)) throw Failure{"E_UNSUPPORTED_OPTION", "The motion repeats forever, so it never settles; wait for elapsedMs instead"};
  return episode.end;
}

- (void)waitForMotion:(NSInteger)tag until:(NSDictionary *)until timeout:(double)timeout resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject
{
  NSUInteger kinds = (until[@"progress"] != nil) + (until[@"elapsedMs"] != nil) + (SparkIsBoolean(until[@"settled"]) && [until[@"settled"] boolValue]);
  if (kinds != 1 || until.count != 1) { reject(@"E_INVALID_ARGUMENT", @"waitForMotion waits for one of progress, elapsedMs or settled: true"); return; }
  const double deadline = CACurrentMediaTime() + timeout;
  __weak SparkMotionCoordinator *weakSelf = self;
  __block NSTimer *timer = nil;
  __block BOOL done = NO;
  void (^finish)(void) = ^{ done = YES; [timer invalidate]; timer = nil; };
  // Returns YES once it has replied.
  BOOL (^check)(void) = ^BOOL {
    SparkMotionCoordinator *coordinator = weakSelf;
    if (!coordinator) return NO;
    try {
      if (![coordinator->_hosts objectForKey:@(tag)]) throw SparkMotionUnmounted(tag);
      const Episode *episode = coordinator->_engine.episode(tag);
      const BOOL current = episode && episode->event > coordinator->_inputEvent;
      if (current) {
        const double target = SparkMotionTarget(*episode, until), now = coordinator.now;
        const BOOL progress = until[@"progress"] != nil;
        if (progress && now > target + 1e-9 && coordinator->_engine.virtualClock())
          throw Failure{"E_PASSED", "The motion is already past that progress on the virtual clock (" + std::to_string((now - episode->start) / (episode->end - episode->start)) + ")"};
        if (now < target - 1e-9 && coordinator->_engine.virtualClock()) [coordinator advance:target - now];
        if (coordinator.now >= target - 1e-9) {
          if (progress && [until[@"progress"] doubleValue] < 1 && ![coordinator isAnimating:tag])
            throw Failure{"E_PASSED", "The motion settled before reaching that progress"};
          finish();
          resolve([coordinator telemetry:tag now:coordinator.now]);
          return YES;
        }
      }
      if (CACurrentMediaTime() >= deadline) {
        finish();
        reject(@"E_TIMEOUT", current ? @"The motion did not get there before the timeout" : @"No motion of the view started or was interrupted after the last driver input");
        return YES;
      }
    } catch (const Failure &failure) {
      finish();
      reject(@(failure.code.c_str()), @(failure.message.c_str()));
      return YES;
    }
    return NO;
  };
  if (check()) return;
  timer = [NSTimer timerWithTimeInterval:0.002 repeats:YES block:^(NSTimer *) { if (!done) check(); }];
  [NSRunLoop.mainRunLoop addTimer:timer forMode:NSRunLoopCommonModes];
}

- (void)sample:(NSInteger)tag request:(NSDictionary *)request resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject
{
  [self perform:^{
    if (![self->_hosts objectForKey:@(tag)]) throw SparkMotionUnmounted(tag);
    const Episode *episode = self->_engine.episode(tag);
    if (!episode) throw Failure{"E_NOT_FOUND", "The view has not moved"};
    const double now = self.now;
    const double from = request[@"fromMs"] ? SparkNumberValue(request[@"fromMs"], @"fromMs") / 1000 : episode->start;
    const double to = request[@"toMs"] ? SparkNumberValue(request[@"toMs"], @"toMs") / 1000 : std::min(episode->end, now);
    const double interval = SparkNumber(request, @"intervalMs", 1000 / Engine::kSampleRate) / 1000;
    if (!(interval >= 0.001 && std::isfinite(interval))) throw SparkMotionInvalid(@"intervalMs is at least 1");
    if (!(from >= episode->start - 1e-9 && from <= to)) throw SparkMotionInvalid(@"fromMs is within the motion and not after toMs");
    if (to > now + 1e-9) throw Failure{"E_INVALID_ARGUMENT", "toMs is in the future: wait for the motion first"};
    const double count = std::floor((to - from) / interval + 1e-9) + 1;
    if (count > 20000) throw SparkMotionInvalid(@"At most 20000 samples; raise intervalMs");
    NSMutableArray *samples = [NSMutableArray arrayWithCapacity:(NSUInteger)count + 1];
    auto add = [&](double time) {
      Values values, velocities;
      for (int i = 0; i < PropertyCount; i++) {
        const State state = episode->at(Property(i), time);
        values[i] = state.value;
        velocities[i] = state.velocity;
      }
      [samples addObject:@{ @"tMs": @(time * 1000), @"values": SparkValuesObject(values), @"velocities": SparkValuesObject(velocities) }];
    };
    for (double index = 0; index < count; index++) add(from + index * interval);
    if (to - (from + (count - 1) * interval) > 1e-9) add(to);
    resolve(@{ @"fromMs": @(from * 1000), @"toMs": @(to * 1000), @"intervalMs": @(interval * 1000), @"truncated": @(episode->truncated), @"samples": samples });
  } reject:reject];
}

- (void)presenting:(dispatch_block_t)render
{
  const double now = self.now;
  std::vector<std::pair<NSView<SparkMotionHost> *, Values>> models;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  for (NSView<SparkMotionHost> *host in _hosts.objectEnumerator) {
    if (!_engine.hasView(host.motionTag)) continue;
    Values presented;
    for (int i = 0; i < PropertyCount; i++) presented[i] = _engine.state(host.motionTag, Property(i), now).value;
    if (presented == host.motionModel) continue;
    models.emplace_back(host, host.motionModel);
    [host applyMotionModel:presented];
  }
  render();
  for (const auto &[host, model] : models) [host applyMotionModel:model];
  [CATransaction commit];
}
#endif

#pragma mark - Frame telemetry

- (void)recordFrames:(NSDictionary *)request resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject
{
  [self perform:^{
    const NSInteger tag = SparkTag(request);
    const double duration = SparkRequiredNumber(request, @"durationMs") / 1000;
    if (!(duration > 0 && duration <= 10)) throw SparkMotionInvalid(@"durationMs must be greater than 0 and at most 10000");
    NSView<SparkMotionHost> *host = [self->_hosts objectForKey:@(tag)];
    if (!host) throw SparkMotionUnmounted(tag);
    if (self->_engine.virtualClock()) throw Failure{"E_UNAVAILABLE", "Frame recording measures the real clock; switch the motion clock to real first"};
    SparkMotionFrameRecorder *recorder = [SparkMotionFrameRecorder new];
    recorder.host = host;
    recorder.duration = duration;
    recorder.resolve = resolve;
    recorder.reject = reject;
    recorder.start = -1;
    // A view's display link follows its window's display and never fires for a window that is not on screen (the
    // test driver renders windows without showing them); the screen's link keeps the same cadence there.
    NSScreen *screen = host.window.isVisible ? nil : host.window.screen ?: NSScreen.mainScreen;
    if (!host.window.isVisible && !screen) throw Failure{"E_UNAVAILABLE", "No display is connected, so frames cannot be recorded"};
    recorder.displayLink = screen ? [screen displayLinkWithTarget:self selector:@selector(frame:)] : [host displayLinkWithTarget:self selector:@selector(frame:)];
    [recorder.displayLink addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
    [self->_recorders addObject:recorder];
  } reject:reject];
}

- (void)frame:(CADisplayLink *)displayLink
{
  for (SparkMotionFrameRecorder *recorder in [_recorders allObjects]) {
    if (recorder.displayLink != displayLink) continue;
    NSView<SparkMotionHost> *host = recorder.host;
    if (!host) { [self finishRecorder:recorder failure:@"The MotionView unmounted during recording"]; return; }
    const double timestamp = displayLink.timestamp, interval = displayLink.targetTimestamp - displayLink.timestamp;
    CALayer *presented = host.layer.presentationLayer ?: host.layer;
    const CATransform3D transform = presented.transform;
    const float opacity = presented.opacity;
    const BOOL moving = [self isAnimating:host.motionTag];
    if (recorder.start < 0) { recorder.start = timestamp; recorder.interval = interval; }
    else {
      const double gap = timestamp - recorder.last;
      recorder.maxGap = MAX(recorder.maxGap, gap);
      const long missed = lround(gap / recorder.interval) - 1;
      if (missed > 0) recorder.dropped += missed;
      if (moving && recorder.previousMoving && CATransform3DEqualToTransform(transform, recorder.previousTransform) && opacity == recorder.previousOpacity) recorder.stalled++;
    }
    recorder.frames++;
    if (moving) recorder.active++;
    recorder.last = timestamp;
    recorder.previousMoving = moving;
    recorder.previousTransform = transform;
    recorder.previousOpacity = opacity;
    if (timestamp - recorder.start >= recorder.duration) [self finishRecorder:recorder failure:nil];
    return;
  }
}

- (void)finishRecorder:(SparkMotionFrameRecorder *)recorder failure:(NSString *)failure
{
  [recorder.displayLink invalidate];
  [_recorders removeObject:recorder];
  if (failure) { recorder.reject(@"E_CLOSED", failure); return; }
  recorder.resolve(SparkJSONString(@{
    @"frames": @(recorder.frames), @"animatedFrames": @(recorder.active), @"droppedFrames": @(recorder.dropped),
    @"stalledFrames": @(recorder.stalled), @"maxFrameGapMs": @(recorder.maxGap * 1000),
    @"refreshRate": @(recorder.interval > 0 ? round(1 / recorder.interval) : 0), @"durationMs": @((recorder.last - recorder.start) * 1000),
  }));
}

@end
