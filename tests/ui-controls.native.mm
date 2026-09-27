#import <AppKit/AppKit.h>
#include <memory>
#include <string>
#include <vector>
#include <cassert>
namespace facebook::react {
struct Props { using Shared = std::shared_ptr<const Props>; virtual ~Props() = default; };
struct SparkTextInputProps : Props {
  std::string defaultText, text, testId, accessibilityLabel;
  bool controlled = false, disabled = false;
  int eventCount = 0;
};
struct NativeSelectProps : Props { std::string itemsJson, value, accessibilityLabel, testId; bool enabled = true; };
struct NativeSegmentedControlProps : Props { std::string segmentsJson, value, accessibilityLabel, testId; bool enabled = true; };
struct EventEmitter { virtual ~EventEmitter() = default; };
struct TextChange { std::string text; int eventCount; };
static std::vector<TextChange> changes;
struct SparkTextInputEventEmitter : EventEmitter { void onTextChange(TextChange event) const { changes.push_back(event); } };
struct NativeSelectEventEmitter : EventEmitter {
  struct OnValueChange { std::string value; };
  void onValueChange(OnValueChange event) const {}
};
struct NativeSegmentedControlEventEmitter : EventEmitter {
  struct OnValueChange { std::string value; };
  void onValueChange(OnValueChange event) const {}
};
struct NativeSelectComponentDescriptor {};
struct NativeSegmentedControlComponentDescriptor {};
struct LayoutMetrics {};
using ComponentDescriptorProvider = int;
struct SparkTextInputComponentDescriptor {};
template<class T> int concreteComponentDescriptorProvider() { return 0; }
}
using namespace facebook::react;
@interface RCTViewComponentView : NSView {
@public
  Props::Shared _props;
  std::shared_ptr<const EventEmitter> _eventEmitter;
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
@interface RNSparkTextInput : RCTViewComponentView <NSTextFieldDelegate> @end
@protocol RCTNativeSelectViewProtocol @end
@protocol RCTNativeSegmentedControlViewProtocol @end
@interface RNNativeSelect : RCTViewComponentView @end
@interface RNNativeSegmentedControl : RCTViewComponentView @end
// ACTUAL_IMPLEMENTATION
static void Update(RNSparkTextInput *view, std::shared_ptr<SparkTextInputProps> props) { [view updateProps:props oldProps:view->_props]; }
int main() { @autoreleasepool {
  [NSApplication sharedApplication];
  RNSparkTextInput *view = [RNSparkTextInput new];
  view->_eventEmitter = std::make_shared<SparkTextInputEventEmitter>();
  NSTextField *field = [view valueForKey:@"field"];
  auto props = std::make_shared<SparkTextInputProps>(); props->controlled = true; props->text = "original"; props->defaultText = "ignored";
  props->testId = "input"; props->accessibilityLabel = "Document title";
  Update(view, props); assert([field.stringValue isEqual:@"original"]); assert([field.accessibilityLabel isEqual:@"Document title"]);
  field.stringValue = @"edit"; [view controlTextDidChange:[NSNotification notificationWithName:NSControlTextDidChangeNotification object:field]];
  assert(changes.size() == 1 && changes[0].text == "edit" && changes[0].eventCount == 1);
  // A queued render from before the keystroke must not overwrite it.
  Update(view, props); assert([field.stringValue isEqual:@"edit"]);
  props = std::make_shared<SparkTextInputProps>(*props); props->eventCount = 1;
  Update(view, props); assert([field.stringValue isEqual:@"original"]);
  props->disabled = true; Update(view, props); assert(!field.enabled);
  [view controlTextDidChange:[NSNotification notificationWithName:NSControlTextDidChangeNotification object:field]]; assert(changes.size() == 1);
  [view prepareForRecycle];
  props = std::make_shared<SparkTextInputProps>(); props->defaultText = "initial";
  Update(view, props); assert([field.stringValue isEqual:@"initial"]); assert(field.enabled);
  field.stringValue = @"typed"; [view controlTextDidChange:[NSNotification notificationWithName:NSControlTextDidChangeNotification object:field]];
  assert(changes.back().eventCount == 1);
  props->defaultText = "changed default"; Update(view, props); assert([field.stringValue isEqual:@"typed"]);
  RNNativeSelect *select = [RNNativeSelect new];
  auto choices = std::make_shared<NativeSelectProps>();
  choices->itemsJson = R"([{"label":"Same","value":""},{"label":"Same","value":"second"}])";
  choices->value = "second";
  [select updateProps:choices oldProps:select->_props];
  NSPopUpButton *popup = [select valueForKey:@"popUpButton"];
  assert(popup.numberOfItems == 2); assert([popup.selectedItem.representedObject isEqual:@"second"]);
  choices->value = ""; [select updateProps:choices oldProps:select->_props]; assert([popup.selectedItem.representedObject isEqual:@""]);
  RNNativeSegmentedControl *segmented = [RNNativeSegmentedControl new];
  auto segments = std::make_shared<NativeSegmentedControlProps>(); segments->segmentsJson = choices->itemsJson; segments->value = "";
  [segmented updateProps:segments oldProps:segmented->_props];
  NSSegmentedControl *segmentsView = [segmented valueForKey:@"segmentedControl"];
  assert(segmentsView.segmentCount == 2 && segmentsView.selectedSegment == 0);
  puts("Native text control tests passed");
} }
