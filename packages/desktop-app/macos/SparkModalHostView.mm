#import <React/RCTComponentViewFactory.h>
#import <React/RCTUIKit.h>
#import <React/RCTViewComponentView.h>
#import <react/renderer/components/FBReactNativeSpec/EventEmitters.h>
#import <react/renderer/components/FBReactNativeSpec/Props.h>
#import <react/renderer/components/modal/ModalHostViewComponentDescriptor.h>
#import <react/renderer/components/modal/ModalHostViewState.h>

using namespace facebook::react;

// react-native-macos compiles its Fabric <Modal> host out on macOS, leaving a plain view that lays its
// children out at screen size in place. A desktop modal covers its window's content instead: children
// mount in an overlay over the hosting window's content view, sized to it, and Escape requests close.
// iOS sheet presentation styles have no window-level equivalent here and also cover the window.
@interface SparkModalHostView : RCTViewComponentView
@end

@implementation SparkModalHostView {
  RCTUIView *_overlay;
  ModalHostViewShadowNode::ConcreteState::Shared _state;
  NSWindow *_hostWindow;
  id _keyMonitor;
  BOOL _visible;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<ModalHostViewComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = ModalHostViewShadowNode::defaultSharedProps();
    _overlay = [[RCTUIView alloc] initWithFrame:NSZeroRect];
    _overlay.wantsLayer = YES;
  }
  return self;
}

// The host stays in the React tree only as an anchor; the overlay draws and takes events.
- (NSView *)hitTest:(NSPoint)point
{
  return nil;
}

- (void)mountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index
{
  NSArray<NSView *> *children = _overlay.subviews;
  if (index < (NSInteger)children.count) [_overlay addSubview:childComponentView positioned:NSWindowBelow relativeTo:children[index]];
  else [_overlay addSubview:childComponentView];
}

- (void)unmountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index
{
  [childComponentView removeFromSuperview];
}

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps
{
  _visible = static_cast<const ModalHostViewProps &>(*props).visible;
  [super updateProps:props oldProps:oldProps];
  [self syncPresentation];
}

- (void)updateState:(const State::Shared &)state oldState:(const State::Shared &)oldState
{
  _state = std::static_pointer_cast<const ModalHostViewShadowNode::ConcreteState>(state);
  [self syncSize];
}

- (void)viewDidMoveToWindow
{
  [super viewDidMoveToWindow];
  [self syncPresentation];
}

- (void)syncPresentation
{
  NSWindow *window = _visible ? self.window : nil;
  if (window == _hostWindow) return;
  if (_hostWindow) [self dismiss];
  if (window) [self presentIn:window];
}

- (void)presentIn:(NSWindow *)window
{
  _hostWindow = window;
  NSView *content = window.contentView;
  _overlay.frame = content.bounds;
  _overlay.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [content addSubview:_overlay positioned:NSWindowAbove relativeTo:nil];
  [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(syncSize) name:NSWindowDidResizeNotification object:window];
  __weak SparkModalHostView *weakSelf = self;
  _keyMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown handler:^NSEvent *(NSEvent *event) {
    SparkModalHostView *host = weakSelf;
    if (!host || event.window != host->_hostWindow || event.keyCode != 53 /* Escape */) return event;
    if (auto emitter = std::static_pointer_cast<const ModalHostViewEventEmitter>(host->_eventEmitter)) emitter->onRequestClose({});
    return nil;
  }];
  [self syncSize];
  [self animateIn:YES completion:^{
    if (auto emitter = std::static_pointer_cast<const ModalHostViewEventEmitter>(self->_eventEmitter)) emitter->onShow({});
  }];
}

- (void)dismiss
{
  [NSNotificationCenter.defaultCenter removeObserver:self name:NSWindowDidResizeNotification object:_hostWindow];
  if (_keyMonitor) [NSEvent removeMonitor:_keyMonitor];
  _keyMonitor = nil;
  _hostWindow = nil;
  NSView *overlay = _overlay;
  [self animateIn:NO completion:^{
    if (!self->_hostWindow) [overlay removeFromSuperview];
  }];
}

- (void)animateIn:(BOOL)entering completion:(void (^)(void))completion
{
  const auto type = static_cast<const ModalHostViewProps &>(*_props).animationType;
  if (type == ModalHostViewAnimationType::None) {
    _overlay.alphaValue = 1;
    completion();
    return;
  }
  BOOL slide = type == ModalHostViewAnimationType::Slide;
  NSRect shown = _overlay.superview.bounds, hidden = NSOffsetRect(shown, 0, _overlay.superview.isFlipped ? NSHeight(shown) : -NSHeight(shown));
  if (entering) {
    if (slide) _overlay.frame = hidden;
    else _overlay.alphaValue = 0;
  }
  [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
    context.duration = 0.25;
    if (slide) self->_overlay.animator.frame = entering ? shown : hidden;
    else self->_overlay.animator.alphaValue = entering ? 1 : 0;
  } completionHandler:^{
    if (slide && !entering) self->_overlay.frame = shown;
    self->_overlay.alphaValue = 1;
    completion();
  }];
}

- (void)syncSize
{
  if (!_state || !_hostWindow) return;
  NSSize size = _hostWindow.contentView.bounds.size;
  if (_state->getData().screenSize == facebook::react::Size{.width = size.width, .height = size.height}) return;
  _state->updateState(ModalHostViewState(facebook::react::Size{.width = size.width, .height = size.height}));
}

- (void)prepareForRecycle
{
  _visible = NO;
  [self syncPresentation];
  _state.reset();
  [super prepareForRecycle];
}

- (void)dealloc
{
  if (_keyMonitor) [NSEvent removeMonitor:_keyMonitor];
  [NSNotificationCenter.defaultCenter removeObserver:self];
  [_overlay removeFromSuperview];
}

@end

__attribute__((constructor)) static void SparkRegisterModalHostView(void)
{
  [RCTComponentViewFactory.currentComponentViewFactory registerComponentViewClass:SparkModalHostView.class];
}
