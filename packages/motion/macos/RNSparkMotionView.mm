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

@implementation RNSparkMotionView {
  Values _model;
  NSInteger _tag;
  NSString *_layout;
  NSString *_sharedId;
  NSDictionary *_transition;
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
- (NSDictionary *)motionTransition { return _transition; }
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
  if (!oldProps || motionProps.transition != std::static_pointer_cast<const SparkMotionViewProps>(oldProps)->transition) {
    id transition = motionProps.transition.empty() ? nil : [NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:motionProps.transition.data() length:motionProps.transition.size()] options:0 error:nil];
    _transition = [transition isKindOfClass:NSDictionary.class] ? transition : nil;
  }
  if (_tag) return;
  // `initial` applies once, at mount; later renders never overwrite engine-owned values.
  Values initial = spark::motion::kIdentity;
  const auto &json = std::static_pointer_cast<const SparkMotionViewProps>(props)->initialValues;
  // JavaScript validates `initial`; anything else in the JSON is ignored rather than trusted.
  id values = json.empty() ? nil : [NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:json.data() length:json.size()] options:0 error:nil];
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

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  if (layoutMetrics.frame.size == oldLayoutMetrics.frame.size) return;
  self.transform3D = SparkMotionTransform(_model);
  [SparkMotionCoordinator.shared hostDidResize:self];
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
