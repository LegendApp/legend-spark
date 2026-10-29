#import <ApplicationServices/ApplicationServices.h>
#import <Foundation/Foundation.h>
#include <unistd.h>
#include <errno.h>
#include <limits.h>

int main(int argc, const char **argv) { @autoreleasepool {
  BOOL check = argc == 2 && strcmp(argv[1], "check") == 0;
  if (!check && argc != 4) {
    fprintf(stderr, "usage: macos-pointer check | <pid> <base64-down> <base64-up>\n");
    return 64;
  }
  char *end = NULL;
  errno = 0;
  long value = check ? 0 : strtol(argv[1], &end, 10);
  if (!check && (errno || *end || value <= 0 || value > INT_MAX)) {
    fprintf(stderr, "E_INVALID_ARGUMENT: Expected a positive process ID\n");
    return 64;
  }
  if (!CGPreflightPostEventAccess()) {
    fprintf(stderr, "E_PERMISSION_DENIED: Real pointer input needs Accessibility permission for the e2e runner in System Settings > Privacy & Security > Accessibility. No permission prompt was opened.\n");
    return 77;
  }
  if (check) return 0;
  pid_t pid = (pid_t)value;
  NSData *downData = [[NSData alloc] initWithBase64EncodedString:@(argv[2]) options:0];
  NSData *upData = [[NSData alloc] initWithBase64EncodedString:@(argv[3]) options:0];
  CGEventRef down = downData ? CGEventCreateFromData(NULL, (__bridge CFDataRef)downData) : NULL;
  CGEventRef up = upData ? CGEventCreateFromData(NULL, (__bridge CFDataRef)upData) : NULL;
  if (!down || !up) {
    if (down) CFRelease(down);
    if (up) CFRelease(up);
    fprintf(stderr, "E_EVENT: Could not decode mouse events\n");
    return 1;
  }
  CGEventPostToPid(pid, down);
  usleep(50000);
  CGEventPostToPid(pid, up);
  CFRelease(down); CFRelease(up);
  return 0;
} }
