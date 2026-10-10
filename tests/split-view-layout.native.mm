#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#include <cmath>
#include <memory>
namespace facebook::react {
struct EventEmitter { virtual ~EventEmitter() = default; };
struct SidebarSplitViewEventEmitter : EventEmitter {
  struct OnSidebarCollapsedChange { bool collapsed; };
  void onSidebarCollapsedChange(OnSidebarCollapsedChange) const {}
};
using Float = double;
struct Point { Float x, y; };
struct Size { Float width, height; };
struct Rect { Point origin; Size size; };
}
using facebook::react::Float;
using facebook::react::SidebarSplitViewEventEmitter;
struct LayoutMetrics {
  facebook::react::Rect frame{};
  struct {} contentInsets, borderWidth, overflowInset;
  bool operator==(const LayoutMetrics &other) const { return !(*this != other); }
  bool operator!=(const LayoutMetrics &other) const { return frame.size.width != other.frame.size.width || frame.size.height != other.frame.size.height; }
};
const LayoutMetrics EmptyLayoutMetrics{};
const NSUInteger RNComponentViewUpdateMaskLayoutMetrics = 1;
@protocol RCTComponentViewProtocol
- (void)updateLayoutMetrics:(const LayoutMetrics &)metrics oldLayoutMetrics:(const LayoutMetrics &)oldMetrics;
- (void)finalizeUpdates:(NSUInteger)mask;
@end
#define RCTUIView NSView
@interface FakeComponentView : NSView
- (void)mountChildComponentView:(NSView<RCTComponentViewProtocol> *)child index:(NSInteger)index;
- (void)unmountChildComponentView:(NSView<RCTComponentViewProtocol> *)child index:(NSInteger)index;
@end
@implementation FakeComponentView
- (void)mountChildComponentView:(NSView<RCTComponentViewProtocol> *)child index:(NSInteger)index { [self addSubview:child]; }
- (void)unmountChildComponentView:(NSView<RCTComponentViewProtocol> *)child index:(NSInteger)index { [child removeFromSuperview]; }
@end
@interface FakeReactView : NSView<RCTComponentViewProtocol>
@end
@implementation FakeReactView
- (void)updateLayoutMetrics:(const LayoutMetrics &)metrics oldLayoutMetrics:(const LayoutMetrics &)oldMetrics {}
- (void)finalizeUpdates:(NSUInteger)mask {}
@end
// Actual NSSplitView subclasses and selected layout methods are inserted from the reviewed source.
// Fabric synchronizing/event-emitting boundaries are replaced with frame/event recording below.
// ACTUAL_CLASSES
@interface TrackingSplitView : RNSidebarSplitViewNativeSplitView
@property BOOL testTracking;
@end
@implementation TrackingSplitView
- (BOOL)trackingDivider { return self.testTracking; }
@end
@interface Probe : FakeComponentView {
@public
  NSSplitViewController *_splitViewController;
  NSViewController *_sidebarViewController, *_contentViewController, *_listViewController;
  NSSplitViewItem *_sidebarItem, *_contentItem, *_listItem;
  NSView *_sidebarContainer, *_contentContainer, *_listContainer;
  NSView<RCTComponentViewProtocol> *_contentReactView;
  CGFloat _sidebarMinWidth, _sidebarWidth, _contentMinWidth, _listMinWidth, _listWidth;
  BOOL _hasList, _sidebarCollapsed, _needsPreferredDividerPositions, _layingOutSplitView;
  LayoutMetrics _currentLayoutMetrics, _sidebarReactLayoutMetrics, _contentReactLayoutMetrics, _listReactLayoutMetrics;
  NSView<RCTComponentViewProtocol> *_sidebarReactView, *_listReactView;
  NSMutableArray<NSDictionary *> *_events;
  id _resizeObserver;
  std::shared_ptr<const facebook::react::EventEmitter> _eventEmitter;
}
- (void)layoutSplitView;
- (BOOL)applyEstimatedSplitViewLayoutForBounds:(CGRect)bounds layoutReady:(BOOL)ready;
@end
@implementation Probe
- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _sidebarMinWidth = 180; _sidebarWidth = 200; _contentMinWidth = 320;
    _listMinWidth = 240; _listWidth = 300; _needsPreferredDividerPositions = YES;
    _events = [NSMutableArray new];
    _sidebarContainer = [NSView new]; _contentContainer = [NSView new]; _listContainer = [NSView new];
    _sidebarViewController = [NSViewController new]; _contentViewController = [NSViewController new]; _listViewController = [NSViewController new];
    _sidebarViewController.view = _sidebarContainer; _contentViewController.view = _contentContainer; _listViewController.view = _listContainer;
    _sidebarItem = [NSSplitViewItem sidebarWithViewController:_sidebarViewController];
    _contentItem = [NSSplitViewItem splitViewItemWithViewController:_contentViewController];
    _listItem = [NSSplitViewItem contentListWithViewController:_listViewController];
    _sidebarItem.canCollapse = YES; _listItem.holdingPriority = NSLayoutPriorityDefaultLow + 1;
    _splitViewController = [NSSplitViewController new]; _splitViewController.splitView = [TrackingSplitView new];
    _splitViewController.splitView.vertical = YES; _splitViewController.splitView.dividerStyle = NSSplitViewDividerStyleThin;
    [_splitViewController addSplitViewItem:_sidebarItem]; [_splitViewController addSplitViewItem:_contentItem];
    [self addSubview:_splitViewController.view]; [self updateSplitItemSizing];
    __weak Probe *weakSelf = self;
    _resizeObserver = [[NSNotificationCenter defaultCenter] addObserverForName:NSSplitViewDidResizeSubviewsNotification object:_splitViewController.splitView queue:nil usingBlock:^(NSNotification *note) { [weakSelf splitViewDidResize]; }];
  }
  return self;
}
- (void)layoutContentTitlebarMaterial {}
- (void)emitSplitViewDidResizeWithSidebarWidth:(CGFloat)s contentWidth:(CGFloat)c contentX:(CGFloat)x sidebarHeight:(CGFloat)sh contentHeight:(CGFloat)ch height:(CGFloat)h listWidth:(CGFloat)l listX:(CGFloat)lx layoutReady:(BOOL)r {
  [_events addObject:@{@"sidebar":@(s), @"content":@(c), @"contentX":@(x), @"list":@(l), @"listX":@(lx), @"ready":@(r)}];
}
- (void)dealloc { if (_resizeObserver) [[NSNotificationCenter defaultCenter] removeObserver:_resizeObserver]; }
// ACTUAL_METHODS
@end
static void require(BOOL value, NSString *message) { if (!value) { fprintf(stderr, "%s\n", message.UTF8String); exit(1); } }
int main(int argc, char **argv) { @autoreleasepool {
  [NSApplication sharedApplication];
  NSString *mode = argc > 1 ? @(argv[1]) : @"all";
  Probe *p = [[Probe alloc] initWithFrame:NSMakeRect(0,0,1200,500)];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,1200,500) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  window.contentView = p;
  if ([mode isEqual:@"anchor"]) {
    p->_contentContainer.frame = NSMakeRect(201,0,999,500);
    p->_contentReactView = [[FakeReactView alloc] initWithFrame:NSMakeRect(0,0,999,500)];
    [p->_contentContainer addSubview:p->_contentReactView];
    NSView *child = [[NSView alloc] initWithFrame:NSMakeRect(0,0,100,50)]; [p->_contentReactView addSubview:child];
    ((TrackingSplitView *)p->_splitViewController.splitView).testTracking = YES;
    [p syncReactSubviewFrames];
    printf("Narrow content bounds offset = %.1f\n", p->_contentReactView.bounds.origin.x);
    require(fabs(p->_contentReactView.bounds.origin.x) < 0.5, @"Narrow content permanently shifted after divider drag");
  } else if ([mode isEqual:@"metrics"]) {
    [p applyEstimatedSplitViewLayoutForBounds:p.bounds layoutReady:NO];
    printf("No-list provisional listX = %.1f\n", [p->_events.lastObject[@"listX"] doubleValue]);
    require([p->_events.lastObject[@"listX"] doubleValue] == 0, @"Absent list reports nonzero listX");
  } else if ([mode isEqual:@"clamp"]) {
    [window setContentSize:NSMakeSize(550,500)]; p.frame = NSMakeRect(0,0,550,500); p->_sidebarWidth = 300;
    [p layoutSplitView];
    printf("Small initial sidebar = %.1f pending=%d\n", p->_sidebarContainer.bounds.size.width,p->_needsPreferredDividerPositions);
    [window setContentSize:NSMakeSize(1200,500)]; p.frame = NSMakeRect(0,0,1200,500); [p layoutSplitView];
    printf("Restored sidebar = %.1f\n",p->_sidebarContainer.bounds.size.width);
    require(fabs(NSMaxX([p->_sidebarContainer convertRect:p->_sidebarContainer.bounds toView:p->_splitViewController.splitView])-300)<1,@"Preferred sidebar width never recovered after clamped startup");
  } else if ([mode isEqual:@"events"]) {
    p->_hasList = YES; [p layoutSplitView];
    printf("Owned initial layout events = %lu\n", (unsigned long)p->_events.count);
    require(p->_events.count == 1, @"Owned initial layout published transient metrics");
  } else if ([mode isEqual:@"ownership"]) {
    [window setContentSize:NSMakeSize(550,500)]; p.frame = NSMakeRect(0,0,550,500); p->_sidebarWidth = 300; [p layoutSplitView];
    ((TrackingSplitView *)p->_splitViewController.splitView).testTracking = YES;
    [p->_splitViewController.splitView setPosition:190 ofDividerAtIndex:0];
    [p splitViewDidResize];
    ((TrackingSplitView *)p->_splitViewController.splitView).testTracking = NO;
    CGFloat dragged = p->_sidebarContainer.bounds.size.width;
    require(!p->_needsPreferredDividerPositions, @"Drag did not take ownership from pending preferred width");
    [window setContentSize:NSMakeSize(1200,500)]; p.frame = NSMakeRect(0,0,1200,500); [p layoutSplitView];
    require(fabs(p->_sidebarContainer.bounds.size.width-dragged)<1,@"Growing window overrode user drag");
  } else if ([mode isEqual:@"mount"]) {
    p->_hasList = YES; [p layoutSplitView];
    FakeReactView *sidebar = [FakeReactView new], *content = [FakeReactView new], *list = [FakeReactView new];
    [p mountChildComponentView:sidebar index:0];
    [p mountChildComponentView:content index:1];
    [p mountChildComponentView:list index:2];
    require(sidebar.superview == p->_sidebarContainer && content.superview == p->_contentContainer && list.superview == p->_listContainer,@"Native mount indices routed to wrong panes");
    require(!sidebar.hidden && !content.hidden && !list.hidden,@"Mounted panes did not become visible");
    [p unmountChildComponentView:list index:2];
    require(!p->_listReactView && !list.superview && content.superview==p->_contentContainer,@"Removing list disturbed content mount");
    [p mountChildComponentView:list index:2];
    require(list.superview==p->_listContainer && content.superview==p->_contentContainer,@"Restoring list disturbed content mount");
  } else if ([mode isEqual:@"toggle"]) {
    p->_hasList = YES; [p layoutSplitView];
    require(p->_splitViewController.splitViewItems.count == 3,@"List was not installed");
    p->_sidebarCollapsed = YES; [p updateSidebarCollapsed]; p->_needsPreferredDividerPositions = YES; [p layoutSplitView];
    require(p->_sidebarItem.collapsed && p->_listContainer.bounds.size.width>0,@"Collapsed sidebar lost list pane");
    p->_hasList = NO; p->_needsPreferredDividerPositions = YES; [p layoutSplitView];
    require(p->_splitViewController.splitViewItems.count == 2,@"List was not removed");
    require([p->_events.lastObject[@"list"] doubleValue]==0 && [p->_events.lastObject[@"listX"] doubleValue]==0,@"Removed list retained metrics");
    p->_hasList = YES; p->_sidebarCollapsed = NO; [p updateSidebarCollapsed]; p->_needsPreferredDividerPositions = YES; [p layoutSplitView];
    require(p->_splitViewController.splitViewItems.count==3 && !p->_sidebarItem.collapsed,@"List/sidebar did not restore");
  } else {
    p->_hasList = YES; [p layoutSplitView];
    ((TrackingSplitView *)p->_splitViewController.splitView).testTracking = YES;
    [p->_splitViewController.splitView setPosition:260 ofDividerAtIndex:0];
    [p->_splitViewController.splitView setPosition:621 ofDividerAtIndex:1];
    ((TrackingSplitView *)p->_splitViewController.splitView).testTracking = NO;
    CGFloat sidebar = p->_sidebarContainer.bounds.size.width, list = p->_listContainer.bounds.size.width;
    printf("Dragged sidebar/list %.1f/%.1f\n",sidebar,list);
    p.frame = NSMakeRect(0,0,1200,600); [p layoutSplitView];
    printf("Height resize sidebar/list %.1f/%.1f\n",p->_sidebarContainer.bounds.size.width,p->_listContainer.bounds.size.width);
    require(fabs(sidebar-p->_sidebarContainer.bounds.size.width)<1 && fabs(list-p->_listContainer.bounds.size.width)<1,@"Height resize reset dragged pane widths");
    p.frame = NSMakeRect(0,0,1400,600); [p layoutSplitView];
    printf("Width resize sidebar/list %.1f/%.1f\n",p->_sidebarContainer.bounds.size.width,p->_listContainer.bounds.size.width);
    require(fabs(sidebar-p->_sidebarContainer.bounds.size.width)<1 && fabs(list-p->_listContainer.bounds.size.width)<1,@"Width resize reset dragged pane widths");
  }
  puts("Native split-view probe passed");
} return 0; }
