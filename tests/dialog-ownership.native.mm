#include <cassert>
#include "dialog-native-prelude.h"
// ACTUAL_IMPLEMENTATION
@interface TestOwner : NSObject
@property NSString *identifier;
@property id attachedSheet;
@end
@implementation TestOwner @end
@interface TestApplication : NSObject
@property NSArray *windows;
@end
@implementation TestApplication @end
int main() { @autoreleasepool {
  TestApplication *app = [TestApplication new]; NSApplication *previous = NSApp; NSApp = (NSApplication *)app;
  RNFileDialog *files = [RNFileDialog new]; RNDesktopMessageDialog *messages = [RNDesktopMessageDialog new];
  TestOwner *owner = [TestOwner new]; owner.identifier = @"editor"; owner.attachedSheet = [NSObject new]; app.windows = @[owner];
  for (NSString *identifier in @[@"editor", @"main", @"missing"]) {
    owner.identifier = [identifier isEqual:@"main"] ? @"spark.main" : @"editor";
    NSString *json = SparkJSON(@{ @"windowId": identifier });
    for (int operation = 0; operation < 3; operation++) {
      __block NSString *failure = nil;
      RCTPromiseResolveBlock resolve = ^(id) { assert(false); };
      RCTPromiseRejectBlock reject = ^(NSString *code, NSString *, NSError *) { failure = code; };
      if (operation == 0) [files open:json resolve:resolve reject:reject];
      else if (operation == 1) [files save:json resolve:resolve reject:reject];
      else { [messages call:@"show" args:json resolve:resolve reject:reject]; for (int n=0; n<10 && !failure; n++) [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.001]]; }
      assert([failure isEqual:[identifier isEqual:@"missing"] ? @"E_NOT_FOUND" : @"E_BUSY"]);
    }
  }
  NSApp = previous; puts("Dialog ownership passed");
} }
