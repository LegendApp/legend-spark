#import "RNSparkButton.h"
#import "RNSparkLayoutDirection.h"
#import <react/renderer/components/RNSparkUISpec/ComponentDescriptors.h>
#import <react/renderer/components/RNSparkUISpec/EventEmitters.h>
#import <react/renderer/components/RNSparkUISpec/Props.h>
using namespace facebook::react;

@implementation RNSparkButton {
  NSButton *_button;
  SparkButtonVariant _variant;
  NSSize _reportedSize;
}
- (instancetype)init {
  if (self = [super init]) {
    _props = std::make_shared<const SparkButtonProps>();
    _variant = SparkButtonVariant::Default;
    [self replaceButton];
  }
  return self;
}
- (BOOL)isFlipped { return YES; }
// Checkboxes and disclosure buttons are different NSButton configurations; a fresh button avoids
// carrying one variant's images, bezel or button type into another.
- (void)replaceButton {
  [_button removeFromSuperview];
  if (_variant == SparkButtonVariant::Checkbox) {
    _button = [NSButton checkboxWithTitle:@"" target:self action:@selector(pressed:)];
  } else {
    _button = [NSButton buttonWithTitle:@"" target:self action:@selector(pressed:)];
    if (_variant == SparkButtonVariant::Disclosure) {
      _button.bezelStyle = NSBezelStylePushDisclosure;
      [_button setButtonType:NSButtonTypePushOnPushOff];
      _button.imagePosition = NSImageOnly;
    } else {
      _button.buttonType = NSButtonTypeMomentaryPushIn;
      _button.bezelStyle = NSBezelStyleRounded;
    }
  }
  _button.controlSize = NSControlSizeRegular;
  _button.font = [NSFont systemFontOfSize:NSFont.systemFontSize];
  _button.frame = self.bounds;
  _reportedSize = NSZeroSize;
  [self addSubview:_button];
}
- (void)pressed:(id)sender {
  if (!_button.enabled) return;
  auto emitter = std::static_pointer_cast<const SparkButtonEventEmitter>(_eventEmitter);
  if (emitter) emitter->onButtonPress({});
}
- (void)reportIntrinsicSize {
  auto emitter = std::static_pointer_cast<const SparkButtonEventEmitter>(_eventEmitter);
  NSSize size = _button.intrinsicContentSize;
  size = NSMakeSize(ceil(size.width), ceil(size.height));
  if (!emitter || NSEqualSizes(size, _reportedSize)) return;
  _reportedSize = size;
  SparkButtonEventEmitter::OnIntrinsicSize event;
  event.width = size.width;
  event.height = size.height;
  emitter->onIntrinsicSize(event);
}
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps {
  const auto &value = *std::static_pointer_cast<const SparkButtonProps>(props);
  if (value.variant != _variant) { _variant = value.variant; [self replaceButton]; }
  NSString *title = [NSString stringWithUTF8String:value.title.c_str()];
  // A disclosure button draws only its chevron; its title names it for accessibility.
  _button.title = _variant == SparkButtonVariant::Disclosure ? @"" : title;
  _button.enabled = !value.disabled;
  if (_variant != SparkButtonVariant::Checkbox) _button.bordered = _variant != SparkButtonVariant::Borderless;
  // Checkbox and disclosure state is controlled: each render (and each press acknowledgment) restores it.
  if (_variant == SparkButtonVariant::Checkbox || _variant == SparkButtonVariant::Disclosure) _button.state = value.checked ? NSControlStateValueOn : NSControlStateValueOff;
  NSString *label = [NSString stringWithUTF8String:value.accessibilityLabel.c_str()];
  _button.accessibilityLabel = label.length ? label : title;
  _button.accessibilityIdentifier = [NSString stringWithUTF8String:value.testId.c_str()];
  [super updateProps:props oldProps:oldProps];
  [self reportIntrinsicSize];
}
- (void)updateEventEmitter:(EventEmitter::Shared const &)eventEmitter {
  [super updateEventEmitter:eventEmitter];
  [self reportIntrinsicSize];
}
- (void)layoutSubviews { [super layoutSubviews]; _button.frame = self.bounds; }
- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics {
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  _button.userInterfaceLayoutDirection = RNSparkLayoutDirection(layoutMetrics);
  [self layoutSubviews];
}
- (void)prepareForRecycle {
  [super prepareForRecycle];
  if (self.window.firstResponder == _button) [self.window makeFirstResponder:nil];
  _variant = SparkButtonVariant::Default;
  [self replaceButton];
}
+ (ComponentDescriptorProvider)componentDescriptorProvider { return concreteComponentDescriptorProvider<SparkButtonComponentDescriptor>(); }
@end
