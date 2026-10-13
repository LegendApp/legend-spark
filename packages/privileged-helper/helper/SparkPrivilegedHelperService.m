#import "SparkPrivilegedHelperService.h"
#import <os/log.h>

BOOL SparkPrivilegedHelperAuthorized(NSData *externalForm)
{
  if (externalForm.length != sizeof(AuthorizationExternalForm)) return NO;
  AuthorizationExternalForm form;
  memcpy(&form, externalForm.bytes, sizeof form);
  AuthorizationRef authorization = NULL;
  if (AuthorizationCreateFromExternalForm(&form, &authorization) != errAuthorizationSuccess) return NO;
  AuthorizationItem item = { SparkPrivilegedHelperRight, 0, NULL, 0 };
  AuthorizationRights rights = { 1, &item };
  // Flags 0: no interaction and no extending, so this only reports whether the app's prompt already granted the right
  // to this authorization (pre-authorized there). It never authenticates anyone on the helper's side.
  OSStatus status = AuthorizationCopyRights(authorization, &rights, NULL, kAuthorizationFlagDefaults, NULL);
  AuthorizationFree(authorization, kAuthorizationFlagDefaults);
  return status == errAuthorizationSuccess;
}

NSString *SparkPrivilegedHelperClientRequirement(NSString *team, NSString *clientIdentifier, BOOL developerID)
{
  NSString *requirement = SparkPrivilegedHelperRequirement(team, clientIdentifier);
  // A Developer ID helper accepts only a Developer ID app: an Apple Development certificate of the same team (which
  // a debuggable development build carries) does not satisfy it.
  return requirement && developerID ? [requirement stringByAppendingString:@" and certificate leaf[field.1.2.840.113635.100.6.1.13]"] : requirement;
}

BOOL SparkPrivilegedHelperSelfIsDeveloperID(void)
{
  SecCodeRef code = NULL;
  SecRequirementRef requirement = NULL;
  BOOL developerID = SecCodeCopySelf(kSecCSDefaultFlags, &code) == errSecSuccess
    && SecRequirementCreateWithString(CFSTR("anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13]"), kSecCSDefaultFlags, &requirement) == errSecSuccess
    && SecCodeCheckValidity(code, kSecCSDefaultFlags, requirement) == errSecSuccess;
  if (requirement) CFRelease(requirement);
  if (code) CFRelease(code);
  return developerID;
}

NSDictionary *SparkPrivilegedHelperGuestInformation(NSData *auditToken)
{
  if (auditToken.length != sizeof(audit_token_t)) return nil;
  SecCodeRef code = NULL;
  CFDictionaryRef information = NULL;
  NSDictionary *attributes = @{ (__bridge NSString *)kSecGuestAttributeAudit: auditToken };
  if (SecCodeCopyGuestWithAttributes(NULL, (__bridge CFDictionaryRef)attributes, kSecCSDefaultFlags, &code) == errSecSuccess)
    SecCodeCopySigningInformation((SecStaticCodeRef)code, kSecCSSigningInformation | kSecCSRequirementInformation | kSecCSDynamicInformation, &information);
  if (code) CFRelease(code);
  return CFBridgingRelease(information);
}

BOOL SparkPrivilegedHelperClientHardened(NSDictionary *information)
{
  NSNumber *flags = information[(__bridge NSString *)kSecCodeInfoFlags];
  if (![flags isKindOfClass:NSNumber.class] || !(flags.unsignedIntValue & kSecCodeSignatureRuntime)) return NO;
  NSDictionary *entitlements = information[(__bridge NSString *)kSecCodeInfoEntitlementsDict];
  id debuggable = [entitlements isKindOfClass:NSDictionary.class] ? entitlements[@"com.apple.security.get-task-allow"] : nil;
  return !([debuggable isKindOfClass:NSNumber.class] && [debuggable boolValue]);
}

// The connection's audit token, which names the client process without the pid reuse race. NSXPCConnection keeps it
// as a private property; nil when it cannot be read, and the connection is then refused.
static NSData *AuditToken(NSXPCConnection *connection)
{
  @try {
    id value = [connection valueForKey:@"auditToken"];
    if (![value isKindOfClass:NSValue.class]) return nil;
    audit_token_t token;
    [value getValue:&token size:sizeof token];
    return [NSData dataWithBytes:&token length:sizeof token];
  } @catch (NSException *) { return nil; }
}

static NSData *Encoded(id value)
{
  if (!value) return nil;
  NSData *data = [NSJSONSerialization isValidJSONObject:@[value]] ? [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingFragmentsAllowed error:nil] : nil;
  return data.length <= SparkPrivilegedHelperMaxMessageBytes ? data : nil;
}

@interface SparkPrivilegedHelperExport : NSObject <SparkPrivilegedHelperProtocol>
@property (nonatomic, copy) SparkPrivilegedHelperHandler handler;
@property (nonatomic) dispatch_queue_t queue;
@end
@implementation SparkPrivilegedHelperExport
- (void)verifyWithReply:(void (^)(void))reply { reply(); }
- (void)handleMessage:(NSData *)message authorization:(NSData *)authorization reply:(void (^)(NSData *, NSString *, NSString *))reply
{
  dispatch_async(self.queue, ^{
    id value = message.length <= SparkPrivilegedHelperMaxMessageBytes ? [NSJSONSerialization JSONObjectWithData:message options:NSJSONReadingFragmentsAllowed error:nil] : nil;
    if (!value) { reply(nil, @"E_INVALID_DATA", @"The helper received a message that is not JSON"); return; }
    BOOL authorized = SparkPrivilegedHelperAuthorized(authorization);
    // Rights that no longer hold (they lapse after the right's timeout) end the request with a typed error the app can
    // prompt again on, never with a silent authorized: NO.
    if (authorization && !authorized) { reply(nil, @"authorizationExpired", @"The admin authorization expired or is not valid; ask for it again"); return; }
    __block BOOL replied = NO;
    NSObject *lock = [NSObject new];
    self.handler(value, authorized, ^(id result, NSString *code, NSString *text) {
      @synchronized (lock) { if (replied) return; replied = YES; }
      if (code) { reply(nil, code, text ?: @"The helper failed"); return; }
      NSData *data = Encoded(result ?: NSNull.null);
      if (data) reply(data, nil, nil);
      else reply(nil, @"E_INVALID_DATA", @"The helper's reply is not JSON or is larger than 1 MiB");
    });
  });
}
@end

@implementation SparkPrivilegedHelperService {
  NSXPCListener *_listener;
  SparkPrivilegedHelperExport *_export;
}
- (instancetype)initWithListener:(NSXPCListener *)listener clientRequirement:(NSString *)requirement handler:(SparkPrivilegedHelperHandler)handler
{
  if (self = [super init]) {
    _listener = listener;
    _export = [SparkPrivilegedHelperExport new];
    _export.handler = handler;
    _export.queue = dispatch_queue_create("so.legend.spark.privileged-helper", DISPATCH_QUEUE_SERIAL);
    // The system checks every message's sender against it and invalidates connections from other code.
    [listener setConnectionCodeSigningRequirement:requirement];
    listener.delegate = self;
  }
  return self;
}
- (void)resume { [_listener resume]; }
- (BOOL)listener:(NSXPCListener *)listener shouldAcceptNewConnection:(NSXPCConnection *)connection
{
  // Beyond the requirement: the client must run with the hardened runtime and must not be debuggable
  // (get-task-allow), so no other process can inject code into it or attach to it and speak for it.
  NSDictionary *information = SparkPrivilegedHelperGuestInformation(AuditToken(connection));
  if (!information || !SparkPrivilegedHelperClientHardened(information)) {
    os_log_error(OS_LOG_DEFAULT, "Spark privileged helper: refused a client without the hardened runtime or with get-task-allow (pid %d)", connection.processIdentifier);
    return NO;
  }
  connection.exportedInterface = [NSXPCInterface interfaceWithProtocol:@protocol(SparkPrivilegedHelperProtocol)];
  connection.exportedObject = _export;
  [connection resume];
  return YES;
}
@end

int SparkPrivilegedHelperMain(NSString *machServiceName, NSString *clientIdentifier, SparkPrivilegedHelperHandler handler)
{
  NSString *team = SparkPrivilegedHelperSigningTeam();
  NSString *requirement = SparkPrivilegedHelperClientRequirement(team, clientIdentifier, SparkPrivilegedHelperSelfIsDeveloperID());
  if (!requirement) {
    os_log_error(OS_LOG_DEFAULT, "Spark privileged helper %{public}@: %{public}s", machServiceName,
      team ? "the client identifier is not a bundle identifier" : "this helper is unsigned or ad-hoc signed, so it cannot check its clients; sign it with your team");
    return 1;
  }
  // Precise lifetime: the listener's delegate is weak, and dispatch_main never returns.
  __attribute__((objc_precise_lifetime)) SparkPrivilegedHelperService *service = [[SparkPrivilegedHelperService alloc] initWithListener:[[NSXPCListener alloc] initWithMachServiceName:machServiceName] clientRequirement:requirement handler:handler];
  [service resume];
  dispatch_main();
}
