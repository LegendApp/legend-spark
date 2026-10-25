// Appearance preferences (packages/system/macos/SparkAppearancePreferences.mm) as AppKit reports them to this
// process. tests/appearance-preferences-native.test.ts launches it with settings in its argument domain, so it
// reads known values without changing any user or system setting.
#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#import "SparkAppearancePreferences.h"
#include <cstdio>
#include <cstring>

static void Print(NSDictionary *value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys error:nil];
  printf("%s\n", [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
}

// --absent-interface-style reads AppleInterfaceStyle as absent, as macOS leaves it in Light mode; the argument
// domain can only add values.
static void HideInterfaceStyle() {
  Method method = class_getInstanceMethod(NSUserDefaults.class, @selector(stringForKey:));
  auto original = (NSString *(*)(id, SEL, NSString *))method_getImplementation(method);
  method_setImplementation(method, imp_implementationWithBlock(^NSString *(NSUserDefaults *defaults, NSString *key) {
    return [key isEqualToString:@"AppleInterfaceStyle"] ? nil : original(defaults, @selector(stringForKey:), key);
  }));
}

int main(int argc, char **argv) { @autoreleasepool {
  if (argc > 1 && strcmp(argv[1], "--absent-interface-style") == 0) HideInterfaceStyle();
  [NSApplication sharedApplication];
  NSString *error;
  NSDictionary *real = SparkAppearancePreferences(&error);
  if (!real) { fprintf(stderr, "%s\n", error.UTF8String); return 1; }
  Print(real);
} }
