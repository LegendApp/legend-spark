#import "RNSparkTable.h"
#import <react/renderer/components/RNSparkUISpec/ComponentDescriptors.h>
#import <react/renderer/components/RNSparkUISpec/EventEmitters.h>
#import <react/renderer/components/RNSparkUISpec/Props.h>
using namespace facebook::react;

static NSUserInterfaceItemIdentifier const RNSparkTableCellIdentifier = @"RNSparkTableCell";

/** One row. Rows in unchanged chunks keep their identity; selection and expansion are reapplied by ID after a reload. */
@interface RNSparkTableRow : NSObject
@property (nonatomic, copy) NSString *rowId;
@property (nonatomic, copy) NSDictionary<NSString *, NSString *> *cells;
@property (nonatomic) NSInteger depth;
@property (nonatomic) BOOL expandable;
@property (nonatomic, strong, nullable) NSMutableArray<RNSparkTableRow *> *children;
@end
@implementation RNSparkTableRow
@end

@protocol RNSparkTableInput
- (void)tableActivate;
- (void)tableContextMenu:(NSEvent *)event;
@end
// Return or Enter activates the selection.
static BOOL RNSparkTableKeyDown(NSEvent *event, id<RNSparkTableInput> input) {
  NSString *characters = event.charactersIgnoringModifiers;
  NSEventModifierFlags flags = event.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagControl | NSEventModifierFlagOption | NSEventModifierFlagShift);
  if (characters.length != 1 || flags) return NO;
  unichar key = [characters characterAtIndex:0];
  if (key != NSCarriageReturnCharacter && key != NSEnterCharacter) return NO;
  [input tableActivate];
  return YES;
}
// Command-A selects every row while the view has focus, whether or not the app's Edit menu has Select All.
static BOOL RNSparkTableSelectAll(NSTableView *view, NSEvent *event) {
  NSEventModifierFlags flags = event.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagControl | NSEventModifierFlagOption | NSEventModifierFlagShift);
  if (view.window.firstResponder != view || flags != NSEventModifierFlagCommand || ![event.charactersIgnoringModifiers.lowercaseString isEqualToString:@"a"]) return NO;
  [view selectAll:nil];
  return YES;
}
// AppKit's header refuses first-mouse clicks. Like React Native's RCTUIView, it exposes a settable
// acceptsFirstMouse (default NO) for callers that treat a window as key, such as the in-app test driver.
@interface RNSparkTableHeaderView : NSTableHeaderView
@property (nonatomic) BOOL acceptsFirstMouse;
@end
@implementation RNSparkTableHeaderView
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return _acceptsFirstMouse || [super acceptsFirstMouse:event]; }
@end

@interface RNSparkTableView : NSTableView
@property (nonatomic, weak) id<RNSparkTableInput> input;
@end
@implementation RNSparkTableView
- (void)keyDown:(NSEvent *)event { if (!RNSparkTableKeyDown(event, self.input)) [super keyDown:event]; }
- (BOOL)performKeyEquivalent:(NSEvent *)event { return RNSparkTableSelectAll(self, event) || [super performKeyEquivalent:event]; }
// The application shows its own menu (showContextMenu) from the event; AppKit shows none. Right-clicks
// stop here: AppKit would pass them on to ancestors, which can show menus of their own.
- (NSMenu *)menuForEvent:(NSEvent *)event { [self.input tableContextMenu:event]; return nil; }
- (void)rightMouseDown:(NSEvent *)event { [self menuForEvent:event]; }
@end
@interface RNSparkOutlineView : NSOutlineView
@property (nonatomic, weak) id<RNSparkTableInput> input;
/** The row a plain (not Option) collapse is closing. AppKit also reports its expanded descendants as collapsed. */
@property (nonatomic, weak, readonly, nullable) id collapsingParent;
@end
@implementation RNSparkOutlineView
- (void)collapseItem:(id)item collapseChildren:(BOOL)collapseChildren {
  id previous = _collapsingParent;
  _collapsingParent = collapseChildren ? nil : item;
  [super collapseItem:item collapseChildren:collapseChildren];
  _collapsingParent = previous;
}
- (void)keyDown:(NSEvent *)event { if (!RNSparkTableKeyDown(event, self.input)) [super keyDown:event]; }
- (BOOL)performKeyEquivalent:(NSEvent *)event { return RNSparkTableSelectAll(self, event) || [super performKeyEquivalent:event]; }
- (NSMenu *)menuForEvent:(NSEvent *)event { [self.input tableContextMenu:event]; return nil; }
- (void)rightMouseDown:(NSEvent *)event { [self menuForEvent:event]; }
@end

static NSString *ToNSString(std::string const &value) { return [[NSString alloc] initWithBytes:value.data() length:value.size() encoding:NSUTF8StringEncoding] ?: @""; }
static std::vector<std::string> Strings(NSArray<NSString *> *values) {
  std::vector<std::string> result; result.reserve(values.count);
  for (NSString *value in values) result.emplace_back(value.UTF8String);
  return result;
}
static NSArray<NSString *> *IdArray(std::vector<std::string> const &values) {
  NSMutableArray *result = [NSMutableArray arrayWithCapacity:values.size()];
  for (auto const &value : values) [result addObject:ToNSString(value)];
  return result;
}
static id ParseJSON(std::string const &json) {
  return [NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:json.data() length:json.size()] options:0 error:nil];
}
static std::string JSONString(id object) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:nil];
  return std::string((const char *)data.bytes, data.length);
}

@interface RNSparkTable () <RNSparkTableInput>
@end

@implementation RNSparkTable {
  NSScrollView *_scrollView;
  NSTableView *_tableView;
  BOOL _outline;
  // Last applied props; the view diffs against these, never against Fabric's oldProps (null on mount).
  std::string _columnsJson, _selectionMode, _sortJson, _layoutJson;
  std::vector<std::string> _chunkSources, _selectedIdsProp, _expandedIdsProp;
  BOOL _columnReordering;
  NSArray<NSArray<RNSparkTableRow *> *> *_chunks;
  NSArray<RNSparkTableRow *> *_rows;
  NSArray<RNSparkTableRow *> *_roots;
  NSDictionary<NSString *, RNSparkTableRow *> *_rowsById;
  NSDictionary<NSString *, NSNumber *> *_indexById;
  NSDictionary<NSString *, NSDictionary *> *_columnsById;
  // Native state: what the user did last, until JS has caught up and props reconcile it.
  NSArray<NSString *> *_selectedIds;
  NSMutableSet<NSString *> *_expanded;
  NSString *_pendingError;
  int _eventCount, _acknowledged;
  BOOL _updating, _rtl, _expansionPending;
}

- (instancetype)init {
  if (self = [super init]) {
    _props = std::make_shared<const SparkTableProps>();
    _scrollView = [NSScrollView new];
    _scrollView.hasVerticalScroller = YES;
    _scrollView.hasHorizontalScroller = YES;
    _scrollView.autohidesScrollers = YES;
    _scrollView.borderType = NSNoBorder;
    [self addSubview:_scrollView];
    [self resetState];
  }
  return self;
}
- (BOOL)isFlipped { return YES; }

- (void)resetState {
  _columnsJson = _selectionMode = _sortJson = _layoutJson = "";
  _chunkSources.clear(); _selectedIdsProp.clear(); _expandedIdsProp.clear();
  _columnReordering = NO;
  _chunks = @[]; _rows = @[]; _roots = @[]; _rowsById = @{}; _indexById = @{}; _columnsById = @{};
  _selectedIds = @[]; _expanded = [NSMutableSet new];
  _pendingError = nil; _eventCount = 0; _acknowledged = 0; _updating = NO; _expansionPending = NO;
}

- (void)createTable:(BOOL)outline {
  _outline = outline;
  NSTableView *table;
  if (outline) {
    // Expanding a deep row must not resize the outline column, which would report a column layout change.
    RNSparkOutlineView *view = [RNSparkOutlineView new]; view.input = self; view.autoresizesOutlineColumn = NO; table = view;
  } else {
    RNSparkTableView *view = [RNSparkTableView new]; view.input = self; table = view;
  }
  table.headerView = [[RNSparkTableHeaderView alloc] initWithFrame:table.headerView.frame];
  table.style = NSTableViewStyleFullWidth;
  table.columnAutoresizingStyle = NSTableViewNoColumnAutoresizing;
  table.usesAlternatingRowBackgroundColors = YES;
  table.allowsEmptySelection = YES;
  table.allowsColumnSelection = NO;
  table.target = self;
  table.doubleAction = @selector(doubleClicked:);
  table.dataSource = self;
  table.delegate = self;
  _tableView = table;
  _scrollView.documentView = table;
  _columnsById = @{};
  [self applyDirection];
}

#pragma mark - Props

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps {
  const auto &next = *std::static_pointer_cast<const SparkTableProps>(props);
  BOOL recreated = !_tableView || next.outline != _outline;
  _updating = YES;
  if (recreated) [self createTable:next.outline];
  BOOL columnsChanged = recreated || next.columnsJson != _columnsJson;
  if (columnsChanged) [self applyColumns:next.columnsJson];
  if (recreated || next.columnReordering != _columnReordering) _tableView.allowsColumnReordering = _columnReordering = next.columnReordering;
  if (recreated || next.selectionMode != _selectionMode) {
    _selectionMode = next.selectionMode;
    _tableView.allowsMultipleSelection = _selectionMode == "multiple";
  }
  BOOL rowsChanged = [self applyRowChunks:next.rowChunks];
  if (recreated || rowsChanged || columnsChanged) [self reloadRows];
  // Controlled state is reconciled only once JS has processed every event this view emitted, so
  // stale props never undo a selection, sort, resize or expansion in flight. An acknowledgment
  // reconciles too: it restores whatever the parent did not accept.
  BOOL caughtUp = next.eventCount >= _eventCount && !_expansionPending, acknowledged = next.eventCount != _acknowledged;
  _acknowledged = next.eventCount;
  if (caughtUp) {
    BOOL all = recreated || acknowledged;
    if (all || next.sortJson != _sortJson) [self applySort:next.sortJson];
    if (!next.columnLayoutJson.empty() && (all || columnsChanged || next.columnLayoutJson != _layoutJson)) [self applyLayout:next.columnLayoutJson];
    if (_outline && (all || rowsChanged || next.expandedIds != _expandedIdsProp)) {
      _expanded = [NSMutableSet setWithArray:IdArray(next.expandedIds)];
      [self applyExpansion:_roots];
    }
    if (all || rowsChanged || next.selectedIds != _selectedIdsProp) {
      _selectedIds = IdArray(next.selectedIds);
      [self applySelection];
    }
  }
  _sortJson = next.sortJson; _layoutJson = next.columnLayoutJson; _expandedIdsProp = next.expandedIds; _selectedIdsProp = next.selectedIds;
  _updating = NO;
  [super updateProps:props oldProps:oldProps];
}

- (NSTextAlignment)alignment:(NSString *)alignment {
  if ([alignment isEqual:@"center"]) return NSTextAlignmentCenter;
  return [alignment isEqual:@"trailing"] == _rtl ? NSTextAlignmentLeft : NSTextAlignmentRight;
}

- (void)applyColumns:(std::string const &)json {
  NSArray *definitions = ParseJSON(json);
  if (![definitions isKindOfClass:NSArray.class] || !definitions.count) { [self reportError:@"Invalid table columns JSON"]; return; }
  NSMutableDictionary<NSString *, NSDictionary *> *byId = [NSMutableDictionary new];
  for (NSDictionary *definition in definitions) {
    if (![definition isKindOfClass:NSDictionary.class] || ![definition[@"id"] isKindOfClass:NSString.class] || ![definition[@"title"] isKindOfClass:NSString.class]) { [self reportError:@"Invalid table column"]; return; }
    byId[definition[@"id"]] = definition;
  }
  for (NSTableColumn *column in [_tableView.tableColumns copy]) if (!byId[column.identifier]) [_tableView removeTableColumn:column];
  // New columns are appended; existing ones keep the user's order. A width applies when it is new or changed.
  for (NSDictionary *definition in definitions) {
    NSString *identifier = definition[@"id"];
    NSTableColumn *column = [_tableView tableColumnWithIdentifier:identifier];
    BOOL created = !column;
    if (created) { column = [[NSTableColumn alloc] initWithIdentifier:identifier]; [_tableView addTableColumn:column]; }
    column.title = definition[@"title"];
    column.minWidth = [definition[@"minWidth"] doubleValue];
    column.maxWidth = [definition[@"maxWidth"] doubleValue];
    if (created || ![_columnsById[identifier][@"width"] isEqual:definition[@"width"]]) column.width = [definition[@"width"] doubleValue];
    column.resizingMask = [definition[@"resizable"] boolValue] ? NSTableColumnUserResizingMask : NSTableColumnNoResizing;
    column.sortDescriptorPrototype = [definition[@"sortable"] boolValue] ? [NSSortDescriptor sortDescriptorWithKey:identifier ascending:YES] : nil;
    column.headerCell.alignment = [self alignment:definition[@"alignment"]];
  }
  _columnsById = byId;
  if (_outline) ((NSOutlineView *)_tableView).outlineTableColumn = [_tableView tableColumnWithIdentifier:definitions[0][@"id"]];
  _columnsJson = json;
}

- (nullable NSArray<RNSparkTableRow *> *)parseChunk:(std::string const &)json {
  NSArray *items = ParseJSON(json);
  if (![items isKindOfClass:NSArray.class]) return nil;
  NSMutableArray<RNSparkTableRow *> *rows = [NSMutableArray arrayWithCapacity:items.count];
  for (NSArray *item in items) {
    if (![item isKindOfClass:NSArray.class] || item.count != 3 || ![item[0] isKindOfClass:NSNumber.class] || ![item[1] isKindOfClass:NSNumber.class] || ![item[2] isKindOfClass:NSDictionary.class]) return nil;
    NSString *rowId = item[2][@"id"];
    NSDictionary *cells = item[2][@"cells"];
    if (![rowId isKindOfClass:NSString.class] || ![cells isKindOfClass:NSDictionary.class]) return nil;
    for (id value in cells.objectEnumerator) if (![value isKindOfClass:NSString.class]) return nil;
    RNSparkTableRow *row = [RNSparkTableRow new];
    row.rowId = rowId; row.cells = cells; row.depth = [item[0] integerValue]; row.expandable = [item[1] boolValue];
    [rows addObject:row];
  }
  return rows;
}

/** Re-parses only chunks whose JSON changed, then rebuilds the flat order and the outline tree. */
- (BOOL)applyRowChunks:(std::vector<std::string> const &)sources {
  if (sources == _chunkSources) return NO;
  NSMutableArray<NSArray<RNSparkTableRow *> *> *chunks = [NSMutableArray arrayWithCapacity:sources.size()];
  for (size_t index = 0; index < sources.size(); index++) {
    if (index < _chunkSources.size() && sources[index] == _chunkSources[index]) { [chunks addObject:_chunks[index]]; continue; }
    NSArray *rows = [self parseChunk:sources[index]];
    if (!rows) { [self reportError:@"Invalid table row JSON"]; return NO; }
    [chunks addObject:rows];
  }
  NSMutableArray<RNSparkTableRow *> *all = [NSMutableArray new], *roots = [NSMutableArray new], *ancestors = [NSMutableArray new];
  NSMutableDictionary<NSString *, RNSparkTableRow *> *byId = [NSMutableDictionary new];
  NSMutableDictionary<NSString *, NSNumber *> *indexById = [NSMutableDictionary new];
  for (NSArray<RNSparkTableRow *> *chunk in chunks) for (RNSparkTableRow *row in chunk) {
    if (row.depth < 0 || row.depth > (NSInteger)ancestors.count || (row.depth > 0 && !ancestors[row.depth - 1].expandable) || byId[row.rowId]) { [self reportError:@"Invalid table row order"]; return NO; }
    [ancestors removeObjectsInRange:NSMakeRange(row.depth, ancestors.count - row.depth)];
    row.children = row.expandable ? [NSMutableArray new] : nil;
    [row.depth ? ancestors.lastObject.children : roots addObject:row];
    [ancestors addObject:row];
    byId[row.rowId] = row; indexById[row.rowId] = @(all.count);
    [all addObject:row];
  }
  _chunkSources = sources; _chunks = chunks; _rows = all; _roots = roots; _rowsById = byId; _indexById = indexById;
  return YES;
}

- (void)reloadRows {
  [_tableView reloadData];
  if (_outline) [self applyExpansion:_roots];
  [self applySelection];
}

- (void)applySort:(std::string const &)json {
  NSArray *items = ParseJSON(json);
  if (![items isKindOfClass:NSArray.class]) { [self reportError:@"Invalid table sort JSON"]; return; }
  NSMutableArray<NSSortDescriptor *> *descriptors = [NSMutableArray new];
  for (NSDictionary *item in items) {
    if (![item isKindOfClass:NSDictionary.class] || ![item[@"columnId"] isKindOfClass:NSString.class]) { [self reportError:@"Invalid table sort descriptor"]; return; }
    [descriptors addObject:[NSSortDescriptor sortDescriptorWithKey:item[@"columnId"] ascending:[item[@"ascending"] boolValue]]];
  }
  if (![_tableView.sortDescriptors isEqual:descriptors]) _tableView.sortDescriptors = descriptors;
  [self updateSortIndicators];
}

- (void)updateSortIndicators {
  NSSortDescriptor *primary = _tableView.sortDescriptors.firstObject;
  for (NSTableColumn *column in _tableView.tableColumns) {
    BOOL sorted = [primary.key isEqual:column.identifier];
    [_tableView setIndicatorImage:sorted ? [NSImage imageNamed:primary.ascending ? @"NSAscendingSortIndicator" : @"NSDescendingSortIndicator"] : nil inTableColumn:column];
  }
}

- (void)applyLayout:(std::string const &)json {
  NSArray *entries = ParseJSON(json);
  if (![entries isKindOfClass:NSArray.class]) { [self reportError:@"Invalid table column layout JSON"]; return; }
  NSInteger position = 0;
  for (NSDictionary *entry in entries) {
    NSInteger index = [entry isKindOfClass:NSDictionary.class] && [entry[@"id"] isKindOfClass:NSString.class] ? [_tableView columnWithIdentifier:entry[@"id"]] : -1;
    if (index < 0) { [self reportError:@"Invalid table column layout entry"]; return; }
    if (index != position) [_tableView moveColumn:index toColumn:position];
    NSTableColumn *column = _tableView.tableColumns[position++];
    CGFloat width = [entry[@"width"] doubleValue];
    if (column.width != width) column.width = width;
  }
}

- (void)applySelection {
  NSMutableIndexSet *indexes = [NSMutableIndexSet new];
  for (NSString *rowId in _selectedIds) {
    NSInteger row = _outline ? (_rowsById[rowId] ? [(NSOutlineView *)_tableView rowForItem:_rowsById[rowId]] : -1) : (_indexById[rowId] ? _indexById[rowId].integerValue : -1);
    if (row >= 0) [indexes addIndex:row];
  }
  if (![indexes isEqual:_tableView.selectedRowIndexes]) [_tableView selectRowIndexes:indexes byExtendingSelection:NO];
}

/** Expands rows in the logical set, top-down through visible rows, so remembered descendants reopen with their parent. */
- (void)applyExpansion:(NSArray<RNSparkTableRow *> *)rows {
  NSOutlineView *outline = (NSOutlineView *)_tableView;
  for (RNSparkTableRow *row in rows) {
    if (!row.expandable) continue;
    BOOL expand = [_expanded containsObject:row.rowId];
    if (expand != [outline isItemExpanded:row]) { if (expand) [outline expandItem:row]; else [outline collapseItem:row]; }
    if (expand) [self applyExpansion:row.children];
  }
}

- (void)applyDirection {
  NSUserInterfaceLayoutDirection direction = _rtl ? NSUserInterfaceLayoutDirectionRightToLeft : NSUserInterfaceLayoutDirectionLeftToRight;
  _scrollView.userInterfaceLayoutDirection = direction;
  // With autoresizesOutlineColumn off, NSOutlineView keeps the old direction's column positions (tile and
  // reloadData do not refresh them); it lays columns out for a new direction while the outline column autoresizes.
  NSOutlineView *outline = _outline ? (NSOutlineView *)_tableView : nil;
  outline.autoresizesOutlineColumn = YES;
  _tableView.userInterfaceLayoutDirection = direction;
  outline.autoresizesOutlineColumn = NO;
  _tableView.headerView.userInterfaceLayoutDirection = direction;
  for (NSTableColumn *column in _tableView.tableColumns) column.headerCell.alignment = [self alignment:_columnsById[column.identifier][@"alignment"]];
}

#pragma mark - Rows and cells

- (RNSparkTableRow *)rowAt:(NSInteger)index {
  if (index < 0 || index >= _tableView.numberOfRows) return nil;
  return _outline ? [(NSOutlineView *)_tableView itemAtRow:index] : _rows[index];
}
- (NSArray<NSString *> *)idsAt:(NSIndexSet *)indexes {
  NSMutableArray<NSString *> *ids = [NSMutableArray arrayWithCapacity:indexes.count];
  [indexes enumerateIndexesUsingBlock:^(NSUInteger index, BOOL *stop) { RNSparkTableRow *row = [self rowAt:index]; if (row) [ids addObject:row.rowId]; }];
  return ids;
}
/** The selection when the row is part of it, otherwise only that row. */
- (NSArray<NSString *> *)idsForRow:(NSInteger)index {
  if ([_tableView.selectedRowIndexes containsIndex:index]) return [self idsAt:_tableView.selectedRowIndexes];
  RNSparkTableRow *row = [self rowAt:index];
  return row ? @[row.rowId] : @[];
}

- (NSView *)cellForColumn:(NSTableColumn *)column row:(RNSparkTableRow *)row {
  NSTableCellView *cell = [_tableView makeViewWithIdentifier:RNSparkTableCellIdentifier owner:self];
  if (!cell) {
    cell = [NSTableCellView new];
    cell.identifier = RNSparkTableCellIdentifier;
    NSTextField *text = [NSTextField labelWithString:@""];
    text.lineBreakMode = NSLineBreakByTruncatingTail;
    text.translatesAutoresizingMaskIntoConstraints = NO;
    [text setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
    [cell addSubview:text];
    cell.textField = text;
    // Equal insets on both edges: the explicit alignment, not the anchors, follows the layout direction.
    [NSLayoutConstraint activateConstraints:@[
      [text.leftAnchor constraintEqualToAnchor:cell.leftAnchor constant:3], [text.rightAnchor constraintEqualToAnchor:cell.rightAnchor constant:-3],
      [text.centerYAnchor constraintEqualToAnchor:cell.centerYAnchor],
    ]];
  }
  cell.textField.stringValue = row.cells[column.identifier] ?: @"";
  cell.textField.alignment = [self alignment:_columnsById[column.identifier][@"alignment"]];
  return cell;
}
- (nullable NSString *)typeSelectStringForColumn:(NSTableColumn *)column row:(RNSparkTableRow *)row {
  return column == _tableView.tableColumns.firstObject ? row.cells[column.identifier] : nil;
}

- (NSInteger)numberOfRowsInTableView:(NSTableView *)tableView { return _outline ? 0 : (NSInteger)_rows.count; }
- (NSView *)tableView:(NSTableView *)tableView viewForTableColumn:(NSTableColumn *)column row:(NSInteger)row { return [self cellForColumn:column row:_rows[row]]; }
- (NSString *)tableView:(NSTableView *)tableView typeSelectStringForTableColumn:(NSTableColumn *)column row:(NSInteger)row { return [self typeSelectStringForColumn:column row:_rows[row]]; }
- (NSInteger)outlineView:(NSOutlineView *)outlineView numberOfChildrenOfItem:(RNSparkTableRow *)item { return (NSInteger)(item ? item.children : _roots).count; }
- (id)outlineView:(NSOutlineView *)outlineView child:(NSInteger)index ofItem:(RNSparkTableRow *)item { return (item ? item.children : _roots)[index]; }
- (BOOL)outlineView:(NSOutlineView *)outlineView isItemExpandable:(RNSparkTableRow *)item { return item.expandable; }
- (NSView *)outlineView:(NSOutlineView *)outlineView viewForTableColumn:(NSTableColumn *)column item:(RNSparkTableRow *)item { return [self cellForColumn:column row:item]; }
- (NSString *)outlineView:(NSOutlineView *)outlineView typeSelectStringForTableColumn:(NSTableColumn *)column item:(RNSparkTableRow *)item { return [self typeSelectStringForColumn:column row:item]; }

#pragma mark - User changes

- (std::shared_ptr<const SparkTableEventEmitter>)emitter { return std::static_pointer_cast<const SparkTableEventEmitter>(_eventEmitter); }

- (NSIndexSet *)proposedSelection:(NSIndexSet *)proposed {
  if (_selectionMode == "none") return [NSIndexSet indexSet];
  // A Control-click asks for the context menu (menuForEvent:): like a right-click, it leaves the selection alone.
  NSEvent *event = NSApp.currentEvent;
  BOOL leftMouse = event.type == NSEventTypeLeftMouseDown || event.type == NSEventTypeLeftMouseDragged || event.type == NSEventTypeLeftMouseUp;
  return leftMouse && (event.modifierFlags & NSEventModifierFlagControl) ? _tableView.selectedRowIndexes : proposed;
}
- (NSIndexSet *)tableView:(NSTableView *)tableView selectionIndexesForProposedSelection:(NSIndexSet *)proposed { return [self proposedSelection:proposed]; }
- (NSIndexSet *)outlineView:(NSOutlineView *)outlineView selectionIndexesForProposedSelection:(NSIndexSet *)proposed { return [self proposedSelection:proposed]; }

- (void)selectionChanged {
  if (_updating) return;
  _selectedIds = [self idsAt:_tableView.selectedRowIndexes];
  if (self.emitter) self.emitter->onTableSelectionChange({ .ids = Strings(_selectedIds), .eventCount = ++_eventCount });
}
- (void)tableViewSelectionDidChange:(NSNotification *)notification { [self selectionChanged]; }
- (void)outlineViewSelectionDidChange:(NSNotification *)notification { [self selectionChanged]; }

// AppKit has already applied the new descriptors (clicked column first) and shows them until JS reconciles.
- (void)sortChanged {
  if (_updating || !self.emitter) return;
  [self updateSortIndicators];
  NSMutableArray *sort = [NSMutableArray new];
  for (NSSortDescriptor *descriptor in _tableView.sortDescriptors) if (descriptor.key) [sort addObject:@{ @"columnId": descriptor.key, @"ascending": @(descriptor.ascending) }];
  self.emitter->onTableSortChange({ .sortJson = JSONString(sort), .eventCount = ++_eventCount });
}
- (void)tableView:(NSTableView *)tableView sortDescriptorsDidChange:(NSArray<NSSortDescriptor *> *)oldDescriptors { [self sortChanged]; }
- (void)outlineView:(NSOutlineView *)outlineView sortDescriptorsDidChange:(NSArray<NSSortDescriptor *> *)oldDescriptors { [self sortChanged]; }

- (void)layoutChanged {
  if (_updating || !self.emitter) return;
  NSMutableArray *layout = [NSMutableArray new];
  for (NSTableColumn *column in _tableView.tableColumns) [layout addObject:@{ @"id": column.identifier, @"width": @(column.width) }];
  self.emitter->onTableColumnLayoutChange({ .layoutJson = JSONString(layout), .eventCount = ++_eventCount });
}
- (void)tableViewColumnDidMove:(NSNotification *)notification { [self layoutChanged]; }
- (void)tableViewColumnDidResize:(NSNotification *)notification { [self layoutChanged]; }
- (void)outlineViewColumnDidMove:(NSNotification *)notification { [self layoutChanged]; }
- (void)outlineViewColumnDidResize:(NSNotification *)notification { [self layoutChanged]; }

// Option-click expands or collapses a whole subtree, one notification per row: the change is
// reported once, after the burst. Until then props cannot reconcile expansion (see updateProps).
- (void)expansionChanged:(NSNotification *)notification expanded:(BOOL)expanded {
  RNSparkTableRow *row = notification.userInfo[@"NSObject"];
  if (_updating || ![row isKindOfClass:RNSparkTableRow.class]) return;
  // A plain collapse keeps expanded descendants expanded, so they reopen with the parent.
  id parent = ((RNSparkOutlineView *)_tableView).collapsingParent;
  if (!expanded && parent && parent != row) return;
  if (expanded) [_expanded addObject:row.rowId]; else [_expanded removeObject:row.rowId];
  if (_expansionPending) return;
  _expansionPending = YES;
  __weak RNSparkTable *weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf flushExpansion]; });
}
- (void)flushExpansion {
  if (!_expansionPending) return;
  _expansionPending = NO;
  _updating = YES; [self applyExpansion:_roots]; _updating = NO;
  NSMutableArray<NSString *> *ids = [NSMutableArray new];
  for (RNSparkTableRow *row in _rows) if (row.expandable && [_expanded containsObject:row.rowId]) [ids addObject:row.rowId];
  if (self.emitter) self.emitter->onTableExpandedChange({ .ids = Strings(ids), .eventCount = ++_eventCount });
}
- (void)outlineViewItemDidExpand:(NSNotification *)notification { [self expansionChanged:notification expanded:YES]; }
- (void)outlineViewItemDidCollapse:(NSNotification *)notification { [self expansionChanged:notification expanded:NO]; }

- (void)doubleClicked:(id)sender {
  NSInteger row = _tableView.clickedRow;
  if (row >= 0 && self.emitter) self.emitter->onTableActivate({ .ids = Strings([self idsForRow:row]) });
}
- (void)tableActivate {
  NSArray<NSString *> *ids = [self idsAt:_tableView.selectedRowIndexes];
  if (ids.count && self.emitter) self.emitter->onTableActivate({ .ids = Strings(ids) });
}
- (void)tableContextMenu:(NSEvent *)event {
  if (!self.emitter) return;
  NSInteger index = [_tableView rowAtPoint:[_tableView convertPoint:event.locationInWindow fromView:nil]];
  RNSparkTableRow *row = [self rowAt:index];
  CGFloat height = NSHeight(self.window.contentView.bounds);
  self.emitter->onTableContextMenu({ .ids = Strings(row ? [self idsForRow:index] : @[]), .rowId = row ? row.rowId.UTF8String : "", .x = event.locationInWindow.x, .y = height - event.locationInWindow.y });
}

#pragma mark - Errors, layout, recycling

- (void)reportError:(NSString *)message {
  if (self.emitter) self.emitter->onTableError({ .message = message.UTF8String });
  else _pendingError = message;
}
- (void)updateEventEmitter:(EventEmitter::Shared const &)eventEmitter {
  [super updateEventEmitter:eventEmitter];
  NSString *pending = _pendingError;
  _pendingError = nil;
  if (pending) [self reportError:pending];
}

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics {
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  BOOL rtl = layoutMetrics.layoutDirection == LayoutDirection::RightToLeft;
  if (rtl != _rtl) {
    _rtl = rtl;
    _updating = YES;
    [self applyDirection];
    [self reloadRows];
    _updating = NO;
  }
  [self layoutSubviews];
}
- (void)layoutSubviews {
  [super layoutSubviews];
  _scrollView.frame = self.bounds;
}

- (void)prepareForRecycle {
  [super prepareForRecycle];
  _updating = YES;
  _tableView.dataSource = nil; _tableView.delegate = nil;
  _scrollView.documentView = nil;
  _tableView = nil;
  _rtl = NO;
  [self resetState];
}

+ (ComponentDescriptorProvider)componentDescriptorProvider { return concreteComponentDescriptorProvider<SparkTableComponentDescriptor>(); }
@end
