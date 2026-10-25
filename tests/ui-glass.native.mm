#import <AppKit/AppKit.h>
#include <string>
// React Native's view base classes are stubbed; the glass view and its AppKit hierarchy are the real implementation.
@interface RCTView : NSView
@property (nonatomic, readonly) NSMutableArray<NSView *> *reactSubviews; // nil until the first insert, as in UIView+React
- (void)insertReactSubview:(NSView *)subview atIndex:(NSInteger)index;
- (void)removeReactSubview:(NSView *)subview;
- (void)didUpdateReactSubviews;
@end
@implementation RCTView {
  NSMutableArray<NSView *> *_reactSubviews;
}
- (NSMutableArray<NSView *> *)reactSubviews { return _reactSubviews; }
- (void)insertReactSubview:(NSView *)subview atIndex:(NSInteger)index { if (!_reactSubviews) _reactSubviews = [NSMutableArray new]; [_reactSubviews insertObject:subview atIndex:index]; }
// Matches UIView+React: removal detaches the view without a didUpdateReactSubviews call.
- (void)removeReactSubview:(NSView *)subview { [self.reactSubviews removeObject:subview]; [subview removeFromSuperview]; }
- (void)didUpdateReactSubviews {}
@end
@interface RCTViewManager : NSObject @end
@implementation RCTViewManager @end
@interface RCTConvert : NSObject + (NSColor *)NSColor:(id)json; @end
@implementation RCTConvert + (NSColor *)NSColor:(id)json { return nil; } @end
#define RCT_EXPORT_MODULE()
#define RCT_EXPORT_VIEW_PROPERTY(name, type)
#define RCT_CUSTOM_VIEW_PROPERTY(name, type, viewClass) - (void)set_##name:(id)json forView:(viewClass *)view
static bool SparkGlassAvailable;
// ACTUAL_IMPLEMENTATION
// React Native macOS component views are flipped and framed by Fabric in their parent's top-left coordinates.
@interface ProbeChild : NSView @end
@implementation ProbeChild
- (BOOL)isFlipped { return YES; }
@end
static void Check(BOOL condition, NSString *message) { if (!condition) { fprintf(stderr, "%s\n", message.UTF8String); exit(1); } }
// NSView's hitTest: takes a point in the superview's coordinates; tests pass points in root coordinates.
static NSView *Hit(NSView *root, NSPoint point) { return [root hitTest:[root.superview convertPoint:point fromView:root]]; }
static ProbeChild *Child(NSRect frame) { ProbeChild *child = [[ProbeChild alloc] initWithFrame:frame]; child.wantsLayer = YES; return child; }

int main(int argc, char **argv) { @autoreleasepool {
  [NSApplication sharedApplication];
  std::string scenario = argc > 1 ? argv[1] : "glass";
  SparkGlassAvailable = scenario == "glass";
  if (SparkGlassAvailable && !NSClassFromString(@"NSGlassEffectView")) { printf("PASS %s (NSGlassEffectView unavailable)\n", scenario.c_str()); return 0; }
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 500, 400) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:YES];
  // Fabric's root component view is flipped; its touch handler hit-tests it with AppKit's hitTest:.
  ProbeChild *root = Child(NSMakeRect(0, 0, 500, 400));
  window.contentView = root;
  SparkGlassView *glass = [[SparkGlassView alloc] initWithFrame:NSMakeRect(90, 110, 320, 180)];
  [root addSubview:glass];
  [glass layoutSubtreeIfNeeded];
  Check(SparkGlassAvailable == [glass.subviews.firstObject isKindOfClass:NSClassFromString(@"NSGlassEffectView")], @"Wrong glass hierarchy for this OS path");

  [glass didUpdateReactSubviews];
  Check(glass.subviews.count == 1, @"An update before the first child changed the glass hierarchy");

  // Glass.tsx: a title above a subtitle, centred in a 320x180 box.
  ProbeChild *title = Child(NSMakeRect(80, 60, 160, 24)), *subtitle = Child(NSMakeRect(60, 94, 200, 20));
  [glass insertReactSubview:title atIndex:0];
  [glass insertReactSubview:subtitle atIndex:1];
  [glass didUpdateReactSubviews];
  NSView *container = title.superview;
  Check(container && container.isFlipped, @"React children are hosted in an unflipped container");
  Check([container.subviews isEqualToArray:(@[title, subtitle])], @"Hosted children are not in React order");
  Check(NSEqualRects([root convertRect:title.bounds fromView:title], NSMakeRect(170, 170, 160, 24)), @"Title frame is not top-left relative to the glass view");
  Check(NSEqualRects([root convertRect:subtitle.bounds fromView:subtitle], NSMakeRect(150, 204, 200, 20)), @"Subtitle frame is not top-left relative to the glass view");
  Check(NSMinY([title convertRect:title.bounds toView:nil]) > NSMaxY([subtitle convertRect:subtitle.bounds toView:nil]), @"Title is not drawn above the subtitle in the window");
  Check(Hit(root, NSMakePoint(250, 180)) == title, @"Hit-test above the subtitle did not reach the title");
  Check(Hit(root, NSMakePoint(250, 214)) == subtitle, @"Hit-test on the subtitle did not reach the subtitle");

  // A child inserted before existing ones keeps React order, so overlap and hit-testing follow React.
  ProbeChild *backdrop = Child(NSMakeRect(0, 0, 320, 180));
  [glass insertReactSubview:backdrop atIndex:0];
  [glass didUpdateReactSubviews];
  Check([container.subviews isEqualToArray:(@[backdrop, title, subtitle])], @"Inserted child is not in React order");
  Check(Hit(root, NSMakePoint(250, 180)) == title, @"Earlier React child covers a later one");
  Check(Hit(root, NSMakePoint(100, 120)) == backdrop, @"Backdrop child is not hit outside its siblings");
  [glass removeReactSubview:backdrop];
  Check(backdrop.superview == nil && [container.subviews isEqualToArray:(@[title, subtitle])], @"Removed child remained hosted");

  // Resizing keeps children anchored to the top-left, as Fabric expects between commits.
  glass.frame = NSMakeRect(90, 110, 360, 260);
  [glass layoutSubtreeIfNeeded];
  Check(NSEqualRects(container.frame, container.superview.bounds) && NSEqualSizes(container.bounds.size, NSMakeSize(360, 260)), @"Container does not fill the resized glass view");
  Check(NSEqualRects([root convertRect:title.bounds fromView:title], NSMakeRect(170, 170, 160, 24)), @"Title moved when the glass view grew");

  // RTL: Fabric mirrors x; the container must use it unchanged.
  window.contentView.userInterfaceLayoutDirection = NSUserInterfaceLayoutDirectionRightToLeft;
  glass.userInterfaceLayoutDirection = NSUserInterfaceLayoutDirectionRightToLeft;
  container.userInterfaceLayoutDirection = NSUserInterfaceLayoutDirectionRightToLeft;
  title.frame = NSMakeRect(200, 60, 160, 24);
  Check(NSEqualRects([root convertRect:title.bounds fromView:title], NSMakeRect(290, 170, 160, 24)), @"RTL frame was altered by the container");
  printf("PASS %s\n", scenario.c_str());
} return 0; }
