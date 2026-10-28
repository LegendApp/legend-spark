#import <ApplicationServices/ApplicationServices.h>
#import <Foundation/Foundation.h>
#include <unistd.h>

int main(int argc, const char **argv) { @autoreleasepool {
  if (!CGPreflightPostEventAccess()) {
    fprintf(stderr, "E_PERMISSION_DENIED: Real pointer input needs Accessibility permission for the e2e runner in System Settings > Privacy & Security > Accessibility. No permission prompt was opened.\n");
    return 77;
  }
  if (argc == 2 && strcmp(argv[1], "check") == 0) return 0;
  if (argc != 4) return 64;
  pid_t pid = (pid_t)strtol(argv[1], NULL, 10);
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
