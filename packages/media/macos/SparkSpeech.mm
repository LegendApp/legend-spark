#import "SparkSpeech.h"
#import "SparkCapture.h"
#import <AVFoundation/AVFoundation.h>
#import <Speech/Speech.h>

NSErrorDomain const SparkSpeechErrorDomain = @"so.legend.spark.speech";
static NSError *Failure(NSString *code, NSString *message) {
  return [NSError errorWithDomain:SparkSpeechErrorDomain code:0 userInfo:@{ @"code": code, NSLocalizedDescriptionKey: message }];
}
NSString *SparkSpeechErrorCode(NSError *error) {
  NSString *code = [error.domain isEqual:SparkSpeechErrorDomain] ? error.userInfo[@"code"] : nil;
  return code ?: @"E_NATIVE";
}
NSString *SparkVoiceQuality(NSInteger quality) {
  switch (quality) {
    case AVSpeechSynthesisVoiceQualityEnhanced: return @"enhanced";
    case AVSpeechSynthesisVoiceQualityPremium: return @"premium";
    default: return @"default";
  }
}
NSString *SparkVoiceGender(NSInteger gender) {
  switch (gender) {
    case AVSpeechSynthesisVoiceGenderMale: return @"male";
    case AVSpeechSynthesisVoiceGenderFemale: return @"female";
    default: return @"unspecified";
  }
}
float SparkUtteranceRate(double rate) {
  return (float)MIN(MAX(AVSpeechUtteranceDefaultSpeechRate * rate, AVSpeechUtteranceMinimumSpeechRate), AVSpeechUtteranceMaximumSpeechRate);
}
NSArray<NSDictionary *> *SparkSpeechWords(NSString *text) {
  NSMutableArray *words = [NSMutableArray array];
  [text enumerateSubstringsInRange:NSMakeRange(0, text.length) options:NSStringEnumerationByWords usingBlock:^(NSString *word, NSRange range, NSRange, BOOL *) {
    [words addObject:@{ @"charIndex": @(range.location), @"charLength": @(range.length), @"word": word }];
  }];
  return words;
}
BOOL SparkRecognitionNoSpeech(NSError *error) { return [error.domain isEqual:@"kAFAssistantErrorDomain"] && error.code == 1110; }

static SparkSpeechCompletion Once(SparkSpeechCompletion completion) {
  __block SparkSpeechCompletion pending = [completion copy];
  return ^(id result, NSError *error) {
    dispatch_block_t finish = ^{
      SparkSpeechCompletion callback = pending;
      pending = nil;
      if (callback) callback(result, error);
    };
    if (NSThread.isMainThread) finish(); else dispatch_async(dispatch_get_main_queue(), finish);
  };
}
static NSString *LocaleName(NSLocale *locale) { return [locale.localeIdentifier stringByReplacingOccurrencesOfString:@"_" withString:@"-"]; }
static BOOL Number(id value, double minimum, double maximum) { return [value isKindOfClass:NSNumber.class] && isfinite([value doubleValue]) && [value doubleValue] >= minimum && [value doubleValue] <= maximum; }
static NSDictionary *Recognized(NSString *transcript, NSArray *segments) {
  return transcript.length ? @{ @"status": @"recognized", @"transcript": transcript, @"segments": segments } : @{ @"status": @"noSpeech" };
}
static NSArray *Segments(SFTranscription *transcription) {
  NSMutableArray *segments = [NSMutableArray array];
  for (SFTranscriptionSegment *segment in transcription.segments)
    [segments addObject:@{ @"substring": segment.substring, @"timestamp": @(segment.timestamp), @"duration": @(segment.duration), @"confidence": @(segment.confidence) }];
  return segments;
}

// One utterance waiting for, or in, speech.
@interface SparkUtterance : NSObject
@property (nonatomic, copy) NSString *identifier;
@property (nonatomic, copy) NSString *text;
@property (nonatomic, copy) SparkSpeechCompletion completion;
@property (nonatomic) NSArray<NSDictionary *> *words; // Simulated only.
@property (nonatomic) NSUInteger next;                 // Simulated only: the next word to report.
@end
@implementation SparkUtterance
@end

// The running recognition.
@interface SparkRecognition : NSObject
@property (nonatomic, copy) NSString *identifier;
@property (nonatomic, copy) SparkSpeechCompletion completion;
@property (nonatomic) BOOL partialResults;
@property (nonatomic) BOOL finishing; // Simulated only: no more partial results.
@property (nonatomic) AVAudioEngine *engine;
@property (nonatomic) SFSpeechAudioBufferRecognitionRequest *request;
@property (nonatomic) SFSpeechRecognitionTask *task;
@property (nonatomic) SFSpeechRecognizer *recognizer;
@property (nonatomic) id configurationObserver; // AVAudioEngineConfigurationChangeNotification, while listening.
@end
@implementation SparkRecognition
@end

@interface SparkSpeech () <AVSpeechSynthesizerDelegate>
@end

@implementation SparkSpeech {
  AVSpeechSynthesizer *_synthesizer;
  NSMapTable<AVSpeechUtterance *, SparkUtterance *> *_speaking;
  NSMutableArray<AVSpeechUtterance *> *_order; // _speaking's utterances in the synthesizer's order.
  SparkRecognition *_recognition;
#if SPARK_TEST_DRIVER
  NSMutableDictionary *_simulation;
  NSMutableArray<NSDictionary *> *_spoken;
  NSMutableArray<SparkUtterance *> *_queue;
  BOOL _paused;
  NSUInteger _generation;
#endif
}

- (instancetype)initWithSimulated:(BOOL)simulated
{
  if ((self = [super init])) {
#if SPARK_TEST_DRIVER
    _simulated = simulated;
    if (simulated) {
      _simulation = [@{ @"wordMs": @20, @"recognizerAvailable": @YES, @"onDeviceSupported": @YES, @"recognitionPartials": @[], @"recognitionTranscript": NSNull.null,
        @"recognitions": @0, @"lastRecognition": NSNull.null } mutableCopy];
      _spoken = [NSMutableArray array];
      _queue = [NSMutableArray array];
      return self;
    }
#else
    NSAssert(!simulated, @"Simulated speech exists only in builds with the test driver");
#endif
    _speaking = [NSMapTable mapTableWithKeyOptions:NSPointerFunctionsObjectPointerPersonality | NSPointerFunctionsStrongMemory valueOptions:NSPointerFunctionsStrongMemory];
    _order = [NSMutableArray array];
  }
  return self;
}

- (void)emit:(NSDictionary *)event { if (_observer) _observer(event); }

#pragma mark Voices and utterances

- (NSArray<NSDictionary *> *)voices
{
  NSMutableArray *voices = [NSMutableArray array];
  for (AVSpeechSynthesisVoice *voice in AVSpeechSynthesisVoice.speechVoices)
    [voices addObject:@{ @"identifier": voice.identifier, @"name": voice.name, @"language": voice.language, @"quality": SparkVoiceQuality(voice.quality), @"gender": SparkVoiceGender(voice.gender) }];
  return voices;
}

// The utterance for validated options, or nil with the reason.
static AVSpeechUtterance *Utterance(NSString *text, NSDictionary *options, NSError **error) {
  if (![text isKindOfClass:NSString.class] || ![text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet].length || text.length > 100000) {
    *error = Failure(@"E_INVALID_ARGUMENT", @"Speech text is 1–100000 characters, not only whitespace");
    return nil;
  }
  AVSpeechSynthesisVoice *voice = nil;
  if (options[@"voice"]) {
    voice = [options[@"voice"] isKindOfClass:NSString.class] ? [AVSpeechSynthesisVoice voiceWithIdentifier:options[@"voice"]] : nil;
    if (!voice) { *error = Failure(@"E_NOT_FOUND", [NSString stringWithFormat:@"No voice has the identifier %@", options[@"voice"]]); return nil; }
  } else if (options[@"language"]) {
    voice = [options[@"language"] isKindOfClass:NSString.class] ? [AVSpeechSynthesisVoice voiceWithLanguage:options[@"language"]] : nil;
    if (!voice) { *error = Failure(@"E_UNAVAILABLE", [NSString stringWithFormat:@"No voice speaks %@", options[@"language"]]); return nil; }
  }
  if (options[@"rate"] && !Number(options[@"rate"], 0.1, 2)) { *error = Failure(@"E_INVALID_ARGUMENT", @"rate is 0.1–2"); return nil; }
  if (options[@"pitch"] && !Number(options[@"pitch"], 0.5, 2)) { *error = Failure(@"E_INVALID_ARGUMENT", @"pitch is 0.5–2"); return nil; }
  if (options[@"volume"] && !Number(options[@"volume"], 0, 1)) { *error = Failure(@"E_INVALID_ARGUMENT", @"volume is 0–1"); return nil; }
  AVSpeechUtterance *utterance = [AVSpeechUtterance speechUtteranceWithString:text];
  if (voice) utterance.voice = voice;
  utterance.rate = SparkUtteranceRate(options[@"rate"] ? [options[@"rate"] doubleValue] : 1);
  utterance.pitchMultiplier = options[@"pitch"] ? [options[@"pitch"] floatValue] : 1;
  utterance.volume = options[@"volume"] ? [options[@"volume"] floatValue] : 1;
  return utterance;
}

- (void)speak:(NSString *)text options:(NSDictionary *)options identifier:(NSString *)identifier completion:(SparkSpeechCompletion)completion
{
  SparkSpeechCompletion done = Once(completion);
  NSError *error = nil;
  AVSpeechUtterance *utterance = Utterance(text, options, &error);
  if (!utterance) return done(nil, error);
  SparkUtterance *entry = [SparkUtterance new];
  entry.identifier = identifier;
  entry.text = text;
  entry.completion = done;
#if SPARK_TEST_DRIVER
  if (_simulated) {
    [_spoken addObject:@{ @"text": text, @"voice": utterance.voice.identifier ?: NSNull.null, @"language": options[@"language"] ?: utterance.voice.language ?: NSNull.null,
      @"rate": options[@"rate"] ?: @1, @"pitch": options[@"pitch"] ?: @1, @"volume": options[@"volume"] ?: @1 }];
    entry.words = SparkSpeechWords(text);
    [_queue addObject:entry];
    if (_queue.count == 1) [self simulateStart];
    return;
  }
#endif
  if (!_synthesizer) {
    _synthesizer = [AVSpeechSynthesizer new];
    _synthesizer.delegate = self;
  }
  [self enqueue:utterance entry:entry];
}

- (void)enqueue:(AVSpeechUtterance *)utterance entry:(SparkUtterance *)entry
{
  [_speaking setObject:entry forKey:utterance];
  [_order addObject:utterance];
  [_synthesizer speakUtterance:utterance];
}

- (void)stopSpeaking
{
#if SPARK_TEST_DRIVER
  if (_simulated) {
    _generation++;
    _paused = NO;
    NSArray *stopped = [_queue copy];
    [_queue removeAllObjects];
    for (SparkUtterance *entry in stopped) entry.completion(@{ @"finished": @NO }, nil);
    return;
  }
#endif
  [_synthesizer stopSpeakingAtBoundary:AVSpeechBoundaryImmediate];
  // macOS reports a cancel for the utterance speaking, not for the queued ones it drops: settle them all now.
  NSArray *stopped = _speaking.objectEnumerator.allObjects;
  [_speaking removeAllObjects];
  [_order removeAllObjects];
  for (SparkUtterance *entry in stopped) entry.completion(@{ @"finished": @NO }, nil);
}

- (void)stopUtterances:(NSSet<NSString *> *)identifiers
{
  BOOL (^listed)(SparkUtterance *) = ^BOOL(SparkUtterance *entry) { return [identifiers containsObject:entry.identifier]; };
#if SPARK_TEST_DRIVER
  if (_simulated) {
    NSIndexSet *indexes = [_queue indexesOfObjectsPassingTest:^BOOL(SparkUtterance *entry, NSUInteger, BOOL *) { return listed(entry); }];
    if (!indexes.count) return;
    BOOL current = [indexes containsIndex:0];
    NSArray *stopped = [_queue objectsAtIndexes:indexes];
    [_queue removeObjectsAtIndexes:indexes];
    for (SparkUtterance *entry in stopped) entry.completion(@{ @"finished": @NO }, nil);
    if (current) { _generation++; _paused = NO; [self simulateStart]; }
    return;
  }
#endif
  NSMutableArray<AVSpeechUtterance *> *kept = [NSMutableArray array];
  NSMutableArray<SparkUtterance *> *stopped = [NSMutableArray array];
  for (AVSpeechUtterance *utterance in _order) {
    SparkUtterance *entry = [_speaking objectForKey:utterance];
    if (listed(entry)) [stopped addObject:entry]; else [kept addObject:utterance];
  }
  if (!stopped.count) return;
  // AVSpeechSynthesizer cannot drop one queued utterance: stop them all, then queue the others again (copies: an
  // utterance is spoken once). The one speaking, if kept, starts over.
  NSMutableArray<SparkUtterance *> *entries = [NSMutableArray array];
  for (AVSpeechUtterance *utterance in kept) [entries addObject:[_speaking objectForKey:utterance]];
  [_speaking removeAllObjects];
  [_order removeAllObjects];
  [_synthesizer stopSpeakingAtBoundary:AVSpeechBoundaryImmediate];
  for (SparkUtterance *entry in stopped) entry.completion(@{ @"finished": @NO }, nil);
  [kept enumerateObjectsUsingBlock:^(AVSpeechUtterance *utterance, NSUInteger index, BOOL *) { [self enqueue:[utterance copy] entry:entries[index]]; }];
}

- (void)pauseSpeaking:(NSString *)boundary
{
#if SPARK_TEST_DRIVER
  if (_simulated) {
    if (_paused || !_queue.count) return;
    _paused = YES;
    _generation++;
    [self emit:@{ @"type": @"speech", @"id": _queue.firstObject.identifier, @"event": @"pause" }];
    return;
  }
#endif
  [_synthesizer pauseSpeakingAtBoundary:[boundary isEqual:@"word"] ? AVSpeechBoundaryWord : AVSpeechBoundaryImmediate];
}

- (void)continueSpeaking
{
#if SPARK_TEST_DRIVER
  if (_simulated) {
    if (!_paused) return;
    _paused = NO;
    [self emit:@{ @"type": @"speech", @"id": _queue.firstObject.identifier, @"event": @"resume" }];
    [self simulateStep];
    return;
  }
#endif
  [_synthesizer continueSpeaking];
}

- (NSDictionary *)speakingStatus
{
#if SPARK_TEST_DRIVER
  if (_simulated) return @{ @"speaking": @(_queue.count > 0), @"paused": @(_paused) };
#endif
  return @{ @"speaking": @(_synthesizer.speaking), @"paused": @(_synthesizer.paused) };
}

// Delegate calls arrive on the main thread on macOS; hopping keeps that true if a release changes it.
- (void)onMain:(dispatch_block_t)block { if (NSThread.isMainThread) block(); else dispatch_async(dispatch_get_main_queue(), block); }
- (void)speechSynthesizer:(AVSpeechSynthesizer *)synthesizer didStartSpeechUtterance:(AVSpeechUtterance *)utterance
{
  [self onMain:^{ SparkUtterance *entry = [self->_speaking objectForKey:utterance]; if (entry) [self emit:@{ @"type": @"speech", @"id": entry.identifier, @"event": @"start" }]; }];
}
- (void)speechSynthesizer:(AVSpeechSynthesizer *)synthesizer willSpeakRangeOfSpeechString:(NSRange)range utterance:(AVSpeechUtterance *)utterance
{
  [self onMain:^{
    SparkUtterance *entry = [self->_speaking objectForKey:utterance];
    if (!entry || NSMaxRange(range) > entry.text.length) return;
    [self emit:@{ @"type": @"speech", @"id": entry.identifier, @"event": @"word", @"charIndex": @(range.location), @"charLength": @(range.length), @"word": [entry.text substringWithRange:range] }];
  }];
}
- (void)speechSynthesizer:(AVSpeechSynthesizer *)synthesizer didPauseSpeechUtterance:(AVSpeechUtterance *)utterance
{
  [self onMain:^{ SparkUtterance *entry = [self->_speaking objectForKey:utterance]; if (entry) [self emit:@{ @"type": @"speech", @"id": entry.identifier, @"event": @"pause" }]; }];
}
- (void)speechSynthesizer:(AVSpeechSynthesizer *)synthesizer didContinueSpeechUtterance:(AVSpeechUtterance *)utterance
{
  [self onMain:^{ SparkUtterance *entry = [self->_speaking objectForKey:utterance]; if (entry) [self emit:@{ @"type": @"speech", @"id": entry.identifier, @"event": @"resume" }]; }];
}
- (void)finish:(AVSpeechUtterance *)utterance finished:(BOOL)finished
{
  [self onMain:^{
    SparkUtterance *entry = [self->_speaking objectForKey:utterance];
    if (!entry) return;
    [self->_speaking removeObjectForKey:utterance];
    [self->_order removeObjectIdenticalTo:utterance];
    entry.completion(@{ @"finished": @(finished) }, nil);
  }];
}
- (void)speechSynthesizer:(AVSpeechSynthesizer *)synthesizer didFinishSpeechUtterance:(AVSpeechUtterance *)utterance { [self finish:utterance finished:YES]; }
- (void)speechSynthesizer:(AVSpeechSynthesizer *)synthesizer didCancelSpeechUtterance:(AVSpeechUtterance *)utterance { [self finish:utterance finished:NO]; }

#pragma mark Recognition

- (NSDictionary *)recognizerStatus:(NSString *)locale
{
  NSLocale *requested = locale ? [NSLocale localeWithLocaleIdentifier:locale] : NSLocale.currentLocale;
#if SPARK_TEST_DRIVER
  if (_simulated) {
    BOOL supported = [self.recognitionLocales containsObject:LocaleName(requested)];
    return @{ @"locale": LocaleName(requested), @"supported": @(supported), @"available": @(supported && [_simulation[@"recognizerAvailable"] boolValue]),
      @"onDevice": @(supported && [_simulation[@"onDeviceSupported"] boolValue]) };
  }
#endif
  SFSpeechRecognizer *recognizer = [[SFSpeechRecognizer alloc] initWithLocale:requested];
  return @{ @"locale": LocaleName(recognizer.locale ?: requested), @"supported": @(recognizer != nil), @"available": @(recognizer.isAvailable), @"onDevice": @(recognizer.supportsOnDeviceRecognition) };
}

- (NSArray<NSString *> *)recognitionLocales
{
  NSMutableArray *locales = [NSMutableArray array];
  for (NSLocale *locale in SFSpeechRecognizer.supportedLocales) [locales addObject:LocaleName(locale)];
  return [locales sortedArrayUsingSelector:@selector(compare:)];
}

static NSError *ValidRecognition(NSDictionary *options) {
  if (options[@"locale"] && (![options[@"locale"] isKindOfClass:NSString.class] || ![options[@"locale"] length])) return Failure(@"E_INVALID_ARGUMENT", @"locale is a locale identifier");
  for (NSString *flag in @[@"onDevice", @"partialResults", @"punctuation"])
    if (options[flag] && ![options[flag] isKindOfClass:NSNumber.class]) return Failure(@"E_INVALID_ARGUMENT", [NSString stringWithFormat:@"%@ is a boolean", flag]);
  id strings = options[@"contextualStrings"];
  if (strings && (![strings isKindOfClass:NSArray.class] || [strings count] > 100)) return Failure(@"E_INVALID_ARGUMENT", @"contextualStrings lists at most 100 phrases");
  for (id phrase in strings) if (![phrase isKindOfClass:NSString.class] || ![phrase length]) return Failure(@"E_INVALID_ARGUMENT", @"contextualStrings lists nonempty phrases");
  return nil;
}

- (void)recognize:(NSDictionary *)options identifier:(NSString *)identifier completion:(SparkSpeechCompletion)completion
{
  SparkSpeechCompletion done = Once(completion);
  NSError *invalid = ValidRecognition(options);
  if (!invalid && _recognition) invalid = Failure(@"E_BUSY", @"Another speech recognition is running; one runs at a time");
  if (invalid) return done(nil, invalid);
  NSDictionary *status = [self recognizerStatus:options[@"locale"]];
  if (![status[@"supported"] boolValue]) return done(nil, Failure(@"E_UNAVAILABLE", [NSString stringWithFormat:@"Speech recognition does not support %@", status[@"locale"]]));
  if (![status[@"available"] boolValue]) return done(nil, Failure(@"E_UNAVAILABLE", [NSString stringWithFormat:@"Speech recognition for %@ is not available now", status[@"locale"]]));
  if ([options[@"onDevice"] boolValue] && ![status[@"onDevice"] boolValue]) return done(nil, Failure(@"E_UNAVAILABLE", [NSString stringWithFormat:@"On-device recognition is not available for %@", status[@"locale"]]));
  SparkRecognition *recognition = [SparkRecognition new];
  recognition.identifier = identifier;
  recognition.partialResults = options[@"partialResults"] ? [options[@"partialResults"] boolValue] : YES;
  __weak SparkSpeech *weakSelf = self;
  recognition.completion = ^(id result, NSError *error) {
    SparkSpeech *strongSelf = weakSelf;
    if (strongSelf && [strongSelf->_recognition.identifier isEqual:identifier]) [strongSelf endRecognition];
    done(result, error);
  };
#if SPARK_TEST_DRIVER
  if (_simulated) {
    _recognition = recognition;
    _simulation[@"recognitions"] = @([_simulation[@"recognitions"] integerValue] + 1);
    _simulation[@"lastRecognition"] = @{ @"locale": status[@"locale"], @"onDevice": @([options[@"onDevice"] boolValue]), @"partialResults": @(recognition.partialResults),
      @"punctuation": @([options[@"punctuation"] boolValue]), @"contextualStrings": options[@"contextualStrings"] ?: @[] };
    dispatch_async(dispatch_get_main_queue(), ^{
      if (self->_recognition != recognition) return;
      [self emit:@{ @"type": @"speechRecognition", @"id": identifier, @"event": @"started" }];
      if (recognition.partialResults) [self simulatePartial:0 of:recognition];
    });
    return;
  }
#endif
  // Never prompts: starting the microphone or a recognition task undetermined would.
  if (SFSpeechRecognizer.authorizationStatus != SFSpeechRecognizerAuthorizationStatusAuthorized)
    return done(nil, Failure(@"E_PERMISSION_DENIED", @"Speech recognition is not authorized; request the speechRecognition permission first"));
  if (SparkCaptureEntitlementMissing(@"microphone"))
    return done(nil, Failure(@"E_UNAVAILABLE", @"This build has the hardened runtime without the com.apple.security.device.audio-input entitlement the microphone needs; set macos.capture.microphone in the app config"));
  if ([AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio] != AVAuthorizationStatusAuthorized)
    return done(nil, Failure(@"E_PERMISSION_DENIED", @"The microphone is not authorized; request the microphone permission first"));
  SFSpeechRecognizer *recognizer = [[SFSpeechRecognizer alloc] initWithLocale:options[@"locale"] ? [NSLocale localeWithLocaleIdentifier:options[@"locale"]] : NSLocale.currentLocale];
  SFSpeechAudioBufferRecognitionRequest *request = [SFSpeechAudioBufferRecognitionRequest new];
  request.shouldReportPartialResults = recognition.partialResults;
  request.requiresOnDeviceRecognition = [options[@"onDevice"] boolValue];
  request.addsPunctuation = [options[@"punctuation"] boolValue];
  if (options[@"contextualStrings"]) request.contextualStrings = options[@"contextualStrings"];
  AVAudioEngine *engine = [AVAudioEngine new];
  AVAudioInputNode *input = engine.inputNode;
  AVAudioFormat *format = [input outputFormatForBus:0];
  if (format.sampleRate <= 0 || format.channelCount == 0) return done(nil, Failure(@"E_UNAVAILABLE", @"There is no microphone to listen to"));
  recognition.engine = engine;
  recognition.request = request;
  recognition.recognizer = recognizer;
  _recognition = recognition;
  [input installTapOnBus:0 bufferSize:1024 format:format block:^(AVAudioPCMBuffer *buffer, AVAudioTime *) { [request appendAudioPCMBuffer:buffer]; }];
  // Weak: the recognition owns the task, which owns this handler.
  __weak SparkRecognition *weakRecognition = recognition;
  recognition.task = [recognizer recognitionTaskWithRequest:request resultHandler:^(SFSpeechRecognitionResult *result, NSError *error) {
    dispatch_async(dispatch_get_main_queue(), ^{
      SparkRecognition *current = weakRecognition;
      if (current) [weakSelf recognition:current result:result error:error];
    });
  }];
  // The input changed under the engine (a microphone unplugged, the default device switched): the tap stopped, so the
  // recognition cannot go on.
  recognition.configurationObserver = [NSNotificationCenter.defaultCenter addObserverForName:AVAudioEngineConfigurationChangeNotification object:engine
    queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *) {
      SparkSpeech *strongSelf = weakSelf;
      SparkRecognition *current = weakRecognition;
      if (!strongSelf || !current || strongSelf->_recognition != current) return;
      [current.task cancel];
      current.completion(nil, Failure(@"E_UNAVAILABLE", @"The microphone changed while listening; start the recognition again"));
    }];
  [engine prepare];
  NSError *audioError = nil;
  if (![engine startAndReturnError:&audioError]) {
    [recognition.task cancel];
    return recognition.completion(nil, Failure(@"E_NATIVE", [NSString stringWithFormat:@"The microphone did not start: %@", audioError.localizedDescription]));
  }
  [self emit:@{ @"type": @"speechRecognition", @"id": identifier, @"event": @"started" }];
}

- (void)recognition:(SparkRecognition *)recognition result:(SFSpeechRecognitionResult *)result error:(NSError *)error
{
  if (_recognition != recognition) return; // Cancelled or settled.
  if (result && result.isFinal) return recognition.completion(Recognized(result.bestTranscription.formattedString, Segments(result.bestTranscription)), nil);
  if (result) {
    if (recognition.partialResults)
      [self emit:@{ @"type": @"speechRecognition", @"id": recognition.identifier, @"event": @"partial", @"transcript": result.bestTranscription.formattedString, @"segments": Segments(result.bestTranscription) }];
    return;
  }
  if (SparkRecognitionNoSpeech(error)) return recognition.completion(@{ @"status": @"noSpeech" }, nil);
  recognition.completion(nil, Failure(@"E_NATIVE", [NSString stringWithFormat:@"Speech recognition failed: %@ %ld %@", error.domain, (long)error.code, error.localizedDescription]));
}

// Releases the running recognition: audio, the configuration observer, and the task and request it owns.
- (void)endRecognition
{
  [self stopAudio];
  if (_recognition.configurationObserver) [NSNotificationCenter.defaultCenter removeObserver:_recognition.configurationObserver];
  _recognition.configurationObserver = nil;
  _recognition.task = nil;
  _recognition.request = nil;
  _recognition.recognizer = nil;
  _recognition = nil;
}

- (void)stopAudio
{
  if (!_recognition.engine) return;
  [_recognition.engine stop];
  [_recognition.engine.inputNode removeTapOnBus:0];
  _recognition.engine = nil;
  [_recognition.request endAudio];
}

- (void)finishRecognition:(NSString *)identifier
{
  if (![_recognition.identifier isEqual:identifier]) return;
#if SPARK_TEST_DRIVER
  if (_simulated) {
    SparkRecognition *recognition = _recognition;
    if (recognition.finishing) return;
    recognition.finishing = YES;
    id transcript = _simulation[@"recognitionTranscript"];
    [self afterWord:^{
      if (self->_recognition != recognition) return;
      NSString *text = transcript == NSNull.null ? @"" : transcript;
      NSMutableArray *segments = [NSMutableArray array];
      for (NSDictionary *word in SparkSpeechWords(text)) [segments addObject:@{ @"substring": word[@"word"], @"timestamp": @0, @"duration": @0, @"confidence": @1 }];
      recognition.completion(Recognized(text, segments), nil);
    }];
    return;
  }
#endif
  [self stopAudio]; // The task then delivers its final result.
}

- (void)cancelRecognition:(NSString *)identifier
{
  if (![_recognition.identifier isEqual:identifier]) return;
  SparkRecognition *recognition = _recognition;
  [recognition.task cancel];
  recognition.completion(@{ @"status": @"cancelled" }, nil);
}

#if SPARK_TEST_DRIVER
#pragma mark Simulation

// Runs `block` one simulated word from now.
- (void)afterWord:(dispatch_block_t)block
{
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)([_simulation[@"wordMs"] doubleValue] * NSEC_PER_MSEC)), dispatch_get_main_queue(), block);
}
// The same, unless speech stopped, paused or moved on meanwhile.
- (void)after:(dispatch_block_t)block
{
  NSUInteger generation = _generation;
  __weak SparkSpeech *weakSelf = self;
  [self afterWord:^{
    SparkSpeech *strongSelf = weakSelf;
    if (strongSelf && strongSelf->_generation == generation) block();
  }];
}

- (void)simulateStart
{
  SparkUtterance *entry = _queue.firstObject;
  if (!entry) return;
  _generation++;
  [self emit:@{ @"type": @"speech", @"id": entry.identifier, @"event": @"start" }];
  [self simulateStep];
}

// Reports the next word after a word's time, then finishes and starts the next utterance.
- (void)simulateStep
{
  [self after:^{
    SparkUtterance *entry = self->_queue.firstObject;
    if (!entry || self->_paused) return;
    if (entry.next < entry.words.count) {
      NSMutableDictionary *event = [@{ @"type": @"speech", @"id": entry.identifier, @"event": @"word" } mutableCopy];
      [event addEntriesFromDictionary:entry.words[entry.next++]];
      [self emit:event];
      return [self simulateStep];
    }
    [self->_queue removeObjectAtIndex:0];
    entry.completion(@{ @"finished": @YES }, nil);
    [self simulateStart];
  }];
}

- (void)simulatePartial:(NSUInteger)index of:(SparkRecognition *)recognition
{
  NSArray *partials = _simulation[@"recognitionPartials"];
  if (index >= partials.count) return;
  [self afterWord:^{
    if (self->_recognition != recognition || recognition.finishing) return;
    NSString *transcript = partials[index];
    NSMutableArray *segments = [NSMutableArray array];
    for (NSDictionary *word in SparkSpeechWords(transcript)) [segments addObject:@{ @"substring": word[@"word"], @"timestamp": @0, @"duration": @0, @"confidence": @0 }];
    [self emit:@{ @"type": @"speechRecognition", @"id": recognition.identifier, @"event": @"partial", @"transcript": transcript, @"segments": segments }];
    [self simulatePartial:index + 1 of:recognition];
  }];
}

- (BOOL)simulate:(NSDictionary *)state error:(NSError **)error
{
  NSError *failure = _simulated ? nil : Failure(@"E_UNAVAILABLE", @"Speech simulation needs the test driver");
  for (NSString *field in state) {
    if (failure) break;
    id value = state[field];
    if ([field isEqual:@"wordMs"]) { if (!Number(value, 1, 10000)) failure = Failure(@"E_INVALID_ARGUMENT", @"wordMs is 1–10000"); }
    else if ([@[@"recognizerAvailable", @"onDeviceSupported"] containsObject:field]) { if (![value isKindOfClass:NSNumber.class]) failure = Failure(@"E_INVALID_ARGUMENT", [NSString stringWithFormat:@"%@ is a boolean", field]); }
    else if ([field isEqual:@"recognitionPartials"]) {
      BOOL valid = [value isKindOfClass:NSArray.class];
      for (id partial in valid ? value : @[]) valid = valid && [partial isKindOfClass:NSString.class];
      if (!valid) failure = Failure(@"E_INVALID_ARGUMENT", @"recognitionPartials lists strings");
    } else if ([field isEqual:@"recognitionTranscript"]) { if (value != NSNull.null && ![value isKindOfClass:NSString.class]) failure = Failure(@"E_INVALID_ARGUMENT", @"recognitionTranscript is a string or null"); }
    else failure = Failure(@"E_INVALID_ARGUMENT", [NSString stringWithFormat:@"Unknown speech simulation field: %@", field]);
  }
  if (failure) { if (error) *error = failure; return NO; }
  [_simulation addEntriesFromDictionary:state];
  return YES;
}

- (NSDictionary *)simulation
{
  NSMutableDictionary *simulation = [_simulation mutableCopy];
  simulation[@"utterances"] = [_spoken copy];
  simulation[@"speaking"] = @(_queue.count > 0);
  simulation[@"paused"] = @(_paused);
  simulation[@"listening"] = @(_recognition != nil);
  return simulation;
}
#endif
@end
