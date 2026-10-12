#import <AppKit/AppKit.h>
#import <Carbon/Carbon.h>
#include <cassert>
#include <memory>
typedef void (^RCTPromiseResolveBlock)(id);
typedef void (^RCTPromiseRejectBlock)(NSString *, NSString *, NSError *);
#define RCT_EXPORT_MODULE(...)
namespace facebook::react {
struct TurboModule { virtual ~TurboModule() = default; };
struct ObjCTurboModule { struct InitParams {}; };
struct NativeDesktopGlobalShortcutsSpecJSI : TurboModule { NativeDesktopGlobalShortcutsSpecJSI(ObjCTurboModule::InitParams const &) {} };
}
@interface RNDesktopGlobalShortcuts : NSObject @end
static NSMutableArray *events;
static void SparkEmit(NSDictionary *event) { [events addObject:event]; }
static NSDictionary *SparkArgs(NSString *json) { return [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]; }
static void SparkInvalid(RCTPromiseRejectBlock reject, NSString *message) { reject(@"E_INVALID_ARGUMENT", message, nil); }
static BOOL SparkTestDriverActive(void) { return YES; }
typedef void (^SparkTestDriverReply)(NSDictionary *reply);
typedef void (^SparkTestDriverHandler)(NSDictionary *request, SparkTestDriverReply reply);
static NSMutableDictionary<NSString *, SparkTestDriverHandler> *driverCommands;
static void SparkTestDriverRegisterCommand(NSString *name, SparkTestDriverHandler handler) { if (!driverCommands) driverCommands = [NSMutableDictionary new]; driverCommands[name] = handler; }
// ACTUAL_IMPLEMENTATION
static void Pump() { for (int i = 0; i < 20; ++i) [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.001]]; }
static NSString *failure;
static void Call(RNDesktopGlobalShortcuts *api, NSString *method, NSDictionary *args) {
  failure = nil; __block BOOL done = NO;
  NSString *json = [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:args options:0 error:nil] encoding:NSUTF8StringEncoding];
  [api call:method args:json resolve:^(id) { done = YES; } reject:^(NSString *code, NSString *, NSError *) { failure = code; done = YES; }];
  for (int i = 0; i < 100 && !done; ++i) Pump();
}
static NSDictionary *Press(NSString *key, NSUInteger modifiers) {
  __block NSDictionary *answer; driverCommands[@"simulateGlobalShortcut"](@{ @"key": key, @"modifiers": @(modifiers) }, ^(NSDictionary *value) { answer = value; }); return answer;
}
// Driver mode: registrations never reach the system (no Carbon handler, no hot key), keep their conflict checks,
// and the driver's simulateGlobalShortcut delivers a registered shortcut's press.
int main() { @autoreleasepool {
  [NSApplication sharedApplication];
  events = [NSMutableArray new];
  RNDesktopGlobalShortcuts *api = [RNDesktopGlobalShortcuts new];
  const NSUInteger command = NSEventModifierFlagCommand, shift = NSEventModifierFlagShift;
  Call(api, @"register", @{ @"id": @"bar", @"key": @" ", @"modifiers": @(command | shift) }); assert(!failure);
  assert(api.handler == NULL); assert(!api.registrations[@"bar"][@"reference"]);
  Call(api, @"register", @{ @"id": @"other", @"key": @" ", @"modifiers": @(command | shift) }); assert([failure isEqual:@"E_BUSY"]);
  NSDictionary *reply = Press(@" ", command | shift);
  assert([reply[@"ok"] boolValue] && [reply[@"delivered"] isEqual:@1]);
  assert(events.count == 1 && [events.lastObject[@"type"] isEqual:@"globalShortcut"] && [events.lastObject[@"id"] isEqual:@"bar"]);
  assert([Press(@" ", command)[@"error"][@"code"] isEqual:@"E_NOT_FOUND"]);
  assert([Press(@"", command)[@"error"][@"code"] isEqual:@"E_INVALID_ARGUMENT"]);
  Call(api, @"remove", @{ @"id": @"bar" }); assert(!failure);
  assert([Press(@" ", command | shift)[@"error"][@"code"] isEqual:@"E_NOT_FOUND"]); assert(events.count == 1);
  puts("Driver global shortcuts passed");
} }
