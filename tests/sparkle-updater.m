// Headless Sparkle client for tests/sparkle.integration.ts. Runs one real SPUUpdater
// check against a fixture host bundle and prints Spark's events (SparkUpdateState.h)
// for the same delegate callbacks RNDesktopUpdates.mm uses, then Spark's skip status.
// Downloads are redirected to a missing local file, so nothing is fetched or installed.
// Usage: sparkle-updater <host.app> <feed file URL> <background|interactive> <install|skip|dismiss|clear>
#import <Foundation/Foundation.h>
#import <Sparkle/Sparkle.h>
#import "../packages/updates/macos/SparkUpdateState.h"

static void Print(NSDictionary *value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys error:nil];
  printf("%s\n", [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
  fflush(stdout);
}

@interface Harness : NSObject <SPUUserDriver, SPUUpdaterDelegate>
@property NSString *feed;
@property SPUUserUpdateChoice choice;
@property NSUserDefaults *defaults;
@end
@implementation Harness
- (NSString *)feedURLStringForUpdater:(SPUUpdater *)updater { return self.feed; }
- (void)updater:(SPUUpdater *)updater didFindValidUpdate:(SUAppcastItem *)item { Print(SparkUpdateEvent(@"available", item, nil)); }
- (void)updaterDidNotFindUpdate:(SPUUpdater *)updater error:(NSError *)error { Print(SparkUpdateEvent(@"notAvailable", nil, nil)); }
- (void)updater:(SPUUpdater *)updater willDownloadUpdate:(SUAppcastItem *)item withRequest:(NSMutableURLRequest *)request {
  Print(SparkUpdateEvent(@"downloading", item, nil));
  request.URL = [NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:NSUUID.UUID.UUIDString]];
}
- (void)updater:(SPUUpdater *)updater userDidMakeChoice:(SPUUserUpdateChoice)choice forUpdate:(SUAppcastItem *)item state:(SPUUserUpdateState *)state {
  if (choice == SPUUserUpdateChoiceSkip) Print(SparkUpdateEvent(@"skipped", item, nil));
}
- (void)updater:(SPUUpdater *)updater didDownloadUpdate:(SUAppcastItem *)item { Print(SparkUpdateEvent(@"downloaded", item, nil)); }
- (void)updater:(SPUUpdater *)updater willInstallUpdate:(SUAppcastItem *)item { Print(SparkUpdateEvent(@"installing", item, nil)); }
- (void)updater:(SPUUpdater *)updater didAbortWithError:(NSError *)error { if (SparkReportsAbort(error)) Print(SparkUpdateEvent(@"error", nil, error)); }
- (void)updater:(SPUUpdater *)updater didFinishUpdateCycleForUpdateCheck:(SPUUpdateCheck)check error:(NSError *)error {
  Print(@{ @"status": SparkSkippedUpdates(self.defaults) });
  exit(0);
}
- (void)showUpdatePermissionRequest:(SPUUpdatePermissionRequest *)request reply:(void (^)(SUUpdatePermissionResponse *))reply {
  reply([[SUUpdatePermissionResponse alloc] initWithAutomaticUpdateChecks:NO sendSystemProfile:NO]);
}
- (void)showUserInitiatedUpdateCheckWithCancellation:(void (^)(void))cancellation {}
- (void)showUpdateFoundWithAppcastItem:(SUAppcastItem *)item state:(SPUUserUpdateState *)state reply:(void (^)(SPUUserUpdateChoice))reply { reply(self.choice); }
- (void)showUpdateReleaseNotesWithDownloadData:(SPUDownloadData *)downloadData {}
- (void)showUpdateReleaseNotesFailedToDownloadWithError:(NSError *)error {}
- (void)showUpdateNotFoundWithError:(NSError *)error acknowledgement:(void (^)(void))acknowledgement { acknowledgement(); }
- (void)showUpdaterError:(NSError *)error acknowledgement:(void (^)(void))acknowledgement { acknowledgement(); }
- (void)showDownloadInitiatedWithCancellation:(void (^)(void))cancellation {}
- (void)showDownloadDidReceiveExpectedContentLength:(uint64_t)expectedContentLength {}
- (void)showDownloadDidReceiveDataOfLength:(uint64_t)length {}
- (void)showDownloadDidStartExtractingUpdate {}
- (void)showExtractionReceivedProgress:(double)progress {}
- (void)showReadyToInstallAndRelaunch:(void (^)(SPUUserUpdateChoice))reply { reply(SPUUserUpdateChoiceDismiss); }
- (void)showInstallingUpdateWithApplicationTerminated:(BOOL)applicationTerminated retryTerminatingApplication:(void (^)(void))retryTerminatingApplication {}
- (void)showUpdateInstalledAndRelaunched:(BOOL)relaunched acknowledgement:(void (^)(void))acknowledgement { acknowledgement(); }
- (void)dismissUpdateInstallation {}
@end

int main(int argc, char **argv) {
  @autoreleasepool {
    if (argc != 5) { fprintf(stderr, "usage: sparkle-updater <host.app> <feed URL> <background|interactive> <install|skip|dismiss|clear>\n"); return 64; }
    NSBundle *host = [NSBundle bundleWithPath:@(argv[1])];
    NSString *action = @(argv[4]);
    Harness *harness = [Harness new];
    harness.feed = @(argv[2]);
    // Sparkle keeps a non-main host's preferences in a suite named by its bundle identifier.
    harness.defaults = [[NSUserDefaults alloc] initWithSuiteName:host.bundleIdentifier];
    if ([action isEqual:@"clear"]) { SparkClearSkippedUpdates(harness.defaults); Print(@{ @"status": SparkSkippedUpdates(harness.defaults) }); return 0; }
    harness.choice = [action isEqual:@"install"] ? SPUUserUpdateChoiceInstall : [action isEqual:@"skip"] ? SPUUserUpdateChoiceSkip : SPUUserUpdateChoiceDismiss;
    SPUUpdater *updater = [[SPUUpdater alloc] initWithHostBundle:host applicationBundle:host userDriver:harness delegate:harness];
    NSError *error = nil;
    if (![updater startUpdater:&error]) { fprintf(stderr, "startUpdater: %s\n", error.description.UTF8String); return 1; }
    if ([@(argv[3]) isEqual:@"background"]) [updater checkForUpdatesInBackground]; else [updater checkForUpdates];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 60 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ fprintf(stderr, "Timed out waiting for the update cycle\n"); exit(2); });
    [NSRunLoop.mainRunLoop run];
  }
  return 0;
}
