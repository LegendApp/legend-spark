// Appearance preferences (packages/system/macos/SparkAppearancePreferences.mm) as AppKit reports them to this
// process. tests/appearance-preferences-native.test.ts launches it with settings in its argument domain, so it
// reads known values without changing any user or system setting.
#import <AppKit/AppKit.h>
#import "SparkAppearancePreferences.h"
#include <cstdio>

static void Print(NSDictionary *value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys error:nil];
  printf("%s\n", [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
}

int main() { @autoreleasepool {
  [NSApplication sharedApplication];
  NSString *error;
  NSDictionary *real = SparkAppearancePreferences(&error);
  if (!real) { fprintf(stderr, "%s\n", error.UTF8String); return 1; }
  Print(real);
} }
