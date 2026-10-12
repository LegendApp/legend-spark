#import "RNSparkTabView.h"
#import <react/renderer/components/RNSparkUISpec/ComponentDescriptors.h>
#import <react/renderer/components/RNSparkUISpec/EventEmitters.h>
#import <react/renderer/components/RNSparkUISpec/Props.h>
using namespace facebook::react;

// Fabric frames React children from the top-left, so each tab's content view is flipped.
@interface RNSparkTabContentView : NSView
@end
@implementation RNSparkTabContentView
- (BOOL)isFlipped { return YES; }
@end

@interface RNSparkTabView ()
- (void)tabDidChange:(RNSparkTab *)tab;
@end

@interface RNSparkTab ()
@property (nonatomic, readonly) NSTabViewItem *item;
@property (nonatomic, weak) RNSparkTabView *owner;
@end

@implementation RNSparkTab
- (instancetype)init {
  if (self = [super init]) {
    _props = std::make_shared<const SparkTabProps>();
    _item = [[NSTabViewItem alloc] initWithIdentifier:@""];
    _item.view = [[RNSparkTabContentView alloc] initWithFrame:NSZeroRect];
  }
  return self;
}
- (BOOL)isFlipped { return YES; }
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps {
  const auto &next = *std::static_pointer_cast<SparkTabProps const>(props);
  _item.identifier = [NSString stringWithUTF8String:next.tabId.c_str()];
  _item.label = [NSString stringWithUTF8String:next.label.c_str()];
  [super updateProps:props oldProps:oldProps];
  [_owner tabDidChange:self];
}
- (void)prepareForRecycle {
  [super prepareForRecycle];
  _owner = nil;
  _item.identifier = @"";
  _item.label = @"";
}
+ (ComponentDescriptorProvider)componentDescriptorProvider { return concreteComponentDescriptorProvider<SparkTabComponentDescriptor>(); }
@end

@implementation RNSparkTabView {
  NSTabView *_tabView;
  NSMutableArray<RNSparkTab *> *_tabs;
  NSString *_selectedId, *_tabPosition, *_tabBorder;
  // Events this view has emitted, and the latest count JS has echoed back through props.
  int _eventCount, _acknowledged;
  BOOL _rtl, _updating;
  NSSize _reportedContentSize;
}
- (instancetype)init {
  if (self = [super init]) {
    _props = std::make_shared<const SparkTabViewProps>();
    _tabs = [NSMutableArray new];
    _selectedId = @""; _tabPosition = @"top"; _tabBorder = @"bezel";
    _reportedContentSize = NSMakeSize(-1, -1);
    _tabView = [[NSTabView alloc] initWithFrame:NSZeroRect];
    _tabView.delegate = self;
    [self addSubview:_tabView];
  }
  return self;
}
- (BOOL)isFlipped { return YES; }

#pragma mark Tabs

- (void)mountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)child index:(NSInteger)index {
  if (![child isKindOfClass:RNSparkTab.class]) { [super mountChildComponentView:child index:index]; return; }
  RNSparkTab *tab = (RNSparkTab *)child;
  tab.owner = self;
  [tab.item.view addSubview:tab];
  [_tabs insertObject:tab atIndex:MIN((NSUInteger)MAX(index, 0), _tabs.count)];
  [self rebuildItems];
}
- (void)unmountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)child index:(NSInteger)index {
  if (![child isKindOfClass:RNSparkTab.class]) { [super unmountChildComponentView:child index:index]; return; }
  RNSparkTab *tab = (RNSparkTab *)child;
  tab.owner = nil;
  [tab removeFromSuperview];
  [_tabs removeObject:tab];
  [self rebuildItems];
}
- (void)tabDidChange:(RNSparkTab *)tab {
  if ([_tabs containsObject:tab]) [self applySelection];
}
// AppKit orders a tab row by the app's direction, not the view's; reversing the row when React's
// direction differs keeps the first tab on the leading edge. Side tabs always run top to bottom.
- (BOOL)mirrorsTabRow {
  BOOL row = [_tabPosition isEqual:@"top"] || [_tabPosition isEqual:@"bottom"];
  return row && _rtl != (NSApp.userInterfaceLayoutDirection == NSUserInterfaceLayoutDirectionRightToLeft);
}
- (void)rebuildItems {
  _updating = YES;
  NSArray<NSTabViewItem *> *items = [_tabs valueForKey:@"item"];
  if (self.mirrorsTabRow) items = items.reverseObjectEnumerator.allObjects;
  for (NSTabViewItem *item in [_tabView.tabViewItems copy]) if (![items containsObject:item]) [_tabView removeTabViewItem:item];
  [items enumerateObjectsUsingBlock:^(NSTabViewItem *item, NSUInteger index, BOOL *stop) {
    NSInteger current = [_tabView indexOfTabViewItem:item];
    if (current == (NSInteger)index) return;
    if (current != NSNotFound) [_tabView removeTabViewItem:item];
    [_tabView insertTabViewItem:item atIndex:(NSInteger)index];
  }];
  _updating = NO;
  [self applySelection];
  [self reportContentLayout];
}

#pragma mark Props

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps {
  const auto &next = *std::static_pointer_cast<SparkTabViewProps const>(props);
  _selectedId = [NSString stringWithUTF8String:next.selectedId.c_str()];
  _acknowledged = next.eventCount;
  _tabPosition = [NSString stringWithUTF8String:next.tabPosition.c_str()];
  _tabBorder = [NSString stringWithUTF8String:next.tabBorder.c_str()];
  [self applyStyle];
  [super updateProps:props oldProps:oldProps];
}
- (void)applyStyle {
  NSDictionary<NSString *, NSNumber *> *positions = @{ @"top": @(NSTabPositionTop), @"bottom": @(NSTabPositionBottom), @"none": @(NSTabPositionNone),
    @"leading": @(_rtl ? NSTabPositionRight : NSTabPositionLeft), @"trailing": @(_rtl ? NSTabPositionLeft : NSTabPositionRight) };
  NSDictionary<NSString *, NSNumber *> *borders = @{ @"bezel": @(NSTabViewBorderTypeBezel), @"line": @(NSTabViewBorderTypeLine), @"none": @(NSTabViewBorderTypeNone) };
  NSTabPosition position = (NSTabPosition)(positions[_tabPosition] ?: @(NSTabPositionTop)).unsignedIntegerValue;
  NSTabViewBorderType border = (NSTabViewBorderType)(borders[_tabBorder] ?: @(NSTabViewBorderTypeBezel)).unsignedIntegerValue;
  if (_tabView.tabPosition != position) _tabView.tabPosition = position;
  if (_tabView.tabViewBorderType != border) _tabView.tabViewBorderType = border;
  [self rebuildItems];
}
// A selection JS has not processed yet stays in effect: `selectedId` may predate it.
- (void)applySelection {
  if (_acknowledged != _eventCount) return;
  NSInteger index = [_tabView indexOfTabViewItemWithIdentifier:_selectedId];
  if (index == NSNotFound || _tabView.selectedTabViewItem == _tabView.tabViewItems[index]) return;
  _updating = YES;
  [_tabView selectTabViewItemAtIndex:index];
  _updating = NO;
}
- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics {
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  BOOL rtl = layoutMetrics.layoutDirection == LayoutDirection::RightToLeft;
  if (rtl != _rtl) {
    _rtl = rtl;
    _tabView.userInterfaceLayoutDirection = rtl ? NSUserInterfaceLayoutDirectionRightToLeft : NSUserInterfaceLayoutDirectionLeftToRight;
    for (RNSparkTab *tab in _tabs) tab.item.view.userInterfaceLayoutDirection = _tabView.userInterfaceLayoutDirection;
    [self applyStyle];
  }
  [self layoutSubviews];
}
- (void)layoutSubviews {
  [super layoutSubviews];
  _tabView.frame = self.bounds;
  [self reportContentLayout];
}

#pragma mark Events

- (void)reportContentLayout {
  const auto emitter = std::static_pointer_cast<const SparkTabViewEventEmitter>(_eventEmitter);
  if (!emitter || NSIsEmptyRect(self.bounds)) return;
  NSSize size = NSMakeSize(MAX(0, NSWidth(_tabView.contentRect)), MAX(0, NSHeight(_tabView.contentRect)));
  if (NSEqualSizes(size, _reportedContentSize)) return;
  _reportedContentSize = size;
  emitter->onTabViewContentLayout({ .height = size.height, .width = size.width });
}
- (void)updateEventEmitter:(EventEmitter::Shared const &)eventEmitter {
  [super updateEventEmitter:eventEmitter];
  [self reportContentLayout];
}
- (void)tabView:(NSTabView *)tabView didSelectTabViewItem:(NSTabViewItem *)item {
  const auto emitter = std::static_pointer_cast<const SparkTabViewEventEmitter>(_eventEmitter);
  if (_updating || !emitter) return;
  emitter->onTabViewSelectionChange({ .eventCount = ++_eventCount, .id = [item.identifier description].UTF8String });
}

- (void)prepareForRecycle {
  [super prepareForRecycle];
  for (RNSparkTab *tab in _tabs) { tab.owner = nil; [tab removeFromSuperview]; }
  [_tabs removeAllObjects];
  _selectedId = @""; _tabPosition = @"top"; _tabBorder = @"bezel";
  _eventCount = 0; _acknowledged = 0; _rtl = NO; _reportedContentSize = NSMakeSize(-1, -1);
  _tabView.userInterfaceLayoutDirection = NSUserInterfaceLayoutDirectionLeftToRight;
  [self applyStyle];
}
+ (ComponentDescriptorProvider)componentDescriptorProvider { return concreteComponentDescriptorProvider<SparkTabViewComponentDescriptor>(); }
@end
