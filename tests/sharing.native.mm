// Sharing (packages/sharing/macos/SparkSharing.mm). Never shows a share picker, writes the Spotlight index or touches
// pbs: the real instance only gets requests that fail validation first and Services calls on a private pasteboard
// (NSApp.servicesProvider is in-process), and the simulated instance keeps everything in memory.
#import <AppKit/AppKit.h>
#import <CoreSpotlight/CoreSpotlight.h>
#import "SparkSharing.h"
#include <cstdio>
#include <cstdlib>

#define CHECK(...) do { if (!(__VA_ARGS__)) { fprintf(stderr, "FAILED %s:%d %s\n", __FILE__, __LINE__, #__VA_ARGS__); exit(1); } } while (0)
static void Drain(void) { [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]]; }

typedef struct { int calls; NSString *service; NSString *code; } Outcome;
static SparkShareCompletion Shared(Outcome *outcome) {
  return ^(NSString *service, NSError *error) {
    CHECK(NSThread.isMainThread);
    outcome->calls++; outcome->service = service; outcome->code = error ? SparkSharingErrorCode(error) : nil;
  };
}
static SparkSharingCompletion Done(Outcome *outcome) {
  return ^(NSError *error) { CHECK(NSThread.isMainThread); outcome->calls++; outcome->code = error ? SparkSharingErrorCode(error) : nil; };
}

int main() { @autoreleasepool {
  [NSApplication sharedApplication];
  NSError *error = nil;

  // SparkDesktop.mm matches Spotlight activities by these values without linking Core Spotlight.
  CHECK([CSSearchableItemActionType isEqual:@"com.apple.corespotlightitem"] && [CSSearchableItemActivityIdentifier isEqual:@"kCSSearchableItemActivityIdentifier"]);

  // Share items: text, web URLs and existing files; anything else is invalid, a missing file is not found.
  NSString *file = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"spark-share-%d.txt", getpid()]];
  [@"shared" writeToFile:file atomically:YES encoding:NSUTF8StringEncoding error:nil];
  NSArray *items = SparkShareItems(@[@{ @"type": @"text", @"text": @"Hi" }, @{ @"type": @"url", @"url": @"https://legendapp.com" }, @{ @"type": @"file", @"path": file }], &error);
  CHECK(items.count == 3 && [items[0] isEqual:@"Hi"] && [items[1] isEqual:[NSURL URLWithString:@"https://legendapp.com"]] && [items[2] isFileURL]);
  CHECK(!SparkShareItems(@[@{ @"type": @"file", @"path": @"/nonexistent/spark-share" }], &error) && [SparkSharingErrorCode(error) isEqual:@"E_NOT_FOUND"]);
  CHECK(!SparkShareItems(@[@{ @"type": @"url", @"url": @"file:///tmp/a" }], &error) && [SparkSharingErrorCode(error) isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(!SparkShareItems(@[@{ @"type": @"text", @"text": @"" }], &error) && [SparkSharingErrorCode(error) isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(!SparkShareItems(@[], &error) && [SparkSharingErrorCode(error) isEqual:@"E_INVALID_ARGUMENT"]);

  // Declared services: only NSServices entries for sparkService with a name.
  NSDictionary *info = @{ @"NSServices": @[
    @{ @"NSMessage": @"sparkService", @"NSUserData": @"Log", @"NSSendTypes": @[@"public.utf8-plain-text"] },
    @{ @"NSMessage": @"sparkService", @"NSUserData": @"Upper", @"NSSendTypes": @[@"public.utf8-plain-text"], @"NSReturnTypes": @[@"public.utf8-plain-text"] },
    @{ @"NSMessage": @"otherService", @"NSUserData": @"Other" }, @{ @"NSMessage": @"sparkService" } ] };
  CHECK([[SparkDeclaredServices(info).allKeys sortedArrayUsingSelector:@selector(compare:)] isEqual:(@[@"Log", @"Upper"])]);
  CHECK(SparkDeclaredServices(@{ @"NSServices": @"bad" }).count == 0);

  // Spotlight items.
  CHECK(SparkSpotlightItem(@{ @"id": @"a", @"title": @"A", @"keywords": @[@"x"], @"expiresAt": @1e12 }, &error));
  CHECK(!SparkSpotlightItem(@{ @"id": @"a" }, &error) && [SparkSharingErrorCode(error) isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(!SparkSpotlightItem(@{ @"id": @"a", @"title": @"A", @"keywords": @[@1] }, &error));

  // A real instance: share and Spotlight requests fail validation before any picker or index call; without a visible
  // window the share fails before the picker. Services run in-process on a private pasteboard.
  SparkSharing *real = [[SparkSharing alloc] initWithInfo:info simulated:NO];
  Outcome noWindow = {}, badShare = {}, badIndex = {}, badDelete = {}, both = {};
  [real share:@[@{ @"type": @"text", @"text": @"Hi" }] view:nil completion:Shared(&noWindow)];
  [real share:@[@{ @"type": @"nope" }] view:nil completion:Shared(&badShare)];
  [real index:@[@{ @"id": @"a" }] completion:Done(&badIndex)];
  [real deleteIdentifiers:@[] domains:nil completion:Done(&badDelete)];
  [real deleteIdentifiers:@[@"a"] domains:@[@"d"] completion:Done(&both)];
  Drain();
  CHECK(noWindow.calls == 1 && [noWindow.code isEqual:@"E_UNAVAILABLE"]);
  CHECK(badShare.calls == 1 && [badShare.code isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(badIndex.calls == 1 && [badIndex.code isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(badDelete.calls == 1 && [badDelete.code isEqual:@"E_INVALID_ARGUMENT"] && both.calls == 1 && [both.code isEqual:@"E_INVALID_ARGUMENT"]);
  CHECK(![real registerService:@"Missing" error:&error] && [SparkSharingErrorCode(error) isEqual:@"E_UNAVAILABLE"]);
  CHECK(![real registerService:@"Upper" error:&error] && [SparkSharingErrorCode(error) isEqual:@"E_UNSUPPORTED_OPTION"]);
  CHECK(![real simulateAnswer:@"Mail" services:nil error:&error] && [SparkSharingErrorCode(error) isEqual:@"E_UNAVAILABLE"]);
  __block NSMutableArray *received = [NSMutableArray array];
  real.serviceHandler = ^(NSDictionary *invocation) { [received addObject:invocation]; };
  CHECK(NSApp.servicesProvider == nil && [real registerService:@"Log" error:&error] && NSApp.servicesProvider == real);
  CHECK(![real registerService:@"Log" error:&error] && [SparkSharingErrorCode(error) isEqual:@"E_BUSY"]);
  NSPasteboard *pasteboard = [NSPasteboard pasteboardWithUniqueName];
  [pasteboard clearContents];
  [pasteboard writeObjects:@[[NSURL fileURLWithPath:file], [NSURL URLWithString:@"https://legendapp.com/a"]]];
  [pasteboard setString:@"selected" forType:NSPasteboardTypeString];
  NSString *message = nil;
  [real sparkService:pasteboard userData:@"Log" error:&message];
  CHECK(!message && received.count == 1 && [received[0][@"name"] isEqual:@"Log"] && [received[0][@"text"] isEqual:@"selected"]);
  CHECK([received[0][@"files"] isEqual:@[file]] && [received[0][@"urls"] isEqual:@[@"https://legendapp.com/a"]]);
  [real sparkService:pasteboard userData:@"Upper" error:&message];
  CHECK(message.length > 0 && received.count == 1); // Not registered: AppKit shows the message, the handler never runs.
  [pasteboard releaseGlobally];
  [real unregisterService:@"Log"];
  CHECK(NSApp.servicesProvider == nil);

  // The simulated instance records shares, answers with the configured choice, keeps the index in memory and takes
  // its declared services from the driver.
  SparkSharing *simulated = [[SparkSharing alloc] initWithInfo:info simulated:YES];
  Outcome unanswered = {}, mail = {}, dismissed = {}, missing = {};
  [simulated share:@[@{ @"type": @"text", @"text": @"Hi" }] view:nil completion:Shared(&unanswered)];
  Drain();
  CHECK(unanswered.calls == 1 && [unanswered.code isEqual:@"E_UNAVAILABLE"]);
  CHECK([simulated simulateAnswer:@"Mail" services:nil error:&error]);
  [simulated share:@[@{ @"type": @"url", @"url": @"https://legendapp.com" }] view:nil completion:Shared(&mail)];
  CHECK([simulated simulateAnswer:@"dismiss" services:nil error:&error]);
  [simulated share:@[@{ @"type": @"file", @"path": file }] view:[NSView new] completion:Shared(&dismissed)];
  [simulated share:@[@{ @"type": @"file", @"path": @"/nonexistent/spark-share" }] view:nil completion:Shared(&missing)];
  Drain();
  CHECK(mail.calls == 1 && [mail.service isEqual:@"Mail"] && !mail.code);
  CHECK(dismissed.calls == 1 && !dismissed.service && !dismissed.code);
  CHECK(missing.calls == 1 && [missing.code isEqual:@"E_NOT_FOUND"]);
  NSArray *shares = simulated.simulation[@"shares"];
  CHECK(shares.count == 3 && [shares[0][@"service"] isEqual:NSNull.null] && [shares[1][@"service"] isEqual:@"Mail"] && [shares[2][@"anchored"] isEqual:@YES]);
  CHECK([shares[1][@"items"] isEqual:@[@{ @"type": @"url", @"url": @"https://legendapp.com" }]]);
  CHECK(![simulated simulateAnswer:@3 services:nil error:&error] && [SparkSharingErrorCode(error) isEqual:@"E_INVALID_ARGUMENT"]);

  // Info.plist services are ignored; the driver declares them.
  CHECK(![simulated registerService:@"Log" error:&error] && [SparkSharingErrorCode(error) isEqual:@"E_UNAVAILABLE"]);
  CHECK([simulated simulateAnswer:nil services:@[@"Show"] error:&error] && [simulated.simulation[@"services"] isEqual:@[@"Show"]]);
  NSMutableArray *shown = [NSMutableArray array];
  simulated.serviceHandler = ^(NSDictionary *invocation) { [shown addObject:invocation]; };
  CHECK(![simulated invokeService:@"Show" text:@"x" error:&error] && [SparkSharingErrorCode(error) isEqual:@"E_NOT_FOUND"]);
  CHECK([simulated registerService:@"Show" error:&error] && NSApp.servicesProvider == nil);
  CHECK([simulated invokeService:@"Show" text:@"hello" error:&error] && shown.count == 1 && [shown[0][@"text"] isEqual:@"hello"]);
  CHECK([simulated.simulation[@"invocations"] isEqual:@1] && [simulated.simulation[@"registered"] isEqual:@[@"Show"]]);

  Outcome indexed = {}, byId = {}, byDomain = {}, all = {};
  [simulated index:@[@{ @"id": @"a", @"title": @"A", @"domain": @"d" }, @{ @"id": @"b", @"title": @"B", @"domain": @"d" }, @{ @"id": @"c", @"title": @"C" }] completion:Done(&indexed)];
  Drain();
  CHECK(indexed.calls == 1 && !indexed.code && [simulated.simulation[@"indexed"] count] == 3);
  [simulated deleteIdentifiers:@[@"c", @"zzz"] domains:nil completion:Done(&byId)];
  Drain();
  CHECK(byId.calls == 1 && [[simulated.simulation[@"indexed"] allKeys] count] == 2);
  [simulated deleteIdentifiers:nil domains:@[@"d"] completion:Done(&byDomain)];
  Drain();
  CHECK(byDomain.calls == 1 && [simulated.simulation[@"indexed"] count] == 0);
  [simulated index:@[@{ @"id": @"e", @"title": @"E" }] completion:Done(&indexed)];
  [simulated deleteIdentifiers:nil domains:nil completion:Done(&all)];
  Drain();
  CHECK(all.calls == 1 && !all.code && [simulated.simulation[@"indexed"] count] == 0);

  [NSFileManager.defaultManager removeItemAtPath:file error:nil];
  printf("Sharing native tests passed\n");
} return 0; }
