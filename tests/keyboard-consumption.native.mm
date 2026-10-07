#import <AppKit/AppKit.h>
#import <IOKit/hidsystem/IOLLEvent.h>
#import <IOKit/hidsystem/ev_keymap.h>
#include <cassert>
#include <memory>
#include <chrono>
typedef void (^RCTPromiseResolveBlock)(id);
typedef void (^RCTPromiseRejectBlock)(NSString *, NSString *, NSError *);
#define RCT_EXPORT_MODULE(...)
#define TARGET_OS_OSX 1
namespace facebook::react {
struct TurboModule { virtual ~TurboModule() = default; };
struct ObjCTurboModule { struct InitParams {}; };
struct NativeKeyboardManagerSpecJSI : TurboModule { NativeKeyboardManagerSpecJSI(ObjCTurboModule::InitParams const &) {} };
}
static NSMutableArray *events;
static NSUInteger emitted;
@interface FixtureEmitter : NSObject
- (void)sendEventWithName:(NSString *)name body:(NSDictionary *)body;
- (void)invalidate;
@end
@implementation FixtureEmitter
- (void)invalidate {}
- (void)sendEventWithName:(NSString *)name body:(NSDictionary *)body { emitted++; if (events) [events addObject:@{ @"name":name, @"body":body }]; }
@end
@interface RNKeyboardManager : FixtureEmitter @end
// ACTUAL_IMPLEMENTATION
@interface FixtureWindow : NSObject
@property NSString *identifier;
@end
@implementation FixtureWindow @end
static void Configure(RNKeyboardManager *manager, NSString *owner, NSArray *rules, BOOL capture, BOOL valid = YES) {
  NSString *json = [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:rules options:0 error:nil] encoding:NSUTF8StringEncoding];
  __block BOOL done = NO, success = NO;
  [manager setConsumption:owner rulesJson:json capture:capture resolve:^(id) { done = YES; success = YES; } reject:^(NSString *code, NSString *, NSError *) { assert([code isEqual:@"E_INVALID_ARGUMENT"]); done = YES; }];
  for (int n = 0; n < 100 && !done; n++) [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.001]];
  assert(done && success == valid);
}
static NSDictionary *Rule(NSString *key, NSUInteger modifiers, BOOL extra = NO, BOOL repeat = NO, NSArray *windows = nil, NSArray *excluded = nil) {
  NSMutableDictionary *rule = [@{ @"key":key, @"modifiers":@(modifiers), @"allowExtraModifiers":@(extra), @"repeat":@(repeat) } mutableCopy];
  if (windows) rule[@"windowIds"] = windows;
  if (excluded) rule[@"excludedWindowIds"] = excluded;
  return rule;
}
static BOOL Key(RNKeyboardManager *manager, BOOL down, NSString *key, NSInteger code, NSUInteger modifiers = 0, NSWindow *window = nil, BOOL repeated = NO) {
  return [manager emitKeyboardEvent:down ? @"onKeyDown" : @"onKeyUp" keyCode:code key:key modifiers:modifiers window:window repeated:repeated];
}
static NSEvent *KeyboardEvent(CGKeyCode code, bool down, CGEventFlags flags = 0) {
  CGEventRef event = CGEventCreateKeyboardEvent(NULL, code, down);
  // A null source inherits the live keyboard state, including held modifiers.
  CGEventSetFlags(event, flags);
  NSEvent *result = [NSEvent eventWithCGEvent:event];
  CFRelease(event);
  return result;
}
int main() { @autoreleasepool {
  events = [NSMutableArray new]; RNKeyboardManager *manager = [RNKeyboardManager new]; [manager startObserving];
  FixtureWindow *main = [FixtureWindow new]; main.identifier = @"spark.main";
  FixtureWindow *other = [FixtureWindow new]; other.identifier = @"other";
  NSUInteger cmd = NSEventModifierFlagCommand, shift = NSEventModifierFlagShift, caps = NSEventModifierFlagCapsLock, fn = NSEventModifierFlagFunction;
  Configure(manager, @"one", @[Rule(@"A", cmd, NO, NO, @[@"main"], @[@"blocked"])], NO);
  assert(!Key(manager, YES, @"a", 0, cmd, (NSWindow *)other));
  assert(!Key(manager, YES, @"a", 0, cmd | shift, (NSWindow *)main));
  assert(Key(manager, YES, @"a", 0, cmd | caps, (NSWindow *)main));
  assert([events.lastObject[@"body"][@"windowId"] isEqual:@"main"]);
  assert(![events.lastObject[@"body"][@"captured"] boolValue]);
  assert(!events.lastObject[@"body"][@"eventId"]);
  assert(!Key(manager, YES, @"a", 0, cmd, (NSWindow *)main, YES));
  assert([events.lastObject[@"body"][@"repeated"] boolValue]);
  assert(Key(manager, NO, @"a", 0, 0, (NSWindow *)other)); assert(!Key(manager, NO, @"a", 0));
  Configure(manager, @"one", @[Rule(@"a", cmd, YES, YES)], NO);
  assert(Key(manager, YES, @"a", 0, cmd | shift, nil, YES)); assert(Key(manager, NO, @"a", 0));
  Configure(manager, @"one", @[Rule(@"\uf702", cmd)], NO);
  assert(Key(manager, YES, @"\uf702", 123, cmd | fn)); assert(Key(manager, NO, @"\uf702", 123));
  Configure(manager, @"one", @[Rule(@"\uf702", cmd | fn), Rule(@"a", cmd | caps)], NO);
  assert(!Key(manager, YES, @"\uf702", 123, cmd)); assert(Key(manager, YES, @"\uf702", 123, cmd | fn)); Key(manager, NO, @"\uf702", 123);
  assert(!Key(manager, YES, @"a", 0, cmd)); assert(Key(manager, YES, @"a", 0, cmd | caps)); Key(manager, NO, @"a", 0);
  Configure(manager, @"one", @[Rule(@"a", cmd, NO, NO, nil, @[@"main"])], NO);
  assert(!Key(manager, YES, @"a", 0, cmd, (NSWindow *)main)); assert(Key(manager, YES, @"a", 0, cmd, (NSWindow *)other)); Key(manager, NO, @"a", 0);
  // An invalid update must leave the previous owner's shortcuts untouched.
  Configure(manager, @"one", @[Rule(@"z", cmd), @{ @"key":@"bad", @"modifiers":@1, @"repeat":@NO, @"allowExtraModifiers":@NO }], YES, NO);
  assert(!Key(manager, YES, @"z", 6, cmd)); assert(Key(manager, YES, @"a", 0, cmd)); Key(manager, NO, @"a", 0);
  Configure(manager, @"two", @[Rule(@"z", 0)], NO);
  assert(Key(manager, YES, @"a", 0, cmd));
  Configure(manager, @"one", @[], NO);
  assert(Key(manager, NO, @"a", 0));
  assert(!Key(manager, YES, @"a", 0, cmd)); assert(Key(manager, YES, @"z", 6)); Key(manager, NO, @"z", 6);
  Configure(manager, @"capture-one", @[], YES); Configure(manager, @"capture-two", @[], YES);
  assert(Key(manager, YES, @"q", 12)); assert([events.lastObject[@"body"][@"captured"] boolValue]);
  Configure(manager, @"capture-one", @[], NO); assert(Key(manager, YES, @"w", 13));
  Configure(manager, @"capture-two", @[], NO);
  assert(Key(manager, NO, @"q", 12)); assert([events.lastObject[@"body"][@"captured"] boolValue]);
  assert(Key(manager, NO, @"w", 13)); assert(!Key(manager, YES, @"q", 12));
  Configure(manager, @"two", @[Rule(@"MediaPlayPause", 0)], NO);
  NSEvent *mediaDown = [NSEvent otherEventWithType:NSEventTypeSystemDefined location:NSZeroPoint modifierFlags:0 timestamp:0 windowNumber:0 context:nil subtype:NX_SUBTYPE_AUX_CONTROL_BUTTONS data1:(NX_KEYTYPE_PLAY << 16) | (NX_KEYDOWN << 8) data2:0];
  NSEvent *mediaUp = [NSEvent otherEventWithType:NSEventTypeSystemDefined location:NSZeroPoint modifierFlags:0 timestamp:0 windowNumber:0 context:nil subtype:NX_SUBTYPE_AUX_CONTROL_BUTTONS data1:(NX_KEYTYPE_PLAY << 16) | (NX_KEYUP << 8) data2:0];
  assert([manager handleKeyboardEvent:mediaDown] == nil); assert([events.lastObject[@"body"][@"keyCode"] integerValue] == 10001);
  assert([manager handleKeyboardEvent:mediaUp] == nil);
  Configure(manager, @"two", @[Rule(@"a", 0)], NO);
  NSEvent *keyDown = [NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint modifierFlags:0 timestamp:0 windowNumber:0 context:nil characters:@"a" charactersIgnoringModifiers:@"a" isARepeat:NO keyCode:0];
  NSEvent *repeatDown = [NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint modifierFlags:0 timestamp:0 windowNumber:0 context:nil characters:@"a" charactersIgnoringModifiers:@"a" isARepeat:YES keyCode:0];
  assert([manager handleKeyboardEvent:keyDown] == nil); assert([events.lastObject[@"body"][@"key"] isEqual:@"a"]);
  assert([manager handleKeyboardEvent:repeatDown] == repeatDown); assert([events.lastObject[@"body"][@"repeated"] boolValue]);
  Key(manager, NO, @"a", 0);
  // Navigation keys must reach JavaScript as AppKit's private-use codes, which accelerators
  // parse, and not as the C0 control characters modifier-stripping produces.
  Configure(manager, @"two", @[Rule(@"\uf703", 0)], NO);
  NSEvent *right = KeyboardEvent(124, true);
  assert([manager handleKeyboardEvent:right] == nil);
  assert([events.lastObject[@"body"][@"key"] isEqualToString:@"\uf703"]);
  assert([events.lastObject[@"body"][@"consumed"] boolValue]);
  NSEvent *rightUpEvent = KeyboardEvent(124, false);
  assert([manager handleKeyboardEvent:rightUpEvent] == nil);
  NSEvent *shiftRight = KeyboardEvent(124, true, NX_SHIFTMASK);
  assert([manager handleKeyboardEvent:shiftRight] == shiftRight);
  assert([events.lastObject[@"body"][@"key"] isEqualToString:@"\uf703"]);
  assert(![events.lastObject[@"body"][@"consumed"] boolValue]);
  // Tab is C0 but identifies no navigation key, so its accelerator keeps matching.
  Configure(manager, @"two", @[Rule(@"\t", 0)], NO);
  NSEvent *tab = KeyboardEvent(48, true);
  assert([manager handleKeyboardEvent:tab] == nil);
  assert([events.lastObject[@"body"][@"key"] isEqualToString:@"\t"]);
  Key(manager, NO, @"\t", 48);
  // Backspace arrives as U+0008 but its accelerator spells U+007F.
  Configure(manager, @"two", @[Rule(@"\u007f", 0)], NO);
  NSEvent *backspace = KeyboardEvent(51, true);
  assert([manager handleKeyboardEvent:backspace] == nil);
  assert([events.lastObject[@"body"][@"key"] isEqualToString:@"\u007f"]);
  Key(manager, NO, @"\u007f", 51);
  // A control chord on a letter must keep reporting that letter to Cmd/Ctrl accelerators.
  Configure(manager, @"two", @[Rule(@"i", NSEventModifierFlagControl)], NO);
  NSEvent *controlI = KeyboardEvent(34, true, NX_CONTROLMASK);
  assert([manager handleKeyboardEvent:controlI] == nil);
  assert([events.lastObject[@"body"][@"key"] isEqualToString:@"i"]);
  Key(manager, NO, @"i", 34);
  Configure(manager, @"two", @[Rule(@"a", 0)], NO);
  assert(Key(manager, YES, @"a", 0));
  [manager stopMonitoringInternal]; assert(!Key(manager, NO, @"a", 0)); assert(Key(manager, YES, @"a", 0)); Key(manager, NO, @"a", 0);
  // Native matching still applies if no observer is listening; emission does not.
  [manager stopObserving]; NSUInteger previous = emitted; assert(Key(manager, YES, @"a", 0)); assert(emitted == previous); Key(manager, NO, @"a", 0);
  [manager startObserving]; events = nil;
  auto start = std::chrono::steady_clock::now();
  for (int n = 0; n < 10000; n++) { Key(manager, YES, @"a", 0); Key(manager, NO, @"a", 0); }
  auto milliseconds = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
  assert(milliseconds < 1000); // The old 10 ms sleep would take 200 seconds.
  printf("Keyboard consumption passed: 20000 events in %.3f ms\n", milliseconds);
  [manager invalidate];
  [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
  assert(!Key(manager, YES, @"a", 0));
} }
