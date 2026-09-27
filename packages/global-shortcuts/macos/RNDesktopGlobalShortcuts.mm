#import "RNDesktopGlobalShortcuts.h"
#import <RNDesktopApp/SparkDesktop.h>
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
@interface RNDesktopGlobalShortcuts ()
@property NSMutableDictionary *registrations;
@property EventHandlerRef handler;
@property UInt32 sequence;
@end
@implementation RNDesktopGlobalShortcuts
RCT_EXPORT_MODULE(NativeDesktopGlobalShortcuts)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (instancetype)init { if (self = [super init]) _registrations = [NSMutableDictionary new]; return self; }
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
      NSUInteger flags = [args[@"modifiers"] unsignedIntegerValue]; UInt32 modifiers = 0;
      if (flags & NSEventModifierFlagCommand) modifiers |= cmdKey;
      if (flags & NSEventModifierFlagControl) modifiers |= controlKey;
      if (flags & NSEventModifierFlagShift) modifiers |= shiftKey;
      if (flags & NSEventModifierFlagOption) modifiers |= optionKey;
      for (NSDictionary *existing in self.registrations.allValues) if ([existing[@"code"] integerValue] == code && [existing[@"modifiers"] unsignedIntValue] == modifiers) { reject(@"E_BUSY", @"Shortcut already registered", nil); return; }
      if (self.registrations[key]) { reject(@"E_BUSY", @"Shortcut id already exists", nil); return; }
      if (!self.handler) { EventTypeSpec spec = { kEventClassKeyboard, kEventHotKeyPressed }; EventHandlerRef handler;
        if (InstallEventHandler(GetEventDispatcherTarget(), Hotkey, 1, &spec, (__bridge void *)self, &handler) != noErr) { reject(@"E_SHORTCUT", @"Could not install hotkey handler", nil); return; } self.handler = handler; }
      EventHotKeyID identity = { 'LGDS', ++self.sequence }; EventHotKeyRef reference;
      if (RegisterEventHotKey((UInt32)code, modifiers, identity, GetEventDispatcherTarget(), 0, &reference) != noErr) { reject(@"E_BUSY", @"Shortcut is unavailable or reserved by another app", nil); return; }
      self.registrations[key] = @{ @"code": @(code), @"modifiers": @(modifiers), @"number": @(identity.id), @"reference": [NSValue valueWithPointer:reference] };
    } else if ([method isEqual:@"remove"]) {
      NSDictionary *value = self.registrations[key];
      if (value && UnregisterEventHotKey((EventHotKeyRef)[value[@"reference"] pointerValue]) != noErr) { reject(@"E_NATIVE", @"Could not unregister global shortcut", nil); return; }
      [self.registrations removeObjectForKey:key];
    } else { SparkInvalid(reject, @"Unknown global shortcut operation"); return; }
    resolve(@"null");
  });
}
- (void)invalidate { dispatch_async(dispatch_get_main_queue(), ^{
  for (NSDictionary *value in self.registrations.allValues) UnregisterEventHotKey((EventHotKeyRef)[value[@"reference"] pointerValue]);
  [self.registrations removeAllObjects]; if (self.handler) RemoveEventHandler(self.handler); self.handler = NULL;
}); }
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params { return std::make_shared<facebook::react::NativeDesktopGlobalShortcutsSpecJSI>(params); }
@end
static OSStatus Hotkey(EventHandlerCallRef next, EventRef event, void *context) { [(__bridge RNDesktopGlobalShortcuts *)context handle:event]; return noErr; }
