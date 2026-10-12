#import "SparkPermissions.h"
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <AVFoundation/AVFoundation.h>
#import <Contacts/Contacts.h>
#import <CoreLocation/CoreLocation.h>
#import <EventKit/EventKit.h>
#import <IOKit/hidsystem/IOHIDLib.h>
#import <Photos/Photos.h>
#import <Speech/Speech.h>

NSErrorDomain const SparkPermissionErrorDomain = @"so.legend.spark.permissions";
static NSError *Failure(NSString *code, NSString *message) {
  return [NSError errorWithDomain:SparkPermissionErrorDomain code:0 userInfo:@{ @"code": code, NSLocalizedDescriptionKey: message }];
}
NSString *SparkPermissionErrorCode(NSError *error) {
  NSString *code = [error.domain isEqual:SparkPermissionErrorDomain] ? error.userInfo[@"code"] : nil;
  return code ?: @"E_NATIVE";
}

NSArray<NSString *> *SparkPermissionKinds(void) {
  return @[@"camera", @"microphone", @"screenRecording", @"accessibility", @"inputMonitoring", @"automation", @"contacts", @"calendar", @"photos", @"location", @"speechRecognition"];
}
NSArray<NSString *> *SparkPermissionAuthorizations(NSString *kind) {
  static NSDictionary<NSString *, NSArray<NSString *> *> *names;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSArray *media = @[@"notDetermined", @"restricted", @"denied", @"authorized", @"unknown"];
    NSArray *binary = @[@"notGranted", @"authorized"];
    NSArray *asked = @[@"notDetermined", @"denied", @"authorized", @"unknown"];
    names = @{ @"camera": media, @"microphone": media, @"screenRecording": binary, @"accessibility": binary, @"inputMonitoring": asked,
      @"automation": @[@"notDetermined", @"denied", @"authorized"], @"contacts": media,
      @"calendar": @[@"notDetermined", @"restricted", @"denied", @"authorized", @"writeOnly", @"unknown"], @"photos": media, @"location": media, @"speechRecognition": media };
  });
  return names[kind] ?: @[];
}
NSURL *SparkPermissionSettingsURL(NSString *kind) {
  NSDictionary *anchors = @{ @"camera": @"Privacy_Camera", @"microphone": @"Privacy_Microphone", @"screenRecording": @"Privacy_ScreenCapture",
    @"accessibility": @"Privacy_Accessibility", @"inputMonitoring": @"Privacy_ListenEvent", @"automation": @"Privacy_Automation",
    @"contacts": @"Privacy_Contacts", @"calendar": @"Privacy_Calendars", @"photos": @"Privacy_Photos", @"location": @"Privacy_LocationServices", @"speechRecognition": @"Privacy_SpeechRecognition" };
  NSString *anchor = anchors[kind];
  return anchor ? [NSURL URLWithString:[@"x-apple.systempreferences:com.apple.preference.security?" stringByAppendingString:anchor]] : nil;
}
NSArray<NSString *> *SparkPermissionUsageKeys(NSString *kind) {
  NSDictionary *keys = @{ @"camera": @[@"NSCameraUsageDescription"], @"microphone": @[@"NSMicrophoneUsageDescription"],
    @"automation": @[@"NSAppleEventsUsageDescription"], @"contacts": @[@"NSContactsUsageDescription"],
    @"calendar": @[@"NSCalendarsFullAccessUsageDescription"], @"photos": @[@"NSPhotoLibraryUsageDescription"],
    @"location": @[@"NSLocationWhenInUseUsageDescription"], @"speechRecognition": @[@"NSSpeechRecognitionUsageDescription"] };
  return keys[kind] ?: @[];
}

static NSString *Named(NSInteger value, NSArray<NSString *> *names) { return value >= 0 && value < (NSInteger)names.count ? names[value] : @"unknown"; }
NSString *SparkMediaAuthorization(NSInteger status) { return Named(status, @[@"notDetermined", @"restricted", @"denied", @"authorized"]); }
NSString *SparkContactsAuthorization(NSInteger status) { return Named(status, @[@"notDetermined", @"restricted", @"denied", @"authorized"]); }
NSString *SparkCalendarAuthorization(NSInteger status) { return Named(status, @[@"notDetermined", @"restricted", @"denied", @"authorized", @"writeOnly"]); }
// PHAuthorizationStatusLimited (4) is iOS only; on a Mac it would be a value this SDK does not know.
NSString *SparkPhotosAuthorization(NSInteger status) { return Named(status, @[@"notDetermined", @"restricted", @"denied", @"authorized"]); }
// kCLAuthorizationStatusAuthorized (3) is macOS's grant; AuthorizedWhenInUse (4) is unavailable on macOS.
NSString *SparkLocationAuthorization(NSInteger status) { return Named(status, @[@"notDetermined", @"restricted", @"denied", @"authorized"]); }
NSString *SparkSpeechRecognitionAuthorization(NSInteger status) { return Named(status, @[@"notDetermined", @"denied", @"restricted", @"authorized"]); }
NSString *SparkInputMonitoringAuthorization(NSInteger access) {
  switch (access) {
    case kIOHIDAccessTypeGranted: return @"authorized";
    case kIOHIDAccessTypeDenied: return @"denied";
    case kIOHIDAccessTypeUnknown: return @"notDetermined";
    default: return @"unknown";
  }
}
NSString *SparkAutomationAuthorization(OSStatus status, NSString *target, NSError **error) {
  switch (status) {
    case noErr: return @"authorized";
    case errAEEventNotPermitted: return @"denied";
    case errAEEventWouldRequireUserConsent: return @"notDetermined";
    case procNotFound:
      if (error) *error = Failure(@"E_NOT_FOUND", [NSString stringWithFormat:@"%@ is not running; macOS reports automation permission only for a running app", target]);
      return nil;
    default:
      if (error) *error = Failure(@"E_NATIVE", [NSString stringWithFormat:@"Checking automation permission for %@ failed with OSStatus %d", target, (int)status]);
      return nil;
  }
}

// Wraps a completion so it runs once, on the main thread, however often and wherever the system calls back.
static SparkPermissionCompletion Once(SparkPermissionCompletion completion) {
  __block SparkPermissionCompletion pending = [completion copy];
  return ^(NSString *authorization, NSError *error) {
    dispatch_block_t finish = ^{
      SparkPermissionCompletion callback = pending;
      pending = nil;
      if (callback) callback(authorization, error);
    };
    if (NSThread.isMainThread) finish(); else dispatch_async(dispatch_get_main_queue(), finish);
  };
}

static OSStatus AutomationStatus(NSString *target, BOOL ask) {
  NSData *identifier = [target dataUsingEncoding:NSUTF8StringEncoding];
  AEAddressDesc address;
  OSStatus status = AECreateDesc(typeApplicationBundleID, identifier.bytes, (Size)identifier.length, &address);
  if (status != noErr) return status;
  status = AEDeterminePermissionToAutomateTarget(&address, typeWildCard, typeWildCard, ask);
  AEDisposeDesc(&address);
  return status;
}

@interface SparkPermissions () <CLLocationManagerDelegate>
@end

@implementation SparkPermissions {
  NSDictionary *_info;
  // Requests waiting for the same answer, by kind (and automation target).
  NSMutableDictionary<NSString *, NSMutableArray<SparkPermissionCompletion> *> *_pending;
  CLLocationManager *_location;
  id _activation;
#if SPARK_TEST_DRIVER
  NSMutableDictionary<NSString *, NSMutableDictionary *> *_simulation;
#endif
}

- (instancetype)initWithInfo:(NSDictionary *)info simulated:(BOOL)simulated
{
  if ((self = [super init])) {
    _info = [info copy];
    _pending = [NSMutableDictionary dictionary];
    _answerTimeout = 120;
#if SPARK_TEST_DRIVER
    _simulated = simulated;
    if (simulated) {
      _simulation = [NSMutableDictionary dictionary];
      for (NSString *kind in SparkPermissionKinds())
        _simulation[kind] = [@{ @"authorization": SparkPermissionAuthorizations(kind).firstObject, @"answer": NSNull.null, @"requests": @0, @"prompts": @0, @"settingsOpened": @0 } mutableCopy];
    }
#else
    NSAssert(!simulated, @"Simulated permissions exist only in builds with the test driver");
#endif
  }
  return self;
}

- (void)dealloc { if (_activation) [NSNotificationCenter.defaultCenter removeObserver:_activation]; }

- (void)changed { if (_changeHandler) _changeHandler(); }

- (void)setObserving:(BOOL)observing
{
  if (_observing == observing) return;
  _observing = observing;
  if (_simulated) return; // A driven app never activates; simulations report their own changes.
  if (observing) {
    __weak SparkPermissions *weakSelf = self;
    _activation = [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationDidBecomeActiveNotification object:nil queue:NSOperationQueue.mainQueue
      usingBlock:^(NSNotification *) { [weakSelf changed]; }];
  } else {
    [NSNotificationCenter.defaultCenter removeObserver:_activation];
    _activation = nil;
  }
}

- (NSError *)validate:(NSString *)kind target:(NSString *)target
{
  if (![SparkPermissionKinds() containsObject:kind]) return Failure(@"E_INVALID_ARGUMENT", [NSString stringWithFormat:@"Unknown permission: %@", kind]);
  if ([kind isEqual:@"automation"] != (target.length > 0)) return Failure(@"E_INVALID_ARGUMENT", @"Automation needs the target app's bundle identifier; other permissions take no target");
  return nil;
}

- (CLLocationManager *)locationManager
{
  if (!_location) {
    _location = [CLLocationManager new]; // Created on the main thread, whose run loop delivers its delegate calls.
    _location.delegate = self;
  }
  return _location;
}

- (void)locationManagerDidChangeAuthorization:(CLLocationManager *)manager
{
  NSString *authorization = SparkLocationAuthorization(manager.authorizationStatus);
  if (![authorization isEqual:@"notDetermined"]) [self finish:@"location" waiting:nil authorization:authorization error:nil];
  [self changed];
}

// The authorization of a kind other than automation, read without prompting.
- (NSString *)authorization:(NSString *)kind
{
#if SPARK_TEST_DRIVER
  if (_simulated) return _simulation[kind][@"authorization"];
#endif
  if ([kind isEqual:@"camera"]) return SparkMediaAuthorization([AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo]);
  if ([kind isEqual:@"microphone"]) return SparkMediaAuthorization([AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio]);
  if ([kind isEqual:@"screenRecording"]) return CGPreflightScreenCaptureAccess() ? @"authorized" : @"notGranted";
  if ([kind isEqual:@"accessibility"]) return AXIsProcessTrusted() ? @"authorized" : @"notGranted";
  if ([kind isEqual:@"inputMonitoring"]) return SparkInputMonitoringAuthorization(IOHIDCheckAccess(kIOHIDRequestTypeListenEvent));
  if ([kind isEqual:@"contacts"]) return SparkContactsAuthorization([CNContactStore authorizationStatusForEntityType:CNEntityTypeContacts]);
  if ([kind isEqual:@"calendar"]) return SparkCalendarAuthorization([EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent]);
  if ([kind isEqual:@"photos"]) return SparkPhotosAuthorization([PHPhotoLibrary authorizationStatusForAccessLevel:PHAccessLevelReadWrite]);
  if ([kind isEqual:@"speechRecognition"]) return SparkSpeechRecognitionAuthorization(SFSpeechRecognizer.authorizationStatus);
  return SparkLocationAuthorization(self.locationManager.authorizationStatus);
}

- (NSDictionary<NSString *, NSString *> *)snapshot
{
  NSMutableDictionary *snapshot = [NSMutableDictionary dictionary];
  for (NSString *kind in SparkPermissionKinds()) if (![kind isEqual:@"automation"]) snapshot[kind] = [self authorization:kind];
  return snapshot;
}

- (void)status:(NSString *)kind target:(NSString *)target completion:(SparkPermissionCompletion)completion
{
  SparkPermissionCompletion done = Once(completion);
  NSError *invalid = [self validate:kind target:target];
  if (invalid) return done(nil, invalid);
  if (![kind isEqual:@"automation"]) return done([self authorization:kind], nil);
#if SPARK_TEST_DRIVER
  if (_simulated) return done(_simulation[kind][@"authorization"], nil);
#endif
  // Apple events reach the target app, so the answer can take a while: never on the main thread.
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSError *error = nil;
    NSString *authorization = SparkAutomationAuthorization(AutomationStatus(target, NO), target, &error);
    done(authorization, error);
  });
}

// For a prompt whose answer has no callback of its own: settles once the status is decided when the app becomes
// active again, or with the current status after answerTimeout, so a dropped request never blocks later ones.
- (void)awaitAnswer:(NSString *)kind settle:(SparkPermissionCompletion)settle
{
  __weak SparkPermissions *weakSelf = self;
  __block id observer;
  SparkPermissionCompletion finish = ^(NSString *authorization, NSError *error) {
    if (observer) [NSNotificationCenter.defaultCenter removeObserver:observer];
    observer = nil;
    settle(authorization, error);
  };
  observer = [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationDidBecomeActiveNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *) {
    NSString *authorization = [weakSelf authorization:kind];
    if (authorization && ![authorization isEqual:@"notDetermined"]) finish(authorization, nil);
  }];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(_answerTimeout * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{ finish(nil, nil); });
}

// Settles the requests waiting under `key`, if `waiting` is still that entry (nil: whichever is there).
- (void)finish:(NSString *)key waiting:(NSArray *)expected authorization:(NSString *)authorization error:(NSError *)error
{
  NSArray<SparkPermissionCompletion> *waiting = _pending[key];
  if (!waiting || (expected && waiting != expected)) return;
  [_pending removeObjectForKey:key];
  for (SparkPermissionCompletion completion in waiting) completion(authorization, error);
}

- (void)request:(NSString *)kind target:(NSString *)target completion:(SparkPermissionCompletion)completion
{
  SparkPermissionCompletion done = Once(completion);
  NSError *invalid = [self validate:kind target:target];
  if (invalid) return done(nil, invalid);
  NSArray<NSString *> *keys = SparkPermissionUsageKeys(kind);
  BOOL described = keys.count == 0;
  for (NSString *key in keys) described = described || ([_info[key] isKindOfClass:NSString.class] && [_info[key] length] > 0);
  if (!described) return done(nil, Failure(@"E_UNAVAILABLE", [NSString stringWithFormat:@"Requesting %@ permission needs %@ in the app's Info.plist", kind, [keys componentsJoinedByString:@" or "]]));
  NSString *key = target ? [NSString stringWithFormat:@"%@:%@", kind, target] : kind;
  if (_pending[key]) { [_pending[key] addObject:done]; return; }
  NSMutableArray *entry = [NSMutableArray arrayWithObject:done];
  _pending[key] = entry;
  __weak SparkPermissions *weakSelf = self;
  // Every system callback lands here once; Once() puts it on the main thread, where the status is read again.
  SparkPermissionCompletion settle = Once(^(NSString *authorization, NSError *error) {
    SparkPermissions *strongSelf = weakSelf;
    if (!strongSelf) return;
    // Contacts and calendar report a refusal as an error too: only an error that left the status undetermined fails.
    if (error && ![error.domain isEqual:SparkPermissionErrorDomain])
      error = [[strongSelf authorization:kind] isEqual:@"notDetermined"] ? Failure(@"E_NATIVE", [NSString stringWithFormat:@"Requesting %@ permission failed: %@", kind, error.localizedDescription]) : nil;
    [strongSelf finish:key waiting:entry authorization:error ? nil : (authorization ?: [strongSelf authorization:kind]) error:error];
    [strongSelf changed];
  });
#if SPARK_TEST_DRIVER
  if (_simulated) return [self simulateRequest:kind key:key completion:settle];
#endif
  if ([kind isEqual:@"camera"] || [kind isEqual:@"microphone"]) {
    // Any thread; the handler runs on an arbitrary queue.
    [AVCaptureDevice requestAccessForMediaType:[kind isEqual:@"camera"] ? AVMediaTypeVideo : AVMediaTypeAudio completionHandler:^(BOOL) { settle(nil, nil); }];
  } else if ([kind isEqual:@"contacts"]) {
    CNContactStore *store = [CNContactStore new];
    [store requestAccessForEntityType:CNEntityTypeContacts completionHandler:^(BOOL, NSError *error) {
      (void)store; // Kept alive until macOS answers.
      settle(nil, error);
    }];
  } else if ([kind isEqual:@"calendar"]) {
    EKEventStore *store = [EKEventStore new];
    [store requestFullAccessToEventsWithCompletion:^(BOOL, NSError *error) {
      (void)store;
      settle(nil, error);
    }];
  } else if ([kind isEqual:@"photos"]) {
    [PHPhotoLibrary requestAuthorizationForAccessLevel:PHAccessLevelReadWrite handler:^(PHAuthorizationStatus status) { settle(SparkPhotosAuthorization(status), nil); }];
  } else if ([kind isEqual:@"speechRecognition"]) {
    [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) { settle(SparkSpeechRecognitionAuthorization(status), nil); }];
  } else if ([kind isEqual:@"location"]) {
    // +locationServicesEnabled can block, so it is read off the main thread; the manager lives on the main thread.
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      BOOL enabled = CLLocationManager.locationServicesEnabled;
      dispatch_async(dispatch_get_main_queue(), ^{
        SparkPermissions *strongSelf = weakSelf;
        if (!strongSelf) return;
        if (!enabled) return settle(nil, Failure(@"E_UNAVAILABLE", @"Location Services are turned off for this Mac"));
        CLLocationManager *manager = strongSelf.locationManager;
        if (manager.authorizationStatus != kCLAuthorizationStatusNotDetermined) return settle(nil, nil);
        // locationManagerDidChangeAuthorization: settles the request once the person answers. macOS can also drop the
        // request without a callback (a missing entitlement under the hardened runtime), so it is bounded too.
        [manager requestWhenInUseAuthorization];
        [strongSelf awaitAnswer:kind settle:settle];
      });
    });
  } else if ([kind isEqual:@"screenRecording"]) {
    CGRequestScreenCaptureAccess(); // Prompts only while undetermined; returns without waiting for the answer.
    settle(nil, nil);
  } else if ([kind isEqual:@"accessibility"]) {
    // Shows the alert that sends the person to System Settings; returns at once with the current trust.
    AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)@{ (__bridge NSString *)kAXTrustedCheckOptionPrompt: @YES });
    settle(nil, nil);
  } else if ([kind isEqual:@"inputMonitoring"]) {
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      IOHIDRequestAccess(kIOHIDRequestTypeListenEvent);
      settle(nil, nil);
    });
  } else {
    // AEDeterminePermissionToAutomateTarget blocks until the person answers: never on the main thread.
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      NSError *error = nil;
      NSString *authorization = SparkAutomationAuthorization(AutomationStatus(target, YES), target, &error);
      settle(authorization, error);
    });
  }
}

- (BOOL)openSettings:(NSString *)kind error:(NSError **)error
{
  NSURL *url = SparkPermissionSettingsURL(kind);
  if (!url) { if (error) *error = Failure(@"E_INVALID_ARGUMENT", [NSString stringWithFormat:@"Unknown permission: %@", kind]); return NO; }
#if SPARK_TEST_DRIVER
  if (_simulated) {
    NSMutableDictionary *state = _simulation[kind];
    state[@"settingsOpened"] = @([state[@"settingsOpened"] integerValue] + 1);
    return YES;
  }
#endif
  if ([NSWorkspace.sharedWorkspace openURL:url]) return YES;
  if (error) *error = Failure(@"E_NATIVE", [NSString stringWithFormat:@"System Settings did not open %@", url.absoluteString]);
  return NO;
}

#if SPARK_TEST_DRIVER
// A simulated prompt appears whenever macOS could show one: undetermined, write-only calendar access, or screen
// recording and accessibility not granted. Its answer is the one set with simulate:; without one the request fails.
- (void)simulateRequest:(NSString *)kind key:(NSString *)key completion:(SparkPermissionCompletion)settle
{
  NSMutableDictionary *state = _simulation[kind];
  state[@"requests"] = @([state[@"requests"] integerValue] + 1);
  NSString *authorization = state[@"authorization"];
  if (![@[@"notDetermined", @"writeOnly", @"notGranted"] containsObject:authorization]) {
    dispatch_async(dispatch_get_main_queue(), ^{ settle(authorization, nil); });
    return;
  }
  id answer = state[@"answer"];
  if (answer == NSNull.null) {
    dispatch_async(dispatch_get_main_queue(), ^{
      settle(nil, Failure(@"E_UNAVAILABLE", [NSString stringWithFormat:@"Test driver: no simulated answer for the %@ prompt (simulatePermission answer)", kind]));
    });
    return;
  }
  state[@"prompts"] = @([state[@"prompts"] integerValue] + 1);
  // "ignore": the prompt never answers, as when macOS drops a request without a callback.
  if ([answer isEqual:@"ignore"]) return [self awaitAnswer:kind settle:settle];
  BOOL binary = [kind isEqual:@"screenRecording"] || [kind isEqual:@"accessibility"];
  state[@"authorization"] = [answer isEqual:@"allow"] ? @"authorized" : binary ? @"notGranted" : @"denied";
  NSString *result = state[@"authorization"];
  dispatch_async(dispatch_get_main_queue(), ^{ settle(result, nil); });
}

- (BOOL)simulate:(NSString *)kind authorization:(NSString *)authorization answer:(id)answer error:(NSError **)error
{
  NSError *failure = nil;
  if (!_simulated) failure = Failure(@"E_UNAVAILABLE", @"Permission simulation needs the test driver");
  else if (![SparkPermissionKinds() containsObject:kind]) failure = Failure(@"E_INVALID_ARGUMENT", [NSString stringWithFormat:@"Unknown permission: %@", kind]);
  else if (authorization && ![SparkPermissionAuthorizations(kind) containsObject:authorization])
    failure = Failure(@"E_INVALID_ARGUMENT", [NSString stringWithFormat:@"%@ authorization is one of %@", kind, [SparkPermissionAuthorizations(kind) componentsJoinedByString:@", "]]);
  else if (answer && answer != NSNull.null && ![@[@"allow", @"deny", @"ignore"] containsObject:answer]) failure = Failure(@"E_INVALID_ARGUMENT", @"A simulated answer is allow, deny or ignore");
  if (failure) { if (error) *error = failure; return NO; }
  if (answer) _simulation[kind][@"answer"] = answer;
  if (authorization && ![authorization isEqual:_simulation[kind][@"authorization"]]) {
    _simulation[kind][@"authorization"] = authorization;
    [self changed];
  }
  return YES;
}

- (NSDictionary *)simulation:(NSString *)kind { return [_simulation[kind] copy]; }
#endif
@end
