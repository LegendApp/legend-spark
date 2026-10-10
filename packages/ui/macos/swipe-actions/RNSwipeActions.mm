#import "RNSwipeActions.h"
#import <QuartzCore/QuartzCore.h>
#import <react/renderer/components/RNSparkUISpec/ComponentDescriptors.h>
#import <react/renderer/components/RNSparkUISpec/EventEmitters.h>
#import <react/renderer/components/RNSparkUISpec/Props.h>
using namespace facebook::react;

static const CGFloat kButtonWidth = 76;   // one revealed action when the row rests open
static const CGFloat kAxisDistance = 5;   // travel before a gesture commits to an axis
static const CGFloat kRubberLimit = 36;   // how far a side without actions gives

typedef NS_ENUM(NSInteger, RNSwipeGesture) { RNSwipeGestureIdle, RNSwipeGestureUndecided, RNSwipeGestureTracking, RNSwipeGesturePassing };

static NSColor *RNSwipeColor(NSString *hex)
{
  unsigned long long raw = 0;
  [[NSScanner scannerWithString:[hex substringFromIndex:1]] scanHexLongLong:&raw];
  if (hex.length == 9) return [NSColor colorWithSRGBRed:((raw >> 24) & 0xff) / 255.0 green:((raw >> 16) & 0xff) / 255.0 blue:((raw >> 8) & 0xff) / 255.0 alpha:(raw & 0xff) / 255.0];
  return [NSColor colorWithSRGBRed:((raw >> 16) & 0xff) / 255.0 green:((raw >> 8) & 0xff) / 255.0 blue:(raw & 0xff) / 255.0 alpha:1];
}

static void RNSwipeAnimate(NSTimeInterval duration, void (^changes)(void), void (^_Nullable completion)(void))
{
  BOOL reduce = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion;
  [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
    context.duration = reduce ? MIN(duration, 0.12) : duration;
    context.timingFunction = [CAMediaTimingFunction functionWithControlPoints:0.2 :0.9 :0.25 :1];
    context.allowsImplicitAnimation = YES;
    changes();
  } completionHandler:completion];
}

// React child frames use top-left coordinates, even inside private AppKit containers.
@interface RNSwipeContainerView : NSView @end
@implementation RNSwipeContainerView
- (BOOL)isFlipped { return YES; }
@end

@class RNSwipeActions;

@interface RNSwipeActionButton : NSView
@property (nonatomic, readonly) NSString *actionId;
@property (nonatomic, readonly) BOOL dismisses;
/** +1 on the leading side, -1 trailing; the outermost button tracks the content edge once armed. */
@property (nonatomic) NSInteger edge;
@property (nonatomic) BOOL followsContent;
@property (nonatomic, weak) RNSwipeActions *owner;
@end

@interface RNSwipeActions ()
- (void)performActionForButton:(RNSwipeActionButton *)button;
@end

@implementation RNSwipeActionButton {
  NSImageView *_icon;
  NSTextField *_label;
}
- (instancetype)initWithAction:(NSDictionary *)action
{
  if ((self = [super initWithFrame:NSZeroRect])) {
    _actionId = [action[@"id"] copy];
    _dismisses = [action[@"dismisses"] boolValue];
    self.wantsLayer = YES;
    self.layer.backgroundColor = RNSwipeColor(action[@"color"]).CGColor;
    NSImageSymbolConfiguration *config = [NSImageSymbolConfiguration configurationWithPointSize:17 weight:NSFontWeightSemibold];
    _icon = [NSImageView imageViewWithImage:[[NSImage imageWithSystemSymbolName:action[@"symbol"] accessibilityDescription:nil] imageWithSymbolConfiguration:config] ?: [NSImage new]];
    _icon.contentTintColor = NSColor.whiteColor;
    _label = [NSTextField labelWithString:action[@"title"]];
    _label.font = [NSFont systemFontOfSize:11 weight:NSFontWeightSemibold];
    _label.textColor = NSColor.whiteColor;
    _label.alignment = NSTextAlignmentCenter;
    _label.lineBreakMode = NSLineBreakByTruncatingTail;
    [self addSubview:_icon];
    [self addSubview:_label];
    self.accessibilityElement = YES;
    self.accessibilityRole = NSAccessibilityButtonRole;
    self.accessibilityLabel = action[@"title"];
  }
  return self;
}
- (BOOL)isFlipped { return YES; }
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
// Non-opaque views drag the window by default, which would swallow the click.
- (BOOL)mouseDownCanMoveWindow { return NO; }
- (void)layout
{
  [super layout];
  NSRect bounds = self.bounds;
  CGFloat slot = MIN(bounds.size.width, kButtonWidth);
  CGFloat center = !_followsContent ? NSMidX(bounds) : _edge > 0 ? bounds.size.width - slot / 2 : slot / 2;
  CGFloat iconSize = 22, labelHeight = 15, top = floor((bounds.size.height - iconSize - 3 - labelHeight) / 2);
  _icon.frame = NSMakeRect(round(center - iconSize / 2), top, iconSize, iconSize);
  _label.frame = NSMakeRect(round(center - kButtonWidth / 2) + 4, top + iconSize + 3, kButtonWidth - 8, labelHeight);
  // Contents fade in as the button gains room, so a sliver never shows clipped glyphs.
  CGFloat alpha = MAX(0, MIN(1, (bounds.size.width - 20) / 36));
  _icon.alphaValue = alpha;
  _label.alphaValue = alpha;
}
- (void)mouseDown:(NSEvent *)event {}
- (void)mouseUp:(NSEvent *)event
{
  if (NSPointInRect([self convertPoint:event.locationInWindow fromView:nil], self.bounds)) [_owner performActionForButton:self];
}
- (BOOL)accessibilityPerformPress { [_owner performActionForButton:self]; return YES; }
@end

static __weak RNSwipeActions *RNSwipeOpenRow;

@implementation RNSwipeActions {
  NSView *_clipView;
  NSView *_actionsView;
  NSView *_contentView;
  NSArray<RNSwipeActionButton *> *_leading;
  NSArray<RNSwipeActionButton *> *_trailing;
  std::string _leadingJson;
  std::string _trailingJson;
  NSMutableArray<NSEvent *> *_pending;
  RNSwipeGesture _gesture;
  CGFloat _pendingX;
  CGFloat _pendingY;
  CGFloat _offset;
  /** The button filling the revealed strip: the outermost once armed, or a tapped dismissing one. */
  RNSwipeActionButton *_takeover;
  BOOL _dismissed;
  NSUInteger _generation;
}

- (instancetype)initWithFrame:(NSRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    _props = std::make_shared<const SwipeActionsProps>();
    _clipView = [[RNSwipeContainerView alloc] initWithFrame:self.bounds];
    _clipView.wantsLayer = YES;
    // Fabric rewrites the host layer's masksToBounds from overflow props. Own this clip separately.
    _clipView.layer.masksToBounds = YES;
    [self addSubview:_clipView];
    _actionsView = [[RNSwipeContainerView alloc] initWithFrame:self.bounds];
    _actionsView.wantsLayer = YES;
    _contentView = [[RNSwipeContainerView alloc] initWithFrame:self.bounds];
    _contentView.wantsLayer = YES;
    [_clipView addSubview:_actionsView];
    [_clipView addSubview:_contentView];
    _leading = @[];
    _trailing = @[];
    _pending = [NSMutableArray new];
  }
  return self;
}

- (BOOL)isFlipped { return YES; }

#pragma mark - React

- (void)mountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index
{
  if (index < (NSInteger)_contentView.subviews.count) [_contentView addSubview:childComponentView positioned:NSWindowBelow relativeTo:_contentView.subviews[index]];
  else [_contentView addSubview:childComponentView];
}

- (void)unmountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index
{
  [childComponentView removeFromSuperview];
}

- (NSArray<RNSwipeActionButton *> *)buttonsFromJson:(const std::string &)json edge:(NSInteger)edge
{
  NSData *data = [NSData dataWithBytes:json.data() length:json.size()];
  NSArray *actions = data.length ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : @[];
  NSMutableArray *buttons = [NSMutableArray new];
  for (NSDictionary *action in [actions isKindOfClass:NSArray.class] ? actions : @[]) {
    RNSwipeActionButton *button = [[RNSwipeActionButton alloc] initWithAction:action];
    button.edge = edge;
    button.owner = self;
    [buttons addObject:button];
  }
  return buttons;
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &value = *std::static_pointer_cast<const SwipeActionsProps>(props);
  if (value.leadingActionsJson != _leadingJson || value.trailingActionsJson != _trailingJson) {
    _leadingJson = value.leadingActionsJson;
    _trailingJson = value.trailingActionsJson;
    for (NSView *button in [_leading arrayByAddingObjectsFromArray:_trailing]) [button removeFromSuperview];
    _leading = [self buttonsFromJson:_leadingJson edge:1];
    _trailing = [self buttonsFromJson:_trailingJson edge:-1];
    for (NSView *button in [_leading arrayByAddingObjectsFromArray:_trailing]) [_actionsView addSubview:button];
    [self resetPosition];
  }
  [super updateProps:props oldProps:oldProps];
  // Revealed actions and slid-away content must never paint over neighboring rows.
  self.clipsToBounds = YES;
}

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  [self layoutSubviews];
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  _clipView.frame = self.bounds;
  _actionsView.frame = _clipView.bounds;
  if (_dismissed) _offset = _offset > 0 ? self.bounds.size.width : -self.bounds.size.width;
  [self applyOffset];
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  [self resetPosition];
}

- (void)resetPosition
{
  // Invalidate delayed action completions before this view acquires a new owner or actions.
  ++_generation;
  if (RNSwipeOpenRow == self) RNSwipeOpenRow = nil;
  [_pending removeAllObjects];
  _gesture = RNSwipeGestureIdle;
  _offset = 0;
  _takeover = nil;
  _dismissed = NO;
  [self applyOffset];
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<SwipeActionsComponentDescriptor>();
}

#pragma mark - Layout

- (void)applyOffset
{
  NSRect bounds = _clipView.bounds;
  _contentView.frame = NSOffsetRect(bounds, _offset, 0);
  [self layoutButtons:_leading reveal:MAX(0, _offset) bounds:bounds];
  [self layoutButtons:_trailing reveal:MAX(0, -_offset) bounds:bounds];
}

/** The first action sits at the outer edge; a takeover button fills the whole revealed strip. */
- (void)layoutButtons:(NSArray<RNSwipeActionButton *> *)buttons reveal:(CGFloat)reveal bounds:(NSRect)bounds
{
  CGFloat height = bounds.size.height, width = bounds.size.width, each = buttons.count ? reveal / buttons.count : 0;
  [buttons enumerateObjectsUsingBlock:^(RNSwipeActionButton *button, NSUInteger index, BOOL *stop) {
    BOOL takesAll = button == self->_takeover, collapsed = !takesAll && [buttons containsObject:self->_takeover];
    CGFloat size = takesAll ? reveal : collapsed ? 0 : each;
    CGFloat inner = takesAll ? 0 : collapsed ? reveal : index * each;
    CGFloat x = button.edge > 0 ? inner : width - inner - size;
    button.followsContent = takesAll;
    button.frame = NSMakeRect(x, 0, size, height);
    button.needsLayout = YES;
    [button layoutSubtreeIfNeeded];
  }];
}

- (NSArray<RNSwipeActionButton *> *)buttonsForOffset:(CGFloat)offset { return offset > 0 ? _leading : offset < 0 ? _trailing : @[]; }

- (CGFloat)commitDistance
{
  CGFloat width = self.bounds.size.width;
  return MIN(MAX(width * 0.45, 150), width - 24);
}

#pragma mark - Gesture

- (CGFloat)resisted:(CGFloat)offset
{
  if ([self buttonsForOffset:offset].count) return MAX(-self.bounds.size.width, MIN(self.bounds.size.width, offset));
  CGFloat distance = fabs(offset);
  return copysign(kRubberLimit * distance / (distance + kRubberLimit), offset);
}

- (void)scrollWheel:(NSEvent *)event
{
  if (_dismissed || (!_leading.count && !_trailing.count)) { [super scrollWheel:event]; return; }
  // Momentum and plain mouse wheels carry no gesture phase.
  if (event.phase == NSEventPhaseNone || event.phase == NSEventPhaseMayBegin) {
    if (_gesture == RNSwipeGestureTracking && event.momentumPhase != NSEventPhaseNone) return;
    [super scrollWheel:event];
    return;
  }
  if (event.phase == NSEventPhaseBegan) {
    [_pending removeAllObjects];
    _gesture = RNSwipeGestureUndecided;
    _pendingX = 0;
    _pendingY = 0;
  }
  CGFloat dx = event.directionInvertedFromDevice ? event.scrollingDeltaX : -event.scrollingDeltaX;
  BOOL ended = event.phase == NSEventPhaseEnded || event.phase == NSEventPhaseCancelled;

  if (_gesture == RNSwipeGestureUndecided) {
    // Held back until the axis is clear, then replayed to the list if the gesture is vertical.
    [_pending addObject:event];
    _pendingX += dx;
    _pendingY += event.scrollingDeltaY;
    if (!ended && hypot(_pendingX, _pendingY) < kAxisDistance) return;
    if (!ended && fabs(_pendingX) > fabs(_pendingY) * 1.4) {
      _gesture = RNSwipeGestureTracking;
      [_pending removeAllObjects];
      if (RNSwipeOpenRow && RNSwipeOpenRow != self) [RNSwipeOpenRow close];
      [self trackBy:_pendingX];
      return;
    }
    _gesture = RNSwipeGesturePassing;
    if (RNSwipeOpenRow) [RNSwipeOpenRow close];
    NSArray *replay = [_pending copy];
    [_pending removeAllObjects];
    for (NSEvent *pending in replay) [super scrollWheel:pending];
    return;
  }
  if (_gesture == RNSwipeGestureTracking) {
    if (event.phase == NSEventPhaseCancelled) [self close];
    else if (ended) [self settle];
    else [self trackBy:dx];
    return;
  }
  [super scrollWheel:event];
}

- (void)trackBy:(CGFloat)dx
{
  // Accumulate in unresisted space so rubber-banding does not drift.
  CGFloat raw = _offset + dx;
  if (![self buttonsForOffset:_offset].count && _offset != 0) {
    CGFloat distance = fabs(_offset);
    raw = copysign(kRubberLimit * distance / MAX(kRubberLimit - distance, 1), _offset) + dx;
  }
  _offset = [self resisted:raw];
  NSArray<RNSwipeActionButton *> *buttons = [self buttonsForOffset:_offset];
  CGFloat restDistance = MIN(kButtonWidth * buttons.count, self.bounds.size.width);
  // A closing gesture must never arm just because the resting buttons exceed the threshold.
  RNSwipeActionButton *takeover = fabs(_offset) > restDistance && fabs(_offset) >= [self commitDistance] ? buttons.firstObject : nil;
  if (takeover != _takeover) {
    _takeover = takeover;
    [NSHapticFeedbackManager.defaultPerformer performFeedbackPattern:NSHapticFeedbackPatternAlignment performanceTime:NSHapticFeedbackPerformanceTimeNow];
    RNSwipeAnimate(0.22, ^{ [self applyOffset]; }, nil);
    return;
  }
  [self applyOffset];
}

// The gesture stays Tracking until the next one begins, so its momentum never scrolls the list.
- (void)settle
{
  NSArray<RNSwipeActionButton *> *buttons = [self buttonsForOffset:_offset];
  if (_takeover) { [self commit:_takeover]; return; }
  if (buttons.count && fabs(_offset) > kButtonWidth * 0.5) {
    _offset = copysign(MIN(kButtonWidth * buttons.count, self.bounds.size.width), _offset);
    RNSwipeOpenRow = self;
    RNSwipeAnimate(0.34, ^{ [self applyOffset]; }, nil);
    return;
  }
  [self close];
}

- (void)close
{
  if (RNSwipeOpenRow == self) RNSwipeOpenRow = nil;
  if (_offset == 0 || _dismissed) return;
  _offset = 0;
  _takeover = nil;
  RNSwipeAnimate(0.32, ^{ [self applyOffset]; }, nil);
}

- (void)performActionForButton:(RNSwipeActionButton *)button
{
  if (_dismissed) return;
  [self commit:button];
}

/** Dismissing actions carry the row away and report once it is gone; others report while it springs back. */
- (void)commit:(RNSwipeActionButton *)button
{
  if (RNSwipeOpenRow == self) RNSwipeOpenRow = nil;
  NSString *actionId = button.actionId;
  if (!button.dismisses) {
    [self close];
    [self emit:actionId];
    return;
  }
  _dismissed = YES;
  _takeover = button;
  _offset = button.edge * self.bounds.size.width;
  NSUInteger generation = _generation;
  __weak RNSwipeActions *weakSelf = self;
  RNSwipeAnimate(0.26, ^{ [self applyOffset]; }, ^{
    RNSwipeActions *view = weakSelf;
    if (view && view->_generation == generation && view->_dismissed) [view emit:actionId];
  });
}

- (void)emit:(NSString *)actionId
{
  auto emitter = std::static_pointer_cast<const SwipeActionsEventEmitter>(_eventEmitter);
  if (emitter) emitter->onSwipeAction({.actionId = std::string(actionId.UTF8String)});
}

#pragma mark - Clicks while open

- (NSView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event
{
  NSView *hit = [super hitTest:point withEvent:event];
  // Fabric parents use this local-coordinate route; AppKit's route delegates here too.
  // Respect the superclass visibility/pointer-events result before consuming a close click.
  if (hit && _offset != 0 && !_dismissed && NSPointInRect(point, self.bounds) && NSPointInRect(point, _contentView.frame)) return self;
  return hit;
}

- (BOOL)mouseDownCanMoveWindow { return _offset == 0 && super.mouseDownCanMoveWindow; }

- (void)mouseDown:(NSEvent *)event
{
  if (_offset != 0) [self close];
  else [super mouseDown:event];
}

@end
