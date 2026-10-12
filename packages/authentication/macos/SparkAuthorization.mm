#import "SparkAuthorization.h"
#import <Security/SecTask.h>

NSErrorDomain const SparkAuthorizationErrorDomain = @"so.legend.spark.authentication";
static NSError *Failure(NSString *code, NSString *message) {
  return [NSError errorWithDomain:SparkAuthorizationErrorDomain code:0 userInfo:@{ @"code": code, NSLocalizedDescriptionKey: message }];
}
NSString *SparkAuthorizationErrorCode(NSError *error) {
  NSString *code = [error.domain isEqual:SparkAuthorizationErrorDomain] ? error.userInfo[@"code"] : nil;
  return code ?: @"E_NATIVE";
}

NSString *SparkAuthorizationFailure(NSInteger code) {
  // Numbers, not the constants: the later ones are declared only by newer SDKs.
  switch (code) {
    case 1000: return @"unknown";              // ASAuthorizationErrorUnknown
    case 1001: return @"canceled";             // ASAuthorizationErrorCanceled
    case 1002: return @"invalidResponse";      // ASAuthorizationErrorInvalidResponse
    case 1003: return @"notHandled";           // ASAuthorizationErrorNotHandled
    case 1004: return @"failed";               // ASAuthorizationErrorFailed
    case 1005: return @"notInteractive";       // ASAuthorizationErrorNotInteractive
    case 1006: return @"matchedExcludedCredential"; // ASAuthorizationErrorMatchedExcludedCredential (macOS 15)
    case 1010: return @"deviceNotConfigured";  // ASAuthorizationErrorDeviceNotConfiguredForPasskeyCreation (macOS 26)
    default: return nil;
  }
}

NSDictionary *SparkAuthorizationProcessEntitlements(void) {
  NSMutableDictionary *entitlements = [NSMutableDictionary dictionary];
  SecTaskRef task = SecTaskCreateFromSelf(NULL);
  if (!task) return entitlements;
  NSDictionary *keys = @{ @"applesignin": @"com.apple.developer.applesignin", @"associatedDomains": @"com.apple.developer.associated-domains" };
  for (NSString *name in keys) {
    id value = CFBridgingRelease(SecTaskCopyValueForEntitlement(task, (__bridge CFStringRef)keys[name], NULL));
    if (value) entitlements[name] = value;
  }
  CFRelease(task);
  return entitlements;
}

BOOL SparkAuthorizationEntitled(NSDictionary *entitlements, NSString *feature, NSString *relyingPartyId) {
  if ([feature isEqual:@"appleId"]) {
    id value = entitlements[@"applesignin"];
    return [value isKindOfClass:NSArray.class] && [value count] > 0;
  }
  if (![feature isEqual:@"passkeys"] || !relyingPartyId.length) return NO;
  id domains = entitlements[@"associatedDomains"];
  if (![domains isKindOfClass:NSArray.class]) return NO;
  for (id domain in domains) {
    if (![domain isKindOfClass:NSString.class] || ![domain hasPrefix:@"webcredentials:"]) continue;
    // A ?mode=developer or ?mode=managed suffix changes how the association is fetched, not which domain it names.
    NSString *entry = [[domain substringFromIndex:15] componentsSeparatedByString:@"?"].firstObject;
    if ([entry isEqual:relyingPartyId]) return YES;
    // *.example.com: any subdomain of example.com, not example.com itself.
    if ([entry hasPrefix:@"*."] && entry.length > 2 && [relyingPartyId hasSuffix:[entry substringFromIndex:1]]) return YES;
  }
  return NO;
}

NSData *SparkBase64URLDecode(id value) {
  if (![value isKindOfClass:NSString.class] || ![value length] || [value rangeOfCharacterFromSet:[NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"].invertedSet].location != NSNotFound) return nil;
  if ([value length] % 4 == 1) return nil;
  NSMutableString *base64 = [[[value stringByReplacingOccurrencesOfString:@"-" withString:@"+"] stringByReplacingOccurrencesOfString:@"_" withString:@"/"] mutableCopy];
  while (base64.length % 4) [base64 appendString:@"="];
  return [[NSData alloc] initWithBase64EncodedString:base64 options:0];
}
NSString *SparkBase64URLEncode(NSData *data) {
  NSString *base64 = [data base64EncodedStringWithOptions:0];
  return [[[base64 stringByReplacingOccurrencesOfString:@"+" withString:@"-"] stringByReplacingOccurrencesOfString:@"/" withString:@"_"] stringByReplacingOccurrencesOfString:@"=" withString:@""];
}

static NSDictionary *Failed(NSString *reason, NSString *message) { return @{ @"type": @"failure", @"reason": reason, @"message": message }; }
static NSDictionary *Succeeded(NSDictionary *credential) { return @{ @"type": @"success", @"credential": credential }; }
static NSDictionary *const Canceled = @{ @"type": @"cancel" };
static id Nullable(id value) { return value ?: NSNull.null; }
static id Text(NSData *data) { return data ? Nullable([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]) : NSNull.null; }

// Wraps a completion so it runs once, on the main thread, however often and wherever it is called.
static SparkAuthorizationCompletion Once(SparkAuthorizationCompletion completion) {
  __block SparkAuthorizationCompletion pending = [completion copy];
  return ^(id result, NSError *error) {
    dispatch_block_t finish = ^{
      SparkAuthorizationCompletion callback = pending;
      pending = nil;
      if (callback) callback(result, error);
    };
    if (NSThread.isMainThread) finish(); else dispatch_async(dispatch_get_main_queue(), finish);
  };
}

// An AuthenticationServices error as a result: cancel, a named failure (appCancel when the app cancelled), or E_NATIVE.
id SparkAuthorizationCompleted(NSError *error, BOOL aborted, NSError **failure) {
  NSString *reason = [error.domain isEqual:ASAuthorizationErrorDomain] ? SparkAuthorizationFailure(error.code) : nil;
  if ([reason isEqual:@"canceled"]) return aborted ? Failed(@"appCancel", @"The app cancelled the request") : Canceled;
  if (reason) return Failed(reason, error.localizedDescription);
  *failure = Failure(@"E_NATIVE", [NSString stringWithFormat:@"Authorization failed: %@ %ld %@", error.domain, (long)error.code, error.localizedDescription]);
  return nil;
}

#pragma mark Validation

static BOOL String(id value, NSUInteger maximum) {
  return [value isKindOfClass:NSString.class] && [value length] <= maximum && [value stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet].length > 0;
}
static BOOL Bytes(id value, NSUInteger minimum, NSUInteger maximum) {
  NSData *data = SparkBase64URLDecode(value);
  return data && data.length >= minimum && data.length <= maximum;
}
static BOOL RelyingParty(id value) {
  static NSRegularExpression *pattern;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ pattern = [NSRegularExpression regularExpressionWithPattern:@"^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$" options:0 error:nil]; });
  return [value isKindOfClass:NSString.class] && [pattern numberOfMatchesInString:value options:0 range:NSMakeRange(0, [value length])] == 1;
}
static BOOL Credentials(id value) {
  if (!value) return YES;
  if (![value isKindOfClass:NSArray.class] || [value count] > 64) return NO;
  for (id item in value) if (!Bytes(item, 1, 1023)) return NO;
  return YES;
}
static NSArray<NSString *> *const Operations = @[@"appleId", @"createPasskey", @"getPasskey"];
static NSArray<NSString *> *const Verifications = @[@"required", @"preferred", @"discouraged"];
static NSArray<NSString *> *const Attestations = @[@"none", @"direct", @"indirect", @"enterprise"];

// The options an operation takes (docs/authentication.md); the JavaScript layer checks the same before calling.
static NSError *Validate(NSString *operation, NSDictionary *options) {
  if (![Operations containsObject:operation]) return Failure(@"E_INVALID_ARGUMENT", @"Unknown authorization operation");
  if ([operation isEqual:@"appleId"]) {
    id scopes = options[@"scopes"] ?: @[];
    if (![scopes isKindOfClass:NSArray.class] || [NSSet setWithArray:scopes].count != [scopes count]) return Failure(@"E_INVALID_ARGUMENT", @"scopes lists fullName and email at most once each");
    for (id scope in scopes) if (![@[@"fullName", @"email"] containsObject:scope]) return Failure(@"E_INVALID_ARGUMENT", @"scopes lists fullName and email at most once each");
    for (NSString *key in @[@"state", @"nonce"]) if (options[key] && !String(options[key], 1024)) return Failure(@"E_INVALID_ARGUMENT", [key stringByAppendingString:@" is 1–1024 characters"]);
    return nil;
  }
  if (!RelyingParty(options[@"relyingPartyId"])) return Failure(@"E_INVALID_ARGUMENT", @"relyingPartyId is a lowercase domain name such as example.com");
  if (!Bytes(options[@"challenge"], 16, 1024)) return Failure(@"E_INVALID_ARGUMENT", @"challenge is 16–1024 bytes as unpadded base64url");
  if (options[@"userVerification"] && ![Verifications containsObject:options[@"userVerification"]]) return Failure(@"E_INVALID_ARGUMENT", @"userVerification is required, preferred or discouraged");
  if ([operation isEqual:@"getPasskey"]) return Credentials(options[@"allowCredentials"]) ? nil : Failure(@"E_INVALID_ARGUMENT", @"allowCredentials lists at most 64 base64url credential IDs");
  if (!Bytes(options[@"userId"], 1, 64)) return Failure(@"E_INVALID_ARGUMENT", @"userId is 1–64 bytes as unpadded base64url");
  if (!String(options[@"userName"], 256)) return Failure(@"E_INVALID_ARGUMENT", @"userName is 1–256 characters");
  if (options[@"displayName"] && !String(options[@"displayName"], 256)) return Failure(@"E_INVALID_ARGUMENT", @"displayName is 1–256 characters");
  if (options[@"attestation"] && ![Attestations containsObject:options[@"attestation"]]) return Failure(@"E_INVALID_ARGUMENT", @"attestation is none, direct, indirect or enterprise");
  if (!Credentials(options[@"excludeCredentials"])) return Failure(@"E_INVALID_ARGUMENT", @"excludeCredentials lists at most 64 base64url credential IDs");
  if (options[@"excludeCredentials"]) {
    if (@available(macOS 15.0, *)) {} else return Failure(@"E_UNAVAILABLE", @"excludeCredentials needs macOS 15");
  }
  return nil;
}

#pragma mark Requests

static NSArray<ASAuthorizationPlatformPublicKeyCredentialDescriptor *> *Descriptors(NSArray<NSString *> *ids) {
  NSMutableArray *descriptors = [NSMutableArray array];
  for (NSString *identifier in ids) [descriptors addObject:[[ASAuthorizationPlatformPublicKeyCredentialDescriptor alloc] initWithCredentialID:SparkBase64URLDecode(identifier)]];
  return descriptors;
}
static ASAuthorizationPublicKeyCredentialUserVerificationPreference Verification(NSString *value) {
  if ([value isEqual:@"required"]) return ASAuthorizationPublicKeyCredentialUserVerificationPreferenceRequired;
  if ([value isEqual:@"discouraged"]) return ASAuthorizationPublicKeyCredentialUserVerificationPreferenceDiscouraged;
  return ASAuthorizationPublicKeyCredentialUserVerificationPreferencePreferred;
}

// The AuthenticationServices request of a validated operation.
static ASAuthorizationRequest *Request(NSString *operation, NSDictionary *options) {
  if ([operation isEqual:@"appleId"]) {
    ASAuthorizationAppleIDRequest *request = [[ASAuthorizationAppleIDProvider new] createRequest];
    NSMutableArray *scopes = [NSMutableArray array];
    for (NSString *scope in options[@"scopes"] ?: @[]) [scopes addObject:[scope isEqual:@"email"] ? ASAuthorizationScopeEmail : ASAuthorizationScopeFullName];
    request.requestedScopes = scopes;
    request.state = options[@"state"];
    request.nonce = options[@"nonce"];
    return request;
  }
  ASAuthorizationPlatformPublicKeyCredentialProvider *provider = [[ASAuthorizationPlatformPublicKeyCredentialProvider alloc] initWithRelyingPartyIdentifier:options[@"relyingPartyId"]];
  NSData *challenge = SparkBase64URLDecode(options[@"challenge"]);
  if ([operation isEqual:@"getPasskey"]) {
    ASAuthorizationPlatformPublicKeyCredentialAssertionRequest *request = [provider createCredentialAssertionRequestWithChallenge:challenge];
    if (options[@"allowCredentials"]) request.allowedCredentials = Descriptors(options[@"allowCredentials"]);
    request.userVerificationPreference = Verification(options[@"userVerification"]);
    return request;
  }
  ASAuthorizationPlatformPublicKeyCredentialRegistrationRequest *request = [provider createCredentialRegistrationRequestWithChallenge:challenge name:options[@"userName"] userID:SparkBase64URLDecode(options[@"userId"])];
  if (options[@"displayName"]) request.displayName = options[@"displayName"];
  request.userVerificationPreference = Verification(options[@"userVerification"]);
  NSString *attestation = options[@"attestation"];
  request.attestationPreference = [attestation isEqual:@"direct"] ? ASAuthorizationPublicKeyCredentialAttestationKindDirect
    : [attestation isEqual:@"indirect"] ? ASAuthorizationPublicKeyCredentialAttestationKindIndirect
    : [attestation isEqual:@"enterprise"] ? ASAuthorizationPublicKeyCredentialAttestationKindEnterprise : ASAuthorizationPublicKeyCredentialAttestationKindNone;
  if (@available(macOS 15.0, *)) { if (options[@"excludeCredentials"]) request.excludedCredentials = Descriptors(options[@"excludeCredentials"]); }
  return request;
}

static NSString *Scope(ASAuthorizationScope scope) { return [scope isEqual:ASAuthorizationScopeEmail] ? @"email" : [scope isEqual:ASAuthorizationScopeFullName] ? @"fullName" : nil; }
static id FullName(NSPersonNameComponents *name) {
  NSMutableDictionary *result = [NSMutableDictionary dictionary];
  BOOL any = NO;
  for (NSString *key in @[@"namePrefix", @"givenName", @"middleName", @"familyName", @"nameSuffix", @"nickname"]) {
    id value = [name valueForKey:key];
    any = any || value;
    result[key] = Nullable(value);
  }
  return any ? result : NSNull.null;
}

NSDictionary *SparkAuthorizationCredential(id<ASAuthorizationCredential> credential) {
  if ([credential isKindOfClass:ASAuthorizationAppleIDCredential.class]) {
    ASAuthorizationAppleIDCredential *apple = (ASAuthorizationAppleIDCredential *)credential;
    NSMutableArray *scopes = [NSMutableArray array];
    for (ASAuthorizationScope scope in apple.authorizedScopes) if (Scope(scope)) [scopes addObject:Scope(scope)];
    NSString *status = apple.realUserStatus == ASUserDetectionStatusLikelyReal ? @"likelyReal" : apple.realUserStatus == ASUserDetectionStatusUnknown ? @"unknown" : @"unsupported";
    return @{ @"user": apple.user, @"state": Nullable(apple.state), @"authorizedScopes": scopes, @"identityToken": Text(apple.identityToken),
      @"authorizationCode": Text(apple.authorizationCode), @"email": Nullable(apple.email), @"fullName": FullName(apple.fullName), @"realUserStatus": status };
  }
  if ([credential isKindOfClass:ASAuthorizationPlatformPublicKeyCredentialRegistration.class]) {
    ASAuthorizationPlatformPublicKeyCredentialRegistration *registration = (ASAuthorizationPlatformPublicKeyCredentialRegistration *)credential;
    return @{ @"credentialId": SparkBase64URLEncode(registration.credentialID), @"clientDataJSON": SparkBase64URLEncode(registration.rawClientDataJSON),
      @"attestationObject": registration.rawAttestationObject ? SparkBase64URLEncode(registration.rawAttestationObject) : NSNull.null };
  }
  if ([credential isKindOfClass:ASAuthorizationPlatformPublicKeyCredentialAssertion.class]) {
    ASAuthorizationPlatformPublicKeyCredentialAssertion *assertion = (ASAuthorizationPlatformPublicKeyCredentialAssertion *)credential;
    return @{ @"credentialId": SparkBase64URLEncode(assertion.credentialID), @"userId": SparkBase64URLEncode(assertion.userID),
      @"clientDataJSON": SparkBase64URLEncode(assertion.rawClientDataJSON), @"authenticatorData": SparkBase64URLEncode(assertion.rawAuthenticatorData),
      @"signature": SparkBase64URLEncode(assertion.signature) };
  }
  return nil;
}

@implementation SparkAuthorizationRequest
- (void)setSettle:(SparkAuthorizationCompletion)settle { _settle = Once(settle); }
- (ASPresentationAnchor)presentationAnchorForAuthorizationController:(ASAuthorizationController *)controller { return self.window; }
- (void)authorizationController:(ASAuthorizationController *)controller didCompleteWithAuthorization:(ASAuthorization *)authorization
{
  NSDictionary *credential = SparkAuthorizationCredential(authorization.credential);
  if (credential) self.settle(Succeeded(credential), nil);
  else self.settle(nil, Failure(@"E_INVALID_DATA", [NSString stringWithFormat:@"Authorization returned an unexpected credential: %@", NSStringFromClass([(NSObject *)authorization.credential class])]));
}
- (void)authorizationController:(ASAuthorizationController *)controller didCompleteWithError:(NSError *)error
{
  NSError *failure = nil;
  id result = SparkAuthorizationCompleted(error, self.aborted, &failure);
  self.settle(result, failure);
}
@end

@implementation SparkAuthorization {
  // Pending requests by identifier: a SparkAuthorizationRequest, or a simulated request's cancel block.
  NSMutableDictionary<NSString *, id> *_active;
  NSDictionary *_entitlements; // Immutable; replaced whole (atomically) so -availability: may read it from any thread.
#if SPARK_TEST_DRIVER
  NSMutableDictionary *_simulation;
  NSMutableArray<NSDictionary *> *_passkeys;
  NSMutableSet<NSString *> *_users;
#endif
}

- (instancetype)initWithSimulated:(BOOL)simulated
{
  if ((self = [super init])) {
    _active = [NSMutableDictionary dictionary];
    _entitlements = SparkAuthorizationProcessEntitlements();
#if SPARK_TEST_DRIVER
    _simulated = simulated;
    if (simulated) {
      // The simulation starts from this build's real entitlements, so availability stays truthful until a flow changes it.
      NSMutableArray *domains = [NSMutableArray array];
      for (id domain in [_entitlements[@"associatedDomains"] isKindOfClass:NSArray.class] ? _entitlements[@"associatedDomains"] : @[])
        if ([domain isKindOfClass:NSString.class] && [domain hasPrefix:@"webcredentials:"]) [domains addObject:[[domain substringFromIndex:15] componentsSeparatedByString:@"?"].firstObject];
      _simulation = [@{ @"appleId": @(SparkAuthorizationEntitled(_entitlements, @"appleId", nil)), @"webCredentials": domains, @"answer": NSNull.null,
        @"credentialState": NSNull.null, @"requests": @0, @"lastRequest": NSNull.null } mutableCopy];
      _passkeys = [NSMutableArray array];
      _users = [NSMutableSet set];
      [self simulateEntitlements];
    }
#else
    NSAssert(!simulated, @"Simulated authorization exists only in builds with the test driver");
#endif
  }
  return self;
}

- (NSString *)availability:(NSString *)feature relyingPartyId:(NSString *)relyingPartyId
{
  NSDictionary *entitlements;
  @synchronized (self) { entitlements = _entitlements; }
  return SparkAuthorizationEntitled(entitlements, feature, relyingPartyId) ? @"available" : @"missing-entitlement";
}

static NSString *Feature(NSString *operation) { return [operation isEqual:@"appleId"] ? @"appleId" : @"passkeys"; }
static NSString *MissingEntitlement(NSString *feature, NSString *relyingPartyId) {
  return [feature isEqual:@"appleId"] ? @"Sign in with Apple needs the com.apple.developer.applesignin entitlement (macos.authentication.signInWithApple) in a team-signed build"
    : [NSString stringWithFormat:@"Passkeys for %@ need webcredentials:%@ in the com.apple.developer.associated-domains entitlement (macos.authentication.passkeyDomains) in a team-signed build", relyingPartyId, relyingPartyId];
}

- (void)perform:(NSString *)operation options:(NSDictionary *)options window:(NSWindow *)window identifier:(NSString *)identifier completion:(SparkAuthorizationCompletion)completion
{
  SparkAuthorizationCompletion done = Once(completion);
  NSError *invalid = Validate(operation, options);
  if (!invalid && (![identifier isKindOfClass:NSString.class] || !identifier.length)) invalid = Failure(@"E_INVALID_ARGUMENT", @"A request needs an identifier");
  if (!invalid && _active.count) invalid = Failure(@"E_BUSY", @"Another authorization request is pending; one shows at a time");
  if (invalid) return done(nil, invalid);
  NSString *feature = Feature(operation);
  if (![[self availability:feature relyingPartyId:options[@"relyingPartyId"]] isEqual:@"available"]) return done(Failed(@"missingEntitlement", MissingEntitlement(feature, options[@"relyingPartyId"])), nil);
  __weak SparkAuthorization *weakSelf = self;
  // Closing the anchor window cancels the request (appCancel): the sheet cannot outlive the window it is attached to.
  id closing = [NSNotificationCenter.defaultCenter addObserverForName:NSWindowWillCloseNotification object:window queue:nil usingBlock:^(NSNotification *) {
    [weakSelf cancel:identifier];
  }];
  SparkAuthorizationCompletion settle = Once(^(id result, NSError *error) {
    [NSNotificationCenter.defaultCenter removeObserver:closing];
    SparkAuthorization *strongSelf = weakSelf;
    id active = strongSelf ? strongSelf->_active[identifier] : nil;
    if (strongSelf) [strongSelf->_active removeObjectForKey:identifier];
    // The controller may still be calling its delegate: release both once that call has returned.
    if (active) dispatch_async(dispatch_get_main_queue(), ^{ (void)active; });
    done(result, error);
  });
#if SPARK_TEST_DRIVER
  if (_simulated) return [self simulate:operation options:options window:window identifier:identifier completion:settle];
#endif
  SparkAuthorizationRequest *request = [SparkAuthorizationRequest new];
  request.window = window;
  request.settle = settle;
  request.controller = [[ASAuthorizationController alloc] initWithAuthorizationRequests:@[Request(operation, options)]];
  request.controller.delegate = request;
  request.controller.presentationContextProvider = request;
  _active[identifier] = request;
  [request.controller performRequests];
}

- (void)cancel:(NSString *)identifier
{
  id active = _active[identifier];
  if ([active isKindOfClass:SparkAuthorizationRequest.class]) {
    SparkAuthorizationRequest *request = active;
    request.aborted = YES;
    [request.controller cancel]; // The delegate then gets ASAuthorizationErrorCanceled, reported as appCancel.
  } else if (active) ((dispatch_block_t)active)();
}

static NSString *CredentialState(ASAuthorizationAppleIDProviderCredentialState state) {
  switch (state) {
    case ASAuthorizationAppleIDProviderCredentialAuthorized: return @"authorized";
    case ASAuthorizationAppleIDProviderCredentialRevoked: return @"revoked";
    case ASAuthorizationAppleIDProviderCredentialNotFound: return @"notFound";
    case ASAuthorizationAppleIDProviderCredentialTransferred: return @"transferred";
    default: return nil;
  }
}

- (void)credentialState:(NSString *)user completion:(SparkAuthorizationCompletion)completion
{
  SparkAuthorizationCompletion done = Once(completion);
  if (!String(user, 1024)) return done(nil, Failure(@"E_INVALID_ARGUMENT", @"user is the credential's user identifier, 1–1024 characters"));
  if (![[self availability:@"appleId" relyingPartyId:nil] isEqual:@"available"]) return done(Failed(@"missingEntitlement", MissingEntitlement(@"appleId", nil)), nil);
#if SPARK_TEST_DRIVER
  if (_simulated) {
    id state = _simulation[@"credentialState"];
    return done(state != NSNull.null ? state : [_users containsObject:user] ? @"authorized" : @"notFound", nil);
  }
#endif
  // The completion runs on a queue of AuthenticationServices' choosing; done moves it to the main thread.
  [[ASAuthorizationAppleIDProvider new] getCredentialStateForUserID:user completion:^(ASAuthorizationAppleIDProviderCredentialState state, NSError *error) {
    NSError *failure = nil;
    if (error) {
      id result = SparkAuthorizationCompleted(error, NO, &failure);
      // No sheet is shown, so a cancel is not the person's answer; there is no credential state to report.
      if ([result isEqual:Canceled]) return done(nil, Failure(@"E_NATIVE", [NSString stringWithFormat:@"Checking the Apple ID credential state was cancelled: %@", error.localizedDescription]));
      return done(result, failure);
    }
    NSString *name = CredentialState(state);
    done(name, name ? nil : Failure(@"E_NATIVE", [NSString stringWithFormat:@"Unknown Apple ID credential state %ld", (long)state]));
  }];
}

#if SPARK_TEST_DRIVER
- (void)simulateEntitlements
{
  NSMutableArray *domains = [NSMutableArray array];
  for (NSString *domain in _simulation[@"webCredentials"]) [domains addObject:[@"webcredentials:" stringByAppendingString:domain]];
  NSDictionary *entitlements = [_simulation[@"appleId"] boolValue] ? @{ @"applesignin": @[@"Default"], @"associatedDomains": domains } : @{ @"associatedDomains": domains };
  @synchronized (self) { _entitlements = entitlements; }
}

static NSString *Simulated(NSString *text) { return SparkBase64URLEncode([text dataUsingEncoding:NSUTF8StringEncoding]); }

// A simulated request: the set answer decides how it ends; a success returns made-up credentials (docs/authentication.md#testing).
- (void)simulate:(NSString *)operation options:(NSDictionary *)options window:(NSWindow *)window identifier:(NSString *)identifier completion:(SparkAuthorizationCompletion)settle
{
  id answer = _simulation[@"answer"];
  NSString *relyingParty = options[@"relyingPartyId"];
  NSDictionary *found = nil;
  if ([operation isEqual:@"getPasskey"])
    for (NSDictionary *passkey in _passkeys.reverseObjectEnumerator)
      if ([passkey[@"relyingPartyId"] isEqual:relyingParty] && (!options[@"allowCredentials"] || [options[@"allowCredentials"] containsObject:passkey[@"credentialId"]])) { found = passkey; break; }
  NSError *refused = nil;
  if (answer == NSNull.null) refused = Failure(@"E_UNAVAILABLE", @"Test driver: no simulated answer for the authorization request (simulateAuthorization answer)");
  else if ([answer isEqual:@"success"] && [operation isEqual:@"getPasskey"] && !found) refused = Failure(@"E_UNAVAILABLE", [NSString stringWithFormat:@"Test driver: no simulated passkey for %@ matches the request", relyingParty]);
  if (refused) { dispatch_async(dispatch_get_main_queue(), ^{ settle(nil, refused); }); return; }
  _simulation[@"requests"] = @([_simulation[@"requests"] integerValue] + 1);
  NSMutableDictionary *last = [@{ @"operation": operation, @"window": Nullable(window.identifier) } mutableCopy];
  for (NSString *key in @[@"scopes", @"relyingPartyId", @"userName", @"userVerification", @"attestation"]) if (options[key]) last[key] = options[key];
  _simulation[@"lastRequest"] = last;
  if ([answer isEqual:@"ignore"]) {
    // Stays up until cancelled, which ends it as cancelling a real controller does.
    _active[identifier] = [^{ settle(Failed(@"appCancel", @"The app cancelled the request"), nil); } copy];
    return;
  }
  _active[identifier] = [^{} copy]; // Pending until the answer below arrives.
  NSDictionary *result;
  if ([answer isEqual:@"cancel"]) result = Canceled;
  else if (![answer isEqual:@"success"]) result = Failed(answer, [NSString stringWithFormat:@"Simulated %@", answer]);
  else if ([operation isEqual:@"appleId"]) {
    NSArray *scopes = options[@"scopes"] ?: @[];
    NSString *user = @"001234.simulated.0001";
    [_users addObject:user];
    result = Succeeded(@{ @"user": user, @"state": Nullable(options[@"state"]), @"authorizedScopes": scopes, @"identityToken": @"simulated.identity.token",
      @"authorizationCode": @"simulated-authorization-code", @"email": [scopes containsObject:@"email"] ? @"simulated@privaterelay.appleid.com" : NSNull.null,
      @"fullName": [scopes containsObject:@"fullName"] ? @{ @"namePrefix": NSNull.null, @"givenName": @"Spark", @"middleName": NSNull.null, @"familyName": @"Tester", @"nameSuffix": NSNull.null, @"nickname": NSNull.null } : NSNull.null,
      @"realUserStatus": @"unsupported" });
  } else {
    NSString *type = [operation isEqual:@"createPasskey"] ? @"webauthn.create" : @"webauthn.get";
    NSData *client = [NSJSONSerialization dataWithJSONObject:@{ @"type": type, @"challenge": options[@"challenge"], @"origin": [@"https://" stringByAppendingString:relyingParty] } options:NSJSONWritingSortedKeys error:nil];
    if ([operation isEqual:@"getPasskey"]) {
      result = Succeeded(@{ @"credentialId": found[@"credentialId"], @"userId": found[@"userId"], @"clientDataJSON": SparkBase64URLEncode(client),
        @"authenticatorData": Simulated(@"simulated authenticator data"), @"signature": Simulated(@"simulated signature") });
    } else {
      BOOL excluded = NO;
      for (NSDictionary *passkey in _passkeys) excluded = excluded || ([passkey[@"relyingPartyId"] isEqual:relyingParty] && [options[@"excludeCredentials"] containsObject:passkey[@"credentialId"]]);
      if (excluded) result = Failed(@"matchedExcludedCredential", @"Simulated matchedExcludedCredential: a passkey in excludeCredentials is on this Mac");
      else {
        NSString *credentialId = Simulated([NSString stringWithFormat:@"simulated passkey %lu", (unsigned long)_passkeys.count + 1]);
        [_passkeys addObject:@{ @"relyingPartyId": relyingParty, @"credentialId": credentialId, @"userId": options[@"userId"], @"userName": options[@"userName"] }];
        result = Succeeded(@{ @"credentialId": credentialId, @"clientDataJSON": SparkBase64URLEncode(client), @"attestationObject": Simulated(@"simulated attestation") });
      }
    }
  }
  dispatch_async(dispatch_get_main_queue(), ^{ settle(result, nil); });
}

- (BOOL)simulate:(NSDictionary *)state error:(NSError **)error
{
  NSArray *answers = @[@"success", @"cancel", @"unknown", @"invalidResponse", @"notHandled", @"failed", @"notInteractive", @"matchedExcludedCredential", @"deviceNotConfigured", @"ignore", NSNull.null];
  NSArray *states = @[@"authorized", @"revoked", @"notFound", @"transferred", NSNull.null];
  NSError *failure = _simulated ? nil : Failure(@"E_UNAVAILABLE", @"Authorization simulation needs the test driver");
  for (NSString *field in state) {
    if (failure) break;
    id value = state[field];
    if ([field isEqual:@"appleId"]) { if (![value isKindOfClass:NSNumber.class]) failure = Failure(@"E_INVALID_ARGUMENT", @"appleId is a boolean"); }
    else if ([field isEqual:@"webCredentials"]) {
      BOOL valid = [value isKindOfClass:NSArray.class];
      for (id domain in valid ? value : @[]) valid = valid && RelyingParty(domain);
      if (!valid) failure = Failure(@"E_INVALID_ARGUMENT", @"webCredentials lists lowercase domain names");
    }
    else if ([field isEqual:@"answer"]) { if (![answers containsObject:value]) failure = Failure(@"E_INVALID_ARGUMENT", [NSString stringWithFormat:@"%@ is not a simulated answer", value]); }
    else if ([field isEqual:@"credentialState"]) { if (![states containsObject:value]) failure = Failure(@"E_INVALID_ARGUMENT", [NSString stringWithFormat:@"%@ is not an Apple ID credential state", value]); }
    else failure = Failure(@"E_INVALID_ARGUMENT", [NSString stringWithFormat:@"Unknown authorization simulation field: %@", field]);
  }
  if (failure) { if (error) *error = failure; return NO; }
  for (NSString *field in state) _simulation[field] = [field isEqual:@"appleId"] ? @([state[field] boolValue]) : state[field];
  [self simulateEntitlements];
  return YES;
}

- (NSDictionary *)simulation
{
  NSMutableDictionary *simulation = [_simulation mutableCopy];
  NSMutableArray *passkeys = [NSMutableArray array];
  for (NSDictionary *passkey in _passkeys) [passkeys addObject:@{ @"relyingPartyId": passkey[@"relyingPartyId"], @"credentialId": passkey[@"credentialId"], @"userName": passkey[@"userName"] }];
  simulation[@"passkeys"] = passkeys;
  simulation[@"pending"] = @(_active.count);
  return simulation;
}
#endif
@end
