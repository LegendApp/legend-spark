// Privileged helpers (packages/privileged-helper/macos/SparkPrivilegedHelpers.mm and helper/SparkPrivilegedHelperService.m).
// Never registers a daemon, shows an admin prompt, reaches launchd or runs anything as root: this binary is ad-hoc signed,
// so the real instance stops at unsigned before ServiceManagement, and the real XPC round trips go to a throwaway
// anonymous listener in this process, which checks this process's own designated requirement.
#import <AppKit/AppKit.h>
#import <ServiceManagement/ServiceManagement.h>
#import "SparkPrivilegedHelpers.h"
#import "SparkPrivilegedHelperService.h"
#include <cstdio>
#include <cstdlib>
#include <unistd.h>
#include <mach/mach.h>

#define CHECK(...) do { if (!(__VA_ARGS__)) { fprintf(stderr, "FAILED %s:%d %s\n", __FILE__, __LINE__, #__VA_ARGS__); exit(1); } } while (0)

typedef struct { int calls; id result; NSString *code; NSString *reason; } Outcome;
static SparkPrivilegedHelperCompletion Record(Outcome *outcome) {
  return ^(id result, NSError *error) {
    CHECK(NSThread.isMainThread);
    outcome->calls++;
    outcome->result = result;
    outcome->code = error ? SparkPrivilegedHelperErrorCode(error) : nil;
    outcome->reason = error.userInfo[@"reason"];
  };
}
// Runs the main run loop until the outcome arrives (at most five seconds), then a little longer to catch a second call.
static void Wait(Outcome *outcome) {
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:5];
  while (!outcome->calls && [deadline timeIntervalSinceNow] > 0) [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
  [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
}
static BOOL Failed(Outcome outcome, NSString *code, NSString *reason) {
  return outcome.calls == 1 && [outcome.code isEqual:code] && (reason ? [outcome.reason isEqual:reason] : !outcome.reason);
}
static NSString *OwnRequirement(void) {
  SecCodeRef code = NULL;
  SecRequirementRef requirement = NULL;
  CFStringRef text = NULL;
  CHECK(SecCodeCopySelf(kSecCSDefaultFlags, &code) == errSecSuccess);
  CHECK(SecCodeCopyDesignatedRequirement(code, kSecCSDefaultFlags, &requirement) == errSecSuccess);
  CHECK(SecRequirementCopyString(requirement, kSecCSDefaultFlags, &text) == errSecSuccess);
  CFRelease(requirement); CFRelease(code);
  return CFBridgingRelease(text);
}

// A helper served by an anonymous listener in this process, and an app-side instance connected to it.
@interface Rig : NSObject
@property NSXPCListener *listener;
@property SparkPrivilegedHelperService *service;
@property SparkPrivilegedHelpers *helpers;
@property int connections;
@end
@implementation Rig
+ (instancetype)client:(NSString *)clientRequirement helper:(NSString *)helperRequirement handler:(SparkPrivilegedHelperHandler)handler {
  Rig *rig = [Rig new];
  rig.listener = [NSXPCListener anonymousListener];
  rig.service = [[SparkPrivilegedHelperService alloc] initWithListener:rig.listener clientRequirement:clientRequirement handler:handler];
  [rig.service resume];
  __weak Rig *weak = rig;
  rig.helpers = [[SparkPrivilegedHelpers alloc] initWithSimulated:NO signed:YES sandboxed:NO helperRequirement:^NSString *(NSString *) { return helperRequirement; } connector:^NSXPCConnection *(NSString *name) {
    CHECK([name isEqual:@"tool"]);
    weak.connections++;
    return [[NSXPCConnection alloc] initWithListenerEndpoint:weak.listener.endpoint];
  }];
  return rig;
}
- (Outcome)send:(id)message timeoutMs:(NSUInteger)timeoutMs {
  Outcome outcome = {};
  [self.helpers send:message helper:@"tool" authorization:nil timeoutMs:timeoutMs identifier:NSUUID.UUID.UUIDString completion:Record(&outcome)];
  Wait(&outcome);
  return outcome;
}
@end

int main() { @autoreleasepool {
  // Names the API reports for each system value.
  CHECK([SparkPrivilegedHelperStatusName(0) isEqual:@"notRegistered"] && [SparkPrivilegedHelperStatusName(1) isEqual:@"enabled"]);
  CHECK([SparkPrivilegedHelperStatusName(2) isEqual:@"requiresApproval"] && [SparkPrivilegedHelperStatusName(3) isEqual:@"notFound"]);
  NSDictionary<NSNumber *, NSString *> *service = @{ @(kSMErrorInvalidSignature): @"invalidSignature", @(kSMErrorToolNotValid): @"invalidSignature",
    @(kSMErrorJobNotFound): @"notFound", @(kSMErrorJobPlistNotFound): @"notFound", @(kSMErrorInvalidPlist): @"invalidPlist",
    @(kSMErrorServiceUnavailable): @"serviceUnavailable", @(kSMErrorAuthorizationFailure): @"denied", @(kSMErrorLaunchDeniedByUser): @"requiresApproval" };
  for (NSNumber *code in service) CHECK([SparkPrivilegedHelperServiceFailure(code.integerValue) isEqual:service[code]]);
  CHECK(!SparkPrivilegedHelperServiceFailure(kSMErrorInternalFailure) && !SparkPrivilegedHelperServiceFailure(kSMErrorAlreadyRegistered) && !SparkPrivilegedHelperServiceFailure(0));
  CHECK([SparkPrivilegedHelperPromptOutcome(errAuthorizationSuccess) isEqual:@"authorized"] && [SparkPrivilegedHelperPromptOutcome(errAuthorizationCanceled) isEqual:@"cancel"]);
  CHECK([SparkPrivilegedHelperPromptOutcome(errAuthorizationDenied) isEqual:@"denied"] && [SparkPrivilegedHelperPromptOutcome(errAuthorizationInteractionNotAllowed) isEqual:@"notInteractive"]);
  CHECK(!SparkPrivilegedHelperPromptOutcome(errAuthorizationInternal));
  CHECK([SparkPrivilegedHelperConnectionFailure(NSXPCConnectionInvalid) isEqual:@"connectionInvalid"] && [SparkPrivilegedHelperConnectionFailure(NSXPCConnectionInterrupted) isEqual:@"connectionInterrupted"]);
  CHECK([SparkPrivilegedHelperConnectionFailure(NSXPCConnectionCodeSigningRequirementFailure) isEqual:@"invalidSignature"] && !SparkPrivilegedHelperConnectionFailure(4100));
  CHECK([SparkPrivilegedHelperLabel(@"com.example.app", @"tool") isEqual:@"com.example.app.tool"] && !SparkPrivilegedHelperLabel(nil, @"tool"));

  // Requirements are literals of a team and an identifier; anything that could inject requirement syntax is refused.
  CHECK([SparkPrivilegedHelperRequirement(@"ABCDE12345", nil) isEqual:@"anchor apple generic and certificate leaf[subject.OU] = \"ABCDE12345\""]);
  CHECK([SparkPrivilegedHelperRequirement(@"ABCDE12345", @"com.example.app") isEqual:@"anchor apple generic and certificate leaf[subject.OU] = \"ABCDE12345\" and identifier \"com.example.app\""]);
  for (NSString *team in @[@"", @"abcde12345", @"ABCDE1234", @"ABCDE\"1234"]) CHECK(!SparkPrivilegedHelperRequirement(team, nil));
  CHECK(!SparkPrivilegedHelperRequirement(nil, @"com.example.app") && !SparkPrivilegedHelperRequirement(@"ABCDE12345", @"a\" or anchor apple") && !SparkPrivilegedHelperRequirement(@"ABCDE12345", @""));
  CHECK(!SparkPrivilegedHelperSigningTeam()); // This test binary is ad-hoc signed.
  // A Developer ID helper requires a Developer ID client; a development-signed helper only the team and identifier.
  CHECK([SparkPrivilegedHelperClientRequirement(@"ABCDE12345", @"com.example.app", YES) isEqual:@"anchor apple generic and certificate leaf[subject.OU] = \"ABCDE12345\" and identifier \"com.example.app\" and certificate leaf[field.1.2.840.113635.100.6.1.13]"]);
  CHECK([SparkPrivilegedHelperClientRequirement(@"ABCDE12345", @"com.example.app", NO) isEqual:SparkPrivilegedHelperRequirement(@"ABCDE12345", @"com.example.app")]);
  CHECK(!SparkPrivilegedHelperClientRequirement(nil, @"com.example.app", YES) && !SparkPrivilegedHelperSelfIsDeveloperID());
  // Clients need the hardened runtime and no get-task-allow.
  NSString *flagsKey = (__bridge NSString *)kSecCodeInfoFlags, *entitlementsKey = (__bridge NSString *)kSecCodeInfoEntitlementsDict;
  CHECK(SparkPrivilegedHelperClientHardened(@{ flagsKey: @(kSecCodeSignatureRuntime) }));
  CHECK(SparkPrivilegedHelperClientHardened(@{ flagsKey: @(kSecCodeSignatureRuntime), entitlementsKey: @{ @"com.apple.security.get-task-allow": @NO } }));
  CHECK(!SparkPrivilegedHelperClientHardened(@{ flagsKey: @0 }) && !SparkPrivilegedHelperClientHardened(@{}));
  CHECK(!SparkPrivilegedHelperClientHardened(@{ flagsKey: @(kSecCodeSignatureRuntime), entitlementsKey: @{ @"com.apple.security.get-task-allow": @YES } }));
  CHECK(!SparkPrivilegedHelperGuestInformation(nil) && !SparkPrivilegedHelperGuestInformation([NSData dataWithBytes:"x" length:1]));
  // tests/privileged-helper-native.test.ts signs this binary ad hoc with the hardened runtime, so it passes as a client.
  audit_token_t token;
  mach_msg_type_number_t count = TASK_AUDIT_TOKEN_COUNT;
  CHECK(task_info(mach_task_self(), TASK_AUDIT_TOKEN, (task_info_t)&token, &count) == KERN_SUCCESS);
  CHECK(SparkPrivilegedHelperClientHardened(SparkPrivilegedHelperGuestInformation([NSData dataWithBytes:&token length:sizeof token])));
  // A helper's main() refuses to serve when it cannot check its clients.
  CHECK(SparkPrivilegedHelperMain(@"com.example.app.tool", @"com.example.app", ^(id, BOOL, SparkPrivilegedHelperReply reply) { reply(nil, nil, nil); }) == 1);

  // The helper checks authorizations itself, without UI: none, malformed or holding no admin right is not authorized.
  CHECK(!SparkPrivilegedHelperAuthorized(nil) && !SparkPrivilegedHelperAuthorized([NSMutableData dataWithLength:sizeof(AuthorizationExternalForm)]) && !SparkPrivilegedHelperAuthorized([NSData dataWithBytes:"x" length:1]));
  AuthorizationRef empty = NULL;
  CHECK(AuthorizationCreate(NULL, kAuthorizationEmptyEnvironment, kAuthorizationFlagDefaults, &empty) == errAuthorizationSuccess);
  AuthorizationExternalForm form;
  CHECK(AuthorizationMakeExternalForm(empty, &form) == errAuthorizationSuccess);
  CHECK(!SparkPrivilegedHelperAuthorized([NSData dataWithBytes:&form length:sizeof form]));
  AuthorizationFree(empty, kAuthorizationFlagDestroyRights);

  // Unsigned: availability says so and nothing reaches ServiceManagement or XPC (the connector fails the test if called).
  SparkPrivilegedHelpers *unsignedHelpers = [[SparkPrivilegedHelpers alloc] initWithSimulated:NO signed:NO sandboxed:NO helperRequirement:^NSString *(NSString *) { return nil; } connector:^NSXPCConnection *(NSString *) { CHECK(!"connected"); return nil; }];
  CHECK([unsignedHelpers.availability isEqual:@"unsigned"]);
  Outcome registered = {}, unregistered = {}, sent = {}, released = {};
  [unsignedHelpers registerHelper:@"tool" completion:Record(&registered)];
  [unsignedHelpers unregisterHelper:@"tool" completion:Record(&unregistered)];
  [unsignedHelpers send:@{ @"a": @1 } helper:@"tool" authorization:nil timeoutMs:1000 identifier:@"1" completion:Record(&sent)];
  [unsignedHelpers send:@{} helper:@"tool" authorization:@"gone" timeoutMs:1000 identifier:@"2" completion:Record(&released)];
  CHECK(Failed(registered, @"E_UNAVAILABLE", @"unsigned") && Failed(unregistered, @"E_UNAVAILABLE", @"unsigned") && Failed(sent, @"E_UNAVAILABLE", @"unsigned"));
  CHECK(Failed(released, @"E_CLOSED", nil));
  // Sandboxed: availability says so before unsigned, and registering, the admin prompt and messaging fail sandboxed,
  // simulated or not, without reaching ServiceManagement, Authorization Services or XPC.
  for (NSNumber *simulate in @[@NO, @YES]) {
    SparkPrivilegedHelpers *sandboxedHelpers = [[SparkPrivilegedHelpers alloc] initWithSimulated:simulate.boolValue signed:YES sandboxed:YES helperRequirement:^NSString *(NSString *) { return nil; } connector:^NSXPCConnection *(NSString *) { CHECK(!"connected"); return nil; }];
    CHECK([sandboxedHelpers.availability isEqual:@"sandboxed"]);
    Outcome sandboxRegistered = {}, sandboxUnregistered = {}, sandboxSent = {}, sandboxAuthorized = {};
    [sandboxedHelpers registerHelper:@"tool" completion:Record(&sandboxRegistered)];
    [sandboxedHelpers unregisterHelper:@"tool" completion:Record(&sandboxUnregistered)];
    [sandboxedHelpers send:@{ @"a": @1 } helper:@"tool" authorization:nil timeoutMs:1000 identifier:@"1" completion:Record(&sandboxSent)];
    [sandboxedHelpers authorize:@"Install" completion:Record(&sandboxAuthorized)];
    CHECK(Failed(sandboxRegistered, @"E_UNAVAILABLE", @"sandboxed") && Failed(sandboxUnregistered, @"E_UNAVAILABLE", @"sandboxed"));
    CHECK(Failed(sandboxSent, @"E_UNAVAILABLE", @"sandboxed") && Failed(sandboxAuthorized, @"E_UNAVAILABLE", @"sandboxed"));
  }
  Outcome invalid = {};
  [unsignedHelpers send:[NSDate date] helper:@"tool" authorization:nil timeoutMs:1000 identifier:@"3" completion:Record(&invalid)];
  CHECK(Failed(invalid, @"E_INVALID_ARGUMENT", nil));

  // A real XPC round trip: the listener accepts this process (its designated requirement) and the client accepts the
  // listener (the same code). Messages and replies are JSON; the helper's errors carry its Spark code.
  NSString *own = OwnRequirement();
  Rig *rig = [Rig client:own helper:own handler:^(id message, BOOL authorized, SparkPrivilegedHelperReply reply) {
    CHECK(!NSThread.isMainThread);
    NSString *command = [message isKindOfClass:NSDictionary.class] ? message[@"command"] : nil;
    if ([command isEqual:@"whoami"]) { reply(@{ @"received": message, @"authorized": @(authorized), @"uid": @(getuid()) }, nil, nil); reply(@"second", nil, nil); }
    else if ([command isEqual:@"deny"]) reply(nil, @"E_PERMISSION_DENIED", @"Administrators only");
    else if ([command isEqual:@"odd"]) reply(nil, @"E_SOMETHING", nil);
    else if ([command isEqual:@"date"]) reply([NSDate date], nil, nil);
    else if ([command isEqual:@"hang"]) {}
    else reply(message, nil, nil);
  }];
  CHECK([rig.helpers.availability isEqual:@"available"]);
  Outcome whoami = [rig send:@{ @"command": @"whoami" } timeoutMs:5000];
  CHECK(whoami.calls == 1 && !whoami.code && [whoami.result[@"value"] isEqual:(@{ @"received": @{ @"command": @"whoami" }, @"authorized": @NO, @"uid": @(getuid()) })]);
  Outcome fragment = [rig send:@"plain text" timeoutMs:5000];
  CHECK(fragment.calls == 1 && [fragment.result[@"value"] isEqual:@"plain text"]);
  CHECK(Failed([rig send:@{ @"command": @"deny" } timeoutMs:5000], @"E_PERMISSION_DENIED", @"helperFailed"));
  CHECK(Failed([rig send:@{ @"command": @"odd" } timeoutMs:5000], @"E_NATIVE", @"helperFailed"));
  CHECK(Failed([rig send:@{ @"command": @"date" } timeoutMs:5000], @"E_INVALID_DATA", @"helperFailed"));
  CHECK(Failed([rig send:@{ @"command": @"hang" } timeoutMs:100], @"E_TIMEOUT", nil));
  CHECK(rig.connections == 1); // One connection serves every message.
  // An authorization whose rights do not hold ends the request typed before the handler runs, never authorized: NO.
  NSXPCConnection *raw = [[NSXPCConnection alloc] initWithListenerEndpoint:rig.listener.endpoint];
  raw.remoteObjectInterface = [NSXPCInterface interfaceWithProtocol:@protocol(SparkPrivilegedHelperProtocol)];
  [raw resume];
  __block NSString *lapsed = nil;
  [[raw remoteObjectProxy] handleMessage:[@"{\"command\":\"whoami\"}" dataUsingEncoding:NSUTF8StringEncoding] authorization:[NSData dataWithBytes:&form length:sizeof form]
    reply:^(NSData *, NSString *code, NSString *) { lapsed = code; }];
  for (int i = 0; i < 200 && !lapsed; i++) [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
  CHECK([lapsed isEqual:@"authorizationExpired"]);
  [raw invalidate];
  Outcome aborted = {};
  [rig.helpers send:@{ @"command": @"hang" } helper:@"tool" authorization:nil timeoutMs:5000 identifier:@"abort" completion:Record(&aborted)];
  [rig.helpers cancel:@"abort"];
  [rig.helpers cancel:@"abort"];
  Wait(&aborted);
  CHECK(Failed(aborted, @"E_ABORTED", nil));

  // The helper refuses a client that is not the app (another team's requirement): the system ends the connection before
  // the handler runs (an anonymous listener's client sees it interrupted; E_CLOSED either way).
  Rig *strangerClient = [Rig client:SparkPrivilegedHelperRequirement(@"ABCDE12345", @"com.example.app") helper:own handler:^(id message, BOOL, SparkPrivilegedHelperReply reply) { CHECK(!"handled"); reply(message, nil, nil); }];
  Outcome refused = [strangerClient send:@{ @"command": @"whoami" } timeoutMs:5000];
  CHECK(refused.calls == 1 && [refused.code isEqual:@"E_CLOSED"] && ([refused.reason isEqual:@"connectionInterrupted"] || [refused.reason isEqual:@"connectionInvalid"]));
  // The app refuses a helper that is not signed by its team before sending it any message: the empty verification
  // message's reply fails the requirement, so the handler never sees the request.
  __block BOOL handled = NO;
  Rig *strangerHelper = [Rig client:own helper:SparkPrivilegedHelperRequirement(@"ABCDE12345", nil) handler:^(id message, BOOL, SparkPrivilegedHelperReply reply) { handled = YES; reply(message, nil, nil); }];
  Outcome untrusted = [strangerHelper send:@{ @"command": @"whoami" } timeoutMs:5000];
  CHECK(Failed(untrusted, @"E_UNAVAILABLE", @"invalidSignature") && !handled);

#if SPARK_TEST_DRIVER
  // The simulation: registration, approval, the admin prompt and the helper's connection, all in memory.
  SparkPrivilegedHelpers *simulated = [[SparkPrivilegedHelpers alloc] initWithSimulated:YES signed:NO sandboxed:NO helperRequirement:^NSString *(NSString *) { return nil; } connector:nil];
  CHECK([simulated.availability isEqual:@"unsigned"] && [simulated.simulation[@"signed"] isEqual:@NO]);
  Outcome status = {};
  [simulated status:@"tool" completion:Record(&status)];
  CHECK([status.result isEqual:@"notFound"]); // This binary embeds no plist.
  Outcome first = {};
  [simulated registerHelper:@"tool" completion:Record(&first)];
  CHECK(Failed(first, @"E_UNAVAILABLE", @"unsigned") && [simulated.simulation[@"registrations"] isEqual:@0]);
  NSError *error = nil;
  CHECK([simulated simulate:@{ @"signed": @YES } error:&error] && [simulated.availability isEqual:@"available"]);
  Outcome missing = {};
  [simulated registerHelper:@"tool" completion:Record(&missing)];
  CHECK(Failed(missing, @"E_NOT_FOUND", @"notFound"));
  CHECK([simulated simulate:@{ @"helpers": @{ @"tool": @"notRegistered" } } error:&error]);
  Outcome approval = {}, early = {};
  [simulated registerHelper:@"tool" completion:Record(&approval)];
  CHECK(approval.calls == 1 && [approval.result isEqual:@"requiresApproval"]);
  [simulated send:@{ @"command": @"whoami" } helper:@"tool" authorization:nil timeoutMs:1000 identifier:@"s1" completion:Record(&early)];
  CHECK(Failed(early, @"E_PERMISSION_DENIED", @"requiresApproval"));
  Outcome opened = {};
  [simulated openSettings:Record(&opened)];
  CHECK(opened.calls == 1 && !opened.code);
  CHECK([simulated simulate:@{ @"helpers": @{ @"tool": @"enabled" }, @"promptAnswer": @"authorized" } error:&error]);
  Outcome prompt = {};
  [simulated authorize:@"Kitchen Sink wants to check the helper" completion:Record(&prompt)];
  CHECK(prompt.calls == 1 && [prompt.result[@"type"] isEqual:@"authorized"] && [prompt.result[@"id"] length] && [prompt.result[@"expiresAt"] longLongValue] > (long long)(NSDate.date.timeIntervalSince1970 * 1000));
  Outcome reply = {}, plain = {};
  [simulated send:@{ @"command": @"whoami" } helper:@"tool" authorization:prompt.result[@"id"] timeoutMs:1000 identifier:@"s2" completion:Record(&reply)];
  Wait(&reply);
  CHECK(reply.calls == 1 && [reply.result[@"value"] isEqual:(@{ @"received": @{ @"command": @"whoami" }, @"authorized": @YES, @"uid": @0 })]);
  // Lapsed rights fail typed, so the app can prompt again.
  CHECK([simulated simulate:@{ @"expireAuthorizations": @YES } error:&error]);
  Outcome lapsedSend = {};
  [simulated send:@{} helper:@"tool" authorization:prompt.result[@"id"] timeoutMs:1000 identifier:@"s-lapsed" completion:Record(&lapsedSend)];
  CHECK(Failed(lapsedSend, @"E_PERMISSION_DENIED", @"authorizationExpired"));
  [simulated releaseAuthorization:prompt.result[@"id"]];
  [simulated releaseAuthorization:prompt.result[@"id"]];
  [simulated send:@{} helper:@"tool" authorization:prompt.result[@"id"] timeoutMs:1000 identifier:@"s3" completion:Record(&plain)];
  CHECK(Failed(plain, @"E_CLOSED", nil));
  NSDictionary *expected = @{ @"command": @"whoami" };
  for (NSArray *answer in @[@[@"cancel", @"", @""], @[@"denied", @"E_PERMISSION_DENIED", @"denied"], @[@"notInteractive", @"E_UNAVAILABLE", @"notInteractive"]]) {
    CHECK([simulated simulate:@{ @"promptAnswer": answer[0] } error:&error]);
    Outcome ended = {};
    [simulated authorize:@"Again" completion:Record(&ended)];
    if ([answer[0] isEqual:@"cancel"]) CHECK(ended.calls == 1 && [ended.result isEqual:@{ @"type": @"cancel" }]);
    else CHECK(Failed(ended, answer[1], answer[2]));
  }
  CHECK([simulated simulate:@{ @"promptAnswer": NSNull.null } error:&error]);
  Outcome unanswered = {};
  [simulated authorize:@"Again" completion:Record(&unanswered)];
  CHECK(Failed(unanswered, @"E_UNAVAILABLE", nil));
  for (NSArray *connection in @[@[@"invalid", @"connectionInvalid"], @[@"interrupted", @"connectionInterrupted"]]) {
    CHECK([simulated simulate:@{ @"connection": connection[0] } error:&error]);
    Outcome broken = {};
    [simulated send:expected helper:@"tool" authorization:nil timeoutMs:1000 identifier:connection[0] completion:Record(&broken)];
    Wait(&broken);
    CHECK(Failed(broken, @"E_CLOSED", connection[1]));
  }
  Outcome removed = {};
  [simulated unregisterHelper:@"tool" completion:Record(&removed)];
  CHECK(removed.calls == 1 && !removed.code);
  CHECK([simulated simulate:@{ @"approval": @"granted" } error:&error]);
  Outcome granted = {};
  [simulated registerHelper:@"tool" completion:Record(&granted)];
  CHECK([granted.result isEqual:@"enabled"]);
  NSDictionary *simulation = simulated.simulation;
  CHECK([simulation[@"registrations"] isEqual:@2] && [simulation[@"unregistrations"] isEqual:@1] && [simulation[@"settingsOpened"] isEqual:@1]);
  CHECK([simulation[@"prompts"] isEqual:@4] && [simulation[@"lastPrompt"] isEqual:@"Again"] && [simulation[@"authorizations"] isEqual:@0] && [simulation[@"messages"] isEqual:@3]);
  CHECK([simulation[@"lastMessage"] isEqual:(@{ @"helper": @"tool", @"message": expected, @"authorized": @NO })]);
  for (NSDictionary *state in @[@{ @"signed": @"yes" }, @{ @"helpers": @{ @"tool": @"on" } }, @{ @"approval": @"later" }, @{ @"promptAnswer": @"ignore" }, @{ @"connection": @"slow" }, @{ @"expireAuthorizations": @NO }, @{ @"other": @1 }]) {
    CHECK(![simulated simulate:state error:&error] && [SparkPrivilegedHelperErrorCode(error) isEqual:@"E_INVALID_ARGUMENT"]);
  }
  CHECK(![unsignedHelpers simulate:@{ @"signed": @YES } error:&error] && [SparkPrivilegedHelperErrorCode(error) isEqual:@"E_UNAVAILABLE"]);
#endif
  printf("Privileged helper native tests passed\n");
  return 0;
} }
