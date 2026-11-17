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
  NSString *_symbol;
  NSString *_reportedMissingSymbol;
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
  _symbol = nil;
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
// A missing symbol is reported once per name, also when the emitter arrives after the props.
- (void)reportMissingSymbol {
  auto emitter = std::static_pointer_cast<const SparkButtonEventEmitter>(_eventEmitter);
  if (!emitter || _symbol.length == 0 || _button.image || [_reportedMissingSymbol isEqual:_symbol]) return;
  _reportedMissingSymbol = _symbol;
  SparkButtonEventEmitter::OnSymbolError event;
  event.name = _symbol.UTF8String;
  event.message = [NSString stringWithFormat:@"SF Symbol '%@' is not available on this system", _symbol].UTF8String;
  emitter->onSymbolError(event);
}
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps {
  const auto &value = *std::static_pointer_cast<const SparkButtonProps>(props);
  if (value.variant != _variant) { _variant = value.variant; [self replaceButton]; }
  NSControlSize controlSize = value.controlSize == SparkButtonControlSize::Mini ? NSControlSizeMini : value.controlSize == SparkButtonControlSize::Small ? NSControlSizeSmall : NSControlSizeRegular;
  if (_button.controlSize != controlSize) {
    _button.controlSize = controlSize;
    _button.font = [NSFont systemFontOfSize:[NSFont systemFontSizeForControlSize:controlSize]];
  }
  NSString *symbol = [NSString stringWithUTF8String:value.symbol.c_str()];
  if (![symbol isEqual:_symbol]) {
    _symbol = symbol;
    _reportedMissingSymbol = nil;
    _button.image = symbol.length ? [NSImage imageWithSystemSymbolName:symbol accessibilityDescription:nil] : nil;
    _button.imagePosition = _button.image ? NSImageLeading : NSNoImage;
  }
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
  [self reportMissingSymbol];
  [self reportIntrinsicSize];
}
- (void)updateEventEmitter:(EventEmitter::Shared const &)eventEmitter {
  [super updateEventEmitter:eventEmitter];
  [self reportMissingSymbol];
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
  _reportedMissingSymbol = nil;
  [self replaceButton];
}
+ (ComponentDescriptorProvider)componentDescriptorProvider { return concreteComponentDescriptorProvider<SparkButtonComponentDescriptor>(); }
@end
