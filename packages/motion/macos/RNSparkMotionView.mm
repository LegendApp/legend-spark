#import "RNSparkMotionView.h"
#import "SparkMotionCoordinator.h"
#import <react/renderer/components/RNSparkMotionSpec/ComponentDescriptors.h>
#import <react/renderer/components/RNSparkMotionSpec/Props.h>
#include <cmath>
using namespace facebook::react;
using spark::motion::Values;

// Private in React Native macOS (RCTViewComponentView.mm); it re-applies the `opacity` prop.
@interface RCTViewComponentView (SparkMotionLayer)
- (void)invalidateLayer;
@end

@interface RNSparkMotionView () <SparkMotionHost>
@end

@implementation RNSparkMotionView {
  Values _model;
  NSInteger _tag;
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

- (void)applyMotionModel:(const Values &)values
{
  _model = values;
  // RCTUIView keeps transform3D across AppKit's layer resets and centres it like React Native.
  self.transform3D = SparkMotionTransform(values);
  self.layer.opacity = values[spark::motion::Opacity];
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  [super updateProps:props oldProps:oldProps];
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
      if (property && [value isKindOfClass:NSNumber.class] && std::isfinite([value doubleValue])) initial[*property] = [value doubleValue];
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

// Fabric re-applies the `opacity` prop on every layer invalidation; motion owns opacity.
- (void)invalidateLayer
{
  [super invalidateLayer];
  self.layer.opacity = _model[spark::motion::Opacity];
}

@end
