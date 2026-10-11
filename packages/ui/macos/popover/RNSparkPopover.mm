#import "RNSparkPopover.h"
#import <React/RCTSurfaceTouchHandler.h>
#import <react/renderer/components/RNSparkUISpec/ComponentDescriptors.h>
#import <react/renderer/components/RNSparkUISpec/EventEmitters.h>
#import <react/renderer/components/RNSparkUISpec/Props.h>
using namespace facebook::react;

// Fabric frames React children from the top-left, so the popover's content view is flipped.
@interface RNSparkPopoverContentView : NSView
@end
@implementation RNSparkPopoverContentView
- (BOOL)isFlipped { return YES; }
@end

@implementation RNSparkPopover {
  NSPopover *_popover;
  RNSparkPopoverContentView *_contentView;
  // The surface's touch handler only sees its own window; the popover is another window.
  RCTSurfaceTouchHandler *_touchHandler;
  NSString *_behavior, *_preferredEdge;
  // Events this view has emitted, and the latest count JS has echoed back through props.
  int _eventCount, _acknowledged;
  BOOL _open, _detachable, _rtl, _reconcileScheduled;
  NSInteger _anchorTag;
  BOOL _hasAnchorRect;
  NSRect _anchorRect;
}
- (instancetype)init {
  if (self = [super init]) {
    _props = std::make_shared<const SparkPopoverProps>();
    _contentView = [[RNSparkPopoverContentView alloc] initWithFrame:NSZeroRect];
    _touchHandler = [RCTSurfaceTouchHandler new];
    [_touchHandler attachToView:_contentView];
    [self resetPopover];
  }
  return self;
}
- (void)resetPopover {
  _popover.delegate = nil;
  [_popover close];
  NSViewController *controller = [NSViewController new];
  controller.view = _contentView;
  _popover = [NSPopover new];
  _popover.contentViewController = controller;
  _popover.delegate = self;
  _popover.contentSize = _contentView.frame.size;
  _eventCount = 0; _acknowledged = 0;
}
- (BOOL)isFlipped { return YES; }

#pragma mark Content

- (void)mountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)child index:(NSInteger)index {
  NSArray<NSView *> *children = _contentView.subviews;
  if (index < (NSInteger)children.count) [_contentView addSubview:child positioned:NSWindowBelow relativeTo:children[index]];
  else [_contentView addSubview:child];
  child.postsFrameChangedNotifications = YES;
  [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(contentFrameDidChange) name:NSViewFrameDidChangeNotification object:child];
  [self contentFrameDidChange];
}
- (void)unmountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)child index:(NSInteger)index {
  [NSNotificationCenter.defaultCenter removeObserver:self name:NSViewFrameDidChangeNotification object:child];
  [child removeFromSuperview];
  [self contentFrameDidChange];
}
// The popover takes the size of its React content's layout.
- (void)contentFrameDidChange {
  NSSize size = NSZeroSize;
  for (NSView *child in _contentView.subviews) size = NSMakeSize(MAX(size.width, NSMaxX(child.frame)), MAX(size.height, NSMaxY(child.frame)));
  if (NSEqualSizes(size, _popover.contentSize) && NSEqualSizes(size, _contentView.frame.size)) return;
  [_contentView setFrameSize:size];
  _popover.contentSize = size;
}

#pragma mark Props

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps {
  const auto &next = *std::static_pointer_cast<SparkPopoverProps const>(props);
  // Fabric mounts (Insert mutations) pass a null oldProps; with nothing to diff against, apply every prop.
  const auto previous = std::static_pointer_cast<SparkPopoverProps const>(oldProps);
  _open = next.open;
  _acknowledged = next.eventCount;
  _behavior = [NSString stringWithUTF8String:next.behavior.c_str()];
  _preferredEdge = [NSString stringWithUTF8String:next.preferredEdge.c_str()];
  _detachable = next.detachable;
  _anchorTag = next.anchorTag;
  _hasAnchorRect = next.hasAnchorRect;
  _anchorRect = NSMakeRect(next.anchorX, next.anchorY, next.anchorWidth, next.anchorHeight);
  _popover.behavior = [_behavior isEqual:@"semi-transient"] ? NSPopoverBehaviorSemitransient : [_behavior isEqual:@"application-defined"] ? NSPopoverBehaviorApplicationDefined : NSPopoverBehaviorTransient;
  // Unrelated parent renders also update props; only a changed request (or a newly caught-up count) is reconciled,
  // so a show that failed is not retried until something changes.
  if (!previous || next.open != previous->open || next.eventCount != previous->eventCount || next.anchorTag != previous->anchorTag ||
      next.hasAnchorRect != previous->hasAnchorRect || next.anchorX != previous->anchorX || next.anchorY != previous->anchorY ||
      next.anchorWidth != previous->anchorWidth || next.anchorHeight != previous->anchorHeight) [self scheduleReconcile];
  [super updateProps:props oldProps:oldProps];
}
- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics {
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  _rtl = layoutMetrics.layoutDirection == LayoutDirection::RightToLeft;
  _contentView.userInterfaceLayoutDirection = _rtl ? NSUserInterfaceLayoutDirectionRightToLeft : NSUserInterfaceLayoutDirectionLeftToRight;
}
- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  if (!self.window) [_popover close];
  else [self scheduleReconcile];
}

#pragma mark Showing

// Reconcile after the current mount transaction, once the anchor and content are mounted and laid out.
- (void)scheduleReconcile {
  if (_reconcileScheduled) return;
  _reconcileScheduled = YES;
  __weak RNSparkPopover *weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf reconcile]; });
}
- (void)reconcile {
  _reconcileScheduled = NO;
  // Native closes JS has not processed yet stay in effect: `open` may predate them.
  if (_acknowledged != _eventCount || !self.window || _open == _popover.shown) return;
  if (!_open) { [_popover close]; return; }
  if (_anchorTag < 0) return; // JS reports an unmounted anchor ref.
  NSView *anchor = _anchorTag ? [self viewWithReactTag:_anchorTag] : self.window.contentView;
  if (!anchor) { [self reportError:@"E_NOT_FOUND" message:@"Popover anchor view is not mounted; a flattened view has no native view (set collapsable={false})"]; return; }
  if (!anchor.window.visible) { [self reportError:@"E_UNAVAILABLE" message:@"Popover anchor window is not on screen"]; return; }
  [_popover showRelativeToRect:[self positioningRectIn:anchor] ofView:anchor preferredEdge:[self edgeIn:anchor]];
}
- (NSView *)viewWithReactTag:(NSInteger)tag {
  NSMutableArray<NSView *> *pending = [NSMutableArray arrayWithObject:self.window.contentView];
  for (NSWindow *window in NSApp.windows) if (window != self.window && window.contentView) [pending addObject:window.contentView];
  while (pending.count) {
    NSView *view = pending.lastObject;
    [pending removeLastObject];
    if ([view isKindOfClass:RCTViewComponentView.class] && ((RCTViewComponentView *)view).reactTag.integerValue == tag) return view;
    [pending addObjectsFromArray:view.subviews];
  }
  return nil;
}
// Anchor rects are logical top-left coordinates; AppKit takes them in the positioning view's own space.
- (NSRect)positioningRectIn:(NSView *)anchor {
  if (!_hasAnchorRect) return anchor.bounds;
  NSRect rect = _anchorRect;
  if (!anchor.isFlipped) rect.origin.y = NSHeight(anchor.bounds) - NSMaxY(rect);
  return rect;
}
- (NSRectEdge)edgeIn:(NSView *)anchor {
  BOOL top = [_preferredEdge isEqual:@"top"];
  if (top || [_preferredEdge isEqual:@"bottom"]) return top == anchor.isFlipped ? NSRectEdgeMinY : NSRectEdgeMaxY;
  return [_preferredEdge isEqual:@"leading"] == _rtl ? NSRectEdgeMaxX : NSRectEdgeMinX;
}
// Keyboard focus moves into the popover; AppKit returns it to the parent window on close.
- (void)focusContent {
  NSWindow *window = _contentView.window;
  if (!window) return;
  if (NSApp.isActive) [window makeKeyWindow];
  [window recalculateKeyViewLoop];
  NSView *first = _contentView.nextValidKeyView;
  if (first && [first isDescendantOf:_contentView]) [window makeFirstResponder:first];
}

#pragma mark Events

- (void)emit:(NSString *)state {
  const auto emitter = std::static_pointer_cast<const SparkPopoverEventEmitter>(_eventEmitter);
  if (!emitter) return;
  emitter->onPopoverChange({ .eventCount = ++_eventCount, .state = state.UTF8String });
}
- (void)reportError:(NSString *)code message:(NSString *)message {
  const auto emitter = std::static_pointer_cast<const SparkPopoverEventEmitter>(_eventEmitter);
  if (emitter) emitter->onPopoverError({ .code = code.UTF8String, .message = message.UTF8String });
}
- (void)popoverDidShow:(NSNotification *)notification { [self emit:@"shown"]; [self focusContent]; }
- (void)popoverDidClose:(NSNotification *)notification { [self emit:@"closed"]; }
- (BOOL)popoverShouldDetach:(NSPopover *)popover { return _detachable; }
- (void)popoverDidDetach:(NSPopover *)popover { [self emit:@"detached"]; }

- (void)prepareForRecycle {
  [self resetPopover];
  _open = NO; _detachable = NO; _rtl = NO; _anchorTag = 0; _hasAnchorRect = NO; _anchorRect = NSZeroRect;
  [super prepareForRecycle];
}
- (void)dealloc {
  [NSNotificationCenter.defaultCenter removeObserver:self];
  _popover.delegate = nil;
  [_popover close];
}
+ (ComponentDescriptorProvider)componentDescriptorProvider { return concreteComponentDescriptorProvider<SparkPopoverComponentDescriptor>(); }
@end
