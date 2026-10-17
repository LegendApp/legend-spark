// Sign in with Apple and passkeys (packages/authentication/macos/SparkAuthorization.mm). Never presents a sheet and never
// reaches Apple or a relying party: this binary has no entitlements, so the real instance stops every valid request at
// missingEntitlement before creating a controller, and the simulated instance keeps its state in memory.
#import <AuthenticationServices/AuthenticationServices.h>
#import "SparkAuthorization.h"
#include <cstdio>
#include <cstdlib>

#define CHECK(...) do { if (!(__VA_ARGS__)) { fprintf(stderr, "FAILED %s:%d %s\n", __FILE__, __LINE__, #__VA_ARGS__); exit(1); } } while (0)
static void Drain(void) { [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]]; }

typedef struct { int calls; id result; NSString *code; } Outcome;
static SparkAuthorizationCompletion Record(Outcome *outcome) {
  return ^(id result, NSError *error) {
    CHECK(NSThread.isMainThread);
    outcome->calls++;
    outcome->result = result;
    outcome->code = error ? SparkAuthorizationErrorCode(error) : nil;
  };
}
static BOOL Failed(Outcome outcome, NSString *reason) {
  return outcome.calls == 1 && !outcome.code && [outcome.result[@"type"] isEqual:@"failure"] && [outcome.result[@"reason"] isEqual:reason];
}
static BOOL Rejected(Outcome outcome, NSString *code) { return outcome.calls == 1 && [outcome.code isEqual:code]; }
static NSDictionary *Credential(Outcome outcome) {
  return outcome.calls == 1 && !outcome.code && [outcome.result[@"type"] isEqual:@"success"] ? outcome.result[@"credential"] : nil;
}
// Credentials as AuthenticationServices hands them over (it has no public initializers): only the getters are read.
@interface FakeRegistration : ASAuthorizationPlatformPublicKeyCredentialRegistration @end
@implementation FakeRegistration
- (NSData *)credentialID { const unsigned char raw[] = { 0xfb, 0xff, 0xbf }; return [NSData dataWithBytes:raw length:sizeof raw]; }
- (NSData *)rawClientDataJSON { return [@"{}" dataUsingEncoding:NSUTF8StringEncoding]; }
- (NSData *)rawAttestationObject { return nil; }
- (ASAuthorizationPublicKeyCredentialAttachment)attachment { return ASAuthorizationPublicKeyCredentialAttachmentPlatform; }
- (ASAuthorizationPublicKeyCredentialLargeBlobRegistrationOutput *)largeBlob { return nil; }
- (ASAuthorizationPublicKeyCredentialPRFRegistrationOutput *)prf API_AVAILABLE(macos(15.0)) { return nil; }
@end
@interface FakeBlobRegistration : ASAuthorizationPublicKeyCredentialLargeBlobRegistrationOutput @end
@implementation FakeBlobRegistration
- (BOOL)isSupported { return YES; }
@end
API_AVAILABLE(macos(15.0)) @interface FakePRFRegistration : ASAuthorizationPublicKeyCredentialPRFRegistrationOutput @end
@implementation FakePRFRegistration
- (BOOL)isSupported { return YES; }
- (NSData *)first { return [@"one" dataUsingEncoding:NSUTF8StringEncoding]; }
- (NSData *)second { return nil; }
@end
// A phone's passkey through the sheet (cross-platform), with largeBlob and prf outputs.
@interface FakeHybridRegistration : FakeRegistration @end
@implementation FakeHybridRegistration
- (ASAuthorizationPublicKeyCredentialAttachment)attachment { return ASAuthorizationPublicKeyCredentialAttachmentCrossPlatform; }
- (ASAuthorizationPublicKeyCredentialLargeBlobRegistrationOutput *)largeBlob { return [FakeBlobRegistration alloc]; }
- (ASAuthorizationPublicKeyCredentialPRFRegistrationOutput *)prf API_AVAILABLE(macos(15.0)) { return [FakePRFRegistration alloc]; }
@end
@interface FakeSecurityKeyRegistration : ASAuthorizationSecurityKeyPublicKeyCredentialRegistration @end
@implementation FakeSecurityKeyRegistration
- (NSData *)credentialID { return [@"key" dataUsingEncoding:NSUTF8StringEncoding]; }
- (NSData *)rawClientDataJSON { return [@"{}" dataUsingEncoding:NSUTF8StringEncoding]; }
- (NSData *)rawAttestationObject { return [@"att" dataUsingEncoding:NSUTF8StringEncoding]; }
- (NSArray<ASAuthorizationSecurityKeyPublicKeyCredentialDescriptorTransport> *)transports { return @[ASAuthorizationSecurityKeyPublicKeyCredentialDescriptorTransportNFC, @"smoke-signal", ASAuthorizationSecurityKeyPublicKeyCredentialDescriptorTransportUSB]; }
- (ASAuthorizationPublicKeyCredentialPRFRegistrationOutput *)prf { return nil; }
@end
@interface FakeBlobAssertion : ASAuthorizationPublicKeyCredentialLargeBlobAssertionOutput @end
@implementation FakeBlobAssertion
- (NSData *)readData { return [@"blob" dataUsingEncoding:NSUTF8StringEncoding]; }
- (BOOL)didWrite { return NO; }
@end
@interface FakePlatformAssertion : ASAuthorizationPlatformPublicKeyCredentialAssertion @end
@implementation FakePlatformAssertion
- (NSData *)credentialID { return [@"key" dataUsingEncoding:NSUTF8StringEncoding]; }
- (NSData *)userID { return [@"user-1" dataUsingEncoding:NSUTF8StringEncoding]; }
- (NSData *)rawClientDataJSON { return [@"{}" dataUsingEncoding:NSUTF8StringEncoding]; }
- (NSData *)rawAuthenticatorData { return [@"auth" dataUsingEncoding:NSUTF8StringEncoding]; }
- (NSData *)signature { return [@"sig" dataUsingEncoding:NSUTF8StringEncoding]; }
- (ASAuthorizationPublicKeyCredentialAttachment)attachment { return ASAuthorizationPublicKeyCredentialAttachmentPlatform; }
- (ASAuthorizationPublicKeyCredentialLargeBlobAssertionOutput *)largeBlob { return [FakeBlobAssertion alloc]; }
- (ASAuthorizationPublicKeyCredentialPRFAssertionOutput *)prf API_AVAILABLE(macos(15.0)) { return nil; }
@end
@interface FakeSecurityKeyAssertion : ASAuthorizationSecurityKeyPublicKeyCredentialAssertion @end
@implementation FakeSecurityKeyAssertion
- (NSData *)credentialID { return [@"key" dataUsingEncoding:NSUTF8StringEncoding]; }
- (NSData *)userID { return [@"user-1" dataUsingEncoding:NSUTF8StringEncoding]; }
- (NSData *)rawClientDataJSON { return [@"{}" dataUsingEncoding:NSUTF8StringEncoding]; }
- (NSData *)rawAuthenticatorData { return [@"auth" dataUsingEncoding:NSUTF8StringEncoding]; }
- (NSData *)signature { return [@"sig" dataUsingEncoding:NSUTF8StringEncoding]; }
- (ASAuthorizationPublicKeyCredentialPRFAssertionOutput *)prf { return nil; }
@end
@interface FakeAppleID : ASAuthorizationAppleIDCredential @end
@implementation FakeAppleID
- (NSString *)user { return @"001.user"; }
- (NSString *)state { return nil; }
- (NSArray<ASAuthorizationScope> *)authorizedScopes { return @[ASAuthorizationScopeEmail]; }
- (NSData *)identityToken { return [@"a.b.c" dataUsingEncoding:NSUTF8StringEncoding]; }
- (NSData *)authorizationCode { return nil; }
- (NSString *)email { return @"a@example.com"; }
- (NSPersonNameComponents *)fullName { return [NSPersonNameComponents new]; }
- (ASUserDetectionStatus)realUserStatus { return ASUserDetectionStatusLikelyReal; }
@end
@interface FakeAuthorization : ASAuthorization @end
@implementation FakeAuthorization
- (id<ASAuthorizationCredential>)credential { return [FakeRegistration alloc]; }
@end

static NSString *Encode(NSString *text) { return SparkBase64URLEncode([text dataUsingEncoding:NSUTF8StringEncoding]); }

int main() { @autoreleasepool {
  [NSApplication sharedApplication];
  // Never ordered on screen; it only anchors requests.
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 100, 100) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:YES];
  window.identifier = @"spark.main";

  // Every ASAuthorizationError the SDK names maps to its reason; any other code is unnamed (E_NATIVE).
  NSDictionary<NSNumber *, NSString *> *failures = @{ @(ASAuthorizationErrorUnknown): @"unknown", @(ASAuthorizationErrorCanceled): @"canceled",
    @(ASAuthorizationErrorInvalidResponse): @"invalidResponse", @(ASAuthorizationErrorNotHandled): @"notHandled", @(ASAuthorizationErrorFailed): @"failed",
    @(ASAuthorizationErrorNotInteractive): @"notInteractive", @1006: @"matchedExcludedCredential", @1010: @"deviceNotConfigured" };
  for (NSNumber *code in failures) CHECK([SparkAuthorizationFailure(code.integerValue) isEqual:failures[code]]);
  CHECK(!SparkAuthorizationFailure(1007) && !SparkAuthorizationFailure(1009) && !SparkAuthorizationFailure(0));

  // Entitlements decide availability.
  CHECK(SparkAuthorizationEntitled(@{ @"applesignin": @[@"Default"] }, @"appleId", nil));
  CHECK(!SparkAuthorizationEntitled(@{ @"applesignin": @[] }, @"appleId", nil) && !SparkAuthorizationEntitled(@{}, @"appleId", nil));
  NSDictionary *domains = @{ @"associatedDomains": @[@"applinks:links.example.com", @"webcredentials:example.com", @"webcredentials:dev.example.com?mode=developer"] };
  CHECK(SparkAuthorizationEntitled(domains, @"passkeys", @"example.com") && SparkAuthorizationEntitled(domains, @"passkeys", @"dev.example.com"));
  CHECK(!SparkAuthorizationEntitled(domains, @"passkeys", @"links.example.com") && !SparkAuthorizationEntitled(domains, @"passkeys", @"other.com"));
  CHECK(!SparkAuthorizationEntitled(domains, @"passkeys", nil) && !SparkAuthorizationEntitled(domains, @"appleId", nil) && !SparkAuthorizationEntitled(domains, @"other", @"example.com"));
  CHECK(!SparkAuthorizationProcessEntitlements()[@"applesignin"]); // This test binary is not entitled.

  // base64url without padding, both ways.
  const unsigned char raw[] = { 0xfb, 0xff, 0xbf };
  NSData *bytes = [NSData dataWithBytes:raw length:sizeof raw];
  CHECK([SparkBase64URLEncode(bytes) isEqual:@"-_-_"] && [SparkBase64URLDecode(@"-_-_") isEqual:bytes]);
  CHECK([Encode(@"a") isEqual:@"YQ"] && [SparkBase64URLDecode(@"YQ") isEqual:[@"a" dataUsingEncoding:NSUTF8StringEncoding]]);
  for (id invalid in @[@"", @"YQ==", @"a+b/", @"abcde", @"ab cd", @42]) CHECK(!SparkBase64URLDecode(invalid));

  // Wildcard webcredentials match subdomains only.
  NSDictionary *wildcard = @{ @"associatedDomains": @[@"webcredentials:*.example.com"] };
  CHECK(SparkAuthorizationEntitled(wildcard, @"passkeys", @"login.example.com") && SparkAuthorizationEntitled(wildcard, @"passkeys", @"a.b.example.com"));
  CHECK(!SparkAuthorizationEntitled(wildcard, @"passkeys", @"example.com") && !SparkAuthorizationEntitled(wildcard, @"passkeys", @"badexample.com"));

  // AuthenticationServices' errors: the person's cancel resolves, the app's cancel is appCancel, unnamed errors are E_NATIVE.
  NSError *nativeFailure = nil;
  NSError *canceled = [NSError errorWithDomain:ASAuthorizationErrorDomain code:ASAuthorizationErrorCanceled userInfo:nil];
  CHECK([SparkAuthorizationCompleted(canceled, NO, &nativeFailure) isEqual:@{ @"type": @"cancel" }] && !nativeFailure);
  CHECK([SparkAuthorizationCompleted(canceled, YES, &nativeFailure)[@"reason"] isEqual:@"appCancel"] && !nativeFailure);
  CHECK([SparkAuthorizationCompleted([NSError errorWithDomain:ASAuthorizationErrorDomain code:ASAuthorizationErrorFailed userInfo:nil], YES, &nativeFailure)[@"reason"] isEqual:@"failed"]);
  CHECK(!SparkAuthorizationCompleted([NSError errorWithDomain:ASAuthorizationErrorDomain code:1007 userInfo:nil], NO, &nativeFailure) && [SparkAuthorizationErrorCode(nativeFailure) isEqual:@"E_NATIVE"]);
  nativeFailure = nil;
  CHECK(!SparkAuthorizationCompleted([NSError errorWithDomain:NSURLErrorDomain code:-1 userInfo:nil], NO, &nativeFailure) && [SparkAuthorizationErrorCode(nativeFailure) isEqual:@"E_NATIVE"]);

  // Credentials: binary values as base64url, absent values null.
  CHECK([SparkAuthorizationCredential([FakeRegistration alloc]) isEqual:(@{ @"credentialId": @"-_-_", @"clientDataJSON": @"e30", @"attestationObject": NSNull.null,
    @"authenticatorAttachment": @"platform", @"transports": NSNull.null, @"extensions": @{} })]);
  NSDictionary *hybrid = SparkAuthorizationCredential([FakeHybridRegistration alloc]);
  CHECK([hybrid[@"authenticatorAttachment"] isEqual:@"cross-platform"] && [hybrid[@"extensions"][@"largeBlob"] isEqual:@{ @"supported": @YES }]);
  if (@available(macOS 15.0, *)) CHECK([hybrid[@"extensions"][@"prf"] isEqual:(@{ @"enabled": @YES, @"results": @{ @"first": Encode(@"one") } })]);
  // Security key transports by their WebAuthn names; one this SDK does not name is left out.
  NSDictionary *keyRegistration = SparkAuthorizationCredential([FakeSecurityKeyRegistration alloc]);
  CHECK([keyRegistration[@"authenticatorAttachment"] isEqual:@"cross-platform"] && [keyRegistration[@"extensions"] isEqual:@{}] && [keyRegistration[@"attestationObject"] isEqual:Encode(@"att")]);
  if (@available(macOS 14.5, *)) CHECK([keyRegistration[@"transports"] isEqual:(@[@"nfc", @"usb"])]);
  NSDictionary *platformAssertion = SparkAuthorizationCredential([FakePlatformAssertion alloc]);
  CHECK([platformAssertion isEqual:(@{ @"credentialId": Encode(@"key"), @"userId": Encode(@"user-1"), @"clientDataJSON": @"e30", @"authenticatorData": Encode(@"auth"), @"signature": Encode(@"sig"),
    @"authenticatorAttachment": @"platform", @"extensions": @{ @"largeBlob": @{ @"blob": Encode(@"blob"), @"written": @NO } } })]);
  NSDictionary *keyAssertion = SparkAuthorizationCredential([FakeSecurityKeyAssertion alloc]);
  CHECK([keyAssertion[@"authenticatorAttachment"] isEqual:@"cross-platform"] && [keyAssertion[@"signature"] isEqual:Encode(@"sig")] && [keyAssertion[@"extensions"] isEqual:@{}]);
  NSDictionary *appleCredential = SparkAuthorizationCredential([FakeAppleID alloc]);
  CHECK([appleCredential isEqual:(@{ @"user": @"001.user", @"state": NSNull.null, @"authorizedScopes": @[@"email"], @"identityToken": @"a.b.c", @"authorizationCode": NSNull.null,
    @"email": @"a@example.com", @"fullName": NSNull.null, @"realUserStatus": @"likelyReal" })]);

  // The delegate settles once: later callbacks from the controller are ignored.
  SparkAuthorizationRequest *delegate = [SparkAuthorizationRequest new];
  Outcome settled = {};
  delegate.settle = Record(&settled);
  ASAuthorizationController *controller = [[ASAuthorizationController alloc] initWithAuthorizationRequests:@[[[ASAuthorizationAppleIDProvider new] createRequest]]];
  [delegate authorizationController:controller didCompleteWithError:canceled];
  [delegate authorizationController:controller didCompleteWithAuthorization:[FakeAuthorization alloc]];
  [delegate authorizationController:controller didCompleteWithError:[NSError errorWithDomain:ASAuthorizationErrorDomain code:ASAuthorizationErrorFailed userInfo:nil]];
  CHECK(settled.calls == 1 && [settled.result isEqual:@{ @"type": @"cancel" }]);

  NSString *challenge = Encode(@"a challenge from the server");
  NSDictionary *registration = @{ @"relyingPartyId": @"example.com", @"challenge": challenge, @"userId": Encode(@"user-1"), @"userName": @"ada@example.com" };
  NSDictionary *assertion = @{ @"relyingPartyId": @"example.com", @"challenge": challenge };

  // A real instance: invalid requests fail first, valid ones stop at missingEntitlement; no controller is created.
  SparkAuthorization *real = [[SparkAuthorization alloc] initWithSimulated:NO];
  CHECK(!real.simulated);
  CHECK([[real availability:@"appleId" relyingPartyId:nil passkeyFeature:nil] isEqual:@"missing-entitlement"] && [[real availability:@"passkeys" relyingPartyId:@"example.com" passkeyFeature:nil] isEqual:@"missing-entitlement"]);
  NSArray<NSArray *> *invalid = @[
    @[@"appleId", @{ @"scopes": @[@"phone"] }], @[@"appleId", @{ @"scopes": @[@"email", @"email"] }], @[@"appleId", @{ @"state": @"  " }],
    @[@"createPasskey", @{ @"relyingPartyId": @"Example.com", @"challenge": challenge, @"userId": Encode(@"u"), @"userName": @"ada" }],
    @[@"createPasskey", @{ @"relyingPartyId": @"example.com", @"challenge": Encode(@"short"), @"userId": Encode(@"u"), @"userName": @"ada" }],
    @[@"createPasskey", @{ @"relyingPartyId": @"example.com", @"challenge": challenge, @"userName": @"ada" }],
    @[@"createPasskey", @{ @"relyingPartyId": @"example.com", @"challenge": challenge, @"userId": Encode([@"" stringByPaddingToLength:65 withString:@"u" startingAtIndex:0]), @"userName": @"ada" }],
    @[@"createPasskey", @{ @"relyingPartyId": @"example.com", @"challenge": challenge, @"userId": Encode(@"u"), @"userName": @"ada", @"attestation": @"self" }],
    @[@"getPasskey", @{ @"relyingPartyId": @"example.com", @"challenge": challenge, @"userVerification": @"always" }],
    @[@"getPasskey", @{ @"relyingPartyId": @"example.com", @"challenge": challenge, @"allowCredentials": @[@"not base64!"] }],
    @[@"signIn", @{}],
  ];
  for (NSArray *request in invalid) {
    Outcome outcome = {};
    [real perform:request[0] options:request[1] window:window identifier:@"1" completion:Record(&outcome)];
    CHECK(Rejected(outcome, @"E_INVALID_ARGUMENT"));
  }
  Outcome realApple = {}, realCreate = {}, realGet = {}, realState = {}, badUser = {};
  [real perform:@"appleId" options:@{ @"scopes": @[@"email"] } window:window identifier:@"1" completion:Record(&realApple)];
  [real perform:@"createPasskey" options:registration window:window identifier:@"2" completion:Record(&realCreate)];
  [real perform:@"getPasskey" options:assertion window:window identifier:@"3" completion:Record(&realGet)];
  [real credentialState:@"001234.user" completion:Record(&realState)];
  [real credentialState:@"" completion:Record(&badUser)];
  CHECK(Failed(realApple, @"missingEntitlement") && Failed(realCreate, @"missingEntitlement") && Failed(realGet, @"missingEntitlement") && Failed(realState, @"missingEntitlement"));
  CHECK([realCreate.result[@"message"] containsString:@"webcredentials:example.com"] && Rejected(badUser, @"E_INVALID_ARGUMENT"));
  NSError *refused = nil;
  CHECK(![real simulate:@{ @"answer": @"success" } error:&refused] && [SparkAuthorizationErrorCode(refused) isEqual:@"E_UNAVAILABLE"]);

  // The new options: invalid ones fail first, unsupported ones are refused, valid ones stop at missingEntitlement.
  NSArray<NSArray *> *invalidOptions = @[
    @[@"getPasskey", @{ @"relyingPartyId": @"example.com", @"challenge": challenge, @"authenticatorAttachment": @"hybrid" }],
    @[@"getPasskey", @{ @"relyingPartyId": @"example.com", @"challenge": challenge, @"allowCredentials": @[@{ @"id": Encode(@"key"), @"transports": @[@"usb"] }] }],
    @[@"getPasskey", @{ @"relyingPartyId": @"example.com", @"challenge": challenge, @"authenticatorAttachment": @"any", @"allowCredentials": @[@{ @"id": Encode(@"key"), @"transports": @[@"carrier-pigeon"] }] }],
    @[@"getPasskey", @{ @"relyingPartyId": @"example.com", @"challenge": challenge, @"extensions": @{ @"prf": @{} } }],
    @[@"getPasskey", @{ @"relyingPartyId": @"example.com", @"challenge": challenge, @"extensions": @{ @"largeBlob": @{ @"write": Encode(@"blob") } } }],
    @[@"getPasskey", @{ @"relyingPartyId": @"example.com", @"challenge": challenge, @"preferImmediatelyAvailableCredentials": @"yes" }],
    @[@"createPasskey", @{ @"relyingPartyId": @"example.com", @"challenge": challenge, @"userId": Encode(@"u"), @"userName": @"ada", @"extensions": @{ @"prf": @{ @"eval": @{ @"first": @"" } } } }],
    @[@"getCredential", @{}], @[@"getCredential", @{ @"appleId": @{ @"scopes": @[@"phone"] } }],
  ];
  for (NSArray *request in invalidOptions) {
    Outcome outcome = {};
    [real perform:request[0] options:request[1] window:window identifier:@"1" completion:Record(&outcome)];
    CHECK(Rejected(outcome, @"E_INVALID_ARGUMENT"));
  }
  for (NSDictionary *options in @[@{ @"relyingPartyId": @"example.com", @"challenge": challenge, @"authenticatorAttachment": @"cross-platform", @"extensions": @{ @"largeBlob": @{ @"read": @YES } } },
    @{ @"relyingPartyId": @"example.com", @"challenge": challenge, @"extensions": @{ @"credProps": @YES } }]) {
    Outcome outcome = {};
    [real perform:@"getPasskey" options:options window:window identifier:@"1" completion:Record(&outcome)];
    CHECK(Rejected(outcome, @"E_UNSUPPORTED_OPTION"));
  }
  Outcome realCombined = {}, realKey = {}, realSignal = {}, badSignal = {};
  [real perform:@"getCredential" options:@{ @"passkey": assertion, @"appleId": @{} } window:window identifier:@"1" completion:Record(&realCombined)];
  [real perform:@"getPasskey" options:@{ @"relyingPartyId": @"example.com", @"challenge": challenge, @"authenticatorAttachment": @"cross-platform", @"preferImmediatelyAvailableCredentials": @YES } window:window identifier:@"1" completion:Record(&realKey)];
  [real signal:@"unknownCredential" options:@{ @"relyingPartyId": @"example.com", @"credentialId": Encode(@"key") } completion:Record(&realSignal)];
  [real signal:@"unknownCredential" options:@{ @"relyingPartyId": @"example.com" } completion:Record(&badSignal)];
  CHECK(Failed(realCombined, @"missingEntitlement") && [realCombined.result[@"message"] containsString:@"applesignin"] && Failed(realKey, @"missingEntitlement") && Rejected(badSignal, @"E_INVALID_ARGUMENT"));
  // Signals: missingEntitlement on macOS 26 and later (the Swift class is linked in), E_UNAVAILABLE before.
  CHECK(SparkPasskeyFeatureSupported(@"signals") == !!NSClassFromString(@"SparkCredentialSignals") && (!NSClassFromString(@"SparkCredentialSignals") || [NSClassFromString(@"SparkCredentialSignals") respondsToSelector:@selector(reportCurrentUserDetails:userHandle:name:completion:)]));
  if (@available(macOS 26.0, *)) CHECK(Failed(realSignal, @"missingEntitlement") && SparkPasskeyFeatureSupported(@"signals"));
  else CHECK(Rejected(realSignal, @"E_UNAVAILABLE"));

  // Feature availability follows the macOS version, before the entitlement.
  CHECK(SparkPasskeyFeatureSupported(@"securityKeys") && SparkPasskeyFeatureSupported(@"largeBlob") && !SparkPasskeyFeatureSupported(@"hybrid"));
  if (@available(macOS 15.0, *)) CHECK(SparkPasskeyFeatureSupported(@"prf")); else CHECK(!SparkPasskeyFeatureSupported(@"prf"));
  if (@available(macOS 26.4, *)) CHECK(SparkPasskeyFeatureSupported(@"securityKeyPrf")); else CHECK(!SparkPasskeyFeatureSupported(@"securityKeyPrf"));
  CHECK([[real availability:@"passkeys" relyingPartyId:@"example.com" passkeyFeature:@"securityKeys"] isEqual:@"missing-entitlement"]);
  CHECK([[real availability:@"passkeys" relyingPartyId:@"example.com" passkeyFeature:@"lasers"] isEqual:@"invalid"] && [[real availability:@"appleId" relyingPartyId:nil passkeyFeature:@"prf"] isEqual:@"invalid"]);

  // Each option maps to its AuthenticationServices request; creating them shows nothing.
  NSArray *platformOnly = SparkAuthorizationRequests(@"getPasskey", assertion);
  CHECK(platformOnly.count == 1 && [platformOnly[0] isKindOfClass:ASAuthorizationPlatformPublicKeyCredentialAssertionRequest.class]);
  NSDictionary *anyAssertion = @{ @"relyingPartyId": @"example.com", @"challenge": challenge, @"authenticatorAttachment": @"any", @"userVerification": @"required",
    @"allowCredentials": @[@{ @"id": Encode(@"key"), @"transports": @[@"nfc", @"ble"] }, Encode(@"other")] };
  NSArray *both = SparkAuthorizationRequests(@"getPasskey", anyAssertion);
  CHECK(both.count == 2 && [both[0] isKindOfClass:ASAuthorizationPlatformPublicKeyCredentialAssertionRequest.class] && [both[1] isKindOfClass:ASAuthorizationSecurityKeyPublicKeyCredentialAssertionRequest.class]);
  ASAuthorizationSecurityKeyPublicKeyCredentialAssertionRequest *keyRequest = both[1];
  CHECK([keyRequest.relyingPartyIdentifier isEqual:@"example.com"] && [keyRequest.userVerificationPreference isEqual:ASAuthorizationPublicKeyCredentialUserVerificationPreferenceRequired]);
  CHECK([keyRequest.allowedCredentials[0].transports isEqual:(@[ASAuthorizationSecurityKeyPublicKeyCredentialDescriptorTransportNFC, ASAuthorizationSecurityKeyPublicKeyCredentialDescriptorTransportBluetooth])]);
  CHECK([keyRequest.allowedCredentials[1].transports isEqual:(@[ASAuthorizationSecurityKeyPublicKeyCredentialDescriptorTransportUSB, ASAuthorizationSecurityKeyPublicKeyCredentialDescriptorTransportNFC, ASAuthorizationSecurityKeyPublicKeyCredentialDescriptorTransportBluetooth])] && [keyRequest.allowedCredentials[1].credentialID isEqual:[@"other" dataUsingEncoding:NSUTF8StringEncoding]]);
  CHECK([((ASAuthorizationPlatformPublicKeyCredentialAssertionRequest *)both[0]).allowedCredentials[0].credentialID isEqual:[@"key" dataUsingEncoding:NSUTF8StringEncoding]]);
  NSArray *keyCreation = SparkAuthorizationRequests(@"createPasskey", @{ @"relyingPartyId": @"example.com", @"challenge": challenge, @"userId": Encode(@"user-1"), @"userName": @"ada",
    @"authenticatorAttachment": @"cross-platform", @"attestation": @"direct", @"excludeCredentials": @[Encode(@"old")] });
  CHECK(keyCreation.count == 1 && [keyCreation[0] isKindOfClass:ASAuthorizationSecurityKeyPublicKeyCredentialRegistrationRequest.class]);
  ASAuthorizationSecurityKeyPublicKeyCredentialRegistrationRequest *keyRegistrationRequest = keyCreation[0];
  CHECK([keyRegistrationRequest.name isEqual:@"ada"] && [keyRegistrationRequest.displayName isEqual:@"ada"] && [keyRegistrationRequest.userID isEqual:[@"user-1" dataUsingEncoding:NSUTF8StringEncoding]]);
  CHECK(keyRegistrationRequest.credentialParameters.count == 1 && keyRegistrationRequest.credentialParameters[0].algorithm == ASCOSEAlgorithmIdentifierES256);
  CHECK([keyRegistrationRequest.residentKeyPreference isEqual:ASAuthorizationPublicKeyCredentialResidentKeyPreferenceRequired] && [keyRegistrationRequest.attestationPreference isEqual:ASAuthorizationPublicKeyCredentialAttestationKindDirect]);
  CHECK([keyRegistrationRequest.excludedCredentials[0].credentialID isEqual:[@"old" dataUsingEncoding:NSUTF8StringEncoding]]);
  NSDictionary *blobAssertion = @{ @"relyingPartyId": @"example.com", @"challenge": challenge, @"allowCredentials": @[Encode(@"key")], @"extensions": @{ @"largeBlob": @{ @"write": Encode(@"blob") } } };
  ASAuthorizationPlatformPublicKeyCredentialAssertionRequest *writing = (ASAuthorizationPlatformPublicKeyCredentialAssertionRequest *)SparkAuthorizationRequests(@"getPasskey", blobAssertion)[0];
  CHECK(writing.largeBlob.operation == ASAuthorizationPublicKeyCredentialLargeBlobAssertionOperationWrite && [writing.largeBlob.dataToWrite isEqual:[@"blob" dataUsingEncoding:NSUTF8StringEncoding]]);
  NSMutableDictionary *reading = [assertion mutableCopy];
  reading[@"extensions"] = @{ @"largeBlob": @{ @"read": @YES } };
  CHECK(((ASAuthorizationPlatformPublicKeyCredentialAssertionRequest *)SparkAuthorizationRequests(@"getPasskey", reading)[0]).largeBlob.operation == ASAuthorizationPublicKeyCredentialLargeBlobAssertionOperationRead);
  NSMutableDictionary *blobRegistration = [registration mutableCopy];
  blobRegistration[@"extensions"] = @{ @"largeBlob": @{ @"support": @"required" }, @"prf": @{ @"eval": @{ @"first": Encode(@"salt") } } };
  ASAuthorizationPlatformPublicKeyCredentialRegistrationRequest *blobRequest = (ASAuthorizationPlatformPublicKeyCredentialRegistrationRequest *)SparkAuthorizationRequests(@"createPasskey", blobRegistration)[0];
  CHECK(blobRequest.largeBlob.supportRequirement == ASAuthorizationPublicKeyCredentialLargeBlobSupportRequirementRequired);
  if (@available(macOS 15.0, *)) {
    // The registration request's prf getter rebuilds the input without its values, so only its presence can be read back.
    CHECK(blobRequest.prf && blobRequest.largeBlob);
    NSMutableDictionary *checking = [registration mutableCopy];
    checking[@"extensions"] = @{ @"prf": @{} };
    ASAuthorizationPublicKeyCredentialPRFRegistrationInput *support = ((ASAuthorizationPlatformPublicKeyCredentialRegistrationRequest *)SparkAuthorizationRequests(@"createPasskey", checking)[0]).prf;
    CHECK(support.shouldCheckForSupport);
    NSDictionary *prfAssertion = @{ @"relyingPartyId": @"example.com", @"challenge": challenge, @"allowCredentials": @[Encode(@"key")],
      @"extensions": @{ @"prf": @{ @"eval": @{ @"first": Encode(@"a"), @"second": Encode(@"b") }, @"evalByCredential": @{ Encode(@"key"): @{ @"first": Encode(@"c") } } } } };
    ASAuthorizationPublicKeyCredentialPRFAssertionInput *prfInput = ((ASAuthorizationPlatformPublicKeyCredentialAssertionRequest *)SparkAuthorizationRequests(@"getPasskey", prfAssertion)[0]).prf;
    CHECK([prfInput.inputValues.saltInput2 isEqual:[@"b" dataUsingEncoding:NSUTF8StringEncoding]] && [prfInput.perCredentialInputValues[[@"key" dataUsingEncoding:NSUTF8StringEncoding]].saltInput1 isEqual:[@"c" dataUsingEncoding:NSUTF8StringEncoding]]);
  }
  NSArray *combined = SparkAuthorizationRequests(@"getCredential", @{ @"passkey": anyAssertion, @"appleId": @{ @"scopes": @[@"email"] } });
  CHECK(combined.count == 3 && [combined[2] isKindOfClass:ASAuthorizationAppleIDRequest.class] && [((ASAuthorizationAppleIDRequest *)combined[2]).requestedScopes isEqual:@[ASAuthorizationScopeEmail]]);

  // The simulated instance starts from the binary's real entitlements: none.
  SparkAuthorization *simulated = [[SparkAuthorization alloc] initWithSimulated:YES];
  CHECK(simulated.simulated && [[simulated availability:@"appleId" relyingPartyId:nil passkeyFeature:nil] isEqual:@"missing-entitlement"]);
  CHECK([simulated.simulation[@"requests"] isEqual:@0] && simulated.simulation[@"lastRequest"] == NSNull.null && [simulated.simulation[@"webCredentials"] isEqual:@[]]);
  Outcome unentitled = {};
  [simulated perform:@"appleId" options:@{} window:window identifier:@"1" completion:Record(&unentitled)];
  CHECK(Failed(unentitled, @"missingEntitlement") && [simulated.simulation[@"requests"] isEqual:@0]);
  for (NSDictionary *state in @[@{ @"answer": @"maybe" }, @{ @"appleId": @"yes" }, @{ @"webCredentials": @[@"Example.com"] }, @{ @"credentialState": @"gone" }, @{ @"faceId": @YES }]) {
    NSError *error = nil;
    CHECK(![simulated simulate:state error:&error] && [SparkAuthorizationErrorCode(error) isEqual:@"E_INVALID_ARGUMENT"]);
  }
  CHECK([simulated simulate:@{ @"appleId": @YES, @"webCredentials": @[@"example.com"] } error:nil]);
  CHECK([[simulated availability:@"appleId" relyingPartyId:nil passkeyFeature:nil] isEqual:@"available"] && [[simulated availability:@"passkeys" relyingPartyId:@"example.com" passkeyFeature:nil] isEqual:@"available"]);
  CHECK([[simulated availability:@"passkeys" relyingPartyId:@"other.com" passkeyFeature:nil] isEqual:@"missing-entitlement"]);

  // Without an answer nothing is shown.
  Outcome noAnswer = {};
  [simulated perform:@"appleId" options:@{} window:window identifier:@"1" completion:Record(&noAnswer)];
  Drain();
  CHECK(Rejected(noAnswer, @"E_UNAVAILABLE") && [simulated.simulation[@"requests"] isEqual:@0]);

  // Sign in with Apple: the scopes asked for come back; the state is echoed.
  CHECK([simulated simulate:@{ @"answer": @"success" } error:nil]);
  Outcome apple = {}, plain = {};
  [simulated perform:@"appleId" options:@{ @"scopes": @[@"fullName", @"email"], @"state": @"s1", @"nonce": @"n1" } window:window identifier:@"1" completion:Record(&apple)];
  CHECK(apple.calls == 0 && [simulated.simulation[@"pending"] isEqual:@1]); // Delivered asynchronously, as the real delegate is.
  Drain();
  NSDictionary *credential = Credential(apple);
  CHECK(credential && [credential[@"state"] isEqual:@"s1"] && [credential[@"email"] isEqual:@"simulated@privaterelay.appleid.com"] && [credential[@"fullName"][@"givenName"] isEqual:@"Spark"]);
  CHECK([credential[@"authorizedScopes"] isEqual:(@[@"fullName", @"email"])] && [credential[@"identityToken"] isKindOfClass:NSString.class] && [simulated.simulation[@"pending"] isEqual:@0]);
  NSDictionary *last = simulated.simulation[@"lastRequest"];
  CHECK([last[@"operation"] isEqual:@"appleId"] && [last[@"window"] isEqual:@"spark.main"] && [last[@"scopes"] isEqual:(@[@"fullName", @"email"])]);
  [simulated perform:@"appleId" options:@{} window:window identifier:@"2" completion:Record(&plain)];
  Drain();
  CHECK(Credential(plain)[@"email"] == NSNull.null && Credential(plain)[@"fullName"] == NSNull.null && Credential(plain)[@"state"] == NSNull.null);

  // Credential state: a signed-in user is authorized, others not found, unless the simulation says otherwise.
  Outcome signedIn = {}, stranger = {}, revoked = {};
  [simulated credentialState:credential[@"user"] completion:Record(&signedIn)];
  [simulated credentialState:@"999.other" completion:Record(&stranger)];
  CHECK([signedIn.result isEqual:@"authorized"] && [stranger.result isEqual:@"notFound"]);
  CHECK([simulated simulate:@{ @"credentialState": @"revoked" } error:nil]);
  [simulated credentialState:credential[@"user"] completion:Record(&revoked)];
  CHECK([revoked.result isEqual:@"revoked"] && [simulated simulate:@{ @"credentialState": NSNull.null } error:nil]);

  // The person's cancel resolves; AuthenticationServices' failures are named results.
  for (NSString *answer in @[@"cancel", @"failed", @"notInteractive", @"notHandled", @"invalidResponse", @"unknown", @"deviceNotConfigured"]) {
    CHECK([simulated simulate:@{ @"answer": answer } error:nil]);
    Outcome outcome = {};
    [simulated perform:@"appleId" options:@{} window:window identifier:@"1" completion:Record(&outcome)];
    Drain();
    CHECK([answer isEqual:@"cancel"] ? (outcome.calls == 1 && [outcome.result isEqual:@{ @"type": @"cancel" }]) : Failed(outcome, answer));
  }

  // A request nobody answers stays pending: another is E_BUSY, and cancelling ends the first with appCancel.
  CHECK([simulated simulate:@{ @"answer": @"ignore" } error:nil]);
  Outcome ignored = {}, busy = {};
  [simulated perform:@"appleId" options:@{} window:window identifier:@"1" completion:Record(&ignored)];
  [simulated perform:@"getPasskey" options:assertion window:window identifier:@"2" completion:Record(&busy)];
  Drain();
  CHECK(ignored.calls == 0 && Rejected(busy, @"E_BUSY") && [simulated.simulation[@"pending"] isEqual:@1]);
  [simulated cancel:@"2"];
  [simulated cancel:@"1"];
  [simulated cancel:@"1"];
  Drain();
  CHECK(Failed(ignored, @"appCancel") && [simulated.simulation[@"pending"] isEqual:@0]);

  // Closing the window a request is presented over cancels it (appCancel); once settled, closing it again does nothing.
  NSWindow *other = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 100, 100) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:YES];
  Outcome closed = {}, elsewhere = {};
  [simulated perform:@"appleId" options:@{} window:window identifier:@"1" completion:Record(&closed)];
  [NSNotificationCenter.defaultCenter postNotificationName:NSWindowWillCloseNotification object:other];
  Drain();
  CHECK(closed.calls == 0 && [simulated.simulation[@"pending"] isEqual:@1]);
  [NSNotificationCenter.defaultCenter postNotificationName:NSWindowWillCloseNotification object:window];
  Drain();
  CHECK(Failed(closed, @"appCancel") && [simulated.simulation[@"pending"] isEqual:@0]);
  [simulated perform:@"appleId" options:@{} window:other identifier:@"2" completion:Record(&elsewhere)];
  [NSNotificationCenter.defaultCenter postNotificationName:NSWindowWillCloseNotification object:window];
  Drain();
  CHECK(closed.calls == 1 && elsewhere.calls == 0);
  [simulated cancel:@"2"];
  Drain();
  CHECK(Failed(elsewhere, @"appCancel"));

  // Passkeys: registration stores a simulated passkey that assertion then returns; nothing else answers.
  CHECK([simulated simulate:@{ @"answer": @"success" } error:nil]);
  Outcome none = {}, created = {}, asserted = {}, otherParty = {};
  [simulated perform:@"getPasskey" options:assertion window:window identifier:@"1" completion:Record(&none)];
  Drain();
  CHECK(Rejected(none, @"E_UNAVAILABLE"));
  [simulated perform:@"createPasskey" options:registration window:window identifier:@"1" completion:Record(&created)];
  Drain();
  NSDictionary *passkey = Credential(created);
  CHECK(passkey && SparkBase64URLDecode(passkey[@"credentialId"]) && SparkBase64URLDecode(passkey[@"attestationObject"]));
  NSDictionary *client = [NSJSONSerialization JSONObjectWithData:SparkBase64URLDecode(passkey[@"clientDataJSON"]) options:0 error:nil];
  CHECK([client isEqual:(@{ @"type": @"webauthn.create", @"challenge": challenge, @"origin": @"https://example.com" })]);
  CHECK([simulated.simulation[@"passkeys"] isEqual:(@[@{ @"relyingPartyId": @"example.com", @"credentialId": passkey[@"credentialId"], @"userName": @"ada@example.com", @"authenticatorAttachment": @"platform" }])]);
  CHECK([simulated.simulation[@"lastRequest"][@"userName"] isEqual:@"ada@example.com"] && [simulated.simulation[@"lastRequest"][@"relyingPartyId"] isEqual:@"example.com"]);
  NSMutableDictionary *allowed = [assertion mutableCopy];
  allowed[@"allowCredentials"] = @[passkey[@"credentialId"]];
  [simulated perform:@"getPasskey" options:allowed window:window identifier:@"1" completion:Record(&asserted)];
  Drain();
  NSDictionary *signedWith = Credential(asserted);
  CHECK([signedWith[@"credentialId"] isEqual:passkey[@"credentialId"]] && [signedWith[@"userId"] isEqual:Encode(@"user-1")] && SparkBase64URLDecode(signedWith[@"signature"]));
  CHECK([[NSJSONSerialization JSONObjectWithData:SparkBase64URLDecode(signedWith[@"clientDataJSON"]) options:0 error:nil][@"type"] isEqual:@"webauthn.get"]);
  CHECK([simulated simulate:@{ @"webCredentials": @[@"example.com", @"other.com"] } error:nil]);
  [simulated perform:@"getPasskey" options:@{ @"relyingPartyId": @"other.com", @"challenge": challenge } window:window identifier:@"1" completion:Record(&otherParty)];
  Drain();
  CHECK(Rejected(otherParty, @"E_UNAVAILABLE"));
  if (@available(macOS 15.0, *)) {
    Outcome excluded = {};
    NSMutableDictionary *again = [registration mutableCopy];
    again[@"excludeCredentials"] = @[passkey[@"credentialId"]];
    [simulated perform:@"createPasskey" options:again window:window identifier:@"1" completion:Record(&excluded)];
    Drain();
    CHECK(Failed(excluded, @"matchedExcludedCredential") && [simulated.simulation[@"passkeys"] count] == 1);
  }
  CHECK([simulated simulate:@{ @"appleId": @NO, @"webCredentials": @[] } error:nil]);
  CHECK([[simulated availability:@"appleId" relyingPartyId:nil passkeyFeature:nil] isEqual:@"missing-entitlement"] && [[simulated availability:@"passkeys" relyingPartyId:@"example.com" passkeyFeature:nil] isEqual:@"missing-entitlement"]);

  // Security keys, choices, immediate requests, combined requests, extensions and signals (simulated).
  CHECK([simulated simulate:@{ @"appleId": @YES, @"webCredentials": @[@"example.com"], @"answer": @"success", @"choice": NSNull.null } error:nil]);
  NSArray *initialUnavailable = simulated.simulation[@"unavailableFeatures"];
  for (NSString *feature in SparkPasskeyFeatures) CHECK([initialUnavailable containsObject:feature] == !SparkPasskeyFeatureSupported(feature));
  NSMutableDictionary *keyOptions = [registration mutableCopy];
  keyOptions[@"authenticatorAttachment"] = @"cross-platform";
  Outcome keyCreated = {};
  [simulated perform:@"createPasskey" options:keyOptions window:window identifier:@"1" completion:Record(&keyCreated)];
  Drain();
  NSDictionary *key = Credential(keyCreated);
  CHECK([key[@"authenticatorAttachment"] isEqual:@"cross-platform"] && [key[@"transports"] isEqual:@[@"usb"]] && [simulated.simulation[@"lastRequest"][@"offered"] isEqual:@[@"securityKey"]]);
  CHECK([[simulated.simulation[@"passkeys"] lastObject][@"authenticatorAttachment"] isEqual:@"cross-platform"]);
  // A platform request does not find the security key's passkey; a cross-platform one does.
  NSMutableDictionary *keyAssertionOptions = [assertion mutableCopy];
  keyAssertionOptions[@"allowCredentials"] = @[@{ @"id": key[@"credentialId"], @"transports": @[@"usb"] }];
  Outcome platformMiss = {}, keyHit = {};
  [simulated perform:@"getPasskey" options:keyAssertionOptions window:window identifier:@"1" completion:Record(&platformMiss)];
  Drain();
  CHECK(Rejected(platformMiss, @"E_INVALID_ARGUMENT")); // transports need cross-platform or any
  keyAssertionOptions[@"authenticatorAttachment"] = @"any";
  CHECK([simulated simulate:@{ @"choice": @"securityKey" } error:nil]);
  [simulated perform:@"getPasskey" options:keyAssertionOptions window:window identifier:@"1" completion:Record(&keyHit)];
  Drain();
  CHECK([Credential(keyHit)[@"credentialId"] isEqual:key[@"credentialId"]] && [Credential(keyHit)[@"authenticatorAttachment"] isEqual:@"cross-platform"]);
  CHECK([simulated.simulation[@"lastRequest"][@"offered"] isEqual:(@[@"platform", @"securityKey"])] && [simulated.simulation[@"lastRequest"][@"authenticatorAttachment"] isEqual:@"any"]);
  // A choice the sheet does not offer is refused, never answered by something else.
  Outcome notOffered = {};
  [simulated perform:@"getPasskey" options:assertion window:window identifier:@"1" completion:Record(&notOffered)];
  Drain();
  CHECK(Rejected(notOffered, @"E_UNAVAILABLE"));
  CHECK([simulated simulate:@{ @"choice": NSNull.null } error:nil]);

  // preferImmediatelyAvailableCredentials: nothing on this Mac for other.com means no sheet and a cancel.
  NSInteger shown = [simulated.simulation[@"requests"] integerValue];
  Outcome immediateNone = {}, immediateFound = {};
  CHECK([simulated simulate:@{ @"webCredentials": @[@"example.com", @"other.com"] } error:nil]);
  [simulated perform:@"getPasskey" options:@{ @"relyingPartyId": @"other.com", @"challenge": challenge, @"preferImmediatelyAvailableCredentials": @YES, @"authenticatorAttachment": @"any" } window:window identifier:@"1" completion:Record(&immediateNone)];
  Drain();
  CHECK(immediateNone.calls == 1 && [immediateNone.result isEqual:@{ @"type": @"cancel" }] && [simulated.simulation[@"requests"] integerValue] == shown);
  CHECK([simulated.simulation[@"lastRequest"][@"preferImmediatelyAvailableCredentials"] isEqual:@YES] && [simulated.simulation[@"pending"] isEqual:@0]);
  [simulated perform:@"getPasskey" options:@{ @"relyingPartyId": @"example.com", @"challenge": challenge, @"preferImmediatelyAvailableCredentials": @YES } window:window identifier:@"1" completion:Record(&immediateFound)];
  Drain();
  CHECK([Credential(immediateFound)[@"credentialId"] isEqual:passkey[@"credentialId"]] && [simulated.simulation[@"requests"] integerValue] == shown + 1);

  // getCredential: one sheet; the person picks the passkey (first offered) or Sign in with Apple.
  Outcome combinedPasskey = {}, combinedApple = {}, combinedUnentitled = {};
  [simulated perform:@"getCredential" options:@{ @"passkey": assertion, @"appleId": @{ @"scopes": @[@"email"] } } window:window identifier:@"1" completion:Record(&combinedPasskey)];
  Drain();
  CHECK([Credential(combinedPasskey)[@"credentialId"] isEqual:passkey[@"credentialId"]] && [simulated.simulation[@"lastRequest"][@"offered"] isEqual:(@[@"platform", @"appleId"])]);
  CHECK([simulated simulate:@{ @"choice": @"appleId" } error:nil]);
  [simulated perform:@"getCredential" options:@{ @"passkey": assertion, @"appleId": @{ @"scopes": @[@"email"] } } window:window identifier:@"1" completion:Record(&combinedApple)];
  Drain();
  CHECK([Credential(combinedApple)[@"email"] isEqual:@"simulated@privaterelay.appleid.com"] && [simulated.simulation[@"lastRequest"][@"operation"] isEqual:@"getCredential"]);
  CHECK([simulated simulate:@{ @"choice": NSNull.null, @"appleId": @NO } error:nil]);
  [simulated perform:@"getCredential" options:@{ @"passkey": assertion, @"appleId": @{} } window:window identifier:@"1" completion:Record(&combinedUnentitled)];
  Drain();
  CHECK(Failed(combinedUnentitled, @"missingEntitlement"));
  CHECK([simulated simulate:@{ @"appleId": @YES } error:nil]);

  // Extensions: prf and largeBlob outputs, stored with the simulated passkey.
  Outcome extended = {}, wrote = {}, read = {}, prfAsserted = {};
  [simulated perform:@"createPasskey" options:blobRegistration window:window identifier:@"1" completion:Record(&extended)];
  Drain();
  NSDictionary *extendedKey = Credential(extended);
  CHECK([extendedKey[@"extensions"][@"largeBlob"] isEqual:@{ @"supported": @YES }] && [extendedKey[@"extensions"][@"prf"][@"enabled"] isEqual:@YES] && extendedKey[@"extensions"][@"prf"][@"results"][@"first"]);
  CHECK([simulated.simulation[@"lastRequest"][@"extensions"] isEqual:(@[@"largeBlob", @"prf"])]);
  NSDictionary *writeOptions = @{ @"relyingPartyId": @"example.com", @"challenge": challenge, @"allowCredentials": @[extendedKey[@"credentialId"]], @"extensions": @{ @"largeBlob": @{ @"write": Encode(@"blob") } } };
  [simulated perform:@"getPasskey" options:writeOptions window:window identifier:@"1" completion:Record(&wrote)];
  Drain();
  CHECK([Credential(wrote)[@"extensions"][@"largeBlob"] isEqual:(@{ @"blob": NSNull.null, @"written": @YES })]);
  [simulated perform:@"getPasskey" options:@{ @"relyingPartyId": @"example.com", @"challenge": challenge, @"allowCredentials": @[extendedKey[@"credentialId"]], @"extensions": @{ @"largeBlob": @{ @"read": @YES } } } window:window identifier:@"1" completion:Record(&read)];
  Drain();
  CHECK([Credential(read)[@"extensions"][@"largeBlob"] isEqual:(@{ @"blob": Encode(@"blob"), @"written": @NO })]);
  NSDictionary *prfOptions = @{ @"relyingPartyId": @"example.com", @"challenge": challenge, @"allowCredentials": @[extendedKey[@"credentialId"]], @"extensions": @{ @"prf": @{ @"eval": @{ @"first": Encode(@"salt") } } } };
  [simulated perform:@"getPasskey" options:prfOptions window:window identifier:@"1" completion:Record(&prfAsserted)];
  Drain();
  CHECK([Credential(prfAsserted)[@"extensions"][@"prf"][@"results"][@"first"] isEqual:extendedKey[@"extensions"][@"prf"][@"results"][@"first"]]); // Same credential and salt, same output.

  // A feature the simulated macOS lacks: host-restriction, and its option is E_UNSUPPORTED_OPTION, never dropped.
  CHECK([simulated simulate:@{ @"unavailableFeatures": @[@"prf", @"securityKeyPrf", @"signals"] } error:nil]);
  CHECK([[simulated availability:@"passkeys" relyingPartyId:@"example.com" passkeyFeature:@"prf"] isEqual:@"host-restriction"] && [[simulated availability:@"passkeys" relyingPartyId:@"example.com" passkeyFeature:@"largeBlob"] isEqual:@"available"]);
  CHECK([[simulated availability:@"passkeys" relyingPartyId:@"nowhere.com" passkeyFeature:@"signals"] isEqual:@"host-restriction"]);
  Outcome prfRefused = {}, signalRefused = {};
  [simulated perform:@"getPasskey" options:prfOptions window:window identifier:@"1" completion:Record(&prfRefused)];
  [simulated signal:@"unknownCredential" options:@{ @"relyingPartyId": @"example.com", @"credentialId": passkey[@"credentialId"] } completion:Record(&signalRefused)];
  Drain();
  CHECK(Rejected(prfRefused, @"E_UNSUPPORTED_OPTION") && Rejected(signalRefused, @"E_UNAVAILABLE"));
  CHECK([simulated simulate:@{ @"unavailableFeatures": @[@"securityKeyPrf"] } error:nil]);
  NSMutableDictionary *keyPrf = [prfOptions mutableCopy];
  keyPrf[@"authenticatorAttachment"] = @"cross-platform";
  Outcome keyPrfRefused = {};
  [simulated perform:@"getPasskey" options:keyPrf window:window identifier:@"1" completion:Record(&keyPrfRefused)];
  Drain();
  CHECK(Rejected(keyPrfRefused, @"E_UNSUPPORTED_OPTION"));
  for (NSDictionary *state in @[@{ @"unavailableFeatures": @[@"hybrid"] }, @{ @"choice": @"password" }]) {
    NSError *error = nil;
    CHECK(![simulated simulate:state error:&error] && [SparkAuthorizationErrorCode(error) isEqual:@"E_INVALID_ARGUMENT"]);
  }

  // Signals change the simulated passkeys as a credential manager would.
  CHECK([simulated simulate:@{ @"unavailableFeatures": @[] } error:nil]);
  NSUInteger before = [simulated.simulation[@"passkeys"] count];
  Outcome renamed = {}, unknownSignal = {}, accepted = {}, unentitledSignal = {};
  [simulated signal:@"currentUserDetails" options:@{ @"relyingPartyId": @"example.com", @"userId": Encode(@"user-1"), @"name": @"ada@example.org" } completion:Record(&renamed)];
  CHECK(renamed.calls == 1 && renamed.result == NSNull.null && [[simulated.simulation[@"passkeys"] valueForKey:@"userName"] containsObject:@"ada@example.org"]);
  [simulated signal:@"unknownCredential" options:@{ @"relyingPartyId": @"example.com", @"credentialId": key[@"credentialId"] } completion:Record(&unknownSignal)];
  CHECK(unknownSignal.result == NSNull.null && [simulated.simulation[@"passkeys"] count] == before - 1);
  [simulated signal:@"allAcceptedCredentials" options:@{ @"relyingPartyId": @"example.com", @"userId": Encode(@"user-1"), @"allAcceptedCredentialIds": @[passkey[@"credentialId"]] } completion:Record(&accepted)];
  CHECK([[simulated.simulation[@"passkeys"] valueForKey:@"credentialId"] isEqual:@[passkey[@"credentialId"]]]);
  [simulated signal:@"unknownCredential" options:@{ @"relyingPartyId": @"nowhere.com", @"credentialId": key[@"credentialId"] } completion:Record(&unentitledSignal)];
  CHECK(Failed(unentitledSignal, @"missingEntitlement") && [simulated.simulation[@"signals"] count] == 3 && [[simulated.simulation[@"signals"] lastObject][@"kind"] isEqual:@"allAcceptedCredentials"]);

  // Availability may be read from any thread while the main thread changes the simulation.
  dispatch_group_t group = dispatch_group_create();
  for (int i = 0; i < 4; i++) dispatch_group_async(group, dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0), ^{
    for (int j = 0; j < 500; j++) CHECK([simulated availability:@"passkeys" relyingPartyId:@"example.com" passkeyFeature:nil].length > 0);
  });
  for (int j = 0; j < 200; j++) [simulated simulate:@{ @"webCredentials": j % 2 ? @[@"example.com"] : @[] } error:nil];
  dispatch_group_wait(group, DISPATCH_TIME_FOREVER);

  printf("Authentication native tests passed\n");
} return 0; }
