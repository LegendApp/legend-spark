// Drives the real RNSidebar/RNSidebarItem against a stand-in Fabric base class.
// React Native macOS mounts every inserted view with `updateProps:oldProps:nullptr`
// (RCTMountingManager Insert); the mount must configure rows, selection and heights.
// Compiled and run by tests/sidebar-updates-native.test.ts.
#import <AppKit/AppKit.h>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>
namespace facebook::react {
struct Props { using Shared = std::shared_ptr<Props const>; virtual ~Props() = default; };
// Codegen defaults: empty strings, zero numbers, false booleans.
struct SidebarProps : Props {
  std::string itemsJson, selectedId;
  int selectionRevision = 0;
  double contentInsetTop = 0, defaultRowHeight = 0;
};
struct SidebarItemProps : Props {
  std::string itemId;
  bool selectable = false, autoHeight = false;
  double rowHeight = 0;
};
struct EventEmitter { using Shared = std::shared_ptr<EventEmitter const>; virtual ~EventEmitter() = default; };
struct SidebarEventEmitter : EventEmitter {
  struct OnSidebarLayout { double height, width; };
  struct OnSidebarRowLayout { double width; };
  struct OnSidebarSelectionChange { std::string id; };
  mutable std::vector<double> rowWidths;
  void onSidebarLayout(OnSidebarLayout event) const {}
  void onSidebarRowLayout(OnSidebarRowLayout event) const { rowWidths.push_back(event.width); }
  void onSidebarSelectionChange(OnSidebarSelectionChange event) const {}
};
struct SidebarItemEventEmitter : EventEmitter {
  struct OnRightClick { bool altKey; double button; bool ctrlKey, metaKey; double pageX, pageY; bool shiftKey; double x, y; };
  void onRightClick(OnRightClick event) const {}
};
enum class LayoutDirection { Undefined, LeftToRight, RightToLeft };
struct LayoutMetrics { CGRect frame; LayoutDirection layoutDirection = LayoutDirection::LeftToRight; };
struct SidebarComponentDescriptor {};
struct SidebarItemComponentDescriptor {};
using ComponentDescriptorProvider = int;
template <class T> int concreteComponentDescriptorProvider() { return 0; }
}
using namespace facebook::react;
#define RCTUIView NSView
@protocol RCTComponentViewProtocol @end
@protocol RCTSidebarViewProtocol @end
@protocol RCTSidebarItemViewProtocol @end
// Mirrors RCTViewComponentView: it diffs against its own `_props`, never `oldProps`.
@interface RCTViewComponentView : NSView <RCTComponentViewProtocol> {
@public
  Props::Shared _props;
  EventEmitter::Shared _eventEmitter;
}
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps;
- (void)updateLayoutMetrics:(const LayoutMetrics &)metrics oldLayoutMetrics:(const LayoutMetrics &)old;
- (void)mountChildComponentView:(NSView<RCTComponentViewProtocol> *)child index:(NSInteger)index;
- (void)unmountChildComponentView:(NSView<RCTComponentViewProtocol> *)child index:(NSInteger)index;
- (void)layoutSubviews;
- (void)prepareForRecycle;
@end
@implementation RCTViewComponentView
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps { _props = props; }
- (void)updateLayoutMetrics:(const LayoutMetrics &)metrics oldLayoutMetrics:(const LayoutMetrics &)old { self.frame = metrics.frame; }
- (void)mountChildComponentView:(NSView<RCTComponentViewProtocol> *)child index:(NSInteger)index { [self addSubview:child]; }
- (void)unmountChildComponentView:(NSView<RCTComponentViewProtocol> *)child index:(NSInteger)index { [child removeFromSuperview]; }
- (void)layoutSubviews {}
- (void)prepareForRecycle {}
@end
@interface RNSidebar : RCTViewComponentView @end
@interface RNSidebarItem : RCTViewComponentView @end
// ACTUAL_IMPLEMENTATION
@interface RNSidebar (Testing)
- (NSArray *)itemsFromJson:(std::string const &)json;
- (void)reloadRows;
- (void)updateSelection;
@end
@interface CountingSidebar : RNSidebar
@property int parses, reloads, selections, layouts;
@end
@implementation CountingSidebar
- (NSArray *)itemsFromJson:(std::string const &)json { self.parses++; return [super itemsFromJson:json]; }
- (void)reloadRows { self.reloads++; [super reloadRows]; }
- (void)updateSelection { self.selections++; [super updateSelection]; }
- (void)setNeedsLayout:(BOOL)value { if (value) self.layouts++; [super setNeedsLayout:value]; }
@end

static int failures = 0;
#define CHECK(condition) do { if (!(condition)) { std::printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #condition); failures++; } } while (0)
static NSTableView *Table(RNSidebar *sidebar) { return [sidebar valueForKey:@"tableView"]; }
static CGFloat RowHeight(RNSidebar *sidebar, NSInteger row) { return [Table(sidebar) rectOfRow:row].size.height; }
static NSString *Title(RNSidebar *sidebar, NSInteger row) {
  NSTableCellView *cell = (NSTableCellView *)[sidebar tableView:Table(sidebar) viewForTableColumn:nil row:row];
  return cell.textField.stringValue;
}
static LayoutMetrics Height(CGFloat height) { return LayoutMetrics{CGRectMake(0, 0, 220, height)}; }
// A Sidebar laid out at 320x210 in a window that is never shown, as the Kitchen Sink screens size it.
static std::shared_ptr<SidebarEventEmitter> Lay(RNSidebar *sidebar, NSWindow *window, LayoutDirection direction) {
  auto emitter = std::make_shared<SidebarEventEmitter>();
  sidebar->_eventEmitter = emitter;
  [window.contentView addSubview:sidebar];
  [sidebar updateLayoutMetrics:LayoutMetrics{CGRectMake(0, 0, 320, 210), direction} oldLayoutMetrics:LayoutMetrics{}];
  [window layoutIfNeeded];
  return emitter;
}
// Every row, its cell and the cell's content lie inside the clip view's visible width.
static bool RowsFit(RNSidebar *sidebar) {
  NSTableView *table = Table(sidebar);
  CGFloat visible = NSWidth(table.enclosingScrollView.contentView.bounds);
  if (NSWidth(table.frame) > visible + 0.5) { std::printf("table %.1f wider than clip %.1f\n", NSWidth(table.frame), visible); return false; }
  for (NSInteger row = 0; row < table.numberOfRows; row++) {
    NSView *cell = [table viewAtColumn:0 row:row makeIfNecessary:YES];
    NSRect inTable = [cell convertRect:cell.bounds toView:table];
    if (NSMinX(inTable) < 0 || NSMaxX(inTable) > visible + 0.5) { std::printf("row %ld cell %s outside %.1f\n", (long)row, NSStringFromRect(inTable).UTF8String, visible); return false; }
    for (NSView *content in cell.subviews)
      if (NSMinX(content.frame) < 0 || NSMaxX(content.frame) > NSWidth(cell.bounds) + 0.5) { std::printf("row %ld content %s outside cell %s\n", (long)row, NSStringFromRect(content.frame).UTF8String, NSStringFromRect(cell.bounds).UTF8String); return false; }
  }
  return true;
}
static RNSidebarItem *Item(RNSidebar *sidebar, NSInteger index, const char *itemId, bool selectable, double rowHeight, bool autoHeight, CGFloat measured) {
  RNSidebarItem *item = [RNSidebarItem new];
  auto props = std::make_shared<SidebarItemProps>();
  props->itemId = itemId; props->selectable = selectable; props->rowHeight = rowHeight; props->autoHeight = autoHeight;
  // RCTMountingManager Insert order: props (null oldProps), layout metrics, then mount into the parent.
  [item updateProps:props oldProps:nullptr];
  [item updateLayoutMetrics:Height(measured) oldLayoutMetrics:LayoutMetrics{}];
  [sidebar mountChildComponentView:item index:index];
  return item;
}

int main() { @autoreleasepool {
  [NSApplication sharedApplication];

  // Data items: the first mount parses rows, selects, and applies row height and inset.
  RNSidebar *data = [RNSidebar new];
  auto items = std::make_shared<SidebarProps>();
  items->itemsJson = R"([{"id":"inbox","title":"Inbox"},{"id":"drafts","title":"Drafts","selectable":false},{"id":"sent","title":"Sent"}])";
  items->selectedId = "sent"; items->defaultRowHeight = 32; items->contentInsetTop = 12;
  [data updateProps:items oldProps:nullptr];
  CHECK(Table(data).numberOfRows == 3);
  CHECK([Title(data, 0) isEqual:@"Inbox"] && [Title(data, 2) isEqual:@"Sent"]);
  CHECK(Table(data).selectedRow == 2);
  CHECK(RowHeight(data, 0) == 32 && RowHeight(data, 2) == 32);
  CHECK(![data tableView:Table(data) shouldSelectRow:1] && [data tableView:Table(data) shouldSelectRow:0]);
  CHECK([[data valueForKey:@"scrollView"] contentInsets].top == 12);

  // A view moved in the tree is removed and re-inserted, again with null oldProps:
  // props that changed meanwhile must replace the old configuration, even back to defaults.
  [data updateProps:std::make_shared<SidebarProps>() oldProps:nullptr];
  CHECK(Table(data).numberOfRows == 0 && Table(data).selectedRow == -1);
  CHECK([[data valueForKey:@"scrollView"] contentInsets].top == 0);
  CHECK(Table(data).rowHeight == 28);

  // React rows: fixed, measured (autoHeight) and default heights; selection by item id.
  RNSidebar *rows = [RNSidebar new];
  auto rowsProps = std::make_shared<SidebarProps>(); rowsProps->selectedId = "measured";
  [rows updateProps:rowsProps oldProps:nullptr];
  Item(rows, 0, "fixed", true, 44, false, 44);
  Item(rows, 1, "measured", true, 0, true, 60);
  Item(rows, 2, "header", false, 0, false, 0);
  CHECK(Table(rows).numberOfRows == 3);
  CHECK(Table(rows).selectedRow == 1);
  CHECK(RowHeight(rows, 0) == 44 && RowHeight(rows, 1) == 60 && RowHeight(rows, 2) == 28);
  CHECK(![rows tableView:Table(rows) shouldSelectRow:2]);

  // Later updates stay selective: only what changed is re-parsed, reloaded or reselected.
  CountingSidebar *view = [CountingSidebar new];
  view.parses = view.reloads = view.selections = view.layouts = 0;
  auto first = std::make_shared<SidebarProps>(); first->itemsJson = R"([{"id":"one","title":"One"}])"; first->selectedId = "one";
  [view updateProps:first oldProps:nullptr];
  CHECK(view.parses == 1 && view.reloads == 1 && view.selections == 1 && Table(view).selectedRow == 0);
  auto selection = std::make_shared<SidebarProps>(*first); selection->selectedId = "";
  [view updateProps:selection oldProps:first];
  CHECK(view.parses == 1 && view.reloads == 1 && view.selections == 2 && Table(view).selectedRow == -1);
  auto acknowledgement = std::make_shared<SidebarProps>(*selection); acknowledgement->selectionRevision = 1;
  [view updateProps:acknowledgement oldProps:selection];
  CHECK(view.parses == 1 && view.reloads == 1 && view.selections == 3);
  int layouts = view.layouts;
  auto inset = std::make_shared<SidebarProps>(*acknowledgement); inset->contentInsetTop = 10;
  [view updateProps:inset oldProps:acknowledgement];
  CHECK(view.parses == 1 && view.reloads == 1 && view.selections == 3 && view.layouts == layouts + 1);
  auto height = std::make_shared<SidebarProps>(*inset); height->defaultRowHeight = 42;
  [view updateProps:height oldProps:inset];
  CHECK(view.parses == 1 && view.reloads == 2 && view.selections == 4 && RowHeight(view, 0) == 42);
  auto changedRows = std::make_shared<SidebarProps>(*height); changedRows->itemsJson = "[]";
  [view updateProps:changedRows oldProps:height];
  CHECK(view.parses == 2 && view.reloads == 3 && Table(view).numberOfRows == 0);

  // Row geometry: the source-list table adds row insets to its column, so the column must fit the clip
  // view rather than match the Sidebar's width, or rows run past the trailing edge.
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 400, 300) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  window.contentView.wantsLayer = YES;
  auto five = std::make_shared<SidebarProps>();
  five->itemsJson = R"([{"id":"library","title":"Library"},{"id":"playlists","title":"Playlists"},{"id":"artists","title":"Artists"},{"id":"downloads","title":"Downloads"},{"id":"disabled","title":"Disabled Row","selectable":false}])";
  five->selectedId = "library"; five->defaultRowHeight = 30;
  RNSidebar *ltr = [RNSidebar new];
  [ltr updateProps:five oldProps:nullptr];
  auto ltrEvents = Lay(ltr, window, LayoutDirection::LeftToRight);
  NSTableView *ltrTable = Table(ltr);
  CHECK(RowsFit(ltr));
  CHECK(NSWidth(ltrTable.frame) == 320 && NSWidth([ltrTable rectOfRow:0]) == 320);
  // The reported row width is the column (the cell), not the Sidebar: React rows are laid out at it.
  NSTableColumn *column = ltrTable.tableColumns.firstObject;
  CHECK(!ltrEvents->rowWidths.empty() && ltrEvents->rowWidths.back() == column.width && column.width < 320);
  NSTableCellView *ltrCell = [ltrTable viewAtColumn:0 row:0 makeIfNecessary:YES];
  CHECK(ltrTable.userInterfaceLayoutDirection == NSUserInterfaceLayoutDirectionLeftToRight && ltrCell.textField.alignment == NSTextAlignmentLeft);
  CHECK(fabs(NSMidY(ltrCell.textField.frame) - NSMidY(ltrCell.bounds)) <= 1);

  // Right to left (the React layout direction, independent of the application's): the table and data
  // titles mirror; rows still fit.
  RNSidebar *rtl = [RNSidebar new];
  [rtl updateProps:five oldProps:nullptr];
  Lay(rtl, window, LayoutDirection::RightToLeft);
  NSTableView *rtlTable = Table(rtl);
  CHECK(RowsFit(rtl));
  CHECK(rtlTable.userInterfaceLayoutDirection == NSUserInterfaceLayoutDirectionRightToLeft);
  NSTableCellView *rtlCell = [rtlTable viewAtColumn:0 row:0 makeIfNecessary:YES];
  CHECK(rtlCell.textField.alignment == NSTextAlignmentRight && [rtlCell.textField.stringValue isEqual:@"Library"]);
  CHECK(NSEqualRects(rtlCell.textField.frame, ltrCell.textField.frame));
  // Back to left to right: recycled cells realign.
  [rtl updateLayoutMetrics:LayoutMetrics{CGRectMake(0, 0, 320, 210), LayoutDirection::LeftToRight} oldLayoutMetrics:LayoutMetrics{}];
  CHECK([[rtlTable viewAtColumn:0 row:0 makeIfNecessary:YES] textField].alignment == NSTextAlignmentLeft);

  // A legacy (space-taking) scroller narrows the clip view: the column follows and the new width is reported.
  RNSidebar *scrolling = [RNSidebar new];
  auto many = std::make_shared<SidebarProps>(*five);
  std::string json = "[";
  for (int index = 0; index < 20; index++) json += (index ? "," : "") + std::string(R"({"id":"row)") + std::to_string(index) + R"(","title":"Row"})";
  many->itemsJson = json + "]"; many->selectedId = "row0";
  [scrolling updateProps:many oldProps:nullptr];
  NSScrollView *scrollView = [scrolling valueForKey:@"scrollView"];
  scrollView.scrollerStyle = NSScrollerStyleLegacy;
  auto scrollingEvents = Lay(scrolling, window, LayoutDirection::LeftToRight);
  [scrolling layoutSubviews];
  NSTableView *scrollingTable = Table(scrolling);
  CHECK(!scrollView.verticalScroller.isHidden && NSWidth(scrollView.contentView.bounds) < 320);
  CHECK(RowsFit(scrolling));
  CHECK(!scrollingEvents->rowWidths.empty() && scrollingEvents->rowWidths.back() == scrollingTable.tableColumns.firstObject.width &&
    scrollingEvents->rowWidths.back() < column.width);

  // React rows fill their cells: with the reported width applied by Yoga, content ends at the cell's edge.
  RNSidebar *react = [RNSidebar new];
  [react updateProps:std::make_shared<SidebarProps>() oldProps:nullptr];
  auto reactEvents = Lay(react, window, LayoutDirection::RightToLeft);
  RNSidebarItem *albums = Item(react, 0, "albums", true, 44, false, 44);
  [window layoutIfNeeded];
  NSView *firstCell = [Table(react) viewAtColumn:0 row:0 makeIfNecessary:YES];
  CHECK(albums.superview == firstCell && NSEqualRects(albums.frame, firstCell.bounds));
  CHECK(!reactEvents->rowWidths.empty() && NSWidth(firstCell.bounds) == reactEvents->rowWidths.back());
  CHECK(RowsFit(react));

  if (failures) return 1;
  std::puts("Sidebar mount, selective updates and row geometry passed");
} }
