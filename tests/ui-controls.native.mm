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
// Mirrors react-native-macos: SharedColor wraps an NSColor, and the *FromColor helpers call -getRed:..., which throws for catalog and dynamic colors.
struct SharedColor { NSColor *color; explicit operator bool() const { return color != nil; } };
static int channel(SharedColor value, int index) { CGFloat c[4]; [value.color getRed:&c[0] green:&c[1] blue:&c[2] alpha:&c[3]]; return (int)(c[index] * 255); }
int redFromColor(SharedColor value) { return channel(value, 0); } int greenFromColor(SharedColor value) { return channel(value, 1); }
int blueFromColor(SharedColor value) { return channel(value, 2); } int alphaFromColor(SharedColor value) { return channel(value, 3); }
struct SFSymbolProps : Props { std::string name, scale, accessibilityLabel; double size = 24, yOffset = 0; SharedColor color{}; };
struct NativeSelectProps : Props { std::string itemsJson, value, accessibilityLabel, testId; bool enabled = true; };
enum class NativeSegmentedControlControlSize { Regular, Small };
enum class NativeSegmentedControlDistribution { Fit, Fill };
struct NativeSegmentedControlProps : Props {
  std::string segmentsJson, value, accessibilityLabel, testId; bool enabled = true;
  NativeSegmentedControlControlSize controlSize = NativeSegmentedControlControlSize::Regular;
  NativeSegmentedControlDistribution distribution = NativeSegmentedControlDistribution::Fit;
};
enum class SparkButtonVariant { Default, Bordered, Borderless, Checkbox, Disclosure };
enum class SparkButtonControlSize { Regular, Small, Mini };
struct SparkButtonProps : Props { std::string title, accessibilityLabel, testId, symbol; bool disabled = false, checked = false; int checkedRevision = 0; SparkButtonVariant variant = SparkButtonVariant::Default; SparkButtonControlSize controlSize = SparkButtonControlSize::Regular; };
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
static int buttonPresses = 0; static std::vector<std::pair<double, double>> intrinsicSizes; static std::vector<std::string> missingButtonSymbols;
struct SparkButtonEventEmitter : EventEmitter {
  struct OnButtonPress {}; struct OnIntrinsicSize { double height, width; }; struct OnSymbolError { std::string name, message; };
  void onSymbolError(OnSymbolError event) const { missingButtonSymbols.push_back(event.name); }
  void onButtonPress(OnButtonPress) const { ++buttonPresses; }
  void onIntrinsicSize(OnIntrinsicSize event) const { intrinsicSizes.push_back({event.width, event.height}); }
};
enum class SparkProgressIndicatorVariant { Bar, Spinner };
enum class SparkProgressIndicatorControlSize { Regular, Small, Mini };
struct SparkProgressIndicatorProps : Props { std::string accessibilityLabel; SparkProgressIndicatorVariant variant = SparkProgressIndicatorVariant::Bar; SparkProgressIndicatorControlSize controlSize = SparkProgressIndicatorControlSize::Regular; double value = 0; bool indeterminate = true; };
static std::vector<std::pair<double, double>> progressSizes;
struct SparkProgressIndicatorEventEmitter : EventEmitter {
  struct OnIntrinsicSize { double height, width; };
  void onIntrinsicSize(OnIntrinsicSize event) const { progressSizes.push_back({event.width, event.height}); }
};
struct SparkProgressIndicatorComponentDescriptor {};
struct SparkButtonComponentDescriptor {};
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
static NSColor *RCTUIColorFromSharedColor(const SharedColor &value) { return value.color; }
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
@interface RNSparkButton : RCTViewComponentView @end
@interface RNSparkProgressIndicator : RCTViewComponentView @end
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
  // PlatformColor and asset-catalog colors keep their dynamic NSColor instead of being flattened (or throwing).
  NSImageView *tinted = [symbol valueForKey:@"imageView"]; symbolProps->name = "doc";
  for (NSColor *color in @[NSColor.systemRedColor, NSColor.controlAccentColor, [NSColor colorWithCatalogName:@"System" colorName:@"labelColor"], [NSColor colorWithSRGBRed:0.2 green:0.4 blue:0.6 alpha:1]]) {
    symbolProps->color = SharedColor{color}; [symbol updateProps:symbolProps oldProps:symbol->_props]; assert([tinted.contentTintColor isEqual:color]);
  }
  symbolProps->color = SharedColor{}; [symbol updateProps:symbolProps oldProps:symbol->_props]; assert([tinted.contentTintColor isEqual:NSColor.labelColor]);
  // Buttons report their intrinsic size so JS needs no fixed width; a longer title reports a wider size.
  RNSparkButton *button = [RNSparkButton new]; auto buttonProps = std::make_shared<SparkButtonProps>(); buttonProps->title = "Save";
  [button updateProps:buttonProps oldProps:nullptr]; assert(intrinsicSizes.empty());
  [button updateEventEmitter:std::make_shared<SparkButtonEventEmitter>()];
  assert(intrinsicSizes.size() == 1 && intrinsicSizes[0].first > 20 && intrinsicSizes[0].first < 160 && intrinsicSizes[0].second > 10 && intrinsicSizes[0].second < 36);
  [button updateProps:buttonProps oldProps:button->_props]; assert(intrinsicSizes.size() == 1);
  buttonProps = std::make_shared<SparkButtonProps>(*buttonProps); buttonProps->title = "Save a much longer document title";
  [button updateProps:buttonProps oldProps:button->_props]; assert(intrinsicSizes.size() == 2 && intrinsicSizes[1].first > intrinsicSizes[0].first);
  // Checkbox: a native switch button whose state is controlled by `checked`; a press reports and a rejected change reverts.
  buttonProps = std::make_shared<SparkButtonProps>(*buttonProps); buttonProps->variant = SparkButtonVariant::Checkbox; buttonProps->title = "Amend";
  [button updateProps:buttonProps oldProps:button->_props];
  NSButton *box = [button valueForKey:@"button"];
  assert([box.title isEqual:@"Amend"] && box.state == NSControlStateValueOff && box.allowsMixedState == NO && !box.bordered);
  [box performClick:nil]; assert(buttonPresses == 1 && box.state == NSControlStateValueOn);
  buttonProps = std::make_shared<SparkButtonProps>(*buttonProps); buttonProps->checkedRevision = 1;
  [button updateProps:buttonProps oldProps:button->_props]; assert(box.state == NSControlStateValueOff);
  buttonProps = std::make_shared<SparkButtonProps>(*buttonProps); buttonProps->checked = true; buttonProps->disabled = true;
  [button updateProps:buttonProps oldProps:button->_props]; assert(box.state == NSControlStateValueOn && !box.enabled);
  // Disclosure: the push-disclosure chevron; `checked` is its expanded state and the title is its accessible name.
  buttonProps = std::make_shared<SparkButtonProps>(*buttonProps); buttonProps->variant = SparkButtonVariant::Disclosure; buttonProps->title = "Details"; buttonProps->disabled = false;
  [button updateProps:buttonProps oldProps:button->_props];
  NSButton *disclosure = [button valueForKey:@"button"];
  assert(disclosure != box && disclosure.superview == button && box.superview == nil);
  assert(disclosure.bezelStyle == NSBezelStylePushDisclosure && disclosure.title.length == 0 && [disclosure.accessibilityLabel isEqual:@"Details"] && disclosure.state == NSControlStateValueOn);
  [disclosure performClick:nil]; assert(buttonPresses == 2);
  buttonProps = std::make_shared<SparkButtonProps>(*buttonProps); buttonProps->checked = false; buttonProps->checkedRevision = 2;
  [button updateProps:buttonProps oldProps:button->_props]; assert(disclosure.state == NSControlStateValueOff);
  [button prepareForRecycle]; NSButton *recycled = [button valueForKey:@"button"]; assert(recycled.bezelStyle == NSBezelStyleRounded && recycled.state == NSControlStateValueOff);
  // Progress: a determinate bar holds its value; indeterminate animates; a spinner reports its native size per control size.
  {
    RNSparkProgressIndicator *progress = [RNSparkProgressIndicator new]; auto progressProps = std::make_shared<SparkProgressIndicatorProps>();
    progressProps->indeterminate = false; progressProps->value = 0.4; progressProps->accessibilityLabel = "Fetching";
    [progress updateProps:progressProps oldProps:nullptr];
    NSProgressIndicator *indicator = [progress valueForKey:@"indicator"];
    assert(indicator.style == NSProgressIndicatorStyleBar && !indicator.indeterminate && indicator.doubleValue == 0.4 && [indicator.accessibilityLabel isEqual:@"Fetching"]);
    [progress updateEventEmitter:std::make_shared<SparkProgressIndicatorEventEmitter>()];
    assert(progressSizes.size() == 1 && progressSizes[0].second > 0);
    progressProps = std::make_shared<SparkProgressIndicatorProps>(*progressProps); progressProps->indeterminate = true;
    [progress updateProps:progressProps oldProps:progress->_props]; assert(indicator.indeterminate);
    std::vector<double> spinnerSizes;
    for (auto size : {SparkProgressIndicatorControlSize::Regular, SparkProgressIndicatorControlSize::Small, SparkProgressIndicatorControlSize::Mini}) {
      progressProps = std::make_shared<SparkProgressIndicatorProps>(*progressProps); progressProps->variant = SparkProgressIndicatorVariant::Spinner; progressProps->controlSize = size;
      [progress updateProps:progressProps oldProps:progress->_props];
      assert(indicator.style == NSProgressIndicatorStyleSpinning && progressSizes.back().first == progressSizes.back().second);
      spinnerSizes.push_back(progressSizes.back().first);
    }
    assert(spinnerSizes[0] > spinnerSizes[1] && spinnerSizes[1] > spinnerSizes[2]);
    // AppKit draws bars in two sizes only; React rejects `mini` for bars.
    std::vector<double> barHeights;
    for (auto size : {SparkProgressIndicatorControlSize::Regular, SparkProgressIndicatorControlSize::Small}) {
      progressProps = std::make_shared<SparkProgressIndicatorProps>(*progressProps); progressProps->variant = SparkProgressIndicatorVariant::Bar; progressProps->controlSize = size;
      [progress updateProps:progressProps oldProps:progress->_props];
      barHeights.push_back(progressSizes.back().second);
    }
    assert(barHeights[0] > barHeights[1]);
  }
  // Symbol and control size: the image leads the title, smaller sizes shrink the control and its font, and a missing
  // symbol is reported once (also when the emitter arrives after the props) while the title stays.
  {
    RNSparkButton *iconButton = [RNSparkButton new]; auto iconProps = std::make_shared<SparkButtonProps>(); iconProps->title = "Generate"; iconProps->symbol = "sparkles";
    [iconButton updateProps:iconProps oldProps:nullptr];
    NSButton *control = [iconButton valueForKey:@"button"];
    assert(control.image && control.imagePosition == NSImageLeading && [control.title isEqual:@"Generate"] && control.controlSize == NSControlSizeRegular);
    [iconButton updateEventEmitter:std::make_shared<SparkButtonEventEmitter>()];
    NSSize regular = control.intrinsicContentSize;
    for (auto size : {SparkButtonControlSize::Small, SparkButtonControlSize::Mini}) {
      iconProps = std::make_shared<SparkButtonProps>(*iconProps); iconProps->controlSize = size;
      [iconButton updateProps:iconProps oldProps:iconButton->_props];
      assert(control.controlSize == (size == SparkButtonControlSize::Small ? NSControlSizeSmall : NSControlSizeMini));
      assert(control.font.pointSize == [NSFont systemFontSizeForControlSize:control.controlSize] && control.intrinsicContentSize.height < regular.height);
    }
    iconProps = std::make_shared<SparkButtonProps>(*iconProps); iconProps->symbol = "";
    [iconButton updateProps:iconProps oldProps:iconButton->_props]; assert(!control.image && control.imagePosition == NSNoImage);
    RNSparkButton *missing = [RNSparkButton new]; auto missingProps = std::make_shared<SparkButtonProps>(); missingProps->title = "Go"; missingProps->symbol = "__spark_missing_symbol__";
    [missing updateProps:missingProps oldProps:nullptr]; assert(missingButtonSymbols.empty());
    [missing updateEventEmitter:std::make_shared<SparkButtonEventEmitter>()];
    [missing updateProps:missingProps oldProps:missing->_props];
    assert(missingButtonSymbols.size() == 1 && missingButtonSymbols[0] == "__spark_missing_symbol__");
    // Coming back to a missing symbol after another one reports it again.
    for (const char *name : {"plus", "__spark_missing_symbol__"}) {
      missingProps = std::make_shared<SparkButtonProps>(*missingProps); missingProps->symbol = name;
      [missing updateProps:missingProps oldProps:missing->_props];
    }
    assert(missingButtonSymbols.size() == 2);
    assert([((NSButton *)[missing valueForKey:@"button"]).title isEqual:@"Go"]);
  }
  // Segmented control size and distribution.
  RNNativeSegmentedControl *sized = [RNNativeSegmentedControl new];
  auto sizedProps = std::make_shared<NativeSegmentedControlProps>(); sizedProps->segmentsJson = R"([{"label":"A","value":"a"},{"label":"Longer","value":"b"}])"; sizedProps->value = "a";
  [sized updateProps:sizedProps oldProps:nullptr];
  NSSegmentedControl *sizedView = [sized valueForKey:@"segmentedControl"];
  assert(sizedView.controlSize == NSControlSizeRegular && sizedView.segmentDistribution == NSSegmentDistributionFit && [sizedView widthForSegment:0] >= 64);
  sizedProps = std::make_shared<NativeSegmentedControlProps>(*sizedProps); sizedProps->controlSize = NativeSegmentedControlControlSize::Small;
  [sized updateProps:sizedProps oldProps:sized->_props];
  assert(sizedView.controlSize == NSControlSizeSmall && sizedView.font.pointSize == [NSFont systemFontSizeForControlSize:NSControlSizeSmall] && [sizedView widthForSegment:0] < 64);
  sizedProps = std::make_shared<NativeSegmentedControlProps>(*sizedProps); sizedProps->distribution = NativeSegmentedControlDistribution::Fill;
  [sized updateProps:sizedProps oldProps:sized->_props];
  assert(sizedView.segmentDistribution == NSSegmentDistributionFillEqually && [sizedView widthForSegment:0] == 0 && [sizedView widthForSegment:1] == 0);
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
