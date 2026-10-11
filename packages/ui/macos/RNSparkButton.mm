#import "RNSparkButton.h"
#import <react/renderer/components/RNSparkUISpec/ComponentDescriptors.h>
#import <react/renderer/components/RNSparkUISpec/EventEmitters.h>
#import <react/renderer/components/RNSparkUISpec/Props.h>
using namespace facebook::react;

@implementation RNSparkButton {
  NSButton *_button;
}
- (instancetype)init {
  if (self = [super init]) {
    _props = std::make_shared<const SparkButtonProps>();
    _button = [NSButton buttonWithTitle:@"" target:self action:@selector(pressed:)];
    _button.buttonType = NSButtonTypeMomentaryPushIn;
    _button.bezelStyle = NSBezelStyleRounded;
    _button.controlSize = NSControlSizeRegular;
    _button.font = [NSFont systemFontOfSize:NSFont.systemFontSize];
    [self addSubview:_button];
  }
  return self;
}
- (BOOL)isFlipped { return YES; }
- (void)pressed:(id)sender {
  if (!_button.enabled) return;
  auto emitter = std::static_pointer_cast<const SparkButtonEventEmitter>(_eventEmitter);
  if (emitter) emitter->onButtonPress({});
}
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps {
  const auto &value = *std::static_pointer_cast<const SparkButtonProps>(props);
  _button.title = [NSString stringWithUTF8String:value.title.c_str()];
  _button.enabled = !value.disabled;
  _button.bordered = value.variant != SparkButtonVariant::Borderless;
  _button.bezelStyle = value.variant == SparkButtonVariant::Bevel ? NSBezelStyleRegularSquare :
    value.variant == SparkButtonVariant::Toolbar ? NSBezelStyleTexturedRounded :
    value.variant == SparkButtonVariant::Help ? NSBezelStyleHelpButton : NSBezelStyleRounded;
  _button.keyEquivalent = value.variant == SparkButtonVariant::Default ? @"\r" :
    value.variant == SparkButtonVariant::Cancel ? @"\e" : @"";
  _button.keyEquivalentModifierMask = 0;
  _button.contentTintColor = value.variant == SparkButtonVariant::Destructive ? NSColor.systemRedColor : nil;
  _button.controlSize = value.controlSize == SparkButtonControlSize::Mini ? NSControlSizeMini :
    value.controlSize == SparkButtonControlSize::Small ? NSControlSizeSmall :
    value.controlSize == SparkButtonControlSize::Large ? NSControlSizeLarge : NSControlSizeRegular;
  _button.font = [NSFont systemFontOfSize:[NSFont systemFontSizeForControlSize:_button.controlSize]];
  _button.accessibilityLabel = [NSString stringWithUTF8String:value.accessibilityLabel.c_str()];
  _button.accessibilityIdentifier = [NSString stringWithUTF8String:value.testId.c_str()];
  [super updateProps:props oldProps:oldProps];
}
- (void)layoutSubviews { [super layoutSubviews]; _button.frame = self.bounds; }
- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics {
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  [self layoutSubviews];
}
- (void)prepareForRecycle {
  [super prepareForRecycle];
  _button.title = @"";
  _button.enabled = YES;
  _button.bordered = YES;
  _button.bezelStyle = NSBezelStyleRounded;
  _button.controlSize = NSControlSizeRegular;
  _button.font = [NSFont systemFontOfSize:[NSFont systemFontSizeForControlSize:NSControlSizeRegular]];
  _button.keyEquivalent = @"";
  _button.keyEquivalentModifierMask = 0;
  _button.contentTintColor = nil;
  _button.accessibilityIdentifier = nil; _button.accessibilityLabel = nil;
  _button.highlighted = NO;
  if (self.window.firstResponder == _button) [self.window makeFirstResponder:nil];
}
+ (ComponentDescriptorProvider)componentDescriptorProvider { return concreteComponentDescriptorProvider<SparkButtonComponentDescriptor>(); }
@end
