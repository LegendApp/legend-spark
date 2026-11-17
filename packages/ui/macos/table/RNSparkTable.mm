#import "RNSparkTable.h"
#import "RNSparkLayoutDirection.h"
#import <react/renderer/components/RNSparkUISpec/ComponentDescriptors.h>
#import <react/renderer/components/RNSparkUISpec/EventEmitters.h>
#import <react/renderer/components/RNSparkUISpec/Props.h>
using namespace facebook::react;

static NSUserInterfaceItemIdentifier const RNSparkTableCellIdentifier = @"RNSparkTableCell";

static id RNSparkTableJSON(const std::string &json, Class expected) {
  NSData *data = [NSData dataWithBytes:json.data() length:json.size()];
  id value = data.length ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  return [value isKindOfClass:expected] ? value : nil;
}

// An NSTableView with a header and text columns. AppKit asks only for the visible rows' cells and reuses them, so
// long tables stay cheap; the rows themselves arrive as one JSON array of { id, values }.
@interface RNSparkTable () <NSTableViewDataSource, NSTableViewDelegate>
@end
@implementation RNSparkTable {
  NSScrollView *_scrollView;
  NSTableView *_tableView;
  NSArray<NSDictionary *> *_columns;
  NSArray<NSDictionary *> *_rows;
  NSDictionary<NSString *, NSNumber *> *_rowIndexes;
  BOOL _applyingSelection;
}
- (instancetype)init {
  if (self = [super init]) {
    _props = std::make_shared<const SparkTableProps>();
    _columns = @[];
    _rows = @[];
    _rowIndexes = @{};
    _tableView = [[NSTableView alloc] initWithFrame:NSZeroRect];
    _tableView.style = NSTableViewStyleFullWidth;
    _tableView.columnAutoresizingStyle = NSTableViewUniformColumnAutoresizingStyle;
    _tableView.allowsColumnReordering = NO;
    _tableView.allowsEmptySelection = YES;
    _tableView.dataSource = self;
    _tableView.delegate = self;
    _tableView.target = self;
    _tableView.doubleAction = @selector(rowDoubleClicked:);
    _scrollView = [[NSScrollView alloc] initWithFrame:NSZeroRect];
    _scrollView.documentView = _tableView;
    _scrollView.hasVerticalScroller = YES;
    _scrollView.hasHorizontalScroller = NO;
    _scrollView.autohidesScrollers = YES;
    _scrollView.drawsBackground = YES;
    [self addSubview:_scrollView];
  }
  return self;
}
- (BOOL)isFlipped { return YES; }
- (void)layoutSubviews { [super layoutSubviews]; _scrollView.frame = self.bounds; }

- (void)applyColumns:(NSArray<NSDictionary *> *)columns {
  _columns = columns;
  for (NSTableColumn *column in [_tableView.tableColumns copy]) [_tableView removeTableColumn:column];
  for (NSDictionary *config in columns) {
    NSTableColumn *column = [[NSTableColumn alloc] initWithIdentifier:config[@"id"]];
    column.title = config[@"title"] ?: @"";
    column.headerToolTip = column.title;
    column.minWidth = [config[@"minWidth"] isKindOfClass:NSNumber.class] ? [config[@"minWidth"] doubleValue] : 40;
    column.maxWidth = [config[@"maxWidth"] isKindOfClass:NSNumber.class] ? [config[@"maxWidth"] doubleValue] : CGFLOAT_MAX;
    // A column with a width keeps it as the table resizes; the others share the remaining width.
    BOOL fixed = [config[@"width"] isKindOfClass:NSNumber.class];
    if (fixed) column.width = [config[@"width"] doubleValue];
    column.resizingMask = fixed ? NSTableColumnUserResizingMask : NSTableColumnUserResizingMask | NSTableColumnAutoresizingMask;
    NSString *alignment = config[@"alignment"];
    column.headerCell.alignment = [alignment isEqual:@"trailing"] ? NSTextAlignmentRight : [alignment isEqual:@"center"] ? NSTextAlignmentCenter : NSTextAlignmentNatural;
    [_tableView addTableColumn:column];
  }
}
- (void)applyRows:(NSArray<NSDictionary *> *)rows {
  _rows = rows;
  NSMutableDictionary *indexes = [NSMutableDictionary dictionaryWithCapacity:rows.count];
  [rows enumerateObjectsUsingBlock:^(NSDictionary *row, NSUInteger index, BOOL *) { indexes[row[@"id"]] = @(index); }];
  _rowIndexes = indexes;
  _applyingSelection = YES;
  [_tableView reloadData];
  _applyingSelection = NO;
}
- (void)applySelection:(NSArray<NSString *> *)ids {
  NSMutableIndexSet *indexes = [NSMutableIndexSet new];
  for (NSString *rowId in ids) if (NSNumber *index = _rowIndexes[rowId]) [indexes addIndex:index.unsignedIntegerValue];
  if ([indexes isEqualToIndexSet:_tableView.selectedRowIndexes]) return;
  _applyingSelection = YES;
  [_tableView selectRowIndexes:indexes byExtendingSelection:NO];
  _applyingSelection = NO;
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps {
  const auto &next = *std::static_pointer_cast<const SparkTableProps>(props);
  const auto &previous = *std::static_pointer_cast<const SparkTableProps>(_props);
  if (next.columnsJson != previous.columnsJson) [self applyColumns:RNSparkTableJSON(next.columnsJson, NSArray.class) ?: @[]];
  if (next.rowsJson != previous.rowsJson || next.columnsJson != previous.columnsJson) [self applyRows:RNSparkTableJSON(next.rowsJson, NSArray.class) ?: @[]];
  _tableView.allowsMultipleSelection = next.allowsMultipleSelection;
  _tableView.usesAlternatingRowBackgroundColors = next.alternatingRows;
  _tableView.gridStyleMask = next.alternatingRows ? NSTableViewGridNone : NSTableViewSolidVerticalGridLineMask;
  _tableView.headerView = next.headerVisible ? (_tableView.headerView ?: [NSTableHeaderView new]) : nil;
  if (next.rowHeight > 0) { _tableView.rowSizeStyle = NSTableViewRowSizeStyleCustom; _tableView.rowHeight = next.rowHeight; }
  else _tableView.rowSizeStyle = NSTableViewRowSizeStyleDefault;
  _tableView.accessibilityLabel = next.accessibilityLabel.empty() ? nil : [NSString stringWithUTF8String:next.accessibilityLabel.c_str()];
  [super updateProps:props oldProps:oldProps];
  // Applied last, after rows reload: the parent's selection wins, and a revision snaps back a rejected click.
  [self applySelection:RNSparkTableJSON(next.selectedIdsJson, NSArray.class) ?: @[]];
}
- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics {
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  _tableView.userInterfaceLayoutDirection = RNSparkLayoutDirection(layoutMetrics);
  [self layoutSubviews];
}

- (NSInteger)numberOfRowsInTableView:(NSTableView *)tableView { return (NSInteger)_rows.count; }
- (NSView *)tableView:(NSTableView *)tableView viewForTableColumn:(NSTableColumn *)tableColumn row:(NSInteger)row {
  NSTableCellView *cell = [tableView makeViewWithIdentifier:RNSparkTableCellIdentifier owner:self];
  if (!cell) {
    cell = [NSTableCellView new];
    cell.identifier = RNSparkTableCellIdentifier;
    NSTextField *field = [NSTextField labelWithString:@""];
    field.lineBreakMode = NSLineBreakByTruncatingTail;
    field.translatesAutoresizingMaskIntoConstraints = NO;
    [field setContentCompressionResistancePriority:NSLayoutPriorityDefaultLow forOrientation:NSLayoutConstraintOrientationHorizontal];
    [cell addSubview:field];
    cell.textField = field;
    [NSLayoutConstraint activateConstraints:@[
      [field.leadingAnchor constraintEqualToAnchor:cell.leadingAnchor constant:2],
      [field.trailingAnchor constraintEqualToAnchor:cell.trailingAnchor constant:-2],
      [field.centerYAnchor constraintEqualToAnchor:cell.centerYAnchor],
    ]];
  }
  NSDictionary *column = nil;
  for (NSDictionary *candidate in _columns) if ([candidate[@"id"] isEqual:tableColumn.identifier]) { column = candidate; break; }
  NSDictionary *values = row >= 0 && row < (NSInteger)_rows.count ? _rows[row][@"values"] : nil;
  id value = [values isKindOfClass:NSDictionary.class] ? values[tableColumn.identifier] : nil;
  cell.textField.stringValue = [value isKindOfClass:NSString.class] ? value : @"";
  NSString *alignment = column[@"alignment"];
  cell.textField.alignment = [alignment isEqual:@"trailing"] ? NSTextAlignmentRight : [alignment isEqual:@"center"] ? NSTextAlignmentCenter : NSTextAlignmentNatural;
  cell.textField.font = [column[@"monospacedDigits"] boolValue] ? [NSFont monospacedDigitSystemFontOfSize:NSFont.systemFontSize weight:NSFontWeightRegular] : [NSFont systemFontOfSize:NSFont.systemFontSize];
  cell.textField.textColor = [column[@"secondary"] boolValue] ? NSColor.secondaryLabelColor : NSColor.labelColor;
  return cell;
}
- (void)tableViewSelectionDidChange:(NSNotification *)notification {
  if (_applyingSelection) return;
  NSMutableArray<NSString *> *ids = [NSMutableArray new];
  [_tableView.selectedRowIndexes enumerateIndexesUsingBlock:^(NSUInteger index, BOOL *) { if (index < self->_rows.count) [ids addObject:self->_rows[index][@"id"]]; }];
  NSInteger focused = _tableView.selectedRow;
  NSString *rowId = focused >= 0 && focused < (NSInteger)_rows.count ? _rows[focused][@"id"] : @"";
  NSData *data = [NSJSONSerialization dataWithJSONObject:ids options:0 error:nil];
  const auto emitter = std::static_pointer_cast<const SparkTableEventEmitter>(_eventEmitter);
  if (emitter) emitter->onTableSelectionChange({ .id = rowId.UTF8String, .idsJson = std::string((const char *)data.bytes, data.length) });
}
- (void)rowDoubleClicked:(id)sender {
  NSInteger row = _tableView.clickedRow;
  if (row < 0 || row >= (NSInteger)_rows.count) return;
  const auto emitter = std::static_pointer_cast<const SparkTableEventEmitter>(_eventEmitter);
  if (emitter) emitter->onTableDoubleClick({ .id = [_rows[row][@"id"] UTF8String] });
}
- (void)prepareForRecycle {
  [super prepareForRecycle];
  _props = std::make_shared<const SparkTableProps>();
  [self applyColumns:@[]];
  [self applyRows:@[]];
  [_tableView scrollPoint:NSZeroPoint];
}
+ (ComponentDescriptorProvider)componentDescriptorProvider { return concreteComponentDescriptorProvider<SparkTableComponentDescriptor>(); }
@end
