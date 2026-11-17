#import <AppKit/AppKit.h>
#include <memory>
#include <string>
#include <cassert>
namespace facebook::react {
// Fabric transport types are stubbed; the popover code below is the real AppKit implementation.
struct Props { using Shared = std::shared_ptr<const Props>; virtual ~Props() = default; };
enum class SparkPopoverEdge { Bottom, Top, Leading, Trailing };
enum class SparkPopoverBehavior { Transient, Semitransient, ApplicationDefined };
struct SparkPopoverProps : Props {
  bool visible = false; double contentWidth = 0, contentHeight = 0, anchorX = 0, anchorY = 0, anchorWidth = 0, anchorHeight = 0;
  SparkPopoverEdge edge = SparkPopoverEdge::Bottom; SparkPopoverBehavior behavior = SparkPopoverBehavior::Transient;
};
struct EventEmitter { using Shared = std::shared_ptr<const EventEmitter>; virtual ~EventEmitter() = default; };
static int closes = 0;
struct SparkPopoverEventEmitter : EventEmitter { struct OnClose {}; void onClose(OnClose) const { ++closes; } };
enum class LayoutDirection { Undefined, LeftToRight, RightToLeft };
struct LayoutMetrics { LayoutDirection layoutDirection = LayoutDirection::Undefined; };
struct SparkPopoverComponentDescriptor {};
using ComponentDescriptorProvider = int;
template<class T> int concreteComponentDescriptorProvider() { return 0; }
}
using namespace facebook::react;
@protocol RCTComponentViewProtocol @end
#define RCTUIView NSView
@interface RCTSurfaceTouchHandler : NSObject
@property (nonatomic, weak) NSView *attached;
- (void)attachToView:(NSView *)view;
@end
@implementation RCTSurfaceTouchHandler
- (void)attachToView:(NSView *)view { _attached = view; }
@end
@interface RCTViewComponentView : NSView {
@public Props::Shared _props; EventEmitter::Shared _eventEmitter;
}
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps;
- (void)updateLayoutMetrics:(const LayoutMetrics &)metrics oldLayoutMetrics:(const LayoutMetrics &)old;
- (void)mountChildComponentView:(NSView<RCTComponentViewProtocol> *)child index:(NSInteger)index;
- (void)unmountChildComponentView:(NSView<RCTComponentViewProtocol> *)child index:(NSInteger)index;
- (void)prepareForRecycle;
@end
@implementation RCTViewComponentView
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps { _props = props; }
- (void)updateLayoutMetrics:(const LayoutMetrics &)metrics oldLayoutMetrics:(const LayoutMetrics &)old {}
- (void)mountChildComponentView:(NSView<RCTComponentViewProtocol> *)child index:(NSInteger)index { [self addSubview:child]; }
- (void)unmountChildComponentView:(NSView<RCTComponentViewProtocol> *)child index:(NSInteger)index { [child removeFromSuperview]; }
- (void)prepareForRecycle {}
@end
@interface Child : NSView <RCTComponentViewProtocol> @end
@implementation Child @end
@interface RNSparkPopover : RCTViewComponentView @end
// ACTUAL_IMPLEMENTATION
static void Settle() { for (int i = 0; i < 60; i++) [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]]; }
static std::shared_ptr<SparkPopoverProps> Next(RNSparkPopover *view, void (^change)(SparkPopoverProps &)) {
  auto props = std::make_shared<SparkPopoverProps>(*std::static_pointer_cast<const SparkPopoverProps>(view->_props));
  change(*props); [view updateProps:props oldProps:view->_props]; return props;
}
int main() { @autoreleasepool {
  [NSApplication sharedApplication]; [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(200, 300, 600, 400) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  RNSparkPopover *view = [RNSparkPopover new];
  view->_eventEmitter = std::make_shared<SparkPopoverEventEmitter>();
  view->_props = std::make_shared<SparkPopoverProps>();
  view.frame = NSMakeRect(100, 100, 80, 24);
  Child *anchor = [Child new], *content = [Child new];
  [view mountChildComponentView:anchor index:0];
  [view mountChildComponentView:content index:1];
  NSPopover *popover = [view valueForKey:@"popover"];
  NSView *contentView = popover.contentViewController.view;
  assert(anchor.superview == view && content.superview == contentView && contentView.isFlipped);
  assert([[view valueForKey:@"touchHandler"] attached] == contentView);
  // Visible before it is in a window or has a content size: nothing shows yet.
  Next(view, ^(SparkPopoverProps &p) { p.visible = true; });
  assert(!popover.shown);
  [window.contentView addSubview:view];
  [window orderFront:nil];
  assert(!popover.shown);
  Next(view, ^(SparkPopoverProps &p) { p.contentWidth = 240; p.contentHeight = 90; p.behavior = SparkPopoverBehavior::ApplicationDefined; });
  Settle();
  assert(popover.shown && NSEqualSizes(popover.contentSize, NSMakeSize(240, 90)) && popover.behavior == NSPopoverBehaviorApplicationDefined);
  // Bottom edge: the popover sits below the anchor on screen.
  NSRect anchorOnScreen = [window convertRectToScreen:[view convertRect:view.bounds toView:nil]];
  assert(NSMaxY(contentView.window.frame) <= NSMinY(anchorOnScreen) + 1);
  // A size change resizes the open popover; an anchor rect moves it.
  Next(view, ^(SparkPopoverProps &p) { p.contentHeight = 120; p.anchorX = 10; p.anchorY = 4; p.anchorWidth = 20; p.anchorHeight = 10; });
  assert(NSEqualSizes(popover.contentSize, NSMakeSize(240, 120)) && NSEqualRects(popover.positioningRect, NSMakeRect(10, 4, 20, 10)));
  // Closing through props reports nothing; AppKit closing it (a click outside, Escape) reports onClose once.
  Next(view, ^(SparkPopoverProps &p) { p.visible = false; });
  Settle();
  assert(!popover.shown && closes == 0);
  Next(view, ^(SparkPopoverProps &p) { p.visible = true; p.edge = SparkPopoverEdge::Top; p.anchorWidth = 0; p.anchorHeight = 0; });
  Settle();
  assert(popover.shown && NSMinY(contentView.window.frame) >= NSMaxY(anchorOnScreen) - 1);
  [popover performClose:nil];
  Settle();
  assert(!popover.shown && closes == 1);
  // Hidden and shown again within the close animation: it reopens and reports nothing.
  Next(view, ^(SparkPopoverProps &p) { p.visible = false; });
  Next(view, ^(SparkPopoverProps &p) { p.visible = true; });
  Settle();
  assert(popover.shown && closes == 1);
  Next(view, ^(SparkPopoverProps &p) { p.visible = false; });
  Settle();
  assert(!popover.shown && closes == 1);
  // Content unmounts from the popover; removing the view from its window closes the popover.
  Next(view, ^(SparkPopoverProps &p) { p.visible = false; });
  Next(view, ^(SparkPopoverProps &p) { p.visible = true; });
  Settle(); assert(popover.shown);
  [view removeFromSuperview]; Settle();
  assert(!popover.shown && closes == 1);
  [view unmountChildComponentView:content index:1];
  assert(content.superview == nil && anchor.superview == view);
  puts("PASS popover");
} }
