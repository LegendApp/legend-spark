#import <AppKit/AppKit.h>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <optional>
namespace facebook::react {
// Fabric types are stubbed; the methods in RCTViewComponentView below are the patch's source.
struct AccessibilityState { bool disabled{false}; bool selected{false}; };
enum class AccessibilityTraits : uint32_t { None = 0, Button = 1 << 0, NotEnabled = 1 << 8 };
constexpr AccessibilityTraits operator&(AccessibilityTraits a, AccessibilityTraits b) { return AccessibilityTraits(uint32_t(a) & uint32_t(b)); }
constexpr AccessibilityTraits operator|(AccessibilityTraits a, AccessibilityTraits b) { return AccessibilityTraits(uint32_t(a) | uint32_t(b)); }
struct ViewProps {
  std::optional<AccessibilityState> accessibilityState{std::nullopt};
  AccessibilityTraits accessibilityTraits{AccessibilityTraits::None};
};
using SharedViewProps = std::shared_ptr<const ViewProps>;
}
using namespace facebook::react;

// As upstream's updateProps:oldProps: on macOS: changed traits set accessibilityEnabled, and _props becomes the new props.
@interface RCTViewComponentView : NSView {
 @protected
  SharedViewProps _props;
}
- (void)update:(ViewProps)props;
@end
@implementation RCTViewComponentView
- (instancetype)initWithFrame:(NSRect)frame
{
  if ((self = [super initWithFrame:frame])) _props = std::make_shared<const ViewProps>();
  return self;
}
- (void)update:(ViewProps)props
{
  if (props.accessibilityTraits != _props->accessibilityTraits) {
    self.accessibilityEnabled = (props.accessibilityTraits & AccessibilityTraits::NotEnabled) == AccessibilityTraits::None;
  }
  _props = std::make_shared<const ViewProps>(props);
}
// ACTUAL_METHODS
@end

static int failures = 0;
// The view's own NSAccessibility answers, as the audit reads them. What an AX client such as VoiceOver reads needs the
// accessibility API, which an unsigned test process cannot use.
static void expectState(const char *what, RCTViewComponentView *view, BOOL enabled, BOOL selected)
{
  if (view.isAccessibilityEnabled != enabled || view.isAccessibilitySelected != selected) {
    std::printf("FAIL %s: enabled %d, selected %d; expected enabled %d, selected %d\n", what, view.isAccessibilityEnabled,
                view.isAccessibilitySelected, enabled, selected);
    failures++;
  }
}

int main(int argc, const char *argv[])
{
  @autoreleasepool {
    const char *scenario = argc > 1 ? argv[1] : "";
    RCTViewComponentView *view = [[RCTViewComponentView alloc] initWithFrame:NSMakeRect(0, 0, 40, 20)];
    view.accessibilityElement = YES;
    if (!std::strcmp(scenario, "plain")) {
      // No accessibilityState and no traits: enabled, where upstream, as a plain NSView, reports NO.
      expectState("no state", view, YES, NO);
    } else if (!std::strcmp(scenario, "disabled")) {
      [view update:{.accessibilityState = AccessibilityState{.disabled = true}, .accessibilityTraits = AccessibilityTraits::Button}];
      expectState("disabled", view, NO, NO);
    } else if (!std::strcmp(scenario, "selected")) {
      [view update:{.accessibilityState = AccessibilityState{.selected = true}, .accessibilityTraits = AccessibilityTraits::Button}];
      expectState("selected", view, YES, YES);
    } else if (!std::strcmp(scenario, "not-enabled-trait")) {
      [view update:{.accessibilityTraits = AccessibilityTraits::Button | AccessibilityTraits::NotEnabled}];
      expectState("not-enabled trait", view, NO, NO);
    } else if (!std::strcmp(scenario, "updates")) {
      [view update:{.accessibilityState = AccessibilityState{.disabled = true, .selected = true}}];
      expectState("disabled and selected", view, NO, YES);
      [view update:{.accessibilityState = AccessibilityState{}}];
      expectState("enabled again", view, YES, NO);
      [view update:{.accessibilityState = AccessibilityState{.selected = true}}];
      expectState("selected again", view, YES, YES);
      [view update:{}];
      expectState("state removed", view, YES, NO);
    } else {
      std::printf("FAIL unknown scenario %s\n", scenario);
      return 1;
    }
    if (failures) return 1;
    std::printf("PASS %s\n", scenario);
  }
  return 0;
}
