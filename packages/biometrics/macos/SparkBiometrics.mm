#import "SparkBiometrics.h"
#import <LocalAuthentication/LocalAuthentication.h>

NSErrorDomain const SparkBiometricErrorDomain = @"so.legend.spark.biometrics";
static NSError *Failure(NSString *code, NSString *message) {
  return [NSError errorWithDomain:SparkBiometricErrorDomain code:0 userInfo:@{ @"code": code, NSLocalizedDescriptionKey: message }];
}
NSString *SparkBiometricErrorCode(NSError *error) {
  NSString *code = [error.domain isEqual:SparkBiometricErrorDomain] ? error.userInfo[@"code"] : nil;
  return code ?: @"E_NATIVE";
}

NSString *SparkBiometryTypeName(NSInteger type) {
  switch (type) {
    case LABiometryTypeNone: return @"none";
    case LABiometryTypeTouchID: return @"touchId";
    default: return @"unknown";
  }
}
NSString *SparkBiometricFailure(NSInteger code) {
  switch (code) {
    case LAErrorAuthenticationFailed: return @"authenticationFailed";
    case LAErrorUserCancel: return @"userCancel";
    case LAErrorUserFallback: return @"userFallback";
    case LAErrorSystemCancel: return @"systemCancel";
    case LAErrorPasscodeNotSet: return @"passcodeNotSet";
    case LAErrorBiometryNotAvailable: return @"notAvailable";
    case LAErrorBiometryNotEnrolled: return @"notEnrolled";
    case LAErrorBiometryLockout: return @"lockout";
    case LAErrorAppCancel: return @"appCancel";
    case LAErrorInvalidContext: return @"invalidContext";
    case LAErrorNotInteractive: return @"notInteractive";
    case LAErrorBiometryNotPaired: return @"notPaired";
    case LAErrorBiometryDisconnected: return @"disconnected";
    default: return nil;
  }
}
NSString *SparkBiometricKeychainFailure(OSStatus status) {
  switch (status) {
    case errSecUserCanceled: return @"userCancel";
    case errSecAuthFailed: return @"authenticationFailed";
    case errSecInteractionNotAllowed: return @"notInteractive";
    case errSecMissingEntitlement: return @"missingEntitlement";
    case errSecNotAvailable: return @"notAvailable";
    default: return nil;
  }
}
SecAccessControlCreateFlags SparkBiometricAccessFlags(NSString *access) {
  if ([access isEqual:@"biometryCurrentSet"]) return kSecAccessControlBiometryCurrentSet;
  if ([access isEqual:@"biometryAny"]) return kSecAccessControlBiometryAny;
  if ([access isEqual:@"biometryOrPassword"]) return kSecAccessControlUserPresence;
  return 0;
}
NSDictionary *SparkBiometricSecretQuery(NSString *service, NSString *key) {
  // Access control needs the data protection keychain on macOS; a file keychain (the login keychain) cannot hold it.
  return @{ (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword, (__bridge id)kSecAttrService: service,
    (__bridge id)kSecAttrAccount: key, (__bridge id)kSecUseDataProtectionKeychain: @YES };
}

static NSArray<NSString *> *const Fallbacks = @[@"password", @"app", @"none"];
static NSArray<NSString *> *const Accesses = @[@"biometryCurrentSet", @"biometryAny", @"biometryOrPassword"];
// Reasons canEvaluatePolicy: can give: the states a status reports besides available.
static NSArray<NSString *> *const States = @[@"available", @"notAvailable", @"notEnrolled", @"lockout", @"passcodeNotSet", @"disconnected", @"notPaired"];

static NSDictionary *Failed(NSString *reason, NSString *message) { return @{ @"success": @NO, @"reason": reason, @"message": message }; }
// An evaluation's result: success, a named failure, or E_NATIVE for an error this SDK does not name.
static id Evaluated(BOOL success, NSError *error, NSError **failure) {
  if (success) return @{ @"success": @YES };
  NSString *reason = [error.domain isEqual:LAErrorDomain] ? SparkBiometricFailure(error.code) : nil;
  if (reason) return Failed(reason, error.localizedDescription);
  *failure = Failure(@"E_NATIVE", [NSString stringWithFormat:@"Biometric authentication failed: %@ %ld %@", error.domain, (long)error.code, error.localizedDescription]);
  return nil;
}
static NSDictionary *KeychainFailed(OSStatus status, NSString *action, NSError **failure) {
  NSString *reason = SparkBiometricKeychainFailure(status);
  NSString *message = CFBridgingRelease(SecCopyErrorMessageString(status, NULL)) ?: @"Unknown error";
  if (reason) return Failed(reason, [NSString stringWithFormat:@"%@: %@", action, message]);
  *failure = Failure(@"E_NATIVE", [NSString stringWithFormat:@"%@ failed with Keychain error %d: %@", action, (int)status, message]);
  return nil;
}

// Wraps a completion so it runs once, on the main thread, however often and wherever it is called.
static SparkBiometricCompletion Once(SparkBiometricCompletion completion) {
  __block SparkBiometricCompletion pending = [completion copy];
  return ^(id result, NSError *error) {
    dispatch_block_t finish = ^{
      SparkBiometricCompletion callback = pending;
      pending = nil;
      if (callback) callback(result, error);
    };
    if (NSThread.isMainThread) finish(); else dispatch_async(dispatch_get_main_queue(), finish);
  };
}

static BOOL Text(id value, NSUInteger maximum) {
  return [value isKindOfClass:NSString.class] && [value length] <= maximum && [value stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet].length > 0;
}
static NSError *ValidKey(id key) {
  static NSRegularExpression *pattern;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ pattern = [NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9_.-]{1,200}$" options:0 error:nil]; });
  if ([key isKindOfClass:NSString.class] && [pattern numberOfMatchesInString:key options:0 range:NSMakeRange(0, [key length])] == 1) return nil;
  return Failure(@"E_INVALID_ARGUMENT", @"Secret keys are 1–200 letters, digits, '.', '-' or '_'");
}
// The prompt options both operations take; `fallback` only for authentication.
static NSError *ValidPrompt(NSDictionary *options, BOOL authentication) {
  if (!Text(options[@"reason"], 300)) return Failure(@"E_INVALID_ARGUMENT", @"A biometric prompt needs reason: 1–300 characters saying why");
  if (options[@"cancelLabel"] && !Text(options[@"cancelLabel"], 60)) return Failure(@"E_INVALID_ARGUMENT", @"cancelLabel is 1–60 characters");
  if (!authentication) return options[@"fallback"] || options[@"fallbackLabel"] ? Failure(@"E_INVALID_ARGUMENT", @"A secret's access decides its fallback") : nil;
  if (![Fallbacks containsObject:options[@"fallback"]]) return Failure(@"E_INVALID_ARGUMENT", @"fallback is password, app or none");
  if (options[@"fallbackLabel"] && (![options[@"fallback"] isEqual:@"app"] || !Text(options[@"fallbackLabel"], 60))) return Failure(@"E_INVALID_ARGUMENT", @"fallbackLabel is 1–60 characters, with fallback app");
  return nil;
}
// The policy an authentication or a secret's access evaluates.
static LAPolicy Policy(NSString *fallback) { return [fallback isEqual:@"password"] ? LAPolicyDeviceOwnerAuthentication : LAPolicyDeviceOwnerAuthenticationWithBiometrics; }
static NSString *AccessFallback(NSString *access) { return [access isEqual:@"biometryOrPassword"] ? @"password" : @"none"; }

@implementation SparkBiometrics {
  NSString *_service;
  // Pending prompts by identifier: the LAContext to invalidate, or a simulated prompt's cancel block.
  NSMutableDictionary<NSString *, id> *_active;
#if SPARK_TEST_DRIVER
  NSMutableDictionary *_simulation;
  NSMutableDictionary<NSString *, NSDictionary *> *_secrets;
#endif
}

- (instancetype)initWithService:(NSString *)service simulated:(BOOL)simulated
{
  if ((self = [super init])) {
    _service = [service copy];
    _active = [NSMutableDictionary dictionary];
#if SPARK_TEST_DRIVER
    _simulated = simulated;
    if (simulated) {
      _simulation = [@{ @"biometryType": @"touchId", @"biometrics": @"available", @"password": @"available", @"answer": NSNull.null, @"prompts": @0, @"lastPrompt": NSNull.null } mutableCopy];
      _secrets = [NSMutableDictionary dictionary];
    }
#else
    NSAssert(!simulated, @"Simulated biometrics exist only in builds with the test driver");
#endif
  }
  return self;
}

// A canEvaluatePolicy: answer as a state, or nil with E_NATIVE for a reason that is not one.
static NSString *State(BOOL evaluable, NSError *error, NSError **failure) {
  if (evaluable) return @"available";
  NSString *reason = [error.domain isEqual:LAErrorDomain] ? SparkBiometricFailure(error.code) : nil;
  if ([States containsObject:reason]) return reason;
  *failure = Failure(@"E_NATIVE", [NSString stringWithFormat:@"Checking biometrics failed: %@ %ld %@", error.domain, (long)error.code, error.localizedDescription]);
  return nil;
}

- (void)status:(SparkBiometricCompletion)completion
{
  SparkBiometricCompletion done = Once(completion);
#if SPARK_TEST_DRIVER
  if (_simulated) return done(@{ @"biometryType": _simulation[@"biometryType"], @"biometrics": _simulation[@"biometrics"], @"password": _simulation[@"password"] }, nil);
#endif
  LAContext *context = [LAContext new];
  NSError *biometricsError = nil, *passwordError = nil, *failure = nil;
  BOOL biometrics = [context canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics error:&biometricsError];
  NSString *type = SparkBiometryTypeName(context.biometryType); // Set by canEvaluatePolicy:, whatever it returns.
  BOOL password = [context canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication error:&passwordError];
  [context invalidate];
  NSString *biometricsState = State(biometrics, biometricsError, &failure);
  NSString *passwordState = biometricsState ? State(password, passwordError, &failure) : nil;
  if (!passwordState) return done(nil, failure);
  done(@{ @"biometryType": type, @"biometrics": biometricsState, @"password": passwordState }, nil);
}

// Ends the pending prompt `identifier`: forgets and invalidates its context, then completes.
- (SparkBiometricCompletion)settle:(NSString *)identifier completion:(SparkBiometricCompletion)done
{
  __weak SparkBiometrics *weakSelf = self;
  return Once(^(id result, NSError *error) {
    SparkBiometrics *strongSelf = weakSelf;
    if (strongSelf) {
      id active = strongSelf->_active[identifier];
      [strongSelf->_active removeObjectForKey:identifier];
      if ([active isKindOfClass:LAContext.class]) [(LAContext *)active invalidate];
    }
    done(result, error);
  });
}

- (NSError *)begin:(NSString *)identifier
{
  if (![identifier isKindOfClass:NSString.class] || !identifier.length) return Failure(@"E_INVALID_ARGUMENT", @"A prompt needs an identifier");
  if (_active.count) return Failure(@"E_BUSY", @"Another biometric prompt is pending; one shows at a time");
  return nil;
}

- (void)authenticate:(NSDictionary *)options identifier:(NSString *)identifier completion:(SparkBiometricCompletion)completion
{
  SparkBiometricCompletion done = Once(completion);
  NSError *invalid = ValidPrompt(options, YES) ?: [self begin:identifier];
  if (invalid) return done(nil, invalid);
  SparkBiometricCompletion settle = [self settle:identifier completion:done];
#if SPARK_TEST_DRIVER
  if (_simulated) return [self simulatePrompt:@"authenticate" options:options fallback:options[@"fallback"] identifier:identifier completion:settle];
#endif
  LAContext *context = [LAContext new];
  if (options[@"cancelLabel"]) context.localizedCancelTitle = options[@"cancelLabel"];
  // An empty fallback title hides the button; nil keeps macOS's ("Enter Password", or "Use Password" for the password policy).
  if ([options[@"fallback"] isEqual:@"none"]) context.localizedFallbackTitle = @"";
  else if (options[@"fallbackLabel"]) context.localizedFallbackTitle = options[@"fallbackLabel"];
  _active[identifier] = context;
  // The reply arrives on a private queue; settle moves it to the main thread.
  [context evaluatePolicy:Policy(options[@"fallback"]) localizedReason:options[@"reason"] reply:^(BOOL success, NSError *error) {
    NSError *failure = nil;
    id result = Evaluated(success, error, &failure);
    settle(result, failure);
  }];
}

- (void)cancel:(NSString *)identifier
{
  id active = _active[identifier];
  if ([active isKindOfClass:LAContext.class]) [(LAContext *)active invalidate]; // evaluatePolicy: replies LAErrorAppCancel.
  else if (active) ((dispatch_block_t)active)();
}

// The state of the policy a secret's access needs, read without touching the Keychain; nil with E_NATIVE for an
// answer that is not a state.
static NSString *AccessState(NSString *access, NSError **failure) {
  LAContext *context = [LAContext new];
  NSError *error = nil;
  BOOL evaluable = [context canEvaluatePolicy:Policy(AccessFallback(access)) error:&error];
  [context invalidate];
  return State(evaluable, error, failure);
}

- (void)setSecret:(NSString *)key value:(NSString *)value access:(NSString *)access completion:(SparkBiometricCompletion)completion
{
  SparkBiometricCompletion done = Once(completion);
  NSError *invalid = ValidKey(key);
  if (!invalid && ![value isKindOfClass:NSString.class]) invalid = Failure(@"E_INVALID_ARGUMENT", @"Secret values are strings");
  if (!invalid && !SparkBiometricAccessFlags(access)) invalid = Failure(@"E_INVALID_ARGUMENT", @"access is biometryCurrentSet, biometryAny or biometryOrPassword");
  if (invalid) return done(nil, invalid);
#if SPARK_TEST_DRIVER
  if (_simulated) {
    NSString *state = _simulation[[AccessFallback(access) isEqual:@"password"] ? @"password" : @"biometrics"];
    if (![state isEqual:@"available"]) return done(Failed(state, [NSString stringWithFormat:@"Simulated %@", state]), nil);
    _secrets[key] = @{ @"value": value, @"access": access };
    return done(NSNull.null, nil);
  }
#endif
  NSString *service = _service;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSError *failure = nil;
    NSString *state = AccessState(access, &failure);
    if (!state) return done(nil, failure);
    if (![state isEqual:@"available"]) return done(Failed(state, [NSString stringWithFormat:@"The secret's access cannot be evaluated: %@", state]), nil);
    CFErrorRef cfError = NULL;
    SecAccessControlRef control = SecAccessControlCreateWithFlags(NULL, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, SparkBiometricAccessFlags(access), &cfError);
    if (!control) {
      NSError *error = CFBridgingRelease(cfError);
      return done(nil, Failure(@"E_NATIVE", [NSString stringWithFormat:@"Creating the secret's access control failed: %@", error.localizedDescription]));
    }
    // Replacing a protected item never prompts: delete it (no authentication needed) without interaction, then add.
    LAContext *quiet = [LAContext new];
    quiet.interactionNotAllowed = YES;
    NSMutableDictionary *query = [SparkBiometricSecretQuery(service, key) mutableCopy];
    query[(__bridge id)kSecUseAuthenticationContext] = quiet;
    OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
    if (status == errSecSuccess || status == errSecItemNotFound) {
      query[(__bridge id)kSecValueData] = [value dataUsingEncoding:NSUTF8StringEncoding];
      query[(__bridge id)kSecAttrAccessControl] = (__bridge_transfer id)control;
      status = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
    } else CFRelease(control);
    [quiet invalidate];
    if (status == errSecSuccess) done(NSNull.null, nil);
    else { NSDictionary *failed = KeychainFailed(status, @"Storing the secret", &failure); done(failed, failure); }
  });
}

- (void)secret:(NSString *)key options:(NSDictionary *)options identifier:(NSString *)identifier completion:(SparkBiometricCompletion)completion
{
  SparkBiometricCompletion done = Once(completion);
  NSError *invalid = ValidKey(key) ?: ValidPrompt(options, NO) ?: [self begin:identifier];
  if (invalid) return done(nil, invalid);
  SparkBiometricCompletion settle = [self settle:identifier completion:done];
#if SPARK_TEST_DRIVER
  if (_simulated) {
    NSDictionary *secret = _secrets[key];
    if (!secret) return settle(@{ @"success": @YES, @"value": NSNull.null }, nil);
    return [self simulatePrompt:@"secret" options:options fallback:AccessFallback(secret[@"access"]) identifier:identifier completion:^(NSDictionary *result, NSError *error) {
      // The secret is read once the prompt succeeds; it may have been deleted or invalidated meanwhile.
      NSString *value = self->_secrets[key][@"value"];
      settle(error || ![result[@"success"] boolValue] ? result : @{ @"success": @YES, @"value": value ?: NSNull.null }, error);
    }];
  }
#endif
  LAContext *context = [LAContext new];
  context.localizedReason = options[@"reason"];
  if (options[@"cancelLabel"]) context.localizedCancelTitle = options[@"cancelLabel"];
  _active[identifier] = context;
  NSMutableDictionary *query = [SparkBiometricSecretQuery(_service, key) mutableCopy];
  query[(__bridge id)kSecReturnData] = @YES;
  query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
  query[(__bridge id)kSecUseAuthenticationContext] = context;
  // SecItemCopyMatching blocks while macOS prompts: never on the main thread.
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    CFTypeRef data = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &data);
    NSError *failure = nil;
    if (status == errSecItemNotFound) return settle(@{ @"success": @YES, @"value": NSNull.null }, nil);
    if (status != errSecSuccess) { NSDictionary *failed = KeychainFailed(status, @"Reading the secret", &failure); return settle(failed, failure); }
    NSString *value = [[NSString alloc] initWithData:CFBridgingRelease(data) encoding:NSUTF8StringEncoding];
    if (!value) return settle(nil, Failure(@"E_INVALID_DATA", @"The secret is not UTF-8 text"));
    settle(@{ @"success": @YES, @"value": value }, nil);
  });
}

- (void)deleteSecret:(NSString *)key completion:(SparkBiometricCompletion)completion
{
  SparkBiometricCompletion done = Once(completion);
  NSError *invalid = ValidKey(key);
  if (invalid) return done(nil, invalid);
#if SPARK_TEST_DRIVER
  if (_simulated) { [_secrets removeObjectForKey:key]; return done(NSNull.null, nil); }
#endif
  NSString *service = _service;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    LAContext *quiet = [LAContext new];
    quiet.interactionNotAllowed = YES;
    NSMutableDictionary *query = [SparkBiometricSecretQuery(service, key) mutableCopy];
    query[(__bridge id)kSecUseAuthenticationContext] = quiet;
    OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
    [quiet invalidate];
    NSError *failure = nil;
    if (status == errSecSuccess || status == errSecItemNotFound) done(NSNull.null, nil);
    else { NSDictionary *failed = KeychainFailed(status, @"Deleting the secret", &failure); done(failed, failure); }
  });
}

#if SPARK_TEST_DRIVER
// A simulated prompt: the policy's state decides whether it can appear; the set answer decides how it ends.
- (void)simulatePrompt:(NSString *)operation options:(NSDictionary *)options fallback:(NSString *)fallback identifier:(NSString *)identifier completion:(SparkBiometricCompletion)settle
{
  NSString *state = _simulation[[fallback isEqual:@"password"] ? @"password" : @"biometrics"];
  if (![state isEqual:@"available"]) {
    dispatch_async(dispatch_get_main_queue(), ^{ settle(Failed(state, [NSString stringWithFormat:@"Simulated %@", state]), nil); });
    return;
  }
  id answer = _simulation[@"answer"];
  NSError *refused = nil;
  if (answer == NSNull.null) refused = Failure(@"E_UNAVAILABLE", @"Test driver: no simulated answer for the biometric prompt (simulateBiometrics answer)");
  else if ([answer isEqual:@"userFallback"] && ![fallback isEqual:@"app"]) refused = Failure(@"E_UNAVAILABLE", @"Test driver: userFallback needs a prompt with fallback app; macOS shows no fallback button otherwise");
  if (refused) { dispatch_async(dispatch_get_main_queue(), ^{ settle(nil, refused); }); return; }
  _simulation[@"prompts"] = @([_simulation[@"prompts"] integerValue] + 1);
  NSMutableDictionary *prompt = [@{ @"operation": operation, @"reason": options[@"reason"], @"fallback": fallback } mutableCopy];
  if (options[@"cancelLabel"]) prompt[@"cancelLabel"] = options[@"cancelLabel"];
  if (options[@"fallbackLabel"]) prompt[@"fallbackLabel"] = options[@"fallbackLabel"];
  _simulation[@"lastPrompt"] = prompt;
  if ([answer isEqual:@"ignore"]) {
    // Stays up until cancelled, which ends it as invalidating a real context does.
    _active[identifier] = [^{ settle(Failed(@"appCancel", @"Simulated appCancel"), nil); } copy];
    return;
  }
  _active[identifier] = [^{} copy]; // Pending until the answer below arrives.
  NSDictionary *result = [answer isEqual:@"success"] ? @{ @"success": @YES } : Failed(answer, [NSString stringWithFormat:@"Simulated %@", answer]);
  dispatch_async(dispatch_get_main_queue(), ^{ settle(result, nil); });
}

- (BOOL)simulate:(NSDictionary *)state error:(NSError **)error
{
  NSDictionary<NSString *, NSArray *> *allowed = @{ @"biometryType": @[@"touchId", @"none", @"unknown"], @"biometrics": States, @"password": @[@"available", @"passcodeNotSet", @"notAvailable"],
    @"answer": @[@"success", @"userCancel", @"systemCancel", @"userFallback", @"authenticationFailed", @"ignore", NSNull.null] };
  NSError *failure = _simulated ? nil : Failure(@"E_UNAVAILABLE", @"Biometric simulation needs the test driver");
  for (NSString *field in state) {
    if (failure) break;
    if ([field isEqual:@"enrollmentChanged"]) { if (![state[field] isEqual:@YES]) failure = Failure(@"E_INVALID_ARGUMENT", @"enrollmentChanged is true"); }
    else if (!allowed[field]) failure = Failure(@"E_INVALID_ARGUMENT", [NSString stringWithFormat:@"Unknown biometric simulation field: %@", field]);
    else if (![allowed[field] containsObject:state[field]]) failure = Failure(@"E_INVALID_ARGUMENT", [NSString stringWithFormat:@"%@ is not a simulated %@", state[field], field]);
  }
  if (failure) { if (error) *error = failure; return NO; }
  for (NSString *field in state) if (![field isEqual:@"enrollmentChanged"]) _simulation[field] = state[field];
  if (state[@"enrollmentChanged"])
    for (NSString *key in _secrets.allKeys) if ([_secrets[key][@"access"] isEqual:@"biometryCurrentSet"]) [_secrets removeObjectForKey:key];
  return YES;
}

- (NSDictionary *)simulation
{
  NSMutableDictionary *secrets = [NSMutableDictionary dictionary];
  for (NSString *key in _secrets) secrets[key] = _secrets[key][@"access"];
  NSMutableDictionary *simulation = [_simulation mutableCopy];
  simulation[@"secrets"] = secrets;
  simulation[@"pending"] = @(_active.count);
  return simulation;
}
#endif
@end
