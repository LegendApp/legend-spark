#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#include <cmath>
#include <cstdio>
#include <cstring>
namespace facebook::react {
// Fabric layout types are stubbed; the scroll view methods below are the patched RN macOS source.
enum class LayoutDirection { Undefined, LeftToRight, RightToLeft };
struct LayoutMetrics { CGRect frame; LayoutDirection layoutDirection; };
struct Point { CGFloat x, y; };
struct ScrollViewStateData { struct { Point origin; } contentBoundingRect; };
}
using namespace facebook::react;
static CGPoint RCTCGPointFromPoint(facebook::react::Point point) { return {point.x, point.y}; }

// RCTUIKit's UIScrollView shims over NSScrollView, and a flipped RCTUIView.
@interface RCTUIScrollView : NSScrollView
@property (nonatomic) CGPoint contentOffset;
@property (nonatomic) CGSize contentSize;
@end
@implementation RCTUIScrollView
- (CGPoint)contentOffset { return self.documentVisibleRect.origin; }
- (void)setContentOffset:(CGPoint)offset { [self.documentView scrollPoint:offset]; }
- (CGSize)contentSize { return self.documentView.frame.size; }
- (void)setContentSize:(CGSize)size { NSRect frame = self.documentView.frame; frame.size = size; self.documentView.frame = frame; }
@end
@interface RCTUIView : NSView
@end
@implementation RCTUIView
- (BOOL)isFlipped { return YES; }
@end

// RCTViewComponentView applies the frame, then records the metrics.
@interface RCTViewComponentView : RCTUIView {
@public LayoutMetrics _layoutMetrics;
}
- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics;
@end
@implementation RCTViewComponentView
- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  self.frame = layoutMetrics.frame;
  _layoutMetrics = layoutMetrics;
}
@end

// ACTUAL_HELPER

@interface RCTScrollViewComponentView : RCTViewComponentView {
@public RCTUIScrollView *_scrollView; RCTUIView *_containerView;
}
@end
@implementation RCTScrollViewComponentView
- (instancetype)initWithFrame:(NSRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _layoutMetrics = {frame, LayoutDirection::LeftToRight};
    self.wantsLayer = YES;
    _scrollView = [[RCTUIScrollView alloc] initWithFrame:self.bounds];
    _scrollView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    _scrollView.scrollerStyle = NSScrollerStyleOverlay;
    _scrollView.hasHorizontalScroller = YES;
    [self addSubview:_scrollView];
    _containerView = [[RCTUIView alloc] initWithFrame:NSZeroRect];
    _containerView.wantsLayer = YES;
    [_scrollView setDocumentView:_containerView];
  }
  return self;
}
// ACTUAL_UPDATE_LAYOUT_METRICS
- (void)_preserveContentOffsetIfNeededWithBlock:(void (^)())block { block(); }
// The content size step of updateState:, from the patched source.
- (void)setContent:(CGFloat)width
{
  ScrollViewStateData data{};
  CGSize contentSize = {width, _scrollView.frame.size.height};
// ACTUAL_CONTENT_SIZE
}
@end

static int failures = 0;
static void expectNear(const char *what, CGFloat actual, CGFloat expected)
{
  if (std::fabs(actual - expected) > 0.5) { std::printf("FAIL %s: %g, expected %g\n", what, actual, expected); failures++; }
}
static void layout(RCTScrollViewComponentView *view, CGFloat width, LayoutDirection direction)
{
  [view updateLayoutMetrics:{{{0, 0}, {width, 100}}, direction} oldLayoutMetrics:view->_layoutMetrics];
}
// Twelve 100pt cells; Yoga places cell 1 at the right in RTL, as the shadow tree does.
static void addCells(RCTScrollViewComponentView *view, BOOL rtl)
{
  for (int index = 0; index < 12; index++) {
    RCTUIView *cell = [[RCTUIView alloc] initWithFrame:NSMakeRect(rtl ? 1100 - index * 100 : index * 100, 0, 100, 100)];
    cell.identifier = [NSString stringWithFormat:@"%d", index + 1];
    [view->_containerView addSubview:cell];
  }
}

int main(int argc, const char **argv)
{
  @autoreleasepool {
    const char *scenario = argc > 1 ? argv[1] : "";
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 600, 200) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
    RCTScrollViewComponentView *view = [[RCTScrollViewComponentView alloc] initWithFrame:NSMakeRect(0, 0, 300, 100)];
    [window.contentView addSubview:view];
    if (!std::strcmp(scenario, "rtl-start")) {
      // Fabric applies state (content size) before the first RTL layout metrics.
      [view setContent:1200];
      layout(view, 300, LayoutDirection::RightToLeft);
      expectNear("RTL start offset (right end)", view->_scrollView.contentOffset.x, 900);
      // Upstream set a scale(-1, 1) layer transform on the layer-backed container.
      if (!CATransform3DIsIdentity(view->_containerView.layer.transform) || (view->_scrollView.layer && !CATransform3DIsIdentity(view->_scrollView.layer.transform))) {
        std::printf("FAIL RTL mirrored a layer\n"); failures++;
      }
    } else if (!std::strcmp(scenario, "first-content")) {
      layout(view, 300, LayoutDirection::RightToLeft);
      [view setContent:1200];
      expectNear("offset after first content", view->_scrollView.contentOffset.x, 900);
    } else if (!std::strcmp(scenario, "content-growth")) {
      layout(view, 300, LayoutDirection::RightToLeft);
      [view setContent:1200];
      view->_scrollView.contentOffset = CGPointMake(500, 0);
      [view setContent:1500];
      expectNear("distance from right end after growth", view->_scrollView.contentOffset.x, 800);
      [view setContent:400];
      expectNear("offset after shrinking", view->_scrollView.contentOffset.x, 0);
    } else if (!std::strcmp(scenario, "resize")) {
      layout(view, 300, LayoutDirection::RightToLeft);
      [view setContent:1200];
      layout(view, 500, LayoutDirection::RightToLeft);
      expectNear("right end after widening", view->_scrollView.contentOffset.x, 700);
    } else if (!std::strcmp(scenario, "ltr")) {
      layout(view, 300, LayoutDirection::LeftToRight);
      [view setContent:1200];
      expectNear("LTR start offset", view->_scrollView.contentOffset.x, 0);
      view->_scrollView.contentOffset = CGPointMake(200, 0);
      [view setContent:1500];
      layout(view, 500, LayoutDirection::LeftToRight);
      expectNear("LTR offset is kept", view->_scrollView.contentOffset.x, 200);
    } else if (!std::strcmp(scenario, "vertical")) {
      layout(view, 300, LayoutDirection::RightToLeft);
      [view setContent:300];
      expectNear("vertical RTL offset", view->_scrollView.contentOffset.x, 0);
    } else if (!std::strcmp(scenario, "hit")) {
      [view setContent:1200];
      addCells(view, YES);
      layout(view, 300, LayoutDirection::RightToLeft);
      // AppKit routes the click at the right edge to cell 1, the first RTL cell, unmirrored.
      NSView *hit = [window.contentView hitTest:[view convertPoint:NSMakePoint(290, 50) toView:window.contentView]];
      if (![hit.identifier isEqualToString:@"1"]) { std::printf("FAIL right edge hit %s, expected cell 1\n", hit.identifier.UTF8String); failures++; }
      hit = [window.contentView hitTest:[view convertPoint:NSMakePoint(10, 50) toView:window.contentView]];
      if (![hit.identifier isEqualToString:@"3"]) { std::printf("FAIL left edge hit %s, expected cell 3\n", hit.identifier.UTF8String); failures++; }
    } else {
      std::printf("FAIL unknown scenario %s\n", scenario);
      return 2;
    }
    if (failures) return 1;
    std::printf("PASS %s\n", scenario);
  }
  return 0;
}
