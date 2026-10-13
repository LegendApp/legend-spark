#import "SparkPrivilegedHelpers.h"
#import <ServiceManagement/ServiceManagement.h>

NSErrorDomain const SparkPrivilegedHelperErrorDomain = @"so.legend.spark.privileged-helper";
static NSError *Failure(NSString *code, NSString *_Nullable reason, NSString *message) {
  NSMutableDictionary *info = [@{ @"code": code, NSLocalizedDescriptionKey: message } mutableCopy];
  if (reason) info[@"reason"] = reason;
  return [NSError errorWithDomain:SparkPrivilegedHelperErrorDomain code:0 userInfo:info];
}
NSString *SparkPrivilegedHelperErrorCode(NSError *error) {
  NSString *code = [error.domain isEqual:SparkPrivilegedHelperErrorDomain] ? error.userInfo[@"code"] : nil;
  return code ?: @"E_NATIVE";
}

// The Spark error code of each failure reason (src/index.ts keeps the same table).
static NSString *ReasonCode(NSString *reason) {
  NSDictionary *codes = @{ @"unsigned": @"E_UNAVAILABLE", @"notFound": @"E_NOT_FOUND", @"notRegistered": @"E_UNAVAILABLE", @"requiresApproval": @"E_PERMISSION_DENIED",
    @"invalidSignature": @"E_UNAVAILABLE", @"invalidPlist": @"E_INVALID_DATA", @"serviceUnavailable": @"E_UNAVAILABLE", @"denied": @"E_PERMISSION_DENIED",
    @"notInteractive": @"E_UNAVAILABLE", @"authorizationExpired": @"E_PERMISSION_DENIED", @"connectionInvalid": @"E_CLOSED", @"connectionInterrupted": @"E_CLOSED", @"unknown": @"E_NATIVE" };
  return codes[reason] ?: @"E_NATIVE";
}
static NSError *Named(NSString *reason, NSString *message) { return Failure(ReasonCode(reason), reason, message); }

NSString *SparkPrivilegedHelperStatusName(NSInteger status) {
  switch (status) {
    case 0: return @"notRegistered";    // SMAppServiceStatusNotRegistered
    case 1: return @"enabled";          // SMAppServiceStatusEnabled
    case 2: return @"requiresApproval"; // SMAppServiceStatusRequiresApproval
    default: return @"notFound";        // SMAppServiceStatusNotFound, and any status a later SDK adds
  }
}
NSString *SparkPrivilegedHelperServiceFailure(NSInteger code) {
  switch (code) {
    case kSMErrorInvalidSignature: case kSMErrorToolNotValid: return @"invalidSignature";
    case kSMErrorJobNotFound: case kSMErrorJobPlistNotFound: return @"notFound";
    case kSMErrorInvalidPlist: return @"invalidPlist";
    case kSMErrorServiceUnavailable: return @"serviceUnavailable";
    case kSMErrorAuthorizationFailure: return @"denied";
    case kSMErrorLaunchDeniedByUser: return @"requiresApproval";
    default: return nil;
  }
}
NSString *SparkPrivilegedHelperPromptOutcome(OSStatus status) {
  switch (status) {
    case errAuthorizationSuccess: return @"authorized";
    case errAuthorizationCanceled: return @"cancel";
    case errAuthorizationDenied: return @"denied";
    case errAuthorizationInteractionNotAllowed: return @"notInteractive";
    default: return nil;
  }
}
NSString *SparkPrivilegedHelperConnectionFailure(NSInteger code) {
  switch (code) {
    case NSXPCConnectionInvalid: return @"connectionInvalid";        // the helper refused the connection, or is not running
    case NSXPCConnectionInterrupted: return @"connectionInterrupted"; // the helper exited with the request in flight
    case NSXPCConnectionCodeSigningRequirementFailure: return @"invalidSignature"; // the helper is not signed by this app's team
    default: return nil;
  }
}
NSString *SparkPrivilegedHelperLabel(NSString *bundleIdentifier, NSString *name) {
  return bundleIdentifier.length ? [NSString stringWithFormat:@"%@.%@", bundleIdentifier, name] : nil;
}
#if SPARK_TEST_DRIVER
static NSString *PlistPath(NSString *label) {
  return [NSBundle.mainBundle.bundlePath stringByAppendingPathComponent:[NSString stringWithFormat:@"Contents/Library/LaunchDaemons/%@.plist", label]];
}
#endif
static NSData *_Nullable JSONData(id value) {
  if (![NSJSONSerialization isValidJSONObject:@[value]]) return nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingFragmentsAllowed error:nil];
  return data.length <= SparkPrivilegedHelperMaxMessageBytes ? data : nil;
}
static NSString *const SparkErrorCodes[] = { @"E_INVALID_ARGUMENT", @"E_INVALID_DATA", @"E_UNAVAILABLE", @"E_UNSUPPORTED_OPTION", @"E_PERMISSION_DENIED",
  @"E_NOT_FOUND", @"E_ALREADY_EXISTS", @"E_BUSY", @"E_CLOSED", @"E_ABORTED", @"E_TIMEOUT", @"E_NATIVE" };
static NSString *HelperCode(NSString *code) {
  for (NSString *known : SparkErrorCodes) if ([known isEqual:code]) return known;
  return @"E_NATIVE";
}

// One message in flight. `settle` runs at most once, on the main thread, whichever of the reply, the connection error,
// the timeout or a cancel comes first.
@interface SparkPrivilegedHelperRequest : NSObject
@property (nonatomic, copy, nullable) SparkPrivilegedHelperCompletion completion;
@property (nonatomic, readonly) BOOL settled;
@end
@implementation SparkPrivilegedHelperRequest
- (BOOL)settled { return !self.completion; }
- (void)settle:(id)result error:(NSError *)error
{
  dispatch_block_t finish = ^{
    SparkPrivilegedHelperCompletion completion = self.completion;
    self.completion = nil;
    if (completion) completion(result, error);
  };
  if (NSThread.isMainThread) finish(); else dispatch_async(dispatch_get_main_queue(), finish);
}
@end

// A connection to one helper, and the requests waiting for it to verify (main thread).
@interface SparkPrivilegedHelperLink : NSObject
@property (nonatomic) NSXPCConnection *connection;
@property (nonatomic) BOOL verified;
// Set by the connection's interruption and invalidation handlers on XPC's queue, before the main thread drops the link:
// a helper launchd relaunched behind the same connection is never used without verifying it again.
@property (atomic) BOOL stale;
@property (nonatomic, nullable) NSError *failure;
@property (nonatomic, nullable) NSMutableArray<void (^)(NSError *_Nullable)> *waiting;
@end
@implementation SparkPrivilegedHelperLink
- (void)finish:(nullable NSError *)error
{
  NSArray *waiting = self.waiting;
  self.waiting = nil;
  if (!waiting) return;
  self.verified = !error;
  self.failure = error;
  for (void (^waiter)(NSError *) in waiting) waiter(error);
}
@end

// An admin authorization the app holds: its AuthorizationRef (NULL when simulated) and when its rights lapse.
@interface SparkHeldAuthorization : NSObject
@property (nonatomic) AuthorizationRef reference;
@property (nonatomic, nullable) NSNumber *expiresAt; // Unix ms; nil when the right sets no timeout.
@end
@implementation SparkHeldAuthorization
@end

static NSNumber *Now(void) { return @((long long)(NSDate.date.timeIntervalSince1970 * 1000)); }
// When rights granted now for system.privilege.admin lapse, from the right's timeout in the authorization database
// (300 seconds on current macOS); nil when the right sets none.
static NSNumber *_Nullable ExpiresAt(void) {
  CFDictionaryRef definition = NULL;
  if (AuthorizationRightGet(SparkPrivilegedHelperRight, &definition) != errAuthorizationSuccess || !definition) return nil;
  NSNumber *timeout = ((__bridge NSDictionary *)definition)[@"timeout"];
  CFRelease(definition);
  return [timeout isKindOfClass:NSNumber.class] && timeout.doubleValue > 0 ? @(Now().longLongValue + (long long)(timeout.doubleValue * 1000)) : nil;
}

@implementation SparkPrivilegedHelpers {
  BOOL _realSigned;
  SparkPrivilegedHelperRequirementProvider _requirement;
  SparkPrivilegedHelperConnector _connector;
  NSMutableDictionary<NSString *, SparkPrivilegedHelperLink *> *_links;
  NSMutableDictionary<NSString *, SparkPrivilegedHelperRequest *> *_requests;
  NSMutableDictionary<NSString *, SparkHeldAuthorization *> *_authorizations;
  BOOL _prompting;
#if SPARK_TEST_DRIVER
  BOOL _signed;
  NSMutableDictionary<NSString *, NSString *> *_helpers;
  NSString *_approval, *_connection;
  id _promptAnswer, _lastPrompt, _lastMessage;
  NSUInteger _registrations, _unregistrations, _settingsOpened, _prompts, _messages;
#endif
}

- (instancetype)initWithSimulated:(BOOL)simulated signed:(BOOL)isSigned helperRequirement:(SparkPrivilegedHelperRequirementProvider)requirement connector:(SparkPrivilegedHelperConnector)connector
{
  if (self = [super init]) {
    _simulated = simulated;
    _realSigned = isSigned;
    _requirement = [requirement copy];
    _connector = [connector copy];
    _links = [NSMutableDictionary dictionary];
    _requests = [NSMutableDictionary dictionary];
    _authorizations = [NSMutableDictionary dictionary];
#if SPARK_TEST_DRIVER
    // The simulation starts from the build's real signature; nothing is registered and nobody has answered a prompt.
    _signed = isSigned;
    _helpers = [NSMutableDictionary dictionary];
    _approval = @"required";
    _connection = @"accept";
    _promptAnswer = NSNull.null;
    _lastPrompt = NSNull.null;
    _lastMessage = NSNull.null;
#else
    NSAssert(!simulated, @"Simulated privileged helpers exist only in builds with the test driver");
#endif
  }
  return self;
}

- (BOOL)isSigned
{
#if SPARK_TEST_DRIVER
  if (_simulated) return _signed;
#endif
  return _realSigned;
}
- (NSString *)availability { return self.isSigned ? @"available" : @"unsigned"; }
static NSError *Expired(void) { return Named(@"authorizationExpired", @"The admin authorization's rights lapsed; ask for them again"); }
static NSError *Unsigned(void) { return Named(@"unsigned", @"This app is unsigned or ad-hoc signed; a privileged helper needs a build signed by your team"); }

- (nullable SMAppService *)service:(NSString *)name
{
  NSString *label = SparkPrivilegedHelperLabel(NSBundle.mainBundle.bundleIdentifier, name);
  return label ? [SMAppService daemonServiceWithPlistName:[label stringByAppendingString:@".plist"]] : nil;
}
- (NSString *)statusOf:(NSString *)name
{
#if SPARK_TEST_DRIVER
  if (_simulated) {
    // Unset helpers report what the bundle holds: notRegistered when its plist is embedded, else notFound.
    NSString *label = SparkPrivilegedHelperLabel(NSBundle.mainBundle.bundleIdentifier, name);
    return _helpers[name] ?: (label && [NSFileManager.defaultManager fileExistsAtPath:PlistPath(label)] ? @"notRegistered" : @"notFound");
  }
#endif
  SMAppService *service = [self service:name];
  return service ? SparkPrivilegedHelperStatusName(service.status) : @"notFound";
}
- (void)status:(NSString *)name completion:(SparkPrivilegedHelperCompletion)completion { completion([self statusOf:name], nil); }

static NSError *ServiceError(NSError *error, NSString *action) {
  // SMAppService reports kSMError codes in SMAppServiceErrorDomain (named by the macOS 15 SDK; older systems use
  // kSMErrorDomainFramework's value). Codes in other domains, such as POSIX errors, are not named.
  BOOL named = [error.domain isEqual:@"SMAppServiceErrorDomain"] || [error.domain isEqual:@"kSMErrorDomainFramework"];
  NSString *reason = named ? SparkPrivilegedHelperServiceFailure(error.code) : nil;
  return Named(reason ?: @"unknown", [NSString stringWithFormat:@"Could not %@ the privileged helper: %@", action, error.localizedDescription]);
}

- (void)registerHelper:(NSString *)name completion:(SparkPrivilegedHelperCompletion)completion
{
  if (!self.isSigned) { completion(nil, Unsigned()); return; }
#if SPARK_TEST_DRIVER
  if (_simulated) {
    NSString *status = [self statusOf:name];
    if ([status isEqual:@"notFound"]) { completion(nil, Named(@"notFound", @"Simulated: the app has no launchd plist for this helper")); return; }
    _registrations++;
    if ([status isEqual:@"notRegistered"]) _helpers[name] = [_approval isEqual:@"granted"] ? @"enabled" : @"requiresApproval";
    completion(_helpers[name] ?: status, nil);
    return;
  }
#endif
  SMAppService *service = [self service:name];
  if (!service) { completion(nil, Named(@"notFound", @"The app has no bundle identifier to name its helper by")); return; }
  NSError *error = nil;
  BOOL registered = [service registerAndReturnError:&error];
  NSInteger status = service.status;
  // A new daemon waits for the person's approval, and registering one already registered changes nothing: both are states.
  if (registered || status == SMAppServiceStatusRequiresApproval || status == SMAppServiceStatusEnabled) completion(SparkPrivilegedHelperStatusName(status), nil);
  else completion(nil, ServiceError(error, @"register"));
}

- (void)unregisterHelper:(NSString *)name completion:(SparkPrivilegedHelperCompletion)completion
{
  if (!self.isSigned) { completion(nil, Unsigned()); return; }
#if SPARK_TEST_DRIVER
  if (_simulated) {
    if ([[self statusOf:name] isEqual:@"notFound"]) { completion(nil, Named(@"notFound", @"Simulated: the app has no launchd plist for this helper")); return; }
    _unregistrations++;
    _helpers[name] = @"notRegistered";
    [self dropConnection:name];
    completion(nil, nil);
    return;
  }
#endif
  SMAppService *service = [self service:name];
  if (!service) { completion(nil, Named(@"notFound", @"The app has no bundle identifier to name its helper by")); return; }
  [self dropConnection:name];
  [service unregisterWithCompletionHandler:^(NSError *error) {
    dispatch_async(dispatch_get_main_queue(), ^{
      // Unregistering what is not registered leaves the requested state: not an error.
      if (!error || service.status == SMAppServiceStatusNotRegistered) completion(nil, nil);
      else completion(nil, ServiceError(error, @"unregister"));
    });
  }];
}

- (void)openSettings:(SparkPrivilegedHelperCompletion)completion
{
#if SPARK_TEST_DRIVER
  if (_simulated) { _settingsOpened++; completion(nil, nil); return; }
#endif
  [SMAppService openSystemSettingsLoginItems];
  completion(nil, nil);
}

- (void)authorize:(NSString *)prompt completion:(SparkPrivilegedHelperCompletion)completion
{
  if (_prompting) { completion(nil, Failure(@"E_BUSY", nil, @"An admin prompt is already showing")); return; }
#if SPARK_TEST_DRIVER
  if (_simulated) {
    if (_promptAnswer == NSNull.null) { completion(nil, Failure(@"E_UNAVAILABLE", nil, @"Test driver: no simulated answer for the admin prompt (simulatePrivilegedHelper promptAnswer)")); return; }
    _prompts++;
    _lastPrompt = prompt;
    [self prompted:_promptAnswer authorization:NULL expiresAt:@(Now().longLongValue + 300000) completion:completion];
    return;
  }
#endif
  AuthorizationRef authorization = NULL;
  OSStatus created = AuthorizationCreate(NULL, kAuthorizationEmptyEnvironment, kAuthorizationFlagDefaults, &authorization);
  if (created != errAuthorizationSuccess) { completion(nil, Named(@"unknown", [NSString stringWithFormat:@"Could not create an authorization (%d)", (int)created])); return; }
  _prompting = YES;
  // Owned by the callback: Authorization Services documents no copy of the items it is given.
  NSData *text = [[prompt stringByAppendingString:@"\0"] dataUsingEncoding:NSUTF8StringEncoding];
  AuthorizationItem *items = (AuthorizationItem *)calloc(2, sizeof(AuthorizationItem));
  items[0] = (AuthorizationItem){ SparkPrivilegedHelperRight, 0, NULL, 0 };
  items[1] = (AuthorizationItem){ kAuthorizationEnvironmentPrompt, text.length - 1, (void *)text.bytes, 0 };
  AuthorizationRights *rights = (AuthorizationRights *)calloc(1, sizeof(AuthorizationRights));
  AuthorizationEnvironment *environment = (AuthorizationEnvironment *)calloc(1, sizeof(AuthorizationEnvironment));
  *rights = (AuthorizationRights){ 1, &items[0] };
  *environment = (AuthorizationEnvironment){ 1, &items[1] };
  AuthorizationFlags flags = kAuthorizationFlagInteractionAllowed | kAuthorizationFlagExtendRights | kAuthorizationFlagPreAuthorize;
  // The block keeps this instance alive until the person answers, so the completion always runs.
  AuthorizationCopyRightsAsync(authorization, rights, environment, flags, ^(OSStatus status, AuthorizationRights *granted) {
    if (granted) AuthorizationFreeItemSet(granted);
    (void)text;
    free(items); free(rights); free(environment);
    dispatch_async(dispatch_get_main_queue(), ^{
      self->_prompting = NO;
      NSString *outcome = SparkPrivilegedHelperPromptOutcome(status);
      if (![outcome isEqual:@"authorized"]) AuthorizationFree(authorization, kAuthorizationFlagDestroyRights);
      if (outcome) [self prompted:outcome authorization:authorization expiresAt:ExpiresAt() completion:completion];
      else completion(nil, Named(@"unknown", [NSString stringWithFormat:@"The admin prompt failed (%d)", (int)status]));
    });
  });
}
// The prompt's outcome as its result; an authorization is held until released.
- (void)prompted:(NSString *)outcome authorization:(AuthorizationRef)authorization expiresAt:(nullable NSNumber *)expiresAt completion:(SparkPrivilegedHelperCompletion)completion
{
  if ([outcome isEqual:@"authorized"]) {
    NSString *identifier = NSUUID.UUID.UUIDString;
    SparkHeldAuthorization *held = [SparkHeldAuthorization new];
    held.reference = authorization;
    held.expiresAt = expiresAt;
    _authorizations[identifier] = held;
    completion(@{ @"type": @"authorized", @"id": identifier, @"expiresAt": expiresAt ?: NSNull.null }, nil);
  }
  else if ([outcome isEqual:@"cancel"]) completion(@{ @"type": @"cancel" }, nil);
  else if ([outcome isEqual:@"denied"]) completion(nil, Named(@"denied", @"The admin prompt was not answered with an administrator's credentials"));
  else completion(nil, Named(@"notInteractive", @"The admin prompt cannot be shown in this session"));
}
- (void)releaseAuthorization:(NSString *)identifier
{
  SparkHeldAuthorization *held = _authorizations[identifier];
  [_authorizations removeObjectForKey:identifier];
  if (held.reference) AuthorizationFree(held.reference, kAuthorizationFlagDestroyRights);
}

- (void)dropConnection:(NSString *)name
{
  SparkPrivilegedHelperLink *link = _links[name];
  [_links removeObjectForKey:name];
  [link finish:Named(@"connectionInvalid", @"The privileged helper connection was closed")];
  [link.connection invalidate];
}
static NSError *ConnectionError(NSError *error) {
  NSString *reason = [error.domain isEqual:NSCocoaErrorDomain] ? SparkPrivilegedHelperConnectionFailure(error.code) : nil;
  return Named(reason ?: @"unknown", [NSString stringWithFormat:@"The privileged helper connection failed: %@", error.localizedDescription]);
}
// The helper's connection once the helper has proved its signature (SparkPrivilegedHelperProtocol's verifyWithReply:),
// or the error that ended it. A connection that is interrupted or fails is dropped, so the next message verifies anew.
- (void)link:(NSString *)name ready:(void (^)(SparkPrivilegedHelperLink *_Nullable link, NSError *_Nullable error))ready
{
  SparkPrivilegedHelperLink *link = _links[name];
  if (link.stale) { [self dropConnection:name]; link = nil; }
  if (!link) {
    NSString *requirement = _requirement(name);
    if (!requirement) { ready(nil, Named(@"invalidSignature", @"No code signing requirement can name this helper")); return; }
    link = [SparkPrivilegedHelperLink new];
    link.waiting = [NSMutableArray array];
    NSXPCConnection *connection = _connector ? _connector(name)
      : [[NSXPCConnection alloc] initWithMachServiceName:SparkPrivilegedHelperLabel(NSBundle.mainBundle.bundleIdentifier, name) options:NSXPCConnectionPrivileged];
    link.connection = connection;
    connection.remoteObjectInterface = [NSXPCInterface interfaceWithProtocol:@protocol(SparkPrivilegedHelperProtocol)];
    // The system checks every message from the helper against the app's team and the helper's signing identifier,
    // starting with the verification reply.
    [connection setCodeSigningRequirement:requirement];
    __weak SparkPrivilegedHelpers *weakSelf = self;
    __weak SparkPrivilegedHelperLink *weakLink = link;
    dispatch_block_t forget = ^{
      dispatch_async(dispatch_get_main_queue(), ^{
        SparkPrivilegedHelpers *helpers = weakSelf;
        if (helpers && helpers->_links[name] == weakLink) [helpers dropConnection:name];
      });
    };
    dispatch_block_t stale = ^{ weakLink.stale = YES; forget(); };
    connection.invalidationHandler = stale;
    connection.interruptionHandler = stale;
    _links[name] = link;
    [connection resume];
    // The verification's handlers hold the link until one of them runs, so its waiting requests always settle.
    [[connection remoteObjectProxyWithErrorHandler:^(NSError *error) {
      dispatch_async(dispatch_get_main_queue(), ^{ [link finish:ConnectionError(error)]; forget(); });
    }] verifyWithReply:^{
      dispatch_async(dispatch_get_main_queue(), ^{ [link finish:nil]; });
    }];
  }
  if (link.verified) ready(link, nil);
  else if (link.failure) ready(nil, link.failure);
  else {
    __weak SparkPrivilegedHelperLink *weakLink = link;
    [link.waiting addObject:^(NSError *error) { ready(error ? nil : weakLink, error); }];
  }
}

- (void)send:(id)message helper:(NSString *)name authorization:(NSString *)authorization timeoutMs:(NSUInteger)timeoutMs identifier:(NSString *)identifier completion:(SparkPrivilegedHelperCompletion)completion
{
  if (_requests[identifier]) { completion(nil, Failure(@"E_INVALID_ARGUMENT", nil, @"A request with this identifier is pending")); return; }
  NSData *payload = JSONData(message);
  if (!payload) { completion(nil, Failure(@"E_INVALID_ARGUMENT", nil, @"The message is not JSON or is larger than 1 MiB")); return; }
  SparkHeldAuthorization *held = authorization ? _authorizations[authorization] : nil;
  if (authorization && !held) { completion(nil, Failure(@"E_CLOSED", nil, @"The admin authorization was released")); return; }
  if (held.expiresAt && Now().longLongValue >= held.expiresAt.longLongValue) { completion(nil, Expired()); return; }
  if (!self.isSigned) { completion(nil, Unsigned()); return; }
  if (_simulated || !_connector) {
    NSString *status = [self statusOf:name];
    if (![status isEqual:@"enabled"]) { completion(nil, Named(status, [NSString stringWithFormat:@"The privileged helper is %@", status])); return; }
  }
  SparkPrivilegedHelperRequest *request = [SparkPrivilegedHelperRequest new];
  __weak SparkPrivilegedHelpers *weakSelf = self;
  request.completion = ^(id result, NSError *error) {
    SparkPrivilegedHelpers *helpers = weakSelf;
    if (helpers) [helpers->_requests removeObjectForKey:identifier];
    completion(result, error);
  };
  _requests[identifier] = request;
#if SPARK_TEST_DRIVER
  if (_simulated) { [self simulateSend:message helper:name authorized:held != nil request:request]; return; }
#endif
  NSData *external = nil;
  if (held.reference) {
    AuthorizationExternalForm form;
    if (AuthorizationMakeExternalForm(held.reference, &form) != errAuthorizationSuccess) { [request settle:nil error:Failure(@"E_CLOSED", nil, @"The admin authorization is no longer valid")]; return; }
    external = [NSData dataWithBytes:&form length:sizeof form];
  }
  [self deliver:payload authorization:external helper:name request:request retry:YES];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)timeoutMs * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
    [request settle:nil error:Failure(@"E_TIMEOUT", nil, @"The privileged helper did not reply in time")];
  });
}
// Sends over a verified connection. A connection found stale when its verification completes (the helper was relaunched
// meanwhile) is verified once more before anything is sent.
- (void)deliver:(NSData *)payload authorization:(nullable NSData *)external helper:(NSString *)name request:(SparkPrivilegedHelperRequest *)request retry:(BOOL)retry
{
  [self link:name ready:^(SparkPrivilegedHelperLink *link, NSError *error) {
    if (error || request.settled) { [request settle:nil error:error]; return; }
    if (link.stale) {
      if (retry) [self deliver:payload authorization:external helper:name request:request retry:NO];
      else [request settle:nil error:Named(@"connectionInterrupted", @"The privileged helper restarted while it was being verified")];
      return;
    }
    id<SparkPrivilegedHelperProtocol> proxy = [link.connection remoteObjectProxyWithErrorHandler:^(NSError *failure) { [request settle:nil error:ConnectionError(failure)]; }];
    [proxy handleMessage:payload authorization:external reply:^(NSData *reply, NSString *code, NSString *text) {
      if ([code isEqual:@"authorizationExpired"]) { [request settle:nil error:Expired()]; return; }
      if (code) { [request settle:nil error:Failure(HelperCode(code), @"helperFailed", text ?: @"The privileged helper failed")]; return; }
      id value = reply.length <= SparkPrivilegedHelperMaxMessageBytes ? [NSJSONSerialization JSONObjectWithData:reply ?: NSData.data options:NSJSONReadingFragmentsAllowed error:nil] : nil;
      if (value) [request settle:@{ @"value": value } error:nil];
      else [request settle:nil error:Failure(@"E_INVALID_DATA", nil, @"The privileged helper's reply is not JSON")];
    }];
  }];
}
- (void)cancel:(NSString *)identifier
{
  [_requests[identifier] settle:nil error:Failure(@"E_ABORTED", nil, @"The request was aborted; the helper may already have acted on it")];
}

#if SPARK_TEST_DRIVER
// The simulated helper answers like the Kitchen Sink's: it echoes the message with whether an authorization came with it
// and the uid it runs as (0, root).
- (void)simulateSend:(id)message helper:(NSString *)name authorized:(BOOL)authorized request:(SparkPrivilegedHelperRequest *)request
{
  _messages++;
  _lastMessage = @{ @"helper": name, @"message": message, @"authorized": @(authorized) };
  NSString *connection = _connection;
  dispatch_async(dispatch_get_main_queue(), ^{
    if ([connection isEqual:@"invalid"]) [request settle:nil error:Named(@"connectionInvalid", @"Simulated: the helper refused the connection")];
    else if ([connection isEqual:@"interrupted"]) [request settle:nil error:Named(@"connectionInterrupted", @"Simulated: the helper exited with the request in flight")];
    else [request settle:@{ @"value": @{ @"received": message, @"authorized": @(authorized), @"uid": @0 } } error:nil];
  });
}
- (BOOL)simulate:(NSDictionary *)state error:(NSError **)error
{
  NSArray *statuses = @[@"notRegistered", @"enabled", @"requiresApproval", @"notFound"];
  NSError *failure = _simulated ? nil : Failure(@"E_UNAVAILABLE", nil, @"Privileged helper simulation needs the test driver");
  for (NSString *field in state) {
    if (failure) break;
    id value = state[field];
    BOOL valid = NO;
    if ([field isEqual:@"signed"]) valid = [value isKindOfClass:NSNumber.class] && (value == (id)kCFBooleanTrue || value == (id)kCFBooleanFalse);
    else if ([field isEqual:@"helpers"]) {
      valid = [value isKindOfClass:NSDictionary.class];
      for (id key in valid ? value : @{}) valid = valid && [key isKindOfClass:NSString.class] && [key length] && [statuses containsObject:value[key]];
    }
    else if ([field isEqual:@"approval"]) valid = [@[@"required", @"granted"] containsObject:value];
    else if ([field isEqual:@"promptAnswer"]) valid = value == NSNull.null || [@[@"authorized", @"cancel", @"denied", @"notInteractive"] containsObject:value];
    else if ([field isEqual:@"connection"]) valid = [@[@"accept", @"invalid", @"interrupted"] containsObject:value];
    else if ([field isEqual:@"expireAuthorizations"]) valid = value == (id)kCFBooleanTrue;
    else { failure = Failure(@"E_INVALID_ARGUMENT", nil, [NSString stringWithFormat:@"Unknown simulated privileged helper field: %@", field]); break; }
    if (!valid) failure = Failure(@"E_INVALID_ARGUMENT", nil, [NSString stringWithFormat:@"Invalid simulated privileged helper %@", field]);
  }
  if (failure) { if (error) *error = failure; return NO; }
  if (state[@"signed"]) _signed = [state[@"signed"] boolValue];
  if (state[@"helpers"]) [_helpers addEntriesFromDictionary:state[@"helpers"]];
  if (state[@"approval"]) _approval = state[@"approval"];
  if (state[@"promptAnswer"]) _promptAnswer = state[@"promptAnswer"];
  if (state[@"connection"]) _connection = state[@"connection"];
  // The rights' timeout passing: held authorizations lapse, as they do after the right's timeout.
  if (state[@"expireAuthorizations"]) for (SparkHeldAuthorization *held in _authorizations.allValues) held.expiresAt = Now();
  return YES;
}
- (NSDictionary *)simulation
{
  return @{ @"signed": @(_signed), @"helpers": [_helpers copy], @"approval": _approval, @"promptAnswer": _promptAnswer, @"connection": _connection,
    @"registrations": @(_registrations), @"unregistrations": @(_unregistrations), @"settingsOpened": @(_settingsOpened), @"prompts": @(_prompts),
    @"lastPrompt": _lastPrompt, @"authorizations": @(_authorizations.count), @"messages": @(_messages), @"lastMessage": _lastMessage };
}
#endif
@end
