#import <AppKit/AppKit.h>
#include <memory>
#include <string>
#include <cassert>
namespace facebook::react {
struct Props { using Shared = std::shared_ptr<const Props>; virtual ~Props() = default; };
enum class SparkButtonVariant { Default, Bordered, Borderless, Push, Bevel, Toolbar, Help, Cancel, Destructive };
enum class SparkButtonControlSize { Mini, Small, Regular, Large };
struct SparkButtonProps : Props {
  std::string title, accessibilityLabel, testId;
  bool disabled = false;
  SparkButtonVariant variant = SparkButtonVariant::Push;
  SparkButtonControlSize controlSize = SparkButtonControlSize::Regular;
};
struct EventEmitter { virtual ~EventEmitter() = default; };
static int presses = 0;
struct SparkButtonEventEmitter : EventEmitter { struct Press {}; void onButtonPress(Press) const { ++presses; } };
struct LayoutMetrics {};
struct SparkButtonComponentDescriptor {};
using ComponentDescriptorProvider = int;
template<class T> int concreteComponentDescriptorProvider() { return 0; }
}
using namespace facebook::react;
@interface RCTViewComponentView : NSView {
@public Props::Shared _props; std::shared_ptr<const EventEmitter> _eventEmitter;
}
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps;
- (void)updateLayoutMetrics:(const LayoutMetrics &)metrics oldLayoutMetrics:(const LayoutMetrics &)old;
- (void)layoutSubviews;
- (void)prepareForRecycle;
@end
@implementation RCTViewComponentView
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps { _props = props; }
- (void)updateLayoutMetrics:(const LayoutMetrics &)metrics oldLayoutMetrics:(const LayoutMetrics &)old {}
- (void)layoutSubviews {}
- (void)prepareForRecycle {}
@end
@interface RNSparkButton : RCTViewComponentView @end
// ACTUAL_IMPLEMENTATION
int main() { @autoreleasepool {
  [NSApplication sharedApplication];
  RNSparkButton *view = [RNSparkButton new];
  view->_eventEmitter = std::make_shared<SparkButtonEventEmitter>();
  NSButton *button = [view valueForKey:@"button"];
  auto props = std::make_shared<SparkButtonProps>();
  props->title = "Save"; props->accessibilityLabel = "Save document"; props->testId = "save-button";
  auto update = [&] { [view updateProps:props oldProps:view->_props]; };
  update();
  assert([button.title isEqual:@"Save"] && [button.accessibilityLabel isEqual:@"Save document"]);
  assert([button.accessibilityIdentifier isEqual:@"save-button"]);
  // The codegen default (an omitted variant) is a plain push button: no Return key equivalent.
  assert(button.keyEquivalent.length == 0 && button.bezelStyle == NSBezelStyleRounded);
  props->variant = SparkButtonVariant::Default; update(); assert([button.keyEquivalent isEqual:@"\r"] && button.keyEquivalentModifierMask == 0);
  props->variant = SparkButtonVariant::Cancel; update(); assert([button.keyEquivalent isEqual:@"\e"]);
  props->variant = SparkButtonVariant::Push; update(); assert(button.keyEquivalent.length == 0 && button.bezelStyle == NSBezelStyleRounded);
  props->variant = SparkButtonVariant::Bevel; update(); assert(button.bezelStyle == NSBezelStyleRegularSquare);
  props->variant = SparkButtonVariant::Toolbar; update(); assert(button.bezelStyle == NSBezelStyleTexturedRounded);
  props->variant = SparkButtonVariant::Help; update(); assert(button.bezelStyle == NSBezelStyleHelpButton);
  props->variant = SparkButtonVariant::Destructive; update(); assert([button.contentTintColor isEqual:NSColor.systemRedColor]);
  props->variant = SparkButtonVariant::Borderless; update(); assert(!button.bordered && button.contentTintColor == nil);
  props->variant = SparkButtonVariant::Bordered; update(); assert(button.bordered);
  SparkButtonControlSize sizes[] = { SparkButtonControlSize::Mini, SparkButtonControlSize::Small, SparkButtonControlSize::Regular, SparkButtonControlSize::Large };
  NSControlSize nativeSizes[] = { NSControlSizeMini, NSControlSizeSmall, NSControlSizeRegular, NSControlSizeLarge };
  for (int i = 0; i < 4; ++i) {
    props->controlSize = sizes[i]; update(); assert(button.controlSize == nativeSizes[i]);
    assert(button.font.pointSize == [NSFont systemFontSizeForControlSize:nativeSizes[i]]);
  }
  [view pressed:button]; assert(presses == 1);
  props->disabled = true; update(); [view pressed:button]; assert(presses == 1 && !button.enabled);
  props->variant = SparkButtonVariant::Destructive; update(); [view prepareForRecycle];
  assert(button.enabled && button.bordered && button.title.length == 0);
  assert(button.contentTintColor == nil && button.keyEquivalent.length == 0 && button.controlSize == NSControlSizeRegular);
  assert(button.accessibilityIdentifier == nil && button.accessibilityLabel == nil);
  puts("Native button styles and sizes passed");
} }
