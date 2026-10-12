#import "SparkVideo.h"
#import <AVKit/AVKit.h>

NSErrorDomain const SparkVideoErrorDomain = @"so.legend.spark.video";
NSNotificationName const SparkVideoPlayersDidChangeNotification = @"SparkVideoPlayersDidChange";
NSError *SparkVideoError(NSString *code, NSString *message) {
  return [NSError errorWithDomain:SparkVideoErrorDomain code:0 userInfo:@{ @"code": code, NSLocalizedDescriptionKey: message }];
}
NSString *SparkVideoErrorCode(NSError *error) {
  NSString *code = [error.domain isEqual:SparkVideoErrorDomain] ? error.userInfo[@"code"] : nil;
  return code ?: @"E_NATIVE";
}
NSURL *SparkVideoURL(id uri, NSError **error) {
  NSURL *url = nil;
  if ([uri isKindOfClass:NSString.class] && [uri length] && ![uri containsString:@"\0"])
    url = [uri hasPrefix:@"/"] ? [NSURL fileURLWithPath:uri] : [NSURL URLWithString:uri];
  if (!url || (!url.isFileURL && ![@[@"http", @"https"] containsObject:url.scheme.lowercaseString])) {
    if (error) *error = SparkVideoError(@"E_INVALID_ARGUMENT", @"A video source is an absolute path or a file, http or https URL");
    return nil;
  }
  if (url.isFileURL && ![NSFileManager.defaultManager isReadableFileAtPath:url.path]) {
    if (error) *error = SparkVideoError(@"E_NOT_FOUND", [NSString stringWithFormat:@"The video file is not readable: %@", url.path]);
    return nil;
  }
  return url;
}
BOOL SparkVideoPictureInPictureSupported(void) { return AVPictureInPictureController.isPictureInPictureSupported; }

static SparkVideoCompletion Once(SparkVideoCompletion completion) {
  __block SparkVideoCompletion pending = [completion copy];
  return ^(id result, NSError *error) {
    dispatch_block_t finish = ^{
      SparkVideoCompletion callback = pending;
      pending = nil;
      if (callback) callback(result, error);
    };
    if (NSThread.isMainThread) finish(); else dispatch_async(dispatch_get_main_queue(), finish);
  };
}
static double Seconds(CMTime time) { double seconds = CMTimeGetSeconds(time); return isfinite(seconds) && seconds > 0 ? seconds : 0; }

// The fullscreen window: Escape leaves fullscreen, as in QuickTime Player.
// It is its own delegate: entering fullscreen can fail only through windowDidFailToEnterFullScreen:.
@interface SparkVideoFullscreenWindow : NSWindow <NSWindowDelegate>
@property (nonatomic, copy) dispatch_block_t failed;
@end
@implementation SparkVideoFullscreenWindow
- (void)windowDidFailToEnterFullScreen:(NSWindow *)window { if (_failed) _failed(); }
- (BOOL)canBecomeKeyWindow { return YES; }
- (void)cancelOperation:(id)sender { if (self.styleMask & NSWindowStyleMaskFullScreen) [self toggleFullScreen:nil]; }
@end

static NSMapTable<NSString *, SparkVideoPlayer *> *Players(void) {
  static NSMapTable *players;
  if (!players) players = [NSMapTable strongToWeakObjectsMapTable];
  return players;
}
static NSArray<NSString *> *const ObservedKeys = @[@"timeControlStatus", @"rate", @"defaultRate", @"volume", @"muted", @"status", @"error",
  @"currentItem.status", @"currentItem.duration", @"currentItem.presentationSize"];
static void *ObservationContext = &ObservationContext;
static void *PossibleContext = &PossibleContext;

@interface SparkVideoPlayer () <AVPictureInPictureControllerDelegate>
@end

@implementation SparkVideoPlayer {
  NSHashTable<AVPlayerLayer *> *_layers;
  __weak AVPlayerLayer *_lastLayer;
  __weak AVPlayerLayer *_pipLayer; // The layer picture in picture shows, while it starts or runs.
  BOOL _observing, _ended, _fullscreen, _pictureInPicture;
  id _timeObserver, _endObserver;
  NSDictionary *_reported;
  NSMutableArray<SparkVideoCompletion> *_ready;
  SparkVideoCompletion _seek;
  NSUInteger _seekGeneration;
  SparkVideoFullscreenWindow *_window;
  NSMutableArray<id> *_windowObservers;
  SparkVideoCompletion _fullscreenChange;
  AVPictureInPictureController *_pip;
  SparkVideoCompletion _pipChange;
  BOOL _watchingPossible;
}

+ (SparkVideoPlayer *)playerWithIdentifier:(NSString *)identifier { return [Players() objectForKey:identifier]; }

- (instancetype)initWithIdentifier:(NSString *)identifier url:(NSURL *)url simulated:(BOOL)simulated
{
  if ((self = [super init])) {
    _identifier = [identifier copy];
    _player = [AVPlayer playerWithURL:url];
    _player.actionAtItemEnd = AVPlayerActionAtItemEndPause;
    _layers = [NSHashTable weakObjectsHashTable];
    _ready = [NSMutableArray array];
    _windowObservers = [NSMutableArray array];
#if SPARK_TEST_DRIVER
    _simulated = simulated;
#else
    NSAssert(!simulated, @"Simulated video exists only in builds with the test driver");
#endif
    __weak SparkVideoPlayer *weakSelf = self;
    // Always installed: `ended` and looping need it whether or not anybody observes.
    _endObserver = [NSNotificationCenter.defaultCenter addObserverForName:AVPlayerItemDidPlayToEndTimeNotification object:_player.currentItem queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *) {
      [weakSelf didPlayToEnd];
    }];
    // Readiness is observed for its waiters, and status for observers; both share this observation.
    [_player addObserver:self forKeyPath:@"currentItem.status" options:0 context:ObservationContext];
    [Players() setObject:self forKey:_identifier];
    [NSNotificationCenter.defaultCenter postNotificationName:SparkVideoPlayersDidChangeNotification object:self];
  }
  return self;
}

- (void)dealloc { if (!_removed) [self teardown]; }

- (NSDictionary *)status
{
  AVPlayerItem *item = _player.currentItem;
  NSError *error = _player.error ?: item.error;
  CGSize size = item.presentationSize;
  return @{
    @"playing": @(_player.timeControlStatus != AVPlayerTimeControlStatusPaused),
    @"currentTime": @(Seconds(_player.currentTime)), @"duration": @(Seconds(item.duration)),
    @"rate": @(_player.defaultRate), @"volume": @(_player.volume), @"muted": @(_player.muted), @"ended": @(_ended),
    @"width": @(size.width), @"height": @(size.height),
    @"fullscreen": @(_fullscreen), @"pictureInPicture": @(_pictureInPicture),
    @"error": error.localizedDescription ?: NSNull.null,
  };
}

#pragma mark Observation

- (void)setObserver:(void (^)(NSDictionary *))observer
{
  _observer = [observer copy];
  BOOL observing = _observer != nil && !_removed;
  if (observing == _observing) return;
  _observing = observing;
  if (observing) {
    for (NSString *key in ObservedKeys) if (![key isEqual:@"currentItem.status"]) [_player addObserver:self forKeyPath:key options:0 context:ObservationContext];
    __weak SparkVideoPlayer *weakSelf = self;
    _timeObserver = [_player addPeriodicTimeObserverForInterval:CMTimeMake(1, 4) queue:dispatch_get_main_queue() usingBlock:^(CMTime) { [weakSelf report]; }];
    _reported = nil;
    [self report];
  } else {
    for (NSString *key in ObservedKeys) if (![key isEqual:@"currentItem.status"]) [_player removeObserver:self forKeyPath:key context:ObservationContext];
    [_player removeTimeObserver:_timeObserver];
    _timeObserver = nil;
    _reported = nil;
  }
}

- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary *)change context:(void *)context
{
  if (context != ObservationContext && context != PossibleContext) return [super observeValueForKeyPath:keyPath ofObject:object change:change context:context];
  __weak SparkVideoPlayer *weakSelf = self;
  dispatch_block_t update = ^{
    SparkVideoPlayer *strongSelf = weakSelf;
    if (!strongSelf || strongSelf->_removed) return;
    if (context == PossibleContext) [strongSelf pictureInPicturePossibleChanged];
    else { [strongSelf settleReady]; [strongSelf report]; }
  };
  if (NSThread.isMainThread) update(); else dispatch_async(dispatch_get_main_queue(), update);
}

// Reports the status when it changed since the last report.
- (void)report
{
  if (!_observing || !_observer) return;
  NSDictionary *status = self.status;
  if ([status isEqual:_reported]) return;
  _reported = status;
  _observer(@{ @"type": @"status", @"status": status });
}

- (void)didPlayToEnd
{
  if (_removed) return;
  if (_loop) {
    [_player seekToTime:kCMTimeZero completionHandler:^(BOOL) {}];
    [_player play];
    return;
  }
  _ended = YES;
  [self report];
}

#pragma mark Readiness

- (void)awaitReady:(SparkVideoCompletion)completion
{
  SparkVideoCompletion done = Once(completion);
  if (_removed) return done(nil, SparkVideoError(@"E_CLOSED", @"The video player was removed"));
  [_ready addObject:done];
  [self settleReady];
}

- (void)settleReady
{
  if (!_ready.count) return;
  AVPlayerItem *item = _player.currentItem;
  NSError *error = _player.error ?: item.error;
  if (!error && item.status != AVPlayerItemStatusReadyToPlay) return;
  NSArray *waiting = [_ready copy];
  [_ready removeAllObjects];
  NSError *failure = error ? SparkVideoError(@"E_NATIVE", [NSString stringWithFormat:@"The video could not be loaded: %@", error.localizedDescription]) : nil;
  for (SparkVideoCompletion done in waiting) done(failure ? nil : @YES, failure);
}

#pragma mark Commands

- (void)play
{
  // Playing from the end starts over, as AVPlayerView does.
  if (_ended) { _ended = NO; [_player seekToTime:kCMTimeZero toleranceBefore:kCMTimeZero toleranceAfter:kCMTimeZero]; }
  [_player play];
  [self report];
}

- (void)pause { [_player pause]; [self report]; }

- (void)seekTo:(double)seconds completion:(SparkVideoCompletion)completion
{
  SparkVideoCompletion done = Once(completion);
  if (!isfinite(seconds) || seconds < 0) return done(nil, SparkVideoError(@"E_INVALID_ARGUMENT", @"A seek position is a finite, nonnegative number of seconds"));
  if (_seek) _seek(nil, SparkVideoError(@"E_ABORTED", @"A later seek replaced this one"));
  _seek = done;
  NSUInteger generation = ++_seekGeneration;
  _ended = NO;
  __weak SparkVideoPlayer *weakSelf = self;
  [_player seekToTime:CMTimeMakeWithSeconds(seconds, 600) toleranceBefore:kCMTimeZero toleranceAfter:kCMTimeZero completionHandler:^(BOOL finished) {
    dispatch_async(dispatch_get_main_queue(), ^{
      SparkVideoPlayer *strongSelf = weakSelf;
      if (!strongSelf || generation != strongSelf->_seekGeneration || !strongSelf->_seek) return;
      SparkVideoCompletion settle = strongSelf->_seek;
      strongSelf->_seek = nil;
      if (!finished) return settle(nil, SparkVideoError(@"E_ABORTED", @"The seek was interrupted"));
      NSDictionary *status = strongSelf.status;
      if (strongSelf->_observing && strongSelf->_observer) { strongSelf->_reported = status; strongSelf->_observer(@{ @"type": @"seeked", @"status": status }); }
      settle(status, nil);
    });
  }];
}

- (NSError *)setRate:(double)rate
{
  if (!isfinite(rate) || rate < 0.25 || rate > 4) return SparkVideoError(@"E_INVALID_ARGUMENT", @"A playback rate is 0.25–4");
  _player.defaultRate = rate;
  if (_player.rate != 0) _player.rate = rate;
  [self report];
  return nil;
}

- (NSError *)setVolume:(double)volume
{
  if (!isfinite(volume) || volume < 0 || volume > 1) return SparkVideoError(@"E_INVALID_ARGUMENT", @"A volume is 0–1");
  _player.volume = volume;
  [self report];
  return nil;
}

- (void)setMuted:(BOOL)muted { _player.muted = muted; [self report]; }

#pragma mark Views

- (void)attachLayer:(AVPlayerLayer *)layer
{
  [_layers addObject:layer];
  _lastLayer = layer;
  layer.player = _player;
}

- (void)detachLayer:(AVPlayerLayer *)layer
{
  [_layers removeObject:layer];
  if (layer.player == _player) layer.player = nil;
  if (_lastLayer == layer) _lastLayer = _layers.allObjects.lastObject;
  // Picture in picture shows the layer's video; without it the window would float an empty frame.
  if (layer == _pipLayer) [self endPictureInPicture];
}

- (NSUInteger)attachedLayers { return _layers.allObjects.count; }

#pragma mark Fullscreen

- (void)setFullscreen:(BOOL)fullscreen
{
  if (_fullscreen == fullscreen) return;
  _fullscreen = fullscreen;
  [self report];
}

- (void)enterFullscreen:(SparkVideoCompletion)completion
{
  SparkVideoCompletion done = Once(completion);
  if (_removed) return done(nil, SparkVideoError(@"E_CLOSED", @"The video player was removed"));
  if (_fullscreenChange) return done(nil, SparkVideoError(@"E_BUSY", @"Fullscreen is already changing"));
  if (_fullscreen) return done(NSNull.null, nil);
#if SPARK_TEST_DRIVER
  if (_simulated) { [self setFullscreen:YES]; return done(NSNull.null, nil); }
#endif
  NSScreen *screen = NSApp.keyWindow.screen ?: NSApp.mainWindow.screen ?: NSScreen.mainScreen;
  if (!screen) return done(nil, SparkVideoError(@"E_UNAVAILABLE", @"There is no screen to show the video on"));
  SparkVideoFullscreenWindow *window = [[SparkVideoFullscreenWindow alloc] initWithContentRect:screen.frame
    styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable | NSWindowStyleMaskFullSizeContentView backing:NSBackingStoreBuffered defer:NO];
  window.releasedWhenClosed = NO;
  window.titlebarAppearsTransparent = YES;
  window.titleVisibility = NSWindowTitleHidden;
  window.backgroundColor = NSColor.blackColor;
  window.collectionBehavior = NSWindowCollectionBehaviorFullScreenPrimary;
  NSView *content = [NSView new];
  content.wantsLayer = YES;
  AVPlayerLayer *layer = [AVPlayerLayer playerLayerWithPlayer:_player];
  layer.videoGravity = AVLayerVideoGravityResizeAspect;
  layer.autoresizingMask = kCALayerWidthSizable | kCALayerHeightSizable;
  content.layer.backgroundColor = NSColor.blackColor.CGColor;
  [content.layer addSublayer:layer];
  window.contentView = content;
  layer.frame = content.bounds;
  [window setFrame:screen.frame display:NO];
  _window = window;
  _fullscreenChange = done;
  __weak SparkVideoPlayer *weakSelf = self;
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  [_windowObservers addObject:[center addObserverForName:NSWindowDidEnterFullScreenNotification object:window queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *) {
    SparkVideoPlayer *strongSelf = weakSelf;
    if (!strongSelf) return;
    [strongSelf setFullscreen:YES];
    [strongSelf settleFullscreen:nil];
  }]];
  window.delegate = window;
  window.failed = ^{
    SparkVideoPlayer *strongSelf = weakSelf;
    [strongSelf closeFullscreenWindow];
    [strongSelf settleFullscreen:SparkVideoError(@"E_NATIVE", @"macOS did not enter fullscreen")];
  };
  // The person leaving fullscreen (Escape, the green button, Mission Control) ends it as exitFullscreen does.
  [_windowObservers addObject:[center addObserverForName:NSWindowDidExitFullScreenNotification object:window queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *) {
    SparkVideoPlayer *strongSelf = weakSelf;
    [strongSelf closeFullscreenWindow];
    [strongSelf settleFullscreen:nil];
  }]];
  [window makeKeyAndOrderFront:nil];
  [window toggleFullScreen:nil];
}

- (void)settleFullscreen:(NSError *)error
{
  SparkVideoCompletion change = _fullscreenChange;
  _fullscreenChange = nil;
  if (change) change(error ? nil : NSNull.null, error);
}

- (void)closeFullscreenWindow
{
  for (id observer in _windowObservers) [NSNotificationCenter.defaultCenter removeObserver:observer];
  [_windowObservers removeAllObjects];
  for (CALayer *layer in _window.contentView.layer.sublayers) if ([layer isKindOfClass:AVPlayerLayer.class]) ((AVPlayerLayer *)layer).player = nil;
  _window.failed = nil;
  [_window orderOut:nil];
  [_window close];
  _window = nil;
  [self setFullscreen:NO];
}

- (void)exitFullscreen:(SparkVideoCompletion)completion
{
  SparkVideoCompletion done = Once(completion);
  if (_fullscreenChange) return done(nil, SparkVideoError(@"E_BUSY", @"Fullscreen is already changing"));
  if (!_fullscreen) return done(NSNull.null, nil);
#if SPARK_TEST_DRIVER
  if (_simulated) { [self setFullscreen:NO]; return done(NSNull.null, nil); }
#endif
  _fullscreenChange = done;
  [_window toggleFullScreen:nil];
}

#pragma mark Picture in picture

- (void)setPictureInPicture:(BOOL)active
{
  if (!active) _pipLayer = nil;
  if (_pictureInPicture == active) return;
  _pictureInPicture = active;
  [self report];
}

- (void)startPictureInPicture:(SparkVideoCompletion)completion
{
  SparkVideoCompletion done = Once(completion);
  if (_removed) return done(nil, SparkVideoError(@"E_CLOSED", @"The video player was removed"));
  if (!SparkVideoPictureInPictureSupported()) return done(nil, SparkVideoError(@"E_UNAVAILABLE", @"Picture in picture is not supported on this Mac"));
  if (_pipChange) return done(nil, SparkVideoError(@"E_BUSY", @"Picture in picture is already changing"));
  if (_pictureInPicture) return done(NSNull.null, nil);
  AVPlayerLayer *layer = _lastLayer;
  if (!layer) return done(nil, SparkVideoError(@"E_UNAVAILABLE", @"Picture in picture needs the player shown in a VideoView"));
#if SPARK_TEST_DRIVER
  if (_simulated) { _pipLayer = layer; [self setPictureInPicture:YES]; return done(NSNull.null, nil); }
#endif
  if (!layer.superlayer) return done(nil, SparkVideoError(@"E_UNAVAILABLE", @"Picture in picture needs the VideoView in a window"));
  if (_pip.playerLayer != layer) {
    [self stopWatchingPossible];
    _pip = [[AVPictureInPictureController alloc] initWithPlayerLayer:layer];
    _pip.delegate = self;
  }
  _pipChange = done;
  _pipLayer = layer;
  if (_pip.isPictureInPicturePossible) { [_pip startPictureInPicture]; return; }
  // A new controller becomes possible shortly after it is created; start then. Bounded, so a layer that never
  // becomes possible (hidden, zero-sized) fails instead of waiting forever.
  [_pip addObserver:self forKeyPath:@"pictureInPicturePossible" options:0 context:PossibleContext];
  _watchingPossible = YES;
  __weak SparkVideoPlayer *weakSelf = self;
  AVPictureInPictureController *controller = _pip;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    SparkVideoPlayer *strongSelf = weakSelf;
    if (!strongSelf || strongSelf->_pip != controller || !strongSelf->_watchingPossible) return;
    [strongSelf stopWatchingPossible];
    [strongSelf settlePictureInPicture:SparkVideoError(@"E_UNAVAILABLE", @"Picture in picture did not become possible for this view (is it visible?)")];
  });
}

- (void)pictureInPicturePossibleChanged
{
  if (!_watchingPossible || !_pip.isPictureInPicturePossible) return;
  [self stopWatchingPossible];
  [_pip startPictureInPicture];
}

- (void)stopWatchingPossible
{
  if (!_watchingPossible) return;
  _watchingPossible = NO;
  [_pip removeObserver:self forKeyPath:@"pictureInPicturePossible" context:PossibleContext];
}

- (void)settlePictureInPicture:(NSError *)error
{
  SparkVideoCompletion change = _pipChange;
  _pipChange = nil;
  if (!_pictureInPicture) _pipLayer = nil;
  if (change) change(error ? nil : NSNull.null, error);
}

- (void)stopPictureInPicture:(SparkVideoCompletion)completion
{
  SparkVideoCompletion done = Once(completion);
  if (_pipChange) return done(nil, SparkVideoError(@"E_BUSY", @"Picture in picture is already changing"));
  if (!_pictureInPicture) return done(NSNull.null, nil);
#if SPARK_TEST_DRIVER
  if (_simulated) { [self setPictureInPicture:NO]; return done(NSNull.null, nil); }
#endif
  _pipChange = done;
  [_pip stopPictureInPicture];
}

// Ends picture in picture without a caller waiting (the view went away, or the player is removed).
- (void)endPictureInPicture
{
  [self stopWatchingPossible];
  [self settlePictureInPicture:SparkVideoError(@"E_CLOSED", @"The view showing the video went away")];
#if SPARK_TEST_DRIVER
  if (_simulated) { [self setPictureInPicture:NO]; return; }
#endif
  if (_pip.isPictureInPictureActive) [_pip stopPictureInPicture];
  _pip.delegate = nil;
  _pip = nil;
  [self setPictureInPicture:NO];
}

- (void)pictureInPictureControllerDidStartPictureInPicture:(AVPictureInPictureController *)controller
{
  [self setPictureInPicture:YES];
  [self settlePictureInPicture:nil];
}
- (void)pictureInPictureController:(AVPictureInPictureController *)controller failedToStartPictureInPictureWithError:(NSError *)error
{
  [self settlePictureInPicture:SparkVideoError(@"E_NATIVE", [NSString stringWithFormat:@"Picture in picture did not start: %@", error.localizedDescription])];
}
// Also when the person closes the floating window or returns it to the app.
- (void)pictureInPictureControllerDidStopPictureInPicture:(AVPictureInPictureController *)controller
{
  [self setPictureInPicture:NO];
  [self settlePictureInPicture:nil];
}
- (void)pictureInPictureController:(AVPictureInPictureController *)controller restoreUserInterfaceForPictureInPictureStopWithCompletionHandler:(void (^)(BOOL))completionHandler
{
  completionHandler(YES); // The view it came from is still showing the player.
}

#pragma mark Removal

- (void)remove
{
  if (_removed) return;
  [self teardown];
  if ([Players() objectForKey:_identifier] == self) [Players() removeObjectForKey:_identifier];
  [NSNotificationCenter.defaultCenter postNotificationName:SparkVideoPlayersDidChangeNotification object:self];
}

// Everything remove does except unregistering, which dealloc must not do.
- (void)teardown
{
  self.observer = nil;
  _removed = YES;
  [_player removeObserver:self forKeyPath:@"currentItem.status" context:ObservationContext];
  [NSNotificationCenter.defaultCenter removeObserver:_endObserver];
  _endObserver = nil;
  NSError *closed = SparkVideoError(@"E_CLOSED", @"The video player was removed");
  for (SparkVideoCompletion done in _ready) done(nil, closed);
  [_ready removeAllObjects];
  if (_seek) { SparkVideoCompletion seek = _seek; _seek = nil; seek(nil, closed); }
  [self stopWatchingPossible];
  if (_pip.isPictureInPictureActive) [_pip stopPictureInPicture];
  _pip.delegate = nil;
  _pip = nil;
  [self settlePictureInPicture:closed];
  if (_window) [self closeFullscreenWindow];
  [self settleFullscreen:closed];
  [_player pause];
  for (AVPlayerLayer *layer in _layers.allObjects) if (layer.player == _player) layer.player = nil;
  [_layers removeAllObjects];
  _lastLayer = nil;
}
@end
