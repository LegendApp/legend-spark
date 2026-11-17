#import "RNSparkProgressIndicator.h"
#import <react/renderer/components/RNSparkUISpec/ComponentDescriptors.h>
#import <react/renderer/components/RNSparkUISpec/EventEmitters.h>
#import <react/renderer/components/RNSparkUISpec/Props.h>
using namespace facebook::react;

@implementation RNSparkProgressIndicator {
  NSProgressIndicator *_indicator;
  NSSize _reportedSize;
}
- (instancetype)init {
  if (self = [super init]) {
    _props = std::make_shared<const SparkProgressIndicatorProps>();
    _indicator = [NSProgressIndicator new];
    _indicator.minValue = 0;
    _indicator.maxValue = 1;
    _indicator.displayedWhenStopped = YES;
    [self addSubview:_indicator];
  }
  return self;
}
- (BOOL)isFlipped { return YES; }
- (void)reportIntrinsicSize {
  auto emitter = std::static_pointer_cast<const SparkProgressIndicatorEventEmitter>(_eventEmitter);
  [_indicator sizeToFit];
  NSSize size = NSMakeSize(ceil(_indicator.frame.size.width), ceil(_indicator.frame.size.height));
  _indicator.frame = self.bounds;
  if (!emitter || NSEqualSizes(size, _reportedSize)) return;
  _reportedSize = size;
  SparkProgressIndicatorEventEmitter::OnIntrinsicSize event;
  event.width = size.width;
  event.height = size.height;
  emitter->onIntrinsicSize(event);
}
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps {
  const auto &value = *std::static_pointer_cast<const SparkProgressIndicatorProps>(props);
  _indicator.style = value.variant == SparkProgressIndicatorVariant::Spinner ? NSProgressIndicatorStyleSpinning : NSProgressIndicatorStyleBar;
  _indicator.controlSize = value.controlSize == SparkProgressIndicatorControlSize::Mini ? NSControlSizeMini : value.controlSize == SparkProgressIndicatorControlSize::Small ? NSControlSizeSmall : NSControlSizeRegular;
  _indicator.indeterminate = value.indeterminate;
  if (value.indeterminate) {
    [_indicator startAnimation:nil];
  } else {
    _indicator.doubleValue = value.value;
    [_indicator stopAnimation:nil];
  }
  NSString *label = [NSString stringWithUTF8String:value.accessibilityLabel.c_str()];
  _indicator.accessibilityLabel = label.length ? label : nil;
  [super updateProps:props oldProps:oldProps];
  [self reportIntrinsicSize];
}
- (void)updateEventEmitter:(EventEmitter::Shared const &)eventEmitter {
  [super updateEventEmitter:eventEmitter];
  [self reportIntrinsicSize];
}
- (void)layoutSubviews { [super layoutSubviews]; _indicator.frame = self.bounds; }
- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics {
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  [self layoutSubviews];
}
- (void)prepareForRecycle {
  [super prepareForRecycle];
  [_indicator stopAnimation:nil];
  _reportedSize = NSZeroSize;
}
+ (ComponentDescriptorProvider)componentDescriptorProvider { return concreteComponentDescriptorProvider<SparkProgressIndicatorComponentDescriptor>(); }
@end
