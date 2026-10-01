#import "RNSparkAudio.h"
#import <AVFoundation/AVFoundation.h>
#import <MediaPlayer/MediaPlayer.h>
/** Native observation exists only while the corresponding public status stream is observed. */
@interface SparkAudioObservation : NSObject
@property AVPlayer *player;
@property id timeObserver;
@property id endObserver;
@property NSArray<NSString *> *keys;
@property (copy) void (^notify)(void);
@property BOOL stopped;
- (instancetype)initWithPlayer:(AVPlayer *)player notify:(void (^)(void))notify;
- (instancetype)initWithPlayer:(AVPlayer *)player positionUpdates:(BOOL)positionUpdates notify:(void (^)(void))notify;
- (void)remove;
@end
@implementation SparkAudioObservation
- (instancetype)initWithPlayer:(AVPlayer *)player notify:(void (^)(void))notify {
  return [self initWithPlayer:player positionUpdates:YES notify:notify];
}
- (instancetype)initWithPlayer:(AVPlayer *)player positionUpdates:(BOOL)positionUpdates notify:(void (^)(void))notify {
  if (self = [super init]) {
    self.player = player; self.notify = notify;
    self.keys = positionUpdates ? @[@"status", @"timeControlStatus", @"volume", @"currentItem.status", @"currentItem.duration"] : @[@"status", @"currentItem.status"];
    for (NSString *key in self.keys)
      [player addObserver:self forKeyPath:key options:NSKeyValueObservingOptionNew context:nil];
    __weak SparkAudioObservation *weakSelf = self;
    if (positionUpdates) self.timeObserver = [player addPeriodicTimeObserverForInterval:CMTimeMake(1, 4) queue:dispatch_get_main_queue() usingBlock:^(CMTime time) {
      SparkAudioObservation *owner = weakSelf; if (owner && !owner.stopped) owner.notify();
    }];
    if (positionUpdates) self.endObserver = [NSNotificationCenter.defaultCenter addObserverForName:AVPlayerItemDidPlayToEndTimeNotification object:player.currentItem queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *event) {
      SparkAudioObservation *owner = weakSelf; if (owner && !owner.stopped) owner.notify();
    }];
  }
  return self;
}
- (void)observeValueForKeyPath:(NSString *)key ofObject:(id)object change:(NSDictionary *)change context:(void *)context {
  if (NSThread.isMainThread) { if (!self.stopped) self.notify(); }
  else { __weak SparkAudioObservation *weakSelf = self; dispatch_async(dispatch_get_main_queue(), ^{ SparkAudioObservation *owner = weakSelf; if (owner && !owner.stopped) owner.notify(); }); }
}
- (void)remove {
  if (self.stopped) return;
  self.stopped = YES;
  for (NSString *key in self.keys) [self.player removeObserver:self forKeyPath:key];
  if (self.timeObserver) [self.player removeTimeObserver:self.timeObserver];
  if (self.endObserver) [NSNotificationCenter.defaultCenter removeObserver:self.endObserver];
  self.timeObserver = nil; self.endObserver = nil; self.notify = nil;
}
- (void)dealloc { [self remove]; }
@end
@interface RNSparkAudio ()
@property NSMutableDictionary<NSString *, AVPlayer *> *players;
@property NSString *activeID;
@property NSMutableDictionary<NSString *, NSDictionary *> *metadata;
@property NSMutableDictionary<NSString *, id> *targets;
@property NSString *sessionID;
@property NSMutableDictionary *session;
@property NSMutableDictionary<NSString *, SparkAudioObservation *> *observations;
@property NSMutableDictionary<NSString *, NSDictionary *> *lastStatuses;
@property NSMutableDictionary<NSString *, id> *endObservers;
@property NSMutableDictionary<NSString *, SparkAudioObservation *> *readiness;
@property NSMutableDictionary *readyRejects;
@property NSUInteger artworkGeneration;
@end
static NSDictionary *MediaInfo(NSDictionary *metadata) {
  NSMutableDictionary *info = [NSMutableDictionary new];
  if (metadata[@"title"]) info[MPMediaItemPropertyTitle] = metadata[@"title"];
  if (metadata[@"artist"]) info[MPMediaItemPropertyArtist] = metadata[@"artist"];
  if (metadata[@"albumTitle"]) info[MPMediaItemPropertyAlbumTitle] = metadata[@"albumTitle"];
  return info;
}
static NSDictionary<NSString *, MPRemoteCommand *> *RemoteCommands() {
  MPRemoteCommandCenter *center = MPRemoteCommandCenter.sharedCommandCenter;
  return @{ @"play": center.playCommand, @"pause": center.pauseCommand, @"nextTrack": center.nextTrackCommand,
    @"previousTrack": center.previousTrackCommand, @"seekTo": center.changePlaybackPositionCommand };
}
@interface RNSparkAudio ()
@end
@implementation RNSparkAudio
RCT_EXPORT_MODULE(NativeSparkAudio)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (NSArray<NSString *> *)supportedEvents { return @[@"sparkMediaCommand", @"sparkAudioStatus"]; }
- (instancetype)init { if (self = [super init]) {
  _players = [NSMutableDictionary new];
  _metadata = [NSMutableDictionary new]; _targets = [NSMutableDictionary new];
  _observations = [NSMutableDictionary new]; _lastStatuses = [NSMutableDictionary new]; _endObservers = [NSMutableDictionary new];
  _readiness = [NSMutableDictionary new]; _readyRejects = [NSMutableDictionary new];
  __weak RNSparkAudio *weakSelf = self;
  [RemoteCommands() enumerateKeysAndObjectsUsingBlock:^(NSString *name, MPRemoteCommand *command, BOOL *stop) {
    command.enabled = [@[@"play", @"pause", @"seekTo"] containsObject:name];
    self.targets[name] = [command addTargetWithHandler:^MPRemoteCommandHandlerStatus(MPRemoteCommandEvent *event) {
      RNSparkAudio *owner = weakSelf;
      if (!owner) return MPRemoteCommandHandlerStatusNoSuchContent;
      // Deliver on the main queue, serial with session updates and disposal.
      dispatch_async(dispatch_get_main_queue(), ^{
        if (owner.sessionID) {
          if (![owner.session[@"commands"] containsObject:name]) return;
          NSMutableDictionary *value = [@{@"command": name} mutableCopy];
          if ([event isKindOfClass:MPChangePlaybackPositionCommandEvent.class]) value[@"position"] = @(((MPChangePlaybackPositionCommandEvent *)event).positionTime);
          [owner sendEventWithName:@"sparkMediaCommand" body:@{@"id": owner.sessionID, @"value": value}];
        } else {
          AVPlayer *player = owner.players[owner.activeID ?: @""];
          if ([name isEqual:@"play"]) [player play];
          else if ([name isEqual:@"pause"]) [player pause];
          else if ([event isKindOfClass:MPChangePlaybackPositionCommandEvent.class]) [player seekToTime:CMTimeMakeWithSeconds(((MPChangePlaybackPositionCommandEvent *)event).positionTime, 600)];
          [owner publishPlayer:owner.activeID];
        }
      });
      return MPRemoteCommandHandlerStatusSuccess;
    }];
  }];
} return self; }
- (NSDictionary *)statusForPlayer:(AVPlayer *)player {
  double position = CMTimeGetSeconds(player.currentTime), duration = CMTimeGetSeconds(player.currentItem.duration);
  if (!isfinite(position)) position = 0; if (!isfinite(duration)) duration = 0;
  NSError *error = player.error ?: player.currentItem.error;
  return @{ @"volume": @(player.volume), @"playing": @(player.timeControlStatus == AVPlayerTimeControlStatusPlaying), @"currentTime": @(position), @"duration": @(duration), @"didJustFinish": @(duration > 0 && position >= duration && player.rate == 0), @"error": error.localizedDescription ?: NSNull.null };
}
- (void)emitStatus:(NSString *)identifier {
  AVPlayer *player = self.players[identifier]; if (!player || !self.observations[identifier]) return;
  NSDictionary *status = [self statusForPlayer:player];
  if ([self.lastStatuses[identifier] isEqual:status]) return;
  self.lastStatuses[identifier] = status;
  [self sendEventWithName:@"sparkAudioStatus" body:@{@"id": identifier, @"value": status}];
}
- (void)publishPlayer:(NSString *)identifier {
  if (!identifier || self.sessionID || ![self.activeID isEqual:identifier]) return;
  AVPlayer *player = self.players[identifier]; if (!player) return;
  NSDictionary *status = [self statusForPlayer:player];
  NSMutableDictionary *info = [MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo mutableCopy] ?: [NSMutableDictionary new];
  info[MPMediaItemPropertyPlaybackDuration] = status[@"duration"]; info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = status[@"currentTime"]; info[MPNowPlayingInfoPropertyPlaybackRate] = @(player.rate);
  MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = info;
  MPNowPlayingInfoCenter.defaultCenter.playbackState = [status[@"playing"] boolValue] ? MPNowPlayingPlaybackStatePlaying : MPNowPlayingPlaybackStatePaused;
}
- (void)publishMetadata:(NSDictionary *)metadata {
  NSMutableDictionary *info = [MediaInfo(metadata) mutableCopy];
  MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = info;
  NSUInteger generation = ++self.artworkGeneration;
  NSString *artwork = metadata[@"artworkUrl"];
  if (!artwork.length) return;
  NSURL *url = [artwork hasPrefix:@"/"] ? [NSURL fileURLWithPath:artwork] : [NSURL URLWithString:artwork];
  __weak RNSparkAudio *weakSelf = self;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
    NSData *data = [NSData dataWithContentsOfURL:url];
    NSImage *image = data ? [[NSImage alloc] initWithData:data] : nil;
    dispatch_async(dispatch_get_main_queue(), ^{
      RNSparkAudio *owner = weakSelf;
      if (!owner || generation != owner.artworkGeneration || !image) return;
      NSMutableDictionary *current = [MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo mutableCopy];
      current[MPMediaItemPropertyArtwork] = [[MPMediaItemArtwork alloc] initWithBoundsSize:image.size requestHandler:^NSImage *(CGSize size) { return image; }];
      MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = current;
    });
  });
}
- (void)publishSession {
  NSMutableDictionary *info = [MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo mutableCopy] ?: [NSMutableDictionary new];
  info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = self.session[@"position"] ?: @0;
  info[MPMediaItemPropertyPlaybackDuration] = self.session[@"duration"] ?: @0;
  BOOL playing = [self.session[@"playbackState"] isEqual:@"playing"];
  info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? (self.session[@"playbackRate"] ?: @1) : @0;
  MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = info;
  MPNowPlayingInfoCenter.defaultCenter.playbackState = playing ? MPNowPlayingPlaybackStatePlaying : [self.session[@"playbackState"] isEqual:@"stopped"] ? MPNowPlayingPlaybackStateStopped : MPNowPlayingPlaybackStatePaused;
  [RemoteCommands() enumerateKeysAndObjectsUsingBlock:^(NSString *key, MPRemoteCommand *command, BOOL *stop) { command.enabled = [self.session[@"commands"] containsObject:key]; }];
}
- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSDictionary *args = [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    NSString *identifier = args[@"id"]; if (!identifier.length) { reject(@"E_AUDIO", @"Missing player id", nil); return; }
    AVPlayer *player = self.players[identifier]; id result = NSNull.null;
    if ([method hasPrefix:@"session"]) {
      if ([method isEqual:@"sessionCreate"]) {
        self.sessionID = identifier; self.session = [@{@"commands": @[@"play", @"pause"]} mutableCopy];
        [self publishMetadata:args[@"metadata"] ?: @{}];
      } else if (![self.sessionID isEqual:identifier] && [method isEqual:@"sessionRemove"]) { resolve(@"null"); return; }
      else if (![self.sessionID isEqual:identifier]) { reject(@"E_CLOSED", @"Media session has been replaced", nil); return; }
      if ([method isEqual:@"sessionCreate"] || [method isEqual:@"sessionUpdate"]) {
        [self.session addEntriesFromDictionary:args];
        if (args[@"metadata"]) [self publishMetadata:args[@"metadata"]];
        [self publishSession];
      } else if ([method isEqual:@"sessionRemove"]) {
        self.sessionID = nil; self.session = nil; self.activeID = nil; ++self.artworkGeneration;
        MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = nil; MPNowPlayingInfoCenter.defaultCenter.playbackState = MPNowPlayingPlaybackStateStopped;
        for (MPRemoteCommand *command in RemoteCommands().allValues) command.enabled = NO;
      } else { reject(@"E_AUDIO", @"Unknown session operation", nil); return; }
    } else if ([method isEqual:@"create"]) {
      NSString *uri = args[@"uri"]; NSURL *url = [uri hasPrefix:@"/"] ? [NSURL fileURLWithPath:uri] : [NSURL URLWithString:uri];
      if (!url || (!url.isFileURL && ![@[@"https", @"http"] containsObject:url.scheme])) { reject(@"E_AUDIO", @"Expected a local file or HTTP audio URL", nil); return; }
      if (url.isFileURL && ![NSFileManager.defaultManager isReadableFileAtPath:url.path]) { reject(@"E_NOT_FOUND", @"Audio file is not readable", nil); return; }
      self.players[identifier] = [AVPlayer playerWithURL:url]; self.metadata[identifier] = @{@"title": args[@"title"] ?: @"Music"};
      __weak RNSparkAudio *weakSelf = self;
      self.endObservers[identifier] = [NSNotificationCenter.defaultCenter addObserverForName:AVPlayerItemDidPlayToEndTimeNotification object:self.players[identifier].currentItem queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *event) { [weakSelf publishPlayer:identifier]; }];
      if (!self.sessionID) { self.activeID = identifier; [self publishMetadata:self.metadata[identifier]]; }
    } else if (!player && [method isEqual:@"remove"]) { resolve(@"null"); return; }
    else if (!player) { reject(@"E_AUDIO", @"Audio player is not available", nil); return; }
    else if ([method isEqual:@"awaitReady"]) {
      NSError *error = player.error ?: player.currentItem.error;
      if (error) { reject(@"E_AUDIO", error.localizedDescription, error); return; }
      if (player.currentItem.status == AVPlayerItemStatusReadyToPlay) { [self publishPlayer:identifier]; resolve(@"true"); return; }
      if (self.readiness[identifier]) { reject(@"E_BUSY", @"Audio readiness is already pending", nil); return; }
      __weak RNSparkAudio *weakSelf = self;
      self.readyRejects[identifier] = reject;
      self.readiness[identifier] = [[SparkAudioObservation alloc] initWithPlayer:player positionUpdates:NO notify:^{
        RNSparkAudio *owner = weakSelf; AVPlayer *current = owner.players[identifier];
        NSError *error = current.error ?: current.currentItem.error;
        if (!owner || !current || (!error && current.currentItem.status != AVPlayerItemStatusReadyToPlay)) return;
        [owner.readiness[identifier] remove]; [owner.readiness removeObjectForKey:identifier]; [owner.readyRejects removeObjectForKey:identifier];
        if (error) reject(@"E_AUDIO", error.localizedDescription, error);
        else { [owner publishPlayer:identifier]; resolve(@"true"); }
      }];
      // Readiness may have changed between the first check and installing KVO.
      self.readiness[identifier].notify();
      return;
    }
    else if ([method isEqual:@"volume"]) { double volume = [args[@"volume"] doubleValue]; if (!isfinite(volume) || volume < 0 || volume > 1) { reject(@"E_AUDIO", @"Invalid volume", nil); return; } player.volume = volume; }
    else if ([method isEqual:@"metadata"]) { self.metadata[identifier] = args[@"metadata"]; if (!self.sessionID && [self.activeID isEqual:identifier]) [self publishMetadata:self.metadata[identifier]]; }
    else if ([method isEqual:@"play"]) {
      if (!self.sessionID) { self.activeID = identifier; [self publishMetadata:self.metadata[identifier]]; for (NSString *key in RemoteCommands()) RemoteCommands()[key].enabled = [@[@"play", @"pause", @"seekTo"] containsObject:key]; }
      [player play];
    }
    else if ([method isEqual:@"pause"]) [player pause];
    else if ([method isEqual:@"seek"]) {
      double seconds = [args[@"seconds"] doubleValue];
      if (!isfinite(seconds) || seconds < 0) { reject(@"E_AUDIO", @"Invalid seek position", nil); return; }
      [player seekToTime:CMTimeMakeWithSeconds(seconds, 600) toleranceBefore:kCMTimeZero toleranceAfter:kCMTimeZero completionHandler:^(BOOL finished) { dispatch_async(dispatch_get_main_queue(), ^{ if (finished) { [self publishPlayer:identifier]; [self emitStatus:identifier]; resolve(@"null"); } else reject(@"E_AUDIO", @"Seek was interrupted", nil); }); }]; return;
    } else if ([method isEqual:@"status"]) {
      result = [self statusForPlayer:player];
    } else if ([method isEqual:@"statusUpdates"]) {
      if ([args[@"enabled"] boolValue] && !self.observations[identifier]) {
        __weak RNSparkAudio *weakSelf = self;
        self.observations[identifier] = [[SparkAudioObservation alloc] initWithPlayer:player notify:^{ [weakSelf emitStatus:identifier]; }];
        [self emitStatus:identifier];
      } else if (![args[@"enabled"] boolValue]) { [self.observations[identifier] remove]; [self.observations removeObjectForKey:identifier]; [self.lastStatuses removeObjectForKey:identifier]; }
    } else if ([method isEqual:@"remove"]) {
      RCTPromiseRejectBlock cancelReady = self.readyRejects[identifier];
      [self.readiness[identifier] remove]; [self.readiness removeObjectForKey:identifier]; [self.readyRejects removeObjectForKey:identifier];
      if (cancelReady) cancelReady(@"E_CLOSED", @"Audio player was removed during loading", nil);
      [self.observations[identifier] remove]; [self.observations removeObjectForKey:identifier]; [self.lastStatuses removeObjectForKey:identifier];
      if (self.endObservers[identifier]) [NSNotificationCenter.defaultCenter removeObserver:self.endObservers[identifier]]; [self.endObservers removeObjectForKey:identifier];
      [player pause]; [self.players removeObjectForKey:identifier]; [self.metadata removeObjectForKey:identifier]; if (!self.sessionID && [self.activeID isEqual:identifier]) { self.activeID = nil; ++self.artworkGeneration; MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = nil; }
    }
    else { reject(@"E_AUDIO", @"Unknown audio operation", nil); return; }
    if ([method isEqual:@"play"] || [method isEqual:@"pause"]) [self publishPlayer:identifier];
    NSData *data = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingFragmentsAllowed error:nil]; resolve([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]);
  });
}
- (void)invalidate { dispatch_async(dispatch_get_main_queue(), ^{
  for (SparkAudioObservation *observation in self.readiness.allValues) [observation remove]; [self.readiness removeAllObjects];
  for (RCTPromiseRejectBlock reject in self.readyRejects.allValues) reject(@"E_CLOSED", @"Audio module was invalidated during loading", nil); [self.readyRejects removeAllObjects];
  for (SparkAudioObservation *observation in self.observations.allValues) [observation remove]; [self.observations removeAllObjects]; [self.lastStatuses removeAllObjects];
  for (id token in self.endObservers.allValues) [NSNotificationCenter.defaultCenter removeObserver:token]; [self.endObservers removeAllObjects];
  for (AVPlayer *player in self.players.allValues) [player pause];
  [self.players removeAllObjects]; [self.metadata removeAllObjects]; ++self.artworkGeneration;
  for (NSString *key in self.targets) [RemoteCommands()[key] removeTarget:self.targets[key]];
  [self.targets removeAllObjects]; self.sessionID = nil; MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = nil;
}); [super invalidate]; }
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params { return std::make_shared<facebook::react::NativeSparkAudioSpecJSI>(params); }
@end
