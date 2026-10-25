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
struct TextInputSearchProps : SparkTextInputProps { std::string appearance, placeholder; };
struct SFSymbolProps : Props { std::string name, scale, accessibilityLabel; double size = 24, yOffset = 0; int color = 0; };
int redFromColor(int value) { return 0; } int greenFromColor(int value) { return 0; } int blueFromColor(int value) { return 0; } int alphaFromColor(int value) { return 255; }
struct NativeSelectProps : Props { std::string itemsJson, value, accessibilityLabel, testId; bool enabled = true; };
struct NativeSegmentedControlProps : Props { std::string segmentsJson, value, accessibilityLabel, testId; bool enabled = true; };
struct EventEmitter { using Shared = std::shared_ptr<const EventEmitter>; virtual ~EventEmitter() = default; };
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
struct TextInputSearchEventEmitter : EventEmitter {
  using OnChangeText = TextChange;
  void onChangeText(OnChangeText event) const { changes.push_back(event); }
};
static int missingSymbols = 0;
struct SFSymbolEventEmitter : EventEmitter {
  struct OnSymbolError { std::string name, message; };
  void onSymbolError(OnSymbolError event) const { ++missingSymbols; }
};
struct TextInputSearchComponentDescriptor {};
struct SFSymbolComponentDescriptor {};
struct NativeSelectComponentDescriptor {};
struct NativeSegmentedControlComponentDescriptor {};
enum class LayoutDirection { Undefined, LeftToRight, RightToLeft };
struct LayoutMetrics { LayoutDirection layoutDirection = LayoutDirection::Undefined; };
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
- (void)updateEventEmitter:(EventEmitter::Shared const &)emitter;
- (void)layoutSubviews;
- (void)prepareForRecycle;
@end
@implementation RCTViewComponentView
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps { _props = props; }
- (void)updateLayoutMetrics:(const LayoutMetrics &)metrics oldLayoutMetrics:(const LayoutMetrics &)old {}
- (void)updateEventEmitter:(EventEmitter::Shared const &)emitter { _eventEmitter = emitter; }
- (void)layoutSubviews {}
- (void)prepareForRecycle {}
@end
@interface RNSparkTextInput : RCTViewComponentView <NSTextFieldDelegate> @end
@protocol RCTNativeSelectViewProtocol @end
@protocol RCTNativeSegmentedControlViewProtocol @end
@interface RNNativeSelect : RCTViewComponentView @end
@interface RNNativeSegmentedControl : RCTViewComponentView @end
@protocol RCTTextInputSearchViewProtocol @end
@protocol RCTSFSymbolViewProtocol @end
@interface RNTextInputSearch : RCTViewComponentView @end
@interface RNSFSymbol : RCTViewComponentView @end
static void RCTTextInputSearchHandleCommand(id view, const NSString *name, const NSArray *args) {}
// ACTUAL_IMPLEMENTATION
static void Update(RNSparkTextInput *view, std::shared_ptr<SparkTextInputProps> props) { [view updateProps:props oldProps:view->_props]; }
int main() { @autoreleasepool {
  [NSApplication sharedApplication];
  RNSparkTextInput *view = [RNSparkTextInput new];
  view->_eventEmitter = std::make_shared<SparkTextInputEventEmitter>();
  NSTextField *field = [view valueForKey:@"field"];
  auto props = std::make_shared<SparkTextInputProps>(); props->controlled = true; props->text = "original"; props->defaultText = "ignored";
  props->testId = "input"; props->accessibilityLabel = "Document title";
  [view updateProps:props oldProps:nullptr]; assert([field.stringValue isEqual:@"original"]); assert([field.accessibilityLabel isEqual:@"Document title"]);
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
  [view updateProps:props oldProps:nullptr]; assert([field.stringValue isEqual:@"initial"]); assert(field.enabled);
  field.stringValue = @"typed"; [view controlTextDidChange:[NSNotification notificationWithName:NSControlTextDidChangeNotification object:field]];
  assert(changes.back().eventCount == 1);
  props->defaultText = "changed default"; Update(view, props); assert([field.stringValue isEqual:@"typed"]);
  RNNativeSelect *select = [RNNativeSelect new];
  auto choices = std::make_shared<NativeSelectProps>();
  choices->itemsJson = R"([{"label":"Same","value":""},{"label":"Same","value":"second"}])";
  choices->value = "second";
  [select updateProps:choices oldProps:nullptr];
  NSPopUpButton *popup = [select valueForKey:@"popUpButton"];
  assert(popup.numberOfItems == 2); assert([popup.selectedItem.representedObject isEqual:@"second"]);
  choices->value = ""; [select updateProps:choices oldProps:select->_props]; assert([popup.selectedItem.representedObject isEqual:@""]);
  RNNativeSegmentedControl *segmented = [RNNativeSegmentedControl new];
  auto segments = std::make_shared<NativeSegmentedControlProps>(); segments->segmentsJson = choices->itemsJson; segments->value = "";
  [segmented updateProps:segments oldProps:nullptr];
  NSSegmentedControl *segmentsView = [segmented valueForKey:@"segmentedControl"];
  assert(segmentsView.segmentCount == 2 && segmentsView.selectedSegment == 0);
  RNTextInputSearch *search = [RNTextInputSearch new];
  search->_eventEmitter = std::make_shared<TextInputSearchEventEmitter>();
  auto searchProps = std::make_shared<TextInputSearchProps>(); searchProps->controlled = true; searchProps->text = "query";
  [search updateProps:searchProps oldProps:nullptr];
  NSSearchField *searchField = [search valueForKey:@"textField"];
  assert([searchField.stringValue isEqual:@"query"]);
  searchField.stringValue = @"new query";
  [search controlTextDidChange:[NSNotification notificationWithName:NSControlTextDidChangeNotification object:searchField]];
  searchProps->text = ""; [search updateProps:searchProps oldProps:search->_props]; assert([searchField.stringValue isEqual:@"new query"]);
  searchProps->eventCount = 1; [search updateProps:searchProps oldProps:search->_props]; assert(searchField.stringValue.length == 0);
  [search prepareForRecycle]; searchProps = std::make_shared<TextInputSearchProps>();
  [search updateProps:searchProps oldProps:nullptr];
  searchField.stringValue = @"typed"; searchProps->defaultText = "later default";
  [search updateProps:searchProps oldProps:search->_props]; assert([searchField.stringValue isEqual:@"typed"]);
  RNSFSymbol *symbol = [RNSFSymbol new]; auto symbolProps = std::make_shared<SFSymbolProps>(); symbolProps->name = "__spark_missing_symbol__";
  [symbol updateProps:symbolProps oldProps:nullptr]; assert(missingSymbols == 0);
  [symbol updateEventEmitter:std::make_shared<SFSymbolEventEmitter>()]; assert(missingSymbols == 1);
  [symbol updateProps:symbolProps oldProps:symbol->_props]; assert(missingSymbols == 1);
  symbolProps->name = "doc"; [symbol updateProps:symbolProps oldProps:symbol->_props];
  symbolProps->name = "__spark_missing_symbol__"; [symbol updateProps:symbolProps oldProps:symbol->_props]; assert(missingSymbols == 2);
  // Layout direction: Fabric's resolved direction reaches each AppKit control and follows later updates.
  LayoutMetrics ltr{LayoutDirection::LeftToRight}, rtl{LayoutDirection::RightToLeft};
  const auto R = NSUserInterfaceLayoutDirectionRightToLeft, L = NSUserInterfaceLayoutDirectionLeftToRight;
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 400, 200) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
  // Search: the magnifier and cancel button live in subviews NSSearchField creates lazily; they mirror too.
  RNTextInputSearch *rtlSearch = [RNTextInputSearch new]; rtlSearch.frame = NSMakeRect(0, 0, 300, 24);
  [window.contentView addSubview:rtlSearch];
  [rtlSearch updateLayoutMetrics:rtl oldLayoutMetrics:LayoutMetrics{}];
  NSSearchField *rtlField = [rtlSearch valueForKey:@"textField"]; [rtlField layoutSubtreeIfNeeded];
  auto magnifierX = [](NSSearchField *field) { return NSMidX([(NSSearchFieldCell *)field.cell searchButtonRectForBounds:field.bounds]); };
  assert(rtlField.subviews.count > 0);
  for (NSView *subview in rtlField.subviews) assert(subview.userInterfaceLayoutDirection == R);
  assert(rtlField.userInterfaceLayoutDirection == R && rtlField.alignment == NSTextAlignmentRight && magnifierX(rtlField) > 150);
  [rtlSearch updateLayoutMetrics:ltr oldLayoutMetrics:rtl];
  for (NSView *subview in rtlField.subviews) assert(subview.userInterfaceLayoutDirection == L);
  assert(rtlField.alignment == NSTextAlignmentLeft && magnifierX(rtlField) < 150);
  [rtlSearch updateLayoutMetrics:rtl oldLayoutMetrics:ltr]; assert(magnifierX(rtlField) > 150 && rtlField.alignment == NSTextAlignmentRight);
  // Segmented control: segments run from the right in RTL; indices and values keep their JS order.
  segments->segmentsJson = R"([{"label":"One","value":"one"},{"label":"Two","value":"two"},{"label":"Three","value":"three"}])"; segments->value = "one";
  [segmented updateProps:segments oldProps:segmented->_props]; segmented.frame = NSMakeRect(0, 40, 300, 28); [window.contentView addSubview:segmented];
  auto leftmostSegment = [&] {
    NSString *label; CGFloat minX = INFINITY;
    for (id segment in [segmentsView.cell accessibilityChildren]) if (NSMinX([segment accessibilityFrame]) < minX) { minX = NSMinX([segment accessibilityFrame]); label = [segment accessibilityLabel]; }
    return label;
  };
  [segmented updateLayoutMetrics:ltr oldLayoutMetrics:LayoutMetrics{}]; assert([leftmostSegment() isEqual:@"One"] && segmentsView.selectedSegment == 0);
  [segmented updateLayoutMetrics:rtl oldLayoutMetrics:ltr];
  assert(segmentsView.userInterfaceLayoutDirection == R && [leftmostSegment() isEqual:@"Three"] && segmentsView.selectedSegment == 0);
  [segmented updateLayoutMetrics:ltr oldLayoutMetrics:rtl]; assert(segmentsView.userInterfaceLayoutDirection == L && [leftmostSegment() isEqual:@"One"]);
  // Pop-up button, symbol image and text field.
  NSImageView *symbolView = [symbol valueForKey:@"imageView"];
  for (auto metrics : {rtl, ltr, rtl}) {
    auto direction = metrics.layoutDirection == LayoutDirection::RightToLeft ? R : L;
    [select updateLayoutMetrics:metrics oldLayoutMetrics:LayoutMetrics{}]; assert(popup.userInterfaceLayoutDirection == direction);
    [symbol updateLayoutMetrics:metrics oldLayoutMetrics:LayoutMetrics{}]; assert(symbolView.userInterfaceLayoutDirection == direction);
    [view updateLayoutMetrics:metrics oldLayoutMetrics:LayoutMetrics{}];
    assert(field.userInterfaceLayoutDirection == direction && field.alignment == (direction == R ? NSTextAlignmentRight : NSTextAlignmentLeft));
  }
  puts("Native text control tests passed");
} }
