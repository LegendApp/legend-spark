#import "SparkMotionCoordinator.h"
#import <CoreImage/CoreImage.h>
#import <QuartzCore/QuartzCore.h>
#import <Symbols/Symbols.h>
#include <algorithm>
#include <cmath>
#include <exception>
#include <vector>
using namespace spark::motion;

/** The blur filter's name in key paths (`filters.sparkBlur.inputRadius`), and where a host layer keeps its installed mask. */
static NSString *const kBlurFilter = @"sparkBlur";
static NSString *const kMaskKey = @"sparkMotionMask";

CATransform3D SparkMotionTransform(const Values &values)
{
  // Row vectors: scale, then rotate about z, y and x, then the perspective projection, then the translation.
  CATransform3D transform = CATransform3DMakeScale(values[ScaleX], values[ScaleY], 1);
  transform = CATransform3DConcat(transform, CATransform3DMakeRotation(values[Rotate] * M_PI / 180, 0, 0, 1));
  transform = CATransform3DConcat(transform, CATransform3DMakeRotation(values[RotateY] * M_PI / 180, 0, 1, 0));
  transform = CATransform3DConcat(transform, CATransform3DMakeRotation(values[RotateX] * M_PI / 180, 1, 0, 0));
  if (values[Perspective] >= 1) {
    CATransform3D perspective = CATransform3DIdentity;
    perspective.m34 = -1 / values[Perspective];
    transform = CATransform3DConcat(transform, perspective);
  }
  return CATransform3DConcat(transform, CATransform3DMakeTranslation(values[TranslateX], values[TranslateY], 0));
}

/** The background color of OKLCH values as an extended sRGB CGColor (out-of-gamut components survive for wide-gamut displays). */
static id SparkMotionColor(const Values &values)
{
  static CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceExtendedSRGB);
  const Rgba color = oklchToSrgb(values[BackgroundColorL], values[BackgroundColorC], values[BackgroundColorH], values[BackgroundColorAlpha]);
  const CGFloat components[] = {color.red, color.green, color.blue, color.alpha};
  return CFBridgingRelease(CGColorCreate(space, components));
}
static CALayer *SparkMotionMask(NSView *view) { return [view.layer valueForKey:kMaskKey]; }
static BOOL SparkMotionMasks(const Values &values) { return values[MaskInsetTop] || values[MaskInsetBottom] || values[MaskInsetStart] || values[MaskInsetEnd] || values[MaskRadius]; }
static BOOL SparkMotionBlurred(NSView *view)
{
  for (CIFilter *filter in view.layer.filters) if ([filter.name isEqual:kBlurFilter]) return YES;
  return NO;
}
static SparkMotionMaterialStack *SparkMotionMaterialOf(NSView<SparkMotionHost> *host) { return [host respondsToSelector:@selector(motionMaterial)] ? host.motionMaterial : nil; }
/** The mask's frame in layer coordinates: the view's bounds inset by the mask insets; start and end follow the layout direction. */
static CGRect SparkMotionMaskRect(NSView *view, const Values &values, BOOL rightToLeft)
{
  const NSRect bounds = view.bounds;
  const double left = rightToLeft ? values[MaskInsetEnd] : values[MaskInsetStart], right = rightToLeft ? values[MaskInsetStart] : values[MaskInsetEnd];
  const double width = MAX(0, NSWidth(bounds) - left - right), height = MAX(0, NSHeight(bounds) - values[MaskInsetTop] - values[MaskInsetBottom]);
  const double y = view.isFlipped ? values[MaskInsetTop] : values[MaskInsetBottom];
  return [view convertRectToLayer:NSMakeRect(NSMinX(bounds) + left, NSMinY(bounds) + y, width, height)];
}

void SparkMotionApplyLayer(NSView<SparkMotionHost> *host, const Values &values)
{
  CALayer *layer = host.layer;
  const uint32_t owned = host.motionOwnedChannels;
  layer.opacity = values[Opacity];
  if (owned & SparkMotionChannelBit(Channel::BackgroundColor)) layer.backgroundColor = (__bridge CGColorRef)SparkMotionColor(values);
  if (owned & SparkMotionChannelBit(Channel::BorderRadius)) layer.cornerRadius = MAX(0, values[BorderRadius]);
  if (owned & SparkMotionChannelBit(Channel::Shadow)) {
    layer.shadowOpacity = std::clamp(values[ShadowOpacity], 0.0, 1.0);
    layer.shadowRadius = MAX(0, values[ShadowRadius]);
    layer.shadowOffset = CGSizeMake(values[ShadowOffsetX], values[ShadowOffsetY]);
  }
  // React Native builds a shadow path from the style's radii; the shadow follows the animated corners and shape instead.
  if (owned & (SparkMotionChannelBit(Channel::BorderRadius) | SparkMotionChannelBit(Channel::Shadow))) layer.shadowPath = nil;
  if (SparkMotionBlurred(host)) [layer setValue:@(MAX(0, values[Blur])) forKeyPath:@"filters.sparkBlur.inputRadius"];
  if (CALayer *mask = SparkMotionMask(host)) {
    mask.frame = SparkMotionMaskRect(host, values, host.motionRightToLeft);
    mask.cornerRadius = MAX(0, values[MaskRadius]);
    layer.mask = mask;  // React Native clears a view's mask when it invalidates its layer
  }
  if (SparkMotionMaterialStack *material = SparkMotionMaterialOf(host)) {
    material.materialsLayer.opacity = std::clamp(values[MaterialIntensity], 0.0, 1.0);
    material.tintLayer.opacity = std::clamp(values[MaterialTintOpacity], 0.0, 1.0);
    material.incomingLayer.opacity = std::clamp(values[MaterialCrossfade], 0.0, 1.0);
    [material setCornerRadius:layer.cornerRadius];
  }
}

/** Installs or removes the blur filter and the mask layer; SparkMotionApplyLayer then keeps them in step with the model. */
static void SparkMotionInstallEffects(NSView *view, BOOL blur, BOOL mask)
{
  CALayer *layer = view.layer;
  if (blur != SparkMotionBlurred(view)) {
    NSMutableArray *filters = [NSMutableArray new];
    for (CIFilter *filter in layer.filters) if (![filter.name isEqual:kBlurFilter]) [filters addObject:filter];
    if (blur) {
      view.layerUsesCoreImageFilters = YES;  // AppKit ignores layer filters otherwise
      CIFilter *filter = [CIFilter filterWithName:@"CIGaussianBlur"];
      filter.name = kBlurFilter;
      [filter setValue:@0 forKey:kCIInputRadiusKey];
      [filters addObject:filter];
    }
    layer.filters = filters.count ? filters : nil;
    if (!filters.count) view.layerUsesCoreImageFilters = NO;
  }
  CALayer *installed = SparkMotionMask(view);
  if (mask && !installed) {
    CALayer *shape = [CALayer layer];
    shape.backgroundColor = CGColorGetConstantColor(kCGColorBlack);
    [layer setValue:shape forKey:kMaskKey];
    layer.mask = shape;
  } else if (!mask && installed) {
    if (layer.mask == installed) layer.mask = nil;
    [layer setValue:nil forKey:kMaskKey];
  }
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
  NSMapTable<NSNumber *, NSView<SparkMotionSymbolHost> *> *_symbols;
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
    _symbols = [NSMapTable strongToWeakObjectsMapTable];
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
- (BOOL)reduceTransparency
{
  id simulated = [self simulated:@"reduceTransparency"];
  return simulated ? [simulated boolValue] : NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency;
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
      @"reduceMotion": @(self.reduceMotion), @"reduceTransparency": @(self.reduceTransparency), @"lowPowerMode": @(self.lowPower),
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
  SparkMotionInstallEffects(host, initial[Blur] > 0, SparkMotionMasks(initial));
  [host applyMotionModel:initial];
  [_mounting addObject:host];
  if (_engine.virtualClock()) {
    CALayer *layer = host.layer;
    layer.timeOffset = [layer convertTime:CACurrentMediaTime() fromLayer:nil];
    layer.speed = 0;
  }
  [self retryAwaitingMount];
}

/** Retries the operations that named a view before its mount transaction registered it. */
- (void)retryAwaitingMount
{
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
  // Transforms are about the centre and the mask is inset from the bounds: both follow the new size.
  std::vector<Channel> channels;
  if (SparkMotionAnimating(_engine, host.motionTag, Channel::Transform, self.now)) channels.push_back(Channel::Transform);
  if (SparkMotionMask(host)) channels.push_back(Channel::Mask);
  if (!channels.empty()) [self apply:host.motionTag channels:channels];
}

- (Values)styledModel:(NSView<SparkMotionHost> *)host model:(const Values &)model
{
  Values styled = model;
  const NSInteger tag = host.motionTag;
  if ([_hosts objectForKey:@(tag)] != host) return styled;
  const uint32_t owned = host.motionOwnedChannels;
  CALayer *layer = host.layer;
  std::vector<std::pair<Property, double>> values;
  if (!(owned & SparkMotionChannelBit(Channel::BackgroundColor))) {
    static CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceExtendedSRGB);
    CGColorRef converted = layer.backgroundColor ? CGColorCreateCopyByMatchingToColorSpace(space, kCGRenderingIntentDefault, layer.backgroundColor, NULL) : NULL;
    const CGFloat *rgba = converted ? CGColorGetComponents(converted) : NULL;
    const Oklch color = rgba ? srgbToOklch({rgba[0], rgba[1], rgba[2], rgba[3]}) : Oklch{0, 0, 0, 0};
    if (converted) CGColorRelease(converted);
    values.insert(values.end(), {{BackgroundColorL, color.lightness}, {BackgroundColorC, color.chroma}, {BackgroundColorH, color.hue}, {BackgroundColorAlpha, color.alpha}});
  }
  if (!(owned & SparkMotionChannelBit(Channel::BorderRadius))) values.emplace_back(BorderRadius, layer.cornerRadius);
  if (!(owned & SparkMotionChannelBit(Channel::Shadow)))
    values.insert(values.end(), {{ShadowOpacity, layer.shadowOpacity}, {ShadowRadius, layer.shadowRadius}, {ShadowOffsetX, layer.shadowOffset.width}, {ShadowOffsetY, layer.shadowOffset.height}});
  for (const auto &[property, value] : values) {
    _engine.setModel(tag, property, value);
    styled[property] = value;
  }
  return styled;
}

/**
 * Throws E_UNSUPPORTED_OPTION for a property whose channel React Native draws for the view's style on another layer, or a
 * material property of a view without a material, and E_INVALID_ARGUMENT for the crossfade, which only material changes drive.
 */
- (void)checkOwnable:(NSInteger)tag properties:(const std::vector<Property> &)properties
{
  NSView<SparkMotionHost> *host = [_hosts objectForKey:@(tag)];
  for (Property property : properties)
    if (property == MaterialCrossfade) throw SparkMotionInvalid(@"materialCrossfade follows a MotionMaterial's material changes; animate materialIntensity instead");
  if (!host) return;  // the engine reports an unmounted view
  const uint32_t style = host.motionStyleChannels;
  for (Property property : properties) {
    const Channel channel = channelOf(property);
    if (channel == Channel::Material && !SparkMotionMaterialOf(host))
      throw Failure{"E_UNSUPPORTED_OPTION", std::string(propertyName(property)) + ": the view has no backdrop material; use a MotionMaterial"};
    if (!(style & SparkMotionChannelBit(channel))) continue;
    throw Failure{"E_UNSUPPORTED_OPTION", std::string(propertyName(property)) + (channel == Channel::Mask
      ? ": the view's style clips its content with a mask (overflow hidden with per-corner radii), which a motion mask would replace"
      : ": the view's style draws its border and background on their own layer (a visible border without overflow hidden, or per-side border colors, widths or styles, or per-corner radii)")};
  }
}

/** Motion drives these properties from now on: their channels stop following the view's style. */
- (void)own:(NSInteger)tag properties:(const std::vector<Property> &)properties
{
  NSView<SparkMotionHost> *host = [_hosts objectForKey:@(tag)];
  for (Property property : properties) host.motionOwnedChannels |= SparkMotionChannelBit(channelOf(property));
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

/** The layer key paths a channel's animations drive; the mask channel's are its mask layer's, the material channel's its material stack's. */
static NSArray<NSString *> *SparkMotionKeyPaths(Channel channel)
{
  switch (channel) {
    case Channel::Opacity: return @[@"opacity"];
    case Channel::Transform: return @[@"transform"];
    case Channel::BackgroundColor: return @[@"backgroundColor"];
    case Channel::BorderRadius: return @[@"cornerRadius"];
    case Channel::Shadow: return @[@"shadowOpacity", @"shadowRadius", @"shadowOffset"];
    case Channel::Blur: return @[@"filters.sparkBlur.inputRadius"];
    case Channel::Mask: return @[@"bounds", @"position", @"cornerRadius"];
    case Channel::Material: return @[@"opacity", @"opacity", @"opacity"];  // the material views' container's, the tint's and the incoming material's layers
    case Channel::Count: break;
  }
  return @[];
}

/** The value of a channel's `index`th key path in one sample. */
static id SparkMotionSample(Channel channel, NSUInteger index, const Values &sample, NSView<SparkMotionHost> *host)
{
  switch (channel) {
    case Channel::Opacity: return @(sample[Opacity]);
    case Channel::Transform: return [NSValue valueWithCATransform3D:SparkMotionCentered(SparkMotionTransform(sample), host)];
    case Channel::BackgroundColor: return SparkMotionColor(sample);
    case Channel::BorderRadius: return @(MAX(0, sample[BorderRadius]));
    case Channel::Shadow:
      if (index == 0) return @(std::clamp(sample[ShadowOpacity], 0.0, 1.0));
      if (index == 1) return @(MAX(0, sample[ShadowRadius]));
      return [NSValue valueWithSize:NSMakeSize(sample[ShadowOffsetX], sample[ShadowOffsetY])];
    case Channel::Blur: return @(MAX(0, sample[Blur]));
    case Channel::Mask: {
      if (index == 2) return @(MAX(0, sample[MaskRadius]));
      const CGRect rect = SparkMotionMaskRect(host, sample, host.motionRightToLeft);
      return index == 0 ? [NSValue valueWithRect:NSMakeRect(0, 0, rect.size.width, rect.size.height)] : [NSValue valueWithPoint:NSMakePoint(CGRectGetMidX(rect), CGRectGetMidY(rect))];
    }
    case Channel::Material: return @(std::clamp(sample[index == 0 ? MaterialIntensity : index == 1 ? MaterialTintOpacity : MaterialCrossfade], 0.0, 1.0));
    case Channel::Count: break;
  }
  return nil;
}

- (CAKeyframeAnimation *)animation:(const Bake &)bake channel:(Channel)channel index:(NSUInteger)index host:(NSView<SparkMotionHost> *)host begin:(double)begin rate:(double)rate
{
  CAKeyframeAnimation *animation = [CAKeyframeAnimation animationWithKeyPath:SparkMotionKeyPaths(channel)[index]];
  NSMutableArray *values = [NSMutableArray arrayWithCapacity:bake.samples.size()];
  for (const Values &sample : bake.samples) [values addObject:SparkMotionSample(channel, index, sample, host)];
  animation.values = values;
  animation.duration = bake.duration;
  animation.beginTime = begin;
  animation.calculationMode = kCAAnimationLinear;
  // ProMotion displays run motion at 120 Hz only when asked; others (and Low Power Mode) cap it (docs/motion.md#frame-rate-and-power).
  animation.preferredFrameRateRange = CAFrameRateRangeMake(rate / 2, rate, rate);
  return animation;
}

static BOOL SparkMotionAnimating(Engine &engine, NSInteger tag, Channel channel, double now)
{
  for (int i = 0; i < PropertyCount; i++) if (channelOf(Property(i)) == channel && engine.animating(tag, Property(i), now)) return YES;
  return NO;
}

/** Replaces the channels' compositor animations with a bake from now, and applies the model they end at. */
- (void)apply:(NSInteger)tag channels:(const std::vector<Channel> &)channels
{
  NSView<SparkMotionHost> *host = [_hosts objectForKey:@(tag)];
  if (!host) return;
  const double now = self.now, rate = [self frameRate:host];
  CALayer *layer = host.layer;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  Values model = host.motionModel;
  std::vector<std::pair<Channel, ChannelBake>> bakes;
  for (Channel channel : channels) {
    bakes.emplace_back(channel, _engine.bake(tag, channel, now, rate));
    for (int i = 0; i < PropertyCount; i++) if (channelOf(Property(i)) == channel) model[i] = bakes.back().second.model[i];
  }
  // The blur filter and the mask exist while they show something or animate (docs/motion.md#visual-effects).
  BOOL blur = SparkMotionBlurred(host), mask = SparkMotionMask(host) != nil;
  for (const auto &[channel, bake] : bakes) {
    const BOOL animated = bake.lead || bake.loop;
    if (channel == Channel::Blur) blur = animated || model[Blur] > 0;
    if (channel == Channel::Mask) mask = animated || SparkMotionMasks(model);
  }
  SparkMotionInstallEffects(host, blur, mask);
  const double local = [layer convertTime:CACurrentMediaTime() fromLayer:nil];
  for (const auto &[channel, bake] : bakes) {
    SparkMotionMaterialStack *material = SparkMotionMaterialOf(host);
    if (channel == Channel::Material && !material) continue;  // checkOwnable keeps plain MotionViews from animating it
    NSArray<NSString *> *keyPaths = SparkMotionKeyPaths(channel);
    for (NSUInteger index = 0; index < keyPaths.count; index++) {
      CALayer *target = channel == Channel::Mask ? SparkMotionMask(host) : channel != Channel::Material ? layer : index == 0 ? material.materialsLayer : index == 1 ? material.tintLayer : material.incomingLayer;
      if (!target) continue;
      NSString *lead = [@"spark.motion." stringByAppendingString:keyPaths[index]], *loop = [lead stringByAppendingString:@".loop"];
      [target removeAnimationForKey:lead];
      [target removeAnimationForKey:loop];
      if (bake.loop) {
        CAKeyframeAnimation *animation = [self animation:*bake.loop channel:channel index:index host:host begin:local + bake.loop->begin - now rate:rate];
        animation.repeatCount = HUGE_VALF;
        [target addAnimation:animation forKey:loop];
      }
      // Added last so it wins over the loop until the loop's begin time.
      if (bake.lead) [target addAnimation:[self animation:*bake.lead channel:channel index:index host:host begin:local + bake.lead->begin - now rate:rate] forKey:lead];
    }
  }
  [host applyMotionModel:model];
  auto turns = [](const std::optional<Bake> &part) {
    if (part) for (const Values &sample : part->samples) if (sample[Rotate] != 0 || sample[RotateX] != 0 || sample[RotateY] != 0) return true;
    return false;
  };
  for (const auto &[channel, bake] : bakes)
    if (channel == Channel::Transform && (model[Rotate] != 0 || model[RotateX] != 0 || model[RotateY] != 0 || turns(bake.lead) || turns(bake.loop))) layer.allowsEdgeAntialiasing = YES;
  [CATransaction commit];
}

- (void)applyAll:(NSInteger)tag
{
  std::vector<Channel> all;
  for (int channel = 0; channel < int(Channel::Count); channel++) all.push_back(Channel(channel));
  [self apply:tag channels:all];
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
  // A blur or mask that animated back to nothing is removed once it settles: an idle filter or mask still costs a pass.
  for (NSView<SparkMotionHost> *host in [_hosts.objectEnumerator allObjects])
    if ((SparkMotionBlurred(host) && host.motionModel[Blur] <= 0 && !SparkMotionAnimating(_engine, host.motionTag, Channel::Blur, self.now)) ||
        (SparkMotionMask(host) && !SparkMotionMasks(host.motionModel) && !SparkMotionAnimating(_engine, host.motionTag, Channel::Mask, self.now)))
      [self apply:host.motionTag channels:{Channel::Blur, Channel::Mask}];
  for (NSView<SparkMotionHost> *host in [_hosts.objectEnumerator allObjects]) [self dropCoveredMaterials:host];
  [self settle:settled];
  [self scheduleSweep];
}

/** A material that finished crossfading in covers the ones under it: they are removed (each still costs a backdrop pass). */
- (void)dropCoveredMaterials:(NSView<SparkMotionHost> *)host
{
  SparkMotionMaterialStack *material = SparkMotionMaterialOf(host);
  if (material.materialCount > 1 && host.motionModel[MaterialCrossfade] >= 1 && !_engine.animating(host.motionTag, MaterialCrossfade, self.now)) [material dropCovered];
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
    // The tracks that play: a step's own Reduce Motion alternate replaces its tracks while Reduce Motion is on.
    std::vector<std::pair<int64_t, std::vector<Property>>> played;
    for (const Group &group : plan.groups) {
      std::vector<Property> properties;
      for (const auto &[property, spec] : plan.reduceMotion && group.reduced ? *group.reduced : group.tracks) properties.push_back(property);
      [self checkOwnable:group.view properties:properties];
      played.emplace_back(group.view, std::move(properties));
    }
    const Started started = self->_engine.run(plan, now, settled, touched);
    for (const auto &[view, properties] : played) [self own:view properties:properties];
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
    std::vector<Property> properties;
    for (const auto &[property, value] : values) properties.push_back(property);
    [self checkOwnable:tag properties:properties];
    [self syncHidden:tag];
    std::vector<Settled> settled;
    self->_engine.set(tag, values, self.now, settled);
    [self own:tag properties:properties];
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
    [self checkOwnable:tag properties:properties];
    if (!host.window) throw Failure{"E_NOT_FOUND", "The MotionView is not in a window"};
    NSView *source = SparkFindNativeID(host.window.contentView, nativeID);
    NSScrollView *scrollView = source ? SparkFindScrollView(source) : nil;
    if (!scrollView) throw Failure{"E_NOT_FOUND", std::string("No scroll view with nativeID ") + nativeID.UTF8String + " is in the MotionView's window"};
    link.clip = scrollView.contentView;
    std::vector<Settled> settled;
    self->_engine.stop(tag, properties, self.now, settled);
    for (Property property : properties) self->_engine.link(tag, property, true);
    [self own:tag properties:properties];
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
  std::vector<Channel> channels;
  for (const auto &[property, values] : link->outputs) {
    _engine.setModel(link.tag, property, interpolate(link->input, values, offset, link.clamp));
    if (std::find(channels.begin(), channels.end(), channelOf(property)) == channels.end()) channels.push_back(channelOf(property));
  }
  [self apply:link.tag channels:channels];
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

#pragma mark - Backdrop materials

- (void)host:(NSView<SparkMotionHost> *)host crossfadeTo:(NSView *)material
{
  SparkMotionMaterialStack *stack = SparkMotionMaterialOf(host);
  const NSInteger tag = host.motionTag;
  // Not shown yet, nothing to fade from; or no transition, which JavaScript always sends (a malformed native prop).
  NSDictionary *crossfade = [host respondsToSelector:@selector(motionCrossfade)] ? host.motionCrossfade : nil;
  if ([_hosts objectForKey:@(tag)] != host || !crossfade) { [stack push:material replace:YES]; return; }
  static NSUInteger crossfades = 0;
  try {
    NSMutableDictionary *transition = [crossfade mutableCopy];
    transition[@"to"] = @1;
    Plan plan;
    plan.id = [NSString stringWithFormat:@"material-%ld-%lu", (long)tag, (unsigned long)++crossfades].UTF8String;
    Spec spec = SparkSpec(transition, MaterialCrossfade);
    spec.from = State{0, 0};
    plan.groups.push_back(Group{tag, {{MaterialCrossfade, spec}}});
    plan.reduceMotion = self.reduceMotion;  // a crossfade is a fade: Reduce Motion plays it as its 200 ms fade, without overshoot
    [self syncHidden:tag];
    // The material showing now stays where it is (an interrupted crossfade: as far as it got) until the new one covers it.
    [stack freezeIncomingAt:std::clamp(_engine.state(tag, MaterialCrossfade, self.now).value, 0.0, 1.0)];
    [stack push:material replace:NO];
    std::vector<Settled> settled;
    std::vector<int64_t> touched;
    _engine.run(plan, self.now, settled, touched);
    [self moveResumedCues];
    [self applyAll:tag];
    [self dropCoveredMaterials:host];  // a hidden window completes it at once
    [self settle:settled];
    [self scheduleSweep];
  } catch (const Failure &failure) {
    [self moveResumedCues];
    // JavaScript validated the transition; only a malformed native prop gets here, and no caller awaits a crossfade.
    NSLog(@"Spark motion: material crossfade rejected: %s", failure.message.c_str());
    [stack push:material replace:YES];
  }
}

#pragma mark - Symbol effects

- (void)registerSymbol:(NSView<SparkMotionSymbolHost> *)host
{
  [_symbols setObject:host forKey:@(host.motionTag)];
  [self retryAwaitingMount];
}

- (void)unregisterSymbolTag:(NSInteger)tag { [_symbols removeObjectForKey:@(tag)]; }

// Effects newer than macOS 14 need both the SDK the app was built with and the macOS it runs on.
#define SPARK_SDK_15 (__MAC_OS_X_VERSION_MAX_ALLOWED >= 150000)
#define SPARK_SDK_26 (__MAC_OS_X_VERSION_MAX_ALLOWED >= 260000)

BOOL SparkSymbolEffectSupported(NSString *name)
{
  if ([name isEqual:@"bounce"] || [name isEqual:@"pulse"] || [name isEqual:@"replace"]) return YES;
#if SPARK_SDK_15
  if ([name isEqual:@"wiggle"] || [name isEqual:@"rotate"] || [name isEqual:@"breathe"]) { if (@available(macOS 15.0, *)) return YES; }
#endif
#if SPARK_SDK_26
  if ([name isEqual:@"drawOn"] || [name isEqual:@"drawOff"]) { if (@available(macOS 26.0, *)) return YES; }
#endif
  return NO;
}

/** The NSSymbolEffect for a request; E_UNAVAILABLE when this app or macOS does not have it (docs/motion.md#symbol-effects). */
static NSSymbolEffect *SparkSymbolEffect(NSString *name, NSString *direction, BOOL byLayer)
{
  auto layered = [byLayer](id effect) -> NSSymbolEffect * { return byLayer ? [effect effectWithByLayer] : [effect effectWithWholeSymbol]; };
  auto check = [&](NSArray<NSString *> *directions) {
    if (direction && ![directions containsObject:direction])
      throw SparkMotionInvalid([NSString stringWithFormat:@"The %@ effect's direction is %@", name, directions.count ? [directions componentsJoinedByString:@", "] : @"not set"]);
  };
  const BOOL known = [@[@"bounce", @"pulse", @"wiggle", @"rotate", @"breathe", @"drawOn", @"drawOff"] containsObject:name];
  if (!known) throw SparkMotionInvalid([NSString stringWithFormat:@"Unknown symbol effect %@", name]);
  if (!SparkSymbolEffectSupported(name)) throw Failure{"E_UNAVAILABLE", [NSString stringWithFormat:@"The %@ symbol effect is not available in this app on this macOS", name].UTF8String};
  if ([name isEqual:@"bounce"]) {
    check(@[@"up", @"down"]);
    return layered([direction isEqual:@"up"] ? NSSymbolBounceEffect.bounceUpEffect : [direction isEqual:@"down"] ? NSSymbolBounceEffect.bounceDownEffect : NSSymbolBounceEffect.effect);
  }
  if ([name isEqual:@"pulse"]) { check(@[]); return layered(NSSymbolPulseEffect.effect); }
#if SPARK_SDK_15
  if (@available(macOS 15.0, *)) {
    if ([name isEqual:@"breathe"]) { check(@[]); return layered(NSSymbolBreatheEffect.effect); }
    if ([name isEqual:@"rotate"]) {
      check(@[@"clockwise", @"counterClockwise"]);
      return layered([direction isEqual:@"clockwise"] ? NSSymbolRotateEffect.rotateClockwiseEffect : [direction isEqual:@"counterClockwise"] ? NSSymbolRotateEffect.rotateCounterClockwiseEffect : NSSymbolRotateEffect.effect);
    }
    if ([name isEqual:@"wiggle"]) {
      NSDictionary<NSString *, NSSymbolWiggleEffect *> *wiggles = @{
        @"up": NSSymbolWiggleEffect.wiggleUpEffect, @"down": NSSymbolWiggleEffect.wiggleDownEffect, @"left": NSSymbolWiggleEffect.wiggleLeftEffect,
        @"right": NSSymbolWiggleEffect.wiggleRightEffect, @"forward": NSSymbolWiggleEffect.wiggleForwardEffect, @"backward": NSSymbolWiggleEffect.wiggleBackwardEffect,
        @"clockwise": NSSymbolWiggleEffect.wiggleClockwiseEffect, @"counterClockwise": NSSymbolWiggleEffect.wiggleCounterClockwiseEffect };
      check(wiggles.allKeys);
      return layered(direction ? wiggles[direction] : NSSymbolWiggleEffect.effect);
    }
  }
#endif
#if SPARK_SDK_26
  if (@available(macOS 26.0, *)) {
    check(@[]);
    return layered([name isEqual:@"drawOn"] ? (id)NSSymbolDrawOnEffect.effect : (id)NSSymbolDrawOffEffect.effect);
  }
#endif
  throw Failure{"E_UNAVAILABLE", "Unreachable: SparkSymbolEffectSupported admitted an effect this build cannot create"};
}

/** `repeat` extra plays (infinity: until removed) at `speed`. */
static NSSymbolEffectOptions *SparkSymbolOptions(double repeat, double speed)
{
  NSSymbolEffectOptions *options = [NSSymbolEffectOptions optionsWithSpeed:speed];
  if (repeat == 0) return [options optionsWithNonRepeating];
#if SPARK_SDK_15
  if (@available(macOS 15.0, *))
    return [options optionsWithRepeatBehavior:std::isinf(repeat) ? NSSymbolEffectOptionsRepeatBehavior.behaviorPeriodic : [NSSymbolEffectOptionsRepeatBehavior behaviorPeriodicWithCount:(NSInteger)repeat + 1]];
#endif
  return std::isinf(repeat) ? [options optionsWithRepeating] : [options optionsWithRepeatCount:(NSInteger)repeat + 1];
}

- (NSView<SparkMotionSymbolHost> *)symbolHost:(NSDictionary *)request
{
  const NSInteger tag = SparkTag(request);
  NSView<SparkMotionSymbolHost> *host = [_symbols objectForKey:@(tag)];
  if (!host) throw Failure{"E_NOT_FOUND", "No mounted MotionSymbol has tag " + std::to_string(tag), true};
  return host;
}

- (void)playSymbolEffect:(NSDictionary *)request resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject
{
  [self perform:^{
    NSView<SparkMotionSymbolHost> *host = [self symbolHost:request];
    NSString *name = SparkString(request, @"effect");
    id direction = request[@"direction"];
    if (direction && ![direction isKindOfClass:NSString.class]) throw SparkMotionInvalid(@"direction must be a string");
    const double repeat = [request[@"repeat"] isEqual:@"infinite"] ? INFINITY : SparkNumber(request, @"repeat", 0);
    const double speed = SparkNumber(request, @"speed", 1);
    if (!(repeat >= 0 && (std::isinf(repeat) || repeat == std::floor(repeat)))) throw SparkMotionInvalid(@"repeat must be a non-negative integer or Infinity");
    if (!(speed > 0 && std::isfinite(speed))) throw SparkMotionInvalid(@"speed must be a positive finite number");
    const BOOL draw = [name isEqual:@"drawOn"] || [name isEqual:@"drawOff"];
    if (draw && repeat != 0) throw Failure{"E_UNSUPPORTED_OPTION", "Drawing a symbol on or off plays once; it cannot repeat"};
    NSSymbolEffect *effect = SparkSymbolEffect(name, direction, SparkBool(request, @"byLayer", NO));
    NSString *reduce = SparkOneOf(request, @"reducedMotion", @[@"fade", @"instant", @"play"]);
    // Reduce Motion (docs/motion.md#symbol-effects): nothing travels. `fade` pulses instead (opacity only) and fades
    // drawing on or off; `instant` plays nothing and shows or hides a drawn symbol at once; `play` plays as written.
    NSString *played = !self.reduceMotion || [reduce isEqual:@"play"] ? name : [reduce isEqual:@"instant"] ? @"none" : draw ? @"fade" : @"pulse";
    NSImageView *image = host.symbolImageView;
    if (draw && ![played isEqual:name]) {
      const CGFloat alpha = [name isEqual:@"drawOn"] ? 1 : 0;
      if ([played isEqual:@"fade"]) [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) { context.duration = kReducedFade; image.animator.alphaValue = alpha; }];
      else image.alphaValue = alpha;
    } else if (![played isEqual:@"none"]) {
      if ([name isEqual:@"drawOn"]) image.alphaValue = 1;  // shown again after a faded or instant drawOff
      [image addSymbolEffect:[played isEqual:name] ? effect : NSSymbolPulseEffect.effect options:SparkSymbolOptions(repeat, speed) animated:YES];
    }
    resolve(SparkJSONString(@{ @"played": played }));
  } reject:reject];
}

- (void)removeSymbolEffect:(NSDictionary *)request resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject
{
  [self perform:^{
    NSImageView *image = [self symbolHost:request].symbolImageView;
    if (request[@"effect"]) [image removeSymbolEffectOfType:SparkSymbolEffect(SparkString(request, @"effect"), nil, NO)];
    else [image removeAllSymbolEffects];
    resolve(nil);
  } reject:reject];
}

- (void)replaceSymbol:(NSView<SparkMotionSymbolHost> *)host image:(NSImage *)image transition:(nullable NSString *)transition
{
  NSImageView *view = host.symbolImageView;
  if (!transition.length || !view.image || !image) { view.image = image; return; }
  if (self.reduceMotion) {
    // Nothing travels: the symbols cross-fade (docs/motion.md#symbol-effects).
    CATransition *fade = [CATransition animation];
    fade.type = kCATransitionFade;
    fade.duration = kReducedFade;
    [view.layer addAnimation:fade forKey:kCATransition];  // Core Animation keeps a transition under this key whatever the key
    view.image = image;
    return;
  }
  NSDictionary<NSString *, NSSymbolReplaceContentTransition *> *transitions = @{
    @"replace": NSSymbolReplaceContentTransition.transition, @"downUp": NSSymbolReplaceContentTransition.replaceDownUpTransition,
    @"upUp": NSSymbolReplaceContentTransition.replaceUpUpTransition, @"offUp": NSSymbolReplaceContentTransition.replaceOffUpTransition };
  // JavaScript validates the transition; a malformed prop sets the image without one.
  if (NSSymbolReplaceContentTransition *replace = transitions[transition]) [view setSymbolImage:image withContentTransition:replace];
  else view.image = image;
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
  if (self.clockAdvanced) self.clockAdvanced(seconds * 1000);
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
  // Pinned like the driver's other host settings: flows behave the same on a Mac with Reduce Motion, Reduce
  // Transparency or Low Power Mode on, until simulateSystemEvent changes them.
  _simulated[@"reduceMotion"] = @NO;
  _simulated[@"reduceTransparency"] = @NO;
  _simulated[@"lowPowerMode"] = @NO;
}

- (void)simulate:(NSDictionary *)values
{
  // null stops simulating a value (simulateDisplays' restore).
  for (NSString *key in @[@"reduceMotion", @"reduceTransparency", @"lowPowerMode", @"maximumFramesPerSecond"]) {
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
