#import "RNSparkSheet.h"
#import <React/RCTSurfaceTouchHandler.h>
#import <react/renderer/components/RNSparkUISpec/ComponentDescriptors.h>
#import <react/renderer/components/RNSparkUISpec/EventEmitters.h>
#import <react/renderer/components/RNSparkUISpec/Props.h>
using namespace facebook::react;

@interface RNSparkSheetContentView : NSView
@end
@implementation RNSparkSheetContentView
- (BOOL)isFlipped { return YES; }
@end

// Escape and ⌘. reach the sheet as cancelOperation:; the sheet reports them and stays until `visible` turns false.
@interface RNSparkSheetWindow : NSPanel
@property (nonatomic, copy) void (^onCancel)(void);
@end
@implementation RNSparkSheetWindow
- (BOOL)canBecomeKeyWindow { return YES; }
- (void)cancelOperation:(id)sender { if (_onCancel) _onCancel(); }
@end

// The React child moves into a document-modal sheet on this view's window. The content keeps its own touch handler,
// since the surface's handler only sees its own window.
@implementation RNSparkSheet {
  RNSparkSheetWindow *_sheet;
  RNSparkSheetContentView *_contentView;
  RCTSurfaceTouchHandler *_touchHandler;
  NSView *_content;
  NSWindow *_parent;
  BOOL _visible;
  NSSize _contentSize;
}
- (instancetype)init {
  if (self = [super init]) {
    _props = std::make_shared<const SparkSheetProps>();
    _contentView = [[RNSparkSheetContentView alloc] initWithFrame:NSZeroRect];
    _sheet = [[RNSparkSheetWindow alloc] initWithContentRect:NSMakeRect(0, 0, 100, 100) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:YES];
    _sheet.releasedWhenClosed = NO;
    _sheet.contentView = _contentView;
    __weak RNSparkSheet *weakSelf = self;
    _sheet.onCancel = ^{ [weakSelf cancel]; };
    _touchHandler = [RCTSurfaceTouchHandler new];
    [_touchHandler attachToView:_contentView];
  }
  return self;
}
- (BOOL)isFlipped { return YES; }
- (void)mountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index {
  _content = childComponentView;
  [_contentView addSubview:childComponentView];
}
- (void)unmountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index {
  if (childComponentView == _content) _content = nil;
  [childComponentView removeFromSuperview];
}
- (void)cancel {
  auto emitter = std::static_pointer_cast<const SparkSheetEventEmitter>(_eventEmitter);
  if (_visible && emitter) emitter->onCancel({});
}
- (void)updatePresentation {
  BOOL show = _visible && _contentSize.width > 0 && _contentSize.height > 0 && self.window != nil;
  if (!show) {
    if (_parent) { [_parent endSheet:_sheet]; _parent = nil; }
    return;
  }
  if (!NSEqualSizes(_sheet.contentView.frame.size, _contentSize)) [_sheet setContentSize:_contentSize];
  if (_parent == self.window) return;
  if (_parent) [_parent endSheet:_sheet];
  _parent = self.window;
  [_parent beginSheet:_sheet completionHandler:nil];
}
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps {
  const auto &next = *std::static_pointer_cast<const SparkSheetProps>(props);
  _visible = next.visible;
  _contentSize = NSMakeSize(MAX(0, next.contentWidth), MAX(0, next.contentHeight));
  _contentView.accessibilityLabel = next.accessibilityLabel.empty() ? nil : [NSString stringWithUTF8String:next.accessibilityLabel.c_str()];
  [super updateProps:props oldProps:oldProps];
  [self updatePresentation];
}
- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  [self updatePresentation];
}
- (void)prepareForRecycle {
  _visible = NO;
  [self updatePresentation];
  _contentSize = NSZeroSize;
  [super prepareForRecycle];
}
+ (ComponentDescriptorProvider)componentDescriptorProvider { return concreteComponentDescriptorProvider<SparkSheetComponentDescriptor>(); }
@end
