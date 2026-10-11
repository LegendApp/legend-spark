#import <AppKit/AppKit.h>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>
#import <objc/runtime.h>
#import "SparkTextServices.h"

// Stubs for the Fabric types RNSparkTextInput uses; the component below is the shipped source.
namespace facebook::react {
struct Props { using Shared = std::shared_ptr<const Props>; virtual ~Props() = default; };
struct SparkTextInputProps : Props {
  std::string defaultText, text, testId, accessibilityLabel;
  bool controlled = false, disabled = false;
  int eventCount = 0;
};
struct EventEmitter { using Shared = std::shared_ptr<const EventEmitter>; virtual ~EventEmitter() = default; };
struct TextChange { std::string text; int eventCount; };
static std::vector<TextChange> changes;
struct SparkTextInputEventEmitter : EventEmitter { void onTextChange(TextChange event) const { changes.push_back(event); } };
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
// ACTUAL_SPARK_TEXT_INPUT

// The RN macOS multiline TextInput's NSTextView with the patched RCTUITextView initializer lines.
@interface PatchedTextView : NSTextView @end
@implementation PatchedTextView
- (instancetype)initWithFrame:(NSRect)frame
{
  if (self = [super initWithFrame:frame]) {
// ACTUAL_PATCHED_INIT
  }
  return self;
}
@end

// The patched RCTTextInputComponentView helpers.
// ACTUAL_WRITING_TOOLS_HELPERS

// Records Look Up instead of opening the definition window.
static NSRange lookedUp = {NSNotFound, 0};
static int lookUps = 0;
@interface RecordingTextView : PatchedTextView @end
@implementation RecordingTextView
- (void)showDefinitionForAttributedString:(NSAttributedString *)string range:(NSRange)range options:(NSDictionary *)options baselineOriginProvider:(NSPoint (^)(NSRange))provider
{
  ++lookUps; lookedUp = range;
}
@end
@interface ChangeCounter : NSObject <NSTextViewDelegate> @property int count; @end
@implementation ChangeCounter
- (void)textDidChange:(NSNotification *)notification { ++self.count; }
@end

static int failures = 0;
#define CHECK(condition) do { if (!(condition)) { fprintf(stderr, "FAIL %s:%d %s\n", __FILE__, __LINE__, #condition); ++failures; } } while (0)

static NSWindow *Window()
{
  return [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 400, 300) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
}
/** A multiline RN TextInput's hierarchy: scroll view > clip view > text view, inside the component view. */
static NSTextView *MultilineInput(NSWindow *window, NSString *text, Class textViewClass = PatchedTextView.class)
{
  NSView *component = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 400, 300)];
  NSScrollView *scroll = [[NSScrollView alloc] initWithFrame:component.bounds];
  NSTextView *textView = [[textViewClass alloc] initWithFrame:scroll.bounds];
  textView.string = text;
  scroll.documentView = textView;
  [component addSubview:scroll];
  window.contentView = component;
  return textView;
}
// AppKit text views register for Services with the legacy string type, which the Services menu sends.
static NSPasteboardType const LegacyString = @"NSStringPboardType";
static NSString *Selected(NSTextView *textView) { return [textView.string substringWithRange:textView.selectedRange]; }

static void Find()
{
  NSWindow *window = Window();
  NSTextView *textView = MultilineInput(window, @"Spark apps. spark Services. SPARK find.");
  CHECK(SparkTextServicesTextView(window.contentView) == textView);
  textView.selectedRange = NSMakeRange(0, 0);
  SparkTextFindResult result = SparkTextFind(textView, @"spark", NO, YES, NO);
  CHECK(result.matchCount == 3 && result.matchIndex == 1 && NSEqualRanges(textView.selectedRange, NSMakeRange(0, 5)));
  result = SparkTextFind(textView, @"spark", NO, YES, NO);
  CHECK(result.matchIndex == 2 && NSEqualRanges(textView.selectedRange, NSMakeRange(12, 5)));
  result = SparkTextFind(textView, @"spark", NO, YES, NO);
  CHECK(result.matchIndex == 3 && [Selected(textView) isEqual:@"SPARK"]);
  // Past the last match: wrap returns to the first; without wrap nothing is selected and the selection stays.
  CHECK(SparkTextFind(textView, @"spark", NO, NO, NO).matchIndex == 0 && [Selected(textView) isEqual:@"SPARK"]);
  result = SparkTextFind(textView, @"spark", NO, YES, NO);
  CHECK(result.matchIndex == 1 && NSEqualRanges(textView.selectedRange, NSMakeRange(0, 5)));
  // Backwards from the first match: nothing before it without wrap, the last match with wrap.
  CHECK(SparkTextFind(textView, @"spark", NO, NO, YES).matchIndex == 0);
  result = SparkTextFind(textView, @"spark", NO, YES, YES);
  CHECK(result.matchIndex == 3 && [Selected(textView) isEqual:@"SPARK"]);
  result = SparkTextFind(textView, @"spark", NO, YES, YES);
  CHECK(result.matchIndex == 2 && NSEqualRanges(textView.selectedRange, NSMakeRange(12, 5)));
  // Case sensitivity, non-overlapping counts and no match.
  textView.selectedRange = NSMakeRange(0, 0);
  result = SparkTextFind(textView, @"spark", YES, YES, NO);
  CHECK(result.matchCount == 1 && result.matchIndex == 1 && NSEqualRanges(textView.selectedRange, NSMakeRange(12, 5)));
  result = SparkTextFind(textView, @"absent", NO, YES, NO);
  CHECK(result.matchCount == 0 && result.matchIndex == 0 && NSEqualRanges(textView.selectedRange, NSMakeRange(12, 5)));
  textView.string = @"aaaa"; textView.selectedRange = NSMakeRange(0, 0);
  CHECK(SparkTextFind(textView, @"aa", NO, YES, NO).matchCount == 2);
  // A non-editable (read-only) text view is searchable too.
  textView.editable = NO; textView.selectedRange = NSMakeRange(0, 0);
  CHECK(SparkTextFind(textView, @"aa", NO, YES, NO).matchIndex == 1);
}

static void FindBar()
{
  NSWindow *window = Window();
  NSTextView *textView = MultilineInput(window, @"Find in this text");
  CHECK(textView.usesFindBar && textView.incrementalSearchingEnabled);
  NSMenuItem *find = [[NSMenuItem alloc] initWithTitle:@"Find…" action:@selector(performFindPanelAction:) keyEquivalent:@"f"];
  find.tag = NSTextFinderActionShowFindInterface;
  CHECK([textView validateMenuItem:find]);
  CHECK(!textView.enclosingScrollView.findBarVisible);
  CHECK(SparkTextShowFindBar(textView));
  CHECK(textView.enclosingScrollView.findBarVisible && textView.enclosingScrollView.findBarView != nil);
  // The find bar's search field takes focus.
  CHECK([window.firstResponder isKindOfClass:NSView.class] && [(NSView *)window.firstResponder isDescendantOf:textView.enclosingScrollView.findBarView]);
  // An unpatched NSTextView, as RN macOS ships it, disables Edit > Find and has no find bar.
  NSTextView *plain = MultilineInput(Window(), @"Find in this text", NSTextView.class);
  CHECK(![plain validateMenuItem:find]);
  CHECK(!SparkTextShowFindBar(plain) && !plain.enclosingScrollView.findBarVisible);
  // Selectable text outside a scroll view has no find bar container.
  NSTextView *loose = [[PatchedTextView alloc] initWithFrame:NSMakeRect(0, 0, 100, 20)];
  CHECK(!SparkTextShowFindBar(loose));
}

static void LookUp()
{
  NSTextView *textView = MultilineInput(Window(), @"Look up serendipity today", RecordingTextView.class);
  textView.selectedRange = NSMakeRange(8, 11);
  SparkTextLookUp(textView);
  CHECK(lookUps == 1 && NSEqualRanges(lookedUp, NSMakeRange(8, 11)));
  // An insertion point passes a zero-length range: AppKit picks the word around it.
  textView.selectedRange = NSMakeRange(10, 0);
  SparkTextLookUp(textView);
  CHECK(lookUps == 2 && NSEqualRanges(lookedUp, NSMakeRange(10, 0)));
}

static void Services()
{
  NSWindow *window = Window();
  NSTextView *textView = MultilineInput(window, @"make this upper");
  ChangeCounter *counter = [ChangeCounter new];
  textView.delegate = counter;
  // Requestor validation: a selection can be sent; returned text needs an editable view.
  textView.selectedRange = NSMakeRange(0, 0);
  CHECK([textView validRequestorForSendType:LegacyString returnType:nil] == nil);
  textView.selectedRange = NSMakeRange(5, 4);
  CHECK([textView.writablePasteboardTypes containsObject:LegacyString] && [textView.readablePasteboardTypes containsObject:LegacyString]);
  CHECK([textView validRequestorForSendType:LegacyString returnType:nil] == textView);
  CHECK([textView validRequestorForSendType:LegacyString returnType:LegacyString] == textView);
  // Round trip: the selection goes out, the service's text replaces it and the change reaches the delegate.
  NSPasteboard *pasteboard = [NSPasteboard pasteboardWithUniqueName];
  CHECK([textView writeSelectionToPasteboard:pasteboard types:@[LegacyString]]);
  CHECK([[pasteboard stringForType:NSPasteboardTypeString] isEqual:@"this"]);
  [pasteboard clearContents]; [pasteboard setString:@"THIS" forType:NSPasteboardTypeString];
  CHECK([textView readSelectionFromPasteboard:pasteboard]);
  CHECK([textView.string isEqual:@"make THIS upper"] && counter.count == 1);
  // Read-only text can still send its selection, but cannot take a result back.
  textView.editable = NO; textView.selectedRange = NSMakeRange(0, 4);
  CHECK([textView validRequestorForSendType:LegacyString returnType:nil] == textView);
  CHECK([textView validRequestorForSendType:LegacyString returnType:LegacyString] == nil);
  [pasteboard releaseGlobally];
}

static void SparkTextInputServices()
{
  NSWindow *window = Window();
  RNSparkTextInput *view = [RNSparkTextInput new];
  view.frame = NSMakeRect(0, 0, 240, 36);
  view->_eventEmitter = std::make_shared<SparkTextInputEventEmitter>();
  auto props = std::make_shared<SparkTextInputProps>(); props->defaultText = "hello world";
  [view updateProps:props oldProps:nullptr];
  [window.contentView addSubview:view];
  NSTextField *field = [view valueForKey:@"field"];
  CHECK([window makeFirstResponder:field]);
  NSTextView *editor = (NSTextView *)field.currentEditor;
  CHECK([editor isKindOfClass:NSTextView.class] && editor.isFieldEditor);
  // The editing field editor is never a text services target: it belongs to the field.
  CHECK(SparkTextServicesTextView(view) == nil);
  editor.selectedRange = NSMakeRange(6, 5);
  CHECK([editor validRequestorForSendType:LegacyString returnType:LegacyString] == editor);
  NSPasteboard *pasteboard = [NSPasteboard pasteboardWithUniqueName];
  CHECK([editor writeSelectionToPasteboard:pasteboard types:@[LegacyString]]);
  CHECK([[pasteboard stringForType:NSPasteboardTypeString] isEqual:@"world"]);
  [pasteboard clearContents]; [pasteboard setString:@"WORLD" forType:NSPasteboardTypeString];
  CHECK([editor readSelectionFromPasteboard:pasteboard]);
  // The returned text reaches JS through the component's change event.
  CHECK([field.stringValue isEqual:@"hello WORLD"]);
  CHECK(changes.size() == 1 && changes[0].text == "hello WORLD" && changes[0].eventCount == 1);
  [pasteboard releaseGlobally];
}

static void WritingTools()
{
  CHECK(RCTSparkIsWritingToolsBehavior("default") && RCTSparkIsWritingToolsBehavior("complete") && RCTSparkIsWritingToolsBehavior("limited") && RCTSparkIsWritingToolsBehavior("none"));
  CHECK(!RCTSparkIsWritingToolsBehavior("") && !RCTSparkIsWritingToolsBehavior("None"));
  if (@available(macOS 15.0, *)) {
    NSTextView *textView = MultilineInput(Window(), @"text");
    RCTSparkApplyWritingToolsBehavior(textView, "none");
    CHECK(textView.writingToolsBehavior == NSWritingToolsBehaviorNone);
    RCTSparkApplyWritingToolsBehavior(textView, "limited");
    CHECK(textView.writingToolsBehavior == NSWritingToolsBehaviorLimited);
    RCTSparkApplyWritingToolsBehavior(textView, "complete");
    CHECK(textView.writingToolsBehavior == NSWritingToolsBehaviorComplete);
    RCTSparkApplyWritingToolsBehavior(textView, "default");
    CHECK(textView.writingToolsBehavior == NSWritingToolsBehaviorDefault);
    // A single-line field applies to the window's shared field editor while it edits, and restores it afterwards.
    NSWindow *window = Window();
    NSTextField *field = [NSTextField textFieldWithString:@"single line"];
    NSTextField *other = [NSTextField textFieldWithString:@"other field"];
    [window.contentView addSubview:field]; [window.contentView addSubview:other];
    CHECK([window makeFirstResponder:other]);
    NSTextView *editor = (NSTextView *)other.currentEditor;
    const NSWritingToolsBehavior appKit = editor.writingToolsBehavior; // AppKit's field editor value (limited today).
    CHECK([window makeFirstResponder:nil]);
    RCTSparkApplyWritingToolsBehavior(field, "none"); // Not editing: the shared field editor is left alone.
    CHECK(editor.writingToolsBehavior == appKit);
    CHECK([window makeFirstResponder:field] && field.currentEditor == editor);
    RCTSparkApplyWritingToolsBehavior(field, "none");
    CHECK(editor.writingToolsBehavior == NSWritingToolsBehaviorNone);
    RCTSparkApplyWritingToolsBehavior(field, "complete");
    CHECK(editor.writingToolsBehavior == NSWritingToolsBehaviorComplete);
    CHECK([window makeFirstResponder:nil] && field.currentEditor == nil);
    RCTSparkResetFieldEditorWritingTools(field);
    CHECK(editor.writingToolsBehavior == appKit);
    // A field that took the editor keeps its behavior when the previous field resets.
    CHECK([window makeFirstResponder:field]);
    RCTSparkApplyWritingToolsBehavior(field, "none");
    CHECK([window makeFirstResponder:other] && other.currentEditor == editor);
    RCTSparkApplyWritingToolsBehavior(other, "limited");
    RCTSparkResetFieldEditorWritingTools(field);
    CHECK(editor.writingToolsBehavior == NSWritingToolsBehaviorLimited);
    CHECK([window makeFirstResponder:nil]);
    RCTSparkResetFieldEditorWritingTools(other);
    CHECK(editor.writingToolsBehavior == appKit);
  }
  // Availability is a plain capability query and never throws.
  BOOL available = SparkWritingToolsAvailable();
  if (@available(macOS 15.2, *)) CHECK(available == NSWritingToolsCoordinator.isWritingToolsAvailable);
  else CHECK(!available);
}

int main(int argc, const char *argv[]) { @autoreleasepool {
  [NSApplication sharedApplication];
  const char *scenario = argc > 1 ? argv[1] : "";
  if (!strcmp(scenario, "find")) Find();
  else if (!strcmp(scenario, "find-bar")) FindBar();
  else if (!strcmp(scenario, "look-up")) LookUp();
  else if (!strcmp(scenario, "services")) Services();
  else if (!strcmp(scenario, "spark-text-input-services")) SparkTextInputServices();
  else if (!strcmp(scenario, "writing-tools")) WritingTools();
  else { fprintf(stderr, "Unknown scenario %s\n", scenario); return 2; }
  if (failures) return 1;
  printf("PASS %s\n", scenario);
  return 0;
} }
