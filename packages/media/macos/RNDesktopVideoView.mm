#import "RNDesktopVideoView.h"
#import "SparkVideo.h"
#import <react/renderer/components/RNDesktopMediaSpec/ComponentDescriptors.h>
#import <react/renderer/components/RNDesktopMediaSpec/Props.h>
using namespace facebook::react;

// Shows the SparkVideoPlayer named by `playerId` (VideoView in src/video.tsx): an AVPlayerLayer behind any children.
// The player may be created or removed after the view mounts, so the view looks it up again when the players change.
@implementation RNDesktopVideoView {
  AVPlayerLayer *_playerLayer;
  NSString *_playerId;
  SparkVideoPlayer *_attached;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider { return concreteComponentDescriptorProvider<DesktopVideoViewComponentDescriptor>(); }

- (instancetype)initWithFrame:(NSRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    _props = std::make_shared<const DesktopVideoViewProps>();
    self.wantsLayer = YES;
    _playerLayer = [AVPlayerLayer layer];
    _playerLayer.videoGravity = AVLayerVideoGravityResizeAspect;
    _playerLayer.frame = self.bounds;
    [self.layer insertSublayer:_playerLayer atIndex:0];
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(playersChanged) name:SparkVideoPlayersDidChangeNotification object:nil];
  }
  return self;
}

- (void)dealloc
{
  [NSNotificationCenter.defaultCenter removeObserver:self];
  [_attached detachLayer:_playerLayer];
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &value = *std::static_pointer_cast<DesktopVideoViewProps const>(props);
  NSString *fit = [NSString stringWithUTF8String:value.contentFit.c_str()];
  _playerLayer.videoGravity = [fit isEqual:@"cover"] ? AVLayerVideoGravityResizeAspectFill : [fit isEqual:@"fill"] ? AVLayerVideoGravityResize : AVLayerVideoGravityResizeAspect;
  NSString *playerId = value.playerId.empty() ? nil : [NSString stringWithUTF8String:value.playerId.c_str()];
  if (playerId != _playerId && ![playerId isEqual:_playerId]) { _playerId = playerId; [self playersChanged]; }
  [super updateProps:props oldProps:oldProps];
}

- (void)playersChanged
{
  SparkVideoPlayer *player = _playerId ? [SparkVideoPlayer playerWithIdentifier:_playerId] : nil;
  if (player.removed) player = nil;
  if (player == _attached) return;
  [_attached detachLayer:_playerLayer];
  _attached = player;
  [player attachLayer:_playerLayer];
}

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  _playerLayer.frame = self.bounds;
  [CATransaction commit];
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];
  _playerId = nil;
  [self playersChanged];
}
@end
