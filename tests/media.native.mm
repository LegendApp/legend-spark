// Video players and speech (packages/media/macos). Never plays sound, opens a window or reaches TCC: players are simulated
// (fullscreen and picture in picture change state only) and play the silent test clip; speech is simulated; the real
// speech instance only gets requests that fail validation before anything speaks or listens.
#import <AppKit/AppKit.h>
#import <AVFoundation/AVFoundation.h>
#import "SparkSpeech.h"
#import "SparkVideo.h"
#include <cstdio>
#include <cstdlib>

#define CHECK(...) do { if (!(__VA_ARGS__)) { fprintf(stderr, "FAILED %s:%d %s\n", __FILE__, __LINE__, #__VA_ARGS__); exit(1); } } while (0)
static void Drain(double seconds) { [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:seconds]]; }
// Runs the main run loop until `done` or the deadline.
static void Wait(BOOL (^done)(void), double seconds) {
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:seconds];
  while (!done() && deadline.timeIntervalSinceNow > 0) Drain(0.01);
}

@interface Box : NSObject
@property int calls;
@property id result;
@property NSString *code;
@end
@implementation Box
@end
static SparkVideoCompletion Record(Box *box) {
  return ^(id result, NSError *error) {
    CHECK(NSThread.isMainThread);
    box.calls++;
    box.result = result;
    box.code = error ? ([error.domain isEqual:SparkSpeechErrorDomain] ? SparkSpeechErrorCode(error) : SparkVideoErrorCode(error)) : nil;
  };
}

int main(int argc, const char *argv[]) { @autoreleasepool {
  [NSApplication sharedApplication];
  CHECK(argc == 2);
  NSString *clip = [NSString stringWithUTF8String:argv[1]];

  // The test clip is silent: it has a video track and no audio track.
  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:clip] options:nil];
  __block NSArray *audio = nil, *video = nil;
  [asset loadTracksWithMediaType:AVMediaTypeAudio completionHandler:^(NSArray *tracks, NSError *) { audio = tracks ?: @[]; }];
  [asset loadTracksWithMediaType:AVMediaTypeVideo completionHandler:^(NSArray *tracks, NSError *) { video = tracks ?: @[]; }];
  Wait(^{ return (BOOL)(audio && video); }, 10);
  CHECK(audio.count == 0 && video.count == 1);

  // Sources: absolute paths and file, http and https URLs; a missing file is E_NOT_FOUND.
  NSError *error = nil;
  CHECK(!SparkVideoURL(@"relative/clip.mp4", &error) && [SparkVideoErrorCode(error) isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(!SparkVideoURL(@"ftp://example.com/clip.mp4", &error) && [SparkVideoErrorCode(error) isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(!SparkVideoURL(@42, &error) && [SparkVideoErrorCode(error) isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(!SparkVideoURL(@"/no/such/clip.mp4", &error) && [SparkVideoErrorCode(error) isEqual:@"E_NOT_FOUND"]);
  CHECK([SparkVideoURL(@"https://example.com/clip.mp4", &error).scheme isEqual:@"https"]);
  NSURL *url = SparkVideoURL(clip, &error);
  CHECK(url.isFileURL);

  // A simulated player: real playback of the clip, simulated fullscreen and picture in picture.
  SparkVideoPlayer *player = [[SparkVideoPlayer alloc] initWithIdentifier:@"video-test" url:url simulated:YES];
  CHECK([SparkVideoPlayer playerWithIdentifier:@"video-test"] == player);
  NSMutableArray<NSDictionary *> *events = [NSMutableArray array];
  player.observer = ^(NSDictionary *event) { [events addObject:event]; };
  Box *ready = [Box new];
  [player awaitReady:Record(ready)];
  Wait(^{ return (BOOL)(ready.calls > 0); }, 10);
  CHECK(ready.calls == 1 && [ready.result isEqual:@YES] && !ready.code);
  NSDictionary *status = player.status;
  CHECK(fabs([status[@"duration"] doubleValue] - 3) < 0.05 && [status[@"width"] doubleValue] == 160 && [status[@"height"] doubleValue] == 90);
  CHECK(![status[@"playing"] boolValue] && [status[@"rate"] doubleValue] == 1 && [status[@"volume"] doubleValue] == 1 && status[@"error"] == NSNull.null);

  CHECK([SparkVideoErrorCode([player setRate:5]) isEqual:@"E_INVALID_ARGUMENT"] && [SparkVideoErrorCode([player setRate:0.1]) isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK([SparkVideoErrorCode([player setVolume:1.5]) isEqual:@"E_INVALID_ARGUMENT"] && [SparkVideoErrorCode([player setVolume:NAN]) isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(![player setRate:2] && ![player setVolume:0.5]);
  [player setMuted:YES];
  status = player.status;
  CHECK([status[@"rate"] doubleValue] == 2 && [status[@"volume"] doubleValue] == 0.5 && [status[@"muted"] boolValue]);
  CHECK([events.lastObject[@"type"] isEqual:@"status"] && [events.lastObject[@"status"][@"muted"] boolValue]);

  // Seeking resolves with the status at the exact position, after a "seeked" event; a later seek aborts an earlier one.
  Box *first = [Box new], *second = [Box new], *invalid = [Box new];
  [player seekTo:-1 completion:Record(invalid)];
  CHECK(invalid.calls == 1 && [invalid.code isEqual:@"E_INVALID_ARGUMENT"]);
  [player seekTo:0.5 completion:Record(first)];
  [player seekTo:1.5 completion:Record(second)];
  Wait(^{ return (BOOL)(second.calls > 0); }, 10);
  CHECK(first.calls == 1 && [first.code isEqual:@"E_ABORTED"]);
  CHECK(second.calls == 1 && !second.code && fabs([second.result[@"currentTime"] doubleValue] - 1.5) < 0.01);
  CHECK([events.lastObject[@"type"] isEqual:@"seeked"]);

  // Playing advances time at the rate set (the clip is silent and muted besides).
  [player play];
  CHECK([player.status[@"playing"] boolValue]);
  Drain(0.4);
  [player pause];
  status = player.status;
  CHECK(![status[@"playing"] boolValue] && [status[@"currentTime"] doubleValue] > 1.6);
  BOOL sawPlaying = NO;
  for (NSDictionary *event in events) sawPlaying = sawPlaying || [event[@"status"][@"playing"] boolValue];
  CHECK(sawPlaying);

  // Playing to the end stops there (ended); playing again starts over.
  Box *nearEnd = [Box new];
  [player seekTo:2.8 completion:Record(nearEnd)];
  Wait(^{ return (BOOL)(nearEnd.calls > 0); }, 10);
  [player play];
  Wait(^{ return [player.status[@"ended"] boolValue]; }, 10);
  CHECK([player.status[@"ended"] boolValue] && ![player.status[@"playing"] boolValue]);
  [player play];
  CHECK(![player.status[@"ended"] boolValue] && [player.status[@"currentTime"] doubleValue] < 0.5);
  [player pause];

  // Simulated fullscreen opens no window; it changes the status and reports it.
  NSUInteger windows = NSApp.windows.count;
  Box *enter = [Box new], *again = [Box new], *exitBox = [Box new];
  [player enterFullscreen:Record(enter)];
  CHECK(enter.calls == 1 && !enter.code && [player.status[@"fullscreen"] boolValue] && [events.lastObject[@"status"][@"fullscreen"] boolValue]);
  [player enterFullscreen:Record(again)];
  CHECK(again.calls == 1 && !again.code);
  [player exitFullscreen:Record(exitBox)];
  CHECK(exitBox.calls == 1 && ![player.status[@"fullscreen"] boolValue] && NSApp.windows.count == windows);

  // Picture in picture needs a view showing the player; detaching that view ends it.
  Box *noView = [Box new], *start = [Box new], *stop = [Box new];
  [player startPictureInPicture:Record(noView)];
  CHECK(noView.calls == 1 && [noView.code isEqual:@"E_UNAVAILABLE"]);
  AVPlayerLayer *layer = [AVPlayerLayer layer];
  [player attachLayer:layer];
  CHECK(layer.player == player.player && player.attachedLayers == 1);
  if (SparkVideoPictureInPictureSupported()) {
    [player startPictureInPicture:Record(start)];
    CHECK(start.calls == 1 && !start.code && [player.status[@"pictureInPicture"] boolValue]);
    [player stopPictureInPicture:Record(stop)];
    CHECK(stop.calls == 1 && ![player.status[@"pictureInPicture"] boolValue]);
    [player startPictureInPicture:Record(start)];
    [player detachLayer:layer];
    CHECK(![player.status[@"pictureInPicture"] boolValue] && !layer.player && player.attachedLayers == 0);
  } else {
    [player detachLayer:layer];
  }
  CHECK(NSApp.windows.count == windows);

  // Looping starts over at the end instead of ending.
  player.loop = YES;
  Box *loopEnd = [Box new];
  [player seekTo:2.85 completion:Record(loopEnd)];
  Wait(^{ return (BOOL)(loopEnd.calls > 0); }, 10);
  [player play];
  Drain(0.6);
  CHECK(![player.status[@"ended"] boolValue] && [player.status[@"playing"] boolValue]);
  [player pause];

  // Removal settles waiters, stops observation and unregisters; it is idempotent.
  NSUInteger before = events.count;
  [player remove];
  [player remove];
  CHECK(player.removed && ![SparkVideoPlayer playerWithIdentifier:@"video-test"]);
  Box *late = [Box new];
  [player awaitReady:Record(late)];
  CHECK(late.calls == 1 && [late.code isEqual:@"E_CLOSED"]);
  Drain(0.3);
  CHECK(events.count == before);

  // Speech helpers.
  CHECK([SparkVoiceQuality(1) isEqual:@"default"] && [SparkVoiceQuality(2) isEqual:@"enhanced"] && [SparkVoiceQuality(3) isEqual:@"premium"]);
  CHECK([SparkVoiceGender(0) isEqual:@"unspecified"] && [SparkVoiceGender(1) isEqual:@"male"] && [SparkVoiceGender(2) isEqual:@"female"]);
  CHECK(SparkUtteranceRate(1) == AVSpeechUtteranceDefaultSpeechRate && SparkUtteranceRate(2) <= AVSpeechUtteranceMaximumSpeechRate && SparkUtteranceRate(0.1) >= AVSpeechUtteranceMinimumSpeechRate);
  NSArray *words = SparkSpeechWords(@"Hello, wide world");
  CHECK(words.count == 3 && [words[1][@"word"] isEqual:@"wide"] && [words[1][@"charIndex"] isEqual:@7] && [words[1][@"charLength"] isEqual:@4]);
  CHECK(SparkRecognitionNoSpeech([NSError errorWithDomain:@"kAFAssistantErrorDomain" code:1110 userInfo:nil]) && !SparkRecognitionNoSpeech([NSError errorWithDomain:@"kAFAssistantErrorDomain" code:203 userInfo:nil]));

  // A real speech instance: invalid requests fail before anything speaks or listens.
  SparkSpeech *real = [[SparkSpeech alloc] initWithSimulated:NO];
  Box *blank = [Box new], *badRate = [Box new], *badVoice = [Box new], *badStrings = [Box new];
  [real speak:@"   " options:@{} identifier:@"u0" completion:Record(blank)];
  [real speak:@"Hi" options:@{ @"rate": @3 } identifier:@"u1" completion:Record(badRate)];
  [real speak:@"Hi" options:@{ @"voice": @"no.such.voice" } identifier:@"u2" completion:Record(badVoice)];
  [real recognize:@{ @"contextualStrings": @[@""] } identifier:@"r0" completion:Record(badStrings)];
  CHECK([blank.code isEqual:@"E_INVALID_ARGUMENT"] && [badRate.code isEqual:@"E_INVALID_ARGUMENT"] && [badVoice.code isEqual:@"E_NOT_FOUND"] && [badStrings.code isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(![real.speakingStatus[@"speaking"] boolValue]);

  // Simulated speech: recorded, timed word by word, with start, word, pause and resume events.
  SparkSpeech *speech = [[SparkSpeech alloc] initWithSimulated:YES];
  NSMutableArray<NSDictionary *> *heard = [NSMutableArray array];
  speech.observer = ^(NSDictionary *event) { [heard addObject:event]; };
  CHECK([speech simulate:@{ @"wordMs": @5 } error:&error]);
  CHECK(![speech simulate:@{ @"wordMs": @0 } error:&error] && [SparkSpeechErrorCode(error) isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(![speech simulate:@{ @"volume": @1 } error:&error] && [SparkSpeechErrorCode(error) isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(![real simulate:@{ @"wordMs": @5 } error:&error] && [SparkSpeechErrorCode(error) isEqual:@"E_UNAVAILABLE"]);
  Box *spoken = [Box new];
  [speech speak:@"Hello there world" options:@{ @"rate": @1.5, @"pitch": @0.8, @"volume": @0.4 } identifier:@"u3" completion:Record(spoken)];
  CHECK([speech.speakingStatus[@"speaking"] boolValue]);
  Wait(^{ return (BOOL)(spoken.calls > 0); }, 5);
  CHECK(spoken.calls == 1 && [spoken.result isEqual:@{ @"finished": @YES }]);
  NSArray *names = [heard valueForKey:@"event"];
  CHECK([names isEqual:@[@"start", @"word", @"word", @"word"]] && [heard[2][@"word"] isEqual:@"there"] && [heard[2][@"charIndex"] isEqual:@6]);
  NSDictionary *utterance = [speech.simulation[@"utterances"] lastObject];
  CHECK([utterance[@"text"] isEqual:@"Hello there world"] && [utterance[@"rate"] isEqual:@1.5] && [utterance[@"pitch"] isEqual:@0.8] && [utterance[@"volume"] isEqual:@0.4]);
  CHECK(![speech.speakingStatus[@"speaking"] boolValue]);

  // Pause holds the words; resume continues; stop ends the speaking and the queued utterances unfinished.
  [heard removeAllObjects];
  CHECK([speech simulate:@{ @"wordMs": @40 } error:&error]);
  Box *held = [Box new], *queued = [Box new];
  [speech speak:@"one two three four" options:@{} identifier:@"u4" completion:Record(held)];
  [speech speak:@"five" options:@{} identifier:@"u5" completion:Record(queued)];
  Drain(0.06);
  [speech pauseSpeaking:@"word"];
  NSUInteger paused = heard.count;
  CHECK([speech.speakingStatus[@"paused"] boolValue] && [heard.lastObject[@"event"] isEqual:@"pause"]);
  Drain(0.15);
  CHECK(heard.count == paused && held.calls == 0);
  [speech continueSpeaking];
  CHECK(![speech.speakingStatus[@"paused"] boolValue] && [heard.lastObject[@"event"] isEqual:@"resume"]);
  Drain(0.05);
  [speech stopSpeaking];
  CHECK(held.calls == 1 && [held.result isEqual:@{ @"finished": @NO }] && queued.calls == 1 && [queued.result isEqual:@{ @"finished": @NO }]);
  CHECK(![speech.speakingStatus[@"speaking"] boolValue] && [speech.simulation[@"utterances"] count] == 3);

  // Simulated recognition: partial results while listening, the final transcript once finished, one at a time.
  [heard removeAllObjects];
  CHECK([speech simulate:@{ @"wordMs": @10, @"recognitionPartials": @[@"hello", @"hello wor"], @"recognitionTranscript": @"hello world" } error:&error]);
  Box *recognized = [Box new], *busy = [Box new];
  [speech recognize:@{ @"locale": @"en-US", @"onDevice": @YES, @"contextualStrings": @[@"Spark"] } identifier:@"r1" completion:Record(recognized)];
  [speech recognize:@{} identifier:@"r2" completion:Record(busy)];
  CHECK(busy.calls == 1 && [busy.code isEqual:@"E_BUSY"]);
  Wait(^{ return (BOOL)(heard.count >= 3); }, 5);
  CHECK([[heard valueForKey:@"event"] isEqual:@[@"started", @"partial", @"partial"]] && [heard[2][@"transcript"] isEqual:@"hello wor"]);
  CHECK([speech.simulation[@"listening"] boolValue] && recognized.calls == 0);
  CHECK([speech.simulation[@"lastRecognition"][@"locale"] isEqual:@"en-US"] && [speech.simulation[@"lastRecognition"][@"onDevice"] isEqual:@YES]);
  [speech finishRecognition:@"r1"];
  Wait(^{ return (BOOL)(recognized.calls > 0); }, 5);
  CHECK([recognized.result[@"status"] isEqual:@"recognized"] && [recognized.result[@"transcript"] isEqual:@"hello world"] && [recognized.result[@"segments"] count] == 2);
  CHECK(![speech.simulation[@"listening"] boolValue] && [speech.simulation[@"recognitions"] isEqual:@1]);

  Box *cancelled = [Box new], *silent = [Box new], *offline = [Box new], *noDevice = [Box new], *unsupported = [Box new];
  [speech recognize:@{} identifier:@"r3" completion:Record(cancelled)];
  [speech cancelRecognition:@"r3"];
  CHECK([cancelled.result isEqual:@{ @"status": @"cancelled" }]);
  CHECK([speech simulate:@{ @"recognitionTranscript": NSNull.null, @"recognitionPartials": @[] } error:&error]);
  [speech recognize:@{ @"locale": @"en-US" } identifier:@"r4" completion:Record(silent)];
  [speech finishRecognition:@"r4"];
  Wait(^{ return (BOOL)(silent.calls > 0); }, 5);
  CHECK([silent.result isEqual:@{ @"status": @"noSpeech" }]);
  CHECK([speech simulate:@{ @"onDeviceSupported": @NO } error:&error]);
  [speech recognize:@{ @"locale": @"en-US", @"onDevice": @YES } identifier:@"r5" completion:Record(noDevice)];
  CHECK([noDevice.code isEqual:@"E_UNAVAILABLE"] && [[speech recognizerStatus:@"en-US"][@"onDevice"] isEqual:@NO]);
  CHECK([speech simulate:@{ @"recognizerAvailable": @NO } error:&error]);
  [speech recognize:@{ @"locale": @"en-US" } identifier:@"r6" completion:Record(offline)];
  CHECK([offline.code isEqual:@"E_UNAVAILABLE"] && [[speech recognizerStatus:@"en-US"][@"available"] isEqual:@NO]);
  [speech recognize:@{ @"locale": @"xx-XX" } identifier:@"r7" completion:Record(unsupported)];
  CHECK([unsupported.code isEqual:@"E_UNAVAILABLE"] && [[speech recognizerStatus:@"xx-XX"][@"supported"] isEqual:@NO]);
  CHECK([speech.recognitionLocales containsObject:@"en-US"]);

  printf("Media native tests passed\n");
} return 0; }
