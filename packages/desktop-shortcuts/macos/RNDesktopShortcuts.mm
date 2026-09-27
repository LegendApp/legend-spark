#import "RNDesktopShortcuts.h"
#import <RNDesktopApp/SparkDesktop.h>
@interface RNDesktopShortcuts ()
@property NSMutableDictionary *shortcuts;
@property id monitor;
@end
@implementation RNDesktopShortcuts
RCT_EXPORT_MODULE(NativeDesktopShortcuts)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (instancetype)init { if (self = [super init]) _shortcuts = [NSMutableDictionary new]; return self; }
- (NSArray<NSString *> *)supportedEvents { return @[@"shortcut"]; }
- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSDictionary *args = SparkArgs(json);
    if ([method isEqual:@"register"]) {
      for (NSDictionary *existing in self.shortcuts.allValues) {
        if ([existing[@"key"] isEqual:args[@"key"]] && [existing[@"modifiers"] isEqual:args[@"modifiers"]] &&
          ((!existing[@"windowId"] && !args[@"windowId"]) || [existing[@"windowId"] isEqual:args[@"windowId"]])) {
          reject(@"E_BUSY", @"Shortcut is already registered in this scope", nil); return;
        }
      }
      self.shortcuts[args[@"id"]] = args;
      if (!self.monitor) {
        __weak RNDesktopShortcuts *weakSelf = self;
        self.monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown handler:^NSEvent *(NSEvent *event) {
          RNDesktopShortcuts *strongSelf = weakSelf;
          NSUInteger flags = event.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagControl | NSEventModifierFlagOption | NSEventModifierFlagShift);
          NSString *windowID = [event.window.identifier hasPrefix:@"spark."] ? [event.window.identifier substringFromIndex:6] : nil;
          NSDictionary *match;
          for (NSDictionary *shortcut in strongSelf.shortcuts.allValues) {
            if ([shortcut[@"key"] isEqual:event.charactersIgnoringModifiers.lowercaseString] && flags == [shortcut[@"modifiers"] unsignedIntegerValue] &&
              (!shortcut[@"windowId"] || [shortcut[@"windowId"] isEqual:windowID])) {
              // A window-specific binding overrides the app-wide binding.
              if (!match || shortcut[@"windowId"]) match = shortcut;
            }
          }
          if (!match) return event;
          if (!event.isARepeat || [match[@"repeat"] boolValue]) [strongSelf sendEventWithName:@"shortcut" body:@{ @"id": match[@"id"] }];
          return nil;
        }];
      }
    } else if ([method isEqual:@"remove"]) {
      [self.shortcuts removeObjectForKey:args[@"id"]];
      if (!self.shortcuts.count && self.monitor) { [NSEvent removeMonitor:self.monitor]; self.monitor = nil; }
    } else { SparkInvalid(reject, @"Unknown shortcut operation"); return; }
    resolve(@"null");
  });
}
- (void)invalidate {
  dispatch_async(dispatch_get_main_queue(), ^{ if (self.monitor) [NSEvent removeMonitor:self.monitor]; self.monitor = nil; [self.shortcuts removeAllObjects]; });
  [super invalidate];
}
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeDesktopShortcutsSpecJSI>(params);
}
@end
