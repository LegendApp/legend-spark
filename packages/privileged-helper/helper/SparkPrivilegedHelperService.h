#import <Foundation/Foundation.h>
#import "SparkPrivilegedHelperProtocol.h"

// The helper side of @legendapp/spark/privileged-helper (docs/privileged-helper.md#writing-the-helper). Compile this file
// and SparkPrivilegedHelperProtocol.h into the helper executable (Foundation and Security); the app never links them.
//
// The service accepts a connection only from code that satisfies the client requirement (NSXPCListener's
// setConnectionCodeSigningRequirement:, checked by the system for every message) and that runs with the hardened runtime
// without get-task-allow (checked through the connection's audit token when it connects), decodes each message as JSON, checks the
// admin authorization the app sent itself (the app's word is never taken for it) and passes both to the handler on one
// serial queue. Every reply is sent exactly once.

NS_ASSUME_NONNULL_BEGIN

// result: a JSON value (NSDictionary, NSArray, NSString, NSNumber, NSNull). errorCode: a SparkErrorCode such as
// E_PERMISSION_DENIED or E_INVALID_ARGUMENT (another value becomes E_NATIVE); the app rejects a PrivilegedHelperError with
// reason helperFailed. Call it exactly once, from any thread.
typedef void (^SparkPrivilegedHelperReply)(id _Nullable result, NSString *_Nullable errorCode, NSString *_Nullable errorMessage);
// message: the JSON value the app sent. authorized: the app sent an admin authorization and this process verified that it
// holds system.privilege.admin. A handler that does privileged work for anyone but an administrator must require it.
typedef void (^SparkPrivilegedHelperHandler)(id message, BOOL authorized, SparkPrivilegedHelperReply reply);

// Whether `externalForm` (an AuthorizationExternalForm) holds system.privilege.admin. Never shows UI and never extends
// rights: the app's admin prompt must already have granted it. NO for nil, malformed, released or lapsed authorizations.
FOUNDATION_EXPORT BOOL SparkPrivilegedHelperAuthorized(NSData *_Nullable externalForm);
// The client requirement: signed by `team` with the signing identifier `clientIdentifier`, and with a Developer ID
// leaf certificate when `developerID` (the helper itself is Developer ID signed). nil when team or identifier is invalid.
FOUNDATION_EXPORT NSString *_Nullable SparkPrivilegedHelperClientRequirement(NSString *_Nullable team, NSString *clientIdentifier, BOOL developerID);
// Whether this process is signed with a Developer ID Application certificate.
FOUNDATION_EXPORT BOOL SparkPrivilegedHelperSelfIsDeveloperID(void);
// The signing information (kSecCSSigningInformation, requirement and dynamic information) of the process an audit
// token names, or nil.
FOUNDATION_EXPORT NSDictionary *_Nullable SparkPrivilegedHelperGuestInformation(NSData *_Nullable auditToken);
// Whether signing information shows the hardened runtime (kSecCodeSignatureRuntime) and no get-task-allow entitlement.
FOUNDATION_EXPORT BOOL SparkPrivilegedHelperClientHardened(NSDictionary *information);

@interface SparkPrivilegedHelperService : NSObject <NSXPCListenerDelegate>
// Sets the listener's client requirement and delegate; nothing is accepted until -resume.
- (instancetype)initWithListener:(NSXPCListener *)listener clientRequirement:(NSString *)requirement handler:(SparkPrivilegedHelperHandler)handler NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
- (void)resume;
@end

// A helper's main(): serves machServiceName (the launchd label the app's plist declares, <bundle identifier>.<helper name>)
// for clients signed by this helper's own team with the signing identifier clientIdentifier (the app's bundle
// identifier), with a Developer ID certificate when this helper has one. Never returns once listening. Returns 1, after logging why, when this helper is unsigned or ad-hoc signed
// or clientIdentifier is not a bundle identifier: it never serves without checking its clients.
FOUNDATION_EXPORT int SparkPrivilegedHelperMain(NSString *machServiceName, NSString *clientIdentifier, SparkPrivilegedHelperHandler handler);

NS_ASSUME_NONNULL_END
