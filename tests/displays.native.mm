// Display details and change observation (packages/desktop-windows/macos/SparkDisplays.mm) against the
// real screens of this Mac. Notifications are posted in this process only: no display setting changes.
#import <AppKit/AppKit.h>
#import "SparkDisplays.h"
#include <cstdio>
#include <cstdlib>

#define CHECK(...) do { if (!(__VA_ARGS__)) { fprintf(stderr, "FAILED %s:%d %s\n", __FILE__, __LINE__, #__VA_ARGS__); exit(1); } } while (0)
static void Drain(void) { [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]]; }
static double Number(NSDictionary *value, NSString *key) { return [value[key] doubleValue]; }

int main() { @autoreleasepool {
  [NSApplication sharedApplication];
  NSArray<NSDictionary *> *displays = SparkDisplayDetails();
  CHECK(displays.count == NSScreen.screens.count && displays.count > 0);
  NSUInteger primaries = 0;
  for (NSDictionary *display in displays) {
    NSDictionary *refresh = display[@"refreshRate"], *color = display[@"colorSpace"], *edr = display[@"edrHeadroom"], *safe = display[@"safeArea"];
    if ([display[@"primary"] boolValue]) { primaries++; CHECK(Number(display[@"origin"], @"x") == 0 && Number(display[@"origin"], @"y") == 0); }
    CHECK(Number(refresh, @"minimum") > 0 && Number(refresh, @"minimum") <= Number(refresh, @"maximum"));
    CHECK([refresh[@"variable"] boolValue] == (Number(refresh, @"minimum") < Number(refresh, @"maximum")));
    CHECK([@[@"srgb", @"p3"] containsObject:color[@"gamut"]]);
    CHECK(Number(edr, @"potential") >= 1 && Number(edr, @"current") >= 1);
    for (NSString *edge in @[@"top", @"left", @"bottom", @"right"]) CHECK(Number(safe, edge) >= 0);
    CHECK([NSJSONSerialization isValidJSONObject:display]);
    printf("display %s %s: %gx%g @%gx, refresh %g-%g Hz variable=%d, color %s %s, EDR %g/%g, safe top %g\n", [display[@"id"] UTF8String], [display[@"name"] UTF8String],
      Number(display[@"size"], @"width"), Number(display[@"size"], @"height"), Number(display, @"scaleFactor"), Number(refresh, @"minimum"), Number(refresh, @"maximum"),
      [refresh[@"variable"] boolValue], [[color[@"name"] description] UTF8String], [color[@"gamut"] UTF8String], Number(edr, @"current"), Number(edr, @"potential"), Number(safe, @"top"));
  }
  CHECK(primaries == 1);

  __block int calls = 0;
  SparkDisplayObserver *observer = [[SparkDisplayObserver alloc] initWithHandler:^{ calls++; }];
  [NSNotificationCenter.defaultCenter postNotificationName:NSApplicationDidChangeScreenParametersNotification object:NSApp]; Drain();
  CHECK(calls == 1);
  [NSNotificationCenter.defaultCenter postNotificationName:NSScreenColorSpaceDidChangeNotification object:NSScreen.mainScreen]; Drain();
  CHECK(calls == 2);
  NSArray *simulated = @[@{ @"id": @"101", @"primary": @YES, @"refreshRate": @{ @"minimum": @60, @"maximum": @60, @"variable": @NO } }];
  CHECK(!SparkDisplaysSimulated());
  SparkSimulateDisplays(simulated); Drain();
  CHECK(calls == 3 && SparkDisplaysSimulated() && [SparkDisplayDetails() isEqual:simulated]);
  SparkSimulateDisplays(nil); Drain();
  CHECK(calls == 4 && !SparkDisplaysSimulated() && [SparkDisplayDetails() isEqual:displays]);
  [observer stop];
  [NSNotificationCenter.defaultCenter postNotificationName:NSApplicationDidChangeScreenParametersNotification object:NSApp]; Drain();
  CHECK(calls == 4);
  puts("Display native tests passed");
} }
