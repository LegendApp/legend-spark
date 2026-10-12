// Privacy permissions (packages/permissions/macos/SparkPermissions.mm). Never reaches TCC: the simulated instance keeps
// its state in memory, and the real instance is only given requests that fail validation before any TCC call.
#import <AppKit/AppKit.h>
#import "SparkPermissions.h"
#include <cstdio>
#include <cstdlib>

#define CHECK(...) do { if (!(__VA_ARGS__)) { fprintf(stderr, "FAILED %s:%d %s\n", __FILE__, __LINE__, #__VA_ARGS__); exit(1); } } while (0)
static void Drain(void) { [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]]; }

typedef struct { int calls; NSString *authorization; NSString *code; } Outcome;
static SparkPermissionCompletion Record(Outcome *outcome) {
  return ^(NSString *authorization, NSError *error) {
    CHECK(NSThread.isMainThread);
    outcome->calls++;
    outcome->authorization = authorization;
    outcome->code = error ? SparkPermissionErrorCode(error) : nil;
  };
}

int main() { @autoreleasepool {
  [NSApplication sharedApplication];

  // Raw values to names; anything outside the documented enumeration is unknown, never guessed.
  CHECK([SparkMediaAuthorization(0) isEqual:@"notDetermined"] && [SparkMediaAuthorization(1) isEqual:@"restricted"]);
  CHECK([SparkMediaAuthorization(2) isEqual:@"denied"] && [SparkMediaAuthorization(3) isEqual:@"authorized"]);
  CHECK([SparkMediaAuthorization(4) isEqual:@"unknown"] && [SparkMediaAuthorization(-1) isEqual:@"unknown"]);
  CHECK([SparkCalendarAuthorization(3) isEqual:@"authorized"] && [SparkCalendarAuthorization(4) isEqual:@"writeOnly"] && [SparkCalendarAuthorization(5) isEqual:@"unknown"]);
  CHECK([SparkPhotosAuthorization(4) isEqual:@"unknown"]);    // Limited is iOS only.
  CHECK([SparkLocationAuthorization(3) isEqual:@"authorized"] && [SparkLocationAuthorization(4) isEqual:@"unknown"]);
  CHECK([SparkContactsAuthorization(4) isEqual:@"unknown"]);
  CHECK([SparkInputMonitoringAuthorization(0) isEqual:@"authorized"] && [SparkInputMonitoringAuthorization(1) isEqual:@"denied"]);
  CHECK([SparkInputMonitoringAuthorization(2) isEqual:@"notDetermined"] && [SparkInputMonitoringAuthorization(3) isEqual:@"unknown"]);
  NSError *error = nil;
  CHECK([SparkAutomationAuthorization(noErr, @"com.apple.finder", &error) isEqual:@"authorized"] && !error);
  CHECK([SparkAutomationAuthorization(errAEEventNotPermitted, @"com.apple.finder", &error) isEqual:@"denied"]);
  CHECK([SparkAutomationAuthorization(errAEEventWouldRequireUserConsent, @"com.apple.finder", &error) isEqual:@"notDetermined"]);
  CHECK(!SparkAutomationAuthorization(procNotFound, @"com.apple.finder", &error) && [SparkPermissionErrorCode(error) isEqual:@"E_NOT_FOUND"]);
  CHECK(!SparkAutomationAuthorization(-50, @"com.apple.finder", &error) && [SparkPermissionErrorCode(error) isEqual:@"E_NATIVE"]);

  // Every kind has a Privacy & Security pane and its authorizations; unknown kinds have neither.
  for (NSString *kind in SparkPermissionKinds()) {
    NSURL *url = SparkPermissionSettingsURL(kind);
    CHECK([url.scheme isEqual:@"x-apple.systempreferences"] && [url.absoluteString containsString:@"com.apple.preference.security?Privacy_"]);
    CHECK(SparkPermissionAuthorizations(kind).count >= 2);
  }
  CHECK([SparkPermissionSettingsURL(@"camera").absoluteString isEqual:@"x-apple.systempreferences:com.apple.preference.security?Privacy_Camera"]);
  CHECK([SparkPermissionSettingsURL(@"inputMonitoring").absoluteString hasSuffix:@"Privacy_ListenEvent"]);
  CHECK(!SparkPermissionSettingsURL(@"bluetooth") && SparkPermissionAuthorizations(@"bluetooth").count == 0);
  CHECK(SparkPermissionUsageKeys(@"screenRecording").count == 0 && [SparkPermissionUsageKeys(@"location") isEqual:@[@"NSLocationWhenInUseUsageDescription"]]);

  // A real instance: requests without their usage description, bad kinds and targets fail before any TCC call.
  SparkPermissions *real = [[SparkPermissions alloc] initWithInfo:@{} simulated:NO];
  Outcome missing = {}, badKind = {}, noTarget = {}, extraTarget = {};
  [real request:@"camera" target:nil completion:Record(&missing)];
  [real request:@"bluetooth" target:nil completion:Record(&badKind)];
  [real request:@"automation" target:nil completion:Record(&noTarget)];
  [real status:@"camera" target:@"com.apple.finder" completion:Record(&extraTarget)];
  CHECK(missing.calls == 1 && [missing.code isEqual:@"E_UNAVAILABLE"]);
  CHECK(badKind.calls == 1 && [badKind.code isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(noTarget.calls == 1 && [noTarget.code isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(extraTarget.calls == 1 && [extraTarget.code isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(![real openSettings:@"bluetooth" error:&error] && [SparkPermissionErrorCode(error) isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(![real simulate:@"camera" authorization:@"authorized" answer:nil error:&error] && [SparkPermissionErrorCode(error) isEqual:@"E_UNAVAILABLE"]);

  // The simulated instance: initial state, snapshot without automation, status reads.
  NSDictionary *info = @{ @"NSCameraUsageDescription": @"Video calls", @"NSCalendarsFullAccessUsageDescription": @"Agenda",
    @"NSLocationWhenInUseUsageDescription": @"Nearby", @"NSContactsUsageDescription": @"People" };
  SparkPermissions *simulated = [[SparkPermissions alloc] initWithInfo:info simulated:YES];
  __block int changes = 0;
  simulated.changeHandler = ^{ changes++; };
  NSDictionary *snapshot = simulated.snapshot;
  CHECK(snapshot.count == 9 && !snapshot[@"automation"]);
  CHECK([snapshot[@"camera"] isEqual:@"notDetermined"] && [snapshot[@"screenRecording"] isEqual:@"notGranted"] && [snapshot[@"accessibility"] isEqual:@"notGranted"]);
  Outcome status = {};
  [simulated status:@"automation" target:@"com.apple.finder" completion:Record(&status)];
  CHECK(status.calls == 1 && [status.authorization isEqual:@"notDetermined"]);

  // Without an answer the simulated prompt fails; the usage description is still required.
  Outcome unanswered = {}, undescribed = {};
  [simulated request:@"camera" target:nil completion:Record(&unanswered)];
  [simulated request:@"microphone" target:nil completion:Record(&undescribed)];
  Drain();
  CHECK(unanswered.calls == 1 && [unanswered.code isEqual:@"E_UNAVAILABLE"]);
  CHECK(undescribed.calls == 1 && [undescribed.code isEqual:@"E_UNAVAILABLE"]);
  CHECK([[simulated simulation:@"microphone"][@"requests"] isEqual:@0]);

  // Concurrent requests share one prompt; each completion runs once, on the main thread; the change is reported.
  CHECK([simulated simulate:@"camera" authorization:nil answer:@"allow" error:&error]);
  Outcome first = {}, second = {};
  int before = changes;
  [simulated request:@"camera" target:nil completion:Record(&first)];
  [simulated request:@"camera" target:nil completion:Record(&second)];
  Drain();
  CHECK(first.calls == 1 && second.calls == 1 && [first.authorization isEqual:@"authorized"] && [second.authorization isEqual:@"authorized"]);
  NSDictionary *camera = [simulated simulation:@"camera"];
  CHECK([camera[@"prompts"] isEqual:@1] && [camera[@"requests"] isEqual:@2] && [camera[@"authorization"] isEqual:@"authorized"]);
  CHECK(changes == before + 1);
  // Decided: no prompt.
  Outcome decided = {};
  [simulated request:@"camera" target:nil completion:Record(&decided)];
  Drain();
  CHECK(decided.calls == 1 && [decided.authorization isEqual:@"authorized"] && [[simulated simulation:@"camera"][@"prompts"] isEqual:@1]);

  // Write-only calendar access can be raised with another prompt; a denied answer stays denied.
  CHECK([simulated simulate:@"calendar" authorization:@"writeOnly" answer:@"deny" error:&error]);
  Outcome calendar = {};
  [simulated request:@"calendar" target:nil completion:Record(&calendar)];
  Drain();
  CHECK([calendar.authorization isEqual:@"denied"] && [[simulated simulation:@"calendar"][@"prompts"] isEqual:@1]);
  // Screen recording denied stays notGranted, as macOS reports it.
  CHECK([simulated simulate:@"screenRecording" authorization:nil answer:@"deny" error:&error]);
  Outcome screen = {};
  [simulated request:@"screenRecording" target:nil completion:Record(&screen)];
  Drain();
  CHECK([screen.authorization isEqual:@"notGranted"]);

  // Simulation validation; setting an unchanged authorization reports nothing; NSNull clears the answer.
  CHECK(![simulated simulate:@"camera" authorization:@"writeOnly" answer:nil error:&error] && [SparkPermissionErrorCode(error) isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(![simulated simulate:@"camera" authorization:nil answer:@"maybe" error:&error]);
  CHECK(![simulated simulate:@"bluetooth" authorization:nil answer:nil error:&error]);
  before = changes;
  CHECK([simulated simulate:@"camera" authorization:@"authorized" answer:NSNull.null error:&error] && changes == before);
  CHECK([simulated simulation:@"camera"][@"answer"] == NSNull.null);
  CHECK([simulated simulate:@"photos" authorization:@"unknown" answer:nil error:&error] && changes == before + 1);
  CHECK([simulated.snapshot[@"photos"] isEqual:@"unknown"]);

  // A prompt that never answers (macOS dropping a location request) settles with the current status after the timeout
  // and clears its pending entry, so the next request is not joined to it; activation with the status decided settles it early.
  simulated.answerTimeout = 0.3;
  CHECK([simulated simulate:@"location" authorization:nil answer:@"ignore" error:&error]);
  Outcome dropped = {}, joined = {};
  [simulated request:@"location" target:nil completion:Record(&dropped)];
  [simulated request:@"location" target:nil completion:Record(&joined)];
  Drain();
  [NSNotificationCenter.defaultCenter postNotificationName:NSApplicationDidBecomeActiveNotification object:NSApp]; Drain(); // Still undetermined.
  CHECK(dropped.calls == 0 && joined.calls == 0);
  [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.4]];
  CHECK(dropped.calls == 1 && joined.calls == 1 && [dropped.authorization isEqual:@"notDetermined"] && !dropped.code);
  CHECK([simulated simulate:@"location" authorization:nil answer:@"allow" error:&error]);
  Outcome fresh = {};
  [simulated request:@"location" target:nil completion:Record(&fresh)];
  Drain();
  CHECK(fresh.calls == 1 && [fresh.authorization isEqual:@"authorized"]);
  CHECK([simulated simulate:@"contacts" authorization:@"notDetermined" answer:@"ignore" error:&error]);
  Outcome activated = {};
  [simulated request:@"contacts" target:nil completion:Record(&activated)];
  Drain();
  CHECK([simulated simulate:@"contacts" authorization:@"denied" answer:nil error:&error]); // Changed in System Settings meanwhile.
  [NSNotificationCenter.defaultCenter postNotificationName:NSApplicationDidBecomeActiveNotification object:NSApp]; Drain();
  CHECK(activated.calls == 1 && [activated.authorization isEqual:@"denied"]);
  [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.4]]; // The timer finds nothing left to settle.
  CHECK(activated.calls == 1 && fresh.calls == 1);

  // Settings are recorded, never opened.
  CHECK([simulated openSettings:@"location" error:&error] && [[simulated simulation:@"location"][@"settingsOpened"] isEqual:@1]);
  printf("Permission native tests passed\n");
} return 0; }
