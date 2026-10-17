#import <AppKit/AppKit.h>
#import <AuthenticationServices/AuthenticationServices.h>

// Sign in with Apple and passkeys (AuthenticationServices' ASAuthorizationController) for
// @legendapp/spark/apple-authentication and @legendapp/spark/passkeys (docs/authentication.md). No React:
// tests/authentication.native.mm drives it directly.
//
// Both need restricted entitlements that only a team-signed build with a provisioning profile can carry:
// com.apple.developer.applesignin, and webcredentials:<domain> in com.apple.developer.associated-domains. Without them a
// request fails before any controller is created (missingEntitlement), never with AuthenticationServices' unknown error.
//
// A request ends { type: success, credential }, { type: cancel } (the person cancelled) or { type: failure, reason,
// message } for a named ASAuthorizationError or the app's abort; the JavaScript layer turns a failure into an
// AuthorizationError. An error this file does not name is an E_NATIVE error, never folded into a known reason.
//
// SPARK_TEST_DRIVER builds (docs/test-driver.md#builds) add a simulated mode for the in-app test driver: it answers from
// state kept in memory and never creates an ASAuthorizationController, presents UI or reaches Apple or a relying party.
#ifndef SPARK_TEST_DRIVER
#define SPARK_TEST_DRIVER 1
#endif

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSErrorDomain const SparkAuthorizationErrorDomain;
// The Spark error code (E_INVALID_ARGUMENT, E_BUSY, E_NOT_FOUND, E_INVALID_DATA, E_UNAVAILABLE, E_NATIVE) of an error from this file.
FOUNDATION_EXPORT NSString *SparkAuthorizationErrorCode(NSError *error);

// An ASAuthorizationError code to its failure reason (canceled, unknown, invalidResponse, notHandled, failed,
// notInteractive, matchedExcludedCredential, deviceNotConfigured), or nil for a code this SDK does not name.
FOUNDATION_EXPORT NSString *_Nullable SparkAuthorizationFailure(NSInteger code);
// The entitlements that decide availability, as { applesignin: id, associatedDomains: id } of this process's values
// (SecTaskCopyValueForEntitlement); a missing entitlement is absent.
FOUNDATION_EXPORT NSDictionary *SparkAuthorizationProcessEntitlements(void);
// Whether `entitlements` (as above) allow a feature: appleId needs a nonempty applesignin array; passkeys need
// webcredentials:<relyingPartyId> (optionally with a ?mode= suffix) in associatedDomains. A wildcard entry
// (webcredentials:*.example.com) matches subdomains of example.com only; example.com itself needs its own entry.
FOUNDATION_EXPORT BOOL SparkAuthorizationEntitled(NSDictionary *entitlements, NSString *feature, NSString *_Nullable relyingPartyId);
// The passkey features getPasskeyAvailability(relyingPartyId, feature) names: securityKeys, prf, securityKeyPrf,
// largeBlob and signals.
FOUNDATION_EXPORT NSArray<NSString *> *const SparkPasskeyFeatures;
// Whether this macOS (and, for signals, this build) has a passkey feature: security keys and largeBlob from macOS 14
// (the minimum), prf from macOS 15, prf with security keys from macOS 26.4, signals (ASCredentialUpdater) from macOS 26.
FOUNDATION_EXPORT BOOL SparkPasskeyFeatureSupported(NSString *feature);
// Unpadded base64url to bytes; nil for anything else (padding, other alphabets, empty).
FOUNDATION_EXPORT NSData *_Nullable SparkBase64URLDecode(id value);
FOUNDATION_EXPORT NSString *SparkBase64URLEncode(NSData *data);

typedef void (^SparkAuthorizationCompletion)(id _Nullable result, NSError *_Nullable error);

// An AuthenticationServices error as a request's result: { type: cancel } when the person cancelled, a failure with the
// named reason (appCancel when `aborted`: the app cancelled), or nil with E_NATIVE in *failure for an unnamed error.
FOUNDATION_EXPORT id _Nullable SparkAuthorizationCompleted(NSError *error, BOOL aborted, NSError *_Nullable *_Nonnull failure);
// A credential AuthenticationServices returned, as a request's credential (binary values as base64url); nil for a
// credential class no Spark request asks for. Passkey credentials carry authenticatorAttachment, transports (security
// key registrations from macOS 14.5, else null) and extensions (the prf and largeBlob outputs returned).
FOUNDATION_EXPORT NSDictionary *_Nullable SparkAuthorizationCredential(id<ASAuthorizationCredential> credential);

// The AuthenticationServices requests of a validated operation (see -perform:), which one controller shows in one sheet:
// this Mac's passkey first, then a security key, then Sign in with Apple. Creating them shows nothing.
FOUNDATION_EXPORT NSArray<ASAuthorizationRequest *> *SparkAuthorizationRequests(NSString *operation, NSDictionary *options);

// One pending request: the controller's delegate and presentation context provider (both weak references in the
// controller), held by SparkAuthorization until it settles. `settle` runs at most once, however often the controller
// calls the delegate.
@interface SparkAuthorizationRequest : NSObject <ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding>
@property (nonatomic, strong, nullable) ASAuthorizationController *controller;
@property (nonatomic, strong) NSWindow *window;
@property (nonatomic, copy) SparkAuthorizationCompletion settle;
@property (nonatomic) BOOL aborted;
@end

// Main thread, except -availability:relyingPartyId:, which any thread may call. Every completion runs exactly once, on
// the main thread. One request at a time: another while one is pending fails E_BUSY. Each request owns its controller
// and delegate until it settles; then both are released.
@interface SparkAuthorization : NSObject
- (instancetype)initWithSimulated:(BOOL)simulated NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
@property (nonatomic, readonly) BOOL simulated;
// "available", "missing-entitlement", or "host-restriction" for a passkey feature this macOS lacks (checked first).
// feature: appleId, or passkeys with the relying party's domain and optionally one of SparkPasskeyFeatures.
- (NSString *)availability:(NSString *)feature relyingPartyId:(nullable NSString *)relyingPartyId passkeyFeature:(nullable NSString *)passkeyFeature;
// operation appleId: scopes (fullName, email), state, nonce. createPasskey: relyingPartyId, challenge, userId (base64url),
// userName, displayName, userVerification, attestation, excludeCredentials, authenticatorAttachment (platform, the
// default; cross-platform: a security key; any: both in one sheet), extensions (prf, largeBlob). getPasskey:
// relyingPartyId, challenge, allowCredentials (IDs, or { id, transports } for security keys), userVerification,
// authenticatorAttachment, extensions, preferImmediatelyAvailableCredentials (performRequestsWithOptions:).
// getCredential: passkey (getPasskey's options) and/or appleId (appleId's), preferImmediatelyAvailableCredentials: one
// controller, one sheet. An option this macOS lacks fails E_UNSUPPORTED_OPTION. The sheet is presented over `window`.
// `identifier` names it for -cancel:.
- (void)perform:(NSString *)operation options:(NSDictionary *)options window:(NSWindow *)window identifier:(NSString *)identifier completion:(SparkAuthorizationCompletion)completion;
// A WebAuthn signal to the person's credential manager (ASCredentialUpdater): unknownCredential (relyingPartyId,
// credentialId), allAcceptedCredentials (relyingPartyId, userId, allAcceptedCredentialIds) or currentUserDetails
// (relyingPartyId, userId, name). Completes with NSNull; E_UNAVAILABLE before macOS 26; missingEntitlement first.
- (void)signal:(NSString *)kind options:(NSDictionary *)options completion:(SparkAuthorizationCompletion)completion;
// Cancels the pending request's controller, which ends it with appCancel. Nothing when it has settled. Closing the
// window a request is presented over cancels it the same way.
- (void)cancel:(NSString *)identifier;
// authorized, revoked, notFound or transferred, or a failure. Apple's servers answer it; never in a simulated instance.
- (void)credentialState:(NSString *)user completion:(SparkAuthorizationCompletion)completion;
#if SPARK_TEST_DRIVER
// Simulated instances only. Any of appleId (BOOL: the applesignin entitlement), webCredentials (domains), answer
// (success, cancel, a failure reason, ignore: the request stays until cancelled; NSNull clears it), credentialState
// (authorized, revoked, notFound, transferred; NSNull: signed-in users authorized, others notFound), choice (platform,
// securityKey or appleId: what the person picks in a sheet offering several; NSNull: the first offered) and
// unavailableFeatures (passkey features the simulated macOS lacks; starts as this macOS's).
- (BOOL)simulate:(NSDictionary *)state error:(NSError **)error;
// { appleId, webCredentials, answer, credentialState, choice, unavailableFeatures, requests (shown), pending,
// lastRequest (NSNull before the first; with offered, extensions, preferImmediatelyAvailableCredentials),
// passkeys: [{ relyingPartyId, credentialId, userName, authenticatorAttachment }], signals: [{ kind, relyingPartyId }] }.
- (NSDictionary *)simulation;
#endif
@end

NS_ASSUME_NONNULL_END
