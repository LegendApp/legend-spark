#import <Foundation/Foundation.h>
#import <Security/Security.h>

// Touch ID and password authentication (LocalAuthentication) and Keychain secrets gated by biometry for
// @legendapp/spark/biometrics (docs/biometrics.md). No React: tests/biometrics.native.mm drives it directly.
//
// A failure reason names why an evaluation did not succeed. The person's outcomes (userCancel, systemCancel,
// userFallback, authenticationFailed) and the environment's (notAvailable, notEnrolled, lockout, passcodeNotSet,
// disconnected, notPaired, notInteractive, appCancel, invalidContext, missingEntitlement) are all reported as
// { success: NO, reason, message }; the JavaScript layer turns the environment's into a BiometricError. An LAError code
// or Keychain status this file does not name is an E_NATIVE error, never folded into a known reason.
//
// SPARK_TEST_DRIVER builds (docs/test-driver.md#builds) add a simulated mode for the in-app test driver: it keeps the
// state and secrets in memory and never creates an LAContext, shows a prompt or touches a keychain.
#ifndef SPARK_TEST_DRIVER
#define SPARK_TEST_DRIVER 1
#endif

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSErrorDomain const SparkBiometricErrorDomain;
// The Spark error code (E_INVALID_ARGUMENT, E_BUSY, E_INVALID_DATA, E_UNAVAILABLE, E_NATIVE) of an error from this file.
FOUNDATION_EXPORT NSString *SparkBiometricErrorCode(NSError *error);

// LABiometryType to touchId or none; any other type (Face ID, Optic ID: no Mac has them) is unknown.
FOUNDATION_EXPORT NSString *SparkBiometryTypeName(NSInteger type);
// An LAError code to its failure reason, or nil for a code this SDK does not name.
FOUNDATION_EXPORT NSString *_Nullable SparkBiometricFailure(NSInteger code);
// A Keychain status from a protected item to its failure reason (userCancel, authenticationFailed, notInteractive,
// missingEntitlement, notAvailable), or nil for any other status.
FOUNDATION_EXPORT NSString *_Nullable SparkBiometricKeychainFailure(OSStatus status);
// Access control flags for a secret's access (biometryCurrentSet, biometryAny, biometryOrPassword); 0 for another value.
FOUNDATION_EXPORT SecAccessControlCreateFlags SparkBiometricAccessFlags(NSString *access);
// The query naming a secret: a generic password in the data protection keychain, under `service`.
FOUNDATION_EXPORT NSDictionary *SparkBiometricSecretQuery(NSString *service, NSString *key);

typedef void (^SparkBiometricCompletion)(id _Nullable result, NSError *_Nullable error);

// Main thread only. Every completion runs exactly once, on the main thread. One prompt at a time: an authentication or
// secret read while another is pending fails E_BUSY. Each prompt has its own LAContext, held until it settles and then
// invalidated.
@interface SparkBiometrics : NSObject
// `service` is the Keychain service of this app's secrets.
- (instancetype)initWithService:(NSString *)service simulated:(BOOL)simulated NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
@property (nonatomic, readonly) BOOL simulated;
// { biometryType, biometrics, password }: whether biometrics alone, and biometrics or the login password, could be
// evaluated now (available, or the reason not). Never prompts.
- (void)status:(SparkBiometricCompletion)completion;
// options: reason (required), fallback (password: macOS offers the login password; app: a fallback button that ends
// with userFallback; none: no fallback button), fallbackLabel (app only), cancelLabel.
// Result { success: YES } or { success: NO, reason, message }. `identifier` names it for -cancel:.
- (void)authenticate:(NSDictionary *)options identifier:(NSString *)identifier completion:(SparkBiometricCompletion)completion;
// Invalidates the pending prompt's LAContext, which ends it with appCancel. Nothing when it has settled.
- (void)cancel:(NSString *)identifier;
// Stores `value` behind `access`, replacing any secret under `key`. Never prompts. NSNull, or a failure when the
// access's policy cannot be evaluated now or the app lacks the Keychain entitlement.
- (void)setSecret:(NSString *)key value:(NSString *)value access:(NSString *)access completion:(SparkBiometricCompletion)completion;
// options: reason (required), cancelLabel. Prompts as the secret's access requires. { success: YES, value } (NSNull
// when there is no secret, without a prompt) or a failure.
- (void)secret:(NSString *)key options:(NSDictionary *)options identifier:(NSString *)identifier completion:(SparkBiometricCompletion)completion;
// Never prompts. NSNull (also when there is no secret) or a failure.
- (void)deleteSecret:(NSString *)key completion:(SparkBiometricCompletion)completion;
#if SPARK_TEST_DRIVER
// Simulated instances only. Any of biometryType, biometrics, password, answer (success, userCancel, systemCancel,
// userFallback, authenticationFailed, ignore: the prompt stays until cancelled; NSNull clears it) and
// enrollmentChanged (YES: biometryCurrentSet secrets become unreadable, as when a fingerprint is added or removed).
- (BOOL)simulate:(NSDictionary *)state error:(NSError **)error;
// { biometryType, biometrics, password, answer, prompts, lastPrompt (NSNull before the first), secrets: { key: access }, pending }.
- (NSDictionary *)simulation;
#endif
@end

NS_ASSUME_NONNULL_END
