#import "SparkCapture.h"
#import <AVFoundation/AVFoundation.h>
#import <ImageIO/ImageIO.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <Security/Security.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

NSErrorDomain const SparkCaptureErrorDomain = @"so.legend.spark.capture";
NSNotificationName const SparkCaptureCamerasDidChangeNotification = @"SparkCaptureCamerasDidChange";
NSError *SparkCaptureError(NSString *code, NSString *message) {
  return [NSError errorWithDomain:SparkCaptureErrorDomain code:0 userInfo:@{ @"code": code, NSLocalizedDescriptionKey: message }];
}
NSString *SparkCaptureErrorCode(NSError *error) {
  NSString *code = [error.domain isEqual:SparkCaptureErrorDomain] ? error.userInfo[@"code"] : nil;
  return code ?: @"E_NATIVE";
}
static void OnMain(dispatch_block_t block) { if (NSThread.isMainThread) block(); else dispatch_async(dispatch_get_main_queue(), block); }
static SparkCaptureCompletion Once(SparkCaptureCompletion completion) {
  __block SparkCaptureCompletion pending = [completion copy];
  return ^(id result, NSError *error) {
    OnMain(^{
      SparkCaptureCompletion callback = pending;
      pending = nil;
      if (callback) callback(result, error);
    });
  };
}

NSURL *SparkCaptureOutputURL(id uri, NSString *extension, NSError **error) {
  NSFileManager *files = NSFileManager.defaultManager;
  if (!uri || uri == NSNull.null)
    return [NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"spark-capture-%@.%@", NSUUID.UUID.UUIDString, extension]]];
  NSURL *url = nil;
  if ([uri isKindOfClass:NSString.class] && [uri length] && ![uri containsString:@"\0"])
    url = [uri hasPrefix:@"/"] ? [NSURL fileURLWithPath:uri] : [NSURL URLWithString:uri];
  if (!url.isFileURL || ![url.pathExtension.lowercaseString isEqual:extension]) {
    if (error) *error = SparkCaptureError(@"E_INVALID_ARGUMENT", [NSString stringWithFormat:@"A capture uri is an absolute path or file URL ending .%@", extension]);
    return nil;
  }
  BOOL directory = NO;
  if (![files fileExistsAtPath:url.URLByDeletingLastPathComponent.path isDirectory:&directory] || !directory) {
    if (error) *error = SparkCaptureError(@"E_NOT_FOUND", [NSString stringWithFormat:@"The directory does not exist: %@", url.URLByDeletingLastPathComponent.path]);
    return nil;
  }
  if ([files fileExistsAtPath:url.path]) {
    if (error) *error = SparkCaptureError(@"E_ALREADY_EXISTS", [NSString stringWithFormat:@"A file exists at %@", url.path]);
    return nil;
  }
  return url;
}

CGImageRef SparkCaptureSyntheticFrame(size_t width, size_t height, NSUInteger frame) {
  static const CGFloat bars[7][3] = { { 0.75, 0.75, 0.75 }, { 0.75, 0.75, 0 }, { 0, 0.75, 0.75 }, { 0, 0.75, 0 }, { 0.75, 0, 0.75 }, { 0.75, 0, 0 }, { 0, 0, 0.75 } };
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(NULL, width, height, 8, 0, space, kCGImageAlphaPremultipliedLast);
  for (int bar = 0; bar < 7; bar++) {
    CGContextSetRGBFillColor(context, bars[bar][0], bars[bar][1], bars[bar][2], 1);
    CGContextFillRect(context, CGRectMake(floor(width * bar / 7.0), 0, ceil(width / 7.0), height));
  }
  CGFloat marker = MAX(2, round(width / 40.0)); // A white bar that moves one bar width per frame.
  CGContextSetRGBFillColor(context, 1, 1, 1, 1);
  CGContextFillRect(context, CGRectMake(fmod(frame * marker, width), 0, marker, height));
  CGImageRef image = CGBitmapContextCreateImage(context);
  CGContextRelease(context);
  CGColorSpaceRelease(space);
  return image;
}

static NSError *WriteImage(CGImageRef image, NSURL *url, UTType *type) {
  CGImageDestinationRef destination = CGImageDestinationCreateWithURL((__bridge CFURLRef)url, (__bridge CFStringRef)type.identifier, 1, NULL);
  BOOL written = destination && (CGImageDestinationAddImage(destination, image, NULL), CGImageDestinationFinalize(destination));
  if (destination) CFRelease(destination);
  return written ? nil : SparkCaptureError(@"E_NATIVE", [NSString stringWithFormat:@"The image could not be written to %@", url.path]);
}
static NSDictionary *Image(NSURL *url, size_t width, size_t height) { return @{ @"uri": url.path, @"width": @(width), @"height": @(height) }; }
static NSDictionary *Recorded(NSURL *url, double duration) {
  unsigned long long size = [[NSFileManager.defaultManager attributesOfItemAtPath:url.path error:nil] fileSize];
  return @{ @"status": @"recorded", @"uri": url.path, @"duration": @(isfinite(duration) && duration > 0 ? duration : 0), @"size": @(size) };
}
static NSDictionary *const Cancelled = @{ @"status": @"cancelled" };

static NSString *EntitlementKey(NSString *kind) { return [kind isEqual:@"camera"] ? @"com.apple.security.device.camera" : @"com.apple.security.device.audio-input"; }
BOOL SparkCaptureEntitlementMissing(NSString *kind) {
  static BOOL hardened, camera, microphone;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    SecCodeRef code = NULL;
    CFDictionaryRef info = NULL;
    if (SecCodeCopySelf(kSecCSDefaultFlags, &code) == errSecSuccess && SecCodeCopySigningInformation((SecStaticCodeRef)code, kSecCSDynamicInformation, &info) == errSecSuccess)
      hardened = ([((__bridge NSDictionary *)info)[(__bridge NSString *)kSecCodeInfoFlags] unsignedIntValue] & kSecCodeSignatureRuntime) != 0;
    if (info) CFRelease(info);
    if (code) CFRelease(code);
    SecTaskRef task = SecTaskCreateFromSelf(NULL);
    BOOL (^entitled)(NSString *) = ^BOOL(NSString *key) {
      CFTypeRef value = task ? SecTaskCopyValueForEntitlement(task, (__bridge CFStringRef)key, NULL) : NULL;
      BOOL granted = value == kCFBooleanTrue;
      if (value) CFRelease(value);
      return granted;
    };
    camera = entitled(EntitlementKey(@"camera"));
    microphone = entitled(EntitlementKey(@"microphone"));
    if (task) CFRelease(task);
  });
  return hardened && !([kind isEqual:@"camera"] ? camera : microphone);
}
static NSError *MissingEntitlement(NSString *kind) {
  return SparkCaptureError(@"E_UNAVAILABLE", [NSString stringWithFormat:@"This build has the hardened runtime without the %@ entitlement the %@ needs; set macos.capture.%@ in the app config", EntitlementKey(kind), kind, kind]);
}
static NSArray<AVCaptureDevice *> *CaptureDevices(BOOL camera) {
  NSArray *types = camera ? @[AVCaptureDeviceTypeBuiltInWideAngleCamera, AVCaptureDeviceTypeContinuityCamera, AVCaptureDeviceTypeExternal] : @[AVCaptureDeviceTypeMicrophone, AVCaptureDeviceTypeExternal];
  return [AVCaptureDeviceDiscoverySession discoverySessionWithDeviceTypes:types mediaType:camera ? AVMediaTypeVideo : AVMediaTypeAudio position:AVCaptureDevicePositionUnspecified].devices;
}
// display and window are ids from the sources, at most one; showsCursor a boolean.
static NSError *InvalidSource(NSDictionary *options) {
  for (NSString *key in @[@"display", @"window"]) {
    id value = options[key];
    if (value && (![value isKindOfClass:NSNumber.class] || [value doubleValue] < 0 || [value doubleValue] != floor([value doubleValue]) || [value doubleValue] > UINT32_MAX))
      return SparkCaptureError(@"E_INVALID_ARGUMENT", [NSString stringWithFormat:@"%@ is a source id", key]);
  }
  if (options[@"display"] && options[@"window"]) return SparkCaptureError(@"E_INVALID_ARGUMENT", @"Capture a display or a window, not both");
  if (options[@"showsCursor"] && ![options[@"showsCursor"] isKindOfClass:NSNumber.class]) return SparkCaptureError(@"E_INVALID_ARGUMENT", @"showsCursor is a boolean");
  return nil;
}

#if SPARK_TEST_DRIVER
static NSDictionary *const SimulatedSources = @{
  @"displays": @[@{ @"id": @1, @"width": @1440, @"height": @900 }],
  @"windows": @[@{ @"id": @2, @"title": @"Simulated Window", @"app": @"Simulated App", @"width": @800, @"height": @600 }],
};
static const double SimulatedFrameRate = 15;
#endif

// Records the screen with ScreenCaptureKit (SCRecordingOutput): its own class, since that API needs macOS 15.
API_AVAILABLE(macos(15.0))
@interface SparkScreenRecorder : NSObject <SCStreamDelegate, SCRecordingOutputDelegate>
@property (nonatomic, copy) void (^started)(void);
@property (nonatomic, copy) void (^finished)(double duration, NSError *_Nullable error); // Main thread; may run more than once.
@end
@implementation SparkScreenRecorder {
  SCStream *_stream;
  SCRecordingOutput *_output;
}
- (BOOL)start:(SCContentFilter *)filter configuration:(SCStreamConfiguration *)configuration url:(NSURL *)url error:(NSError **)error
{
  SCRecordingOutputConfiguration *recording = [SCRecordingOutputConfiguration new];
  recording.outputURL = url;
  recording.outputFileType = AVFileTypeQuickTimeMovie;
  _output = [[SCRecordingOutput alloc] initWithConfiguration:recording delegate:self];
  _stream = [[SCStream alloc] initWithFilter:filter configuration:configuration delegate:self];
  if (![_stream addRecordingOutput:_output error:error]) return NO;
  [_stream startCaptureWithCompletionHandler:^(NSError *failure) { if (failure) [self finish:0 error:failure]; }];
  return YES;
}
- (void)stopScreenRecording { [_stream stopCaptureWithCompletionHandler:^(NSError *) {}]; }
- (void)finish:(double)duration error:(NSError *)error { OnMain(^{ if (self.finished) self.finished(duration, error); }); }
- (void)recordingOutputDidStartRecording:(SCRecordingOutput *)output { OnMain(^{ if (self.started) self.started(); }); }
- (void)recordingOutputDidFinishRecording:(SCRecordingOutput *)output { [self finish:CMTimeGetSeconds(output.recordedDuration) error:nil]; }
- (void)recordingOutput:(SCRecordingOutput *)output didFailWithError:(NSError *)error { [self finish:0 error:error]; }
- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error { [self finish:0 error:error]; }
@end

@class SparkCapture;
// A running audio recording, camera or screen recording.
@interface SparkCaptureSession : NSObject <AVCaptureFileOutputRecordingDelegate, AVCapturePhotoCaptureDelegate>
@property (nonatomic, copy) NSString *identifier;
@property (nonatomic, copy) NSString *kind; // audio, camera or screen
@property (nonatomic, copy) SparkCaptureCompletion completion;
@property (nonatomic, weak) SparkCapture *owner;
@property (nonatomic) NSURL *url;                  // Recordings.
@property (nonatomic) BOOL levels;                 // Audio: report levels.
@property (nonatomic) NSDate *startedAt;           // Once running.
@property (nonatomic) BOOL cancelled;              // Stopping discards the file.
@property (nonatomic) NSError *failure;            // Stopping ends with it.
@property (nonatomic) BOOL discard;                // Ended without a recording: the finish callback deletes the file.
@property (nonatomic) CGSize size;                 // The camera's or screen's pixel size.
@property (nonatomic) NSTimer *timer;              // Levels, or simulated frames.
@property (nonatomic) NSMutableArray *tokens;      // Notification observers.
@property (nonatomic) AVCaptureSession *session;
@property (nonatomic) AVCaptureAudioFileOutput *audioOutput;
@property (nonatomic) AVCapturePhotoOutput *photoOutput;
@property (nonatomic, copy) SparkCaptureCompletion photo; // The photo being taken.
@property (nonatomic) NSURL *photoURL;
@property (nonatomic) id recorder;                 // SparkScreenRecorder.
@property (nonatomic) NSUInteger frames;           // Simulated.
@property (nonatomic) NSHashTable<CALayer *> *layers; // Simulated preview layers.
@property (nonatomic) AVAssetWriter *writer;       // Simulated screen recording.
@property (nonatomic) AVAssetWriterInputPixelBufferAdaptor *adaptor;
@end

@interface SparkCapture ()
- (void)started:(SparkCaptureSession *)session;
- (void)finished:(SparkCaptureSession *)session duration:(double)duration error:(NSError *)error;
@end

@implementation SparkCaptureSession
- (void)captureOutput:(AVCaptureFileOutput *)output didStartRecordingToOutputFileAtURL:(NSURL *)url fromConnections:(NSArray *)connections
{
  OnMain(^{ [self.owner started:self]; });
}
- (void)captureOutput:(AVCaptureFileOutput *)output didFinishRecordingToOutputFileAtURL:(NSURL *)url fromConnections:(NSArray *)connections error:(NSError *)error
{
  double duration = CMTimeGetSeconds(output.recordedDuration);
  // AVFoundation reports some finished recordings with an error, such as reaching a limit; the file is complete then.
  NSError *failure = error && ![error.userInfo[AVErrorRecordingSuccessfullyFinishedKey] boolValue] ? error : nil;
  OnMain(^{ [self.owner finished:self duration:duration error:failure]; });
}
- (void)captureOutput:(AVCapturePhotoOutput *)output didFinishProcessingPhoto:(AVCapturePhoto *)photo error:(NSError *)error
{
  NSData *data = error ? nil : photo.fileDataRepresentation;
  CMVideoDimensions dimensions = photo.resolvedSettings.photoDimensions;
  OnMain(^{
    SparkCaptureCompletion done = self.photo;
    self.photo = nil;
    if (!done) return;
    NSError *written = nil;
    if (!data) return done(nil, SparkCaptureError(@"E_NATIVE", [NSString stringWithFormat:@"The camera took no photo: %@", error.localizedDescription ?: @"no data"]));
    if (![data writeToURL:self.photoURL options:NSDataWritingWithoutOverwriting error:&written])
      return done(nil, SparkCaptureError(@"E_NATIVE", [NSString stringWithFormat:@"The photo could not be written: %@", written.localizedDescription]));
    done(Image(self.photoURL, dimensions.width, dimensions.height), nil);
  });
}
@end

@implementation SparkCapture {
  NSMutableDictionary<NSString *, SparkCaptureSession *> *_sessions;
  dispatch_queue_t _queue; // AVCaptureSession start and stop block; they run here.
  NSMutableSet<SparkCaptureSession *> *_finishing; // Ended recordings whose file output has not finished yet.
  id _terminateObserver;
#if SPARK_TEST_DRIVER
  NSMutableDictionary *_simulation;
#endif
}

+ (BOOL)screenRecordingSupported { if (@available(macOS 15.0, *)) return YES; return NO; }

- (instancetype)initWithSimulated:(BOOL)simulated
{
  if ((self = [super init])) {
    _sessions = [NSMutableDictionary dictionary];
    _queue = dispatch_queue_create("so.legend.spark.capture", DISPATCH_QUEUE_SERIAL);
    _finishing = [NSMutableSet set];
    // A recording in progress when the app quits is finished, so its file is complete.
    __weak SparkCapture *weakSelf = self;
    _terminateObserver = [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationWillTerminateNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *) {
      [weakSelf finishRecordings:3];
    }];
#if SPARK_TEST_DRIVER
    _simulated = simulated;
    if (simulated) _simulation = [@{ @"cameras": @YES, @"microphones": @YES,
      @"cameraEntitled": @(!SparkCaptureEntitlementMissing(@"camera")), @"microphoneEntitled": @(!SparkCaptureEntitlementMissing(@"microphone")), @"frames": @0, @"levels": @0, @"photos": @0, @"screenshots": @0, @"recordings": @0 } mutableCopy];
#else
    NSAssert(!simulated, @"Simulated capture exists only in builds with the test driver");
#endif
  }
  return self;
}

- (void)dealloc { [NSNotificationCenter.defaultCenter removeObserver:_terminateObserver]; }

- (void)emit:(NSDictionary *)event { if (_observer) _observer(event); }

#pragma mark Permissions and entitlements

// Whether `kind` (camera, microphone, screenRecording) is granted, asked without prompting: TCC, or when simulated the
// permission handler (the permissions package's simulated state).
- (NSError *)unauthorized:(NSString *)kind
{
  BOOL granted = NO;
#if SPARK_TEST_DRIVER
  if (_simulated) granted = _permission && [_permission(kind) isEqual:@"authorized"];
  else
#endif
  granted = [kind isEqual:@"screenRecording"] ? CGPreflightScreenCaptureAccess()
    : [AVCaptureDevice authorizationStatusForMediaType:[kind isEqual:@"camera"] ? AVMediaTypeVideo : AVMediaTypeAudio] == AVAuthorizationStatusAuthorized;
  return granted ? nil : SparkCaptureError(@"E_PERMISSION_DENIED", [NSString stringWithFormat:@"The %@ permission is not granted; request it first", kind]);
}

- (BOOL)entitled:(NSString *)kind
{
#if SPARK_TEST_DRIVER
  if (_simulated) return [_simulation[[kind stringByAppendingString:@"Entitled"]] boolValue];
#endif
  return !SparkCaptureEntitlementMissing(kind);
}

- (NSDictionary *)availability
{
  NSString *(^state)(NSString *) = ^(NSString *kind) { return [self entitled:kind] ? @"available" : @"missing-entitlement"; };
  return @{ @"camera": state(@"camera"), @"microphone": state(@"microphone"), @"screenRecording": @(SparkCapture.screenRecordingSupported) };
}

// The entitlement, then the permission: nil when `device` (camera or microphone) may be captured.
- (NSError *)blocked:(NSString *)device
{
  if (![self entitled:device]) return MissingEntitlement(device);
  return [self unauthorized:device];
}

#pragma mark Devices

- (NSArray<NSDictionary *> *)devices:(NSString *)kind error:(NSError **)error
{
  if (![@[@"camera", @"microphone"] containsObject:kind]) {
    if (error) *error = SparkCaptureError(@"E_INVALID_ARGUMENT", @"A capture device kind is camera or microphone");
    return nil;
  }
  BOOL camera = [kind isEqual:@"camera"];
#if SPARK_TEST_DRIVER
  if (_simulated) {
    if (![_simulation[camera ? @"cameras" : @"microphones"] boolValue]) return @[];
    return @[@{ @"id": camera ? @"simulated-camera" : @"simulated-microphone", @"name": camera ? @"Simulated Camera" : @"Simulated Microphone", @"kind": kind, @"default": @YES }];
  }
#endif
  NSString *preferred = [AVCaptureDevice defaultDeviceWithMediaType:camera ? AVMediaTypeVideo : AVMediaTypeAudio].uniqueID;
  NSMutableArray *devices = [NSMutableArray array];
  for (AVCaptureDevice *device in CaptureDevices(camera))
    [devices addObject:@{ @"id": device.uniqueID, @"name": device.localizedName, @"kind": kind, @"default": @([device.uniqueID isEqual:preferred]) }];
  return devices;
}

// The device to capture from: `deviceId`, else the default one.
- (NSDictionary *)device:(NSString *)kind requested:(id)deviceId error:(NSError **)error
{
  if (deviceId && (![deviceId isKindOfClass:NSString.class] || ![deviceId length])) { *error = SparkCaptureError(@"E_INVALID_ARGUMENT", @"deviceId is a device id"); return nil; }
  NSArray<NSDictionary *> *devices = [self devices:kind error:error];
  if (!devices) return nil;
  if (!devices.count) { *error = SparkCaptureError(@"E_UNAVAILABLE", [NSString stringWithFormat:@"No %@ is connected", kind]); return nil; }
  for (NSDictionary *device in devices) if (deviceId ? [device[@"id"] isEqual:deviceId] : [device[@"default"] boolValue]) return device;
  if (!deviceId) return devices.firstObject;
  *error = SparkCaptureError(@"E_NOT_FOUND", [NSString stringWithFormat:@"No %@ has the id %@", kind, deviceId]);
  return nil;
}

#pragma mark Sessions

// A new session after the checks every kind shares, or nil with the reason.
- (SparkCaptureSession *)session:(NSString *)kind identifier:(NSString *)identifier completion:(SparkCaptureCompletion)completion error:(NSError **)error
{
  if (_sessions[identifier]) { *error = SparkCaptureError(@"E_ALREADY_EXISTS", @"A capture has this id"); return nil; }
  for (SparkCaptureSession *running in _sessions.allValues)
    if ([running.kind isEqual:kind]) { *error = SparkCaptureError(@"E_BUSY", [NSString stringWithFormat:@"Another %@ capture is running; one runs at a time", kind]); return nil; }
  SparkCaptureSession *session = [SparkCaptureSession new];
  session.identifier = identifier;
  session.kind = kind;
  session.owner = self;
  session.tokens = [NSMutableArray array];
  session.completion = completion;
  return session;
}

// Starts an AVCaptureSession off the main thread, then `then` on it unless the capture ended meanwhile.
- (void)run:(SparkCaptureSession *)capture device:(AVCaptureDevice *)device then:(dispatch_block_t)then
{
  __weak SparkCapture *weakSelf = self;
  __weak SparkCaptureSession *weakCapture = capture;
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  [capture.tokens addObject:[center addObserverForName:AVCaptureDeviceWasDisconnectedNotification object:device queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *) {
    [weakSelf fail:weakCapture error:SparkCaptureError(@"E_UNAVAILABLE", [NSString stringWithFormat:@"%@ was disconnected", device.localizedName])];
  }]];
  [capture.tokens addObject:[center addObserverForName:AVCaptureSessionWasInterruptedNotification object:capture.session queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *) {
    [weakSelf fail:weakCapture error:SparkCaptureError(@"E_UNAVAILABLE", [NSString stringWithFormat:@"%@ was interrupted, such as by another app taking it", device.localizedName])];
  }]];
  [capture.tokens addObject:[center addObserverForName:AVCaptureSessionRuntimeErrorNotification object:capture.session queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
    NSError *error = note.userInfo[AVCaptureSessionErrorKey];
    [weakSelf fail:weakCapture error:SparkCaptureError(@"E_NATIVE", [NSString stringWithFormat:@"Capture failed: %@", error.localizedDescription])];
  }]];
  _sessions[capture.identifier] = capture;
  AVCaptureSession *session = capture.session;
  dispatch_async(_queue, ^{
    [session startRunning];
    BOOL running = session.isRunning;
    dispatch_async(dispatch_get_main_queue(), ^{
      SparkCapture *strongSelf = weakSelf;
      if (!strongSelf || strongSelf->_sessions[capture.identifier] != capture) return; // Ended meanwhile; its stop is queued after this start.
      if (!running) return [strongSelf end:capture result:nil error:SparkCaptureError(@"E_NATIVE", @"The capture device did not start")];
      then();
    });
  });
}

- (void)started:(SparkCaptureSession *)capture
{
  if (_sessions[capture.identifier] != capture || capture.startedAt) return;
  capture.startedAt = [NSDate date];
  [self emit:@{ @"type": @"capture", @"id": capture.identifier, @"event": @"started" }];
  if ([capture.kind isEqual:@"camera"]) [NSNotificationCenter.defaultCenter postNotificationName:SparkCaptureCamerasDidChangeNotification object:self];
  if ([capture.kind isEqual:@"audio"] && capture.levels && !_simulated) {
    __weak SparkCapture *weakSelf = self;
    __weak SparkCaptureSession *weakCapture = capture;
    capture.timer = [NSTimer scheduledTimerWithTimeInterval:0.1 repeats:YES block:^(NSTimer *) {
      SparkCaptureSession *current = weakCapture;
      float average = -160, peak = -160;
      for (AVCaptureAudioChannel *channel in current.audioOutput.connections.firstObject.audioChannels) {
        average = MAX(average, channel.averagePowerLevel);
        peak = MAX(peak, channel.peakHoldLevel);
      }
      if (current) [weakSelf emit:@{ @"type": @"capture", @"id": current.identifier, @"event": @"level", @"average": @(average), @"peak": @(peak) }];
    }];
  }
}

// A device went away or failed: a recording stops and ends with `error`; anything else ends now.
- (void)fail:(SparkCaptureSession *)capture error:(NSError *)error
{
  if (!capture || _sessions[capture.identifier] != capture) return;
  if (capture.audioOutput.isRecording || capture.recorder) {
    capture.failure = capture.failure ?: error;
    if (capture.audioOutput.isRecording) [capture.audioOutput stopRecording]; else [capture.recorder stopScreenRecording];
    return;
  }
  [self end:capture result:nil error:error];
}

- (void)finished:(SparkCaptureSession *)capture duration:(double)duration error:(NSError *)error
{
  capture.recorder = nil; // Its callbacks are done.
  if (_sessions[capture.identifier] != capture) {
    // Ended before its output finished (cancelled while starting, or the runtime went away): the file is complete only now.
    if (capture.discard) [NSFileManager.defaultManager removeItemAtURL:capture.url error:nil];
    [_finishing removeObject:capture];
    return;
  }
  NSError *failure = capture.failure;
  if (!failure && error) {
    BOOL userStopped = [error.domain isEqual:SCStreamErrorDomain] && error.code == SCStreamErrorUserStopped;
    failure = SparkCaptureError(userStopped ? @"E_ABORTED" : @"E_NATIVE", userStopped ? @"The person stopped the screen recording" : [NSString stringWithFormat:@"Recording failed: %@", error.localizedDescription]);
  }
  if (failure || capture.cancelled) [NSFileManager.defaultManager removeItemAtURL:capture.url error:nil];
  if (failure) return [self end:capture result:nil error:failure];
  if (capture.cancelled) return [self end:capture result:Cancelled error:nil];
#if SPARK_TEST_DRIVER
  if (_simulated) _simulation[@"recordings"] = @([_simulation[@"recordings"] integerValue] + 1);
#endif
  [self end:capture result:Recorded(capture.url, duration) error:nil];
}

// Releases everything the capture holds, then completes it.
- (void)end:(SparkCaptureSession *)capture result:(id)result error:(NSError *)error
{
  if (_sessions[capture.identifier] != capture) return;
  [_sessions removeObjectForKey:capture.identifier];
  [capture.timer invalidate];
  capture.timer = nil;
  for (id token in capture.tokens) [NSNotificationCenter.defaultCenter removeObserver:token];
  [capture.tokens removeAllObjects];
  if (capture.photo) { capture.photo(nil, SparkCaptureError(@"E_CLOSED", @"The camera stopped before the photo was taken")); capture.photo = nil; }
  AVCaptureSession *session = capture.session;
  capture.session = nil;
  BOOL recorded = [result isKindOfClass:NSDictionary.class] && [result[@"status"] isEqual:@"recorded"];
  if (capture.url && !recorded) {
    // No recording comes of it: a file output still writing is stopped, and its finish callback deletes the file.
    capture.discard = YES;
    if (capture.audioOutput.isRecording || capture.recorder) {
      [_finishing addObject:capture];
      if (capture.audioOutput.isRecording) [capture.audioOutput stopRecording]; else [capture.recorder stopScreenRecording];
    } else {
      [capture.writer cancelWriting];
      [NSFileManager.defaultManager removeItemAtURL:capture.url error:nil];
    }
  }
  if (session) dispatch_async(_queue, ^{ [session stopRunning]; });
  capture.writer = nil;
  for (CALayer *layer in capture.layers) layer.contents = nil;
  if ([capture.kind isEqual:@"camera"]) [NSNotificationCenter.defaultCenter postNotificationName:SparkCaptureCamerasDidChangeNotification object:self];
  capture.completion(result, error);
}

- (void)stop:(NSString *)identifier { [self halt:identifier cancel:NO]; }
- (void)cancel:(NSString *)identifier { [self halt:identifier cancel:YES]; }
- (void)halt:(NSString *)identifier cancel:(BOOL)cancel
{
  SparkCaptureSession *capture = _sessions[identifier];
  if (!capture) return;
  BOOL camera = [capture.kind isEqual:@"camera"];
  if (camera || !capture.startedAt) return [self end:capture result:camera ? NSNull.null : Cancelled error:nil];
  capture.cancelled = capture.cancelled || cancel;
#if SPARK_TEST_DRIVER
  if (_simulated) return [self simulateStop:capture];
#endif
  if (capture.audioOutput) [capture.audioOutput stopRecording]; else [capture.recorder stopScreenRecording];
}

// Stops every running recording and runs the main run loop until their files are finished, for up to `seconds`.
- (void)finishRecordings:(NSTimeInterval)seconds
{
  NSMutableArray<SparkCaptureSession *> *recordings = [NSMutableArray array];
  for (SparkCaptureSession *capture in _sessions.allValues) if (capture.url) [recordings addObject:capture];
  for (SparkCaptureSession *capture in recordings) [self stop:capture.identifier];
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:seconds];
  BOOL (^pending)(void) = ^BOOL {
    for (SparkCaptureSession *capture in recordings) if (self->_sessions[capture.identifier] == capture) return YES;
    return self->_finishing.count > 0;
  };
  while (pending() && deadline.timeIntervalSinceNow > 0) [NSRunLoop.mainRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
}

#pragma mark Microphone

- (void)recordAudio:(NSDictionary *)options identifier:(NSString *)identifier completion:(SparkCaptureCompletion)completion
{
  SparkCaptureCompletion done = Once(completion);
  NSError *error = nil;
  if (options[@"levels"] && ![options[@"levels"] isKindOfClass:NSNumber.class]) return done(nil, SparkCaptureError(@"E_INVALID_ARGUMENT", @"levels is a boolean"));
  NSURL *url = SparkCaptureOutputURL(options[@"uri"], @"m4a", &error);
  SparkCaptureSession *capture = url ? [self session:@"audio" identifier:identifier completion:done error:&error] : nil;
  if (!capture) return done(nil, error);
  capture.url = url;
  capture.levels = [options[@"levels"] boolValue];
#if SPARK_TEST_DRIVER
  if (_simulated) {
    if ((error = [self blocked:@"microphone"]) || ![self device:@"microphone" requested:options[@"deviceId"] error:&error]) return done(nil, error);
    return [self simulateStart:capture];
  }
#endif
  if ((error = [self blocked:@"microphone"])) return done(nil, error);
  NSDictionary *chosen = [self device:@"microphone" requested:options[@"deviceId"] error:&error];
  AVCaptureDevice *device = chosen ? [AVCaptureDevice deviceWithUniqueID:chosen[@"id"]] : nil;
  AVCaptureDeviceInput *input = device ? [AVCaptureDeviceInput deviceInputWithDevice:device error:&error] : nil;
  if (!input) return done(nil, chosen ? SparkCaptureError(@"E_NATIVE", [NSString stringWithFormat:@"The microphone did not open: %@", error.localizedDescription]) : error);
  AVCaptureSession *session = [AVCaptureSession new];
  AVCaptureAudioFileOutput *output = [AVCaptureAudioFileOutput new];
  if (![session canAddInput:input] || ![session canAddOutput:output]) return done(nil, SparkCaptureError(@"E_UNAVAILABLE", @"The microphone cannot record now"));
  [session addInput:input];
  [session addOutput:output];
  capture.session = session;
  capture.audioOutput = output;
  // Recording starts once the session runs; the delegate reports it (started:).
  [self run:capture device:device then:^{ [output startRecordingToOutputFileURL:url outputFileType:AVFileTypeAppleM4A recordingDelegate:capture]; }];
}

#pragma mark Camera

- (void)startCamera:(NSDictionary *)options identifier:(NSString *)identifier completion:(SparkCaptureCompletion)completion
{
  SparkCaptureCompletion done = Once(completion);
  NSError *error = nil;
  SparkCaptureSession *capture = [self session:@"camera" identifier:identifier completion:done error:&error];
  if (!capture) return done(nil, error);
#if SPARK_TEST_DRIVER
  if (_simulated) {
    if ((error = [self blocked:@"camera"]) || ![self device:@"camera" requested:options[@"deviceId"] error:&error]) return done(nil, error);
    capture.size = CGSizeMake(1280, 720);
    capture.layers = [NSHashTable weakObjectsHashTable];
    return [self simulateStart:capture];
  }
#endif
  if ((error = [self blocked:@"camera"])) return done(nil, error);
  NSDictionary *chosen = [self device:@"camera" requested:options[@"deviceId"] error:&error];
  AVCaptureDevice *device = chosen ? [AVCaptureDevice deviceWithUniqueID:chosen[@"id"]] : nil;
  AVCaptureDeviceInput *input = device ? [AVCaptureDeviceInput deviceInputWithDevice:device error:&error] : nil;
  if (!input) return done(nil, chosen ? SparkCaptureError(@"E_NATIVE", [NSString stringWithFormat:@"The camera did not open: %@", error.localizedDescription]) : error);
  AVCaptureSession *session = [AVCaptureSession new];
  AVCapturePhotoOutput *photo = [AVCapturePhotoOutput new];
  if ([session canSetSessionPreset:AVCaptureSessionPresetHigh]) session.sessionPreset = AVCaptureSessionPresetHigh;
  if (![session canAddInput:input] || ![session canAddOutput:photo]) return done(nil, SparkCaptureError(@"E_UNAVAILABLE", @"The camera cannot capture now"));
  [session addInput:input];
  [session addOutput:photo];
  capture.session = session;
  capture.photoOutput = photo;
  [self run:capture device:device then:^{
    CMVideoDimensions dimensions = CMVideoFormatDescriptionGetDimensions(device.activeFormat.formatDescription);
    capture.size = CGSizeMake(dimensions.width, dimensions.height);
    [self started:capture];
  }];
}

- (SparkCaptureSession *)camera:(NSString *)identifier
{
  SparkCaptureSession *capture = _sessions[identifier];
  return [capture.kind isEqual:@"camera"] && capture.startedAt ? capture : nil;
}

- (NSDictionary *)cameraStatus:(NSString *)identifier
{
  SparkCaptureSession *capture = [self camera:identifier];
  return capture ? @{ @"width": @(capture.size.width), @"height": @(capture.size.height) } : nil;
}

- (CALayer *)makePreviewLayer:(NSString *)identifier
{
  SparkCaptureSession *capture = [self camera:identifier];
  if (!capture) return nil;
#if SPARK_TEST_DRIVER
  if (_simulated) {
    CALayer *layer = [CALayer layer];
    CGImageRef frame = SparkCaptureSyntheticFrame(320, 180, capture.frames);
    layer.contents = (__bridge id)frame;
    CGImageRelease(frame);
    [capture.layers addObject:layer];
    return layer;
  }
#endif
  return [AVCaptureVideoPreviewLayer layerWithSession:capture.session];
}

- (void)takePhoto:(NSString *)identifier options:(NSDictionary *)options completion:(SparkCaptureCompletion)completion
{
  SparkCaptureCompletion done = Once(completion);
  SparkCaptureSession *capture = [self camera:identifier];
  if (!capture) return done(nil, SparkCaptureError(@"E_CLOSED", @"The camera is not running"));
  if (capture.photo) return done(nil, SparkCaptureError(@"E_BUSY", @"A photo is being taken"));
  NSError *error = nil;
  NSURL *url = SparkCaptureOutputURL(options[@"uri"], @"jpg", &error);
  if (!url) return done(nil, error);
#if SPARK_TEST_DRIVER
  if (_simulated) {
    CGImageRef image = SparkCaptureSyntheticFrame(capture.size.width, capture.size.height, capture.frames);
    error = WriteImage(image, url, UTTypeJPEG);
    CGImageRelease(image);
    if (!error) _simulation[@"photos"] = @([_simulation[@"photos"] integerValue] + 1);
    return done(error ? nil : Image(url, capture.size.width, capture.size.height), error);
  }
#endif
  capture.photo = done;
  capture.photoURL = url;
  [capture.photoOutput capturePhotoWithSettings:[AVCapturePhotoSettings photoSettingsWithFormat:@{ AVVideoCodecKey: AVVideoCodecTypeJPEG }] delegate:capture];
}

#pragma mark Screen

// The shareable content, after the screen recording permission is checked: ScreenCaptureKit would prompt without it.
- (void)content:(void (^)(SCShareableContent *_Nullable content, NSError *_Nullable error))block
{
  NSError *denied = [self unauthorized:@"screenRecording"];
  if (denied) return block(nil, denied);
  [SCShareableContent getShareableContentExcludingDesktopWindows:YES onScreenWindowsOnly:YES completionHandler:^(SCShareableContent *content, NSError *error) {
    OnMain(^{ block(content, content ? nil : SparkCaptureError(@"E_NATIVE", [NSString stringWithFormat:@"The screens could not be read: %@", error.localizedDescription])); });
  }];
}

static NSDictionary *Sources(SCShareableContent *content) {
  NSMutableArray *displays = [NSMutableArray array], *windows = [NSMutableArray array];
  for (SCDisplay *display in content.displays) [displays addObject:@{ @"id": @(display.displayID), @"width": @(display.width), @"height": @(display.height) }];
  for (SCWindow *window in content.windows) {
    if (window.windowLayer != 0 || window.frame.size.width < 2 || window.frame.size.height < 2) continue; // Menus, the Dock and slivers.
    [windows addObject:@{ @"id": @(window.windowID), @"title": window.title.length ? window.title : NSNull.null, @"app": window.owningApplication.applicationName ?: NSNull.null,
      @"width": @(window.frame.size.width), @"height": @(window.frame.size.height) }];
  }
  return @{ @"displays": displays, @"windows": windows };
}

// The filter for `options` (a display or window, default the main display) and its configuration at the source's pixel size.
static SCContentFilter *Filter(SCShareableContent *content, NSDictionary *options, NSError **error) {
  if (options[@"window"]) {
    for (SCWindow *window in content.windows) if (window.windowID == [options[@"window"] unsignedIntValue]) return [[SCContentFilter alloc] initWithDesktopIndependentWindow:window];
    *error = SparkCaptureError(@"E_NOT_FOUND", [NSString stringWithFormat:@"No window has the id %@", options[@"window"]]);
    return nil;
  }
  CGDirectDisplayID wanted = options[@"display"] ? [options[@"display"] unsignedIntValue] : CGMainDisplayID();
  for (SCDisplay *display in content.displays) if (display.displayID == wanted) return [[SCContentFilter alloc] initWithDisplay:display excludingWindows:@[]];
  *error = SparkCaptureError(@"E_NOT_FOUND", [NSString stringWithFormat:@"No display has the id %u", wanted]);
  return nil;
}
static SCStreamConfiguration *Configuration(SCContentFilter *filter, NSDictionary *options) {
  SCStreamConfiguration *configuration = [SCStreamConfiguration new];
  configuration.width = (size_t)round(filter.contentRect.size.width * filter.pointPixelScale);
  configuration.height = (size_t)round(filter.contentRect.size.height * filter.pointPixelScale);
  configuration.showsCursor = options[@"showsCursor"] ? [options[@"showsCursor"] boolValue] : YES;
  return configuration;
}

- (void)screenSources:(SparkCaptureCompletion)completion
{
  SparkCaptureCompletion done = Once(completion);
#if SPARK_TEST_DRIVER
  if (_simulated) { NSError *denied = [self unauthorized:@"screenRecording"]; return done(denied ? nil : SimulatedSources, denied); }
#endif
  [self content:^(SCShareableContent *content, NSError *error) { done(content ? Sources(content) : nil, error); }];
}

- (void)screenshot:(NSDictionary *)options completion:(SparkCaptureCompletion)completion
{
  SparkCaptureCompletion done = Once(completion);
  NSError *error = InvalidSource(options);
  NSURL *url = error ? nil : SparkCaptureOutputURL(options[@"uri"], @"png", &error);
  if (!url) return done(nil, error);
#if SPARK_TEST_DRIVER
  if (_simulated) {
    NSDictionary *source = (error = [self unauthorized:@"screenRecording"]) ? nil : [self simulatedSource:options error:&error];
    if (!source) return done(nil, error);
    size_t width = [source[@"width"] unsignedLongValue], height = [source[@"height"] unsignedLongValue];
    CGImageRef image = SparkCaptureSyntheticFrame(width, height, 0);
    error = WriteImage(image, url, UTTypePNG);
    CGImageRelease(image);
    if (!error) _simulation[@"screenshots"] = @([_simulation[@"screenshots"] integerValue] + 1);
    return done(error ? nil : Image(url, width, height), error);
  }
#endif
  [self content:^(SCShareableContent *content, NSError *failure) {
    SCContentFilter *filter = content ? Filter(content, options, &failure) : nil;
    if (!filter) return done(nil, failure);
    [SCScreenshotManager captureImageWithFilter:filter configuration:Configuration(filter, options) completionHandler:^(CGImageRef image, NSError *captureError) {
      CGImageRetain(image);
      OnMain(^{
        NSError *written = image ? WriteImage(image, url, UTTypePNG) : SparkCaptureError(@"E_NATIVE", [NSString stringWithFormat:@"The screenshot failed: %@", captureError.localizedDescription]);
        NSDictionary *result = written ? nil : Image(url, CGImageGetWidth(image), CGImageGetHeight(image));
        CGImageRelease(image);
        done(result, written);
      });
    }];
  }];
}

- (void)recordScreen:(NSDictionary *)options identifier:(NSString *)identifier completion:(SparkCaptureCompletion)completion
{
  SparkCaptureCompletion done = Once(completion);
  NSError *error = InvalidSource(options);
  if (!error && !SparkCapture.screenRecordingSupported) error = SparkCaptureError(@"E_UNAVAILABLE", @"Recording the screen needs macOS 15 or later");
  NSURL *url = error ? nil : SparkCaptureOutputURL(options[@"uri"], @"mov", &error);
  SparkCaptureSession *capture = url ? [self session:@"screen" identifier:identifier completion:done error:&error] : nil;
  if (!capture) return done(nil, error);
  capture.url = url;
#if SPARK_TEST_DRIVER
  if (_simulated) {
    NSDictionary *source = (error = [self unauthorized:@"screenRecording"]) ? nil : [self simulatedSource:options error:&error];
    if (!source) return done(nil, error);
    capture.size = CGSizeMake([source[@"width"] doubleValue], [source[@"height"] doubleValue]);
    return [self simulateStart:capture];
  }
#endif
  if (@available(macOS 15.0, *)) {
    _sessions[identifier] = capture;
    [self content:^(SCShareableContent *content, NSError *failure) {
      if (self->_sessions[identifier] != capture) return; // Cancelled meanwhile.
      SCContentFilter *filter = content ? Filter(content, options, &failure) : nil;
      if (!filter) return [self end:capture result:nil error:failure];
      SparkScreenRecorder *recorder = [SparkScreenRecorder new];
      __weak SparkCapture *weakSelf = self;
      __weak SparkCaptureSession *weakCapture = capture;
      recorder.started = ^{ SparkCaptureSession *current = weakCapture; if (current) [weakSelf started:current]; };
      recorder.finished = ^(double duration, NSError *finishError) { SparkCaptureSession *current = weakCapture; if (current) [weakSelf finished:current duration:duration error:finishError]; };
      capture.recorder = recorder;
      NSError *startError = nil;
      if (![recorder start:filter configuration:Configuration(filter, options) url:url error:&startError])
        [self end:capture result:nil error:SparkCaptureError(@"E_NATIVE", [NSString stringWithFormat:@"The screen recording did not start: %@", startError.localizedDescription])];
    }];
  }
}

#if SPARK_TEST_DRIVER
#pragma mark Simulation

- (NSDictionary *)simulatedSource:(NSDictionary *)options error:(NSError **)error
{
  BOOL window = options[@"window"] != nil;
  NSNumber *wanted = options[window ? @"window" : @"display"] ?: @1;
  for (NSDictionary *source in SimulatedSources[window ? @"windows" : @"displays"]) if ([source[@"id"] isEqual:wanted]) return source;
  *error = SparkCaptureError(@"E_NOT_FOUND", [NSString stringWithFormat:@"No %@ has the id %@", window ? @"window" : @"display", wanted]);
  return nil;
}

// Runs a simulated capture: synthetic levels for audio, frames for the camera and the screen.
- (void)simulateStart:(SparkCaptureSession *)capture
{
  _sessions[capture.identifier] = capture;
  if ([capture.kind isEqual:@"screen"]) {
    NSError *error = nil;
    AVAssetWriter *writer = [AVAssetWriter assetWriterWithURL:capture.url fileType:AVFileTypeQuickTimeMovie error:&error];
    AVAssetWriterInput *input = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo outputSettings:@{ AVVideoCodecKey: AVVideoCodecTypeH264,
      AVVideoWidthKey: @(capture.size.width), AVVideoHeightKey: @(capture.size.height) }];
    input.expectsMediaDataInRealTime = YES;
    capture.adaptor = [AVAssetWriterInputPixelBufferAdaptor assetWriterInputPixelBufferAdaptorWithAssetWriterInput:input sourcePixelBufferAttributes:@{
      (id)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_32BGRA), (id)kCVPixelBufferWidthKey: @(capture.size.width), (id)kCVPixelBufferHeightKey: @(capture.size.height) }];
    if (writer && [writer canAddInput:input]) [writer addInput:input];
    if (!writer || ![writer startWriting]) return [self end:capture result:nil error:SparkCaptureError(@"E_NATIVE", [NSString stringWithFormat:@"The simulated recording could not be written: %@", (error ?: writer.error).localizedDescription])];
    [writer startSessionAtSourceTime:kCMTimeZero];
    capture.writer = writer;
  }
  __weak SparkCapture *weakSelf = self;
  __weak SparkCaptureSession *weakCapture = capture;
  BOOL audio = [capture.kind isEqual:@"audio"];
  capture.timer = [NSTimer scheduledTimerWithTimeInterval:audio ? 0.1 : 1 / SimulatedFrameRate repeats:YES block:^(NSTimer *) {
    SparkCapture *strongSelf = weakSelf;
    SparkCaptureSession *current = weakCapture;
    if (strongSelf && current.startedAt) [strongSelf simulateTick:current];
  }];
  dispatch_async(dispatch_get_main_queue(), ^{
    SparkCapture *strongSelf = weakSelf;
    SparkCaptureSession *current = weakCapture;
    if (!strongSelf || !current) return;
    [strongSelf started:current];
    if (current.writer) [strongSelf simulateTick:current]; // A movie needs a first frame.
  });
}

- (void)simulateTick:(SparkCaptureSession *)capture
{
  if ([capture.kind isEqual:@"audio"]) {
    if (!capture.levels) return;
    NSInteger count = [_simulation[@"levels"] integerValue];
    _simulation[@"levels"] = @(count + 1);
    double average = round(-30 + 12 * sin(count / 3.0));
    [self emit:@{ @"type": @"capture", @"id": capture.identifier, @"event": @"level", @"average": @(average), @"peak": @(average + 6) }];
    return;
  }
  capture.frames++;
  _simulation[@"frames"] = @([_simulation[@"frames"] integerValue] + 1);
  if (capture.layers.count) {
    CGImageRef frame = SparkCaptureSyntheticFrame(320, 180, capture.frames);
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    for (CALayer *layer in capture.layers) layer.contents = (__bridge id)frame;
    [CATransaction commit];
    CGImageRelease(frame);
  }
  if (!capture.writer || !capture.adaptor.assetWriterInput.readyForMoreMediaData || !capture.adaptor.pixelBufferPool) return;
  CVPixelBufferRef buffer = NULL;
  if (CVPixelBufferPoolCreatePixelBuffer(NULL, capture.adaptor.pixelBufferPool, &buffer) != kCVReturnSuccess) return;
  size_t width = capture.size.width, height = capture.size.height;
  CVPixelBufferLockBaseAddress(buffer, 0);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(CVPixelBufferGetBaseAddress(buffer), width, height, 8, CVPixelBufferGetBytesPerRow(buffer), space, (CGBitmapInfo)kCGImageAlphaPremultipliedFirst | kCGBitmapByteOrder32Little);
  CGImageRef image = SparkCaptureSyntheticFrame(width, height, capture.frames);
  CGContextDrawImage(context, CGRectMake(0, 0, width, height), image);
  CGImageRelease(image);
  CGContextRelease(context);
  CGColorSpaceRelease(space);
  CVPixelBufferUnlockBaseAddress(buffer, 0);
  [capture.adaptor appendPixelBuffer:buffer withPresentationTime:CMTimeMake((int64_t)capture.frames - 1, (int32_t)SimulatedFrameRate)];
  CVPixelBufferRelease(buffer);
}

// Writes what a simulated recording captured: a quiet tone for audio, the synthetic frames for the screen.
- (void)simulateStop:(SparkCaptureSession *)capture
{
  [capture.timer invalidate];
  capture.timer = nil;
  double duration = -capture.startedAt.timeIntervalSinceNow;
  if (capture.cancelled) {
    [capture.writer cancelWriting];
    capture.writer = nil;
    return [self finished:capture duration:0 error:nil];
  }
  if ([capture.kind isEqual:@"audio"]) {
    NSError *error = nil;
    AVAudioFormat *format = [[AVAudioFormat alloc] initStandardFormatWithSampleRate:44100 channels:1];
    AVAudioFramePosition frames = (AVAudioFramePosition)MAX(1, duration * 44100);
    const AVAudioFrameCount chunk = 4096; // Written a chunk at a time: a long recording allocates no more.
    AVAudioPCMBuffer *buffer = [[AVAudioPCMBuffer alloc] initWithPCMFormat:format frameCapacity:chunk];
    @autoreleasepool { // The file closes when released.
      AVAudioFile *file = [[AVAudioFile alloc] initForWriting:capture.url settings:@{ AVFormatIDKey: @(kAudioFormatMPEG4AAC), AVSampleRateKey: @44100, AVNumberOfChannelsKey: @1 }
        commonFormat:AVAudioPCMFormatFloat32 interleaved:NO error:&error];
      for (AVAudioFramePosition start = 0; file && start < frames; start += chunk) {
        AVAudioFrameCount count = (AVAudioFrameCount)MIN((AVAudioFramePosition)chunk, frames - start);
        for (AVAudioFrameCount index = 0; index < count; index++) buffer.floatChannelData[0][index] = 0.05f * sinf(2 * (float)M_PI * 440 * (float)((start + index) % 44100) / 44100);
        buffer.frameLength = count;
        if (![file writeFromBuffer:buffer error:&error]) break;
      }
      file = nil;
    }
    return [self finished:capture duration:duration error:error];
  }
  AVAssetWriter *writer = capture.writer;
  capture.writer = nil; // Finishing now; end: cancels only an unfinished writer.
  if (writer.status != AVAssetWriterStatusWriting) {
    [writer cancelWriting];
    return [self finished:capture duration:0 error:writer.error ?: SparkCaptureError(@"E_NATIVE", @"The simulated recording stopped writing")];
  }
  [capture.adaptor.assetWriterInput markAsFinished];
  [writer endSessionAtSourceTime:CMTimeMake((int64_t)capture.frames, (int32_t)SimulatedFrameRate)];
  double recorded = capture.frames / SimulatedFrameRate;
  __weak SparkCapture *weakSelf = self;
  [writer finishWritingWithCompletionHandler:^{
    OnMain(^{ [weakSelf finished:capture duration:recorded error:writer.status == AVAssetWriterStatusCompleted ? nil : writer.error]; });
  }];
}

- (BOOL)simulate:(NSDictionary *)state error:(NSError **)error
{
  NSError *failure = _simulated ? nil : SparkCaptureError(@"E_UNAVAILABLE", @"Capture simulation needs the test driver");
  for (NSString *field in state) {
    if (failure) break;
    if (![@[@"cameras", @"microphones", @"cameraEntitled", @"microphoneEntitled"] containsObject:field]) failure = SparkCaptureError(@"E_INVALID_ARGUMENT", [NSString stringWithFormat:@"Unknown capture simulation field: %@", field]);
    else if (![state[field] isKindOfClass:NSNumber.class]) failure = SparkCaptureError(@"E_INVALID_ARGUMENT", [NSString stringWithFormat:@"%@ is a boolean", field]);
  }
  if (failure) { if (error) *error = failure; return NO; }
  [_simulation addEntriesFromDictionary:state];
  for (SparkCaptureSession *capture in _sessions.allValues) {
    NSString *field = [capture.kind isEqual:@"camera"] ? @"cameras" : [capture.kind isEqual:@"audio"] ? @"microphones" : nil;
    if (field && ![_simulation[field] boolValue]) [self end:capture result:nil error:SparkCaptureError(@"E_UNAVAILABLE", [NSString stringWithFormat:@"The simulated %@ was disconnected", [capture.kind isEqual:@"camera"] ? @"camera" : @"microphone"])];
  }
  return YES;
}

- (NSDictionary *)simulation
{
  NSMutableDictionary *simulation = [_simulation mutableCopy];
  NSSet *kinds = [NSSet setWithArray:[_sessions.allValues valueForKey:@"kind"]];
  simulation[@"recordingAudio"] = @([kinds containsObject:@"audio"]);
  simulation[@"cameraRunning"] = @([kinds containsObject:@"camera"]);
  simulation[@"recordingScreen"] = @([kinds containsObject:@"screen"]);
  return simulation;
}
#endif
@end
