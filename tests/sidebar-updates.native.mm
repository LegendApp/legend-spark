// Drives the real RNSidebar/RNSidebarItem against a stand-in Fabric base class.
// React Native macOS mounts every inserted view with `updateProps:oldProps:nullptr`
// (RCTMountingManager Insert); the mount must configure rows, selection and heights.
// Compiled and run by tests/sidebar-updates-native.test.ts.
#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>
namespace facebook::react {
struct Props { using Shared = std::shared_ptr<Props const>; virtual ~Props() = default; };
// Codegen defaults: empty strings, zero numbers, false booleans.
enum class SidebarListStyle { Sidebar, Plain };
struct SidebarProps : Props {
  SidebarListStyle listStyle = SidebarListStyle::Sidebar;
  std::string itemsJson, selectedIdsJson, collapsedIdsJson;
  bool allowsMultipleSelection = false;
  int selectionRevision = 0;
  double contentInsetTop = 0, defaultRowHeight = 0;
};
struct SidebarItemProps : Props {
  std::string itemId, parentId;
  bool selectable = false, autoHeight = false, group = false;
  int count = -1;
  double rowHeight = 0;
};
struct EventEmitter { using Shared = std::shared_ptr<EventEmitter const>; virtual ~EventEmitter() = default; };
struct SidebarEventEmitter : EventEmitter {
  struct OnSidebarLayout { double height, width; };
  struct OnSidebarRowLayout { double width; };
  struct OnSidebarSelectionChange { std::string id, idsJson; };
  struct OnSidebarExpandedChange { bool expanded; std::string id; };
  struct OnSidebarDoubleClick { std::string id; };
  mutable std::vector<double> rowWidths;
  mutable std::vector<std::string> selections, expansions, doubleClicks;
  void onSidebarLayout(OnSidebarLayout event) const {}
  void onSidebarRowLayout(OnSidebarRowLayout event) const { rowWidths.push_back(event.width); }
  void onSidebarSelectionChange(OnSidebarSelectionChange event) const { selections.push_back(event.id + " " + event.idsJson); }
  void onSidebarExpandedChange(OnSidebarExpandedChange event) const { expansions.push_back((event.expanded ? "+" : "-") + event.id); }
  void onSidebarDoubleClick(OnSidebarDoubleClick event) const { doubleClicks.push_back(event.id); }
};
struct SidebarItemEventEmitter : EventEmitter {
  struct OnRightClick { bool altKey; double button; bool ctrlKey, metaKey; double pageX, pageY; bool shiftKey; double x, y; };
  struct OnSidebarItemLayout { double width; };
  mutable std::vector<double> widths;
  void onRightClick(OnRightClick event) const {}
  void onSidebarItemLayout(OnSidebarItemLayout event) const { widths.push_back(event.width); }
};
enum class LayoutDirection { Undefined, LeftToRight, RightToLeft };
struct LayoutMetrics { CGRect frame; LayoutDirection layoutDirection = LayoutDirection::Undefined; };
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
- (NSString *)itemIdAtRow:(NSInteger)row;
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

@interface SidebarKeyWindow : NSWindow
@property BOOL testKey;
@end
@implementation SidebarKeyWindow
- (BOOL)isKeyWindow { return self.testKey; }
@end

static int failures = 0;
#define CHECK(condition) do { if (!(condition)) { std::printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #condition); failures++; } } while (0)
static NSOutlineView *Table(RNSidebar *sidebar) { return [sidebar valueForKey:@"tableView"]; }
static bool Selectable(RNSidebar *sidebar, NSInteger row) { return [sidebar outlineView:Table(sidebar) shouldSelectItem:[Table(sidebar) itemAtRow:row]]; }
static CGFloat RowHeight(RNSidebar *sidebar, NSInteger row) { return [Table(sidebar) rectOfRow:row].size.height; }
static NSString *Title(RNSidebar *sidebar, NSInteger row) {
  NSTableCellView *cell = (NSTableCellView *)[sidebar outlineView:Table(sidebar) viewForTableColumn:nil item:[Table(sidebar) itemAtRow:row]];
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
static RNSidebarItem *Item(RNSidebar *sidebar, NSInteger index, const char *itemId, bool selectable, double rowHeight, bool autoHeight, CGFloat measured, const char *parentId = "", bool group = false, int count = -1) {
  RNSidebarItem *item = [RNSidebarItem new];
  auto props = std::make_shared<SidebarItemProps>();
  props->itemId = itemId; props->parentId = parentId; props->group = group; props->count = count; props->selectable = selectable; props->rowHeight = rowHeight; props->autoHeight = autoHeight;
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
  items->selectedIdsJson = R"(["sent"])"; items->defaultRowHeight = 32; items->contentInsetTop = 12;
  [data updateProps:items oldProps:nullptr];
  CHECK(Table(data).numberOfRows == 3);
  CHECK([Title(data, 0) isEqual:@"Inbox"] && [Title(data, 2) isEqual:@"Sent"]);
  CHECK(Table(data).selectedRow == 2);
  CHECK(RowHeight(data, 0) == 32 && RowHeight(data, 2) == 32);
  CHECK(!Selectable(data, 1) && Selectable(data, 0));
  CHECK([[data valueForKey:@"scrollView"] contentInsets].top == 12);

  // A view moved in the tree is removed and re-inserted, again with null oldProps:
  // props that changed meanwhile must replace the old configuration, even back to defaults.
  [data updateProps:std::make_shared<SidebarProps>() oldProps:nullptr];
  CHECK(Table(data).numberOfRows == 0 && Table(data).selectedRow == -1);
  CHECK([[data valueForKey:@"scrollView"] contentInsets].top == 0);
  CHECK(Table(data).rowHeight == 28);

  // List style: the source list is the default; plain drops the sidebar material and insets for lists inside content.
  CHECK(Table(data).style == NSTableViewStyleSourceList);
  auto plain = std::make_shared<SidebarProps>(*items); plain->listStyle = SidebarListStyle::Plain;
  [data updateProps:plain oldProps:nullptr];
  CHECK(Table(data).style == NSTableViewStylePlain && Table(data).selectionHighlightStyle == NSTableViewSelectionHighlightStyleRegular);
  CHECK(Table(data).selectedRow == 2);
  [data updateProps:items oldProps:plain];
  CHECK(Table(data).style == NSTableViewStyleSourceList);

  // React rows: fixed, measured (autoHeight) and default heights; selection by item id.
  RNSidebar *rows = [RNSidebar new];
  auto rowsProps = std::make_shared<SidebarProps>(); rowsProps->selectedIdsJson = R"(["measured"])";
  [rows updateProps:rowsProps oldProps:nullptr];
  Item(rows, 0, "fixed", true, 44, false, 44);
  Item(rows, 1, "measured", true, 0, true, 60);
  Item(rows, 2, "header", false, 0, false, 0);
  CHECK(Table(rows).numberOfRows == 3);
  CHECK(Table(rows).selectedRow == 1);
  CHECK(RowHeight(rows, 0) == 44 && RowHeight(rows, 1) == 60 && RowHeight(rows, 2) == 28);
  CHECK(!Selectable(rows, 2));

  // Later updates stay selective: only what changed is re-parsed, reloaded or reselected.
  CountingSidebar *view = [CountingSidebar new];
  view.parses = view.reloads = view.selections = view.layouts = 0;
  auto first = std::make_shared<SidebarProps>(); first->itemsJson = R"([{"id":"one","title":"One"}])"; first->selectedIdsJson = R"(["one"])";
  [view updateProps:first oldProps:nullptr];
  CHECK(view.parses == 1 && view.reloads == 1 && view.selections == 1 && Table(view).selectedRow == 0);
  auto selection = std::make_shared<SidebarProps>(*first); selection->selectedIdsJson = "[]";
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
  SidebarKeyWindow *window = [[SidebarKeyWindow alloc] initWithContentRect:NSMakeRect(0, 0, 400, 300) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  window.contentView.wantsLayer = YES;
  auto five = std::make_shared<SidebarProps>();
  five->itemsJson = R"([{"id":"library","title":"Library"},{"id":"playlists","title":"Playlists"},{"id":"artists","title":"Artists"},{"id":"downloads","title":"Downloads"},{"id":"disabled","title":"Disabled Row","selectable":false}])";
  five->selectedIdsJson = R"(["library"])"; five->defaultRowHeight = 30;
  RNSidebar *ltr = [RNSidebar new];
  [ltr updateProps:five oldProps:nullptr];
  auto ltrEvents = Lay(ltr, window, LayoutDirection::LeftToRight);
  NSTableView *ltrTable = Table(ltr);
  NSTableRowView *selectedRow = [ltrTable rowViewAtRow:0 makeIfNecessary:YES];
  window.testKey = YES;
  selectedRow.emphasized = NO;
  CHECK(selectedRow.isEmphasized);
  window.testKey = NO;
  selectedRow.emphasized = YES;
  CHECK(!selectedRow.isEmphasized);
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
  many->itemsJson = json + "]"; many->selectedIdsJson = R"(["row0"])";
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
  albums.accessibilityLabel = @"Albums";
  NSOutlineView *reactTable = Table(react);
  CHECK([[react outlineView:reactTable typeSelectStringForTableColumn:nil item:[reactTable itemAtRow:0]] isEqual:@"Albums"]);
  [window layoutIfNeeded];
  NSView *firstCell = [Table(react) viewAtColumn:0 row:0 makeIfNecessary:YES];
  CHECK(albums.superview == firstCell && NSEqualRects(albums.frame, firstCell.bounds));
  CHECK(!reactEvents->rowWidths.empty() && NSWidth(firstCell.bounds) == reactEvents->rowWidths.back());
  CHECK(RowsFit(react));

  // Fabric's resolved direction reaches the list, and follows later updates.
  NSScrollView *scroll = [view valueForKey:@"scrollView"];
  for (auto direction : {LayoutDirection::LeftToRight, LayoutDirection::RightToLeft, LayoutDirection::LeftToRight}) {
    [view updateLayoutMetrics:LayoutMetrics{CGRectMake(0, 0, 220, 300), direction} oldLayoutMetrics:LayoutMetrics{}];
    auto expected = direction == LayoutDirection::RightToLeft ? NSUserInterfaceLayoutDirectionRightToLeft : NSUserInterfaceLayoutDirectionLeftToRight;
    CHECK(scroll.userInterfaceLayoutDirection == expected && Table(view).userInterfaceLayoutDirection == expected);
  }

  // Group rows (A2) and collapsible sections (A3): data children nest under their parent; group rows take the
  // source list's header style and are never selectable.
  RNSidebar *tree = [RNSidebar new];
  auto treeProps = std::make_shared<SidebarProps>();
  treeProps->itemsJson = R"([{"id":"repo","title":"Repo","group":true},{"id":"changes","title":"Changes","count":5,"parentId":"repo"},{"id":"history","title":"History","parentId":"repo"},)"
    R"({"id":"remotes","title":"Remotes","group":true},{"id":"origin","title":"origin","parentId":"remotes"},{"id":"origin/main","title":"main","parentId":"origin"},)"
    R"({"id":"tags","title":"Tags","group":true},{"id":"v1","title":"v1","parentId":"tags"}])";
  treeProps->collapsedIdsJson = R"(["tags"])"; treeProps->selectedIdsJson = R"(["history"])";
  [tree updateProps:treeProps oldProps:nullptr];
  auto treeEvents = Lay(tree, window, LayoutDirection::LeftToRight);
  NSOutlineView *outline = Table(tree);
  CHECK(outline.numberOfRows == 7);
  CHECK([[tree itemIdAtRow:5] isEqual:@"origin/main"] && [[tree itemIdAtRow:6] isEqual:@"tags"]);
  CHECK([tree outlineView:outline isGroupItem:[outline itemAtRow:0]] && ![tree outlineView:outline isGroupItem:[outline itemAtRow:1]]);
  CHECK(!Selectable(tree, 0) && Selectable(tree, 1) && outline.selectedRow == 2);
  CHECK([outline levelForRow:5] == 2 && ![outline isItemExpanded:[outline itemAtRow:6]] && [outline isItemExpanded:[outline itemAtRow:4]]);
  NSTableCellView *header = (NSTableCellView *)[tree outlineView:outline viewForTableColumn:nil item:[outline itemAtRow:0]];
  CHECK(header.textField.font.pointSize == 11 && [header.textField.textColor isEqual:NSColor.secondaryLabelColor]);
  // Trailing counts (A4) on data rows: secondary digits at the trailing edge, the title stopping before them.
  [outline layoutSubtreeIfNeeded];
  NSTableCellView *changes = [outline viewAtColumn:0 row:1 makeIfNecessary:YES];
  NSTextField *countField = [changes valueForKey:@"countField"];
  CHECK(!countField.hidden && [countField.stringValue isEqual:@"5"] && [countField.textColor isEqual:NSColor.secondaryLabelColor]);
  CHECK(NSMaxX(countField.frame) <= NSWidth(changes.bounds) - 11 && NSMaxX(changes.textField.frame) <= NSMinX(countField.frame));
  NSTableCellView *history = [outline viewAtColumn:0 row:2 makeIfNecessary:YES];
  CHECK([[history valueForKey:@"countField"] isHidden]);
  // The user's toggles report and persist across reloads; the prop applies only when its value changes.
  [outline collapseItem:[outline itemAtRow:4]];
  CHECK(treeEvents->expansions == std::vector<std::string>{"-origin"} && outline.numberOfRows == 6);
  auto reselect = std::make_shared<SidebarProps>(*treeProps); reselect->selectedIdsJson = R"(["changes"])"; reselect->defaultRowHeight = 30;
  [tree updateProps:reselect oldProps:treeProps];
  CHECK(outline.numberOfRows == 6 && outline.selectedRow == 1);
  auto expandAll = std::make_shared<SidebarProps>(*reselect); expandAll->collapsedIdsJson = "[]";
  [tree updateProps:expandAll oldProps:reselect];
  CHECK(outline.numberOfRows == 8 && treeEvents->expansions.size() == 1);
  [outline collapseItem:[outline itemAtRow:3]];
  CHECK(treeEvents->expansions.back() == "-remotes" && outline.numberOfRows == 6);
  [outline expandItem:[outline itemAtRow:3]];
  CHECK(treeEvents->expansions == (std::vector<std::string>{"-origin", "-remotes", "+remotes"}) && outline.numberOfRows == 8);

  // Multiple selection (A5): selectedIds select every listed row; user changes report the primary row and all IDs.
  auto multiple = std::make_shared<SidebarProps>(*expandAll); multiple->allowsMultipleSelection = true; multiple->selectedIdsJson = R"(["changes","history"])";
  [tree updateProps:multiple oldProps:expandAll];
  CHECK(outline.allowsMultipleSelection && outline.selectedRowIndexes.count == 2);
  [outline selectRowIndexes:[NSIndexSet indexSetWithIndex:4] byExtendingSelection:YES];
  CHECK(!treeEvents->selections.empty() && treeEvents->selections.back() == R"(origin ["changes","history","origin"])");
  auto single = std::make_shared<SidebarProps>(*multiple); single->allowsMultipleSelection = false;
  [tree updateProps:single oldProps:multiple];
  CHECK(!outline.allowsMultipleSelection && outline.selectedRowIndexes.count == 1 && outline.selectedRow == 1);

  // Double-click (A5) reports the clicked row. Synthetic clicks do not reach a window that is never shown,
  // so the table's clicked row is stubbed; the Kitchen Sink run covers real clicks.
  class_replaceMethod(outline.class, @selector(clickedRow), imp_implementationWithBlock(^NSInteger(id) { return 2; }), "q@:");
  [outline sendAction:outline.doubleAction to:outline.target];
  CHECK(treeEvents->doubleClicks == std::vector<std::string>{"history"});

  // React rows (A2-A4): parentId nests, group rows refuse selection, and a counted row's content narrows to
  // leave the count room; the narrower width is reported to the row.
  RNSidebar *reactTree = [RNSidebar new];
  [reactTree updateProps:std::make_shared<SidebarProps>() oldProps:nullptr];
  Lay(reactTree, window, LayoutDirection::LeftToRight);
  Item(reactTree, 0, "section", false, 0, false, 28, "", true);
  RNSidebarItem *counted = Item(reactTree, 1, "stashes", true, 0, false, 28, "section", false, 12);
  auto countedEvents = std::make_shared<SidebarItemEventEmitter>(); counted->_eventEmitter = countedEvents;
  RNSidebarItem *plainRow = Item(reactTree, 2, "worktrees", true, 0, false, 28, "section");
  [window layoutIfNeeded];
  NSOutlineView *reactOutline = Table(reactTree);
  CHECK(reactOutline.numberOfRows == 3 && [reactOutline levelForRow:1] == 1 && !Selectable(reactTree, 0) && Selectable(reactTree, 1));
  NSTableCellView *countedCell = [reactOutline viewAtColumn:0 row:1 makeIfNecessary:YES];
  [countedCell layoutSubtreeIfNeeded]; [countedCell resizeSubviewsWithOldSize:NSZeroSize];
  NSTextField *reactCount = [countedCell valueForKey:@"countField"];
  CHECK(counted.superview == countedCell && !reactCount.hidden && [reactCount.stringValue isEqual:@"12"]);
  CHECK(NSMaxX(counted.frame) <= NSMinX(reactCount.frame) && NSWidth(counted.frame) < NSWidth(countedCell.bounds));
  CHECK(!countedEvents->widths.empty() && countedEvents->widths.back() == NSWidth(counted.frame));
  NSView *plainCell = plainRow.superview;
  CHECK(NSWidth(plainRow.frame) == NSWidth(plainCell.bounds));

  // Review fixes. A user collapse hides the selected row without deselecting it: no event, and it is selected
  // again on expand. In multiple selection, hidden selected rows stay in the reported IDs.
  {
    RNSidebar *view = [RNSidebar new];
    auto props = std::make_shared<SidebarProps>(*treeProps); props->collapsedIdsJson = "[]"; props->selectedIdsJson = R"(["origin/main"])";
    [view updateProps:props oldProps:nullptr];
    auto events = Lay(view, window, LayoutDirection::LeftToRight);
    NSOutlineView *table = Table(view);
    id origin = [table itemAtRow:4];
    CHECK([[view itemIdAtRow:table.selectedRow] isEqual:@"origin/main"]);
    [table collapseItem:origin];
    CHECK(events->selections.empty() && table.selectedRow == -1);
    [table expandItem:origin];
    CHECK(events->selections.empty() && [[view itemIdAtRow:table.selectedRow] isEqual:@"origin/main"]);
    // A remount (null oldProps) with the same collapsedIds keeps the user's toggle.
    [table collapseItem:origin];
    [view updateProps:props oldProps:nullptr];
    CHECK(![table isItemExpanded:[table itemAtRow:4]]);
    auto many = std::make_shared<SidebarProps>(*props); many->allowsMultipleSelection = true; many->selectedIdsJson = R"(["changes","origin/main"])";
    [view updateProps:many oldProps:props];
    [table selectRowIndexes:[NSIndexSet indexSetWithIndex:2] byExtendingSelection:YES];
    CHECK(!events->selections.empty() && events->selections.back() == R"(history ["origin/main","changes","history"])");
  }
  // A React row's style-only update (its reported width) neither reloads the outline nor scrolls to the selection.
  {
    CountingSidebar *view = [CountingSidebar new];
    auto props = std::make_shared<SidebarProps>(); props->selectedIdsJson = R"(["r0"])";
    [view updateProps:props oldProps:nullptr];
    Lay(view, window, LayoutDirection::LeftToRight);
    std::vector<RNSidebarItem *> rows;
    for (int index = 0; index < 30; index++) rows.push_back(Item(view, index, ("r" + std::to_string(index)).c_str(), true, 28, false, 28));
    [window layoutIfNeeded];
    NSClipView *clip = Table(view).enclosingScrollView.contentView;
    [clip scrollToPoint:NSMakePoint(0, 500)];
    int reloads = view.reloads;
    auto same = std::make_shared<SidebarItemProps>(); same->itemId = "r29"; same->selectable = true; same->rowHeight = 28;
    [rows.back() updateProps:same oldProps:nullptr];
    CHECK(view.reloads == reloads);
    [view reloadRows];
    CHECK(NSMinY(clip.bounds) == 500);
  }

  // A selection applied before the first layout scrolls only once the list has a height: a visible row leaves
  // the list at its top, and a row below the fold is scrolled into view.
  {
    RNSidebar *visible = [RNSidebar new];
    [visible updateProps:treeProps oldProps:nullptr];
    Lay(visible, window, LayoutDirection::LeftToRight);
    CHECK(NSMinY(Table(visible).enclosingScrollView.contentView.bounds) <= 0);
    RNSidebar *below = [RNSidebar new];
    auto far = std::make_shared<SidebarProps>(*many); far->selectedIdsJson = R"(["row19"])";
    [below updateProps:far oldProps:nullptr];
    Lay(below, window, LayoutDirection::LeftToRight);
    NSRect visibleRect = Table(below).visibleRect;
    CHECK(NSContainsRect(visibleRect, [Table(below) rectOfRow:Table(below).selectedRow]));
  }

  if (failures) return 1;
  std::puts("Sidebar mount, selective updates and row geometry passed");
} }
