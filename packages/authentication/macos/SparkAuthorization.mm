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

// SparkCredentialSignals.swift: AuthenticationServices offers the signals to Swift only, so this file reaches them by name.
@protocol SparkCredentialSignaling <NSObject>
+ (BOOL)supported;
+ (void)reportUnknownCredential:(NSString *)relyingParty credentialID:(NSData *)credentialID completion:(void (^)(NSError *_Nullable))completion;
+ (void)reportAllAcceptedCredentials:(NSString *)relyingParty userHandle:(NSData *)userHandle acceptedCredentialIDs:(NSArray<NSData *> *)credentialIDs completion:(void (^)(NSError *_Nullable))completion;
+ (void)reportCurrentUserDetails:(NSString *)relyingParty userHandle:(NSData *)userHandle name:(NSString *)name completion:(void (^)(NSError *_Nullable))completion;
@end
static Class<SparkCredentialSignaling> SignalsClass(void) { return (Class<SparkCredentialSignaling>)NSClassFromString(@"SparkCredentialSignals"); }

// Security keys' prf (macOS 26.4) is declared only by the macOS 26.4 SDK and later.
#define SPARK_SECURITY_KEY_PRF (__MAC_OS_X_VERSION_MAX_ALLOWED >= 260400)

NSArray<NSString *> *const SparkPasskeyFeatures = @[@"securityKeys", @"prf", @"securityKeyPrf", @"largeBlob", @"signals"];
BOOL SparkPasskeyFeatureSupported(NSString *feature) {
  if ([feature isEqual:@"securityKeys"] || [feature isEqual:@"largeBlob"]) return YES; // macOS 12 and 14; Spark needs 14.
  if ([feature isEqual:@"prf"]) { if (@available(macOS 15.0, *)) return YES; return NO; }
#if SPARK_SECURITY_KEY_PRF
  if ([feature isEqual:@"securityKeyPrf"]) { if (@available(macOS 26.4, *)) return YES; return NO; }
#endif
  if ([feature isEqual:@"signals"]) return [SignalsClass() supported];
  return NO;
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
static NSArray<NSString *> *const Operations = @[@"appleId", @"createPasskey", @"getPasskey", @"getCredential"];
static NSArray<NSString *> *const Verifications = @[@"required", @"preferred", @"discouraged"];
static NSArray<NSString *> *const Attestations = @[@"none", @"direct", @"indirect", @"enterprise"];
static NSArray<NSString *> *const Attachments = @[@"platform", @"cross-platform", @"any"];
static NSArray<NSString *> *const Transports = @[@"usb", @"nfc", @"ble"];

// platform (the default): this Mac's passkeys (and a phone's, through the sheet); cross-platform: a security key; any: both.
static NSString *Attachment(NSDictionary *options) { return options[@"authenticatorAttachment"] ?: @"platform"; }
static BOOL UsesPlatform(NSString *attachment) { return ![attachment isEqual:@"cross-platform"]; }
static BOOL UsesSecurityKeys(NSString *attachment) { return ![attachment isEqual:@"platform"]; }

// At most 64 credentials, each a base64url ID or { id, transports } (usb, nfc, ble: security keys only).
static BOOL Credentials(id value, BOOL securityKeys) {
  if (!value) return YES;
  if (![value isKindOfClass:NSArray.class] || [value count] > 64) return NO;
  for (id item in value) {
    if (![item isKindOfClass:NSDictionary.class]) { if (!Bytes(item, 1, 1023)) return NO; continue; }
    id transports = item[@"transports"];
    if (!Bytes(item[@"id"], 1, 1023)) return NO;
    if (!transports) continue;
    if (!securityKeys || ![transports isKindOfClass:NSArray.class] || ![transports count] || [NSSet setWithArray:transports].count != [transports count]) return NO;
    for (id transport in transports) if (![Transports containsObject:transport]) return NO;
  }
  return YES;
}
static NSString *CredentialID(id item) { return [item isKindOfClass:NSDictionary.class] ? item[@"id"] : item; }
static NSArray<NSString *> *CredentialIDs(NSArray *items) {
  NSMutableArray *ids = [NSMutableArray array];
  for (id item in items) [ids addObject:CredentialID(item)];
  return ids;
}
static BOOL Salts(id value) {
  return [value isKindOfClass:NSDictionary.class] && Bytes(value[@"first"], 1, 1024) && (!value[@"second"] || Bytes(value[@"second"], 1, 1024));
}

// WebAuthn's prf and largeBlob extensions, in their JSON shapes. largeBlob is for platform passkeys only:
// AuthenticationServices has no largeBlob for security keys, so asking for one with them is an unsupported option.
static NSError *ValidateExtensions(BOOL registration, NSDictionary *options) {
  id extensions = options[@"extensions"];
  if (!extensions) return nil;
  if (![extensions isKindOfClass:NSDictionary.class]) return Failure(@"E_INVALID_ARGUMENT", @"extensions is an object");
  for (NSString *name in extensions) if (![@[@"prf", @"largeBlob"] containsObject:name]) return Failure(@"E_UNSUPPORTED_OPTION", [NSString stringWithFormat:@"Unsupported passkey extension: %@", name]);
  id prf = extensions[@"prf"], blob = extensions[@"largeBlob"];
  if (prf) {
    BOOL valid = [prf isKindOfClass:NSDictionary.class] && (!prf[@"eval"] || Salts(prf[@"eval"]));
    id byCredential = valid ? prf[@"evalByCredential"] : nil;
    if (valid && !registration) valid = prf[@"eval"] || byCredential;
    if (valid && byCredential) {
      NSArray *allowed = CredentialIDs(options[@"allowCredentials"] ?: @[]);
      valid = !registration && [byCredential isKindOfClass:NSDictionary.class] && [byCredential count];
      for (id credential in valid ? byCredential : @{}) valid = valid && [allowed containsObject:credential] && Salts(byCredential[credential]);
    }
    if (!valid) return Failure(@"E_INVALID_ARGUMENT", registration ? @"prf is {} or { eval: { first, second? } } with 1–1024-byte base64url salts"
      : @"prf has eval and/or evalByCredential (keyed by credential IDs in allowCredentials), with 1–1024-byte base64url salts");
  }
  if (blob) {
    BOOL valid = [blob isKindOfClass:NSDictionary.class] && (registration ? [@[@"required", @"preferred"] containsObject:blob[@"support"] ?: @""]
      : (!blob[@"read"] != !blob[@"write"]) && (!blob[@"read"] || [blob[@"read"] isEqual:@YES]) && (!blob[@"write"] || (Bytes(blob[@"write"], 1, 65536) && [options[@"allowCredentials"] count])));
    if (!valid) return Failure(@"E_INVALID_ARGUMENT", registration ? @"largeBlob is { support: required or preferred }" : @"largeBlob is { read: true }, or { write } of 1–65536 bytes with allowCredentials");
    if (![Attachment(options) isEqual:@"platform"]) return Failure(@"E_UNSUPPORTED_OPTION", @"largeBlob is for platform passkeys (authenticatorAttachment platform); AuthenticationServices has none for security keys");
  }
  return nil;
}

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
  if (options[@"preferImmediatelyAvailableCredentials"] && ![options[@"preferImmediatelyAvailableCredentials"] isKindOfClass:NSNumber.class]) return Failure(@"E_INVALID_ARGUMENT", @"preferImmediatelyAvailableCredentials is a boolean");
  if ([operation isEqual:@"getCredential"]) {
    id passkey = options[@"passkey"], apple = options[@"appleId"];
    if ((!passkey && !apple) || (passkey && ![passkey isKindOfClass:NSDictionary.class]) || (apple && ![apple isKindOfClass:NSDictionary.class])) return Failure(@"E_INVALID_ARGUMENT", @"getCredential takes passkey and/or appleId options");
    NSError *invalid = passkey ? Validate(@"getPasskey", passkey) : nil;
    return invalid ?: apple ? Validate(@"appleId", apple) : nil;
  }
  if (!RelyingParty(options[@"relyingPartyId"])) return Failure(@"E_INVALID_ARGUMENT", @"relyingPartyId is a lowercase domain name such as example.com");
  if (!Bytes(options[@"challenge"], 16, 1024)) return Failure(@"E_INVALID_ARGUMENT", @"challenge is 16–1024 bytes as unpadded base64url");
  if (options[@"userVerification"] && ![Verifications containsObject:options[@"userVerification"]]) return Failure(@"E_INVALID_ARGUMENT", @"userVerification is required, preferred or discouraged");
  if (options[@"authenticatorAttachment"] && ![Attachments containsObject:options[@"authenticatorAttachment"]]) return Failure(@"E_INVALID_ARGUMENT", @"authenticatorAttachment is platform, cross-platform or any");
  BOOL securityKeys = UsesSecurityKeys(Attachment(options));
  if ([operation isEqual:@"getPasskey"]) {
    if (!Credentials(options[@"allowCredentials"], securityKeys)) return Failure(@"E_INVALID_ARGUMENT", @"allowCredentials lists at most 64 base64url credential IDs, or { id, transports } (usb, nfc, ble) for security keys");
    return ValidateExtensions(NO, options);
  }
  if (!Bytes(options[@"userId"], 1, 64)) return Failure(@"E_INVALID_ARGUMENT", @"userId is 1–64 bytes as unpadded base64url");
  if (!String(options[@"userName"], 256)) return Failure(@"E_INVALID_ARGUMENT", @"userName is 1–256 characters");
  if (options[@"displayName"] && !String(options[@"displayName"], 256)) return Failure(@"E_INVALID_ARGUMENT", @"displayName is 1–256 characters");
  if (options[@"attestation"] && ![Attestations containsObject:options[@"attestation"]]) return Failure(@"E_INVALID_ARGUMENT", @"attestation is none, direct, indirect or enterprise");
  if (!Credentials(options[@"excludeCredentials"], securityKeys)) return Failure(@"E_INVALID_ARGUMENT", @"excludeCredentials lists at most 64 base64url credential IDs, or { id, transports } (usb, nfc, ble) for security keys");
  if (options[@"excludeCredentials"] && UsesPlatform(Attachment(options))) {
    if (@available(macOS 15.0, *)) {} else return Failure(@"E_UNAVAILABLE", @"excludeCredentials needs macOS 15");
  }
  return ValidateExtensions(YES, options);
}

static NSArray<NSString *> *const SignalKinds = @[@"unknownCredential", @"allAcceptedCredentials", @"currentUserDetails"];
static NSError *ValidateSignal(NSString *kind, NSDictionary *options) {
  if (![SignalKinds containsObject:kind]) return Failure(@"E_INVALID_ARGUMENT", @"Unknown credential signal");
  if (!RelyingParty(options[@"relyingPartyId"])) return Failure(@"E_INVALID_ARGUMENT", @"relyingPartyId is a lowercase domain name such as example.com");
  if ([kind isEqual:@"unknownCredential"]) return Bytes(options[@"credentialId"], 1, 1023) ? nil : Failure(@"E_INVALID_ARGUMENT", @"credentialId is 1–1023 bytes as unpadded base64url");
  if (!Bytes(options[@"userId"], 1, 64)) return Failure(@"E_INVALID_ARGUMENT", @"userId is 1–64 bytes as unpadded base64url");
  if ([kind isEqual:@"currentUserDetails"]) return String(options[@"name"], 256) ? nil : Failure(@"E_INVALID_ARGUMENT", @"name is 1–256 characters");
  id accepted = options[@"allAcceptedCredentialIds"];
  BOOL valid = [accepted isKindOfClass:NSArray.class] && [accepted count] <= 1024;
  for (id credential in valid ? accepted : @[]) valid = valid && Bytes(credential, 1, 1023);
  return valid ? nil : Failure(@"E_INVALID_ARGUMENT", @"allAcceptedCredentialIds lists at most 1024 base64url credential IDs");
}

#pragma mark Requests

static NSArray<ASAuthorizationPlatformPublicKeyCredentialDescriptor *> *PlatformDescriptors(NSArray *items) {
  NSMutableArray *descriptors = [NSMutableArray array];
  for (id item in items) [descriptors addObject:[[ASAuthorizationPlatformPublicKeyCredentialDescriptor alloc] initWithCredentialID:SparkBase64URLDecode(CredentialID(item))]];
  return descriptors;
}
static ASAuthorizationSecurityKeyPublicKeyCredentialDescriptorTransport Transport(NSString *name) {
  return [name isEqual:@"usb"] ? ASAuthorizationSecurityKeyPublicKeyCredentialDescriptorTransportUSB
    : [name isEqual:@"nfc"] ? ASAuthorizationSecurityKeyPublicKeyCredentialDescriptorTransportNFC : ASAuthorizationSecurityKeyPublicKeyCredentialDescriptorTransportBluetooth;
}
// A descriptor without transports may be reached over any of them. (ASAuthorizationAllSupportedPublicKeyCredentialDescriptorTransports
// is declared without C linkage for Objective-C++, so it cannot be linked from this file.)
static NSArray<ASAuthorizationSecurityKeyPublicKeyCredentialDescriptorTransport> *AllTransports(void) {
  return @[ASAuthorizationSecurityKeyPublicKeyCredentialDescriptorTransportUSB, ASAuthorizationSecurityKeyPublicKeyCredentialDescriptorTransportNFC, ASAuthorizationSecurityKeyPublicKeyCredentialDescriptorTransportBluetooth];
}
static NSArray<ASAuthorizationSecurityKeyPublicKeyCredentialDescriptor *> *SecurityKeyDescriptors(NSArray *items) {
  NSMutableArray *descriptors = [NSMutableArray array];
  for (id item in items) {
    NSMutableArray *transports = [NSMutableArray array];
    for (NSString *name in [item isKindOfClass:NSDictionary.class] ? item[@"transports"] : nil) [transports addObject:Transport(name)];
    [descriptors addObject:[[ASAuthorizationSecurityKeyPublicKeyCredentialDescriptor alloc] initWithCredentialID:SparkBase64URLDecode(CredentialID(item))
      transports:transports.count ? transports : AllTransports()]];
  }
  return descriptors;
}
static ASAuthorizationPublicKeyCredentialUserVerificationPreference Verification(NSString *value) {
  if ([value isEqual:@"required"]) return ASAuthorizationPublicKeyCredentialUserVerificationPreferenceRequired;
  if ([value isEqual:@"discouraged"]) return ASAuthorizationPublicKeyCredentialUserVerificationPreferenceDiscouraged;
  return ASAuthorizationPublicKeyCredentialUserVerificationPreferencePreferred;
}
static ASAuthorizationPublicKeyCredentialAttestationKind Attestation(NSString *value) {
  return [value isEqual:@"direct"] ? ASAuthorizationPublicKeyCredentialAttestationKindDirect
    : [value isEqual:@"indirect"] ? ASAuthorizationPublicKeyCredentialAttestationKindIndirect
    : [value isEqual:@"enterprise"] ? ASAuthorizationPublicKeyCredentialAttestationKindEnterprise : ASAuthorizationPublicKeyCredentialAttestationKindNone;
}
API_AVAILABLE(macos(15.0)) static ASAuthorizationPublicKeyCredentialPRFAssertionInputValues *PRFValues(NSDictionary *salts) {
  if (!salts) return nil;
  return [[ASAuthorizationPublicKeyCredentialPRFAssertionInputValues alloc] initWithSaltInput1:SparkBase64URLDecode(salts[@"first"]) saltInput2:salts[@"second"] ? SparkBase64URLDecode(salts[@"second"]) : nil];
}
API_AVAILABLE(macos(15.0)) static ASAuthorizationPublicKeyCredentialPRFRegistrationInput *PRFRegistration(NSDictionary *prf) {
  return prf[@"eval"] ? [[ASAuthorizationPublicKeyCredentialPRFRegistrationInput alloc] initWithInputValues:PRFValues(prf[@"eval"])] : [ASAuthorizationPublicKeyCredentialPRFRegistrationInput checkForSupport];
}
API_AVAILABLE(macos(15.0)) static ASAuthorizationPublicKeyCredentialPRFAssertionInput *PRFAssertion(NSDictionary *prf) {
  NSMutableDictionary *byCredential = nil;
  if (prf[@"evalByCredential"]) {
    byCredential = [NSMutableDictionary dictionary];
    for (NSString *credential in prf[@"evalByCredential"]) byCredential[SparkBase64URLDecode(credential)] = PRFValues(prf[@"evalByCredential"][credential]);
  }
  return [[ASAuthorizationPublicKeyCredentialPRFAssertionInput alloc] initWithInputValues:PRFValues(prf[@"eval"]) perCredentialInputValues:byCredential];
}

static ASAuthorizationAppleIDRequest *AppleIDRequest(NSDictionary *options) {
  ASAuthorizationAppleIDRequest *request = [[ASAuthorizationAppleIDProvider new] createRequest];
  NSMutableArray *scopes = [NSMutableArray array];
  for (NSString *scope in options[@"scopes"] ?: @[]) [scopes addObject:[scope isEqual:@"email"] ? ASAuthorizationScopeEmail : ASAuthorizationScopeFullName];
  request.requestedScopes = scopes;
  request.state = options[@"state"];
  request.nonce = options[@"nonce"];
  return request;
}

NSArray<ASAuthorizationRequest *> *SparkAuthorizationRequests(NSString *operation, NSDictionary *options) {
  if ([operation isEqual:@"appleId"]) return @[AppleIDRequest(options)];
  if ([operation isEqual:@"getCredential"]) {
    NSMutableArray *requests = [NSMutableArray arrayWithArray:options[@"passkey"] ? SparkAuthorizationRequests(@"getPasskey", options[@"passkey"]) : @[]];
    if (options[@"appleId"]) [requests addObject:AppleIDRequest(options[@"appleId"])];
    return requests;
  }
  NSString *relyingParty = options[@"relyingPartyId"], *attachment = Attachment(options);
  NSData *challenge = SparkBase64URLDecode(options[@"challenge"]);
  NSDictionary *prf = options[@"extensions"][@"prf"], *blob = options[@"extensions"][@"largeBlob"];
  NSMutableArray<ASAuthorizationRequest *> *requests = [NSMutableArray array];
  if ([operation isEqual:@"getPasskey"]) {
    if (UsesPlatform(attachment)) {
      ASAuthorizationPlatformPublicKeyCredentialAssertionRequest *request = [[[ASAuthorizationPlatformPublicKeyCredentialProvider alloc] initWithRelyingPartyIdentifier:relyingParty] createCredentialAssertionRequestWithChallenge:challenge];
      if (options[@"allowCredentials"]) request.allowedCredentials = PlatformDescriptors(options[@"allowCredentials"]);
      request.userVerificationPreference = Verification(options[@"userVerification"]);
      if (blob) {
        // The data goes in before the input is assigned: AuthenticationServices traps on a write input without it.
        ASAuthorizationPublicKeyCredentialLargeBlobAssertionInput *input = [[ASAuthorizationPublicKeyCredentialLargeBlobAssertionInput alloc] initWithOperation:blob[@"write"] ? ASAuthorizationPublicKeyCredentialLargeBlobAssertionOperationWrite : ASAuthorizationPublicKeyCredentialLargeBlobAssertionOperationRead];
        if (blob[@"write"]) input.dataToWrite = SparkBase64URLDecode(blob[@"write"]);
        request.largeBlob = input;
      }
      if (@available(macOS 15.0, *)) { if (prf) request.prf = PRFAssertion(prf); }
      [requests addObject:request];
    }
    if (UsesSecurityKeys(attachment)) {
      ASAuthorizationSecurityKeyPublicKeyCredentialAssertionRequest *request = [[[ASAuthorizationSecurityKeyPublicKeyCredentialProvider alloc] initWithRelyingPartyIdentifier:relyingParty] createCredentialAssertionRequestWithChallenge:challenge];
      if (options[@"allowCredentials"]) request.allowedCredentials = SecurityKeyDescriptors(options[@"allowCredentials"]);
      request.userVerificationPreference = Verification(options[@"userVerification"]);
#if SPARK_SECURITY_KEY_PRF
      if (@available(macOS 26.4, *)) { if (prf) request.prf = PRFAssertion(prf); }
#endif
      [requests addObject:request];
    }
    return requests;
  }
  NSData *userId = SparkBase64URLDecode(options[@"userId"]);
  if (UsesPlatform(attachment)) {
    ASAuthorizationPlatformPublicKeyCredentialRegistrationRequest *request = [[[ASAuthorizationPlatformPublicKeyCredentialProvider alloc] initWithRelyingPartyIdentifier:relyingParty] createCredentialRegistrationRequestWithChallenge:challenge name:options[@"userName"] userID:userId];
    if (options[@"displayName"]) request.displayName = options[@"displayName"];
    request.userVerificationPreference = Verification(options[@"userVerification"]);
    request.attestationPreference = Attestation(options[@"attestation"]);
    if (@available(macOS 15.0, *)) {
      if (options[@"excludeCredentials"]) request.excludedCredentials = PlatformDescriptors(options[@"excludeCredentials"]);
      if (prf) request.prf = PRFRegistration(prf);
    }
    if (blob) request.largeBlob = [[ASAuthorizationPublicKeyCredentialLargeBlobRegistrationInput alloc] initWithSupportRequirement:[blob[@"support"] isEqual:@"required"]
      ? ASAuthorizationPublicKeyCredentialLargeBlobSupportRequirementRequired : ASAuthorizationPublicKeyCredentialLargeBlobSupportRequirementPreferred];
    [requests addObject:request];
  }
  if (UsesSecurityKeys(attachment)) {
    // A passkey on a security key: a discoverable (resident) ES256 credential, so getPasskey finds it without allowCredentials.
    ASAuthorizationSecurityKeyPublicKeyCredentialRegistrationRequest *request = [[[ASAuthorizationSecurityKeyPublicKeyCredentialProvider alloc] initWithRelyingPartyIdentifier:relyingParty]
      createCredentialRegistrationRequestWithChallenge:challenge displayName:options[@"displayName"] ?: options[@"userName"] name:options[@"userName"] userID:userId];
    request.credentialParameters = @[[[ASAuthorizationPublicKeyCredentialParameters alloc] initWithAlgorithm:ASCOSEAlgorithmIdentifierES256]];
    request.residentKeyPreference = ASAuthorizationPublicKeyCredentialResidentKeyPreferenceRequired;
    request.userVerificationPreference = Verification(options[@"userVerification"]);
    request.attestationPreference = Attestation(options[@"attestation"]);
    if (options[@"excludeCredentials"]) request.excludedCredentials = SecurityKeyDescriptors(options[@"excludeCredentials"]);
#if SPARK_SECURITY_KEY_PRF
    if (@available(macOS 26.4, *)) { if (prf) request.prf = PRFRegistration(prf); }
#endif
    [requests addObject:request];
  }
  return requests;
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

static NSString *AttachmentName(ASAuthorizationPublicKeyCredentialAttachment attachment) {
  return attachment == ASAuthorizationPublicKeyCredentialAttachmentCrossPlatform ? @"cross-platform" : @"platform";
}
static NSDictionary *PRFResults(NSData *first, NSData *_Nullable second) {
  return second ? @{ @"first": SparkBase64URLEncode(first), @"second": SparkBase64URLEncode(second) } : @{ @"first": SparkBase64URLEncode(first) };
}
static NSDictionary *PRFRegistrationOutput(BOOL supported, NSData *_Nullable first, NSData *_Nullable second) {
  return first ? @{ @"enabled": @(supported), @"results": PRFResults(first, second) } : @{ @"enabled": @(supported) };
}
static NSDictionary *Registration(id<ASAuthorizationPublicKeyCredentialRegistration> registration, NSString *attachment, id transports, NSDictionary *extensions) {
  return @{ @"credentialId": SparkBase64URLEncode(registration.credentialID), @"clientDataJSON": SparkBase64URLEncode(registration.rawClientDataJSON),
    @"attestationObject": registration.rawAttestationObject ? SparkBase64URLEncode(registration.rawAttestationObject) : NSNull.null,
    @"authenticatorAttachment": attachment, @"transports": transports, @"extensions": extensions };
}
static NSDictionary *Assertion(id<ASAuthorizationPublicKeyCredentialAssertion> assertion, NSString *attachment, NSDictionary *extensions) {
  return @{ @"credentialId": SparkBase64URLEncode(assertion.credentialID), @"userId": SparkBase64URLEncode(assertion.userID),
    @"clientDataJSON": SparkBase64URLEncode(assertion.rawClientDataJSON), @"authenticatorData": SparkBase64URLEncode(assertion.rawAuthenticatorData),
    @"signature": SparkBase64URLEncode(assertion.signature), @"authenticatorAttachment": attachment, @"extensions": extensions };
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
  NSMutableDictionary *extensions = [NSMutableDictionary dictionary];
  if ([credential isKindOfClass:ASAuthorizationPlatformPublicKeyCredentialRegistration.class]) {
    ASAuthorizationPlatformPublicKeyCredentialRegistration *registration = (ASAuthorizationPlatformPublicKeyCredentialRegistration *)credential;
    if (registration.largeBlob) extensions[@"largeBlob"] = @{ @"supported": @(registration.largeBlob.isSupported) };
    if (@available(macOS 15.0, *)) { if (registration.prf) extensions[@"prf"] = PRFRegistrationOutput(registration.prf.isSupported, registration.prf.first, registration.prf.second); }
    return Registration(registration, AttachmentName(registration.attachment), NSNull.null, extensions);
  }
  if ([credential isKindOfClass:ASAuthorizationSecurityKeyPublicKeyCredentialRegistration.class]) {
    ASAuthorizationSecurityKeyPublicKeyCredentialRegistration *registration = (ASAuthorizationSecurityKeyPublicKeyCredentialRegistration *)credential;
    id transports = NSNull.null;
    if (@available(macOS 14.5, *)) {
      // A transport this SDK does not name (usb, nfc, ble) is left out: it is a hint for later allowCredentials.
      NSMutableArray *names = [NSMutableArray array];
      for (NSString *transport in registration.transports) for (NSString *name in Transports) if ([Transport(name) isEqual:transport]) [names addObject:name];
      transports = names;
    }
#if SPARK_SECURITY_KEY_PRF
    if (@available(macOS 26.4, *)) { if (registration.prf) extensions[@"prf"] = PRFRegistrationOutput(registration.prf.isSupported, registration.prf.first, registration.prf.second); }
#endif
    return Registration(registration, @"cross-platform", transports, extensions);
  }
  if ([credential isKindOfClass:ASAuthorizationPlatformPublicKeyCredentialAssertion.class]) {
    ASAuthorizationPlatformPublicKeyCredentialAssertion *assertion = (ASAuthorizationPlatformPublicKeyCredentialAssertion *)credential;
    if (assertion.largeBlob) extensions[@"largeBlob"] = @{ @"blob": assertion.largeBlob.readData ? SparkBase64URLEncode(assertion.largeBlob.readData) : NSNull.null, @"written": @(assertion.largeBlob.didWrite) };
    if (@available(macOS 15.0, *)) { if (assertion.prf) extensions[@"prf"] = @{ @"results": PRFResults(assertion.prf.first, assertion.prf.second) }; }
    return Assertion(assertion, AttachmentName(assertion.attachment), extensions);
  }
  if ([credential isKindOfClass:ASAuthorizationSecurityKeyPublicKeyCredentialAssertion.class]) {
    ASAuthorizationSecurityKeyPublicKeyCredentialAssertion *assertion = (ASAuthorizationSecurityKeyPublicKeyCredentialAssertion *)credential;
#if SPARK_SECURITY_KEY_PRF
    if (@available(macOS 26.4, *)) { if (assertion.prf) extensions[@"prf"] = @{ @"results": PRFResults(assertion.prf.first, assertion.prf.second) }; }
#endif
    return Assertion(assertion, @"cross-platform", extensions);
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
  NSArray<NSString *> *_unavailable; // The simulated macOS's missing passkey features; replaced whole, like _entitlements.
  NSMutableDictionary *_simulation;
  NSMutableArray<NSDictionary *> *_passkeys;
  NSMutableArray<NSDictionary *> *_signals;
  NSUInteger _created; // Simulated passkeys ever created: their IDs stay unique after signals remove some.
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
        @"credentialState": NSNull.null, @"choice": NSNull.null, @"unavailableFeatures": [SparkPasskeyFeatures filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NSString *feature, NSDictionary *) {
          return !SparkPasskeyFeatureSupported(feature); }]], @"requests": @0, @"lastRequest": NSNull.null } mutableCopy];
      _passkeys = [NSMutableArray array];
      _signals = [NSMutableArray array];
      _users = [NSMutableSet set];
      [self simulateEntitlements];
    }
#else
    NSAssert(!simulated, @"Simulated authorization exists only in builds with the test driver");
#endif
  }
  return self;
}

// Whether the (simulated) macOS has a passkey feature.
- (BOOL)supports:(NSString *)feature
{
#if SPARK_TEST_DRIVER
  if (_simulated) {
    NSArray *unavailable;
    @synchronized (self) { unavailable = _unavailable; }
    return ![unavailable containsObject:feature];
  }
#endif
  return SparkPasskeyFeatureSupported(feature);
}

- (NSString *)availability:(NSString *)feature relyingPartyId:(NSString *)relyingPartyId passkeyFeature:(NSString *)passkeyFeature
{
  if (passkeyFeature) {
    if (![feature isEqual:@"passkeys"] || ![SparkPasskeyFeatures containsObject:passkeyFeature]) return @"invalid";
    if (![self supports:passkeyFeature]) return @"host-restriction";
  }
  NSDictionary *entitlements;
  @synchronized (self) { entitlements = _entitlements; }
  return SparkAuthorizationEntitled(entitlements, feature, relyingPartyId) ? @"available" : @"missing-entitlement";
}

static NSString *MissingEntitlement(NSString *feature, NSString *relyingPartyId) {
  return [feature isEqual:@"appleId"] ? @"Sign in with Apple needs the com.apple.developer.applesignin entitlement (macos.authentication.signInWithApple) in a team-signed build"
    : [NSString stringWithFormat:@"Passkeys for %@ need webcredentials:%@ in the com.apple.developer.associated-domains entitlement (macos.authentication.passkeyDomains) in a team-signed build", relyingPartyId, relyingPartyId];
}

// The missingEntitlement message for the first entitlement an operation lacks; nil when entitled.
- (NSString *)missingEntitlement:(NSString *)operation options:(NSDictionary *)options
{
  BOOL apple = [operation isEqual:@"appleId"] || ([operation isEqual:@"getCredential"] && options[@"appleId"]);
  NSString *relyingParty = [operation isEqual:@"getCredential"] ? options[@"passkey"][@"relyingPartyId"] : [operation isEqual:@"appleId"] ? nil : options[@"relyingPartyId"];
  if (apple && ![[self availability:@"appleId" relyingPartyId:nil passkeyFeature:nil] isEqual:@"available"]) return MissingEntitlement(@"appleId", nil);
  if (relyingParty && ![[self availability:@"passkeys" relyingPartyId:relyingParty passkeyFeature:nil] isEqual:@"available"]) return MissingEntitlement(@"passkeys", relyingParty);
  return nil;
}

// An option the (simulated) macOS lacks is E_UNSUPPORTED_OPTION, never dropped: prf needs macOS 15, and macOS 26.4 with security keys.
- (NSError *)unsupportedOption:(NSString *)operation options:(NSDictionary *)options
{
  NSDictionary *passkey = [operation isEqual:@"getCredential"] ? options[@"passkey"] : [operation isEqual:@"appleId"] ? nil : options;
  if (!passkey[@"extensions"][@"prf"]) return nil;
  NSString *attachment = Attachment(passkey);
  if (UsesPlatform(attachment) && ![self supports:@"prf"]) return Failure(@"E_UNSUPPORTED_OPTION", @"The prf extension needs macOS 15");
  if (UsesSecurityKeys(attachment) && ![self supports:@"securityKeyPrf"]) return Failure(@"E_UNSUPPORTED_OPTION", @"The prf extension with security keys needs macOS 26.4");
  return nil;
}

- (void)perform:(NSString *)operation options:(NSDictionary *)options window:(NSWindow *)window identifier:(NSString *)identifier completion:(SparkAuthorizationCompletion)completion
{
  SparkAuthorizationCompletion done = Once(completion);
  NSError *invalid = Validate(operation, options);
  if (!invalid && (![identifier isKindOfClass:NSString.class] || !identifier.length)) invalid = Failure(@"E_INVALID_ARGUMENT", @"A request needs an identifier");
  if (!invalid && _active.count) invalid = Failure(@"E_BUSY", @"Another authorization request is pending; one shows at a time");
  if (!invalid) invalid = [self unsupportedOption:operation options:options];
  if (invalid) return done(nil, invalid);
  NSString *missing = [self missingEntitlement:operation options:options];
  if (missing) return done(Failed(@"missingEntitlement", missing), nil);
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
  request.controller = [[ASAuthorizationController alloc] initWithAuthorizationRequests:SparkAuthorizationRequests(operation, options)];
  request.controller.delegate = request;
  request.controller.presentationContextProvider = request;
  _active[identifier] = request;
  // Only when a credential is immediately available on this Mac; otherwise AuthenticationServices ends it without a sheet.
  if ([options[@"preferImmediatelyAvailableCredentials"] boolValue]) [request.controller performRequestsWithOptions:ASAuthorizationControllerRequestOptionPreferImmediatelyAvailableCredentials];
  else [request.controller performRequests];
}

- (void)signal:(NSString *)kind options:(NSDictionary *)options completion:(SparkAuthorizationCompletion)completion
{
  SparkAuthorizationCompletion done = Once(completion);
  NSError *invalid = ValidateSignal(kind, options);
  if (invalid) return done(nil, invalid);
  if (![self supports:@"signals"]) return done(nil, Failure(@"E_UNAVAILABLE", @"Credential signals need macOS 26"));
  NSString *relyingParty = options[@"relyingPartyId"];
  if (![[self availability:@"passkeys" relyingPartyId:relyingParty passkeyFeature:nil] isEqual:@"available"]) return done(Failed(@"missingEntitlement", MissingEntitlement(@"passkeys", relyingParty)), nil);
#if SPARK_TEST_DRIVER
  if (_simulated) return done([self simulateSignal:kind options:options], nil);
#endif
  void (^reported)(NSError *) = ^(NSError *error) {
    if (!error) return done(NSNull.null, nil);
    NSError *failure = nil;
    id result = SparkAuthorizationCompleted(error, NO, &failure);
    // No sheet is shown, so a cancel is not the person's answer.
    if ([result isEqual:Canceled]) return done(nil, Failure(@"E_NATIVE", [NSString stringWithFormat:@"The credential signal was cancelled: %@", error.localizedDescription]));
    done(result, failure);
  };
  Class<SparkCredentialSignaling> signals = SignalsClass();
  NSData *userId = SparkBase64URLDecode(options[@"userId"]);
  if ([kind isEqual:@"unknownCredential"]) [signals reportUnknownCredential:relyingParty credentialID:SparkBase64URLDecode(options[@"credentialId"]) completion:reported];
  else if ([kind isEqual:@"currentUserDetails"]) [signals reportCurrentUserDetails:relyingParty userHandle:userId name:options[@"name"] completion:reported];
  else {
    NSMutableArray *accepted = [NSMutableArray array];
    for (NSString *credential in options[@"allAcceptedCredentialIds"]) [accepted addObject:SparkBase64URLDecode(credential)];
    [signals reportAllAcceptedCredentials:relyingParty userHandle:userId acceptedCredentialIDs:accepted completion:reported];
  }
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
  if (![[self availability:@"appleId" relyingPartyId:nil passkeyFeature:nil] isEqual:@"available"]) return done(Failed(@"missingEntitlement", MissingEntitlement(@"appleId", nil)), nil);
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
  @synchronized (self) { _entitlements = entitlements; _unavailable = [_simulation[@"unavailableFeatures"] copy]; }
}

static NSString *Simulated(NSString *text) { return SparkBase64URLEncode([text dataUsingEncoding:NSUTF8StringEncoding]); }
// A simulated PRF output: made up from the credential and the salt, so the same inputs give the same output.
static NSDictionary *SimulatedPRF(NSString *credentialId, NSDictionary *salts) {
  NSString *first = Simulated([NSString stringWithFormat:@"prf %@ %@", credentialId, salts[@"first"]]);
  return salts[@"second"] ? @{ @"first": first, @"second": Simulated([NSString stringWithFormat:@"prf %@ %@", credentialId, salts[@"second"]]) } : @{ @"first": first };
}

// A simulated request: the set answer decides how it ends; a success returns made-up credentials (docs/authentication.md#testing).
// The sheet offers this Mac's passkeys, a security key and Sign in with Apple as the request asks; the simulated person
// picks the set choice, else the first offered. preferImmediatelyAvailableCredentials offers only this Mac's matching
// passkeys and Sign in with Apple; with none, nothing is shown and the request ends as a cancel.
- (void)simulate:(NSString *)operation options:(NSDictionary *)options window:(NSWindow *)window identifier:(NSString *)identifier completion:(SparkAuthorizationCompletion)settle
{
  id answer = _simulation[@"answer"], choice = _simulation[@"choice"];
  NSDictionary *apple = [operation isEqual:@"appleId"] ? options : options[@"appleId"];
  NSDictionary *passkey = [operation isEqual:@"getCredential"] ? options[@"passkey"] : [operation isEqual:@"appleId"] ? nil : options;
  NSString *relyingParty = passkey[@"relyingPartyId"], *attachment = passkey ? Attachment(passkey) : nil;
  BOOL assertion = ![operation isEqual:@"createPasskey"], immediate = [options[@"preferImmediatelyAvailableCredentials"] boolValue];
  NSDictionary *extensions = passkey[@"extensions"] ?: @{};
  NSMutableArray *offered = [NSMutableArray array];
  if (passkey && UsesPlatform(attachment)) [offered addObject:@"platform"];
  if (passkey && UsesSecurityKeys(attachment)) [offered addObject:@"securityKey"];
  if (apple) [offered addObject:@"appleId"];
  NSArray *allowed = passkey[@"allowCredentials"] ? CredentialIDs(passkey[@"allowCredentials"]) : nil;
  NSDictionary *(^find)(NSString *) = ^NSDictionary *(NSString *kind) {
    for (NSDictionary *candidate in self->_passkeys.reverseObjectEnumerator)
      if ([candidate[@"relyingPartyId"] isEqual:relyingParty] && [candidate[@"kind"] isEqual:kind] && (!allowed || [allowed containsObject:candidate[@"credentialId"]])) return candidate;
    return nil;
  };
  NSMutableArray *available = [offered mutableCopy];
  if (immediate) {
    [available removeObject:@"securityKey"];
    if (!find(@"platform")) [available removeObject:@"platform"];
  }
  NSString *chosen = choice == NSNull.null ? available.firstObject : [available containsObject:choice] ? choice : nil;
  NSDictionary *found = assertion && ![chosen isEqual:@"appleId"] && chosen ? find(chosen) : nil;
  NSError *refused = nil;
  if (answer == NSNull.null) refused = Failure(@"E_UNAVAILABLE", @"Test driver: no simulated answer for the authorization request (simulateAuthorization answer)");
  else if (choice != NSNull.null && available.count && !chosen) refused = Failure(@"E_UNAVAILABLE", [NSString stringWithFormat:@"Test driver: the simulated choice %@ is not offered (%@)", choice, [available componentsJoinedByString:@", "]]);
  else if ([answer isEqual:@"success"] && assertion && chosen && ![chosen isEqual:@"appleId"] && !found) refused = Failure(@"E_UNAVAILABLE", [NSString stringWithFormat:@"Test driver: no simulated passkey for %@ matches the request", relyingParty]);
  if (refused) { dispatch_async(dispatch_get_main_queue(), ^{ settle(nil, refused); }); return; }
  NSMutableDictionary *last = [@{ @"operation": operation, @"window": Nullable(window.identifier), @"offered": offered, @"preferImmediatelyAvailableCredentials": @(immediate),
    @"extensions": [extensions.allKeys sortedArrayUsingSelector:@selector(compare:)] } mutableCopy];
  if (apple[@"scopes"]) last[@"scopes"] = apple[@"scopes"];
  for (NSString *key in @[@"relyingPartyId", @"userName", @"userVerification", @"attestation", @"authenticatorAttachment"]) if (passkey[key]) last[key] = passkey[key];
  _simulation[@"lastRequest"] = last;
  if (!chosen) {
    // Nothing immediately available: AuthenticationServices shows no sheet and ends the request as a cancel.
    _active[identifier] = [^{} copy];
    dispatch_async(dispatch_get_main_queue(), ^{ settle(Canceled, nil); });
    return;
  }
  _simulation[@"requests"] = @([_simulation[@"requests"] integerValue] + 1);
  if ([answer isEqual:@"ignore"]) {
    // Stays up until cancelled, which ends it as cancelling a real controller does.
    _active[identifier] = [^{ settle(Failed(@"appCancel", @"The app cancelled the request"), nil); } copy];
    return;
  }
  _active[identifier] = [^{} copy]; // Pending until the answer below arrives.
  NSDictionary *result;
  if ([answer isEqual:@"cancel"]) result = Canceled;
  else if (![answer isEqual:@"success"]) result = Failed(answer, [NSString stringWithFormat:@"Simulated %@", answer]);
  else if ([chosen isEqual:@"appleId"]) {
    NSArray *scopes = apple[@"scopes"] ?: @[];
    NSString *user = @"001234.simulated.0001";
    [_users addObject:user];
    result = Succeeded(@{ @"user": user, @"state": Nullable(apple[@"state"]), @"authorizedScopes": scopes, @"identityToken": @"simulated.identity.token",
      @"authorizationCode": @"simulated-authorization-code", @"email": [scopes containsObject:@"email"] ? @"simulated@privaterelay.appleid.com" : NSNull.null,
      @"fullName": [scopes containsObject:@"fullName"] ? @{ @"namePrefix": NSNull.null, @"givenName": @"Spark", @"middleName": NSNull.null, @"familyName": @"Tester", @"nameSuffix": NSNull.null, @"nickname": NSNull.null } : NSNull.null,
      @"realUserStatus": @"unsupported" });
  } else {
    NSString *type = assertion ? @"webauthn.get" : @"webauthn.create";
    NSString *authenticator = [chosen isEqual:@"securityKey"] ? @"cross-platform" : @"platform";
    NSData *client = [NSJSONSerialization dataWithJSONObject:@{ @"type": type, @"challenge": passkey[@"challenge"], @"origin": [@"https://" stringByAppendingString:relyingParty] } options:NSJSONWritingSortedKeys error:nil];
    NSDictionary *prf = extensions[@"prf"], *blob = extensions[@"largeBlob"];
    NSMutableDictionary *outputs = [NSMutableDictionary dictionary];
    if (assertion) {
      NSString *credentialId = found[@"credentialId"];
      NSDictionary *salts = prf[@"evalByCredential"][credentialId] ?: prf[@"eval"];
      if (prf && [found[@"prf"] boolValue] && salts) outputs[@"prf"] = @{ @"results": SimulatedPRF(credentialId, salts) };
      if (blob && found[@"largeBlob"] != NSNull.null) {
        if (blob[@"write"]) {
          NSMutableDictionary *updated = [found mutableCopy];
          updated[@"largeBlob"] = blob[@"write"];
          [_passkeys replaceObjectAtIndex:[_passkeys indexOfObjectIdenticalTo:found] withObject:updated];
          outputs[@"largeBlob"] = @{ @"blob": NSNull.null, @"written": @YES };
        } else outputs[@"largeBlob"] = @{ @"blob": [found[@"largeBlob"] length] ? found[@"largeBlob"] : NSNull.null, @"written": @NO };
      }
      result = Succeeded(@{ @"credentialId": credentialId, @"userId": found[@"userId"], @"clientDataJSON": SparkBase64URLEncode(client),
        @"authenticatorData": Simulated(@"simulated authenticator data"), @"signature": Simulated(@"simulated signature"), @"authenticatorAttachment": authenticator, @"extensions": outputs });
    } else {
      NSArray *excludedIds = passkey[@"excludeCredentials"] ? CredentialIDs(passkey[@"excludeCredentials"]) : @[];
      BOOL excluded = NO;
      for (NSDictionary *existing in _passkeys) excluded = excluded || ([existing[@"relyingPartyId"] isEqual:relyingParty] && [excludedIds containsObject:existing[@"credentialId"]]);
      if (excluded) result = Failed(@"matchedExcludedCredential", @"Simulated matchedExcludedCredential: a passkey in excludeCredentials is on this Mac");
      else {
        NSString *credentialId = Simulated([NSString stringWithFormat:@"simulated passkey %lu", (unsigned long)++_created]);
        if (prf) outputs[@"prf"] = prf[@"eval"] ? @{ @"enabled": @YES, @"results": SimulatedPRF(credentialId, prf[@"eval"]) } : @{ @"enabled": @YES };
        if (blob) outputs[@"largeBlob"] = @{ @"supported": @YES };
        [_passkeys addObject:@{ @"relyingPartyId": relyingParty, @"credentialId": credentialId, @"userId": passkey[@"userId"], @"userName": passkey[@"userName"],
          @"kind": chosen, @"prf": @(prf != nil), @"largeBlob": blob ? @"" : NSNull.null }];
        result = Succeeded(@{ @"credentialId": credentialId, @"clientDataJSON": SparkBase64URLEncode(client), @"attestationObject": Simulated(@"simulated attestation"),
          @"authenticatorAttachment": authenticator, @"transports": [chosen isEqual:@"securityKey"] ? @[@"usb"] : NSNull.null, @"extensions": outputs });
      }
    }
  }
  dispatch_async(dispatch_get_main_queue(), ^{ settle(result, nil); });
}

// A simulated signal, applied to the simulated passkeys as a credential manager would: an unknown credential is removed,
// a user's passkeys not in allAcceptedCredentialIds are removed, and the user's details rename their passkeys.
- (id)simulateSignal:(NSString *)kind options:(NSDictionary *)options
{
  NSString *relyingParty = options[@"relyingPartyId"];
  NSIndexSet *removed = [_passkeys indexesOfObjectsPassingTest:^BOOL(NSDictionary *passkey, NSUInteger, BOOL *) {
    if (![passkey[@"relyingPartyId"] isEqual:relyingParty]) return NO;
    if ([kind isEqual:@"unknownCredential"]) return [passkey[@"credentialId"] isEqual:options[@"credentialId"]];
    return [kind isEqual:@"allAcceptedCredentials"] && [passkey[@"userId"] isEqual:options[@"userId"]] && ![options[@"allAcceptedCredentialIds"] containsObject:passkey[@"credentialId"]];
  }];
  [_passkeys removeObjectsAtIndexes:removed];
  if ([kind isEqual:@"currentUserDetails"])
    for (NSUInteger index = 0; index < _passkeys.count; index++)
      if ([_passkeys[index][@"relyingPartyId"] isEqual:relyingParty] && [_passkeys[index][@"userId"] isEqual:options[@"userId"]]) {
        NSMutableDictionary *renamed = [_passkeys[index] mutableCopy];
        renamed[@"userName"] = options[@"name"];
        _passkeys[index] = renamed;
      }
  [_signals addObject:@{ @"kind": kind, @"relyingPartyId": relyingParty }];
  return NSNull.null;
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
    else if ([field isEqual:@"choice"]) { if (![@[@"platform", @"securityKey", @"appleId", NSNull.null] containsObject:value]) failure = Failure(@"E_INVALID_ARGUMENT", @"choice is platform, securityKey, appleId or null"); }
    else if ([field isEqual:@"unavailableFeatures"]) {
      BOOL valid = [value isKindOfClass:NSArray.class];
      for (id feature in valid ? value : @[]) valid = valid && [SparkPasskeyFeatures containsObject:feature];
      if (!valid) failure = Failure(@"E_INVALID_ARGUMENT", [@"unavailableFeatures lists passkey features: " stringByAppendingString:[SparkPasskeyFeatures componentsJoinedByString:@", "]]);
    }
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
  for (NSDictionary *passkey in _passkeys) [passkeys addObject:@{ @"relyingPartyId": passkey[@"relyingPartyId"], @"credentialId": passkey[@"credentialId"], @"userName": passkey[@"userName"],
    @"authenticatorAttachment": [passkey[@"kind"] isEqual:@"securityKey"] ? @"cross-platform" : @"platform" }];
  simulation[@"passkeys"] = passkeys;
  simulation[@"signals"] = [_signals copy];
  simulation[@"pending"] = @(_active.count);
  return simulation;
}
#endif
@end
