#import "RNSidebar.h"
#import "RNSparkLayoutDirection.h"

#import <react/renderer/components/RNSparkUISpec/ComponentDescriptors.h>
#import <react/renderer/components/RNSparkUISpec/EventEmitters.h>
#import <react/renderer/components/RNSparkUISpec/Props.h>
#import <react/renderer/components/RNSparkUISpec/RCTComponentViewHelpers.h>

using namespace facebook::react;

#if TARGET_OS_OSX
static NSUserInterfaceItemIdentifier const RNSidebarColumnIdentifier = @"RNSidebarColumn";
static NSUserInterfaceItemIdentifier const RNSidebarDataCellIdentifier = @"RNSidebarDataCell";
// Rows inset their title and count by this much from both cell edges; the count keeps this gap from the title.
static CGFloat const RNSidebarCellInset = 12;
static CGFloat const RNSidebarCountGap = 6;

@class RNSidebar;
@class RNSidebarItem;

// One row of the outline: a data item or a React row, linked to its parent by ID.
@interface RNSidebarNode : NSObject
@property (nonatomic, copy) NSString *itemId;
@property (nonatomic, copy) NSString *title;
@property (nonatomic, copy) NSString *parentId;
@property (nonatomic, assign) BOOL selectable;
@property (nonatomic, assign) BOOL group;
@property (nonatomic, assign) NSInteger count;
@property (nonatomic, strong) NSMutableArray<RNSidebarNode *> *children;
@property (nonatomic, weak) RNSidebarItem *view;
@end

@implementation RNSidebarNode
- (instancetype)init
{
  if (self = [super init]) {
    _itemId = @"";
    _title = @"";
    _parentId = @"";
    _selectable = YES;
    _count = -1;
    _children = [NSMutableArray new];
  }
  return self;
}
@end

static NSTextField *RNSidebarCountField(void)
{
  NSTextField *field = [NSTextField labelWithString:@""];
  field.font = [NSFont monospacedDigitSystemFontOfSize:13 weight:NSFontWeightRegular];
  field.textColor = NSColor.secondaryLabelColor;
  field.hidden = YES;
  return field;
}

static void RNSidebarSetCount(NSTextField *field, NSInteger count)
{
  field.hidden = count < 0;
  field.stringValue = count < 0 ? @"" : [NSNumberFormatter localizedStringFromNumber:@(count) numberStyle:NSNumberFormatterDecimalStyle];
}

// The width a visible count takes from the trailing end of a row, including the inset and gap.
static CGFloat RNSidebarCountReserve(NSTextField *field)
{
  return field.hidden ? 0 : ceil(field.intrinsicContentSize.width) + RNSidebarCellInset + RNSidebarCountGap;
}

// Places a visible count at the trailing edge, vertically centered.
static void RNSidebarLayoutCount(NSView *cell, NSTextField *field)
{
  if (field.hidden) return;
  NSSize size = field.intrinsicContentSize;
  CGFloat width = ceil(size.width);
  BOOL rightToLeft = cell.userInterfaceLayoutDirection == NSUserInterfaceLayoutDirectionRightToLeft;
  CGFloat x = rightToLeft ? RNSidebarCellInset : NSWidth(cell.bounds) - RNSidebarCellInset - width;
  field.frame = NSMakeRect(x, round((NSHeight(cell.bounds) - size.height) / 2), width, size.height);
}

// A data row's title and optional count, inset at both ends and centered vertically, aligned to the row's
// layout direction.
@interface RNSidebarDataCell : NSTableCellView
@property (nonatomic, strong) NSTextField *countField;
@end

@implementation RNSidebarDataCell
- (void)layoutTitle
{
  NSTextField *title = self.textField;
  CGFloat height = title.intrinsicContentSize.height;
  BOOL rightToLeft = self.userInterfaceLayoutDirection == NSUserInterfaceLayoutDirectionRightToLeft;
  CGFloat reserve = MAX(RNSidebarCellInset, RNSidebarCountReserve(_countField));
  title.alignment = RNSparkLeadingTextAlignment(self.userInterfaceLayoutDirection);
  title.frame = NSMakeRect(rightToLeft ? reserve : RNSidebarCellInset, round((NSHeight(self.bounds) - height) / 2),
                           MAX(0, NSWidth(self.bounds) - RNSidebarCellInset - reserve), height);
  RNSidebarLayoutCount(self, _countField);
}

- (void)resizeSubviewsWithOldSize:(NSSize)oldSize
{
  [self layoutTitle];
}
@end

@interface RNSidebarRowView : NSTableRowView
@property (nonatomic, assign) BOOL contextHighlighted;
@end

@implementation RNSidebarRowView
- (void)setContextHighlighted:(BOOL)contextHighlighted
{
  _contextHighlighted = contextHighlighted;
  self.needsDisplay = YES;
}

- (void)drawRect:(NSRect)dirtyRect
{
  [super drawRect:dirtyRect];

  if (!_contextHighlighted) {
    return;
  }

  NSRect borderRect = NSInsetRect(self.bounds, 8, 1);
  NSBezierPath *path = [NSBezierPath bezierPathWithRoundedRect:borderRect xRadius:6 yRadius:6];
  [[NSColor.controlAccentColor colorWithAlphaComponent:0.8] setStroke];
  path.lineWidth = 2;
  [path stroke];
}
@end

@interface RNSidebarTableView : NSOutlineView
@property (nonatomic, assign) BOOL rightMouseDown;
@end

@implementation RNSidebarTableView
- (BOOL)validateProposedFirstResponder:(NSResponder *)responder forEvent:(NSEvent *)event
{
  return YES;
}

- (void)rightMouseDown:(NSEvent *)event
{
  _rightMouseDown = YES;
  [self.window makeFirstResponder:self];
  [super rightMouseDown:event];
}

- (void)rightMouseUp:(NSEvent *)event
{
  [super rightMouseUp:event];
  _rightMouseDown = NO;
}
@end

@interface RNSidebarItem () <RCTSidebarItemViewProtocol>
@property (nonatomic, copy) NSString *itemId;
@property (nonatomic, copy) NSString *parentId;
@property (nonatomic, assign) BOOL selectable;
@property (nonatomic, assign) BOOL group;
@property (nonatomic, assign) NSInteger count;
@property (nonatomic, assign) CGFloat rowHeight;
@property (nonatomic, assign) BOOL autoHeight;
@property (nonatomic, assign) CGFloat measuredHeight;
@property (nonatomic, assign) CGFloat reportedWidth;
@property (nonatomic, weak) RNSidebar *sidebar;
- (void)reportContentWidth:(CGFloat)width;
@end

// Hosts a React row beside its optional count. The row takes the cell's width less the count, which
// depends on the outline level, so it is reported to the row for Yoga to apply.
@interface RNSidebarReactCell : NSTableCellView
@property (nonatomic, strong) RNSidebarItem *item;
@property (nonatomic, strong) NSTextField *countField;
- (void)layoutItem;
@end

@implementation RNSidebarReactCell
- (instancetype)initWithItem:(RNSidebarItem *)item
{
  if (self = [super initWithFrame:NSZeroRect]) {
    _item = item;
    _countField = RNSidebarCountField();
    [item removeFromSuperview];
    item.autoresizingMask = NSViewNotSizable;
    [self addSubview:item];
    [self addSubview:_countField];
    RNSidebarSetCount(_countField, item.count);
  }
  return self;
}

- (void)layoutItem
{
  CGFloat reserve = RNSidebarCountReserve(_countField);
  CGFloat width = MAX(0, NSWidth(self.bounds) - reserve);
  BOOL rightToLeft = self.userInterfaceLayoutDirection == NSUserInterfaceLayoutDirectionRightToLeft;
  _item.frame = NSMakeRect(rightToLeft ? reserve : 0, 0, width, NSHeight(self.bounds));
  RNSidebarLayoutCount(self, _countField);
  if (NSWidth(self.bounds) > 0) [_item reportContentWidth:width];
}

- (void)resizeSubviewsWithOldSize:(NSSize)oldSize
{
  [self layoutItem];
}
@end

@interface RNSidebar () <NSOutlineViewDataSource, NSOutlineViewDelegate, RCTSidebarViewProtocol>
- (void)sidebarItemDidChange:(RNSidebarItem *)item;
- (void)setContextHighlightedItem:(nullable RNSidebarItem *)item;
@end

#else
@interface RNSidebar () <RCTSidebarViewProtocol>
@end

@interface RNSidebarItem () <RCTSidebarItemViewProtocol>
@end
#endif

@implementation RNSidebarItem

- (instancetype)init
{
  if (self = [super init]) {
    _props = std::make_shared<const SidebarItemProps>();
#if TARGET_OS_OSX
    _itemId = @"";
    _parentId = @"";
    _selectable = YES;
    _count = -1;
    _rowHeight = 0;
    _autoHeight = NO;
    _measuredHeight = 0;
    self.wantsLayer = YES;
#endif
  }
  return self;
}

#if TARGET_OS_OSX
- (BOOL)isFlipped
{
  return YES;
}

- (void)reportContentWidth:(CGFloat)width
{
  const auto eventEmitter = std::static_pointer_cast<const SidebarItemEventEmitter>(_eventEmitter);
  if (!eventEmitter || width <= 0 || width == _reportedWidth) {
    return;
  }

  _reportedWidth = width;
  eventEmitter->onSidebarItemLayout(SidebarItemEventEmitter::OnSidebarItemLayout{.width = width});
}

- (void)rightMouseDown:(NSEvent *)event
{
  [_sidebar setContextHighlightedItem:_selectable && !_group ? self : nil];
  [super rightMouseDown:event];
}

- (void)rightMouseUp:(NSEvent *)event
{
  const auto eventEmitter = std::static_pointer_cast<const SidebarItemEventEmitter>(_eventEmitter);
  if (eventEmitter) {
    NSPoint locationInWindow = event.locationInWindow;
    NSPoint locationInView = [self convertPoint:locationInWindow fromView:nil];
    CGFloat contentViewHeight = self.window.contentView.bounds.size.height;
    CGFloat pageY = contentViewHeight > 0 ? contentViewHeight - locationInWindow.y : locationInWindow.y;
    NSEventModifierFlags modifierFlags = event.modifierFlags;

    eventEmitter->onRightClick(SidebarItemEventEmitter::OnRightClick{
      .altKey = (modifierFlags & NSEventModifierFlagOption) != 0,
      .button = 2,
      .ctrlKey = (modifierFlags & NSEventModifierFlagControl) != 0,
      .metaKey = (modifierFlags & NSEventModifierFlagCommand) != 0,
      .pageX = locationInWindow.x,
      .pageY = pageY,
      .shiftKey = (modifierFlags & NSEventModifierFlagShift) != 0,
      .x = locationInView.x,
      .y = locationInView.y,
    });
  }

  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.1 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [self.sidebar setContextHighlightedItem:nil];
  });

  [super rightMouseUp:event];
}
#endif

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &newProps = *std::static_pointer_cast<SidebarItemProps const>(props);

#if TARGET_OS_OSX
  NSString *itemId = [NSString stringWithUTF8String:newProps.itemId.c_str()];
  NSString *parentId = [NSString stringWithUTF8String:newProps.parentId.c_str()];
  // Style changes (such as the reported width) leave the outline alone; only row properties reload it.
  const BOOL rowChanged = ![itemId isEqualToString:_itemId] || ![parentId isEqualToString:_parentId] || newProps.selectable != _selectable ||
    newProps.group != _group || newProps.count != _count || newProps.rowHeight != _rowHeight || newProps.autoHeight != _autoHeight;
  _itemId = itemId;
  _parentId = parentId;
  _selectable = newProps.selectable;
  _group = newProps.group;
  _count = newProps.count;
  _rowHeight = newProps.rowHeight;
  _autoHeight = newProps.autoHeight;
  if (rowChanged) [_sidebar sidebarItemDidChange:self];
#endif

  [super updateProps:props oldProps:oldProps];
}

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics
           oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];

#if TARGET_OS_OSX
  CGFloat height = layoutMetrics.frame.size.height;
  if (height > 0 && fabs(height - _measuredHeight) > 0.5) {
    _measuredHeight = height;
    if (_autoHeight) {
      [_sidebar sidebarItemDidChange:self];
    }
  }

  if (_sidebar && [self.superview isKindOfClass:RNSidebarReactCell.class]) {
    [(RNSidebarReactCell *)self.superview layoutItem];
  }
#endif
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];

#if TARGET_OS_OSX
  _itemId = @"";
  _parentId = @"";
  _selectable = YES;
  _group = NO;
  _count = -1;
  _rowHeight = 0;
  _autoHeight = NO;
  _measuredHeight = 0;
  _reportedWidth = 0;
  _sidebar = nil;
#endif
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<SidebarItemComponentDescriptor>();
}

@end

@implementation RNSidebar {
#if TARGET_OS_OSX
  NSScrollView *_scrollView;
  RNSidebarTableView *_tableView;
  NSTableColumn *_tableColumn;
  NSMutableArray<RNSidebarItem *> *_itemViews;
  NSArray<RNSidebarNode *> *_dataItems;
  NSArray<RNSidebarNode *> *_roots;
  NSArray<NSString *> *_selectedIds;
  NSMutableSet<NSString *> *_collapsedIds;
  NSString *_appliedCollapsedIdsJson;
  NSArray<NSString *> *_scrolledSelectedIds;
  NSDictionary<NSString *, RNSidebarNode *> *_nodesById;
  CGFloat _contentInsetTop;
  CGFloat _defaultRowHeight;
  NSSize _lastReportedSize;
  RNSidebarItem *_contextHighlightedItem;
  CGFloat _lastReportedRowWidth;
  BOOL _updatingSelection;
  BOOL _applyingExpansion;
  BOOL _rightToLeft;
#else
  RCTPlatformView *_placeholderView;
#endif
}

- (instancetype)init
{
  if (self = [super init]) {
    _props = std::make_shared<const SidebarProps>();

#if TARGET_OS_OSX
    _itemViews = [NSMutableArray new];
    _dataItems = @[];
    _roots = @[];
    _selectedIds = @[];
    _collapsedIds = [NSMutableSet new];
    _contentInsetTop = 0;
    _defaultRowHeight = 28;
    _lastReportedSize = NSZeroSize;
    _lastReportedRowWidth = 0;
    _rightToLeft = NO;
    self.wantsLayer = YES;
    [self setupSidebar];
#else
    _placeholderView = [RCTPlatformView new];
    self.contentView = _placeholderView;
#endif
  }
  return self;
}

#if TARGET_OS_OSX
- (BOOL)isFlipped
{
  return YES;
}

- (void)setupSidebar
{
  _tableView = [RNSidebarTableView new];
  _tableView.allowsEmptySelection = YES;
  _tableView.allowsMultipleSelection = NO;
  _tableView.backgroundColor = NSColor.clearColor;
  _tableView.columnAutoresizingStyle = NSTableViewUniformColumnAutoresizingStyle;
  _tableView.dataSource = self;
  _tableView.delegate = self;
  _tableView.focusRingType = NSFocusRingTypeNone;
  _tableView.gridStyleMask = NSTableViewGridNone;
  _tableView.headerView = nil;
  _tableView.intercellSpacing = NSMakeSize(0, 0);
  _tableView.rowHeight = _defaultRowHeight;
  _tableView.usesAlternatingRowBackgroundColors = NO;
  _tableView.floatsGroupRows = NO;
  _tableView.autoresizesOutlineColumn = NO;
  _tableView.target = self;
  _tableView.doubleAction = @selector(rowDoubleClicked:);

  _tableView.style = NSTableViewStyleSourceList;
  // Follows the React layout direction (updateLayoutMetrics), not the application's.
  _tableView.userInterfaceLayoutDirection = NSUserInterfaceLayoutDirectionLeftToRight;

  _tableColumn = [[NSTableColumn alloc] initWithIdentifier:RNSidebarColumnIdentifier];
  _tableColumn.resizingMask = NSTableColumnAutoresizingMask;
  [_tableView addTableColumn:_tableColumn];
  _tableView.outlineTableColumn = _tableColumn;

  _scrollView = [NSScrollView new];
  _scrollView.autohidesScrollers = YES;
  _scrollView.backgroundColor = NSColor.clearColor;
  _scrollView.borderType = NSNoBorder;
  _scrollView.documentView = _tableView;
  _scrollView.drawsBackground = NO;
  _scrollView.hasHorizontalScroller = NO;
  _scrollView.hasVerticalScroller = YES;

  [self addSubview:_scrollView];
}

static NSArray<NSString *> *RNSidebarStringsFromJson(std::string const &json)
{
  NSString *jsonString = [NSString stringWithUTF8String:json.c_str()];
  if (jsonString.length == 0) return @[];
  id parsed = [NSJSONSerialization JSONObjectWithData:[jsonString dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
  if (![parsed isKindOfClass:NSArray.class]) return @[];
  NSMutableArray<NSString *> *strings = [NSMutableArray new];
  for (id value in (NSArray *)parsed) if ([value isKindOfClass:NSString.class]) [strings addObject:value];
  return strings;
}

static std::string RNSidebarJsonFromStrings(NSArray<NSString *> *strings)
{
  NSData *data = [NSJSONSerialization dataWithJSONObject:strings options:NSJSONWritingWithoutEscapingSlashes error:nil];
  return data ? std::string((const char *)data.bytes, data.length) : "[]";
}

- (NSArray<RNSidebarNode *> *)itemsFromJson:(std::string const &)json
{
  NSString *jsonString = [NSString stringWithUTF8String:json.c_str()];
  if (jsonString.length == 0) {
    return @[];
  }

  NSData *data = [jsonString dataUsingEncoding:NSUTF8StringEncoding];
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![parsed isKindOfClass:NSArray.class]) {
    return @[];
  }

  NSMutableArray<RNSidebarNode *> *items = [NSMutableArray new];
  for (id rawItem in (NSArray *)parsed) {
    if (![rawItem isKindOfClass:NSDictionary.class]) {
      continue;
    }

    NSDictionary *dictionary = (NSDictionary *)rawItem;
    NSString *itemId = [dictionary[@"id"] isKindOfClass:NSString.class] ? dictionary[@"id"] : nil;
    NSString *title = [dictionary[@"title"] isKindOfClass:NSString.class] ? dictionary[@"title"] : nil;
    if (itemId.length == 0 || title.length == 0) {
      continue;
    }

    RNSidebarNode *item = [RNSidebarNode new];
    item.itemId = itemId;
    item.title = title;
    item.selectable = ![dictionary[@"selectable"] isKindOfClass:NSNumber.class] || [dictionary[@"selectable"] boolValue];
    item.group = [dictionary[@"group"] isKindOfClass:NSNumber.class] && [dictionary[@"group"] boolValue];
    item.count = [dictionary[@"count"] isKindOfClass:NSNumber.class] ? MAX(-1, [dictionary[@"count"] integerValue]) : -1;
    item.parentId = [dictionary[@"parentId"] isKindOfClass:NSString.class] ? dictionary[@"parentId"] : @"";
    [items addObject:item];
  }

  return items;
}

- (BOOL)usesReactChildren
{
  return _itemViews.count > 0;
}

// Links rows to their parents by ID, in row order. A row whose parent is unknown is a root.
- (NSArray<RNSidebarNode *> *)buildRoots
{
  NSMutableArray<RNSidebarNode *> *nodes = [NSMutableArray new];
  if (self.usesReactChildren) {
    for (RNSidebarItem *view in _itemViews) {
      RNSidebarNode *node = [RNSidebarNode new];
      node.itemId = view.itemId;
      node.parentId = view.parentId;
      node.selectable = view.selectable;
      node.group = view.group;
      node.count = view.count;
      node.view = view;
      [nodes addObject:node];
    }
  } else {
    for (RNSidebarNode *node in _dataItems) [node.children removeAllObjects];
    [nodes addObjectsFromArray:_dataItems];
  }

  NSMutableDictionary<NSString *, RNSidebarNode *> *byId = [NSMutableDictionary new];
  NSMutableArray<RNSidebarNode *> *roots = [NSMutableArray new];
  for (RNSidebarNode *node in nodes) {
    RNSidebarNode *parent = node.parentId.length > 0 ? byId[node.parentId] : nil;
    if (parent) [parent.children addObject:node];
    else [roots addObject:node];
    byId[node.itemId] = node;
  }
  _nodesById = byId;
  return roots;
}

- (NSString *)itemIdAtRow:(NSInteger)row
{
  RNSidebarNode *node = [_tableView itemAtRow:row];
  return node ? node.itemId : @"";
}

- (BOOL)isRowSelectable:(NSInteger)row
{
  RNSidebarNode *node = [_tableView itemAtRow:row];
  return node && node.selectable && !node.group;
}

- (void)reloadRows
{
  _roots = [self buildRoots];
  _tableView.rowHeight = _defaultRowHeight;
  [_tableView reloadData];
  [self applyExpansion];
  [self updateSelection];
  [self setNeedsLayout:YES];
}

// Rows are rebuilt on every reload, so expansion is kept by ID and reapplied, outermost first.
- (void)applyExpansion
{
  _applyingExpansion = YES;
  NSMutableArray<RNSidebarNode *> *pending = [_roots mutableCopy];
  while (pending.count > 0) {
    RNSidebarNode *node = pending.firstObject;
    [pending removeObjectAtIndex:0];
    if (node.children.count == 0) continue;
    if ([_collapsedIds containsObject:node.itemId]) {
      [_tableView collapseItem:node];
    } else {
      [_tableView expandItem:node];
      [pending addObjectsFromArray:node.children];
    }
  }
  _applyingExpansion = NO;
}

- (void)sidebarItemDidChange:(RNSidebarItem *)item
{
  if (![_itemViews containsObject:item]) {
    return;
  }

  [self reloadRows];
}

- (NSInteger)rowForItemView:(RNSidebarItem *)item
{
  for (NSInteger row = 0; row < _tableView.numberOfRows; row++) {
    if (((RNSidebarNode *)[_tableView itemAtRow:row]).view == item) return row;
  }
  return -1;
}

- (void)setContextHighlightedItem:(RNSidebarItem *)item
{
  RNSidebarItem *previous = _contextHighlightedItem;
  _contextHighlightedItem = item;

  for (RNSidebarItem *view in @[ previous ?: NSNull.null, item ?: NSNull.null ]) {
    if (![view isKindOfClass:RNSidebarItem.class]) continue;
    NSInteger row = [self rowForItemView:view];
    RNSidebarRowView *rowView = row < 0 ? nil : (RNSidebarRowView *)[_tableView rowViewAtRow:row makeIfNecessary:NO];
    if ([rowView isKindOfClass:RNSidebarRowView.class]) rowView.contextHighlighted = view == item;
  }
}

- (void)updateSelection
{
  if (_updatingSelection) {
    return;
  }

  NSMutableIndexSet *rows = [NSMutableIndexSet new];
  NSInteger lastRow = -1;
  for (NSString *selectedId in _selectedIds) {
    for (NSInteger row = 0; row < _tableView.numberOfRows; row++) {
      if ([[self itemIdAtRow:row] isEqualToString:selectedId]) {
        [rows addIndex:(NSUInteger)row];
        lastRow = row;
        break;
      }
    }
    if (!_tableView.allowsMultipleSelection) break;
  }

  _updatingSelection = YES;
  if (rows.count > 0) {
    [_tableView selectRowIndexes:rows byExtendingSelection:NO];
    // Reloads reapply an unchanged selection; only a new one scrolls into view.
    if (![_selectedIds isEqualToArray:_scrolledSelectedIds]) [_tableView scrollRowToVisible:lastRow];
  } else {
    [_tableView deselectAll:nil];
  }
  _updatingSelection = NO;
  _scrolledSelectedIds = _selectedIds;
}

- (void)reportLayoutIfNeeded
{
  if (self.bounds.size.width <= 0 || self.bounds.size.height <= 0) {
    return;
  }

  if (NSEqualSizes(_lastReportedSize, self.bounds.size)) {
    return;
  }

  _lastReportedSize = self.bounds.size;
  const auto eventEmitter = std::static_pointer_cast<const SidebarEventEmitter>(_eventEmitter);
  if (eventEmitter) {
    eventEmitter->onSidebarLayout(SidebarEventEmitter::OnSidebarLayout{
      .height = self.bounds.size.height,
      .width = self.bounds.size.width,
    });
  }
}

// React rows are laid out by Yoga, so their width is reported for the Sidebar to apply: the column the
// source-list table fits inside its clip view, which excludes the row insets and a legacy scroller.
// Rows that are indented or show a count report their own, narrower width (RNSidebarReactCell).
- (void)reportRowWidthIfNeeded
{
  CGFloat width = _tableColumn.width;
  const auto eventEmitter = std::static_pointer_cast<const SidebarEventEmitter>(_eventEmitter);
  if (!eventEmitter || width <= 0 || width == _lastReportedRowWidth) {
    return;
  }

  _lastReportedRowWidth = width;
  eventEmitter->onSidebarRowLayout(SidebarEventEmitter::OnSidebarRowLayout{.width = width});
}

- (void)outlineViewColumnDidResize:(NSNotification *)notification
{
  [self reportRowWidthIfNeeded];
}

- (void)mountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)childComponentView
                          index:(NSInteger)index
{
  if ([childComponentView isKindOfClass:RNSidebarItem.class]) {
    RNSidebarItem *item = (RNSidebarItem *)childComponentView;
    item.sidebar = self;
    NSUInteger safeIndex = MIN((NSUInteger)MAX(index, 0), _itemViews.count);
    [_itemViews insertObject:item atIndex:safeIndex];
    [self reloadRows];
    return;
  }

  [super mountChildComponentView:childComponentView index:index];
}

- (void)unmountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)childComponentView
                            index:(NSInteger)index
{
  if ([childComponentView isKindOfClass:RNSidebarItem.class]) {
    RNSidebarItem *item = (RNSidebarItem *)childComponentView;
    [item removeFromSuperview];
    item.sidebar = nil;
    if (_contextHighlightedItem == item) _contextHighlightedItem = nil;
    [_itemViews removeObject:item];
    [self reloadRows];
    return;
  }

  [super unmountChildComponentView:childComponentView index:index];
}

- (NSInteger)outlineView:(NSOutlineView *)outlineView numberOfChildrenOfItem:(id)item
{
  return (NSInteger)(item ? ((RNSidebarNode *)item).children.count : _roots.count);
}

- (id)outlineView:(NSOutlineView *)outlineView child:(NSInteger)index ofItem:(id)item
{
  return item ? ((RNSidebarNode *)item).children[index] : _roots[index];
}

- (BOOL)outlineView:(NSOutlineView *)outlineView isItemExpandable:(id)item
{
  return ((RNSidebarNode *)item).children.count > 0;
}

- (BOOL)outlineView:(NSOutlineView *)outlineView isGroupItem:(id)item
{
  return ((RNSidebarNode *)item).group;
}

- (CGFloat)outlineView:(NSOutlineView *)outlineView heightOfRowByItem:(id)item
{
  RNSidebarItem *view = ((RNSidebarNode *)item).view;
  if (!view) {
    return _defaultRowHeight;
  }

  if (view.rowHeight > 0) {
    return view.rowHeight;
  }

  if (view.autoHeight) {
    if (view.measuredHeight > 0) {
      return view.measuredHeight;
    }

    if (view.frame.size.height > 0) {
      return view.frame.size.height;
    }
  }

  return _defaultRowHeight;
}

- (NSView *)outlineView:(NSOutlineView *)outlineView viewForTableColumn:(NSTableColumn *)tableColumn item:(id)item
{
  RNSidebarNode *node = item;
  if (node.view) {
    RNSidebarReactCell *cell = [[RNSidebarReactCell alloc] initWithItem:node.view];
    cell.userInterfaceLayoutDirection = _tableView.userInterfaceLayoutDirection;
    return cell;
  }

  RNSidebarDataCell *cell = [outlineView makeViewWithIdentifier:RNSidebarDataCellIdentifier owner:self];
  if (!cell) {
    cell = [RNSidebarDataCell new];
    cell.identifier = RNSidebarDataCellIdentifier;

    NSTextField *textField = [NSTextField labelWithString:@""];
    textField.lineBreakMode = NSLineBreakByTruncatingTail;

    cell.textField = textField;
    cell.countField = RNSidebarCountField();
    [cell addSubview:textField];
    [cell addSubview:cell.countField];
  }

  // Group rows use the source list's section-header type: 11 pt semibold, secondary label color.
  cell.textField.font = node.group ? [NSFont systemFontOfSize:11 weight:NSFontWeightSemibold] : [NSFont systemFontOfSize:13 weight:NSFontWeightRegular];
  cell.textField.textColor = node.group ? NSColor.secondaryLabelColor : NSColor.labelColor;
  cell.userInterfaceLayoutDirection = _tableView.userInterfaceLayoutDirection;
  cell.textField.stringValue = node.title;
  RNSidebarSetCount(cell.countField, node.count);
  [cell layoutTitle];
  return cell;
}

- (BOOL)outlineView:(NSOutlineView *)outlineView shouldSelectItem:(id)item
{
  if (_tableView.rightMouseDown) {
    return NO;
  }

  RNSidebarNode *node = item;
  return node.selectable && !node.group;
}

- (NSTableRowView *)outlineView:(NSOutlineView *)outlineView rowViewForItem:(id)item
{
  RNSidebarRowView *rowView = [RNSidebarRowView new];
  RNSidebarItem *view = ((RNSidebarNode *)item).view;
  rowView.contextHighlighted = view && view == _contextHighlightedItem;
  return rowView;
}

- (void)outlineViewSelectionDidChange:(NSNotification *)notification
{
  if (_updatingSelection) {
    return;
  }

  NSMutableArray<NSString *> *visible = [NSMutableArray new];
  [_tableView.selectedRowIndexes enumerateIndexesUsingBlock:^(NSUInteger row, BOOL *stop) {
    [visible addObject:[self itemIdAtRow:(NSInteger)row]];
  }];
  NSMutableArray<NSString *> *hidden = [NSMutableArray new], *shown = [NSMutableArray new];
  for (NSString *selectedId in _selectedIds) {
    RNSidebarNode *node = _nodesById[selectedId];
    [(node && [_tableView rowForItem:node] < 0 ? hidden : shown) addObject:selectedId];
  }
  // A collapsing section deselects the rows it hides; the selection itself is unchanged and returns on expand.
  if ([[NSSet setWithArray:visible] isEqualToSet:[NSSet setWithArray:shown]]) {
    return;
  }

  // In multiple selection, rows inside collapsed sections stay selected while the user changes the visible ones.
  NSMutableArray<NSString *> *ids = _tableView.allowsMultipleSelection ? hidden : [NSMutableArray new];
  [ids addObjectsFromArray:visible];
  _selectedIds = ids;
  const auto eventEmitter = std::static_pointer_cast<const SidebarEventEmitter>(_eventEmitter);
  if (eventEmitter) {
    eventEmitter->onSidebarSelectionChange(SidebarEventEmitter::OnSidebarSelectionChange{
      .id = std::string([self itemIdAtRow:_tableView.selectedRow].UTF8String),
      .idsJson = RNSidebarJsonFromStrings(ids),
    });
  }
}

- (void)expansionDidChange:(NSNotification *)notification expanded:(BOOL)expanded
{
  if (_applyingExpansion) {
    return;
  }

  RNSidebarNode *node = notification.userInfo[@"NSObject"];
  NSString *itemId = node.itemId;
  // AppKit also collapses and restores the rows nested in a section the user toggles; those keep their own
  // state. Only a change of state, on a row whose ancestors are expanded, is the user's.
  if (itemId.length == 0 || expanded != [_collapsedIds containsObject:itemId]) return;
  for (id parent = [_tableView parentForItem:node]; parent; parent = [_tableView parentForItem:parent]) {
    if (![_tableView isItemExpanded:parent]) return;
  }
  if (expanded) [_collapsedIds removeObject:itemId];
  else [_collapsedIds addObject:itemId];
  // Rows inside an expanded section were collapsed with it or never expanded: restore their own state.
  if (expanded) [self applyExpansion];

  const auto eventEmitter = std::static_pointer_cast<const SidebarEventEmitter>(_eventEmitter);
  if (eventEmitter) {
    eventEmitter->onSidebarExpandedChange(SidebarEventEmitter::OnSidebarExpandedChange{
      .expanded = (bool)expanded,
      .id = std::string(itemId.UTF8String),
    });
  }
}

- (void)outlineViewItemDidExpand:(NSNotification *)notification
{
  [self expansionDidChange:notification expanded:YES];
  [self updateSelection];
}

- (void)outlineViewItemDidCollapse:(NSNotification *)notification
{
  [self expansionDidChange:notification expanded:NO];
}

- (void)rowDoubleClicked:(id)sender
{
  NSInteger row = _tableView.clickedRow;
  const auto eventEmitter = std::static_pointer_cast<const SidebarEventEmitter>(_eventEmitter);
  if (row < 0 || !eventEmitter) {
    return;
  }

  eventEmitter->onSidebarDoubleClick(SidebarEventEmitter::OnSidebarDoubleClick{
    .id = std::string([self itemIdAtRow:row].UTF8String),
  });
}
#endif

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &newProps = *std::static_pointer_cast<SidebarProps const>(props);
  // Fabric mounts (Insert mutations) pass a null oldProps, possibly to a view that was configured
  // before a move; with nothing to diff against, apply every prop.
  const auto previous = std::static_pointer_cast<SidebarProps const>(oldProps);

#if TARGET_OS_OSX
  _contentInsetTop = newProps.contentInsetTop;
  _defaultRowHeight = newProps.defaultRowHeight > 0 ? newProps.defaultRowHeight : 28;
  const BOOL itemsChanged = !previous || newProps.itemsJson != previous->itemsJson;
  // Only a change of the collapsed IDs is applied, so an unchanged prop never undoes a user's toggle.
  // Compared with the last applied value rather than oldProps, which is null when a moved view is re-inserted.
  NSString *collapsedIdsJson = [NSString stringWithUTF8String:newProps.collapsedIdsJson.c_str()];
  const BOOL expansionChanged = ![collapsedIdsJson isEqualToString:_appliedCollapsedIdsJson];
  _appliedCollapsedIdsJson = collapsedIdsJson;
  const BOOL rowsChanged = itemsChanged || expansionChanged || newProps.defaultRowHeight != previous->defaultRowHeight;
  if (itemsChanged) _dataItems = [self itemsFromJson:newProps.itemsJson];
  if (expansionChanged) _collapsedIds = [NSMutableSet setWithArray:RNSidebarStringsFromJson(newProps.collapsedIdsJson)];
  _selectedIds = RNSidebarStringsFromJson(newProps.selectedIdsJson);
  _tableView.allowsMultipleSelection = newProps.allowsMultipleSelection;
  _scrollView.contentInsets = NSEdgeInsetsMake(_contentInsetTop, 0, 0, 0);
  if (!previous || newProps.listStyle != previous->listStyle) {
    _tableView.style = newProps.listStyle == SidebarListStyle::Plain ? NSTableViewStylePlain : NSTableViewStyleSourceList;
    [self setNeedsLayout:YES];
  }
  if (rowsChanged) [self reloadRows];
  else if (newProps.selectedIdsJson != previous->selectedIdsJson || newProps.selectionRevision != previous->selectionRevision ||
           newProps.allowsMultipleSelection != previous->allowsMultipleSelection) [self updateSelection];
  if (!previous || newProps.contentInsetTop != previous->contentInsetTop) [self setNeedsLayout:YES];
#endif

  [super updateProps:props oldProps:oldProps];
}

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics
           oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];

#if TARGET_OS_OSX
  // Mirror with the React layout direction, which can differ from the application's. The vertical scroller
  // sits on the trailing edge, which is the left in right-to-left layouts.
  const NSUserInterfaceLayoutDirection direction = RNSparkLayoutDirection(layoutMetrics);
  _scrollView.userInterfaceLayoutDirection = direction;
  const BOOL rightToLeft = direction == NSUserInterfaceLayoutDirectionRightToLeft;
  if (rightToLeft != _rightToLeft) {
    _rightToLeft = rightToLeft;
    _tableView.userInterfaceLayoutDirection = direction;
    [self reloadRows];
  }
#endif

  [self layoutSubviews];
}

- (void)layoutSubviews
{
  [super layoutSubviews];

#if TARGET_OS_OSX
  // The table keeps its column fitted to the clip view; a column as wide as the Sidebar would push the
  // source-list row insets past its trailing edge.
  _scrollView.frame = self.bounds;
  [_scrollView tile];
  [self reportLayoutIfNeeded];
  [self reportRowWidthIfNeeded];
#else
  _placeholderView.frame = self.bounds;
#endif
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];

#if TARGET_OS_OSX
  for (RNSidebarItem *item in _itemViews) {
    [item removeFromSuperview];
    item.sidebar = nil;
  }
  [_itemViews removeAllObjects];
  _dataItems = @[];
  _selectedIds = @[];
  [_collapsedIds removeAllObjects];
  _appliedCollapsedIdsJson = nil;
  _scrolledSelectedIds = nil;
  _contentInsetTop = 0;
  _defaultRowHeight = 28;
  _lastReportedSize = NSZeroSize;
  _lastReportedRowWidth = 0;
  _contextHighlightedItem = nil;
  _updatingSelection = NO;
  _tableView.allowsMultipleSelection = NO;
  _scrollView.contentInsets = NSEdgeInsetsZero;
  [self reloadRows];
#endif
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<SidebarComponentDescriptor>();
}

@end
