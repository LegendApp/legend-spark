#import "SparkSandbox.h"
#import <Security/Security.h>

BOOL SparkSandboxed(void) {
  static BOOL sandboxed;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    SecTaskRef task = SecTaskCreateFromSelf(NULL);
    CFTypeRef value = task ? SecTaskCopyValueForEntitlement(task, CFSTR("com.apple.security.app-sandbox"), NULL) : NULL;
    sandboxed = value && CFEqual(value, kCFBooleanTrue);
    if (value) CFRelease(value);
    if (task) CFRelease(task);
  });
  return sandboxed;
}
