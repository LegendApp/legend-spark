#import "RNDesktopCameraView.h"
#import "RNDesktopMedia.h"
#import "SparkCapture.h"
#import <AVFoundation/AVFoundation.h>
#import <react/renderer/components/RNDesktopMediaSpec/ComponentDescriptors.h>
#import <react/renderer/components/RNDesktopMediaSpec/Props.h>
using namespace facebook::react;

// Shows the running camera named by `sessionId` (CameraView in src/capture.tsx): a preview layer behind any children.
// The camera may start or stop after the view mounts, so the view looks it up again when the cameras change.
@implementation RNDesktopCameraView {
  CALayer *_preview;
  NSString *_sessionId;
  NSString *_fit;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider { return concreteComponentDescriptorProvider<DesktopCameraViewComponentDescriptor>(); }

- (instancetype)initWithFrame:(NSRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    _props = std::make_shared<const DesktopCameraViewProps>();
    self.wantsLayer = YES;
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(camerasChanged) name:SparkCaptureCamerasDidChangeNotification object:nil];
  }
  return self;
}

- (void)dealloc { [NSNotificationCenter.defaultCenter removeObserver:self]; }

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &value = *std::static_pointer_cast<DesktopCameraViewProps const>(props);
  _fit = [NSString stringWithUTF8String:value.contentFit.c_str()];
  [self applyFit];
  NSString *sessionId = value.sessionId.empty() ? nil : [NSString stringWithUTF8String:value.sessionId.c_str()];
  if (sessionId != _sessionId && ![sessionId isEqual:_sessionId]) { _sessionId = sessionId; [self camerasChanged]; }
  [super updateProps:props oldProps:oldProps];
}

- (void)applyFit
{
  BOOL cover = [_fit isEqual:@"cover"], fill = [_fit isEqual:@"fill"];
  if ([_preview isKindOfClass:AVCaptureVideoPreviewLayer.class])
    ((AVCaptureVideoPreviewLayer *)_preview).videoGravity = cover ? AVLayerVideoGravityResizeAspectFill : fill ? AVLayerVideoGravityResize : AVLayerVideoGravityResizeAspect;
  else _preview.contentsGravity = cover ? kCAGravityResizeAspectFill : fill ? kCAGravityResize : kCAGravityResizeAspect;
}

// A new preview for the camera now running under `sessionId`, or none.
- (void)camerasChanged
{
  [_preview removeFromSuperlayer];
  _preview = _sessionId ? [SparkMediaCapture() makePreviewLayer:_sessionId] : nil;
  if (!_preview) return;
  _preview.frame = self.bounds;
  _preview.masksToBounds = YES;
  [self applyFit];
  [self.layer insertSublayer:_preview atIndex:0];
}

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _preview.frame = self.bounds;
  [CATransaction commit];
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  _sessionId = nil;
  [self camerasChanged];
}
@end
