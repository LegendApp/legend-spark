#import <AppKit/AppKit.h>
#import "SparkDesktop.h"
#import "SparkTestDriver.h"
#include <unistd.h>

// Usage: driver-window-state <driver|normal> <parent> -"NSWindow Frame spark.test.main" "<saved frame>"
// The saved frame is seeded in the argument domain, so nothing is written to the user's defaults.
// driver: in driver mode the main window keeps its configured size and is never autosaved.
// normal: the same seed is restored outside driver mode (the seed reaches setFrameUsingName:).

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

int main(int argc, char **argv) { @autoreleasepool {
  NSString *mode = argc > 2 ? @(argv[1]) : @"";
  NSString *key = @"NSWindow Frame spark.test.main";
  [NSApplication sharedApplication];
  Check([[NSUserDefaults.standardUserDefaults stringForKey:key] containsString:@"1040 720"], @"the saved frame is seeded");
  if ([mode isEqual:@"driver"]) StartDriver(argv[2]);
  else Check([mode isEqual:@"normal"], [@"unknown mode " stringByAppendingString:mode]);
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1000, 700) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
  window.releasedWhenClosed = NO;
  SparkApplyWindowOptions(window, @{}); // resizable, as the host's main window
  SparkRestoreWindow(window, @"main", @{ @"restoreFrame": @YES });
  NSSize size = [window contentRectForFrameRect:window.frame].size;
  if ([mode isEqual:@"normal"]) {
    Check(window.frame.size.width == 1040 && window.frame.size.height == 720, [NSString stringWithFormat:@"the saved frame is restored (%@)", NSStringFromRect(window.frame)]);
    // setFrameAutosaveName: saved the frame to this process's own defaults domain; leave nothing behind.
    [window setFrameAutosaveName:@""];
    [NSUserDefaults.standardUserDefaults removePersistentDomainForName:NSProcessInfo.processInfo.processName];
  } else {
    Check(size.width == 1000 && size.height == 700, [NSString stringWithFormat:@"driver mode keeps the configured size (%@)", NSStringFromSize(size)]);
    Check(window.frameAutosaveName.length == 0, @"driver mode never autosaves the frame");
    [window setFrame:NSMakeRect(0, 0, 900, 600) display:NO];
    Check(![NSUserDefaults.standardUserDefaults persistentDomainForName:NSProcessInfo.processInfo.processName][key], @"driver mode saves no frame");
  }
  printf("%s passed\n", mode.UTF8String);
  return 0;
} }
