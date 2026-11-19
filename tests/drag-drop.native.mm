#import <AppKit/AppKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#include <memory>
#include <string>
#include <vector>

namespace facebook::react {
struct Props { using Shared = std::shared_ptr<const Props>; };
struct DesktopDragViewProps : Props { std::string sourceJson, optionsJson; bool disabled = false; };
struct DesktopDragViewEventEmitter {
  struct Payload { std::string json; };
  mutable std::vector<std::string> sourceEvents;
  void onDragStart(Payload) const { sourceEvents.push_back("start"); }
  void onDragEnd(Payload) const { sourceEvents.push_back("end"); }
  void onDragEnter(Payload) const {}
  void onDragOver(Payload) const {}
  void onDragLeave(Payload) const {}
  void onDrop(Payload) const {}
};
struct DesktopDragViewComponentDescriptor {};
using ComponentDescriptorProvider = int;
template<class T> int concreteComponentDescriptorProvider() { return 0; }
}
using namespace facebook::react;
#define UIEvent NSEvent
@interface RCTViewComponentView : NSView {
@public
  Props::Shared _props;
  std::shared_ptr<const DesktopDragViewEventEmitter> _eventEmitter;
}
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps;
- (void)prepareForRecycle;
- (NSView *)hitTest:(NSPoint)point withEvent:(UIEvent *)event;
@end

@implementation RCTViewComponentView
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps { _props = props; }
- (void)prepareForRecycle { _eventEmitter.reset(); }
- (NSView *)hitTest:(NSPoint)point { return [self hitTest:[self convertPoint:point fromView:self.superview] withEvent:nil]; }
- (NSView *)hitTest:(NSPoint)point withEvent:(UIEvent *)event { return [super hitTest:[self convertPoint:point toView:self.superview]]; }
@end

@interface RNDesktopDragView : RCTViewComponentView <NSDraggingSource>
@end
// ACTUAL_IMPLEMENTATION

@interface ProbeSource : RNDesktopDragView
@property (nonatomic) NSInteger attempts;
@property (nonatomic, strong) NSDraggingSession *session;
@end
@implementation ProbeSource
- (NSDraggingSession *)beginDraggingSessionWithItems:(NSArray<NSDraggingItem *> *)items event:(NSEvent *)event source:(id<NSDraggingSource>)source {
  self.attempts++;
  self.session = (NSDraggingSession *)[NSObject new];
  return self.session;
}
@end

static void Check(bool condition, const char *message) {
  if (!condition) { fprintf(stderr, "%s\n", message); exit(1); }
}

static NSEvent *Mouse(NSWindow *window, NSEventType type, NSPoint point) {
  return [NSEvent mouseEventWithType:type location:point modifierFlags:0 timestamp:0 windowNumber:window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:1];
}

int main() {
  @autoreleasepool {
    [NSApplication sharedApplication];
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 240, 160) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
    ProbeSource *view = [ProbeSource new];
    view.frame = NSMakeRect(0, 0, 240, 160);
    [window.contentView addSubview:view];
    NSButton *child = [[NSButton alloc] initWithFrame:NSMakeRect(0, 0, 100, 25)];
    [view addSubview:child];
    auto props = std::make_shared<DesktopDragViewProps>();
    props->sourceJson = R"({"text":"drag me"})";
    [view updateProps:props oldProps:nullptr];
    auto emitter = std::make_shared<DesktopDragViewEventEmitter>();
    view->_eventEmitter = emitter;
    NSPoint local = NSMakePoint(10, 10);
    Check([view hitTest:local withEvent:nil] == child, "A configured drag source intercepted its child's hit");
    NSPoint down = [view convertPoint:local toView:nil];
    NSGestureRecognizer *gesture = view.gestureRecognizers.firstObject;
    [gesture mouseDown:Mouse(window, NSEventTypeLeftMouseDown, down)];
    [gesture mouseDragged:Mouse(window, NSEventTypeLeftMouseDragged, NSMakePoint(down.x + 3, down.y))];
    Check(view.attempts == 0 && emitter->sourceEvents.empty(), "A subthreshold movement started a drag");
    [gesture mouseDragged:Mouse(window, NSEventTypeLeftMouseDragged, NSMakePoint(down.x + 8, down.y))];
    Check(view.attempts == 1 && emitter->sourceEvents.empty(), "The threshold should request a session without emitting a drag start yet");
    [gesture mouseDragged:Mouse(window, NSEventTypeLeftMouseDragged, NSMakePoint(down.x + 20, down.y))];
    Check(view.attempts == 1, "A drag requested multiple sessions");
    [view draggingSession:view.session willBeginAtPoint:NSZeroPoint];
    [view draggingSession:view.session endedAtPoint:NSZeroPoint operation:NSDragOperationCopy];
    Check(emitter->sourceEvents == std::vector<std::string>{"start", "end"}, "The source events did not follow the session lifecycle");
    puts("Drag source passed");
  }
}
