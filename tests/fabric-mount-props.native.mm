// Drives the real RNSidebarSplitViewComponent, RNSparkMotionView and RNDesktopDragView against a
// stand-in Fabric base class. React Native macOS mounts every inserted view with
// `updateProps:oldProps:nullptr` (RCTMountingManager Insert); each must survive it and apply its props.
// The other Spark component views are mounted the same way in their own harnesses.
// Compiled and run by tests/fabric-mount-props-native.test.ts.
#import <AppKit/AppKit.h>
#import <CoreImage/CoreImage.h>
#import <QuartzCore/QuartzCore.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <objc/runtime.h>
#import "SparkMotionCoordinator.h"
#include <cstdio>
#include <memory>
#include <string>
#include <vector>
namespace facebook::react {
using Float = double;
struct Point { Float x, y; };
struct Size { Float width, height; bool operator==(const Size &) const = default; };
struct Rect { Point origin; Size size; };
enum class LayoutDirection { Undefined, LeftToRight, RightToLeft };
struct LayoutMetrics {
  Rect frame{};
  LayoutDirection layoutDirection = LayoutDirection::Undefined;
  struct {} contentInsets, borderWidth, overflowInset;
  bool operator==(const LayoutMetrics &other) const { return frame.size == other.frame.size; }
};
const LayoutMetrics EmptyLayoutMetrics{};
struct Props { using Shared = std::shared_ptr<Props const>; virtual ~Props() = default; };
// Codegen defaults: empty strings, zero numbers, false booleans.
struct SidebarSplitViewProps : Props {
  std::string appearance, contentTitlebarMaterial, contentTitlebarOverlayColor, sidebarTitlebarOverlayColor;
  double contentTitlebarHeight = 0, contentTitlebarOverlayOpacity = 0, contentMinWidth = 0, listMinWidth = 0, listWidth = 0;
  double sidebarMinWidth = 0, sidebarTitlebarOverlayOpacity = 0, sidebarWidth = 0;
  bool hasList = false, sidebarCollapsed = false;
};
struct SparkMotionViewProps : Props { std::string initialValues; };
struct DesktopDragViewProps : Props { std::string sourceJson, optionsJson; bool disabled = false; };
struct EventEmitter { using Shared = std::shared_ptr<EventEmitter const>; virtual ~EventEmitter() = default; };
struct SidebarSplitViewEventEmitter : EventEmitter {
  struct OnSplitViewDidResize {
    double contentHeight, contentWidth, contentX, height;
    bool isLayoutReady, isVertical;
    double listHeight, listWidth, listX, sidebarHeight, sidebarWidth;
  };
  mutable std::vector<OnSplitViewDidResize> events;
  void onSplitViewDidResize(OnSplitViewDidResize event) const { events.push_back(event); }
};
struct DesktopDragViewEventEmitter : EventEmitter {
  struct Event { std::string payload; };
  void onDragEnter(Event event) const {}
  void onDragOver(Event event) const {}
  void onDragLeave(Event event) const {}
  void onDrop(Event event) const {}
  void onDragEnd(Event event) const {}
};
struct SidebarSplitViewComponentDescriptor {};
struct SparkMotionViewComponentDescriptor {};
struct DesktopDragViewComponentDescriptor {};
using ComponentDescriptorProvider = int;
template <class T> int concreteComponentDescriptorProvider() { return 0; }
}
using namespace facebook::react;
typedef NSEvent UIEvent;
const NSUInteger RNComponentViewUpdateMaskLayoutMetrics = 1;
@protocol RCTComponentViewProtocol
- (void)updateLayoutMetrics:(const LayoutMetrics &)metrics oldLayoutMetrics:(const LayoutMetrics &)old;
- (void)finalizeUpdates:(NSUInteger)mask;
@end
@protocol RCTSidebarSplitViewViewProtocol @end
@interface RCTUIView : NSView
@property (nonatomic, copy) NSNumber *reactTag;
@property (nonatomic, strong) NSColor *backgroundColor;
@property (nonatomic) CATransform3D transform3D;
@end
@implementation RCTUIView
- (instancetype)initWithFrame:(NSRect)frame { if (self = [super initWithFrame:frame]) self.wantsLayer = YES; return self; }
- (void)setTransform3D:(CATransform3D)transform { _transform3D = transform; self.layer.transform = transform; }
@end
// Mirrors RCTViewComponentView: it diffs against its own `_props`, never `oldProps`.
@interface RCTViewComponentView : RCTUIView <RCTComponentViewProtocol> {
@public
  Props::Shared _props;
  EventEmitter::Shared _eventEmitter;
}
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps;
- (void)updateEventEmitter:(EventEmitter::Shared const &)emitter;
- (void)mountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)child index:(NSInteger)index;
- (void)unmountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)child index:(NSInteger)index;
- (NSView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event;
- (void)layoutSubviews;
- (void)prepareForRecycle;
@end
@implementation RCTViewComponentView
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps { _props = props; }
- (void)updateEventEmitter:(EventEmitter::Shared const &)emitter { _eventEmitter = emitter; }
- (void)updateLayoutMetrics:(const LayoutMetrics &)metrics oldLayoutMetrics:(const LayoutMetrics &)old {
  self.frame = NSMakeRect(metrics.frame.origin.x, metrics.frame.origin.y, metrics.frame.size.width, metrics.frame.size.height);
}
- (void)finalizeUpdates:(NSUInteger)mask {}
- (void)mountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)child index:(NSInteger)index { [self addSubview:child]; }
- (void)unmountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)child index:(NSInteger)index { [child removeFromSuperview]; }
- (NSView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event { return [super hitTest:point]; }
- (void)invalidateLayer {}
- (void)layoutSubviews {}
- (void)prepareForRecycle {}
@end
@interface RNSidebarSplitViewComponent : RCTViewComponentView @end
@interface RNSparkMotionView : RCTViewComponentView @end
@interface RNDesktopDragView : RCTViewComponentView <NSDraggingSource> @end
// ACTUAL_IMPLEMENTATION
@interface RNSidebarSplitViewComponent (Testing)
- (BOOL)applyEstimatedSplitViewLayoutForBounds:(CGRect)bounds layoutReady:(BOOL)layoutReady;
@end

static int failures = 0;
#define CHECK(condition) do { if (!(condition)) { std::printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #condition); failures++; } } while (0)


int main() { @autoreleasepool {
  [NSApplication sharedApplication];

  // Split view: appearance, list column and collapse state come from the mount.
  RNSidebarSplitViewComponent *split = [[RNSidebarSplitViewComponent alloc] initWithFrame:NSMakeRect(0, 0, 1000, 600)];
  auto splitProps = std::make_shared<SidebarSplitViewProps>();
  splitProps->appearance = "dark"; splitProps->hasList = true; splitProps->sidebarCollapsed = true;
  splitProps->sidebarWidth = 240; splitProps->listWidth = 280;
  [split updateProps:splitProps oldProps:nullptr];
  [split layoutSubviews];
  NSSplitViewController *controller = [split valueForKey:@"splitViewController"];
  CHECK([split.appearance.name isEqual:NSAppearanceNameDarkAqua]);
  CHECK(controller.splitViewItems.count == 3);
  CHECK([[split valueForKey:@"sidebarItem"] isCollapsed]);

  // Split view direction: AppKit puts the sidebar on the leading edge and keeps pane widths across
  // LTR -> RTL -> LTR updates; published x positions are physical, as AppKit's own layout reports them.
  // Items are checked on the views AppKit arranges. macOS 26 floats the sidebar pane in glass inset from
  // the item's outer edges (a 232pt pane in a 240pt item); later releases fill the item. Either way the
  // right-to-left pane is the exact horizontal mirror of the left-to-right one, including after the
  // direction changes while the split is in a window (never shown).
  RNSidebarSplitViewComponent *mirrored = [[RNSidebarSplitViewComponent alloc] initWithFrame:NSMakeRect(0, 0, 1000, 600)];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1000, 600)
    styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskFullSizeContentView backing:NSBackingStoreBuffered defer:YES];
  window.releasedWhenClosed = NO;
  [window.contentView addSubview:mirrored];
  auto emitter = std::make_shared<SidebarSplitViewEventEmitter>();
  mirrored->_eventEmitter = emitter;
  auto mirroredProps = std::make_shared<SidebarSplitViewProps>();
  mirroredProps->sidebarWidth = 240; mirroredProps->sidebarMinWidth = 180; mirroredProps->contentMinWidth = 320;
  [mirrored updateProps:mirroredProps oldProps:nullptr];
  NSView *sidebarPane = [mirrored valueForKey:@"sidebarContainer"], *contentPane = [mirrored valueForKey:@"contentContainer"];
  auto paneFrame = [](NSView *pane, NSView *root) { return [pane convertRect:pane.bounds toView:root]; };
  auto itemFrame = [&](NSView *pane, NSView *root) {
    NSSplitView *splitView = [[root valueForKey:@"splitViewController"] splitView];
    while (pane.superview != splitView) pane = pane.superview;
    return paneFrame(pane, root);
  };
  auto mirrorsLeftToRight = [](NSRect frame, NSRect ltr) {
    return NSMinX(frame) == 1000 - NSMaxX(ltr) && NSWidth(frame) == NSWidth(ltr);
  };
  NSRect ltrSidebarFrame = NSZeroRect;
  LayoutMetrics previous = EmptyLayoutMetrics;
  for (auto direction : {LayoutDirection::LeftToRight, LayoutDirection::RightToLeft, LayoutDirection::LeftToRight}) {
    LayoutMetrics metrics; metrics.frame = facebook::react::Rect{{0, 0}, {1000, 600}}; metrics.layoutDirection = direction;
    [mirrored updateLayoutMetrics:metrics oldLayoutMetrics:previous]; previous = metrics;
    BOOL rtl = direction == LayoutDirection::RightToLeft;
    NSRect sidebarItem = itemFrame(sidebarPane, mirrored), contentItem = itemFrame(contentPane, mirrored);
    CHECK([[mirrored valueForKey:@"splitViewController"] splitView].userInterfaceLayoutDirection ==
      (rtl ? NSUserInterfaceLayoutDirectionRightToLeft : NSUserInterfaceLayoutDirectionLeftToRight));
    NSRect sidebarFrame = paneFrame(sidebarPane, mirrored);
    if (!rtl) ltrSidebarFrame = sidebarFrame;
    CHECK(NSWidth(sidebarItem) == 240 && NSContainsRect(sidebarItem, sidebarFrame) && (!rtl || mirrorsLeftToRight(sidebarFrame, ltrSidebarFrame)));
    CHECK(rtl ? NSMaxX(sidebarItem) == 1000 && NSMinX(contentItem) == 0 : NSMinX(sidebarItem) == 0 && NSMaxX(contentItem) == 1000);
    CHECK(paneFrame(contentPane, mirrored).origin.x == NSMinX(contentItem));
    CHECK(!emitter->events.empty() && emitter->events.back().sidebarWidth == NSWidth(sidebarFrame) &&
      emitter->events.back().contentX == NSMinX(contentItem));
  }
  // A split mounted right to left starts mirrored.
  previous.layoutDirection = LayoutDirection::RightToLeft;
  RNSidebarSplitViewComponent *rtlFirst = [[RNSidebarSplitViewComponent alloc] initWithFrame:NSMakeRect(0, 0, 1000, 600)];
  [rtlFirst updateProps:mirroredProps oldProps:nullptr];
  [rtlFirst updateLayoutMetrics:previous oldLayoutMetrics:EmptyLayoutMetrics];
  NSView *rtlSidebar = [rtlFirst valueForKey:@"sidebarContainer"];
  NSRect rtlSidebarItem = itemFrame(rtlSidebar, rtlFirst);
  CHECK(NSMaxX(rtlSidebarItem) == 1000 && NSWidth(rtlSidebarItem) == 240 && mirrorsLeftToRight(paneFrame(rtlSidebar, rtlFirst), ltrSidebarFrame));
  // The estimated layout used before AppKit lays the panes out mirrors the same way.
  [mirrored updateLayoutMetrics:previous oldLayoutMetrics:previous];
  [mirrored applyEstimatedSplitViewLayoutForBounds:CGRectMake(0, 0, 1000, 600) layoutReady:NO];
  CHECK(NSMaxX(paneFrame(sidebarPane, mirrored)) == 1000 && NSWidth(paneFrame(sidebarPane, mirrored)) == 240 && NSMinX(paneFrame(contentPane, mirrored)) == 0);
  CHECK(emitter->events.back().contentX == 0);

  // Motion: `initial` values are applied at mount.
  RNSparkMotionView *motion = [[RNSparkMotionView alloc] initWithFrame:NSMakeRect(0, 0, 100, 40)];
  motion.reactTag = @41;
  auto motionProps = std::make_shared<SparkMotionViewProps>(); motionProps->initialValues = R"({"opacity":0.25})";
  [motion updateProps:motionProps oldProps:nullptr];
  CHECK(motion.layer.opacity == 0.25f);

  // Drag view: drag source, accepted types and enabled state come from the mount.
  RNDesktopDragView *drag = [[RNDesktopDragView alloc] initWithFrame:NSMakeRect(0, 0, 100, 40)];
  auto dragProps = std::make_shared<DesktopDragViewProps>();
  dragProps->sourceJson = R"({"text":"hello"})"; dragProps->optionsJson = R"({"acceptedTypes":["text"]})";
  [drag updateProps:dragProps oldProps:nullptr];
  CHECK([drag.registeredDraggedTypes isEqual:@[NSPasteboardTypeString]]);
  CHECK(!drag.mouseDownCanMoveWindow);

  if (failures) return 1;
  std::puts("Fabric mount props passed");
} }
