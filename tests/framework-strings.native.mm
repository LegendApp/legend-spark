// The real SparkLocalization.mm in a background-only app (tests/framework-strings-native.test.ts): the desktop
// template's compiled main menu retitled at launch, getAppLanguages() and the per-app language.
#import <AppKit/AppKit.h>
#import "SparkLocalization.h"
static void Dump(NSMenu *menu, NSString *prefix, int depth) {
  for (NSMenuItem *item in menu.itemArray) {
    if (item.separatorItem) continue;
    NSString *path = prefix.length ? [NSString stringWithFormat:@"%@ > %@", prefix, item.title] : item.title;
    if (depth < 2) printf("%s\n", path.UTF8String);
    if (item.submenu) Dump(item.submenu, path, depth + 1);
  }
}
@interface AppDelegate : NSObject <NSApplicationDelegate> @end
@implementation AppDelegate
- (void)applicationWillFinishLaunching:(NSNotification *)note {
  SparkLocalizeMainMenu(@"Probe");
  Dump(NSApp.mainMenu, @"", 0);
  // Two levels of the menu, then the language report.
  NSData *json = [NSJSONSerialization dataWithJSONObject:SparkAppLanguages() options:0 error:nil];
  printf("languages=%s\n", [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
  printf("OK=%s Cancel=%s Search=%s\n", SparkLocalizedString(@"OK").UTF8String, SparkLocalizedString(@"Cancel").UTF8String, SparkLocalizedString(@"Search").UTF8String);
  @try { SparkLocalizedString(@"Not a Spark string"); printf("missing key did not raise\n"); } @catch (NSException *e) { printf("missing key raises: %s\n", e.reason.UTF8String); }
  exit(0);
}
@end
int main(int argc, const char **argv) {
  if (argc > 2 && !strcmp(argv[1], "set")) {
    NSString *language = strcmp(argv[2], "none") ? @(argv[2]) : nil;
    printf("set %s -> %s\n", argv[2], SparkSetAppLanguage(language) ? "YES" : "NO");
    [NSUserDefaults.standardUserDefaults synchronize];
    return 0;
  }
  return NSApplicationMain(argc, argv);
}
