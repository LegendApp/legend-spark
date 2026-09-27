#import "RNSparkAudio.h"
#import <AVFoundation/AVFoundation.h>
#import <MediaPlayer/MediaPlayer.h>
@interface RNSparkAudio ()
@property NSMutableDictionary<NSString *, AVPlayer *> *players;
@property NSString *activeID;
@property NSMutableDictionary<NSString *, NSDictionary *> *metadata;
@property NSMutableDictionary<NSString *, id> *targets;
@property NSString *sessionID;
@property NSMutableDictionary *session;
@property NSMutableArray *commands;
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
- (instancetype)init { if (self = [super init]) {
  _players = [NSMutableDictionary new];
  _metadata = [NSMutableDictionary new]; _targets = [NSMutableDictionary new]; _commands = [NSMutableArray new];
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
          if (owner.commands.count < 128) [owner.commands addObject:value];
        } else {
          AVPlayer *player = owner.players[owner.activeID ?: @""];
          if ([name isEqual:@"play"]) [player play];
          else if ([name isEqual:@"pause"]) [player pause];
          else if ([event isKindOfClass:MPChangePlaybackPositionCommandEvent.class]) [player seekToTime:CMTimeMakeWithSeconds(((MPChangePlaybackPositionCommandEvent *)event).positionTime, 600)];
        }
      });
      return MPRemoteCommandHandlerStatusSuccess;
    }];
  }];
} return self; }
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
        self.sessionID = identifier; self.session = [@{@"commands": @[@"play", @"pause"]} mutableCopy]; [self.commands removeAllObjects];
        [self publishMetadata:args[@"metadata"] ?: @{}];
      } else if (![self.sessionID isEqual:identifier] && [method isEqual:@"sessionRemove"]) { resolve(@"null"); return; }
      else if (![self.sessionID isEqual:identifier]) { reject(@"E_CLOSED", @"Media session has been replaced", nil); return; }
      if ([method isEqual:@"sessionCreate"] || [method isEqual:@"sessionUpdate"]) {
        [self.session addEntriesFromDictionary:args];
        if (args[@"metadata"]) [self publishMetadata:args[@"metadata"]];
        [self publishSession];
      } else if ([method isEqual:@"sessionCommands"]) { result = [self.commands copy]; [self.commands removeAllObjects]; }
      else if ([method isEqual:@"sessionRemove"]) {
        self.sessionID = nil; self.session = nil; self.activeID = nil; ++self.artworkGeneration; [self.commands removeAllObjects];
        MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = nil; MPNowPlayingInfoCenter.defaultCenter.playbackState = MPNowPlayingPlaybackStateStopped;
        for (MPRemoteCommand *command in RemoteCommands().allValues) command.enabled = NO;
      } else { reject(@"E_AUDIO", @"Unknown session operation", nil); return; }
    } else if ([method isEqual:@"create"]) {
      NSString *uri = args[@"uri"]; NSURL *url = [uri hasPrefix:@"/"] ? [NSURL fileURLWithPath:uri] : [NSURL URLWithString:uri];
      if (!url || (!url.isFileURL && ![@[@"https", @"http"] containsObject:url.scheme])) { reject(@"E_AUDIO", @"Expected a local file or HTTP audio URL", nil); return; }
      if (url.isFileURL && ![NSFileManager.defaultManager isReadableFileAtPath:url.path]) { reject(@"E_NOT_FOUND", @"Audio file is not readable", nil); return; }
      self.players[identifier] = [AVPlayer playerWithURL:url]; self.metadata[identifier] = @{@"title": args[@"title"] ?: @"Music"};
      if (!self.sessionID) { self.activeID = identifier; [self publishMetadata:self.metadata[identifier]]; }
    } else if (!player && [method isEqual:@"remove"]) { resolve(@"null"); return; }
    else if (!player) { reject(@"E_AUDIO", @"Audio player is not available", nil); return; }
    else if ([method isEqual:@"ready"]) {
      NSError *error = player.error ?: player.currentItem.error;
      if (error) { reject(@"E_AUDIO", error.localizedDescription, error); return; }
      result = @(player.currentItem.status == AVPlayerItemStatusReadyToPlay);
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
      [player seekToTime:CMTimeMakeWithSeconds(seconds, 600) toleranceBefore:kCMTimeZero toleranceAfter:kCMTimeZero completionHandler:^(BOOL finished) { if (finished) resolve(@"null"); else reject(@"E_AUDIO", @"Seek was interrupted", nil); }]; return;
    } else if ([method isEqual:@"status"]) {
      double position = CMTimeGetSeconds(player.currentTime), duration = CMTimeGetSeconds(player.currentItem.duration);
      if (!isfinite(position)) position = 0; if (!isfinite(duration)) duration = 0;
      NSError *error = player.error ?: player.currentItem.error;
      BOOL playing = player.timeControlStatus == AVPlayerTimeControlStatusPlaying;
      result = @{ @"volume": @(player.volume), @"playing": @(playing), @"currentTime": @(position), @"duration": @(duration), @"didJustFinish": @(duration > 0 && position >= duration && player.rate == 0), @"error": error.localizedDescription ?: NSNull.null };
      if (!self.sessionID && [self.activeID isEqual:identifier]) {
        NSMutableDictionary *info = [MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo mutableCopy] ?: [NSMutableDictionary new];
        info[MPMediaItemPropertyPlaybackDuration] = @(duration); info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = @(position); info[MPNowPlayingInfoPropertyPlaybackRate] = @(player.rate); MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = info;
        MPNowPlayingInfoCenter.defaultCenter.playbackState = playing ? MPNowPlayingPlaybackStatePlaying : MPNowPlayingPlaybackStatePaused;
      }
    } else if ([method isEqual:@"remove"]) { [player pause]; [self.players removeObjectForKey:identifier]; [self.metadata removeObjectForKey:identifier]; if (!self.sessionID && [self.activeID isEqual:identifier]) { self.activeID = nil; ++self.artworkGeneration; MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = nil; } }
    else { reject(@"E_AUDIO", @"Unknown audio operation", nil); return; }
    NSData *data = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingFragmentsAllowed error:nil]; resolve([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]);
  });
}
- (void)invalidate { dispatch_async(dispatch_get_main_queue(), ^{
  for (AVPlayer *player in self.players.allValues) [player pause];
  [self.players removeAllObjects]; [self.metadata removeAllObjects]; ++self.artworkGeneration;
  for (NSString *key in self.targets) [RemoteCommands()[key] removeTarget:self.targets[key]];
  [self.targets removeAllObjects]; self.sessionID = nil; MPNowPlayingInfoCenter.defaultCenter.nowPlayingInfo = nil;
}); }
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params { return std::make_shared<facebook::react::NativeSparkAudioSpecJSI>(params); }
@end
