#import "SparkMotionCoordinator.h"
#import <QuartzCore/QuartzCore.h>
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
  NSUInteger _sweepGeneration;
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
  }
  return self;
}

- (double)now { return _engine.time(CACurrentMediaTime()); }

#pragma mark - Hosts

- (void)registerHost:(NSView<SparkMotionHost> *)host initial:(const Values &)initial
{
  _engine.addView(host.motionTag, initial);
  [_hosts setObject:host forKey:@(host.motionTag)];
  [host applyMotionModel:initial];
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

#pragma mark - Baking

- (CAKeyframeAnimation *)animation:(const Bake &)bake channel:(Channel)channel host:(NSView *)host begin:(double)begin
{
  CAKeyframeAnimation *animation = [CAKeyframeAnimation animationWithKeyPath:channel == Channel::Transform ? @"transform" : @"opacity"];
  NSMutableArray *values = [NSMutableArray arrayWithCapacity:bake.samples.size()];
  for (const Values &sample : bake.samples)
    [values addObject:channel == Channel::Transform ? [NSValue valueWithCATransform3D:SparkMotionCentered(SparkMotionTransform(sample), host)] : @(sample[Opacity])];
  animation.values = values;
  animation.duration = bake.duration;
  animation.beginTime = begin;
  animation.calculationMode = kCAAnimationLinear;
  return animation;
}

/** Replaces one channel's compositor animations with a bake from now. */
- (void)apply:(NSInteger)tag channel:(Channel)channel
{
  NSView<SparkMotionHost> *host = [_hosts objectForKey:@(tag)];
  if (!host) return;
  const double now = self.now;
  const ChannelBake bake = _engine.bake(tag, channel, now);
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
    CAKeyframeAnimation *loop = [self animation:*bake.loop channel:channel host:host begin:local + bake.loop->begin - now];
    loop.repeatCount = HUGE_VALF;
    [layer addAnimation:loop forKey:transform ? kTransformLoop : kOpacityLoop];
  }
  // Added last so it wins over the loop until the loop's begin time.
  if (bake.lead) [layer addAnimation:[self animation:*bake.lead channel:channel host:host begin:local + bake.lead->begin - now] forKey:transform ? kTransformLead : kOpacityLead];
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
  try { operation(); return; }
  catch (const Failure &failure) {
    if (!failure.unmounted || CACurrentMediaTime() >= deadline) { reject(@(failure.code.c_str()), @(failure.message.c_str())); return; }
  }
  catch (const std::exception &error) { reject(@"E_NATIVE", [NSString stringWithFormat:@"Motion engine failure: %s", error.what()]); return; }
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
      NSDictionary *tracks = SparkObject(group[@"tracks"], @"tracks");
      for (id name in tracks) {
        const Property property = SparkProperty(name);
        parsed.tracks.emplace_back(property, SparkSpec(tracks[name], property));
      }
      plan.groups.push_back(parsed);
    }
    std::vector<Settled> settled;
    std::vector<int64_t> touched;
    self->_engine.run(plan, self.now, settled, touched);
    self->_completions[identifier] = resolve;
    for (int64_t tag : touched) [self applyAll:tag];
    [self settle:settled];
    [self scheduleSweep];
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
    _engine.setVirtualClock(false, CACurrentMediaTime());
    for (NSView<SparkMotionHost> *host in _hosts.objectEnumerator) [self applyAll:host.motionTag];
  }
  [CATransaction commit];
  [self scheduleSweep];
  resolve(nil);
}

- (void)advanceClock:(double)milliseconds resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject
{
  [self perform:^{
    const double seconds = milliseconds / 1000;
    self->_engine.advance(seconds);
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    for (NSView *host in self->_hosts.objectEnumerator) host.layer.timeOffset += seconds;
    [CATransaction commit];
    [self sweep];
    resolve(nil);
  } reject:reject];
}

- (void)clock:(SparkMotionResolve)resolve
{
  resolve(SparkJSONString(@{ @"mode": _engine.virtualClock() ? @"virtual" : @"real", @"timeMs": @(self.now * 1000) }));
}

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
    recorder.displayLink = [host displayLinkWithTarget:self selector:@selector(frame:)];
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
