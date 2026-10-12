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
namespace facebook::react {
using Float = double;
struct Point { Float x, y; };
struct Size { Float width, height; bool operator==(const Size &) const = default; };
struct Rect { Point origin; Size size; };
struct LayoutMetrics {
  Rect frame{};
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
  void onSplitViewDidResize(OnSplitViewDidResize event) const {}
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
