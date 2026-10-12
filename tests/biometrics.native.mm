// Biometric authentication and secrets (packages/biometrics/macos/SparkBiometrics.mm). Never shows a Touch ID or password
// prompt and never touches a keychain: the simulated instance keeps its state in memory, and the real instance only
// reads canEvaluatePolicy: (which never prompts) and gets requests that fail validation first.
#import <LocalAuthentication/LocalAuthentication.h>
#import "SparkBiometrics.h"
#include <cstdio>
#include <cstdlib>
#include <initializer_list>

#define CHECK(...) do { if (!(__VA_ARGS__)) { fprintf(stderr, "FAILED %s:%d %s\n", __FILE__, __LINE__, #__VA_ARGS__); exit(1); } } while (0)
static void Drain(void) { [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]]; }

typedef struct { int calls; id result; NSString *code; } Outcome;
static SparkBiometricCompletion Record(Outcome *outcome) {
  return ^(id result, NSError *error) {
    CHECK(NSThread.isMainThread);
    outcome->calls++;
    outcome->result = result;
    outcome->code = error ? SparkBiometricErrorCode(error) : nil;
  };
}
static BOOL Failed(Outcome outcome, NSString *reason) {
  return outcome.calls == 1 && !outcome.code && [outcome.result[@"success"] isEqual:@NO] && [outcome.result[@"reason"] isEqual:reason];
}
static BOOL Succeeded(Outcome outcome) { return outcome.calls == 1 && !outcome.code && [outcome.result[@"success"] isEqual:@YES]; }

int main() { @autoreleasepool {
  // Every LAError the SDK names maps to its reason; any other code is unnamed (E_NATIVE), never folded into one.
  NSDictionary<NSNumber *, NSString *> *failures = @{
    @(LAErrorAuthenticationFailed): @"authenticationFailed", @(LAErrorUserCancel): @"userCancel", @(LAErrorUserFallback): @"userFallback",
    @(LAErrorSystemCancel): @"systemCancel", @(LAErrorPasscodeNotSet): @"passcodeNotSet", @(LAErrorBiometryNotAvailable): @"notAvailable",
    @(LAErrorBiometryNotEnrolled): @"notEnrolled", @(LAErrorBiometryLockout): @"lockout", @(LAErrorAppCancel): @"appCancel",
    @(LAErrorInvalidContext): @"invalidContext", @(LAErrorNotInteractive): @"notInteractive", @(LAErrorBiometryNotPaired): @"notPaired",
    @(LAErrorBiometryDisconnected): @"disconnected",
  };
  for (NSNumber *code in failures) CHECK([SparkBiometricFailure(code.integerValue) isEqual:failures[code]]);
  CHECK(!SparkBiometricFailure(-1000) && !SparkBiometricFailure(0));
  CHECK([SparkBiometryTypeName(LABiometryTypeTouchID) isEqual:@"touchId"] && [SparkBiometryTypeName(LABiometryTypeNone) isEqual:@"none"]);
  CHECK([SparkBiometryTypeName(LABiometryTypeFaceID) isEqual:@"unknown"]);
  CHECK([SparkBiometricKeychainFailure(errSecUserCanceled) isEqual:@"userCancel"] && [SparkBiometricKeychainFailure(errSecAuthFailed) isEqual:@"authenticationFailed"]);
  CHECK([SparkBiometricKeychainFailure(errSecInteractionNotAllowed) isEqual:@"notInteractive"] && [SparkBiometricKeychainFailure(errSecMissingEntitlement) isEqual:@"missingEntitlement"]);
  CHECK(!SparkBiometricKeychainFailure(errSecDuplicateItem) && !SparkBiometricKeychainFailure(errSecParam));
  CHECK(SparkBiometricAccessFlags(@"biometryCurrentSet") == kSecAccessControlBiometryCurrentSet && SparkBiometricAccessFlags(@"biometryAny") == kSecAccessControlBiometryAny);
  CHECK(SparkBiometricAccessFlags(@"biometryOrPassword") == kSecAccessControlUserPresence && SparkBiometricAccessFlags(@"password") == 0);
  NSDictionary *query = SparkBiometricSecretQuery(@"so.legend.test.biometrics", @"vault");
  CHECK([query[(__bridge id)kSecUseDataProtectionKeychain] isEqual:@YES] && [query[(__bridge id)kSecAttrAccount] isEqual:@"vault"]);
  CHECK([query[(__bridge id)kSecAttrService] isEqual:@"so.legend.test.biometrics"] && [query[(__bridge id)kSecClass] isEqual:(__bridge id)kSecClassGenericPassword]);

  // A real instance: status only asks canEvaluatePolicy:, which never prompts; invalid requests fail before any LAContext
  // evaluation or keychain call.
  SparkBiometrics *real = [[SparkBiometrics alloc] initWithService:@"so.legend.test.biometrics" simulated:NO];
  CHECK(!real.simulated);
  NSArray *states = @[@"available", @"notAvailable", @"notEnrolled", @"lockout", @"passcodeNotSet", @"disconnected", @"notPaired"];
  Outcome realStatus = {};
  [real status:Record(&realStatus)];
  CHECK(realStatus.calls == 1);
  CHECK(realStatus.code ? [realStatus.code isEqual:@"E_NATIVE"] : ([states containsObject:realStatus.result[@"biometrics"]] && [states containsObject:realStatus.result[@"password"]]));
  Outcome noReason = {}, badFallback = {}, badLabel = {}, badKey = {}, badAccess = {}, badDelete = {}, secretFallback = {};
  [real authenticate:@{ @"fallback": @"none" } identifier:@"1" completion:Record(&noReason)];
  [real authenticate:@{ @"reason": @"Unlock", @"fallback": @"faceId" } identifier:@"2" completion:Record(&badFallback)];
  [real authenticate:@{ @"reason": @"Unlock", @"fallback": @"none", @"fallbackLabel": @"Sign in" } identifier:@"3" completion:Record(&badLabel)];
  [real secret:@"no spaces" options:@{ @"reason": @"Unlock" } identifier:@"4" completion:Record(&badKey)];
  [real setSecret:@"vault" value:@"x" access:@"password" completion:Record(&badAccess)];
  [real deleteSecret:@"" completion:Record(&badDelete)];
  [real secret:@"vault" options:@{ @"reason": @"Unlock", @"fallback": @"password" } identifier:@"5" completion:Record(&secretFallback)];
  for (Outcome outcome : { noReason, badFallback, badLabel, badKey, badAccess, badDelete, secretFallback }) CHECK(outcome.calls == 1 && [outcome.code isEqual:@"E_INVALID_ARGUMENT"]);
  NSError *error = nil;
  CHECK(![real simulate:@{ @"answer": @"success" } error:&error] && [SparkBiometricErrorCode(error) isEqual:@"E_UNAVAILABLE"]);

  // The simulated instance starts with an available Touch ID and no answer.
  SparkBiometrics *simulated = [[SparkBiometrics alloc] initWithService:@"so.legend.test.biometrics" simulated:YES];
  CHECK(simulated.simulated);
  CHECK([simulated.simulation[@"biometryType"] isEqual:@"touchId"] && [simulated.simulation[@"answer"] isEqual:NSNull.null] && [simulated.simulation[@"prompts"] isEqual:@0]);
  Outcome status = {};
  [simulated status:Record(&status)];
  CHECK([status.result isEqual:@{ @"biometryType": @"touchId", @"biometrics": @"available", @"password": @"available" }]);

  // Without an answer a prompt fails E_UNAVAILABLE and counts nothing.
  Outcome unanswered = {};
  [simulated authenticate:@{ @"reason": @"Unlock", @"fallback": @"none" } identifier:@"a" completion:Record(&unanswered)];
  Drain();
  CHECK(unanswered.calls == 1 && [unanswered.code isEqual:@"E_UNAVAILABLE"] && [simulated.simulation[@"prompts"] isEqual:@0]);

  // Success; the prompt records its options; each completion runs once, on the main thread.
  CHECK([simulated simulate:@{ @"answer": @"success" } error:&error]);
  Outcome success = {};
  [simulated authenticate:@{ @"reason": @"Unlock the vault", @"fallback": @"none", @"cancelLabel": @"Not now" } identifier:@"b" completion:Record(&success)];
  Drain();
  CHECK(Succeeded(success) && [simulated.simulation[@"prompts"] isEqual:@1] && [simulated.simulation[@"pending"] isEqual:@0]);
  CHECK([simulated.simulation[@"lastPrompt"] isEqual:@{ @"operation": @"authenticate", @"reason": @"Unlock the vault", @"fallback": @"none", @"cancelLabel": @"Not now" }]);

  // The person's outcomes are results.
  for (NSString *answer in @[@"userCancel", @"systemCancel", @"authenticationFailed"]) {
    CHECK([simulated simulate:@{ @"answer": answer } error:&error]);
    Outcome outcome = {};
    [simulated authenticate:@{ @"reason": @"Unlock", @"fallback": @"password" } identifier:@"c" completion:Record(&outcome)];
    Drain();
    CHECK(Failed(outcome, answer));
  }
  // userFallback needs the app's fallback button.
  CHECK([simulated simulate:@{ @"answer": @"userFallback" } error:&error]);
  Outcome noButton = {}, button = {};
  [simulated authenticate:@{ @"reason": @"Unlock", @"fallback": @"none" } identifier:@"d" completion:Record(&noButton)];
  [simulated authenticate:@{ @"reason": @"Unlock", @"fallback": @"app", @"fallbackLabel": @"Use account password" } identifier:@"e" completion:Record(&button)];
  Drain();
  CHECK(noButton.calls == 1 && [noButton.code isEqual:@"E_UNAVAILABLE"]);
  CHECK(Failed(button, @"userFallback") && [simulated.simulation[@"lastPrompt"][@"fallbackLabel"] isEqual:@"Use account password"]);

  // Lockout: biometrics alone cannot prompt; the password fallback still can.
  CHECK([simulated simulate:@{ @"biometrics": @"lockout", @"answer": @"success" } error:&error]);
  Outcome locked = {}, password = {};
  [simulated authenticate:@{ @"reason": @"Unlock", @"fallback": @"none" } identifier:@"f" completion:Record(&locked)];
  Drain();
  [simulated authenticate:@{ @"reason": @"Unlock", @"fallback": @"password" } identifier:@"g" completion:Record(&password)];
  Drain();
  CHECK(Failed(locked, @"lockout") && Succeeded(password));
  CHECK([simulated simulate:@{ @"biometrics": @"notEnrolled", @"password": @"passcodeNotSet" } error:&error]);
  Outcome noPassword = {};
  [simulated authenticate:@{ @"reason": @"Unlock", @"fallback": @"password" } identifier:@"h" completion:Record(&noPassword)];
  Drain();
  CHECK(Failed(noPassword, @"passcodeNotSet"));
  CHECK([simulated simulate:@{ @"biometrics": @"available", @"password": @"available" } error:&error]);

  // A prompt that is not answered stays pending: others fail E_BUSY until cancelling ends it with appCancel.
  CHECK([simulated simulate:@{ @"answer": @"ignore" } error:&error]);
  Outcome ignored = {}, busy = {};
  [simulated authenticate:@{ @"reason": @"Unlock", @"fallback": @"none" } identifier:@"i" completion:Record(&ignored)];
  [simulated secret:@"vault" options:@{ @"reason": @"Unlock" } identifier:@"j" completion:Record(&busy)];
  Drain();
  CHECK(ignored.calls == 0 && busy.calls == 1 && [busy.code isEqual:@"E_BUSY"] && [simulated.simulation[@"pending"] isEqual:@1]);
  [simulated cancel:@"i"];
  [simulated cancel:@"i"];
  Drain();
  CHECK(Failed(ignored, @"appCancel") && [simulated.simulation[@"pending"] isEqual:@0]);

  // Secrets: a missing one reads null without a prompt; stored ones prompt as their access requires.
  CHECK([simulated simulate:@{ @"answer": @"success" } error:&error]);
  int prompts = [simulated.simulation[@"prompts"] intValue];
  Outcome missing = {}, current = {}, any = {}, either = {};
  [simulated secret:@"vault" options:@{ @"reason": @"Unlock" } identifier:@"k" completion:Record(&missing)];
  Drain();
  CHECK(Succeeded(missing) && missing.result[@"value"] == NSNull.null && [simulated.simulation[@"prompts"] intValue] == prompts);
  [simulated setSecret:@"vault" value:@"s3cret" access:@"biometryCurrentSet" completion:Record(&current)];
  [simulated setSecret:@"token" value:@"t0ken" access:@"biometryAny" completion:Record(&any)];
  [simulated setSecret:@"pin" value:@"1234" access:@"biometryOrPassword" completion:Record(&either)];
  CHECK(current.result == NSNull.null && any.result == NSNull.null && either.result == NSNull.null);
  CHECK([simulated.simulation[@"secrets"] isEqual:@{ @"vault": @"biometryCurrentSet", @"token": @"biometryAny", @"pin": @"biometryOrPassword" }]);
  Outcome read = {};
  [simulated secret:@"vault" options:@{ @"reason": @"Read the vault" } identifier:@"l" completion:Record(&read)];
  Drain();
  CHECK(Succeeded(read) && [read.result[@"value"] isEqual:@"s3cret"] && [simulated.simulation[@"lastPrompt"][@"operation"] isEqual:@"secret"]);
  CHECK([simulated.simulation[@"lastPrompt"][@"fallback"] isEqual:@"none"]);
  // A biometryOrPassword secret is readable with the password while biometrics are locked out; the others are not.
  CHECK([simulated simulate:@{ @"biometrics": @"lockout" } error:&error]);
  Outcome lockedOut = {}, withPassword = {};
  [simulated secret:@"token" options:@{ @"reason": @"Read" } identifier:@"m" completion:Record(&lockedOut)];
  Drain();
  [simulated secret:@"pin" options:@{ @"reason": @"Read" } identifier:@"n" completion:Record(&withPassword)];
  Drain();
  CHECK(Failed(lockedOut, @"lockout") && Succeeded(withPassword) && [withPassword.result[@"value"] isEqual:@"1234"]);
  // Storing needs the access's policy to be evaluable.
  Outcome cannotStore = {};
  [simulated setSecret:@"other" value:@"x" access:@"biometryAny" completion:Record(&cannotStore)];
  CHECK(Failed(cannotStore, @"lockout") && !simulated.simulation[@"secrets"][@"other"]);
  CHECK([simulated simulate:@{ @"biometrics": @"available" } error:&error]);
  // A cancelled read is a result.
  CHECK([simulated simulate:@{ @"answer": @"userCancel" } error:&error]);
  Outcome cancelled = {};
  [simulated secret:@"token" options:@{ @"reason": @"Read" } identifier:@"o" completion:Record(&cancelled)];
  Drain();
  CHECK(Failed(cancelled, @"userCancel"));
  // Changing enrolled fingerprints removes only biometryCurrentSet secrets; deleting is idempotent.
  CHECK([simulated simulate:@{ @"enrollmentChanged": @YES } error:&error]);
  CHECK([simulated.simulation[@"secrets"] isEqual:@{ @"token": @"biometryAny", @"pin": @"biometryOrPassword" }]);
  Outcome deleted = {}, deletedAgain = {};
  [simulated deleteSecret:@"token" completion:Record(&deleted)];
  [simulated deleteSecret:@"token" completion:Record(&deletedAgain)];
  CHECK(deleted.result == NSNull.null && deletedAgain.result == NSNull.null && [simulated.simulation[@"secrets"] isEqual:@{ @"pin": @"biometryOrPassword" }]);

  // Simulation validation leaves the state unchanged.
  CHECK(![simulated simulate:@{ @"biometrics": @"maybe" } error:&error] && [SparkBiometricErrorCode(error) isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(![simulated simulate:@{ @"password": @"lockout" } error:&error]);
  CHECK(![simulated simulate:@{ @"answer": @"success", @"faceId": @YES } error:&error] && [simulated.simulation[@"answer"] isEqual:@"userCancel"]);
  CHECK(![simulated simulate:@{ @"enrollmentChanged": @NO } error:&error]);
  CHECK([simulated simulate:@{ @"answer": NSNull.null, @"biometryType": @"none", @"biometrics": @"notAvailable" } error:&error]);
  Outcome noSensor = {};
  [simulated status:Record(&noSensor)];
  CHECK([noSensor.result isEqual:@{ @"biometryType": @"none", @"biometrics": @"notAvailable", @"password": @"available" }]);

  printf("Biometric native tests passed\n");
} return 0; }
