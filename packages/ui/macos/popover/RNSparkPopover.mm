#import "RNSparkPopover.h"
#import "RNSparkLayoutDirection.h"
#import <React/RCTSurfaceTouchHandler.h>
#import <react/renderer/components/RNSparkUISpec/ComponentDescriptors.h>
#import <react/renderer/components/RNSparkUISpec/EventEmitters.h>
#import <react/renderer/components/RNSparkUISpec/Props.h>
using namespace facebook::react;

@interface RNSparkPopoverContentView : NSView
@end
@implementation RNSparkPopoverContentView
- (BOOL)isFlipped { return YES; }
@end

// The first React child (the anchor) stays in this view; the second (the content) moves into an
// NSPopover shown relative to this view. The content keeps its own touch handler, since the
// surface's handler only sees its own window.
@interface RNSparkPopover () <NSPopoverDelegate>
@end
@implementation RNSparkPopover {
  NSPopover *_popover;
  RNSparkPopoverContentView *_contentView;
  RCTSurfaceTouchHandler *_touchHandler;
  NSView *_content;
  BOOL _visible;
  BOOL _closingFromProps;
  NSSize _contentSize;
  NSRect _anchorRect;
  SparkPopoverEdge _edge;
}
- (instancetype)init {
  if (self = [super init]) {
    _props = std::make_shared<const SparkPopoverProps>();
    _contentView = [[RNSparkPopoverContentView alloc] initWithFrame:NSZeroRect];
    NSViewController *controller = [NSViewController new];
    controller.view = _contentView;
    _popover = [NSPopover new];
    _popover.contentViewController = controller;
    _popover.delegate = self;
    _touchHandler = [RCTSurfaceTouchHandler new];
    [_touchHandler attachToView:_contentView];
  }
  return self;
}
- (BOOL)isFlipped { return YES; }
- (void)mountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index {
  if (index == 1) {
    _content = childComponentView;
    [_contentView addSubview:childComponentView];
    return;
  }
  [super mountChildComponentView:childComponentView index:index];
}
- (void)unmountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index {
  if (childComponentView == _content) {
    [childComponentView removeFromSuperview];
    _content = nil;
    return;
  }
  [super unmountChildComponentView:childComponentView index:index];
}
- (NSRect)positioningRect {
  return _anchorRect.size.width > 0 || _anchorRect.size.height > 0 ? _anchorRect : self.bounds;
}
- (NSRectEdge)preferredEdge {
  BOOL rtl = self.userInterfaceLayoutDirection == NSUserInterfaceLayoutDirectionRightToLeft;
  switch (_edge) {
    case SparkPopoverEdge::Top: return NSRectEdgeMinY;
    case SparkPopoverEdge::Leading: return rtl ? NSRectEdgeMaxX : NSRectEdgeMinX;
    case SparkPopoverEdge::Trailing: return rtl ? NSRectEdgeMinX : NSRectEdgeMaxX;
    default: return NSRectEdgeMaxY;
  }
}
- (void)updatePresentation {
  BOOL show = _visible && _contentSize.width > 0 && _contentSize.height > 0 && self.window != nil;
  if (!show) {
    if (_popover.shown) { _closingFromProps = YES; [_popover performClose:nil]; _closingFromProps = NO; }
    return;
  }
  if (!NSEqualSizes(_popover.contentSize, _contentSize)) _popover.contentSize = _contentSize;
  if (_popover.shown) {
    if (!NSEqualRects(_popover.positioningRect, self.positioningRect)) _popover.positioningRect = self.positioningRect;
    return;
  }
  [_popover showRelativeToRect:self.positioningRect ofView:self preferredEdge:self.preferredEdge];
}
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps {
  const auto &next = *std::static_pointer_cast<const SparkPopoverProps>(props);
  _visible = next.visible;
  _contentSize = NSMakeSize(MAX(0, next.contentWidth), MAX(0, next.contentHeight));
  _anchorRect = NSMakeRect(next.anchorX, next.anchorY, MAX(0, next.anchorWidth), MAX(0, next.anchorHeight));
  _edge = next.edge;
  _popover.behavior = next.behavior == SparkPopoverBehavior::Semitransient ? NSPopoverBehaviorSemitransient
    : next.behavior == SparkPopoverBehavior::ApplicationDefined ? NSPopoverBehaviorApplicationDefined : NSPopoverBehaviorTransient;
  [super updateProps:props oldProps:oldProps];
  [self updatePresentation];
}
- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics {
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  self.userInterfaceLayoutDirection = RNSparkLayoutDirection(layoutMetrics);
  if (_popover.shown) _popover.positioningRect = self.positioningRect;
}
- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  [self updatePresentation];
}
- (void)popoverDidClose:(NSNotification *)notification {
  if (_closingFromProps || !_visible) return;
  auto emitter = std::static_pointer_cast<const SparkPopoverEventEmitter>(_eventEmitter);
  if (emitter) emitter->onClose({});
}
- (void)prepareForRecycle {
  _visible = NO;
  [self updatePresentation];
  _contentSize = NSZeroSize;
  _anchorRect = NSZeroRect;
  [super prepareForRecycle];
}
+ (ComponentDescriptorProvider)componentDescriptorProvider { return concreteComponentDescriptorProvider<SparkPopoverComponentDescriptor>(); }
@end
