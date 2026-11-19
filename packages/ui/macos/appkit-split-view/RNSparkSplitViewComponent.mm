#import "RNSparkSplitViewComponent.h"
#import "RNSparkLayoutDirection.h"
#import "RNSparkPaneSplitView.h"
#import "RNSparkSplitViewUpdates.h"

#import <react/renderer/components/RNSparkUISpec/ComponentDescriptors.h>
#import <react/renderer/components/RNSparkUISpec/EventEmitters.h>
#import <react/renderer/components/RNSparkUISpec/Props.h>
#import <react/renderer/components/RNSparkUISpec/RCTComponentViewHelpers.h>
#import <QuartzCore/QuartzCore.h>

using namespace facebook::react;

@interface RNSparkSplitPaneHost : NSView
@end

@implementation RNSparkSplitPaneHost
- (BOOL)isFlipped { return YES; }

- (void)didAddSubview:(NSView *)subview
{
  [super didAddSubview:subview];
  subview.postsFrameChangedNotifications = YES;
  [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(childFrameChanged:)
                                             name:NSViewFrameDidChangeNotification object:subview];
  [self setBoundsOrigin:subview.frame.origin];
}

- (void)willRemoveSubview:(NSView *)subview
{
  [NSNotificationCenter.defaultCenter removeObserver:self name:NSViewFrameDidChangeNotification object:subview];
  [super willRemoveSubview:subview];
}

// Fabric measures the child in split-view coordinates. Cancel its origin inside this native host.
- (void)childFrameChanged:(NSNotification *)notification
{
  [self setBoundsOrigin:((NSView *)notification.object).frame.origin];
}
@end

@interface RNSparkSplitViewComponent () <RCTSparkSplitViewViewProtocol>
@end

@implementation RNSparkSplitViewComponent {
  RNSparkPaneSplitView *_splitView;
  NSMutableArray<RNSparkSplitPaneHost *> *_hosts;
  std::shared_ptr<const SparkSplitViewProps> _appliedProps;
  NSArray<NSValue *> *_publishedFrames;
  BOOL _rightToLeft;
  BOOL _updateScheduled;
  BOOL _applyingConfiguration;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = std::make_shared<const SparkSplitViewProps>();
    _hosts = [NSMutableArray new];
    _splitView = [[RNSparkPaneSplitView alloc] initWithFrame:self.bounds];
    _splitView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    __weak RNSparkSplitViewComponent *weakSelf = self;
    _splitView.onLayout = ^{ [weakSelf publishLayout]; };
    [self addSubview:_splitView];
  }
  return self;
}

- (BOOL)isFlipped { return YES; }

- (void)publishLayout
{
  if (_applyingConfiguration || !_appliedProps || !_eventEmitter || NSIsEmptyRect(_splitView.bounds)) return;
  NSArray<NSView *> *panes = _splitView.arrangedSubviews;
  NSMutableArray<NSValue *> *frames = [NSMutableArray arrayWithCapacity:panes.count];
  for (NSView *pane in panes) [frames addObject:[NSValue valueWithRect:pane.frame]];
  if ([_publishedFrames isEqualToArray:frames]) return;
  _publishedFrames = frames;

  SparkSplitViewEventEmitter::OnSplitViewLayout event{
    .horizontal = _appliedProps->horizontal,
    .rightToLeft = static_cast<bool>(_rightToLeft),
  };
  for (NSUInteger i = 0; i < frames.count; ++i) {
    NSRect frame = frames[i].rectValue;
    event.panes.push_back({
      .id = _appliedProps->panes[i].id,
      .x = NSMinX(frame),
      .y = NSMinY(frame),
      .width = NSWidth(frame),
      .height = NSHeight(frame),
    });
  }
  std::static_pointer_cast<const SparkSplitViewEventEmitter>(_eventEmitter)->onSplitViewLayout(std::move(event));
}

- (void)applyConfiguration
{
  auto props = std::static_pointer_cast<const SparkSplitViewProps>(_props);
  if (props->panes.size() != _hosts.count) return;

  BOOL changed = !_appliedProps || props->horizontal != _appliedProps->horizontal
    || props->dividerStyle != _appliedProps->dividerStyle || props->panes.size() != _appliedProps->panes.size();
  if (!changed) {
    for (size_t i = 0; i < props->panes.size(); ++i) {
      const auto &next = props->panes[i];
      const auto &current = _appliedProps->panes[i];
      if (next.id != current.id || next.minSize != current.minSize || next.maxSize != current.maxSize) {
        changed = YES;
        break;
      }
    }
  }
  _appliedProps = props;
  if (!changed && [_splitView.arrangedSubviews isEqualToArray:_hosts]) {
    [self publishLayout];
    return;
  }

  _publishedFrames = nil;
  _applyingConfiguration = YES;
  for (NSView *arranged in _splitView.arrangedSubviews) {
    if (![_hosts containsObject:arranged]) [arranged removeFromSuperview];
  }
  for (NSUInteger index = 0; index < _hosts.count; ++index) {
    NSArray<NSView *> *arranged = _splitView.arrangedSubviews;
    if (index >= arranged.count || arranged[index] != _hosts[index]) {
      [_splitView insertArrangedSubview:_hosts[index] atIndex:index];
    }
  }
  std::vector<RNSparkSplitPaneSizing> panes;
  for (const auto &pane : props->panes) panes.push_back({pane.id, pane.initialSize, pane.minSize, pane.maxSize});
  NSSplitViewDividerStyle style = NSSplitViewDividerStyleThin;
  if (props->dividerStyle == "thick") style = NSSplitViewDividerStyleThick;
  if (props->dividerStyle == "paneSplitter") style = NSSplitViewDividerStylePaneSplitter;
  _applyingConfiguration = NO;
  [_splitView configurePanes:panes horizontal:props->horizontal dividerStyle:style];
}

- (void)scheduleConfiguration
{
  if (_updateScheduled) return;
  _updateScheduled = YES;
  __weak RNSparkSplitViewComponent *weakSelf = self;
  RNSparkScheduleSplitViewUpdate(^{ [weakSelf flushConfiguration]; });
}

- (void)flushConfiguration
{
  _updateScheduled = NO;
  [self applyConfiguration];
}

- (void)mountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)child index:(NSInteger)index
{
  RNSparkSplitPaneHost *host = [RNSparkSplitPaneHost new];
  host.wantsLayer = YES;
  host.layer.masksToBounds = YES;
  [host addSubview:child];
  [_hosts insertObject:host atIndex:index];
  [self scheduleConfiguration];
}

- (void)unmountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)child index:(NSInteger)index
{
  [child removeFromSuperview];
  [_hosts removeObjectAtIndex:index];
  [self scheduleConfiguration];
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  [super updateProps:props oldProps:oldProps];
  [self scheduleConfiguration];
}

- (void)updateEventEmitter:(const EventEmitter::Shared &)eventEmitter
{
  if (!_eventEmitter) _publishedFrames = nil;
  [super updateEventEmitter:eventEmitter];
  [self scheduleConfiguration];
}

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  BOOL rightToLeft = RNSparkLayoutDirection(layoutMetrics) == NSUserInterfaceLayoutDirectionRightToLeft;
  if (_rightToLeft != rightToLeft) {
    _rightToLeft = rightToLeft;
    _publishedFrames = nil;
  }
  _splitView.frame = self.bounds;
  [self publishLayout];
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  for (NSView *host in _splitView.arrangedSubviews) [host removeFromSuperview];
  [_hosts removeAllObjects];
  _publishedFrames = nil;
  _appliedProps.reset();
  _props = std::make_shared<const SparkSplitViewProps>();
  _rightToLeft = NO;
  [_splitView configurePanes:{} horizontal:YES dividerStyle:NSSplitViewDividerStyleThin];
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<SparkSplitViewComponentDescriptor>();
}
@end
