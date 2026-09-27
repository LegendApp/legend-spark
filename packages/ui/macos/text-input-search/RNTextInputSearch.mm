#import "RNTextInputSearch.h"

#import <react/renderer/components/RNSparkUISpec/ComponentDescriptors.h>
#import <react/renderer/components/RNSparkUISpec/EventEmitters.h>
#import <react/renderer/components/RNSparkUISpec/Props.h>
#import <react/renderer/components/RNSparkUISpec/RCTComponentViewHelpers.h>

using namespace facebook::react;

#if TARGET_OS_OSX
static NSAppearance *RNTextInputSearchAppearanceForName(NSString *appearanceName)
{
  if ([appearanceName isEqualToString:@"light"]) {
    return [NSAppearance appearanceNamed:NSAppearanceNameAqua];
  }

  if ([appearanceName isEqualToString:@"dark"]) {
    return [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  }

  return nil;
}

#endif

@interface RNTextInputSearch () <
#if TARGET_OS_OSX
  NSSearchFieldDelegate,
#endif
  RCTTextInputSearchViewProtocol
>
@end

@implementation RNTextInputSearch {
#if TARGET_OS_OSX
  NSSearchField *_textField;
  BOOL _hasSetDefaultText;
  int _eventCount;
#else
  UIView *_textField;
#endif
}

- (instancetype)init
{
  if (self = [super init]) {
    _props = std::make_shared<const TextInputSearchProps>();
#if TARGET_OS_OSX
    _textField = [NSSearchField new];
    _textField.delegate = self;
    _textField.focusRingType = NSFocusRingTypeNone;
    _textField.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [self addSubview:_textField];
#else
    _textField = [UIView new];
    [self addSubview:_textField];
#endif
  }
  return self;
}

#if TARGET_OS_OSX
- (BOOL)isFlipped
{
  return YES;
}

- (void)controlTextDidChange:(NSNotification *)notification
{
  if (notification.object != _textField || !_textField.enabled) {
    return;
  }
  ++_eventCount;
  const auto eventEmitter = std::static_pointer_cast<const TextInputSearchEventEmitter>(_eventEmitter);
  if (eventEmitter) {
    eventEmitter->onChangeText(TextInputSearchEventEmitter::OnChangeText{
      .text = _textField.stringValue.UTF8String ?: "",
      .eventCount = _eventCount,
    });
  }
}
#endif

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &newProps = *std::static_pointer_cast<TextInputSearchProps const>(props);
#if TARGET_OS_OSX
  NSString *appearanceName = [NSString stringWithUTF8String:newProps.appearance.c_str()];
  NSAppearance *appearance = RNTextInputSearchAppearanceForName(appearanceName);
  self.appearance = appearance;
  _textField.appearance = appearance;

  _textField.enabled = !newProps.disabled;
  _textField.accessibilityLabel = [NSString stringWithUTF8String:newProps.accessibilityLabel.c_str()];
  _textField.accessibilityIdentifier = [NSString stringWithUTF8String:newProps.testId.c_str()];
  NSString *placeholder = [NSString stringWithUTF8String:newProps.placeholder.c_str()];
  _textField.placeholderString = placeholder;

  if (!_hasSetDefaultText) {
    _textField.stringValue = [NSString stringWithUTF8String:newProps.defaultText.c_str()];
    _hasSetDefaultText = YES;
  }

  if (newProps.controlled && newProps.eventCount >= _eventCount) {
    NSString *text = [NSString stringWithUTF8String:newProps.text.c_str()];
    if (![_textField.stringValue isEqualToString:text]) {
      _textField.stringValue = text;
    }
  }
#endif
  [super updateProps:props oldProps:oldProps];
}

- (void)handleCommand:(const NSString *)commandName args:(const NSArray *)args
{
  RCTTextInputSearchHandleCommand(self, commandName, args);
}

- (void)focus
{
#if TARGET_OS_OSX
  if (_textField.enabled) [self.window makeFirstResponder:_textField];
#endif
}

- (void)blur
{
#if TARGET_OS_OSX
  if (self.window.firstResponder == _textField || _textField.currentEditor == self.window.firstResponder) [self.window makeFirstResponder:nil];
#endif
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
#if TARGET_OS_OSX
  _textField.stringValue = @"";
  _textField.placeholderString = @"";
  [_textField abortEditing];
  _hasSetDefaultText = NO; _eventCount = 0; _textField.enabled = YES;
  _textField.accessibilityLabel = nil; _textField.accessibilityIdentifier = nil;
  self.appearance = nil; _textField.appearance = nil;
#endif
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  _textField.frame = self.bounds;
}

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics
           oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  [self layoutSubviews];
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<TextInputSearchComponentDescriptor>();
}

@end
