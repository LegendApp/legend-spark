#import <Foundation/Foundation.h>
#import "SparkPrivilegedHelperProtocol.h"

// The app side of @legendapp/spark/privileged-helper (docs/privileged-helper.md): a launchd daemon embedded in the app at
// Contents/Library/LaunchDaemons/<bundle identifier>.<name>.plist, registered through SMAppService, the system admin
// prompt (Authorization Services), and XPC to the daemon's Mach service. No React: tests/privileged-helper.native.mm
// drives it directly.
//
// Everything that reaches the helper needs this process to be signed by a team: the helper checks its client's
// signature, and the app checks the helper's (helperRequirement). Without a team (an unsigned or ad-hoc build)
// availability is "unsigned" and registering and messaging fail with reason unsigned before ServiceManagement or XPC is
// touched.
//
// Failures the API names end with an error whose userInfo has "code" (a SparkErrorCode) and "reason" (a
// PrivilegedHelperErrorReason); the JavaScript layer turns them into a PrivilegedHelperError. Other errors carry only a
// code (E_BUSY, E_TIMEOUT, E_ABORTED, E_CLOSED, E_INVALID_ARGUMENT, E_UNAVAILABLE).
//
// SPARK_TEST_DRIVER builds (docs/test-driver.md#builds) add a simulated mode for the in-app test driver: it answers from
// state kept in memory and never calls SMAppService, Authorization Services or launchd, shows no prompt and opens no
// connection.
#ifndef SPARK_TEST_DRIVER
#define SPARK_TEST_DRIVER 1
#endif

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSErrorDomain const SparkPrivilegedHelperErrorDomain;
// The Spark error code of an error from this file (E_NATIVE for any other error).
FOUNDATION_EXPORT NSString *SparkPrivilegedHelperErrorCode(NSError *error);
// SMAppServiceStatus to its name: notRegistered, enabled, requiresApproval, notFound.
FOUNDATION_EXPORT NSString *SparkPrivilegedHelperStatusName(NSInteger status);
// A ServiceManagement error code (kSMError*) to its failure reason, or nil for one the API does not name.
FOUNDATION_EXPORT NSString *_Nullable SparkPrivilegedHelperServiceFailure(NSInteger code);
// The admin prompt's Authorization Services status to its outcome: authorized, cancel, denied, notInteractive; nil otherwise.
FOUNDATION_EXPORT NSString *_Nullable SparkPrivilegedHelperPromptOutcome(OSStatus status);
// An NSXPCConnection error code to its failure reason (connectionInvalid, connectionInterrupted, invalidSignature), or nil.
FOUNDATION_EXPORT NSString *_Nullable SparkPrivilegedHelperConnectionFailure(NSInteger code);
// The helper's launchd label and Mach service name, <bundle identifier>.<name>; nil without a bundle identifier.
FOUNDATION_EXPORT NSString *_Nullable SparkPrivilegedHelperLabel(NSString *_Nullable bundleIdentifier, NSString *name);

typedef void (^SparkPrivilegedHelperCompletion)(id _Nullable result, NSError *_Nullable error);
// Makes a connection to the named helper. Tests pass one that connects to an anonymous listener in their own process.
typedef NSXPCConnection *_Nonnull (^SparkPrivilegedHelperConnector)(NSString *name);
// The code signing requirement the named helper must satisfy, or nil when none can name it.
typedef NSString *_Nullable (^SparkPrivilegedHelperRequirementProvider)(NSString *name);

// Main thread. Every completion runs exactly once, on the main thread.
@interface SparkPrivilegedHelpers : NSObject
// isSigned: this process is signed by a team. helperRequirement: each helper's code signing requirement (in the app,
// SparkPrivilegedHelperRequirement(this process's team, <bundle identifier>.<name>), the identifier spark package signs
// the helper with). connector: nil connects to the helper's Mach service as a privileged launchd job and checks
// SMAppService's status first; a connector skips that status check.
- (instancetype)initWithSimulated:(BOOL)simulated signed:(BOOL)isSigned helperRequirement:(SparkPrivilegedHelperRequirementProvider)requirement connector:(nullable SparkPrivilegedHelperConnector)connector NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
@property (nonatomic, readonly) BOOL simulated;
// "available" or "unsigned". Any thread.
- (NSString *)availability;
// The status name.
- (void)status:(NSString *)name completion:(SparkPrivilegedHelperCompletion)completion;
// Registers the daemon with launchd through SMAppService and completes with its status afterwards: enabled, or
// requiresApproval until the person allows it in System Settings > General > Login Items.
- (void)registerHelper:(NSString *)name completion:(SparkPrivilegedHelperCompletion)completion;
- (void)unregisterHelper:(NSString *)name completion:(SparkPrivilegedHelperCompletion)completion;
- (void)openSettings:(SparkPrivilegedHelperCompletion)completion;
// Shows the system admin prompt for system.privilege.admin with `prompt` as its explanation. Completes with
// { type: authorized, id, expiresAt } (keep it until -releaseAuthorization:; expiresAt: Unix ms when the right's timeout
// lapses its rights, NSNull when the right has none) or { type: cancel }; denied and notInteractive fail.
// One prompt at a time (E_BUSY).
- (void)authorize:(NSString *)prompt completion:(SparkPrivilegedHelperCompletion)completion;
// Destroys the authorization's rights. Nothing for an unknown identifier.
- (void)releaseAuthorization:(NSString *)identifier;
// Sends a JSON value to the helper, with the authorization's external form when given, and completes with
// { value: <the helper's JSON reply> }. Rights past expiresAt, or that the helper finds no longer hold, fail
// authorizationExpired. `identifier` names the request for -cancel:.
- (void)send:(id)message helper:(NSString *)name authorization:(nullable NSString *)authorization timeoutMs:(NSUInteger)timeoutMs identifier:(NSString *)identifier completion:(SparkPrivilegedHelperCompletion)completion;
// Ends a pending request with E_ABORTED; the helper may already have acted on it. Nothing when it has settled.
- (void)cancel:(NSString *)identifier;
#if SPARK_TEST_DRIVER
// Simulated instances only. Any of signed (BOOL), helpers ({ name: status }), approval (required: registering leaves a
// helper requiresApproval; granted: enabled), promptAnswer (authorized, cancel, denied, notInteractive; NSNull: prompts
// fail E_UNAVAILABLE) and connection (accept: the simulated helper replies; invalid: it refuses the connection;
// interrupted: it exits mid-request); expireAuthorizations: YES lapses every held authorization.
- (BOOL)simulate:(NSDictionary *)state error:(NSError **)error;
// { signed, helpers, approval, promptAnswer, connection, registrations, unregistrations, settingsOpened, prompts,
// lastPrompt, authorizations (held), messages, lastMessage: { helper, message, authorized } (NSNull before the first) }.
- (NSDictionary *)simulation;
#endif
@end

NS_ASSUME_NONNULL_END
