#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#include <memory>
#include <string>
#include <vector>
namespace facebook::react {
// Fabric transport types are stubbed; gesture/layout/animation code below is the real AppKit implementation.
struct Props { using Shared = std::shared_ptr<const Props>; virtual ~Props() = default; };
struct SwipeActionsProps : Props { std::string leadingActionsJson, trailingActionsJson; };
struct EventEmitter { using Shared = std::shared_ptr<const EventEmitter>; virtual ~EventEmitter() = default; };
struct SwipeActionsEventEmitter : EventEmitter {
  struct OnSwipeAction { std::string actionId; };
  mutable std::vector<std::string> actions;
  void onSwipeAction(OnSwipeAction event) const { actions.push_back(event.actionId); }
};
struct LayoutMetrics {}; struct SwipeActionsComponentDescriptor {};
using ComponentDescriptorProvider = int;
template<class T> int concreteComponentDescriptorProvider() { return 0; }
}
using namespace facebook::react;
@protocol RCTComponentViewProtocol @end
#define RCTUIView NSView
#define UIEvent NSEvent
@interface RCTViewComponentView : NSView {
@public Props::Shared _props; EventEmitter::Shared _eventEmitter;
}
@property (nonatomic) NSMutableArray<NSEvent *> *forwarded;
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps;
- (void)updateLayoutMetrics:(const LayoutMetrics &)metrics oldLayoutMetrics:(const LayoutMetrics &)old;
- (void)layoutSubviews;
- (void)prepareForRecycle;
- (NSView *)hitTest:(NSPoint)point withEvent:(UIEvent *)event;
@end
@implementation RCTViewComponentView
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps { _props = props; }
- (void)updateLayoutMetrics:(const LayoutMetrics &)metrics oldLayoutMetrics:(const LayoutMetrics &)old {}
- (void)layoutSubviews {}
- (void)prepareForRecycle { _eventEmitter.reset(); }
// Mirror the two entry points used by RCTUIKit: AppKit coordinates and Fabric local coordinates.
- (NSView *)hitTest:(NSPoint)point { return [self hitTest:[self convertPoint:point fromView:self.superview] withEvent:nil]; }
- (NSView *)hitTest:(NSPoint)point withEvent:(UIEvent *)event { return [super hitTest:[self convertPoint:point toView:self.superview]]; }
- (void)scrollWheel:(NSEvent *)event { if (!_forwarded) _forwarded = [NSMutableArray new]; [_forwarded addObject:event]; }
@end
@interface RNSwipeActions : RCTViewComponentView @end
// ACTUAL_IMPLEMENTATION
@interface ProbeContent : NSView <RCTComponentViewProtocol> @end
@implementation ProbeContent
- (BOOL)isFlipped { return YES; }
@end
@interface ProbeEvent : NSEvent
@property (nonatomic) NSEventPhase probePhase;
@property (nonatomic) NSEventPhase probeMomentum;
@property (nonatomic) CGFloat dx, dy;
@end
@implementation ProbeEvent
- (NSEventPhase)phase { return _probePhase; }
- (NSEventPhase)momentumPhase { return _probeMomentum; }
- (CGFloat)scrollingDeltaX { return _dx; }
- (CGFloat)scrollingDeltaY { return _dy; }
- (BOOL)isDirectionInvertedFromDevice { return YES; }
@end
static void Scroll(RNSwipeActions *row, NSEventPhase phase, CGFloat dx, CGFloat dy = 0, NSEventPhase momentum = NSEventPhaseNone) {
  ProbeEvent *event = [ProbeEvent new]; event.probePhase = phase; event.probeMomentum = momentum; event.dx = dx; event.dy = dy;
  [row scrollWheel:event];
}
static void Wait() {
  NSDate *until = [NSDate dateWithTimeIntervalSinceNow:0.45];
  while (until.timeIntervalSinceNow > 0) [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:until];
}
static void Check(BOOL condition, NSString *message) { if (!condition) { fprintf(stderr, "%s\n", message.UTF8String); exit(1); } }
static auto PropsFor(bool dismisses = true) {
  auto props = std::make_shared<SwipeActionsProps>();
  props->leadingActionsJson = std::string(R"([{"id":"archive","title":"Archive","symbol":"archivebox.fill","color":"#3E8E63","dismisses":)") + (dismisses ? "true" : "false") + "}]";
  props->trailingActionsJson = R"([{"id":"delete","title":"Delete","symbol":"trash.fill","color":"#C2362F","dismisses":true},{"id":"snooze","title":"Snooze","symbol":"clock.fill","color":"#D18F25","dismisses":false}])";
  return props;
}
static RNSwipeActions *Row(NSView *parent, bool dismisses = true, CGFloat width = 400) {
  RNSwipeActions *row = [[RNSwipeActions alloc] initWithFrame:NSMakeRect(0, 0, width, 60)];
  [parent addSubview:row]; row->_eventEmitter = std::make_shared<SwipeActionsEventEmitter>();
  [row updateProps:PropsFor(dismisses) oldProps:row->_props]; [row layoutSubviews]; return row;
}
static auto Emitter(RNSwipeActions *row) { return std::static_pointer_cast<const SwipeActionsEventEmitter>(row->_eventEmitter); }
int main(int argc, char **argv) { @autoreleasepool {
  [NSApplication sharedApplication];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(200, 200, 480, 240) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  window.title = @"Spark swipe integration probe"; [window orderFront:nil];
  RNSwipeActions *row = Row(window.contentView);
  std::string scenario = argc > 1 ? argv[1] : "normal";
  if (scenario == "cancel") {
    Scroll(row, NSEventPhaseBegan, 190); Scroll(row, NSEventPhaseCancelled, 0); Wait();
    Check(Emitter(row)->actions.empty(), @"Cancelled armed gesture fired archive");
    Check([[row valueForKey:@"offset"] doubleValue] == 0, @"Cancelled row did not close");
  } else if (scenario == "recycle") {
    Scroll(row, NSEventPhaseBegan, 190); Scroll(row, NSEventPhaseEnded, 0);
    [row prepareForRecycle]; row->_eventEmitter = std::make_shared<SwipeActionsEventEmitter>();
    [row updateProps:PropsFor() oldProps:row->_props]; Wait();
    Check(Emitter(row)->actions.empty(), @"Dismissal fired on recycled row's replacement emitter");
  } else if (scenario == "replace") {
    Scroll(row, NSEventPhaseBegan, 190); Scroll(row, NSEventPhaseEnded, 0);
    auto props = PropsFor(); props->leadingActionsJson = R"([{"id":"replacement","title":"New","symbol":"doc","color":"#000000"}])";
    [row updateProps:props oldProps:row->_props]; Wait();
    Check(Emitter(row)->actions.empty(), @"Obsolete dismissal fired after actions were replaced");
  } else if (scenario == "click-routing") {
    Scroll(row, NSEventPhaseBegan, 50); Scroll(row, NSEventPhaseEnded, 0); Wait();
    Check([row hitTest:NSMakePoint(100, 20) withEvent:nil] == row, @"Fabric hit-testing bypassed the close target");
  } else if (scenario == "clip") {
    row.layer.masksToBounds = NO; // Fabric applies visible overflow on its host layer.
    NSView *clip = [row valueForKey:@"clipView"];
    Check(clip.layer.masksToBounds && NSEqualRects(clip.frame, row.bounds), @"Private clipping was lost after a host layer update");
    row.frame = NSMakeRect(0, 0, 240, 60); [row layoutSubviews];
    Check(clip.layer.masksToBounds && clip.frame.size.width == 240, @"Private clip failed to resize");
  } else if (scenario == "button-click") {
    Scroll(row, NSEventPhaseBegan, -50); Scroll(row, NSEventPhaseEnded, 0); Wait();
    NSArray *buttons = [row valueForKey:@"trailing"];
    NSView *button = buttons[1]; NSPoint point = [button convertPoint:NSMakePoint(20, 20) toView:nil];
    NSEvent *click = [NSEvent mouseEventWithType:NSEventTypeLeftMouseUp location:point modifierFlags:0 timestamp:0 windowNumber:window.windowNumber context:nil eventNumber:1 clickCount:1 pressure:1];
    [button mouseDown:click]; [button mouseUp:click]; Wait();
    Check(Emitter(row)->actions == std::vector<std::string>{"snooze"}, @"Mouse click failed to report Snooze once");
  } else if (scenario == "click-close") {
    Scroll(row, NSEventPhaseBegan, 50); Scroll(row, NSEventPhaseEnded, 0); Wait();
    Check([row hitTest:NSMakePoint(100, 20)] == row, @"Open content did not consume its first click");
    [row mouseDown:[NSEvent mouseEventWithType:NSEventTypeLeftMouseDown location:NSZeroPoint modifierFlags:0 timestamp:0 windowNumber:window.windowNumber context:nil eventNumber:1 clickCount:1 pressure:1]]; Wait();
    Check([[row valueForKey:@"offset"] doubleValue] == 0 && Emitter(row)->actions.empty(), @"Content click did not close without action");
    row.hidden = YES; Check([row hitTest:NSMakePoint(100, 20)] == nil, @"Hidden row intercepted a click");
  } else if (scenario == "narrow") {
    auto props = PropsFor();
    props->trailingActionsJson = R"([{"id":"delete","title":"Delete","symbol":"trash.fill","color":"#C2362F","dismisses":true},{"id":"snooze","title":"Snooze","symbol":"clock.fill","color":"#D18F25","dismisses":false},{"id":"flag","title":"Flag","symbol":"flag","color":"#000000"}])";
    [row updateProps:props oldProps:row->_props];
    Scroll(row, NSEventPhaseBegan, -50); Scroll(row, NSEventPhaseEnded, 0); Wait();
    Scroll(row, NSEventPhaseBegan, 6); Scroll(row, NSEventPhaseEnded, 0); Wait();
    Check(Emitter(row)->actions.empty(), @"Small closing gesture on a resting row fired Delete");
  } else if (scenario == "child-layout") {
    ProbeContent *child = [[ProbeContent alloc] initWithFrame:NSMakeRect(0, 0, 400, 20)];
    [row mountChildComponentView:child index:0];
    NSPoint top = [row convertPoint:NSZeroPoint fromView:child];
    Check(top.y == 0, @"React child's top-left was moved to the bottom of the row");
    [row unmountChildComponentView:child index:0]; Check(child.superview == nil, @"Child remained mounted");
  } else if (scenario == "repeat") {
    Scroll(row, NSEventPhaseBegan, 190); Scroll(row, NSEventPhaseEnded, 0); Wait();
    Check(Emitter(row)->actions.size() == 1, @"First swipe failed");
    Scroll(row, NSEventPhaseEnded, 0); Wait();
    Check(Emitter(row)->actions.size() == 1, @"Duplicate ended event repeated a dismissal");
  } else if (scenario == "one-open") {
    Scroll(row, NSEventPhaseBegan, 50); Scroll(row, NSEventPhaseEnded, 0); Wait();
    RNSwipeActions *other = Row(window.contentView); other.frame = NSMakeRect(0, 80, 400, 60);
    Scroll(other, NSEventPhaseBegan, -50); Scroll(other, NSEventPhaseEnded, 0); Wait();
    Check([[row valueForKey:@"offset"] doubleValue] == 0, @"Second row did not close the first");
    Check([[other valueForKey:@"offset"] doubleValue] == -152, @"Second row did not open");
  } else if (scenario == "rubber") {
    auto props = PropsFor(); props->leadingActionsJson = "[]";
    [row updateProps:props oldProps:row->_props];
    Scroll(row, NSEventPhaseBegan, 100); Scroll(row, NSEventPhaseChanged, -100);
    Check(fabs([[row valueForKey:@"offset"] doubleValue]) < 0.001, @"Rubber band drifted after reversing");
    Scroll(row, NSEventPhaseEnded, 0); Wait(); Check(Emitter(row)->actions.empty(), @"Empty side fired an action");
  } else if (scenario == "hit") {
    Scroll(row, NSEventPhaseBegan, 50); Scroll(row, NSEventPhaseEnded, 0); Wait();
    Check([row hitTest:NSMakePoint(450, 20)] == nil, @"Open content intercepted a point outside the row");
  } else {
    Scroll(row, NSEventPhaseBegan, 1, 2); Scroll(row, NSEventPhaseChanged, 0, 8); Scroll(row, NSEventPhaseEnded, 0);
    Check(row.forwarded.count == 3, @"Vertical gesture was not replayed exactly once");
    Scroll(row, NSEventPhaseBegan, -50); Scroll(row, NSEventPhaseEnded, 0); Wait();
    Check([[row valueForKey:@"offset"] doubleValue] == -152, @"Partial trailing swipe did not rest at two buttons");
    Scroll(row, NSEventPhaseNone, -20, 20, NSEventPhaseChanged);
    Check(row.forwarded.count == 3, @"Horizontal momentum leaked to the scroll view");
    NSArray *buttons = [row valueForKey:@"trailing"]; [buttons[1] accessibilityPerformPress]; Wait();
    Check(Emitter(row)->actions == std::vector<std::string>{"snooze"}, @"Snooze did not report exactly once");
    Check([[row valueForKey:@"offset"] doubleValue] == 0, @"Snooze did not spring closed");
    Scroll(row, NSEventPhaseBegan, 190); Scroll(row, NSEventPhaseEnded, 0); Wait();
    Check(Emitter(row)->actions == std::vector<std::string>{"snooze", "archive"}, @"Full swipe did not commit the outer action");
  }
  puts(("PASS " + scenario).c_str());
} }
