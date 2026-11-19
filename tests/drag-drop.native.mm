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
@property (nonatomic, copy) NSArray<NSDraggingItem *> *items;
@end
@implementation ProbeSource
- (NSDraggingSession *)beginDraggingSessionWithItems:(NSArray<NSDraggingItem *> *)items event:(NSEvent *)event source:(id<NSDraggingSource>)source {
  self.attempts++;
  self.items = items;
  self.session = (NSDraggingSession *)[NSObject new];
  return self.session;
}
@end

@interface PreviewTile : NSView
@end
@implementation PreviewTile
- (void)drawRect:(NSRect)dirtyRect {
  [[NSColor colorWithSRGBRed:1 green:0 blue:0 alpha:1] setFill];
  NSRectFill(NSIntersectionRect(self.bounds, dirtyRect));
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
    Check(NSEqualRects(view.items.firstObject.draggingFrame, NSMakeRect(0, 0, 32, 32)), "The default drag lost its icon frame");
    NSImage *icon = view.items.firstObject.imageComponents.firstObject.contents;
    Check(icon.isTemplate, "The default drag lost its document symbol");
    [gesture mouseDragged:Mouse(window, NSEventTypeLeftMouseDragged, NSMakePoint(down.x + 20, down.y))];
    Check(view.attempts == 1, "A drag requested multiple sessions");
    [view draggingSession:view.session willBeginAtPoint:NSZeroPoint];
    [view draggingSession:view.session endedAtPoint:NSZeroPoint operation:NSDragOperationCopy];
    Check(emitter->sourceEvents == std::vector<std::string>{"start", "end"}, "The source events did not follow the session lifecycle");
    PreviewTile *tile = [[PreviewTile alloc] initWithFrame:NSMakeRect(100, 60, 40, 40)];
    [view addSubview:tile];
    auto snapshotProps = std::make_shared<DesktopDragViewProps>();
    snapshotProps->sourceJson = R"({"text":"drag me","urls":["https://example.com"]})";
    snapshotProps->optionsJson = R"({"dragPreview":"snapshot"})";
    [view updateProps:snapshotProps oldProps:props];
    NSEvent *drag = Mouse(window, NSEventTypeLeftMouseDragged, NSMakePoint(down.x + 8, down.y));
    Check([view beginDragFromMouseEvent:drag], "Snapshot mode prevented the session");
    Check(view.items.count == 2, "Snapshot mode discarded pasteboard writers");
    Check(NSEqualRects(view.items.firstObject.draggingFrame, view.bounds), "The preview did not use the source frame");
    NSImage *preview = view.items.firstObject.imageComponents.firstObject.contents;
    NSBitmapImageRep *bitmap = (NSBitmapImageRep *)preview.representations.firstObject;
    Check([bitmap isKindOfClass:NSBitmapImageRep.class], "The drag image was not a bitmap snapshot");
    NSColor *pixel = [bitmap colorAtX:bitmap.pixelsWide / 2 y:bitmap.pixelsHigh / 2];
    Check(pixel.redComponent > 0.9 && pixel.greenComponent < 0.1 && pixel.alphaComponent > 0.9, "The snapshot did not include the source's child");
    Check(view.items.lastObject.imageComponents.count == 0, "The second writer added another preview");
    [view draggingSession:view.session endedAtPoint:NSZeroPoint operation:NSDragOperationNone];

    view.frame = NSZeroRect;
    Check([view beginDragFromMouseEvent:drag], "A source with empty bounds could not fall back");
    Check(NSEqualRects(view.items.firstObject.draggingFrame, NSMakeRect(0, 0, 32, 32)), "An empty snapshot did not fall back to the icon");
    puts("Drag source passed");
  }
}
