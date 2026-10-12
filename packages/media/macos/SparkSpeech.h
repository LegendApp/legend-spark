#import <Foundation/Foundation.h>

// Text to speech (AVSpeechSynthesizer) and speech recognition (SFSpeechRecognizer) for @legendapp/spark/speech
// (docs/speech.md). No React: tests/media.native.mm drives it directly.
//
// Utterances queue: each speak completion runs when its utterance finishes ({ finished: YES }) or is stopped
// ({ finished: NO }). While it speaks, `observer` receives { type: "speech", id, event: start | word | pause | resume },
// a word with { charIndex, charLength, word } in UTF-16 code units of the text.
//
// One recognition runs at a time, from the default microphone. Its completion runs once with the outcome:
// { status: "recognized", transcript, segments }, { status: "noSpeech" } or { status: "cancelled" }. `observer` receives
// { type: "speechRecognition", id, event: "started" } once audio flows, and { event: "partial", transcript, segments }.
// Recognition never prompts: it fails E_PERMISSION_DENIED unless speech recognition and the microphone are authorized.
//
// SPARK_TEST_DRIVER builds (docs/test-driver.md#builds) add a simulated mode for the in-app test driver: utterances are
// recorded and timed word by word, never spoken; recognition plays back a scripted transcript and never touches the
// microphone, a recognizer or TCC.
#ifndef SPARK_TEST_DRIVER
#define SPARK_TEST_DRIVER 1
#endif

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSErrorDomain const SparkSpeechErrorDomain;
// The Spark error code (E_INVALID_ARGUMENT, E_NOT_FOUND, E_UNAVAILABLE, E_PERMISSION_DENIED, E_BUSY, E_NATIVE) of an error from this file.
FOUNDATION_EXPORT NSString *SparkSpeechErrorCode(NSError *error);
// AVSpeechSynthesisVoiceQuality to default, enhanced or premium; AVSpeechSynthesisVoiceGender to male, female or unspecified.
FOUNDATION_EXPORT NSString *SparkVoiceQuality(NSInteger quality);
FOUNDATION_EXPORT NSString *SparkVoiceGender(NSInteger gender);
// The AVSpeechUtterance rate for a Spark rate: 1 is AVSpeechUtteranceDefaultSpeechRate, scaled linearly and clamped
// to AVSpeechUtteranceMinimumSpeechRate–AVSpeechUtteranceMaximumSpeechRate.
FOUNDATION_EXPORT float SparkUtteranceRate(double rate);
// The words of `text` (NSStringEnumerationByWords) as { charIndex, charLength, word }.
FOUNDATION_EXPORT NSArray<NSDictionary *> *SparkSpeechWords(NSString *text);
// Whether a recognition error means nobody spoke (kAFAssistantErrorDomain 1110).
FOUNDATION_EXPORT BOOL SparkRecognitionNoSpeech(NSError *error);

typedef void (^SparkSpeechCompletion)(id _Nullable result, NSError *_Nullable error);

// Main thread only. Completions run once, on the main thread.
@interface SparkSpeech : NSObject
- (instancetype)initWithSimulated:(BOOL)simulated NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
@property (nonatomic, readonly) BOOL simulated;
@property (nonatomic, copy, nullable) void (^observer)(NSDictionary *event);

// [{ identifier, name, language, quality, gender }], from AVSpeechSynthesisVoice (also when simulated).
- (NSArray<NSDictionary *> *)voices;
// options: voice (identifier), language (BCP 47), rate (0.1–2, 1 normal), pitch (0.5–2), volume (0–1).
- (void)speak:(NSString *)text options:(NSDictionary *)options identifier:(NSString *)identifier completion:(SparkSpeechCompletion)completion;
// Stops the utterance speaking and every queued one; each completes { finished: NO }.
- (void)stopSpeaking;
// boundary: immediate or word.
- (void)pauseSpeaking:(NSString *)boundary;
- (void)continueSpeaking;
// { speaking, paused }.
- (NSDictionary *)speakingStatus;

// { locale, supported, available, onDevice } for a locale identifier (nil: the current locale).
- (NSDictionary *)recognizerStatus:(nullable NSString *)locale;
// Sorted locale identifiers SFSpeechRecognizer supports.
- (NSArray<NSString *> *)recognitionLocales;
// options: locale, onDevice (require on-device recognition), partialResults (default YES), contextualStrings, punctuation.
- (void)recognize:(NSDictionary *)options identifier:(NSString *)identifier completion:(SparkSpeechCompletion)completion;
// Stops listening; the recognition completes with its final result. Nothing when `identifier` is not running.
- (void)finishRecognition:(NSString *)identifier;
// Completes it { status: "cancelled" } at once.
- (void)cancelRecognition:(NSString *)identifier;

#if SPARK_TEST_DRIVER
// Simulated instances only. Any of wordMs (how long a simulated word takes, default 20), recognizerAvailable,
// onDeviceSupported, recognitionPartials (strings reported as partial results, one per wordMs, once listening) and
// recognitionTranscript (the final transcript once the recognition finishes; NSNull: nobody spoke).
- (BOOL)simulate:(NSDictionary *)state error:(NSError **)error;
// { wordMs, recognizerAvailable, onDeviceSupported, utterances: [{ text, voice, language, rate, pitch, volume }], speaking,
// paused, recognitions, listening, lastRecognition (NSNull before the first) }.
- (NSDictionary *)simulation;
#endif
@end

NS_ASSUME_NONNULL_END
