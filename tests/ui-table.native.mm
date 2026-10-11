// Drives the real RNSparkTable against stand-in Fabric types that match the RNSparkUISpec codegen
// output. React Native macOS mounts every inserted view with `updateProps:oldProps:nullptr`.
// Compiled and run by tests/ui-table-native.test.ts.
#import <AppKit/AppKit.h>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>
namespace facebook::react {
struct Props { using Shared = std::shared_ptr<Props const>; virtual ~Props() = default; };
// Codegen defaults: empty strings and vectors, zero numbers, false booleans.
struct SparkTableProps : Props {
  bool outline = false;
  std::string columnsJson;
  std::vector<std::string> rowChunks;
  std::string selectionMode;
  std::vector<std::string> selectedIds, expandedIds;
  std::string sortJson, columnLayoutJson;
  bool columnReordering = false;
  int eventCount = 0;
};
struct EventEmitter { using Shared = std::shared_ptr<EventEmitter const>; virtual ~EventEmitter() = default; };
struct Recorded { std::string kind; std::vector<std::string> ids; std::string json; int eventCount = 0; double x = 0, y = 0; };
static std::vector<Recorded> events;
struct SparkTableEventEmitter : EventEmitter {
  struct OnTableSelectionChange { std::vector<std::string> ids; int eventCount; };
  struct OnTableExpandedChange { std::vector<std::string> ids; int eventCount; };
  struct OnTableSortChange { std::string sortJson; int eventCount; };
  struct OnTableColumnLayoutChange { std::string layoutJson; int eventCount; };
  struct OnTableActivate { std::vector<std::string> ids; };
  struct OnTableContextMenu { std::vector<std::string> ids; std::string rowId; double x; double y; };
  struct OnTableError { std::string message; };
  void onTableSelectionChange(OnTableSelectionChange value) const { events.push_back({ "selection", value.ids, "", value.eventCount }); }
  void onTableExpandedChange(OnTableExpandedChange value) const { events.push_back({ "expanded", value.ids, "", value.eventCount }); }
  void onTableSortChange(OnTableSortChange value) const { events.push_back({ "sort", {}, value.sortJson, value.eventCount }); }
  void onTableColumnLayoutChange(OnTableColumnLayoutChange value) const { events.push_back({ "layout", {}, value.layoutJson, value.eventCount }); }
  void onTableActivate(OnTableActivate value) const { events.push_back({ "activate", value.ids }); }
  void onTableContextMenu(OnTableContextMenu value) const { events.push_back({ "context", value.ids, value.rowId, 0, value.x, value.y }); }
  void onTableError(OnTableError value) const { events.push_back({ "error", {}, value.message }); }
};
enum class LayoutDirection { Undefined, LeftToRight, RightToLeft };
struct LayoutMetrics { CGRect frame; LayoutDirection layoutDirection = LayoutDirection::LeftToRight; };
struct SparkTableComponentDescriptor {};
using ComponentDescriptorProvider = int;
template <class T> int concreteComponentDescriptorProvider() { return 0; }
}
using namespace facebook::react;
// Mirrors RCTViewComponentView: it keeps its own `_props` and never needs `oldProps`.
@interface RCTViewComponentView : NSView {
@public
  Props::Shared _props;
  EventEmitter::Shared _eventEmitter;
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
- (void)updateLayoutMetrics:(const LayoutMetrics &)metrics oldLayoutMetrics:(const LayoutMetrics &)old { self.frame = metrics.frame; }
- (void)layoutSubviews {}
- (void)prepareForRecycle {}
@end
@interface RNSparkTable : RCTViewComponentView <NSTableViewDataSource, NSTableViewDelegate, NSOutlineViewDataSource, NSOutlineViewDelegate> @end
// ACTUAL_IMPLEMENTATION
@interface RNSparkTable (Testing)
- (nullable NSArray *)parseChunk:(std::string const &)json;
@end
@interface CountingTable : RNSparkTable
@property int parses;
@end
@implementation CountingTable
- (NSArray *)parseChunk:(std::string const &)json { self.parses++; return [super parseChunk:json]; }
@end

static int failures = 0;
#define CHECK(condition) do { if (!(condition)) { std::printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #condition); failures++; } } while (0)
using Shared = std::shared_ptr<SparkTableProps>;
static NSTableView *Table(RNSparkTable *view) { return [view valueForKey:@"tableView"]; }
static NSOutlineView *Outline(RNSparkTable *view) { return (NSOutlineView *)Table(view); }
static NSString *Cell(RNSparkTable *view, NSInteger column, NSInteger row) {
  NSTableCellView *cell = [Table(view) viewAtColumn:column row:row makeIfNecessary:YES];
  return cell.textField.stringValue;
}
static NSTextAlignment CellAlignment(RNSparkTable *view, NSInteger column, NSInteger row) {
  return [(NSTableCellView *)[Table(view) viewAtColumn:column row:row makeIfNecessary:YES] textField].alignment;
}
static std::vector<std::string> Selected(RNSparkTable *view) {
  __block std::vector<std::string> ids;
  [Table(view).selectedRowIndexes enumerateIndexesUsingBlock:^(NSUInteger index, BOOL *stop) {
    id row = [view isKindOfClass:RNSparkTable.class] && [Table(view) isKindOfClass:NSOutlineView.class] ? [Outline(view) itemAtRow:index] : [view valueForKey:@"rows"][index];
    ids.push_back([[row valueForKey:@"rowId"] UTF8String]);
  }];
  return ids;
}
static Recorded Last() { return events.empty() ? Recorded{} : events.back(); }
// The JS encoder's format: chunks of `[depth, expandable, {"id", "cells"}]`.
static std::string Row(int depth, bool expandable, std::string const &id, std::string const &name) {
  return "[" + std::to_string(depth) + "," + (expandable ? "1" : "0") + ",{\"id\":\"" + id + "\",\"cells\":{\"name\":\"" + name + "\",\"size\":\"" + std::to_string(id.size()) + "\"}}]";
}
static std::vector<std::string> Chunks(int count, int size, std::string const &suffix = "") {
  std::vector<std::string> chunks; std::string chunk;
  for (int index = 0; index < count; index++) {
    chunk += (chunk.empty() ? "[" : ",") + Row(0, false, "r" + std::to_string(index), "Row " + std::to_string(index) + suffix);
    if ((index + 1) % size == 0 || index + 1 == count) { chunks.push_back(chunk + "]"); chunk.clear(); }
  }
  return chunks;
}
static const char *kColumns = R"([{"id":"name","title":"Name","width":180,"minWidth":60,"maxWidth":400,"resizable":true,"sortable":true,"alignment":"leading"},)"
  R"({"id":"kind","title":"Kind","width":90,"minWidth":40,"maxWidth":200,"resizable":false,"sortable":false,"alignment":"center"},)"
  R"({"id":"size","title":"Size","width":70,"minWidth":40,"maxWidth":120,"resizable":true,"sortable":true,"alignment":"trailing"}])";
static Shared TableProps() {
  auto props = std::make_shared<SparkTableProps>();
  props->columnsJson = kColumns; props->rowChunks = Chunks(1000, 256); props->selectionMode = "multiple";
  props->selectedIds = { "r2" }; props->sortJson = R"([{"columnId":"name","ascending":true}])"; props->columnReordering = true;
  return props;
}
static Shared Copy(Shared const &props) { return std::make_shared<SparkTableProps>(*props); }
static void Update(RNSparkTable *view, Shared const &props) { [view updateProps:props oldProps:view->_props]; }
static void Spin() { [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]]; }
static NSEvent *Key(NSString *characters, unsigned short code, NSEventModifierFlags flags) {
  return [NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint modifierFlags:flags timestamp:0 windowNumber:0 context:nil characters:characters charactersIgnoringModifiers:characters isARepeat:NO keyCode:code];
}
/** Records mouse-downs that reach it: what a view passes up its responder chain. */
@interface ResponderSpy : NSResponder
@property (nonatomic) int received;
@end
@implementation ResponderSpy
- (void)rightMouseDown:(NSEvent *)event { _received++; }
- (void)mouseDown:(NSEvent *)event { _received++; }
@end
static NSString *Arrow(unichar key) { return [NSString stringWithCharacters:&key length:1]; }

int main() { @autoreleasepool {
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 600, 400) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:YES];

  // Columns, rows, selection and sort all apply on a null-oldProps mount.
  RNSparkTable *view = [RNSparkTable new];
  view->_eventEmitter = std::make_shared<SparkTableEventEmitter>();
  auto props = TableProps();
  [view updateProps:props oldProps:nullptr];
  [view updateLayoutMetrics:LayoutMetrics{CGRectMake(0, 0, 600, 400)} oldLayoutMetrics:LayoutMetrics{}];
  window.contentView = view;
  NSTableView *table = Table(view);
  CHECK(![table isKindOfClass:NSOutlineView.class]);
  CHECK(table.numberOfColumns == 3 && table.numberOfRows == 1000);
  NSTableColumn *name = table.tableColumns[0], *kind = table.tableColumns[1], *size = table.tableColumns[2];
  CHECK([name.title isEqual:@"Name"] && name.width == 180 && name.minWidth == 60 && name.maxWidth == 400);
  CHECK(name.resizingMask == NSTableColumnUserResizingMask && kind.resizingMask == NSTableColumnNoResizing);
  CHECK([name.sortDescriptorPrototype.key isEqual:@"name"] && !kind.sortDescriptorPrototype && size.sortDescriptorPrototype);
  CHECK(table.allowsMultipleSelection && table.allowsColumnReordering);
  NSEvent *firstMouse = [NSEvent mouseEventWithType:NSEventTypeLeftMouseDown location:NSZeroPoint modifierFlags:0 timestamp:0 windowNumber:0 context:nil eventNumber:0 clickCount:1 pressure:1];
  CHECK(![table.headerView acceptsFirstMouse:firstMouse]);
  [table.headerView setValue:@YES forKey:@"acceptsFirstMouse"];
  CHECK([table.headerView acceptsFirstMouse:firstMouse]);
  [table.headerView setValue:@NO forKey:@"acceptsFirstMouse"];
  CHECK([Cell(view, 0, 999) isEqual:@"Row 999"] && [Cell(view, 1, 0) isEqual:@""]);
  CHECK(CellAlignment(view, 0, 0) == NSTextAlignmentLeft && CellAlignment(view, 1, 0) == NSTextAlignmentCenter && CellAlignment(view, 2, 0) == NSTextAlignmentRight);
  CHECK(Selected(view) == std::vector<std::string>{ "r2" });
  CHECK([table.sortDescriptors.firstObject.key isEqual:@"name"] && table.sortDescriptors.firstObject.ascending);
  CHECK([table indicatorImageInTableColumn:name] && ![table indicatorImageInTableColumn:size]);
  CHECK(events.empty());

  // Selection: a user change is reported with an event count; stale props keep it, an
  // acknowledgment that the parent did not accept restores the controlled selection.
  [table selectRowIndexes:[NSIndexSet indexSetWithIndex:5] byExtendingSelection:YES];
  CHECK(Last().kind == "selection" && Last().ids == (std::vector<std::string>{ "r2", "r5" }) && Last().eventCount == 1);
  auto stale = Copy(props); Update(view, stale);
  CHECK(Selected(view) == (std::vector<std::string>{ "r2", "r5" }));
  auto rejected = Copy(stale); rejected->eventCount = 1; Update(view, rejected);
  CHECK(Selected(view) == std::vector<std::string>{ "r2" });
  // Keyboard: Shift-Down extends the range, Command-A selects every row, Return activates.
  [window makeFirstResponder:table];
  [table keyDown:Key(Arrow(NSDownArrowFunctionKey), 125, NSEventModifierFlagShift | NSEventModifierFlagFunction)];
  CHECK(Selected(view) == (std::vector<std::string>{ "r2", "r3" }));
  CHECK(Last().kind == "selection" && Last().ids == (std::vector<std::string>{ "r2", "r3" }) && Last().eventCount == 2);
  auto accepted = Copy(rejected); accepted->selectedIds = { "r2", "r3" }; accepted->eventCount = 2; Update(view, accepted);
  CHECK(Selected(view) == (std::vector<std::string>{ "r2", "r3" }));
  CHECK([table performKeyEquivalent:Key(@"a", 0, NSEventModifierFlagCommand)]);
  CHECK(table.selectedRowIndexes.count == 1000 && Last().ids.size() == 1000 && Last().eventCount == 3);
  [table keyDown:Key(@"\r", 36, 0)];
  CHECK(Last().kind == "activate" && Last().ids.size() == 1000);
  auto all = Copy(accepted); all->eventCount = 3; all->selectedIds.clear(); Update(view, all);
  CHECK(table.selectedRowIndexes.count == 0);
  // Programmatic selection never reports back.
  size_t count = events.size();
  auto programmatic = Copy(all); programmatic->selectedIds = { "r7" }; Update(view, programmatic);
  CHECK(Selected(view) == std::vector<std::string>{ "r7" } && events.size() == count);
  // Selection modes: single disallows ranges, none rejects every proposal.
  auto single = Copy(programmatic); single->selectionMode = "single"; Update(view, single);
  CHECK(!table.allowsMultipleSelection);
  auto none = Copy(single); none->selectionMode = "none"; none->selectedIds.clear(); Update(view, none);
  CHECK([[view tableView:table selectionIndexesForProposedSelection:[NSIndexSet indexSetWithIndex:1]] count] == 0);
  Update(view, programmatic);

  // Sort: a header click (AppKit sets the descriptors) is reported and shown; stale props keep it.
  table.sortDescriptors = @[ [NSSortDescriptor sortDescriptorWithKey:@"size" ascending:YES], [NSSortDescriptor sortDescriptorWithKey:@"name" ascending:YES] ];
  CHECK(Last().kind == "sort" && Last().json == R"([{"columnId":"size","ascending":true},{"columnId":"name","ascending":true}])" && Last().eventCount == 4);
  CHECK([table indicatorImageInTableColumn:size] && ![table indicatorImageInTableColumn:name]);
  Update(view, programmatic);
  CHECK([table.sortDescriptors.firstObject.key isEqual:@"size"]);
  auto unsorted = Copy(programmatic); unsorted->eventCount = 4; Update(view, unsorted);
  CHECK([table.sortDescriptors.firstObject.key isEqual:@"name"] && [table indicatorImageInTableColumn:name]);
  auto descending = Copy(unsorted); descending->sortJson = R"([{"columnId":"size","ascending":false}])"; Update(view, descending);
  CHECK(table.sortDescriptors.count == 1 && !table.sortDescriptors.firstObject.ascending);

  // Native-owned column layout: a resize or move is reported and kept.
  size.width = 100;
  CHECK(Last().kind == "layout" && Last().json == R"([{"id":"name","width":180},{"id":"kind","width":90},{"id":"size","width":100}])" && Last().eventCount == 5);
  [table moveColumn:2 toColumn:0];
  CHECK(Last().kind == "layout" && Last().json == R"([{"id":"size","width":100},{"id":"name","width":180},{"id":"kind","width":90}])" && Last().eventCount == 6);
  auto owned = Copy(descending); owned->eventCount = 6; Update(view, owned);
  CHECK([table.tableColumns[0].identifier isEqual:@"size"] && size.width == 100);
  // A changed column width prop applies; unchanged definitions keep the user's width.
  auto widened = Copy(owned); std::string columns = kColumns; columns.replace(columns.find("\"width\":90"), 10, "\"width\":95"); widened->columnsJson = columns; Update(view, widened);
  CHECK(kind.width == 95 && size.width == 100 && name.width == 180);
  // Controlled layout: applied, a user change kept until acknowledged, then restored.
  auto controlled = Copy(widened); controlled->columnLayoutJson = R"([{"id":"name","width":200},{"id":"kind","width":95},{"id":"size","width":80}])"; Update(view, controlled);
  CHECK([table.tableColumns[0].identifier isEqual:@"name"] && [table.tableColumns[2].identifier isEqual:@"size"] && name.width == 200 && size.width == 80);
  name.width = 250;
  CHECK(Last().eventCount == 7);
  Update(view, controlled);
  CHECK(name.width == 250);
  auto restored = Copy(controlled); restored->eventCount = 7; Update(view, restored);
  CHECK(name.width == 200);

  // Rows: only chunks whose JSON changed are parsed; selection follows row IDs across a reorder.
  CountingTable *counting = [CountingTable new];
  counting->_eventEmitter = std::make_shared<SparkTableEventEmitter>();
  auto first = TableProps(); first->selectedIds = { "r300" };
  [counting updateProps:first oldProps:nullptr];
  CHECK(counting.parses == 4 && Table(counting).numberOfRows == 1000 && Selected(counting) == std::vector<std::string>{ "r300" });
  auto same = Copy(first); same->selectionMode = "single"; same->selectedIds = { "r300" }; Update(counting, same);
  CHECK(counting.parses == 4);
  auto edited = Copy(same); edited->rowChunks[2] = Chunks(1000, 256, " edited")[2]; Update(counting, edited);
  CHECK(counting.parses == 5 && [Cell(counting, 0, 600) isEqual:@"Row 600 edited"] && [Cell(counting, 0, 100) isEqual:@"Row 100"]);
  auto reversed = Copy(edited); std::string chunk = "[";
  for (int index = 999; index >= 0; index--) chunk += Row(0, false, "r" + std::to_string(index), "Row " + std::to_string(index)) + (index ? "," : "]");
  reversed->rowChunks = { chunk }; Update(counting, reversed);
  CHECK(counting.parses == 6 && [Cell(counting, 0, 0) isEqual:@"Row 999"] && Table(counting).selectedRow == 699);
  // Invalid row JSON is reported and the previous rows stay.
  auto broken = Copy(reversed); broken->rowChunks = { "[[0,0,{\"id\":\"x\"}]]" }; Update(counting, broken);
  CHECK(Last().kind == "error" && Table(counting).numberOfRows == 1000);

  // A view moved in the tree is re-inserted with null oldProps: changed props replace the old configuration.
  auto moved = TableProps(); moved->columnsJson = R"([{"id":"only","title":"Only","width":50,"minWidth":20,"maxWidth":90,"resizable":true,"sortable":false,"alignment":"leading"}])";
  moved->rowChunks = Chunks(3, 256); moved->selectedIds = {}; moved->sortJson = "[]"; moved->eventCount = 7;
  [view updateProps:moved oldProps:nullptr];
  CHECK(table.numberOfColumns == 1 && [table.tableColumns[0].title isEqual:@"Only"] && table.numberOfRows == 3 && table.selectedRowIndexes.count == 0 && table.sortDescriptors.count == 0);

  // Context menu: the selection when the clicked row is selected, else that row alone.
  Update(view, [&] { auto next = Copy(moved); next->selectedIds = { "r0", "r1" }; return next; }());
  [table tile];
  NSRect rowRect = [table rectOfRow:2];
  NSPoint inWindow = [table convertPoint:NSMakePoint(NSMidX(rowRect), NSMidY(rowRect)) toView:nil];
  NSEvent *click = [NSEvent mouseEventWithType:NSEventTypeRightMouseDown location:inWindow modifierFlags:0 timestamp:0 windowNumber:window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:1];
  CHECK([table menuForEvent:click] == nil);
  CHECK(Last().kind == "context" && Last().json == "r2" && Last().ids == std::vector<std::string>{ "r2" });
  rowRect = [table rectOfRow:0]; inWindow = [table convertPoint:NSMakePoint(NSMidX(rowRect), NSMidY(rowRect)) toView:nil];
  [table menuForEvent:[NSEvent mouseEventWithType:NSEventTypeRightMouseDown location:inWindow modifierFlags:0 timestamp:0 windowNumber:window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:1]];
  CHECK(Last().json == "r0" && Last().ids == (std::vector<std::string>{ "r0", "r1" }));
  CHECK(Last().y == NSHeight(window.contentView.bounds) - inWindow.y && Last().x == inWindow.x);
  // Right-clicks report once and go no further: ancestors could show menus of their own.
  ResponderSpy *spy = [ResponderSpy new];
  NSResponder *parent = view.nextResponder;
  view.nextResponder = spy;
  rowRect = [table rectOfRow:2]; inWindow = [table convertPoint:NSMakePoint(NSMidX(rowRect), NSMidY(rowRect)) toView:nil];
  size_t reported = events.size();
  [table rightMouseDown:[NSEvent mouseEventWithType:NSEventTypeRightMouseDown location:inWindow modifierFlags:0 timestamp:0 windowNumber:window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:1]];
  CHECK(events.size() == reported + 1 && Last().kind == "context" && Last().json == "r2" && spy.received == 0);
  view.nextResponder = parent;
  // A Control-click (the current event while AppKit proposes a selection) leaves the selection alone, like a right-click.
  [NSApp postEvent:[NSEvent mouseEventWithType:NSEventTypeLeftMouseDown location:inWindow modifierFlags:NSEventModifierFlagControl timestamp:0 windowNumber:window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:1] atStart:YES];
  CHECK([NSApp nextEventMatchingMask:NSEventMaskLeftMouseDown untilDate:NSDate.distantPast inMode:NSDefaultRunLoopMode dequeue:YES].modifierFlags & NSEventModifierFlagControl);
  CHECK([[view tableView:table selectionIndexesForProposedSelection:[NSIndexSet indexSetWithIndex:2]] isEqual:table.selectedRowIndexes] && table.selectedRowIndexes.count == 2);
  [NSApp postEvent:[NSEvent mouseEventWithType:NSEventTypeLeftMouseDown location:inWindow modifierFlags:0 timestamp:0 windowNumber:window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:1] atStart:YES];
  [NSApp nextEventMatchingMask:NSEventMaskLeftMouseDown untilDate:NSDate.distantPast inMode:NSDefaultRunLoopMode dequeue:YES];
  CHECK([[view tableView:table selectionIndexesForProposedSelection:[NSIndexSet indexSetWithIndex:2]] isEqual:[NSIndexSet indexSetWithIndex:2]]);

  // Right to left: columns lay out from the right edge; leading and trailing text mirror.
  RNSparkTable *rtl = [RNSparkTable new];
  rtl->_eventEmitter = std::make_shared<SparkTableEventEmitter>();
  [rtl updateProps:TableProps() oldProps:nullptr];
  [rtl updateLayoutMetrics:LayoutMetrics{CGRectMake(0, 0, 600, 400), LayoutDirection::RightToLeft} oldLayoutMetrics:LayoutMetrics{}];
  NSTableView *mirrored = Table(rtl);
  CHECK(mirrored.userInterfaceLayoutDirection == NSUserInterfaceLayoutDirectionRightToLeft);
  CHECK(NSMinX([mirrored rectOfColumn:0]) > NSMinX([mirrored rectOfColumn:1]) && NSMinX([mirrored rectOfColumn:1]) > NSMinX([mirrored rectOfColumn:2]));
  CHECK(CellAlignment(rtl, 0, 0) == NSTextAlignmentRight && CellAlignment(rtl, 2, 0) == NSTextAlignmentLeft);
  CHECK(mirrored.tableColumns[0].headerCell.alignment == NSTextAlignmentRight);
  CHECK(Selected(rtl) == std::vector<std::string>{ "r2" });
  // A recycled view reused at the same frame (Table screen to Outline screen) still mirrors its columns.
  [rtl prepareForRecycle];
  auto reused = TableProps(); reused->outline = true; reused->sortJson = "[]";
  [rtl updateProps:reused oldProps:nullptr];
  [rtl updateLayoutMetrics:LayoutMetrics{CGRectMake(0, 0, 600, 400), LayoutDirection::RightToLeft} oldLayoutMetrics:LayoutMetrics{}];
  mirrored = Table(rtl);
  CHECK([mirrored isKindOfClass:NSOutlineView.class] && mirrored.userInterfaceLayoutDirection == NSUserInterfaceLayoutDirectionRightToLeft);
  CHECK(NSMinX([mirrored rectOfColumn:0]) > NSMinX([mirrored rectOfColumn:1]) && NSMinX([mirrored.headerView headerRectOfColumn:0]) > NSMinX([mirrored.headerView headerRectOfColumn:1]));

  // Outline: controlled expansion, user expansion reported once per burst, remembered descendants.
  events.clear();
  RNSparkTable *tree = [RNSparkTable new];
  tree->_eventEmitter = std::make_shared<SparkTableEventEmitter>();
  auto outline = std::make_shared<SparkTableProps>();
  outline->outline = true; outline->columnsJson = kColumns; outline->selectionMode = "multiple"; outline->sortJson = "[]";
  outline->rowChunks = { "[" + Row(0, true, "a", "A") + "," + Row(1, true, "a1", "A1") + "," + Row(2, false, "a1x", "A1x") + "," + Row(1, false, "a2", "A2") + "," +
    Row(0, true, "b", "B") + "," + Row(1, false, "b1", "B1") + "," + Row(0, true, "empty", "Empty") + "]" };
  outline->expandedIds = { "a" };
  [tree updateProps:outline oldProps:nullptr];
  NSOutlineView *outlineView = Outline(tree);
  CHECK([outlineView isKindOfClass:NSOutlineView.class] && [outlineView.outlineTableColumn.identifier isEqual:@"name"]);
  CHECK(outlineView.numberOfRows == 5); // a, a1, a2, b, empty
  CHECK([[[outlineView itemAtRow:1] valueForKey:@"rowId"] isEqual:@"a1"] && [outlineView isExpandable:[outlineView itemAtRow:4]]);
  CHECK(events.empty());
  id b = [outlineView itemAtRow:3];
  [outlineView expandItem:b];
  // Not reported yet, and props that arrive before the report cannot collapse it.
  CHECK(events.empty());
  Update(tree, Copy(outline));
  CHECK([outlineView isItemExpanded:b]);
  Spin();
  CHECK(Last().kind == "expanded" && Last().ids == (std::vector<std::string>{ "a", "b" }) && Last().eventCount == 1);
  auto expandRejected = Copy(outline); expandRejected->eventCount = 1; Update(tree, expandRejected);
  CHECK(![outlineView isItemExpanded:b] && outlineView.numberOfRows == 5);
  // Option-click expands a subtree: one report for the burst.
  id a = [outlineView itemAtRow:0];
  [outlineView collapseItem:a];
  Spin();
  CHECK(Last().ids.empty() && Last().eventCount == 2);
  size_t before = events.size();
  [outlineView expandItem:a expandChildren:YES];
  Spin();
  CHECK(events.size() == before + 1 && Last().ids == (std::vector<std::string>{ "a", "a1" }) && Last().eventCount == 3);
  auto deep = Copy(expandRejected); deep->expandedIds = { "a", "a1" }; deep->eventCount = 3; Update(tree, deep);
  CHECK(outlineView.numberOfRows == 6);
  // Collapsing a parent remembers its expanded child, which reopens with the parent.
  auto closed = Copy(deep); closed->expandedIds = { "a1" }; Update(tree, closed);
  CHECK(outlineView.numberOfRows == 3);
  Update(tree, deep);
  CHECK(outlineView.numberOfRows == 6 && [outlineView isItemExpanded:[outlineView itemAtRow:1]]);
  // A user collapsing the parent keeps the child expanded: one report, without the parent.
  [outlineView collapseItem:a];
  Spin();
  CHECK(Last().kind == "expanded" && Last().ids == std::vector<std::string>{ "a1" } && Last().eventCount == 4 && outlineView.numberOfRows == 3);
  [outlineView expandItem:a];
  Spin();
  CHECK(Last().ids == (std::vector<std::string>{ "a", "a1" }) && Last().eventCount == 5 && outlineView.numberOfRows == 6);
  // Option-collapse closes the whole branch.
  [outlineView collapseItem:a collapseChildren:YES];
  Spin();
  CHECK(Last().ids.empty() && Last().eventCount == 6);
  auto acknowledged = Copy(deep); acknowledged->eventCount = 6; Update(tree, acknowledged);
  CHECK(outlineView.numberOfRows == 6 && [outlineView isItemExpanded:[outlineView itemAtRow:1]]);
  // Selection maps through visible rows; a reorder keeps selection and expansion by ID.
  auto picked = Copy(acknowledged); picked->selectedIds = { "a1x", "b" }; Update(tree, picked);
  CHECK(Selected(tree) == (std::vector<std::string>{ "a1x", "b" }));
  auto resorted = Copy(picked);
  resorted->rowChunks = { "[" + Row(0, true, "empty", "Empty") + "," + Row(0, true, "b", "B") + "," + Row(1, false, "b1", "B1") + "," +
    Row(0, true, "a", "A") + "," + Row(1, false, "a2", "A2") + "," + Row(1, true, "a1", "A1") + "," + Row(2, false, "a1x", "A1x") + "]" };
  Update(tree, resorted);
  CHECK(outlineView.numberOfRows == 6 && [[[outlineView itemAtRow:5] valueForKey:@"rowId"] isEqual:@"a1x"]);
  CHECK(Selected(tree) == (std::vector<std::string>{ "b", "a1x" }));
  [outlineView selectRowIndexes:[NSIndexSet indexSetWithIndex:0] byExtendingSelection:NO];
  CHECK(Last().kind == "selection" && Last().ids == std::vector<std::string>{ "empty" });

  // Recycling resets everything; the next mount is fresh.
  [tree prepareForRecycle];
  auto fresh = TableProps(); fresh->rowChunks = Chunks(2, 256); fresh->selectedIds = {};
  [tree updateProps:fresh oldProps:nullptr];
  CHECK(![Table(tree) isKindOfClass:NSOutlineView.class] && Table(tree).numberOfRows == 2 && Table(tree).selectedRowIndexes.count == 0);
  [Table(tree) selectRowIndexes:[NSIndexSet indexSetWithIndex:1] byExtendingSelection:NO];
  CHECK(Last().eventCount == 1);

  if (failures) return 1;
  std::puts("Native table tests passed");
} }
