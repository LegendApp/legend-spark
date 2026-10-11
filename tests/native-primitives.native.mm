#import <AppKit/AppKit.h>
#include <memory>
#include <string>
#include <vector>
#include <cassert>
namespace facebook::react {
struct Props { using Shared = std::shared_ptr<const Props>; virtual ~Props() = default; };
struct SparkPrimitiveProps : Props { std::string kind, valueJson, controlSize = "regular", accessibilityLabel, testId; int eventCount = 0; bool disabled = false; };
struct EventEmitter { using Shared = std::shared_ptr<const EventEmitter>; virtual ~EventEmitter() = default; };
static std::vector<std::string> changes, errors, errorCodes;
static int lastCount = 0;
struct SparkPrimitiveEventEmitter : EventEmitter {
  struct OnValueChange { std::string valueJson; int eventCount; };
  struct OnNativeError { std::string message, code; int eventCount; };
  void onValueChange(OnValueChange value) const { assert(value.eventCount > lastCount || value.eventCount == 1); lastCount = value.eventCount; changes.push_back(value.valueJson); }
  void onNativeError(OnNativeError value) const { lastCount = value.eventCount; errors.push_back(value.message); errorCodes.push_back(value.code); }
};
struct SparkPrimitiveComponentDescriptor {};
enum class LayoutDirection { LeftToRight, RightToLeft };
struct LayoutMetrics { LayoutDirection layoutDirection = LayoutDirection::LeftToRight; };
using ComponentDescriptorProvider = int;
template<class T> int concreteComponentDescriptorProvider() { return 0; }
}
using namespace facebook::react;
@interface RCTViewComponentView : NSView {
@public
  Props::Shared _props;
  std::shared_ptr<const EventEmitter> _eventEmitter;
}
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps;
- (void)updateEventEmitter:(EventEmitter::Shared const &)eventEmitter;
- (void)updateLayoutMetrics:(const LayoutMetrics &)metrics oldLayoutMetrics:(const LayoutMetrics &)old;
- (void)layoutSubviews;
- (void)prepareForRecycle;
@end
@implementation RCTViewComponentView
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps { _props = props; }
- (void)updateEventEmitter:(EventEmitter::Shared const &)eventEmitter { _eventEmitter = eventEmitter; }
- (void)updateLayoutMetrics:(const LayoutMetrics &)metrics oldLayoutMetrics:(const LayoutMetrics &)old {}
- (void)layoutSubviews {}
- (void)prepareForRecycle {}
@end
@interface RNSparkPrimitive : RCTViewComponentView <NSComboBoxDelegate, NSTokenFieldDelegate> @end
// Records indicator animation instead of driving AppKit's timer.
static BOOL animating = NO;
@implementation NSProgressIndicator (Recording)
- (void)startAnimation:(id)sender { animating = YES; }
- (void)stopAnimation:(id)sender { animating = NO; }
@end
// Records the color panel instead of putting it on screen when a well activates.
static int colorPanelShown = 0;
@implementation NSColorPanel (Recording)
- (void)orderFront:(id)sender { colorPanelShown++; }
- (void)makeKeyAndOrderFront:(id)sender { colorPanelShown++; }
- (void)orderFrontRegardless { colorPanelShown++; }
@end
static BOOL driverActive = NO;
static BOOL SparkTestDriverActive(void) { return driverActive; }
// ACTUAL_IMPLEMENTATION
static void Update(RNSparkPrimitive *view, std::shared_ptr<SparkPrimitiveProps> props) { [view updateProps:props oldProps:view->_props]; }
// JS echoes an event count after it processes that event; `json` is the value the parent rendered.
static void Render(RNSparkPrimitive *view, std::shared_ptr<SparkPrimitiveProps> props, const char *json, int eventCount) {
  props->valueJson = json; props->eventCount = eventCount; Update(view, props);
}
static NSNotification *Note(NSString *name, id object) { return [NSNotification notificationWithName:name object:object]; }
int main() { @autoreleasepool {
  [NSApplication sharedApplication];
  RNSparkPrimitive *view = [RNSparkPrimitive new]; view.frame = NSMakeRect(0, 0, 300, 34);
  view->_eventEmitter = std::make_shared<SparkPrimitiveEventEmitter>();
  auto props = std::make_shared<SparkPrimitiveProps>();
  props->kind = "checkbox"; props->valueJson = R"({"value":"mixed","label":"Choice"})"; props->testId = "check"; props->accessibilityLabel = "Checkbox label";
  [view updateProps:props oldProps:nullptr]; NSButton *checkbox = [view valueForKey:@"control"];
  assert(checkbox.state == NSControlStateValueMixed); assert(checkbox.allowsMixedState); assert([checkbox.accessibilityLabel isEqual:@"Checkbox label"]);
  assert([checkbox.accessibilityIdentifier isEqual:@"check"]); assert([checkbox.title isEqual:@"Choice"] && [[checkbox.cell accessibilityLabel] isEqual:@"Checkbox label"]);
  checkbox.state = NSControlStateValueOn; [view changed:checkbox]; assert(changes.back() == "true" && lastCount == 1);
  // Props that predate the event leave the edit alone; the echo of a vetoed edit restores the controlled value.
  Update(view, props); assert(checkbox.state == NSControlStateValueOn);
  props->eventCount = lastCount; Update(view, props); assert(checkbox.state == NSControlStateValueMixed);
  // An unrelated render (same value, same acknowledged count) does not touch native state.
  checkbox.state = NSControlStateValueOff; Update(view, props); assert(checkbox.state == NSControlStateValueOff);
  props->eventCount = lastCount; checkbox.state = NSControlStateValueMixed;
  props->disabled = true; Update(view, props); auto count = changes.size(); [view changed:checkbox]; assert(changes.size() == count); assert(!checkbox.enabled);
  props->disabled = false;
  for (const auto &size : {"mini", "small", "regular", "large"}) {
    props->controlSize = size; Update(view, props); assert(checkbox.font.pointSize > 0);
  }
  props->kind = "radio-group"; props->valueJson = R"({"value":"b","options":[{"label":"Same","value":"a"},{"label":"Same","value":"b"}]})";
  Update(view, props); NSView *group = [view valueForKey:@"control"]; assert(group.subviews.count == 2);
  NSButton *first = group.subviews[0], *second = group.subviews[1]; assert(second.state == NSControlStateValueOn);
  [view changed:first]; assert(first.state == NSControlStateValueOn && second.state == NSControlStateValueOff); assert(changes.back() == "\"a\"");
  props->eventCount = lastCount; Update(view, props); assert(group.subviews[0] == first); assert(second.state == NSControlStateValueOn);
  LayoutMetrics rtl; rtl.layoutDirection = LayoutDirection::RightToLeft;
  [view updateLayoutMetrics:rtl oldLayoutMetrics:LayoutMetrics{}];
  assert(NSMinX(first.frame) > NSMinX(second.frame));
  assert(first.userInterfaceLayoutDirection == NSUserInterfaceLayoutDirectionRightToLeft);
  assert(group.accessibilityElement);
  [view updateLayoutMetrics:LayoutMetrics{} oldLayoutMetrics:rtl];
  props->kind = "switch"; props->valueJson = R"({"value":true,"label":"Enabled"})"; Update(view, props);
  NSSwitch *toggle = [view valueForKey:@"control"]; assert([toggle isKindOfClass:NSSwitch.class] && toggle.state == NSControlStateValueOn);
  toggle.state = NSControlStateValueOff; [view changed:toggle]; assert(changes.back() == "false");
  props->kind = "slider"; props->valueJson = R"({"value":5,"min":0,"max":10,"step":2,"ticks":6,"continuous":true})"; Update(view, props);
  NSSlider *slider = [view valueForKey:@"control"]; assert(slider.continuous && slider.numberOfTickMarks == 6);
  slider.doubleValue = 7.2; [view changed:slider]; assert(slider.doubleValue == 8); assert(changes.back() == "8");
  [slider accessibilityPerformDecrement]; assert(slider.doubleValue == 6); assert(changes.back() == "6");
  NSEvent *rightArrow = [NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint modifierFlags:0 timestamp:0 windowNumber:0 context:nil characters:@"\uF703" charactersIgnoringModifiers:@"\uF703" isARepeat:NO keyCode:124];
  [slider keyDown:rightArrow]; assert(slider.doubleValue == 8);
  slider.doubleValue = 5; [slider accessibilityPerformIncrement]; assert(slider.doubleValue == 7); assert(changes.back() == "7");
  slider.enabled = NO; assert(![slider accessibilityPerformIncrement]); assert(slider.doubleValue == 7); slider.enabled = YES;
  // Continuous drag: JS lags two events behind; the stale value must not snap the knob back.
  Render(view, props, R"({"value":4,"min":0,"max":10,"step":1,"ticks":0,"continuous":true})", lastCount); assert(slider.doubleValue == 4);
  slider.doubleValue = 5; [view changed:slider]; int dragStart = lastCount;
  slider.doubleValue = 6; [view changed:slider]; assert(changes.back() == "6");
  Render(view, props, R"({"value":5,"min":0,"max":10,"step":1,"ticks":0,"continuous":true})", dragStart); assert(slider.doubleValue == 6);
  slider.doubleValue = 7; [view changed:slider];
  Render(view, props, R"({"value":6,"min":0,"max":10,"step":1,"ticks":0,"continuous":true})", dragStart + 1); assert(slider.doubleValue == 7);
  Render(view, props, R"({"value":7,"min":0,"max":10,"step":1,"ticks":0,"continuous":true})", lastCount); assert(slider.doubleValue == 7);
  // A parent clamp applies once caught up.
  slider.doubleValue = 9; [view changed:slider];
  Render(view, props, R"({"value":8,"min":0,"max":10,"step":1,"ticks":0,"continuous":true})", lastCount); assert(slider.doubleValue == 8);
  // A value that cannot be JSON is reported with its event count, and the echo restores the control.
  auto errorCount = errors.size(), changeCount = changes.size();
  slider.doubleValue = 3; [view emitValue:@(NAN)]; assert(errors.size() == errorCount + 1 && changes.size() == changeCount);
  assert(errors.back().find("JSON") != std::string::npos);
  props->eventCount = lastCount; Update(view, props); assert(slider.doubleValue == 8);
  [view emitValue:@{@1: @"non-string key"}]; assert(errors.size() == errorCount + 2);
  // Invalid configuration JSON is reported and the last valid configuration stays on screen.
  Render(view, props, "{", lastCount); assert(errors.back().find("Invalid slider configuration") != std::string::npos);
  assert(slider.doubleValue == 8 && slider.maxValue == 10 && [view valueForKey:@"control"] == slider);
  Render(view, props, "[]", lastCount); assert(slider.doubleValue == 8 && slider.maxValue == 10);
  props->kind = "stepper"; props->valueJson = R"({"value":4,"min":0,"max":10,"step":2})"; Update(view, props);
  NSStepper *stepper = [view valueForKey:@"control"]; assert(stepper.increment == 2 && !stepper.valueWraps && stepper.doubleValue == 4);
  // A stepper increments relative to its current value, even off the slider's min-based grid.
  stepper.doubleValue = 7; [view changed:stepper]; assert(stepper.doubleValue == 7); assert(changes.back() == "7");
  props->kind = "combo-box"; props->valueJson = R"({"value":"one","options":["one","two"]})"; Update(view, props);
  NSComboBox *combo = [view valueForKey:@"control"]; assert(combo.numberOfItems == 2); [combo selectItemAtIndex:1];
  [view comboBoxSelectionDidChange:[NSNotification notificationWithName:NSComboBoxSelectionDidChangeNotification object:combo]]; assert(changes.back() == "\"two\"");
  combo.stringValue = @"typed"; [view controlTextDidChange:Note(NSControlTextDidChangeNotification, combo)]; assert(changes.back() == "\"typed\"");
  Update(view, props); assert([combo.stringValue isEqual:@"typed"]); props->eventCount = lastCount; Update(view, props); assert([combo.stringValue isEqual:@"one"]);
  // Typing ahead of JS: each stale echo arrives after the next keystroke and must not erase it.
  combo.stringValue = @"t"; [view controlTextDidChange:Note(NSControlTextDidChangeNotification, combo)]; int typed = lastCount;
  combo.stringValue = @"tw"; [view controlTextDidChange:Note(NSControlTextDidChangeNotification, combo)];
  Render(view, props, R"({"value":"t","options":["one","two"]})", typed); assert([combo.stringValue isEqual:@"tw"]);
  combo.stringValue = @"two"; [view controlTextDidChange:Note(NSControlTextDidChangeNotification, combo)];
  Render(view, props, R"({"value":"tw","options":["one","two"]})", typed + 1); assert([combo.stringValue isEqual:@"two"]);
  Render(view, props, R"({"value":"two","options":["one","two"]})", lastCount); assert([combo.stringValue isEqual:@"two"]);
  // A parent that rejects the last keystroke restores its value once caught up.
  combo.stringValue = @"two!"; [view controlTextDidChange:Note(NSControlTextDidChangeNotification, combo)];
  Render(view, props, R"({"value":"two","options":["one","two"]})", lastCount); assert([combo.stringValue isEqual:@"two"]);
  props->kind = "token-field"; props->valueJson = R"({"value":["one","two"]})"; Update(view, props);
  NSTokenField *tokens = [view valueForKey:@"control"]; assert(([tokens.objectValue isEqual:@[@"one", @"two"]]));
  tokens.objectValue = @[@"three"]; [view controlTextDidEndEditing:Note(NSControlTextDidEndEditingNotification, tokens)]; assert(changes.back() == "[\"three\"]");
  int committed = lastCount;
  tokens.objectValue = @[@"three", @"four"]; [view controlTextDidEndEditing:Note(NSControlTextDidEndEditingNotification, tokens)];
  Render(view, props, R"({"value":["three"]})", committed); assert(([tokens.objectValue isEqual:@[@"three", @"four"]]));
  Render(view, props, R"({"value":["three","four"]})", lastCount); assert(([tokens.objectValue isEqual:@[@"three", @"four"]]));
  // An uncommitted token survives unrelated renders; a vetoed commit is restored.
  tokens.objectValue = @[@"three", @"four", @"draft"]; Update(view, props); assert(([tokens.objectValue isEqual:@[@"three", @"four", @"draft"]]));
  [view controlTextDidEndEditing:Note(NSControlTextDidEndEditingNotification, tokens)];
  props->eventCount = lastCount; Update(view, props); assert(([tokens.objectValue isEqual:@[@"three", @"four"]]));
  props->kind = "path-control"; props->valueJson = R"({"value":"file:///tmp/"})"; Update(view, props);
  NSPathControl *path = [view valueForKey:@"control"]; assert([path.URL.path isEqual:@"/tmp"]); [view changed:path]; assert(changes.back().find("file:") != std::string::npos);
  props->kind = "progress"; props->valueJson = R"({"value":0.5,"mode":"determinate"})"; Update(view, props);
  NSProgressIndicator *progress = [view valueForKey:@"control"]; assert(!progress.indeterminate && progress.doubleValue == 0.5);
  props->valueJson = R"({"value":0,"mode":"indeterminate"})"; Update(view, props); assert(progress.indeterminate && progress.style == NSProgressIndicatorStyleBar);
  props->valueJson = R"({"value":0,"mode":"spinner"})"; Update(view, props); assert(progress.indeterminate && progress.style == NSProgressIndicatorStyleSpinning && animating);
  props->disabled = true; Update(view, props); assert(animating);
  props->valueJson = R"({"value":0.5,"mode":"determinate"})"; Update(view, props); assert(!animating);
  props->disabled = false;
  props->kind = "level-indicator"; props->valueJson = R"({"value":5,"min":0,"max":10,"step":1})"; Update(view, props);
  NSLevelIndicator *level = [view valueForKey:@"control"]; assert(level.doubleValue == 5 && level.maxValue == 10);
  props->kind = "disclosure-triangle"; props->valueJson = R"({"value":true,"label":"Details"})"; Update(view, props);
  props->accessibilityLabel = "Details";
  NSButton *disclosure = [view valueForKey:@"control"]; assert(disclosure.bezelStyle == NSBezelStyleDisclosure && disclosure.state == NSControlStateValueOn);
  // Image-only, like AppKit's own disclosure triangle: a title would be truncated to an ellipsis beside the triangle.
  assert(disclosure.title.length == 0 && disclosure.imagePosition == NSImageOnly);
  Update(view, props);
  assert([[disclosure.cell accessibilityRole] isEqual:NSAccessibilityDisclosureTriangleRole] && [[disclosure.cell accessibilityLabel] isEqual:@"Details"]);
  assert(NSEqualSizes(disclosure.frame.size, disclosure.fittingSize) && NSMinX(disclosure.frame) == 0);
  [view updateLayoutMetrics:rtl oldLayoutMetrics:LayoutMetrics{}];
  assert(NSMaxX(disclosure.frame) == NSWidth(view.bounds) && disclosure.userInterfaceLayoutDirection == NSUserInterfaceLayoutDirectionRightToLeft);
  [view updateLayoutMetrics:LayoutMetrics{} oldLayoutMetrics:rtl];
  Render(view, props, R"({"value":false,"label":"Details"})", lastCount); assert(disclosure.state == NSControlStateValueOff && disclosure.title.length == 0);
  disclosure.state = NSControlStateValueOn; [view changed:disclosure]; assert(changes.back() == "true");
  props->eventCount = lastCount; Update(view, props); assert(disclosure.state == NSControlStateValueOff);
  [view prepareForRecycle]; assert(view.subviews.count == 0);
  props->eventCount = 0; [view updateProps:props oldProps:nullptr]; assert(view.subviews.count == 1);
  disclosure = [view valueForKey:@"control"]; disclosure.state = NSControlStateValueOff; [view changed:disclosure]; assert(lastCount == 1);
  // An error from props applied before the event emitter is attached is delivered once it is.
  RNSparkPrimitive *fresh = [RNSparkPrimitive new]; auto bad = std::make_shared<SparkPrimitiveProps>(); bad->kind = "switch"; bad->valueJson = "not json";
  errorCount = errors.size(); [fresh updateProps:bad oldProps:nullptr]; assert(errors.size() == errorCount && fresh.subviews.count == 1);
  [fresh updateEventEmitter:std::make_shared<SparkPrimitiveEventEmitter>()]; assert(errors.size() == errorCount + 1);
  // Date picker: first mount with null oldProps; config, value round trip, min/max, locale, calendar, time zone, RTL.
  RNSparkPrimitive *dates = [RNSparkPrimitive new]; dates.frame = NSMakeRect(0, 0, 300, 160);
  dates->_eventEmitter = std::make_shared<SparkPrimitiveEventEmitter>(); lastCount = 0;
  auto date = std::make_shared<SparkPrimitiveProps>(); date->kind = "date-picker"; date->testId = "date";
  date->valueJson = R"({"value":1773480600000,"mode":"date-time","variant":"text-field-stepper","min":1767225600000,"max":1798761600000,"locale":"en-US","calendar":"","timeZone":"UTC"})";
  [dates updateProps:date oldProps:nullptr]; NSDatePicker *picker = [dates valueForKey:@"control"];
  assert([picker isKindOfClass:NSDatePicker.class] && picker.datePickerStyle == NSDatePickerStyleTextFieldAndStepper);
  assert(picker.datePickerElements == (NSDatePickerElementFlagYearMonthDay | NSDatePickerElementFlagHourMinute));
  assert(picker.dateValue.timeIntervalSince1970 == 1773480600 && picker.minDate.timeIntervalSince1970 == 1767225600 && picker.maxDate.timeIntervalSince1970 == 1798761600);
  assert([picker.timeZone isEqual:[NSTimeZone timeZoneWithName:@"UTC"]] && [picker.locale.localeIdentifier isEqual:@"en-US"] && [picker.calendar.calendarIdentifier isEqual:NSCalendarIdentifierGregorian] && [picker.calendar.timeZone isEqual:picker.timeZone]);
  assert([picker.accessibilityIdentifier isEqual:@"date"]);
  picker.dateValue = [NSDate dateWithTimeIntervalSince1970:1773567000.0004]; [dates changed:picker]; assert(changes.back() == "1773567000000" && lastCount == 1);
  // Stale props keep the edit; the echo of a vetoed edit restores the controlled date.
  Update(dates, date); assert(picker.dateValue.timeIntervalSince1970 > 1773567000);
  date->eventCount = lastCount; Update(dates, date); assert(picker.dateValue.timeIntervalSince1970 == 1773480600);
  Render(dates, date, R"({"value":1773480600000,"mode":"time","variant":"clock-calendar","min":null,"max":null,"locale":"ar-SA","calendar":"","timeZone":"Asia/Riyadh"})", lastCount);
  assert(picker.datePickerStyle == NSDatePickerStyleClockAndCalendar && picker.datePickerElements == NSDatePickerElementFlagHourMinute && !picker.minDate && !picker.maxDate);
  // An omitted calendar is the locale's own.
  assert([picker.calendar.calendarIdentifier isEqual:NSCalendarIdentifierIslamicUmmAlQura] && [picker.timeZone.name isEqual:@"Asia/Riyadh"]);
  Render(dates, date, R"({"value":1773480600000,"mode":"date","variant":"clock-calendar","min":null,"max":null,"locale":"ar-SA","calendar":"japanese","timeZone":""})", lastCount);
  assert([picker.calendar.calendarIdentifier isEqual:NSCalendarIdentifierJapanese] && [picker.timeZone isEqual:NSTimeZone.localTimeZone]);
  // Sized to fit, at the leading edge.
  assert(NSMinX(picker.frame) == 0 && fabs(NSWidth(picker.frame) - picker.fittingSize.width) < 1 && NSHeight(picker.frame) == picker.fittingSize.height);
  [dates updateLayoutMetrics:rtl oldLayoutMetrics:LayoutMetrics{}];
  assert(picker.userInterfaceLayoutDirection == NSUserInterfaceLayoutDirectionRightToLeft && NSMaxX(picker.frame) == NSWidth(dates.bounds));
  [dates updateLayoutMetrics:LayoutMetrics{} oldLayoutMetrics:rtl];
  // Names Foundation does not know are reported, and the last valid configuration stays.
  for (const char *bad : {R"({"value":0,"mode":"date","variant":"text-field","min":null,"max":null,"locale":"zz","calendar":"","timeZone":""})",
                          R"({"value":0,"mode":"date","variant":"text-field","min":null,"max":null,"locale":"","calendar":"","timeZone":"Mars/Olympus"})",
                          R"({"value":0,"mode":"date","variant":"text-field","min":null,"max":null,"locale":"","calendar":"martian","timeZone":""})"}) {
    errorCount = errors.size(); Render(dates, date, bad, lastCount);
    assert(errors.size() == errorCount + 1 && errors.back().find("Unknown") != std::string::npos && errorCodes.back() == "E_INVALID_ARGUMENT");
    assert(picker.datePickerStyle == NSDatePickerStyleClockAndCalendar && [picker.calendar.calendarIdentifier isEqual:NSCalendarIdentifierJapanese]);
  }
  // A fresh view whose first props are invalid shows nothing valid and reports it once attached.
  RNSparkPrimitive *badDate = [RNSparkPrimitive new]; auto badProps = std::make_shared<SparkPrimitiveProps>(); badProps->kind = "date-picker";
  badProps->valueJson = R"({"value":0,"mode":"date","variant":"text-field","min":null,"max":null,"locale":"","calendar":"","timeZone":"Nowhere"})";
  errorCount = errors.size(); [badDate updateProps:badProps oldProps:nullptr]; [badDate updateEventEmitter:std::make_shared<SparkPrimitiveEventEmitter>()];
  assert(errors.size() == errorCount + 1 && errorCodes.back() == "E_INVALID_ARGUMENT");

  // Color well: style, alpha, hex round trip, reconciliation, and handing the shared panel over.
  RNSparkPrimitive *wells = [RNSparkPrimitive new]; wells.frame = NSMakeRect(0, 0, 52, 30);
  wells->_eventEmitter = std::make_shared<SparkPrimitiveEventEmitter>(); lastCount = 0;
  auto color = std::make_shared<SparkPrimitiveProps>(); color->kind = "color-well"; color->valueJson = R"({"value":"#3366cc","alpha":false,"variant":"default"})";
  [wells updateProps:color oldProps:nullptr]; NSColorWell *well = [wells valueForKey:@"control"];
  assert(well.colorWellStyle == NSColorWellStyleDefault && !well.supportsAlpha && [SparkHexFromColor(well.color, NO) isEqual:@"#3366cc"]);
  well.color = [NSColor colorWithSRGBRed:1 green:0.5 blue:0 alpha:1]; [wells changed:well]; assert(changes.back() == "\"#ff8000\"");
  Update(wells, color); assert([SparkHexFromColor(well.color, NO) isEqual:@"#ff8000"]);
  color->eventCount = lastCount; Update(wells, color); assert([SparkHexFromColor(well.color, NO) isEqual:@"#3366cc"]);
  // Display P3 and other color spaces report their sRGB form.
  well.color = [NSColor colorWithDisplayP3Red:0 green:0 blue:1 alpha:1]; [wells changed:well]; assert(changes.back().size() == 9);
  Render(wells, color, R"({"value":"#11223380","alpha":true,"variant":"expanded"})", lastCount);
  assert(well.colorWellStyle == NSColorWellStyleExpanded && well.supportsAlpha && [SparkHexFromColor(well.color, YES) isEqual:@"#11223380"]);
  well.color = [NSColor colorWithSRGBRed:0 green:0 blue:0 alpha:0.25]; [wells changed:well]; assert(changes.back() == "\"#00000040\"");
  // A pattern has no sRGB form: reported with its own count, never sent as a value.
  changeCount = changes.size(); errorCount = errors.size();
  well.color = [NSColor colorWithPatternImage:[NSImage imageWithSize:NSMakeSize(2, 2) flipped:NO drawingHandler:^BOOL(NSRect r) { return YES; }]];
  [wells changed:well]; assert(changes.size() == changeCount && errors.size() == errorCount + 1 && errors.back().find("sRGB") != std::string::npos);
  color->eventCount = lastCount; Update(wells, color); assert([SparkHexFromColor(well.color, YES) isEqual:@"#11223380"]);
  Render(wells, color, R"({"value":"#11223380","alpha":true,"variant":"default"})", lastCount);
  [well activate:YES]; assert(well.isActive && colorPanelShown > 0);
  // Another owner (showColorPanel or a second well) takes the panel: this well lets go.
  RNSparkPrimitive *otherView = [RNSparkPrimitive new]; otherView->_eventEmitter = std::make_shared<SparkPrimitiveEventEmitter>();
  [otherView updateProps:color oldProps:nullptr]; NSColorWell *other = [otherView valueForKey:@"control"];
  [other activate:YES]; assert(other.isActive && !well.isActive);
  [NSNotificationCenter.defaultCenter postNotificationName:SparkColorPanelOwnerWillChange object:[NSObject new]]; assert(!other.isActive);
  // Disabling or recycling an active well releases the panel.
  // Driver mode never shows the panel: activating reports E_UNAVAILABLE and leaves the panel alone.
  driverActive = YES; int panelShows = colorPanelShown; errorCount = errors.size();
  [well activate:YES]; assert(!well.isActive && colorPanelShown == panelShows && errors.size() == errorCount + 1 && errorCodes.back() == "E_UNAVAILABLE");
  driverActive = NO; assert(errorCodes[errorCount - 1] == "E_INVALID_DATA");
  [well activate:YES]; color->disabled = true; Update(wells, color); assert(!well.isActive && !well.enabled); color->disabled = false;
  [other activate:YES]; [otherView prepareForRecycle]; assert(!other.isActive && otherView.subviews.count == 0);
  puts("Native primitive tests passed");
} }
