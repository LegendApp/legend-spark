#import <Foundation/Foundation.h>
#import <CoreServices/CoreServices.h>

// Privacy (TCC) permission status, requests and System Settings links for @legendapp/spark/permissions
// (docs/permissions.md). No React: tests/permissions.native.mm drives it directly.
//
// An authorization is the native state's name: notDetermined, restricted, denied, authorized, writeOnly (calendar),
// notGranted (screen recording and accessibility, which macOS reports only as granted or not), or unknown (a value
// this SDK does not know, from a newer macOS).
//
// SPARK_TEST_DRIVER builds (docs/test-driver.md#builds) add a simulated mode for the in-app test driver: it keeps
// the state in memory and never calls a TCC API, opens System Settings or shows a prompt.
#ifndef SPARK_TEST_DRIVER
#define SPARK_TEST_DRIVER 1
#endif

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSErrorDomain const SparkPermissionErrorDomain;
// The Spark error code (E_INVALID_ARGUMENT, E_UNAVAILABLE, E_NOT_FOUND, E_NATIVE) of an error from this file.
FOUNDATION_EXPORT NSString *SparkPermissionErrorCode(NSError *error);

FOUNDATION_EXPORT NSArray<NSString *> *SparkPermissionKinds(void);
// The authorizations macOS can report for a kind, unknown included.
FOUNDATION_EXPORT NSArray<NSString *> *SparkPermissionAuthorizations(NSString *kind);
// The Privacy & Security pane for a kind, or nil for an unknown kind.
FOUNDATION_EXPORT NSURL *_Nullable SparkPermissionSettingsURL(NSString *kind);
// Info.plist keys of which a request needs one; empty when it needs none. macOS ends an app that asks for camera,
// microphone, contacts or photos without its key, and ignores the request for the others.
FOUNDATION_EXPORT NSArray<NSString *> *SparkPermissionUsageKeys(NSString *kind);

// Raw status values to names. Values outside the documented enumeration are "unknown".
FOUNDATION_EXPORT NSString *SparkMediaAuthorization(NSInteger status);          // AVAuthorizationStatus
FOUNDATION_EXPORT NSString *SparkContactsAuthorization(NSInteger status);       // CNAuthorizationStatus
FOUNDATION_EXPORT NSString *SparkCalendarAuthorization(NSInteger status);       // EKAuthorizationStatus
FOUNDATION_EXPORT NSString *SparkPhotosAuthorization(NSInteger status);         // PHAuthorizationStatus
FOUNDATION_EXPORT NSString *SparkLocationAuthorization(NSInteger status);       // CLAuthorizationStatus
FOUNDATION_EXPORT NSString *SparkInputMonitoringAuthorization(NSInteger access); // IOHIDAccessType
// AEDeterminePermissionToAutomateTarget's result: noErr, errAEEventNotPermitted, errAEEventWouldRequireUserConsent.
// procNotFound (the target app is not running) is E_NOT_FOUND; any other status is E_NATIVE.
FOUNDATION_EXPORT NSString *_Nullable SparkAutomationAuthorization(OSStatus status, NSString *target, NSError **error);

typedef void (^SparkPermissionCompletion)(NSString *_Nullable authorization, NSError *_Nullable error);

// Main thread only. Completions run once, on the main thread.
@interface SparkPermissions : NSObject
// `info` is the Info.plist dictionary that requests check for usage descriptions.
- (instancetype)initWithInfo:(NSDictionary *)info simulated:(BOOL)simulated NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
@property (nonatomic, readonly) BOOL simulated;
// Called on the main thread when a status may have changed: a request finished, location authorization changed,
// the app became active (the person may have changed System Settings) while `observing`, or a simulation changed.
@property (nonatomic, copy, nullable) dispatch_block_t changeHandler;
// Watches app activation while YES. Off by default.
@property (nonatomic) BOOL observing;
// How long a location request (or a simulated prompt answered "ignore") waits for an answer before it settles with the
// current status; it also settles when the app becomes active with the status decided. Default 120 seconds.
@property (nonatomic) NSTimeInterval answerTimeout;
// `target` is the bundle identifier for automation and nil for every other kind.
- (void)status:(NSString *)kind target:(nullable NSString *)target completion:(SparkPermissionCompletion)completion;
// Shows the system prompt when macOS can; resolves with the authorization after the person answers.
// Concurrent requests for the same kind (and target) share one prompt.
- (void)request:(NSString *)kind target:(nullable NSString *)target completion:(SparkPermissionCompletion)completion;
- (BOOL)openSettings:(NSString *)kind error:(NSError **)error;
// The authorization of every kind except automation, which is per target app.
- (NSDictionary<NSString *, NSString *> *)snapshot;
#if SPARK_TEST_DRIVER
// Simulated instances only. Sets the authorization and the answer a simulated prompt gets ("allow", "deny", or
// "ignore": the prompt never answers, as when macOS drops a request);
// NSNull clears the answer, nil leaves either unchanged.
- (BOOL)simulate:(NSString *)kind authorization:(nullable NSString *)authorization answer:(nullable id)answer error:(NSError **)error;
// { authorization, answer (NSNull when unset), requests, prompts, settingsOpened } for a kind, or nil for an unknown kind.
- (nullable NSDictionary *)simulation:(NSString *)kind;
#endif
@end

NS_ASSUME_NONNULL_END
