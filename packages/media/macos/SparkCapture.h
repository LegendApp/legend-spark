#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>

// Microphone recording, the camera with its preview and photos, and screen capture for @legendapp/spark/capture
// (docs/capture.md). No React: tests/media.native.mm drives it directly, and RNDesktopCameraView shows a camera.
//
// Never prompts. Every capture first checks the permission without asking (AVCaptureDevice authorizationStatus,
// CGPreflightScreenCaptureAccess) and fails E_PERMISSION_DENIED unless it is granted; nothing reaches a device before.
// Under the hardened runtime the camera and microphone also need their entitlements (macos.capture in the app config);
// without one they fail E_UNAVAILABLE and `availability` says missing-entitlement.
//
// A session (an audio recording, the camera, a screen recording) completes once: a recording with
// { status: "recorded", uri, duration, size } or { status: "cancelled" }, the camera with NSNull once stopped; a device
// that goes away or fails ends it with an error. `observer` receives { type: "capture", id, event: "started" } once it
// runs, and for an audio recording with levels { event: "level", average, peak } (dBFS) ten times a second. One session
// of each kind runs at a time. A device interrupted (another app took it) ends its session E_UNAVAILABLE, and recordings
// in progress when the app quits are finished first.
//
// SPARK_TEST_DRIVER builds (docs/test-driver.md#builds) add a simulated mode for the in-app test driver: a simulated
// camera and microphone with synthetic frames and levels, and a simulated display and window. It never opens an
// AVCaptureDevice, ScreenCaptureKit or TCC; it writes real files from synthetic content. Its permissions come from
// `permission` (the permissions package's simulation).
#ifndef SPARK_TEST_DRIVER
#define SPARK_TEST_DRIVER 1
#endif

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSErrorDomain const SparkCaptureErrorDomain;
// The Spark error code (E_INVALID_ARGUMENT, E_NOT_FOUND, E_ALREADY_EXISTS, E_UNAVAILABLE, E_PERMISSION_DENIED, E_BUSY,
// E_CLOSED, E_ABORTED, E_NATIVE) of an error from this file.
FOUNDATION_EXPORT NSString *SparkCaptureErrorCode(NSError *error);
FOUNDATION_EXPORT NSError *SparkCaptureError(NSString *code, NSString *message);
// Posted on the main thread when a camera starts or stops; RNDesktopCameraView looks its camera up again.
FOUNDATION_EXPORT NSNotificationName const SparkCaptureCamerasDidChangeNotification;
// Where a capture writes: `uri` (an absolute path or file URL with `extension`, in an existing directory, not an
// existing file) or, when nil, a new file in the temporary directory.
FOUNDATION_EXPORT NSURL *_Nullable SparkCaptureOutputURL(id _Nullable uri, NSString *extension, NSError **error);
// A synthetic frame (color bars and a bar that moves with `frame`), the same for the same arguments.
// Whether this process has the hardened runtime without the entitlement `kind` (camera or microphone) needs:
// com.apple.security.device.camera or com.apple.security.device.audio-input.
FOUNDATION_EXPORT BOOL SparkCaptureEntitlementMissing(NSString *kind);
FOUNDATION_EXPORT CGImageRef SparkCaptureSyntheticFrame(size_t width, size_t height, NSUInteger frame) CF_RETURNS_RETAINED;

typedef void (^SparkCaptureCompletion)(id _Nullable result, NSError *_Nullable error);

// Main thread only. Completions run once, on the main thread.
@interface SparkCapture : NSObject
- (instancetype)initWithSimulated:(BOOL)simulated NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
@property (nonatomic, readonly) BOOL simulated;
@property (nonatomic, copy, nullable) void (^observer)(NSDictionary *event);
// Simulated instances only: the authorization of a permission kind (camera, microphone, screenRecording), such as
// "authorized". Without it nothing is granted.
@property (nonatomic, copy, nullable) NSString *_Nullable (^permission)(NSString *kind);
// Whether this macOS records the screen to a file (SCRecordingOutput, macOS 15); also when simulated.
@property (class, nonatomic, readonly) BOOL screenRecordingSupported;

// { camera, microphone: "available" | "missing-entitlement", screenRecording: BOOL }.
- (NSDictionary *)availability;
// Stops every running recording and waits on the main run loop, up to `seconds`, until their files are finished.
- (void)finishRecordings:(NSTimeInterval)seconds;

// [{ id, name, kind, default }] for `camera` or `microphone`. Never prompts or opens a device.
- (nullable NSArray<NSDictionary *> *)devices:(NSString *)kind error:(NSError **)error;

// options: deviceId, uri (.m4a), levels (report levels). AAC in an M4A file.
- (void)recordAudio:(NSDictionary *)options identifier:(NSString *)identifier completion:(SparkCaptureCompletion)completion;
// options: deviceId.
- (void)startCamera:(NSDictionary *)options identifier:(NSString *)identifier completion:(SparkCaptureCompletion)completion;
// options: display or window (an id from screenSources:; default the main display), uri (.mov), showsCursor (default YES).
- (void)recordScreen:(NSDictionary *)options identifier:(NSString *)identifier completion:(SparkCaptureCompletion)completion;
// A recording completes recorded; the camera stops. Nothing when `identifier` is not running.
- (void)stop:(NSString *)identifier;
// A recording completes cancelled and its file is deleted; the camera stops.
- (void)cancel:(NSString *)identifier;

// A JPEG of the running camera: { uri, width, height }. options: uri (.jpg).
- (void)takePhoto:(NSString *)identifier options:(NSDictionary *)options completion:(SparkCaptureCompletion)completion;
// { width, height } of a running camera; nil when it is not running.
- (nullable NSDictionary *)cameraStatus:(NSString *)identifier;
// A new layer showing the running camera (AVCaptureVideoPreviewLayer, or synthetic frames); nil when it is not running.
- (nullable CALayer *)makePreviewLayer:(NSString *)identifier;

// { displays: [{ id, width, height }], windows: [{ id, title, app, width, height }] } (points) through ScreenCaptureKit.
- (void)screenSources:(SparkCaptureCompletion)completion;
// A PNG of a display or window at its pixel size: { uri, width, height }. options: display, window, uri (.png), showsCursor.
- (void)screenshot:(NSDictionary *)options completion:(SparkCaptureCompletion)completion;

#if SPARK_TEST_DRIVER
// Simulated instances only. cameras, microphones: whether the simulated device is connected; disconnecting one ends
// its session E_UNAVAILABLE, as unplugging it would. cameraEntitled, microphoneEntitled: whether the build has the
// entitlement (default: the real state).
- (BOOL)simulate:(NSDictionary *)state error:(NSError **)error;
// { cameras, microphones, cameraEntitled, microphoneEntitled, recordingAudio, cameraRunning, recordingScreen, frames, levels, photos, screenshots, recordings }.
- (NSDictionary *)simulation;
#endif
@end

NS_ASSUME_NONNULL_END
