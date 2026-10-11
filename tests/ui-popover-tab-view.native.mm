// Drives the real RNSparkPopover, RNSparkTabView and RNSparkTab against a stand-in Fabric base
// class. React Native macOS mounts every inserted view with `updateProps:oldProps:nullptr`
// (RCTMountingManager Insert). No window is ever ordered on screen: an NSPopover needs an on-screen
// anchor window, so showing goes through a recording NSPopover subclass and a window that reports
// itself visible. Compiled and run by tests/ui-popover-tab-view-native.test.ts.
#import <AppKit/AppKit.h>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>
static std::vector<std::string> events;
namespace facebook::react {
enum class LayoutDirection { Undefined, LeftToRight, RightToLeft };
struct LayoutMetrics { CGRect frame; LayoutDirection layoutDirection = LayoutDirection::LeftToRight; };
struct Props { using Shared = std::shared_ptr<Props const>; virtual ~Props() = default; };
// Codegen defaults: empty strings, zero numbers, false booleans.
struct SparkPopoverProps : Props {
  bool open = false, detachable = false, hasAnchorRect = false;
  int eventCount = 0, anchorTag = 0;
  std::string behavior, preferredEdge;
  double anchorX = 0, anchorY = 0, anchorWidth = 0, anchorHeight = 0;
};
struct SparkTabViewProps : Props { std::string selectedId, tabPosition, tabBorder; int eventCount = 0; };
struct SparkTabProps : Props { std::string tabId, label; };
struct EventEmitter { using Shared = std::shared_ptr<EventEmitter const>; virtual ~EventEmitter() = default; };
struct SparkPopoverEventEmitter : EventEmitter {
  struct OnPopoverChange { int eventCount; std::string state; };
  struct OnPopoverError { std::string code, message; };
  void onPopoverChange(OnPopoverChange event) const { events.push_back(event.state + ":" + std::to_string(event.eventCount)); }
  void onPopoverError(OnPopoverError event) const { events.push_back("error:" + event.code); }
};
struct SparkTabViewEventEmitter : EventEmitter {
  struct OnTabViewSelectionChange { int eventCount; std::string id; };
  struct OnTabViewContentLayout { double height, width; };
  void onTabViewSelectionChange(OnTabViewSelectionChange event) const { events.push_back("select:" + event.id + ":" + std::to_string(event.eventCount)); }
  void onTabViewContentLayout(OnTabViewContentLayout event) const { events.push_back("layout:" + std::to_string((int)event.width) + "x" + std::to_string((int)event.height)); }
};
struct SparkPopoverComponentDescriptor {};
struct SparkTabViewComponentDescriptor {};
struct SparkTabComponentDescriptor {};
using ComponentDescriptorProvider = int;
template <class T> int concreteComponentDescriptorProvider() { return 0; }
}
using namespace facebook::react;
@protocol RCTComponentViewProtocol @end
@interface RCTUIView : NSView
@property (nonatomic, copy) NSNumber *reactTag;
@end
@implementation RCTUIView
- (BOOL)isFlipped { return YES; }
@end
// Mirrors RCTViewComponentView: it diffs against its own `_props`, never `oldProps`.
@interface RCTViewComponentView : RCTUIView <RCTComponentViewProtocol> {
@public
  Props::Shared _props;
  EventEmitter::Shared _eventEmitter;
}
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps;
- (void)updateEventEmitter:(EventEmitter::Shared const &)emitter;
- (void)updateLayoutMetrics:(const LayoutMetrics &)metrics oldLayoutMetrics:(const LayoutMetrics &)old;
- (void)mountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)child index:(NSInteger)index;
- (void)unmountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)child index:(NSInteger)index;
- (void)layoutSubviews;
- (void)prepareForRecycle;
@end
@implementation RCTViewComponentView
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps { _props = props; }
- (void)updateEventEmitter:(EventEmitter::Shared const &)emitter { _eventEmitter = emitter; }
- (void)updateLayoutMetrics:(const LayoutMetrics &)metrics oldLayoutMetrics:(const LayoutMetrics &)old { self.frame = metrics.frame; }
- (void)mountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)child index:(NSInteger)index { [self addSubview:child]; }
- (void)unmountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)child index:(NSInteger)index { [child removeFromSuperview]; }
- (void)layoutSubviews {}
- (void)prepareForRecycle {}
@end
// The Fabric touch handler; the harness only records where it is attached.
@interface RCTSurfaceTouchHandler : NSObject
@property (nonatomic, weak) NSView *view;
- (void)attachToView:(NSView *)view;
@end
@implementation RCTSurfaceTouchHandler
- (void)attachToView:(NSView *)view { _view = view; }
@end
@interface RNSparkPopover : RCTViewComponentView <NSPopoverDelegate> @end
@interface RNSparkTabView : RCTViewComponentView <NSTabViewDelegate> @end
@interface RNSparkTab : RCTViewComponentView @end
// ACTUAL_IMPLEMENTATION

@interface RNSparkPopover (Testing)
- (void)focusContent;
@end
@interface RNSparkTab (Testing)
@property (nonatomic, readonly) NSTabViewItem *item;
@end
// Records show requests and plays AppKit's delegate callbacks without opening a window.
@interface RecordingPopover : NSPopover
@property (nonatomic) BOOL fakeShown;
@property (nonatomic) int shows;
@property (nonatomic) NSRect lastRect;
@property (nonatomic, weak) NSView *lastView;
@property (nonatomic) NSRectEdge lastEdge;
@end
@implementation RecordingPopover
- (BOOL)isShown { return _fakeShown; }
- (void)showRelativeToRect:(NSRect)rect ofView:(NSView *)view preferredEdge:(NSRectEdge)edge {
  _shows++; _lastRect = rect; _lastView = view; _lastEdge = edge; _fakeShown = YES;
  [self.delegate popoverDidShow:[NSNotification notificationWithName:NSPopoverDidShowNotification object:self]];
}
- (void)close {
  if (!_fakeShown) return;
  _fakeShown = NO;
  [self.delegate popoverDidClose:[NSNotification notificationWithName:NSPopoverDidCloseNotification object:self]];
}
@end
// Reports itself visible so the popover's on-screen check passes; it is never ordered on screen.
@interface VisibleWindow : NSWindow @end
@implementation VisibleWindow
- (BOOL)isVisible { return YES; }
@end

static int failures = 0;
#define CHECK(condition) do { if (!(condition)) { std::printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #condition); failures++; } } while (0)
static void Spin() { [[NSRunLoop mainRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]]; }
static std::string Drain() { std::string joined; for (auto &event : events) joined += (joined.empty() ? "" : " ") + event; events.clear(); return joined; }
static RCTViewComponentView *Child(NSRect frame, int tag = 0) {
  RCTViewComponentView *child = [[RCTViewComponentView alloc] initWithFrame:frame];
  if (tag) child.reactTag = @(tag);
  return child;
}
static LayoutMetrics Metrics(NSRect frame, bool rtl = false) { return { frame, rtl ? LayoutDirection::RightToLeft : LayoutDirection::LeftToRight }; }
static NSPopover *PopoverOf(RNSparkPopover *host) { return [host valueForKey:@"popover"]; }
static int Count(NSView *host) { return [[host valueForKey:@"eventCount"] intValue]; }
static std::shared_ptr<SparkPopoverProps> PopoverProps(bool open, int eventCount, int anchorTag = 7, const char *edge = "bottom") {
  auto props = std::make_shared<SparkPopoverProps>();
  props->open = open; props->eventCount = eventCount; props->anchorTag = anchorTag;
  props->behavior = "transient"; props->preferredEdge = edge;
  return props;
}

static void Popover() {
  NSWindow *window = [[VisibleWindow alloc] initWithContentRect:NSMakeRect(0, 0, 600, 400) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:YES];
  RCTUIView *root = [[RCTUIView alloc] initWithFrame:NSMakeRect(0, 0, 600, 400)];
  window.contentView = root;
  RCTUIView *row = [[RCTUIView alloc] initWithFrame:NSMakeRect(40, 30, 400, 100)];
  RCTViewComponentView *anchor = Child(NSMakeRect(60, 20, 80, 24), 7);
  [root addSubview:row]; [row addSubview:anchor];

  RNSparkPopover *host = [RNSparkPopover new];
  [host updateEventEmitter:std::make_shared<SparkPopoverEventEmitter>()];
  NSView *content = PopoverOf(host).contentViewController.view;
  CHECK(content.isFlipped);
  CHECK([[host valueForKey:@"touchHandler"] view] == content);

  // Mount: every prop applies from a null oldProps.
  auto props = PopoverProps(false, 0); props->behavior = "semi-transient"; props->detachable = true;
  [host updateProps:props oldProps:nullptr];
  CHECK([PopoverOf(host) behavior] == NSPopoverBehaviorSemitransient);
  CHECK([host popoverShouldDetach:PopoverOf(host)]);
  for (auto [behavior, expected] : { std::pair{"transient", NSPopoverBehaviorTransient}, std::pair{"application-defined", NSPopoverBehaviorApplicationDefined} }) {
    auto next = PopoverProps(false, 0); next->behavior = behavior;
    [host updateProps:next oldProps:props]; props = next;
    CHECK([PopoverOf(host) behavior] == expected);
  }
  CHECK(![host popoverShouldDetach:PopoverOf(host)]);

  // Content: React children in React order in the flipped content view; the popover takes their extent.
  RCTViewComponentView *title = Child(NSMakeRect(12, 10, 200, 24)), *field = Child(NSMakeRect(12, 44, 220, 30));
  [host mountChildComponentView:field index:0];
  [host mountChildComponentView:title index:0];
  CHECK([content.subviews isEqualToArray:(@[title, field])]);
  CHECK(NSEqualSizes([PopoverOf(host) contentSize], NSMakeSize(232, 74)));
  CHECK(NSEqualSizes(content.frame.size, NSMakeSize(232, 74)));
  CHECK(NSEqualRects([content convertRect:title.bounds fromView:title], NSMakeRect(12, 10, 200, 24)));
  field.frame = NSMakeRect(12, 44, 260, 40);
  CHECK(NSEqualSizes([PopoverOf(host) contentSize], NSMakeSize(272, 84)));
  [host unmountChildComponentView:field index:1];
  CHECK([content.subviews isEqualToArray:(@[title])] && NSEqualSizes([PopoverOf(host) contentSize], NSMakeSize(212, 34)));
  [host mountChildComponentView:field index:1];

  // Keyboard focus goes to the first key view in the content.
  NSWindow *contentWindow = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 300, 200) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:YES];
  NSTextField *input = [[NSTextField alloc] initWithFrame:NSMakeRect(0, 0, 200, 22)];
  [field addSubview:input];
  [contentWindow.contentView addSubview:content];
  CHECK(NSMinY([title convertRect:title.bounds toView:nil]) > NSMaxY([field convertRect:field.bounds toView:nil]));
  [host focusContent];
  CHECK(contentWindow.firstResponder == input || contentWindow.firstResponder == input.currentEditor);
  [content removeFromSuperview];

  // Showing waits for the host to be in a window, then anchors to the view with the React tag.
  RecordingPopover *popover = [RecordingPopover new];
  popover.contentViewController = [PopoverOf(host) contentViewController];
  popover.delegate = host;
  [host setValue:popover forKey:@"popover"];
  auto open = PopoverProps(true, 0);
  [host updateProps:open oldProps:props]; props = open;
  Spin();
  CHECK(popover.shows == 0);
  [root addSubview:host];
  Spin();
  CHECK(popover.shows == 1 && popover.lastView == anchor && NSEqualRects(popover.lastRect, anchor.bounds) && popover.lastEdge == NSRectEdgeMaxY);
  CHECK(Drain() == "shown:1");

  // A native close JS has not processed is not undone by an older `open`.
  [popover close];
  CHECK(Drain() == "closed:2");
  auto stale = PopoverProps(true, 1);
  [host updateProps:stale oldProps:props]; props = stale; Spin();
  CHECK(popover.shows == 1 && !popover.shown);
  // Caught up and still open (the parent kept it open): the controlled popover shows again.
  auto kept = PopoverProps(true, 2);
  [host updateProps:kept oldProps:props]; props = kept; Spin();
  CHECK(popover.shows == 2 && Drain() == "shown:3");
  // Caught up and closed by JS.
  auto closed = PopoverProps(false, 3);
  [host updateProps:closed oldProps:props]; props = closed; Spin();
  CHECK(!popover.shown && Drain() == "closed:4");
  // An unrelated parent render (same values, new props object) reconciles nothing.
  auto same = PopoverProps(false, 4);
  [host updateProps:same oldProps:props]; props = same; Spin();
  auto again = PopoverProps(false, 4);
  [host updateProps:again oldProps:props]; props = again; Spin();
  CHECK(popover.shows == 2 && Drain().empty());

  // Edges follow the positioning view's flippedness and the React layout direction.
  struct Case { const char *edge; bool rtl; NSRectEdge expected; };
  for (auto test : { Case{"top", false, NSRectEdgeMinY}, Case{"bottom", false, NSRectEdgeMaxY}, Case{"leading", false, NSRectEdgeMinX}, Case{"trailing", false, NSRectEdgeMaxX},
                     Case{"leading", true, NSRectEdgeMaxX}, Case{"trailing", true, NSRectEdgeMinX} }) {
    [host updateLayoutMetrics:Metrics(NSZeroRect, test.rtl) oldLayoutMetrics:Metrics(NSZeroRect)];
    auto show = PopoverProps(true, Count(host), 7, test.edge);
    [host updateProps:show oldProps:props]; props = show; Spin();
    CHECK(popover.lastEdge == test.expected);
    CHECK(content.userInterfaceLayoutDirection == (test.rtl ? NSUserInterfaceLayoutDirectionRightToLeft : NSUserInterfaceLayoutDirectionLeftToRight));
    auto hide = PopoverProps(false, Count(host));
    [host updateProps:hide oldProps:props]; props = hide; Spin();
    CHECK(!popover.shown);
  }
  [host updateLayoutMetrics:Metrics(NSZeroRect) oldLayoutMetrics:Metrics(NSZeroRect)];
  Drain();

  // A rect within the anchor view, in top-left coordinates.
  auto inView = PopoverProps(true, Count(host)); inView->hasAnchorRect = true; inView->anchorX = 10; inView->anchorY = 4; inView->anchorWidth = 20; inView->anchorHeight = 8;
  [host updateProps:inView oldProps:props]; props = inView; Spin();
  CHECK(popover.lastView == anchor && NSEqualRects(popover.lastRect, NSMakeRect(10, 4, 20, 8)));
  [popover close];
  // A rect in the window content: an unflipped content view gets AppKit's bottom-left rect.
  NSView *plain = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 600, 400)];
  window.contentView = plain; [plain addSubview:root];
  auto inWindow = PopoverProps(true, Count(host), 0, "top"); inWindow->hasAnchorRect = true; inWindow->anchorX = 300; inWindow->anchorY = 100; inWindow->anchorWidth = 40; inWindow->anchorHeight = 20;
  [host updateProps:inWindow oldProps:props]; props = inWindow; Spin();
  CHECK(popover.lastView == plain && NSEqualRects(popover.lastRect, NSMakeRect(300, 280, 40, 20)) && popover.lastEdge == NSRectEdgeMaxY);
  [popover close];
  Drain();

  // Detaching is reported and counted.
  int count = Count(host);
  [host popoverDidDetach:popover];
  CHECK(Drain() == "detached:" + std::to_string(++count));

  // An unmounted anchor reports E_NOT_FOUND once; an unresolved ref waits silently.
  auto missing = PopoverProps(true, count, 99);
  [host updateProps:missing oldProps:props]; props = missing; Spin();
  auto unrelated = PopoverProps(true, count, 99);
  [host updateProps:unrelated oldProps:props]; props = unrelated; Spin();
  CHECK(Drain() == "error:E_NOT_FOUND");
  auto unresolved = PopoverProps(true, count, -1);
  [host updateProps:unresolved oldProps:props]; props = unresolved; Spin();
  CHECK(Drain().empty() && !popover.shown);

  // Leaving the window closes the popover.
  auto shown = PopoverProps(true, count);
  [host updateProps:shown oldProps:props]; props = shown; Spin();
  CHECK(popover.shown);
  [host removeFromSuperview];
  CHECK(!popover.shown);
  Drain();

  // A real NSPopover silently ignores a show from a window that is not on screen (no delegate callbacks, no window),
  // so the component reports E_UNAVAILABLE instead of asking. Driver-mode windows are never on screen.
  [host prepareForRecycle];
  NSWindow *hidden = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 600, 400) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:YES];
  RCTUIView *hiddenRoot = [[RCTUIView alloc] initWithFrame:NSMakeRect(0, 0, 600, 400)];
  hidden.contentView = hiddenRoot;
  [hiddenRoot addSubview:anchor]; [hiddenRoot addSubview:host];
  [host updateProps:PopoverProps(true, 0) oldProps:nullptr]; Spin();
  CHECK(Drain() == "error:E_UNAVAILABLE" && ![PopoverOf(host) isShown] && !hidden.visible);
  [PopoverOf(host) showRelativeToRect:anchor.bounds ofView:anchor preferredEdge:NSRectEdgeMaxY]; Spin();
  CHECK(![PopoverOf(host) isShown] && Drain().empty() && !hidden.visible && !content.window);
}

static RNSparkTab *Tab(const char *tabId, const char *label) {
  RNSparkTab *tab = [RNSparkTab new];
  auto props = std::make_shared<SparkTabProps>(); props->tabId = tabId; props->label = label;
  [tab updateProps:props oldProps:nullptr];
  return tab;
}
static std::shared_ptr<SparkTabViewProps> TabProps(const char *selectedId, int eventCount, const char *position = "top", const char *border = "bezel") {
  auto props = std::make_shared<SparkTabViewProps>();
  props->selectedId = selectedId; props->eventCount = eventCount; props->tabPosition = position; props->tabBorder = border;
  return props;
}
static NSString *Identifiers(NSTabView *tabView) { return [[tabView.tabViewItems valueForKey:@"identifier"] componentsJoinedByString:@","]; }
// Tab identifiers left to right across the tab row.
static NSString *RowOrder(NSTabView *tabView, CGFloat y) {
  [tabView layoutSubtreeIfNeeded];
  NSMutableArray *order = [NSMutableArray new];
  for (CGFloat x = 0; x < NSWidth(tabView.bounds); x += 4) {
    NSTabViewItem *item = [tabView tabViewItemAtPoint:NSMakePoint(x, y)];
    if (item && ![order containsObject:item.identifier]) [order addObject:item.identifier];
  }
  return [order componentsJoinedByString:@","];
}

static void TabView(bool rtlApp) {
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 500, 300) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:YES];
  RCTUIView *root = [[RCTUIView alloc] initWithFrame:NSMakeRect(0, 0, 500, 300)];
  window.contentView = root;
  RNSparkTabView *host = [RNSparkTabView new];
  [host updateEventEmitter:std::make_shared<SparkTabViewEventEmitter>()];
  NSTabView *tabView = [host valueForKey:@"tabView"];
  [root addSubview:host];
  auto props = TabProps("second", 0);
  [host updateProps:props oldProps:nullptr];
  [host updateLayoutMetrics:Metrics(NSMakeRect(0, 0, 500, 300)) oldLayoutMetrics:Metrics(NSZeroRect)];
  NSSize contentSize = tabView.contentRect.size;
  CHECK(contentSize.width > 0 && contentSize.height > 0 && contentSize.height < 300);
  CHECK(Drain() == "layout:" + std::to_string((int)contentSize.width) + "x" + std::to_string((int)contentSize.height));

  // Tabs mount in React order; the controlled selection applies once its tab exists, without an event.
  RNSparkTab *first = Tab("first", "First"), *second = Tab("second", "Second"), *third = Tab("third", "Third");
  [host mountChildComponentView:first index:0];
  [host mountChildComponentView:third index:1];
  [host mountChildComponentView:second index:1];
  // AppKit orders the row by the app's direction; the item order compensates so React order runs left to right.
  CHECK([Identifiers(tabView) isEqual:rtlApp ? @"third,second,first" : @"first,second,third"]);
  CHECK([RowOrder(tabView, 12) isEqual:@"first,second,third"]);
  CHECK([tabView.selectedTabViewItem.identifier isEqual:@"second"]);
  CHECK(Drain().empty());

  // Each tab's React content sits top-down in AppKit's content area.
  [second updateLayoutMetrics:Metrics(NSMakeRect(0, 0, contentSize.width, contentSize.height)) oldLayoutMetrics:Metrics(NSZeroRect)];
  RCTViewComponentView *heading = Child(NSMakeRect(10, 8, 120, 20)), *body = Child(NSMakeRect(10, 36, 200, 40));
  [second mountChildComponentView:heading index:0]; [second mountChildComponentView:body index:1];
  [tabView layoutSubtreeIfNeeded];
  CHECK(second.superview == tabView.selectedTabViewItem.view && second.superview.isFlipped);
  NSRect contentRect = tabView.contentRect;
  CHECK(NSEqualRects([tabView convertRect:heading.bounds fromView:heading], NSOffsetRect(NSMakeRect(10, 8, 120, 20), contentRect.origin.x, contentRect.origin.y)));
  CHECK(NSMinY([heading convertRect:heading.bounds toView:nil]) > NSMaxY([body convertRect:body.bounds toView:nil]));

  // A native selection is counted; an older selectedId does not undo it, and a veto restores once caught up.
  [tabView selectTabViewItemWithIdentifier:@"third"];
  CHECK(Drain() == "select:third:1");
  auto stale = TabProps("second", 0);
  [host updateProps:stale oldProps:props]; props = stale;
  CHECK([tabView.selectedTabViewItem.identifier isEqual:@"third"]);
  auto veto = TabProps("second", 1);
  [host updateProps:veto oldProps:props]; props = veto;
  CHECK([tabView.selectedTabViewItem.identifier isEqual:@"second"] && Drain().empty());
  [tabView selectTabViewItemWithIdentifier:@"first"];
  auto accept = TabProps("first", 2);
  [host updateProps:accept oldProps:props]; props = accept;
  CHECK([tabView.selectedTabViewItem.identifier isEqual:@"first"] && Drain() == "select:first:2");
  // JS selection.
  auto select = TabProps("third", 2);
  [host updateProps:select oldProps:props]; props = select;
  CHECK([tabView.selectedTabViewItem.identifier isEqual:@"third"] && Drain().empty());

  // Label and order changes.
  auto relabel = std::make_shared<SparkTabProps>(); relabel->tabId = "first"; relabel->label = "Alpha";
  [first updateProps:relabel oldProps:nullptr];
  CHECK([[tabView tabViewItemAtIndex:[tabView indexOfTabViewItemWithIdentifier:@"first"]].label isEqual:@"Alpha"]);
  [host unmountChildComponentView:second index:1];
  [host mountChildComponentView:second index:0];
  CHECK([RowOrder(tabView, 12) isEqual:@"second,first,third"] && [tabView.selectedTabViewItem.identifier isEqual:@"third"] && Drain().empty());

  // Styles: tab positions map to AppKit by React direction; line and borderless need no tabs.
  struct Style { const char *position, *border; bool rtl; NSTabViewType type; };
  for (auto style : { Style{"bottom", "bezel", false, NSBottomTabsBezelBorder}, Style{"leading", "bezel", false, NSLeftTabsBezelBorder}, Style{"trailing", "bezel", false, NSRightTabsBezelBorder},
                      Style{"leading", "bezel", true, NSRightTabsBezelBorder}, Style{"trailing", "bezel", true, NSLeftTabsBezelBorder},
                      Style{"none", "bezel", false, NSNoTabsBezelBorder}, Style{"none", "line", false, NSNoTabsLineBorder}, Style{"none", "none", false, NSNoTabsNoBorder} }) {
    [host updateLayoutMetrics:Metrics(NSMakeRect(0, 0, 500, 300), style.rtl) oldLayoutMetrics:Metrics(NSMakeRect(0, 0, 500, 300))];
    auto next = TabProps("third", 2, style.position, style.border);
    [host updateProps:next oldProps:props]; props = next;
    CHECK(tabView.tabViewType == style.type);
    CHECK([tabView.selectedTabViewItem.identifier isEqual:@"third"]);
  }
  CHECK(NSEqualSizes(tabView.contentRect.size, NSMakeSize(500, 300)));
  std::string layouts = Drain();
  CHECK(layouts.find("layout:500x300") != std::string::npos && layouts.find("select") == std::string::npos);

  // RTL: the first React tab is on the leading (right) edge whatever the app's direction.
  auto top = TabProps("third", 2);
  [host updateProps:top oldProps:props]; props = top;
  [host updateLayoutMetrics:Metrics(NSMakeRect(0, 0, 500, 300), true) oldLayoutMetrics:Metrics(NSMakeRect(0, 0, 500, 300))];
  CHECK([RowOrder(tabView, 12) isEqual:@"third,first,second"] && [tabView.selectedTabViewItem.identifier isEqual:@"third"]);
  CHECK(second.superview.userInterfaceLayoutDirection == NSUserInterfaceLayoutDirectionRightToLeft);
  [host updateLayoutMetrics:Metrics(NSMakeRect(0, 0, 500, 300)) oldLayoutMetrics:Metrics(NSMakeRect(0, 0, 500, 300))];
  CHECK([RowOrder(tabView, 12) isEqual:@"second,first,third"]);
  CHECK(Drain().find("select") == std::string::npos);

  // Removing the selected tab emits nothing; recycling clears the tabs.
  [host unmountChildComponentView:third index:2];
  CHECK([RowOrder(tabView, 12) isEqual:@"second,first"] && Drain().find("select") == std::string::npos);
  [host prepareForRecycle];
  CHECK(tabView.numberOfTabViewItems == 0 && [[host valueForKey:@"eventCount"] intValue] == 0);
}


// Renders the real popover content view in-process, with AppKit stand-ins for the Kitchen Sink's React
// content (PopoverScreen.tsx), in light and dark, left to right and right to left. The driver cannot open
// a popover (no window is on screen), so this is the documented capture of the content view.
static void Capture(NSString *directory) {
  for (NSString *appearanceName in @[NSAppearanceNameAqua, NSAppearanceNameDarkAqua]) for (bool rtl : { false, true }) {
    NSAppearance *appearance = [NSAppearance appearanceNamed:appearanceName];
    RNSparkPopover *host = [RNSparkPopover new];
    [host updateLayoutMetrics:Metrics(NSZeroRect, rtl) oldLayoutMetrics:Metrics(NSZeroRect)];
    // Fabric lays out one 280-point column with 16-point padding; text aligns to the leading edge.
    RCTViewComponentView *column = Child(NSMakeRect(0, 0, 280, 178));
    NSTextField *title = [NSTextField labelWithString:rtl ? @"محتوى النافذة المنبثقة" : @"Popover content"];
    title.font = [NSFont boldSystemFontOfSize:15]; title.frame = NSMakeRect(16, 16, 248, 20);
    NSTextField *body = [NSTextField wrappingLabelWithString:rtl ? @"محتوى React مرتب من الأعلى إلى الأسفل في نافذة منبثقة أصلية. ينتقل مفتاح Tab بين الحقول." : @"React content laid out top-down in a native popover. Tab moves between the fields."];
    body.textColor = NSColor.secondaryLabelColor; body.frame = NSMakeRect(16, 44, 248, 48);
    NSTextField *note = [[NSTextField alloc] initWithFrame:NSMakeRect(16, 100, 248, 24)];
    note.placeholderString = rtl ? @"ملاحظة" : @"Note";
    NSButton *close = [NSButton buttonWithTitle:rtl ? @"إغلاق" : @"Close" target:nil action:nil];
    close.frame = NSMakeRect(16, 134, 248, 28);
    for (NSTextField *field in @[title, body, note]) field.alignment = rtl ? NSTextAlignmentRight : NSTextAlignmentLeft;
    for (NSView *view in @[title, body, note, close]) { view.userInterfaceLayoutDirection = rtl ? NSUserInterfaceLayoutDirectionRightToLeft : NSUserInterfaceLayoutDirectionLeftToRight; [column addSubview:view]; }
    [host mountChildComponentView:column index:0];
    NSView *content = PopoverOf(host).contentViewController.view;
    // A popover draws its own material; the capture puts the content on the window background.
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, NSWidth(content.frame), NSHeight(content.frame)) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
    window.appearance = appearance;
    window.contentView.wantsLayer = YES;
    [appearance performAsCurrentDrawingAppearance:^{ window.contentView.layer.backgroundColor = NSColor.windowBackgroundColor.CGColor; }];
    [window.contentView addSubview:content];
    [window.contentView layoutSubtreeIfNeeded];
    NSBitmapImageRep *image = [window.contentView bitmapImageRepForCachingDisplayInRect:window.contentView.bounds];
    [window.contentView cacheDisplayInRect:window.contentView.bounds toBitmapImageRep:image];
    NSString *name = [NSString stringWithFormat:@"popover-content-%@%@.png", appearanceName == NSAppearanceNameAqua ? @"light" : @"dark", rtl ? @"-ar" : @""];
    CHECK([[image representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:[directory stringByAppendingPathComponent:name] atomically:YES]);
    CHECK(NSEqualSizes(content.frame.size, NSMakeSize(280, 178)) && content.isFlipped);
  }
}

int main(int argc, char **argv) { @autoreleasepool {
  [NSApplication sharedApplication];
  NSApp.activationPolicy = NSApplicationActivationPolicyProhibited;
  std::string scenario = argc > 1 ? argv[1] : "popover";
  bool rtlApp = NSApp.userInterfaceLayoutDirection == NSUserInterfaceLayoutDirectionRightToLeft;
  if (scenario == "popover") Popover();
  else if (scenario == "tab-view") TabView(rtlApp);
  else if (scenario == "capture" && argc > 2) Capture(@(argv[2]));
  else { std::printf("Unknown scenario %s\n", scenario.c_str()); return 2; }
  if (failures) return 1;
  std::printf("PASS %s%s\n", scenario.c_str(), rtlApp ? " (right-to-left app)" : "");
} return 0; }
