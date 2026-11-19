#import <AppKit/AppKit.h>
#include <memory>
#include <string>
#include <vector>
#include <cassert>
#import <objc/runtime.h>
namespace facebook::react {
// Fabric transport types are stubbed; the table code below is the real AppKit implementation.
struct Props { using Shared = std::shared_ptr<const Props>; virtual ~Props() = default; };
struct SparkTableProps : Props {
  std::string columnsJson, rowsJson, selectedIdsJson, accessibilityLabel;
  int selectionRevision = 0; bool allowsMultipleSelection = false, headerVisible = true, alternatingRows = false, reportsColumnResize = false; double rowHeight = 0;
};
struct EventEmitter { using Shared = std::shared_ptr<const EventEmitter>; virtual ~EventEmitter() = default; };
static std::vector<std::pair<std::string, std::string>> selections;
static std::vector<std::string> doubleClicks;
static std::vector<std::pair<std::string, double>> columnResizes;
struct SparkTableEventEmitter : EventEmitter {
  struct OnTableSelectionChange { std::string id, idsJson; };
  struct OnTableColumnResize { std::string id; double width; };
  struct OnTableDoubleClick { std::string id; };
  void onTableSelectionChange(OnTableSelectionChange event) const { selections.push_back({ event.id, event.idsJson }); }
  void onTableColumnResize(OnTableColumnResize event) const { columnResizes.emplace_back(event.id, event.width); }
  void onTableDoubleClick(OnTableDoubleClick event) const { doubleClicks.push_back(event.id); }
};
enum class LayoutDirection { Undefined, LeftToRight, RightToLeft };
struct LayoutMetrics { LayoutDirection layoutDirection = LayoutDirection::Undefined; };
struct SparkTableComponentDescriptor {};
using ComponentDescriptorProvider = int;
template<class T> int concreteComponentDescriptorProvider() { return 0; }
}
using namespace facebook::react;
@interface RCTViewComponentView : NSView {
@public Props::Shared _props; EventEmitter::Shared _eventEmitter;
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
@interface RNSparkTable : RCTViewComponentView @end
// ACTUAL_IMPLEMENTATION
static void Next(RNSparkTable *view, void (^change)(SparkTableProps &)) {
  auto props = std::make_shared<SparkTableProps>(*std::static_pointer_cast<const SparkTableProps>(view->_props));
  change(*props); [view updateProps:props oldProps:view->_props];
}
static NSString *Cell(NSTableView *table, NSInteger row, NSInteger column) {
  return [(NSTableCellView *)[table viewAtColumn:column row:row makeIfNecessary:YES] textField].stringValue;
}
static std::string Rows(int count) {
  std::string json = "[";
  for (int index = 0; index < count; index++) json += (index ? "," : "") + std::string("{\"id\":\"c") + std::to_string(index) + "\",\"values\":{\"subject\":\"Commit " + std::to_string(index) + "\",\"date\":\"2026-11-" + std::to_string(index % 28 + 1) + "\"}}";
  return json + "]";
}
int main() { @autoreleasepool {
  [NSApplication sharedApplication]; [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(200, 300, 600, 400) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  RNSparkTable *view = [RNSparkTable new];
  view->_eventEmitter = std::make_shared<SparkTableEventEmitter>();
  view.frame = NSMakeRect(0, 0, 600, 400);
  [window.contentView addSubview:view];
  Next(view, ^(SparkTableProps &p) {
    p.columnsJson = R"([{"id":"subject","title":"Subject","minWidth":120},{"id":"author","title":"Author","width":120,"maxWidth":180,"secondary":true},{"id":"date","title":"Date","width":100,"alignment":"trailing","monospacedDigits":true}])";
    p.rowsJson = Rows(10000); p.selectedIdsJson = R"(["c2"])";
  });
  [view updateLayoutMetrics:LayoutMetrics{} oldLayoutMetrics:LayoutMetrics{}];
  [view layoutSubtreeIfNeeded];
  NSTableView *table = [view valueForKey:@"tableView"];
  // Columns and a header, with each column's options.
  assert(table.tableColumns.count == 3 && table.headerView != nil && table.enclosingScrollView.superview == view);
  assert([table.tableColumns[0].title isEqual:@"Subject"] && table.tableColumns[0].minWidth == 120 && table.tableColumns[1].width == 120);
  assert(table.tableColumns[2].headerCell.alignment == NSTextAlignmentRight);
  // Columns with a width keep it; the flexible Subject column takes the rest of the 600 pt table.
  [table sizeToFit];
  assert(table.tableColumns[1].width == 120 && table.tableColumns[2].width == 100 && table.tableColumns[0].width > 300);
  Next(view, ^(SparkTableProps &p) { p.reportsColumnResize = true; });
  static NSInteger resizedColumn = -1;
  class_replaceMethod(NSTableHeaderView.class, @selector(resizedColumn), imp_implementationWithBlock(^NSInteger(id) { return resizedColumn; }), "q@:");
  table.tableColumns[1].width = 140;
  assert(columnResizes.empty());
  resizedColumn = 1;
  table.tableColumns[1].width = 250;
  assert((columnResizes == std::vector<std::pair<std::string, double>>{{"author", 180}}));
  table.tableColumns[0].width = 300;
  assert(columnResizes.size() == 1);
  resizedColumn = -1;
  // 10,000 rows, but cells exist only for the visible ones.
  assert(table.numberOfRows == 10000 && [Cell(table, 0, 0) isEqual:@"Commit 0"] && [Cell(table, 0, 1) isEqual:@""]);
  NSTableCellView *date = [table viewAtColumn:2 row:3 makeIfNecessary:YES];
  assert(date.textField.alignment == NSTextAlignmentRight);
  assert([[table viewAtColumn:1 row:0 makeIfNecessary:YES] textField].textColor == NSColor.secondaryLabelColor);
  NSRange visible = [table rowsInRect:table.visibleRect];
  assert(visible.length > 0 && visible.length < 100);
  // The parent's selection shows without an event; a user selection reports the row and the IDs.
  assert(table.selectedRow == 2 && selections.empty() && !table.allowsMultipleSelection);
  [table selectRowIndexes:[NSIndexSet indexSetWithIndex:5] byExtendingSelection:NO];
  assert(selections.size() == 1 && selections.back().first == "c5" && selections.back().second == R"(["c5"])");
  // A parent that keeps its selection snaps the table back (new revision, same IDs), silently.
  Next(view, ^(SparkTableProps &p) { p.selectionRevision = 1; });
  assert(table.selectedRow == 2 && selections.size() == 1);
  // Multiple selection.
  Next(view, ^(SparkTableProps &p) { p.allowsMultipleSelection = true; p.selectedIdsJson = R"(["c1","c3"])"; });
  assert(table.allowsMultipleSelection && table.numberOfSelectedRows == 2 && selections.size() == 1);
  [table selectRowIndexes:[NSIndexSet indexSetWithIndex:4] byExtendingSelection:YES];
  assert(selections.back().second == R"(["c1","c3","c4"])");
  // New rows keep the selection by ID, even when it moves.
  Next(view, ^(SparkTableProps &p) { p.rowsJson = R"([{"id":"new","values":{"subject":"New"}},{"id":"c1","values":{"subject":"Commit 1"}},{"id":"c3","values":{"subject":"Commit 3"}}])"; });
  assert(table.numberOfRows == 3 && [Cell(table, 0, 0) isEqual:@"New"] && [table.selectedRowIndexes isEqualToIndexSet:[NSIndexSet indexSetWithIndexesInRange:NSMakeRange(1, 2)]]);
  // Double-click reports the clicked row.
  // Synthesized clicks need a real event loop, so the fixture fakes AppKit's clicked row and sends the double action.
  static NSInteger clickedRow = 1;
  class_replaceMethod(NSTableView.class, @selector(clickedRow), imp_implementationWithBlock(^NSInteger(id) { return clickedRow; }), "q@:");
  assert(table.target == view);
  [NSApp sendAction:table.doubleAction to:table.target from:table];
  assert(doubleClicks.size() == 1 && doubleClicks.back() == "c1");
  // Header, alternating rows and row height options.
  Next(view, ^(SparkTableProps &p) { p.headerVisible = false; p.alternatingRows = true; p.rowHeight = 30; });
  assert(table.headerView == nil && table.usesAlternatingRowBackgroundColors && table.rowHeight == 30);
  Next(view, ^(SparkTableProps &p) { p.headerVisible = true; p.rowHeight = 0; });
  assert(table.headerView != nil && table.rowSizeStyle == NSTableViewRowSizeStyleDefault);
  // Column changes rebuild the columns.
  Next(view, ^(SparkTableProps &p) { p.columnsJson = R"([{"id":"subject","title":"Message"}])"; });
  assert(table.tableColumns.count == 1 && [table.tableColumns[0].title isEqual:@"Message"] && [Cell(table, 2, 0) isEqual:@"Commit 3"]);
  puts("PASS table");
} }
