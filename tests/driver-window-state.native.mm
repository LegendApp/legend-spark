#import <AppKit/AppKit.h>
#import "SparkDesktop.h"
#import "SparkTestDriver.h"
#include <unistd.h>

// Usage: driver-window-state <driver|normal> <parent> -"NSWindow Frame spark.test.main" "<saved frame>"
// The saved frame is seeded in the argument domain, so nothing is written to the user's defaults.
// driver: in driver mode the main window keeps its configured size and is never autosaved.
// normal: outside driver mode the same seed is restored, constrained to this screen (the seed reaches setFrameUsingName:).

// What SparkWindow.mm uses of SparkDesktop.mm.
NSDictionary *SparkContext(void) { return @{ @"runtime": @{} }; }
NSDictionary *SparkArgs(NSString *json) { return @{}; }
BOOL SparkSafeMode(void) { return NO; }
NSString *SparkNamespace(void) { return @"spark.test"; }

static void Check(BOOL condition, NSString *message) {
  if (!condition) { fprintf(stderr, "FAILED: %s\n", message.UTF8String); exit(1); }
}
static void StartDriver(const char *parent) {
  char path[PATH_MAX];
  snprintf(path, sizeof path, "%s/run-XXXXXX", parent);
  Check(mkdtemp(path) != NULL, @"mkdtemp");
  NSString *token = [@(path) stringByAppendingPathComponent:@"token"];
  const char *value = "0123456789abcdef0123456789abcdef";
  int fd = open(token.fileSystemRepresentation, O_WRONLY | O_CREAT | O_EXCL, 0600);
  Check(fd >= 0 && write(fd, value, strlen(value)) == (ssize_t)strlen(value) && close(fd) == 0, @"token");
  setenv("SPARK_TEST_DRIVER_DIR", path, 1);
  Check(SparkTestDriverStart() && SparkTestDriverActive(), @"driver start");
}

// The host's main window before restoration: configured size, resizable, centered.
static NSWindow *ConfiguredWindow(void) {
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1000, 700) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  window.releasedWhenClosed = NO;
  SparkApplyWindowOptions(window, @{});
  [window center];
  return window;
}

int main(int argc, char **argv) { @autoreleasepool {
  NSString *mode = argc > 2 ? @(argv[1]) : @"";
  NSString *key = @"NSWindow Frame spark.test.main";
  [NSApplication sharedApplication];
  NSString *saved = [NSUserDefaults.standardUserDefaults stringForKey:key];
  Check(saved.length > 0, @"the saved frame is seeded");
  if ([mode isEqual:@"driver"]) StartDriver(argv[2]);
  else Check([mode isEqual:@"normal"], [@"unknown mode " stringByAppendingString:mode]);
  // Expectations come from AppKit on this screen, so a small display (CI) constrains them the same way:
  // the configured window as created, and the saved frame applied and constrained to the screen.
  NSSize configured = ConfiguredWindow().frame.size;
  NSWindow *probe = ConfiguredWindow();
  [probe setFrameFromString:saved];
  [probe setFrame:[probe constrainFrameRect:probe.frame toScreen:probe.screen ?: NSScreen.mainScreen] display:NO];
  NSSize restored = probe.frame.size;
  Check(!NSEqualSizes(configured, restored), [NSString stringWithFormat:@"the seed differs from the configured size on this screen (%@)", NSStringFromSize(restored)]);
  NSWindow *window = ConfiguredWindow();
  SparkRestoreWindow(window, @"main", @{ @"restoreFrame": @YES });
  NSString *actual = NSStringFromRect(window.frame);
  if ([mode isEqual:@"normal"]) {
    Check(NSEqualSizes(window.frame.size, restored), [NSString stringWithFormat:@"the saved frame is restored (%@, expected size %@)", actual, NSStringFromSize(restored)]);
    // setFrameAutosaveName: saved the frame to this process's own defaults domain; leave nothing behind.
    [window setFrameAutosaveName:@""];
    [NSUserDefaults.standardUserDefaults removePersistentDomainForName:NSProcessInfo.processInfo.processName];
  } else {
    Check(NSEqualSizes(window.frame.size, configured), [NSString stringWithFormat:@"driver mode keeps the configured size (%@, expected size %@)", actual, NSStringFromSize(configured)]);
    Check(window.frameAutosaveName.length == 0, @"driver mode never autosaves the frame");
    [window setFrame:NSMakeRect(0, 0, 900, 600) display:NO];
    Check(![NSUserDefaults.standardUserDefaults persistentDomainForName:NSProcessInfo.processInfo.processName][key], @"driver mode saves no frame");
  }
  printf("%s passed\n", mode.UTF8String);
  return 0;
} }
