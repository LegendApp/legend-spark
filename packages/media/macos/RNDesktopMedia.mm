#import "RNDesktopMedia.h"
#import "SparkSpeech.h"
#import "SparkVideo.h"
#import <RNDesktopApp/SparkDesktop.h>
#import <RNDesktopApp/SparkTestDriver.h>

// One speech instance per process (main thread), shared by every runtime and the test driver. In driver mode it is
// simulated: nothing is spoken and no microphone, recognizer or TCC is reached (docs/speech.md#testing).
static SparkSpeech *Speech(void) {
  static SparkSpeech *speech;
  if (!speech) {
    speech = [[SparkSpeech alloc] initWithSimulated:SparkTestDriverActive()];
    speech.observer = ^(NSDictionary *event) { SparkEmit(event); };
  }
  return speech;
}
static NSString *Code(NSError *error) {
  if ([error.domain isEqual:SparkSpeechErrorDomain]) return SparkSpeechErrorCode(error);
  return SparkVideoErrorCode(error);
}

#if SPARK_TEST_DRIVER
// Reachable only through an authenticated driver session: {"command": "simulateSpeech", "wordMs"?, "recognizerAvailable"?,
// "onDeviceSupported"?, "recognitionPartials"?, "recognitionTranscript"?} and {"command": "testSpeech"}.
@interface SparkMediaDriver : NSObject
@end
@implementation SparkMediaDriver
+ (void)load {
  SparkTestDriverRegisterCommand(@"simulateSpeech", ^(NSDictionary *request, SparkTestDriverReply reply) {
    NSMutableDictionary *state = [request mutableCopy];
    [state removeObjectsForKeys:@[@"command", @"id"]]; // The driver protocol's own fields.
    NSError *error = nil;
    if ([Speech() simulate:state error:&error]) reply(@{ @"ok": @YES, @"speech": Speech().simulation });
    else reply(@{ @"ok": @NO, @"error": @{ @"code": SparkSpeechErrorCode(error), @"message": error.localizedDescription } });
  });
  SparkTestDriverRegisterCommand(@"testSpeech", ^(NSDictionary *, SparkTestDriverReply reply) {
    if (Speech().simulated) reply(@{ @"ok": @YES, @"speech": Speech().simulation });
    else reply(@{ @"ok": @NO, @"error": @{ @"code": @"E_UNAVAILABLE", @"message": @"Speech simulation needs the test driver" } });
  });
}
@end
#endif

@implementation RNDesktopMedia {
  NSMutableDictionary<NSString *, SparkVideoPlayer *> *_players; // This runtime's players, removed when the bridge is invalidated.
  NSString *_recognition;                                         // This runtime's recognition, cancelled then.
  NSMutableSet<NSString *> *_utterances;                          // This runtime's utterances, stopped then.
  BOOL _invalidated;                                              // Completions after it reach no runtime.
}
RCT_EXPORT_MODULE(NativeDesktopMedia)

- (void)invalidate
{
  dispatch_block_t release = ^{
    self->_invalidated = YES;
    if (self->_utterances.count) [Speech() stopUtterances:[self->_utterances copy]];
    [self->_utterances removeAllObjects];
    for (SparkVideoPlayer *player in self->_players.allValues) [player remove];
    [self->_players removeAllObjects];
    if (self->_recognition) [Speech() cancelRecognition:self->_recognition];
    self->_recognition = nil;
  };
  if (NSThread.isMainThread) release(); else dispatch_async(dispatch_get_main_queue(), release);
}
+ (BOOL)requiresMainQueueSetup { return NO; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }

- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  NSDictionary *args = SparkArgs(json);
  NSString *identifier = [args[@"id"] isKindOfClass:NSString.class] ? args[@"id"] : nil;
  __weak RNDesktopMedia *weakSelf = self;
  SparkVideoCompletion answer = ^(id result, NSError *error) {
    RNDesktopMedia *strongSelf = weakSelf;
    if (!strongSelf || strongSelf->_invalidated) return; // The runtime is gone.
    if (error) reject(Code(error), error.localizedDescription, error);
    else resolve(SparkJSON(result ?: NSNull.null));
  };
  _players = _players ?: [NSMutableDictionary dictionary];
  _utterances = _utterances ?: [NSMutableSet set];
  if ([method hasPrefix:@"video"]) return [self video:method identifier:identifier args:args answer:answer];
  SparkSpeech *speech = Speech();
  if ([method isEqual:@"voices"]) answer(speech.voices, nil);
  else if ([method isEqual:@"speak"]) {
    if (!identifier) return SparkInvalid(reject, @"An utterance needs an id");
    [_utterances addObject:identifier];
    [speech speak:args[@"text"] options:[args[@"options"] isKindOfClass:NSDictionary.class] ? args[@"options"] : @{} identifier:identifier completion:^(id result, NSError *error) {
      RNDesktopMedia *strongSelf = weakSelf;
      if (strongSelf) [strongSelf->_utterances removeObject:identifier];
      answer(result, error);
    }];
  }
  else if ([method isEqual:@"stopSpeaking"]) { [speech stopSpeaking]; answer(nil, nil); }
  else if ([method isEqual:@"pauseSpeaking"]) { [speech pauseSpeaking:args[@"boundary"]]; answer(nil, nil); }
  else if ([method isEqual:@"continueSpeaking"]) { [speech continueSpeaking]; answer(nil, nil); }
  else if ([method isEqual:@"speakingStatus"]) answer(speech.speakingStatus, nil);
  else if ([method isEqual:@"recognizerStatus"]) answer([speech recognizerStatus:[args[@"locale"] isKindOfClass:NSString.class] ? args[@"locale"] : nil], nil);
  else if ([method isEqual:@"recognitionLocales"]) answer(speech.recognitionLocales, nil);
  else if ([method isEqual:@"recognize"]) {
    if (!identifier) return SparkInvalid(reject, @"A recognition needs an id");
    NSMutableDictionary *options = [args mutableCopy];
    [options removeObjectForKey:@"id"];
    _recognition = identifier; // Before recognize:, whose completion may run at once and clears it.
    [speech recognize:options identifier:identifier completion:^(id result, NSError *error) {
      RNDesktopMedia *strongSelf = weakSelf;
      if (strongSelf && [strongSelf->_recognition isEqual:identifier]) strongSelf->_recognition = nil;
      answer(result, error);
    }];
  }
  else if ([method isEqual:@"finishRecognition"]) { [speech finishRecognition:identifier ?: @""]; answer(nil, nil); }
  else if ([method isEqual:@"cancelRecognition"]) { [speech cancelRecognition:identifier ?: @""]; answer(nil, nil); }
  else SparkInvalid(reject, @"Unknown media operation");
}

- (void)video:(NSString *)method identifier:(NSString *)identifier args:(NSDictionary *)args answer:(SparkVideoCompletion)answer
{
  if ([method isEqual:@"videoCapabilities"]) return answer(@{ @"pictureInPicture": @(SparkVideoPictureInPictureSupported()) }, nil);
  if (!identifier.length) return answer(nil, SparkVideoError(@"E_INVALID_ARGUMENT", @"A video player needs an id"));
  if ([method isEqual:@"videoCreate"]) {
    if (_players[identifier] || [SparkVideoPlayer playerWithIdentifier:identifier]) return answer(nil, SparkVideoError(@"E_ALREADY_EXISTS", @"A video player has this id"));
    NSError *error = nil;
    NSURL *url = SparkVideoURL(args[@"uri"], &error);
    if (!url) return answer(nil, error);
    // A test run never reaches the network: simulated players play local files only.
    if (SparkTestDriverActive() && !url.isFileURL) return answer(nil, SparkVideoError(@"E_UNAVAILABLE", @"In a test-driver run, video plays local files only"));
    SparkVideoPlayer *player = [[SparkVideoPlayer alloc] initWithIdentifier:identifier url:url simulated:SparkTestDriverActive()];
    player.loop = [args[@"loop"] boolValue];
    if (args[@"muted"]) [player setMuted:[args[@"muted"] boolValue]];
    if (args[@"volume"] && (error = [player setVolume:[args[@"volume"] doubleValue]])) { [player remove]; return answer(nil, error); }
    if (args[@"rate"] && (error = [player setRate:[args[@"rate"] doubleValue]])) { [player remove]; return answer(nil, error); }
    _players[identifier] = player;
    return answer(nil, nil);
  }
  SparkVideoPlayer *player = _players[identifier];
  if ([method isEqual:@"videoRemove"]) { [player remove]; [_players removeObjectForKey:identifier]; return answer(nil, nil); }
  if (!player) return answer(nil, SparkVideoError(@"E_CLOSED", @"The video player was removed"));
  NSError *error = nil;
  if ([method isEqual:@"videoReady"]) [player awaitReady:answer];
  else if ([method isEqual:@"videoStatus"]) answer(player.status, nil);
  else if ([method isEqual:@"videoPlay"]) { [player play]; answer(nil, nil); }
  else if ([method isEqual:@"videoPause"]) { [player pause]; answer(nil, nil); }
  else if ([method isEqual:@"videoSeek"]) [player seekTo:[args[@"seconds"] isKindOfClass:NSNumber.class] ? [args[@"seconds"] doubleValue] : NAN completion:answer];
  else if ([method isEqual:@"videoRate"]) { error = [player setRate:[args[@"rate"] isKindOfClass:NSNumber.class] ? [args[@"rate"] doubleValue] : NAN]; answer(nil, error); }
  else if ([method isEqual:@"videoVolume"]) { error = [player setVolume:[args[@"volume"] isKindOfClass:NSNumber.class] ? [args[@"volume"] doubleValue] : NAN]; answer(nil, error); }
  else if ([method isEqual:@"videoMuted"]) { [player setMuted:[args[@"muted"] boolValue]]; answer(nil, nil); }
  else if ([method isEqual:@"videoLoop"]) { player.loop = [args[@"loop"] boolValue]; answer(nil, nil); }
  else if ([method isEqual:@"videoObserve"]) {
    void (^observer)(NSDictionary *) = ^(NSDictionary *event) {
      NSMutableDictionary *payload = [event mutableCopy];
      payload[@"event"] = event[@"type"];
      payload[@"type"] = @"videoPlayer";
      payload[@"id"] = identifier;
      SparkEmit(payload);
    };
    if ([args[@"enabled"] boolValue]) player.observer = observer; else player.observer = nil;
    answer(nil, nil);
  }
  else if ([method isEqual:@"videoFullscreen"]) { if ([args[@"active"] boolValue]) [player enterFullscreen:answer]; else [player exitFullscreen:answer]; }
  else if ([method isEqual:@"videoPictureInPicture"]) { if ([args[@"active"] boolValue]) [player startPictureInPicture:answer]; else [player stopPictureInPicture:answer]; }
  else answer(nil, SparkVideoError(@"E_INVALID_ARGUMENT", @"Unknown video operation"));
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeDesktopMediaSpecJSI>(params);
}
@end
