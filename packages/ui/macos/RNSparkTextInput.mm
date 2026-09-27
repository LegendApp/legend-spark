#import "RNSparkTextInput.h"
#import <react/renderer/components/RNSparkUISpec/ComponentDescriptors.h>
#import <react/renderer/components/RNSparkUISpec/EventEmitters.h>
#import <react/renderer/components/RNSparkUISpec/Props.h>
using namespace facebook::react;
@implementation RNSparkTextInput {
  NSTextField *_field;
  BOOL _initialized;
  int _eventCount;
}
- (instancetype)init {
  if (self = [super init]) {
    _props = std::make_shared<const SparkTextInputProps>();
    _field = [NSTextField textFieldWithString:@""];
    _field.delegate = self;
    _field.bezelStyle = NSTextFieldRoundedBezel;
    _field.cell.scrollable = YES;
    _field.cell.wraps = NO;
    _field.cell.usesSingleLineMode = YES;
    [self addSubview:_field];
  }
  return self;
}
- (BOOL)isFlipped { return YES; }
- (void)controlTextDidChange:(NSNotification *)notification {
  if (!_field.enabled) return;
  ++_eventCount;
  const auto emitter = std::static_pointer_cast<const SparkTextInputEventEmitter>(_eventEmitter);
  if (emitter) emitter->onTextChange({ .text = _field.stringValue.UTF8String ?: "", .eventCount = _eventCount });
}
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps {
  const auto &value = *std::static_pointer_cast<const SparkTextInputProps>(props);
  if (!_initialized) { _field.stringValue = [NSString stringWithUTF8String:value.defaultText.c_str()]; _initialized = YES; }
  if (value.controlled && value.eventCount >= _eventCount) {
    NSString *text = [NSString stringWithUTF8String:value.text.c_str()];
    if (![_field.stringValue isEqualToString:text]) _field.stringValue = text;
  }
  _field.enabled = !value.disabled;
  _field.accessibilityIdentifier = [NSString stringWithUTF8String:value.testId.c_str()];
  _field.accessibilityLabel = [NSString stringWithUTF8String:value.accessibilityLabel.c_str()];
  [super updateProps:props oldProps:oldProps];
}
- (void)layoutSubviews { [super layoutSubviews]; _field.frame = self.bounds; }
- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics {
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics]; [self layoutSubviews];
}
- (void)prepareForRecycle {
  [_field abortEditing];
  [super prepareForRecycle];
  _initialized = NO; _eventCount = 0; _field.enabled = YES; _field.stringValue = @""; _field.accessibilityIdentifier = nil; _field.accessibilityLabel = nil;
}
+ (ComponentDescriptorProvider)componentDescriptorProvider { return concreteComponentDescriptorProvider<SparkTextInputComponentDescriptor>(); }
@end
