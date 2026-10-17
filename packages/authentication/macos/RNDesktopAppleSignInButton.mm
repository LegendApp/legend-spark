#import "RNDesktopAppleSignInButton.h"
#import <AuthenticationServices/AuthenticationServices.h>
#import <react/renderer/components/RNDesktopAuthenticationSpec/ComponentDescriptors.h>
#import <react/renderer/components/RNDesktopAuthenticationSpec/EventEmitters.h>
#import <react/renderer/components/RNDesktopAuthenticationSpec/Props.h>
using namespace facebook::react;

// ASAuthorizationAppleIDButton refuses a click that activates its window, where NSButton takes it: so does this one,
// like the other controls of an app's window (and the test driver's clicks, which are always such clicks).
@interface RNDesktopAppleIDButton : ASAuthorizationAppleIDButton
@end
@implementation RNDesktopAppleIDButton
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
@end

// AppleSignInButton (src/apple.ts): Apple's ASAuthorizationAppleIDButton, which draws the logo and the title in the
// app's language. A press only tells JavaScript, with the button's window; the request is signInWithApple's. The type
// and style are fixed when the button is made, so changing either, or the appearance under the automatic style, makes
// a new one.
@implementation RNDesktopAppleSignInButton {
  RNDesktopAppleIDButton *_button;
  ASAuthorizationAppleIDButtonType _type;
  DesktopAppleSignInButtonButtonStyle _style;
  CGFloat _cornerRadius;
  NSString *_label, *_testID;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider { return concreteComponentDescriptorProvider<DesktopAppleSignInButtonComponentDescriptor>(); }

- (instancetype)initWithFrame:(NSRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    _props = std::make_shared<const DesktopAppleSignInButtonProps>();
    _cornerRadius = -1;
  }
  return self;
}

// Automatic follows Apple's guidance: black on a light appearance, white on a dark one.
- (ASAuthorizationAppleIDButtonStyle)resolvedStyle
{
  switch (_style) {
    case DesktopAppleSignInButtonButtonStyle::Black: return ASAuthorizationAppleIDButtonStyleBlack;
    case DesktopAppleSignInButtonButtonStyle::White: return ASAuthorizationAppleIDButtonStyleWhite;
    case DesktopAppleSignInButtonButtonStyle::WhiteOutline: return ASAuthorizationAppleIDButtonStyleWhiteOutline;
    case DesktopAppleSignInButtonButtonStyle::Automatic:
      return [self.effectiveAppearance bestMatchFromAppearancesWithNames:@[NSAppearanceNameAqua, NSAppearanceNameDarkAqua]] == NSAppearanceNameDarkAqua
        ? ASAuthorizationAppleIDButtonStyleWhite : ASAuthorizationAppleIDButtonStyleBlack;
  }
}

- (void)makeButton
{
  NSUserInterfaceLayoutDirection direction = _button ? _button.userInterfaceLayoutDirection : NSUserInterfaceLayoutDirectionLeftToRight;
  [_button removeFromSuperview];
  _button = [[RNDesktopAppleIDButton alloc] initWithAuthorizationButtonType:_type authorizationButtonStyle:[self resolvedStyle]];
  _button.target = self;
  _button.action = @selector(pressed);
  _button.frame = self.bounds;
  _button.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  _button.userInterfaceLayoutDirection = direction;
  [self applyAttributes];
  [self addSubview:_button];
}

- (void)applyAttributes
{
  if (_cornerRadius >= 0) _button.cornerRadius = _cornerRadius;
  // The button's own label is Apple's localized title; an accessibilityLabel replaces it.
  if (_label.length) _button.accessibilityLabel = _label;
  _button.accessibilityIdentifier = _testID;
}

- (void)pressed
{
  auto emitter = std::static_pointer_cast<const DesktopAppleSignInButtonEventEmitter>(_eventEmitter);
  if (!emitter) return;
  NSString *identifier = self.window.identifier ?: @"";
  NSString *windowId = [identifier hasPrefix:@"spark."] ? [identifier substringFromIndex:6] : @"";
  emitter->onButtonPress({ .windowId = windowId.UTF8String });
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &value = *std::static_pointer_cast<DesktopAppleSignInButtonProps const>(props);
  ASAuthorizationAppleIDButtonType type = value.buttonType == DesktopAppleSignInButtonButtonType::Continue ? ASAuthorizationAppleIDButtonTypeContinue
    : value.buttonType == DesktopAppleSignInButtonButtonType::SignUp ? ASAuthorizationAppleIDButtonTypeSignUp : ASAuthorizationAppleIDButtonTypeSignIn;
  // A radius set earlier cannot be unset on the same button, so going back to the system's makes a new one.
  BOOL remake = !_button || type != _type || value.buttonStyle != _style || (value.cornerRadius < 0 && _cornerRadius >= 0);
  _type = type;
  _style = value.buttonStyle;
  _cornerRadius = value.cornerRadius;
  _label = value.accessibilityLabel.empty() ? nil : [NSString stringWithUTF8String:value.accessibilityLabel.c_str()];
  _testID = value.testId.empty() ? nil : [NSString stringWithUTF8String:value.testId.c_str()];
  if (remake) [self makeButton]; else [self applyAttributes];
  [super updateProps:props oldProps:oldProps];
}

- (void)viewDidChangeEffectiveAppearance
{
  [super viewDidChangeEffectiveAppearance];
  if (_button && _style == DesktopAppleSignInButtonButtonStyle::Automatic) [self makeButton];
}

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  _button.frame = self.bounds;
  _button.userInterfaceLayoutDirection = layoutMetrics.layoutDirection == LayoutDirection::RightToLeft ? NSUserInterfaceLayoutDirectionRightToLeft : NSUserInterfaceLayoutDirectionLeftToRight;
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  [_button removeFromSuperview];
  _button = nil;
  _cornerRadius = -1;
  _label = nil;
  _testID = nil;
}
@end
