#import <AppKit/AppKit.h>
#include <cassert>

@interface InsetBase : NSScrollView
@property NSEdgeInsets suppliedInsets;
@end
@implementation InsetBase
- (NSEdgeInsets)safeAreaInsets { return self.suppliedInsets; }
@end
// ACTUAL_ENUM
@interface InsetProbe : InsetBase
@property RCTScrollViewInsetAdjustment insetAdjustmentBehavior;
@end
@implementation InsetProbe
// ACTUAL_METHODS
@end
static bool same(NSEdgeInsets a, NSEdgeInsets b) {
  return a.top==b.top && a.left==b.left && a.bottom==b.bottom && a.right==b.right;
}
static void applied(InsetProbe *view, NSEdgeInsets expected) {
  view.contentInsets = view.suppliedInsets;
  // AppKit's native safe-area metadata must remain authoritative for pockets.
  assert(same(view.safeAreaInsets,view.suppliedInsets));
  assert(same(view.contentInsets,expected));
}
@compatibility_alias RCTUIScrollView InsetBase;
@compatibility_alias RCTEnhancedScrollView InsetProbe;
static void resetRecycledInsets(RCTUIScrollView *_scrollView) {
  bool _shouldUpdateContentInsetAdjustmentBehavior = false;
#if !TARGET_OS_OSX
  // ACTUAL_RECYCLE
  assert(_shouldUpdateContentInsetAdjustmentBehavior);
}
int main() { @autoreleasepool {
  [NSApplication sharedApplication];
  InsetProbe *view=[[InsetProbe alloc]initWithFrame:NSMakeRect(0,0,500,400)];
  view.automaticallyAdjustsContentInsets=NO;
  NSEdgeInsets full=NSEdgeInsetsMake(52,220,10,15);view.suppliedInsets=full;
  NSView *document=[[NSView alloc]initWithFrame:NSMakeRect(0,0,500,400)];view.documentView=document;
  assert(view.insetAdjustmentBehavior==RCTScrollViewInsetAdjustmentNever && !view.automaticallyAdjustsContentInsets);
  view.insetAdjustmentBehavior=RCTScrollViewInsetAdjustmentAutomatic;
  assert(view.automaticallyAdjustsContentInsets && same(view.safeAreaInsets,full));
  view.insetAdjustmentBehavior=RCTScrollViewInsetAdjustmentScrollableAxes;
  applied(view,NSEdgeInsetsZero);
  view.verticalScrollElasticity=NSScrollElasticityAllowed;
  applied(view,NSEdgeInsetsMake(52,0,10,0));
  view.horizontalScrollElasticity=NSScrollElasticityAllowed;
  applied(view,full);
  view.verticalScrollElasticity=NSScrollElasticityNone;
  view.horizontalScrollElasticity=NSScrollElasticityNone;
  document.frame=NSMakeRect(0,0,500,800);
  applied(view,NSEdgeInsetsMake(52,0,10,0));
  document.frame=NSMakeRect(0,0,1000,400);
  applied(view,NSEdgeInsetsMake(0,220,0,15));
  document.frame=NSMakeRect(0,0,1000,800);
  applied(view,full);
  view.insetAdjustmentBehavior=RCTScrollViewInsetAdjustmentAlways;
  document.frame=NSMakeRect(0,0,500,400);assert(same(view.safeAreaInsets,full));
  view.insetAdjustmentBehavior=RCTScrollViewInsetAdjustmentNever;
  assert(!view.automaticallyAdjustsContentInsets && same(view.safeAreaInsets,full));
  view.insetAdjustmentBehavior=RCTScrollViewInsetAdjustmentAlways;
  resetRecycledInsets(view);
  assert(!view.automaticallyAdjustsContentInsets && view.insetAdjustmentBehavior==RCTScrollViewInsetAdjustmentNever);
  puts("Native scroll-inset policy passed");
} return 0; }
