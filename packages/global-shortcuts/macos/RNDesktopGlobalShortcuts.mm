#import "RNDesktopGlobalShortcuts.h"
#import <RNDesktopApp/SparkDesktop.h>
#import <RNDesktopApp/SparkTestDriver.h>
#import <Carbon/Carbon.h>
static OSStatus Hotkey(EventHandlerCallRef next, EventRef event, void *context);
static NSInteger KeyCode(NSString *key) {
  NSDictionary *special = @{ @"\r": @36, @"\t": @48, @" ": @49, @"\177": @51, @"\033": @53, @"\uf728": @117, @"\uf700": @126, @"\uf701": @125, @"\uf702": @123, @"\uf703": @124 };
  if (special[key]) return [special[key] integerValue];
  NSArray *functions = @[@122,@120,@99,@118,@96,@97,@98,@100,@101,@109,@103,@111,@105,@107,@113,@106,@64,@79,@80,@90];
  unichar character = [key characterAtIndex:0];
  if (character >= 0xf704 && character < 0xf718) return [functions[character - 0xf704] integerValue];
  TISInputSourceRef source = TISCopyCurrentASCIICapableKeyboardLayoutInputSource();
  CFDataRef data = source ? (CFDataRef)TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) : NULL;
  NSInteger found = -1;
  if (data) for (UInt16 code = 0; code < 128; code++) {
    UInt32 dead = 0; UniChar chars[8]; UniCharCount length = 0;
    OSStatus status = UCKeyTranslate((const UCKeyboardLayout *)CFDataGetBytePtr(data), code, kUCKeyActionDown, 0, LMGetKbdType(), kUCKeyTranslateNoDeadKeysMask, &dead, 8, &length, chars);
    if (status == noErr && [[[NSString stringWithCharacters:chars length:length] lowercaseString] isEqual:key]) { found = code; break; }
  }
  if (source) CFRelease(source); return found;
}
static UInt32 CarbonModifiers(NSUInteger flags) {
  UInt32 modifiers = 0;
  if (flags & NSEventModifierFlagCommand) modifiers |= cmdKey;
  if (flags & NSEventModifierFlagControl) modifiers |= controlKey;
  if (flags & NSEventModifierFlagShift) modifiers |= shiftKey;
  if (flags & NSEventModifierFlagOption) modifiers |= optionKey;
  return modifiers;
}
@class RNDesktopGlobalShortcuts;
static __weak RNDesktopGlobalShortcuts *Current;
@interface RNDesktopGlobalShortcuts ()
@property NSMutableDictionary *registrations;
@property EventHandlerRef handler;
@property UInt32 sequence;
#if SPARK_TEST_DRIVER
- (NSUInteger)simulate:(NSString *)key modifiers:(NSUInteger)flags;
#endif
@end
@implementation RNDesktopGlobalShortcuts
RCT_EXPORT_MODULE(NativeDesktopGlobalShortcuts)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (instancetype)init { if (self = [super init]) { _registrations = [NSMutableDictionary new]; Current = self; } return self; }
- (void)handle:(EventRef)event {
  EventHotKeyID key;
  if (GetEventParameter(event, kEventParamDirectObject, typeEventHotKeyID, NULL, sizeof(key), NULL, &key) != noErr || key.signature != 'LGDS') return;
  for (NSString *name in self.registrations) if ([self.registrations[name][@"number"] unsignedIntValue] == key.id) SparkEmit(@{ @"type": @"globalShortcut", @"id": name });
}
- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSDictionary *args = SparkArgs(json); NSString *key = args[@"id"];
    if ([method isEqual:@"register"]) {
      if (![args[@"key"] isKindOfClass:NSString.class] || ![args[@"key"] length]) { SparkInvalid(reject, @"Expected a shortcut key"); return; }
      NSInteger code = KeyCode(args[@"key"]);
      if (code < 0) { reject(@"E_KEY", @"Key is unavailable in the current keyboard layout", nil); return; }
      UInt32 modifiers = CarbonModifiers([args[@"modifiers"] unsignedIntegerValue]);
      for (NSDictionary *existing in self.registrations.allValues) if ([existing[@"code"] integerValue] == code && [existing[@"modifiers"] unsignedIntValue] == modifiers) { reject(@"E_BUSY", @"Shortcut already registered", nil); return; }
      if (self.registrations[key]) { reject(@"E_BUSY", @"Shortcut id already exists", nil); return; }
      // A driven app never registers a real hotkey with the system: the driver's simulateGlobalShortcut presses it.
      if (SparkTestDriverActive()) { self.registrations[key] = @{ @"code": @(code), @"modifiers": @(modifiers), @"number": @(++self.sequence) }; resolve(@"null"); return; }
      if (!self.handler) { EventTypeSpec spec = { kEventClassKeyboard, kEventHotKeyPressed }; EventHandlerRef handler;
        if (InstallEventHandler(GetEventDispatcherTarget(), Hotkey, 1, &spec, (__bridge void *)self, &handler) != noErr) { reject(@"E_SHORTCUT", @"Could not install hotkey handler", nil); return; } self.handler = handler; }
      EventHotKeyID identity = { 'LGDS', ++self.sequence }; EventHotKeyRef reference;
      if (RegisterEventHotKey((UInt32)code, modifiers, identity, GetEventDispatcherTarget(), 0, &reference) != noErr) { reject(@"E_BUSY", @"Shortcut is unavailable or reserved by another app", nil); return; }
      self.registrations[key] = @{ @"code": @(code), @"modifiers": @(modifiers), @"number": @(identity.id), @"reference": [NSValue valueWithPointer:reference] };
    } else if ([method isEqual:@"remove"]) {
      NSDictionary *value = self.registrations[key];
      if (value[@"reference"] && UnregisterEventHotKey((EventHotKeyRef)[value[@"reference"] pointerValue]) != noErr) { reject(@"E_NATIVE", @"Could not unregister global shortcut", nil); return; }
      [self.registrations removeObjectForKey:key];
    } else { SparkInvalid(reject, @"Unknown global shortcut operation"); return; }
    resolve(@"null");
  });
}
- (void)invalidate { dispatch_async(dispatch_get_main_queue(), ^{
  for (NSDictionary *value in self.registrations.allValues) if (value[@"reference"]) UnregisterEventHotKey((EventHotKeyRef)[value[@"reference"] pointerValue]);
  [self.registrations removeAllObjects]; if (self.handler) RemoveEventHandler(self.handler); self.handler = NULL;
}); }
#if SPARK_TEST_DRIVER
// The in-app test driver's hotkey press (docs/test-driver.md): {"command": "simulateGlobalShortcut", "key", "modifiers"}
// with the parsed accelerator (NSEventModifierFlags bits) delivers the registered shortcut's event as a press would.
// Reachable only through an authenticated driver session; registrations in driver mode never reach the system.
- (NSUInteger)simulate:(NSString *)key modifiers:(NSUInteger)flags {
  NSInteger code = KeyCode(key); UInt32 modifiers = CarbonModifiers(flags); NSUInteger delivered = 0;
  for (NSString *name in self.registrations) if ([self.registrations[name][@"code"] integerValue] == code && [self.registrations[name][@"modifiers"] unsignedIntValue] == modifiers) {
    SparkEmit(@{ @"type": @"globalShortcut", @"id": name }); delivered++;
  }
  return delivered;
}
#endif
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params { return std::make_shared<facebook::react::NativeDesktopGlobalShortcutsSpecJSI>(params); }
@end
#if SPARK_TEST_DRIVER
@interface SparkGlobalShortcutsDriver : NSObject
@end
@implementation SparkGlobalShortcutsDriver
+ (void)load {
  SparkTestDriverRegisterCommand(@"simulateGlobalShortcut", ^(NSDictionary *request, SparkTestDriverReply reply) {
    NSString *key = request[@"key"]; id modifiers = request[@"modifiers"];
    if (![key isKindOfClass:NSString.class] || key.length != 1 || ![modifiers isKindOfClass:NSNumber.class]) { reply(@{ @"ok": @NO, @"error": @{ @"code": @"E_INVALID_ARGUMENT", @"message": @"simulateGlobalShortcut expects a key and modifier flags" } }); return; }
    NSUInteger delivered = [Current simulate:key modifiers:[modifiers unsignedIntegerValue]];
    if (!delivered) { reply(@{ @"ok": @NO, @"error": @{ @"code": @"E_NOT_FOUND", @"message": @"No global shortcut is registered for that key" } }); return; }
    reply(@{ @"ok": @YES, @"delivered": @(delivered) });
  });
}
@end
#endif
static OSStatus Hotkey(EventHandlerCallRef next, EventRef event, void *context) { [(__bridge RNDesktopGlobalShortcuts *)context handle:event]; return noErr; }
