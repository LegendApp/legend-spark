#import <AppKit/AppKit.h>
#import <AVFoundation/AVFoundation.h>

// Video players for @legendapp/spark/video (docs/video.md). No React: tests/media.native.mm drives it directly, and
// RNDesktopVideoView shows a player by identifier.
//
// A player is an AVPlayer for one item. Its status is { playing, currentTime, duration, rate, volume, muted, ended,
// width, height, fullscreen, pictureInPicture, error }. While `observer` is set, the player reports a fresh status
// whenever one of its fields changes (four times a second while playing), and `seeked` once a seek completes.
//
// Fullscreen shows the player in its own window, made fullscreen on the screen of the app's key window, and ends when
// the person presses Escape or leaves fullscreen. Picture in picture floats the video of the view that showed the player
// last (AVPictureInPictureController), and needs that view in a window.
//
// SPARK_TEST_DRIVER builds (docs/test-driver.md#builds) add a simulated mode for the in-app test driver: playback is
// real (the Kitchen Sink clip has no audio track), but fullscreen and picture in picture change the status and report
// their events without opening a window.
#ifndef SPARK_TEST_DRIVER
#define SPARK_TEST_DRIVER 1
#endif

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSErrorDomain const SparkVideoErrorDomain;
// The Spark error code (E_INVALID_ARGUMENT, E_NOT_FOUND, E_ALREADY_EXISTS, E_UNAVAILABLE, E_BUSY, E_ABORTED, E_CLOSED, E_TIMEOUT, E_NATIVE) of an error from this file.
FOUNDATION_EXPORT NSString *SparkVideoErrorCode(NSError *error);
FOUNDATION_EXPORT NSError *SparkVideoError(NSString *code, NSString *message);
// Posted on the main thread when a player is created or removed; RNDesktopVideoView looks its player up again.
FOUNDATION_EXPORT NSNotificationName const SparkVideoPlayersDidChangeNotification;
// An absolute path, or a file, http or https URL; nil with E_INVALID_ARGUMENT for anything else, E_NOT_FOUND for an
// unreadable file.
FOUNDATION_EXPORT NSURL *_Nullable SparkVideoURL(id uri, NSError **error);
// AVPictureInPictureController.isPictureInPictureSupported.
FOUNDATION_EXPORT BOOL SparkVideoPictureInPictureSupported(void);

typedef void (^SparkVideoCompletion)(id _Nullable result, NSError *_Nullable error);

// Main thread only. Completions run once, on the main thread.
@interface SparkVideoPlayer : NSObject
// Registers the player under `identifier` (unique per process); `simulated` only in builds with the test driver.
- (instancetype)initWithIdentifier:(NSString *)identifier url:(NSURL *)url simulated:(BOOL)simulated NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
+ (nullable SparkVideoPlayer *)playerWithIdentifier:(NSString *)identifier;
@property (nonatomic, readonly) NSString *identifier;
@property (nonatomic, readonly) AVPlayer *player;
@property (nonatomic, readonly) BOOL simulated;
@property (nonatomic, readonly) BOOL removed;
// { type: "status", status } on a change, { type: "seeked", status } once a seek completes. Observation is installed
// only while this is set.
@property (nonatomic, copy, nullable) void (^observer)(NSDictionary *event);
- (NSDictionary *)status;
// Resolves @YES once the item is ready to play; rejects with the item's error, or E_CLOSED when the player is removed.
- (void)awaitReady:(SparkVideoCompletion)completion;
- (void)play;
- (void)pause;
// Resolves once the seek completes exactly; E_ABORTED when a later seek or removal interrupts it.
- (void)seekTo:(double)seconds completion:(SparkVideoCompletion)completion;
- (nullable NSError *)setRate:(double)rate;     // 0.25–4: the rate playback runs at.
- (nullable NSError *)setVolume:(double)volume; // 0–1.
- (void)setMuted:(BOOL)muted;
@property (nonatomic) BOOL loop;
// Views that show the player; picture in picture uses the last attached one.
- (void)attachLayer:(AVPlayerLayer *)layer;
- (void)detachLayer:(AVPlayerLayer *)layer;
@property (nonatomic, readonly) NSUInteger attachedLayers;
- (void)enterFullscreen:(SparkVideoCompletion)completion;
- (void)exitFullscreen:(SparkVideoCompletion)completion;
- (void)startPictureInPicture:(SparkVideoCompletion)completion;
- (void)stopPictureInPicture:(SparkVideoCompletion)completion;
// Ends fullscreen and picture in picture, stops playback and unregisters. Idempotent.
- (void)remove;
@end

NS_ASSUME_NONNULL_END
