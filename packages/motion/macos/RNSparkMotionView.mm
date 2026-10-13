#import "RNSparkMotionView.h"
#import "SparkMotionCoordinator.h"
#import <react/renderer/components/RNSparkMotionSpec/ComponentDescriptors.h>
#import <react/renderer/components/RNSparkMotionSpec/Props.h>
#import <React/RCTMountingTransactionObserving.h>
#include <cmath>
#import <react/featureflags/ReactNativeFeatureFlags.h>
#import <react/renderer/graphics/Color.h>
using namespace facebook::react;
using spark::motion::Values;

// Private in React Native macOS (RCTViewComponentView.mm); it re-applies the `opacity` prop.
@interface RCTViewComponentView (SparkMotionLayer)
- (void)invalidateLayer;
@end

@interface RNSparkMotionView () <SparkMotionHost, RCTMountingTransactionObserving>
@end

static NSString *SparkMotionString(const std::string &value) { return value.empty() ? nil : [NSString stringWithUTF8String:value.c_str()]; }
static id SparkMotionJSON(const std::string &json) { return json.empty() ? nil : [NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:json.data() length:json.size()] options:0 error:nil]; }

@implementation RNSparkMotionView {
  Values _model;
  NSInteger _tag;
  NSString *_layout;
  NSString *_sharedId;
  BOOL _sharedAcrossWindows;
  NSDictionary *_transition;
  NSDictionary *_crossfade;
  SparkMotionMaterialStack *_material;
  SparkMotionShapeView *_shape;
  SparkMotionShader *_shader;
  SparkMotionEmitter *_emitter;
  uint32_t _owned;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<SparkMotionViewComponentDescriptor>();
}

// Engine state is keyed by React tag; a recycled view would carry another view's motion.
+ (BOOL)shouldBeRecycled { return NO; }

- (instancetype)initWithFrame:(NSRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    _props = std::make_shared<const SparkMotionViewProps>();
    _model = spark::motion::kIdentity;
  }
  return self;
}

- (void)dealloc
{
  NSInteger tag = _tag;
  if (!tag) return;
  if (NSThread.isMainThread) [SparkMotionCoordinator.shared unregisterTag:tag];
  else dispatch_async(dispatch_get_main_queue(), ^{ [SparkMotionCoordinator.shared unregisterTag:tag]; });
}

- (NSInteger)motionTag { return _tag; }
- (Values)motionModel { return _model; }
- (NSString *)motionLayout { return _layout; }
- (NSString *)motionSharedId { return _sharedId; }
- (BOOL)motionSharedAcrossWindows { return _sharedAcrossWindows; }
- (NSDictionary *)motionTransition { return _transition; }
- (SparkMotionMaterialStack *)motionMaterial { return _material; }
- (NSDictionary *)motionCrossfade { return _crossfade; }
- (SparkMotionShapeView *)motionShape { return _shape; }
- (SparkMotionShader *)motionShader { return _shader; }
- (SparkMotionEmitter *)motionEmitter { return _emitter; }
- (BOOL)motionRightToLeft { return _layoutMetrics.layoutDirection == LayoutDirection::RightToLeft; }
- (uint32_t)motionOwnedChannels { return _owned; }
- (void)setMotionOwnedChannels:(uint32_t)owned { _owned = owned; }

// The conditions under which RCTViewComponentView's invalidateLayer draws the background and borders on sublayers, and
// clips its content with a mask layer, instead of using this view's own layer.
- (uint32_t)motionStyleChannels
{
  using spark::motion::Channel;
  const auto &props = *std::static_pointer_cast<const ViewProps>(_props);
  const auto border = props.resolveBorderMetrics(_layoutMetrics);
  const bool clips = props.getClipsContentToBounds();
  const bool transparentBorder = border.borderColors.left && colorComponentsFromColor(border.borderColors.left).alpha == 0;
  const bool layerBorders = border.borderColors.isUniform() && border.borderWidths.isUniform() && border.borderStyles.isUniform() &&
    border.borderStyles.left == BorderStyle::Solid && border.borderRadii.isUniform() && (border.borderWidths.left == 0 || clips || transparentBorder);
  const bool clipMask = clips && (!border.borderRadii.isUniform() ||
    (ReactNativeFeatureFlags::enableIOSViewClipToPaddingBox() && (!border.borderWidths.isUniform() || border.borderWidths.left != 0)));
  return (layerBorders ? 0 : SparkMotionChannelBit(Channel::BackgroundColor) | SparkMotionChannelBit(Channel::BorderRadius)) |
    (clipMask ? SparkMotionChannelBit(Channel::Mask) : 0);
}

- (void)applyMotionModel:(const Values &)values
{
  _model = values;
  // RCTUIView keeps transform3D across AppKit's layer resets and centres it like React Native.
  self.transform3D = SparkMotionTransform(values);
  SparkMotionApplyLayer(self, values);
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  [super updateProps:props oldProps:oldProps];
  const auto &motionProps = *std::static_pointer_cast<const SparkMotionViewProps>(props);
  // JavaScript validates these; the transition JSON is parsed once per change.
  _layout = SparkMotionString(motionProps.layout);
  _sharedId = SparkMotionString(motionProps.sharedId);
  _sharedAcrossWindows = motionProps.sharedAcrossWindows;
  const auto *old = oldProps ? std::static_pointer_cast<const SparkMotionViewProps>(oldProps).get() : nullptr;
  if (!old || motionProps.transition != old->transition) {
    id transition = SparkMotionJSON(motionProps.transition);
    _transition = [transition isKindOfClass:NSDictionary.class] ? transition : nil;
  }
  if (!old || motionProps.crossfade != old->crossfade) {
    id crossfade = SparkMotionJSON(motionProps.crossfade);
    _crossfade = [crossfade isKindOfClass:NSDictionary.class] ? crossfade : nil;
  }
  if (!old || motionProps.tintColor != old->tintColor || motionProps.material != old->material) [self updateMaterial:motionProps changed:!old || motionProps.material != old->material];
  if (!old || motionProps.shape != old->shape) [self updateShape:motionProps];
  if (!old || motionProps.shaderEffect != old->shaderEffect) [self updateShader:motionProps];
  if (!old || motionProps.particleEmitter != old->particleEmitter) [self updateEmitter:motionProps];
  if (_tag) return;
  // `initial` applies once, at mount; later renders never overwrite engine-owned values.
  Values initial = spark::motion::kIdentity;
  const auto &json = std::static_pointer_cast<const SparkMotionViewProps>(props)->initialValues;
  // JavaScript validates `initial`; anything else in the JSON is ignored rather than trusted.
  id values = SparkMotionJSON(json);
  if ([values isKindOfClass:NSDictionary.class]) {
    for (id name in (NSDictionary *)values) {
      auto property = [name isKindOfClass:NSString.class] ? spark::motion::propertyFromName([name UTF8String]) : std::nullopt;
      id value = ((NSDictionary *)values)[name];
      if (!property || ![value isKindOfClass:NSNumber.class] || !std::isfinite([value doubleValue])) continue;
      initial[*property] = [value doubleValue];
      _owned |= SparkMotionChannelBit(spark::motion::channelOf(*property));
    }
  }
  _tag = self.reactTag.integerValue;
  [SparkMotionCoordinator.shared registerHost:self initial:initial];
}

// A MotionMaterial (docs/motion.md#backdrop-materials) has no React children (JavaScript rejects them), so its material
// stack is this view's only subview and never shifts the indexes Fabric mounts children at.
- (void)updateMaterial:(const SparkMotionViewProps &)props changed:(BOOL)changed
{
  NSDictionary *config = SparkMotionJSON(props.material);
  if (![config isKindOfClass:NSDictionary.class]) return;
  if (!_material) {
    _material = [[SparkMotionMaterialStack alloc] initWithFrame:self.bounds];
    [self addSubview:_material positioned:NSWindowBelow relativeTo:nil];
  }
  NSArray *tint = SparkMotionJSON(props.tintColor);
  id color = nil;
  if ([tint isKindOfClass:NSArray.class] && tint.count == 4 && [[tint filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"self isKindOfClass: %@", NSNumber.class]] count] == 4) {
    static CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceExtendedSRGB);
    const spark::motion::Rgba rgba = spark::motion::oklchToSrgb([tint[0] doubleValue], [tint[1] doubleValue], [tint[2] doubleValue], [tint[3] doubleValue]);
    const CGFloat components[] = {rgba.red, rgba.green, rgba.blue, rgba.alpha};
    color = CFBridgingRelease(CGColorCreate(space, components));
  }
  [_material setTintColor:(__bridge CGColorRef)color];
  if (!changed) return;
  NSString *error = nil;
  NSView *material = [SparkMotionMaterialStack materialView:config error:&error];
  // JavaScript validated the material and its availability; only a malformed native prop gets here.
  if (!material) { NSLog(@"Spark motion: material rejected: %@", error); return; }
  [SparkMotionCoordinator.shared host:self crossfadeTo:material];
}

// A MotionShape (docs/motion.md#shapes) has no React children either: its shape view is its only subview.
- (void)updateShape:(const SparkMotionViewProps &)props
{
  NSDictionary *config = SparkMotionJSON(props.shape);
  if (![config isKindOfClass:NSDictionary.class]) return;
  if (!_shape) {
    _shape = [[SparkMotionShapeView alloc] initWithFrame:self.bounds];
    [self addSubview:_shape positioned:NSWindowBelow relativeTo:nil];
  }
  NSString *error = nil;
  // JavaScript validated the paths and the limits; only a malformed native prop gets here.
  if (![_shape setConfig:config error:&error]) { NSLog(@"Spark motion: shape rejected: %@", error); return; }
  [SparkMotionCoordinator.shared hostDidReshape:self];
}

// A MotionShader's effect and a MotionEmitter's emitter (docs/motion.md#shader-effects-and-particles) are filters,
// layers and masks on this view's own layer, never subviews: React children mount at their indexes as in any MotionView.
- (void)updateShader:(const SparkMotionViewProps &)props
{
  NSDictionary *config = SparkMotionJSON(props.shaderEffect);
  if (![config isKindOfClass:NSDictionary.class]) return;
  NSString *error = nil;
  SparkMotionShader *shader = [SparkMotionShader shader:config error:&error];
  // JavaScript validated the effect and its availability; only a malformed native prop (or a lost Metal device) gets here.
  if (!shader) { NSLog(@"Spark motion: shader effect rejected: %@", error); return; }
  SparkMotionShader *previous = _shader;
  _shader = shader;
  if (_tag) [SparkMotionCoordinator.shared host:self shaderChangedFrom:previous];
}

- (void)updateEmitter:(const SparkMotionViewProps &)props
{
  NSDictionary *config = SparkMotionJSON(props.particleEmitter);
  if (![config isKindOfClass:NSDictionary.class]) return;
  NSString *error = nil;
  if (_emitter ? ![_emitter update:config error:&error] : !(_emitter = [SparkMotionEmitter emitter:config error:&error])) { NSLog(@"Spark motion: particle emitter rejected: %@", error); return; }
  if (self.layer) [_emitter layout:self];
}

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  if (layoutMetrics.frame.size == oldLayoutMetrics.frame.size) return;
  self.transform3D = SparkMotionTransform(_model);
  [SparkMotionCoordinator.shared hostDidResize:self];
}

- (void)viewDidMoveToWindow
{
  [super viewDidMoveToWindow];
  if (_tag && _sharedAcrossWindows) [SparkMotionCoordinator.shared hostDidMoveToWindow:self];
}

// Layout and shared-element hand-offs compare where the view was before a mounting transaction with where it is after.
- (void)mountingTransactionWillMount:(const MountingTransaction &)transaction withSurfaceTelemetry:(const SurfaceTelemetry &)surfaceTelemetry
{
  if (_layout || _sharedId) [SparkMotionCoordinator.shared hostWillMount:self surface:transaction.getSurfaceId() transaction:(NSInteger)transaction.getNumber()];
}

- (void)mountingTransactionDidMount:(const MountingTransaction &)transaction withSurfaceTelemetry:(const SurfaceTelemetry &)surfaceTelemetry
{
  if (_layout || _sharedId) [SparkMotionCoordinator.shared hostDidMount:self surface:transaction.getSurfaceId() transaction:(NSInteger)transaction.getNumber()];
}

// Fabric re-applies the style (opacity, background, corners, shadow) on every layer invalidation and clears the mask.
// Motion owns opacity and the mask, and the background, corners and shadow once it drives them; until then the engine
// takes them from the style.
- (void)invalidateLayer
{
  [super invalidateLayer];
  if (_tag) _model = [SparkMotionCoordinator.shared styledModel:self model:_model];
  SparkMotionApplyLayer(self, _model);
}

@end
