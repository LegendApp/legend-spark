#import <AppKit/AppKit.h>
#include <memory>
#include <string>
#include <cassert>
namespace facebook::react {
// Fabric transport types are stubbed; the sheet code below is the real AppKit implementation.
struct Props { using Shared = std::shared_ptr<const Props>; virtual ~Props() = default; };
struct SparkSheetProps : Props { bool visible = false; double contentWidth = 0, contentHeight = 0; std::string accessibilityLabel; };
struct EventEmitter { using Shared = std::shared_ptr<const EventEmitter>; virtual ~EventEmitter() = default; };
static int cancels = 0, dismisses = 0;
static NSView *dismissedContentSuperview;
struct SparkSheetEventEmitter : EventEmitter {
  struct OnCancel {}; struct OnDismiss {};
  void onCancel(OnCancel) const { ++cancels; }
  void onDismiss(OnDismiss) const;
};
enum class LayoutDirection { Undefined, LeftToRight, RightToLeft };
struct LayoutMetrics { LayoutDirection layoutDirection = LayoutDirection::Undefined; };
struct SparkSheetComponentDescriptor {};
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
@interface RNSparkSheet : RCTViewComponentView @end
static Child *content;
void SparkSheetEventEmitter::onDismiss(OnDismiss) const { ++dismisses; dismissedContentSuperview = content.superview; }
// ACTUAL_IMPLEMENTATION
static void Wait(const char *step, BOOL (^condition)(void)) {
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:5];
  while (!condition() && deadline.timeIntervalSinceNow > 0) [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
  if (!condition()) { fprintf(stderr, "timed out: %s\n", step); exit(1); }
  [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
}
static void Next(RNSparkSheet *view, void (^change)(SparkSheetProps &)) {
  auto props = std::make_shared<SparkSheetProps>(*std::static_pointer_cast<const SparkSheetProps>(view->_props));
  change(*props); [view updateProps:props oldProps:view->_props];
}
int main() { @autoreleasepool {
  [NSApplication sharedApplication]; [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(200, 300, 600, 400) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  RNSparkSheet *view = [RNSparkSheet new];
  view->_eventEmitter = std::make_shared<SparkSheetEventEmitter>();
  view->_props = std::make_shared<SparkSheetProps>();
  content = [Child new];
  [view mountChildComponentView:content index:0];
  NSWindow *sheet = [view valueForKey:@"sheet"];
  assert(content.superview == sheet.contentView && sheet.contentView.isFlipped);
  assert([[view valueForKey:@"touchHandler"] attached] == sheet.contentView);
  // Visible before it is in a window or has a content size: nothing shows yet.
  Next(view, ^(SparkSheetProps &p) { p.visible = true; });
  [window.contentView addSubview:view];
  [window orderFront:nil];
  assert(window.attachedSheet == nil);
  Next(view, ^(SparkSheetProps &p) { p.contentWidth = 360; p.contentHeight = 180; p.accessibilityLabel = "New Branch"; });
  Wait("attached", ^BOOL { return window.attachedSheet == sheet && sheet.visible; });
  assert(NSEqualSizes(sheet.contentView.frame.size, NSMakeSize(360, 180)) && sheet.sheetParent == window && [sheet.contentView.accessibilityLabel isEqual:@"New Branch"]);
  // A size change resizes the open sheet.
  Next(view, ^(SparkSheetProps &p) { p.contentHeight = 220; });
  assert(NSEqualSizes(sheet.contentView.frame.size, NSMakeSize(360, 220)));
  // Escape reports onCancel and leaves the sheet up; closing is the parent's choice.
  [sheet cancelOperation:nil];
  assert(cancels == 1 && window.attachedSheet == sheet);
  Next(view, ^(SparkSheetProps &p) { p.visible = false; });
  Wait("ended", ^BOOL { return window.attachedSheet == nil && !sheet.visible; });
  // onDismiss follows the close animation, with the content still in the sheet, so React unmounts it only then.
  assert(dismisses == 1 && dismissedContentSuperview == sheet.contentView);
  [sheet cancelOperation:nil];
  assert(cancels == 1);
  // Shown again, then hidden and shown within the same turn: it stays attached.
  Next(view, ^(SparkSheetProps &p) { p.visible = true; });
  Wait("attached again", ^BOOL { return window.attachedSheet == sheet && sheet.visible; });
  Next(view, ^(SparkSheetProps &p) { p.visible = false; });
  Next(view, ^(SparkSheetProps &p) { p.visible = true; });
  Wait("reattached", ^BOOL { return window.attachedSheet == sheet && sheet.visible; });
  // The brief hide still reports onDismiss; React ignores it, since visible is true again.
  assert(dismisses == 2);
  // Recycling ends the sheet.
  [view prepareForRecycle];
  Wait("ended on recycle", ^BOOL { return window.attachedSheet == nil; });
  [view unmountChildComponentView:content index:0];
  assert(content.superview == nil);
  // A sheet that never showed (no size yet) still reports onDismiss when hidden, so its content unmounts.
  RNSparkSheet *unsized = [RNSparkSheet new];
  unsized->_eventEmitter = std::make_shared<SparkSheetEventEmitter>(); unsized->_props = std::make_shared<SparkSheetProps>();
  [window.contentView addSubview:unsized];
  Next(unsized, ^(SparkSheetProps &p) { p.visible = true; });
  Next(unsized, ^(SparkSheetProps &p) { p.visible = false; });
  assert(dismisses == 3);
  // Closing the parent window ends an open sheet, and neither the sheet nor the view keeps the closed window alive.
  __weak NSWindow *closed;
  RNSparkSheet *orphan = [RNSparkSheet new];
  orphan->_eventEmitter = std::make_shared<SparkSheetEventEmitter>(); orphan->_props = std::make_shared<SparkSheetProps>();
  NSWindow *orphanSheet = [orphan valueForKey:@"sheet"];
  @autoreleasepool {
    NSWindow *parent = [[NSWindow alloc] initWithContentRect:NSMakeRect(250, 350, 600, 400) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
    parent.releasedWhenClosed = NO; closed = parent;
    [parent.contentView addSubview:orphan]; [parent orderFront:nil];
    Next(orphan, ^(SparkSheetProps &p) { p.visible = true; p.contentWidth = 200; p.contentHeight = 100; });
    Wait("orphan attached", ^BOOL { return closed.attachedSheet == orphanSheet; });
    [parent close];
  }
  Wait("closed window released", ^BOOL { return closed == nil; });
  assert(orphanSheet.sheetParent == nil && !orphanSheet.visible);
  puts("PASS sheet");
} }
