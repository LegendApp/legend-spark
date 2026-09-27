#import "RNDesktopTray.h"
#import <RNDesktopApp/SparkDesktop.h>

@interface SparkTrayItem : NSObject
@property NSString *identifier;
@property NSStatusItem *item;
@property NSDictionary *options;
- (void)clicked:(id)sender;
- (void)selected:(NSMenuItem *)sender;
@end
@implementation SparkTrayItem
- (void)clicked:(id)sender { SparkEmit(@{ @"type": @"trayClick", @"trayId": self.identifier }); }
- (void)selected:(NSMenuItem *)sender { SparkEmit(@{ @"type": @"trayAction", @"trayId": self.identifier, @"itemId": sender.representedObject }); }
@end
static NSMenu *Menu(NSArray *items, SparkTrayItem *owner) {
  NSMenu *menu = [NSMenu new]; menu.autoenablesItems = NO;
  for (NSDictionary *entry in items) {
    if ([entry[@"separator"] boolValue]) { [menu addItem:NSMenuItem.separatorItem]; continue; }
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:entry[@"title"] action:@selector(selected:) keyEquivalent:@""];
    item.target = owner; item.representedObject = entry[@"id"];
    item.enabled = !entry[@"enabled"] || [entry[@"enabled"] boolValue]; item.state = [entry[@"checked"] boolValue] ? NSControlStateValueOn : NSControlStateValueOff;
    if (entry[@"items"]) item.submenu = Menu(entry[@"items"], owner);
    [menu addItem:item];
  }
  return menu;
}
@interface RNDesktopTray ()
@property NSMutableDictionary<NSString *, SparkTrayItem *> *items;
@end
@implementation RNDesktopTray
RCT_EXPORT_MODULE(NativeDesktopTray)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (instancetype)init { if (self = [super init]) _items = [NSMutableDictionary new]; return self; }
- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSDictionary *args = SparkArgs(json); NSString *key = args[@"id"];
    if (![key isKindOfClass:NSString.class] || !key.length) { SparkInvalid(reject, @"Tray needs an id"); return; }
    SparkTrayItem *owner = self.items[key];
    if ([method isEqual:@"remove"]) { if (owner) [NSStatusBar.systemStatusBar removeStatusItem:owner.item]; [self.items removeObjectForKey:key]; resolve(@"null"); return; }
    if (![method isEqual:@"create"] && ![method isEqual:@"update"]) { SparkInvalid(reject, @"Unknown tray operation"); return; }
    if ([method isEqual:@"create"] && owner) { reject(@"E_ALREADY_EXISTS", @"Tray id already exists", nil); return; }
    if ([method isEqual:@"update"] && !owner) { reject(@"E_NOT_FOUND", @"Tray was removed", nil); return; }
    NSMutableDictionary *options = [owner.options mutableCopy] ?: [NSMutableDictionary new]; [options addEntriesFromDictionary:args];
    NSImage *image = nil;
    if ([options[@"symbol"] length]) {
      image = [NSImage imageWithSystemSymbolName:options[@"symbol"] accessibilityDescription:options[@"tooltip"] ?: options[@"title"]];
      if (!image) { SparkInvalid(reject, @"Unknown SF Symbol name"); return; }
      [image setTemplate:YES];
    }
    if (![options[@"title"] length] && !image) { SparkInvalid(reject, @"Tray needs a title or symbol"); return; }
    if (!owner) { owner = [SparkTrayItem new]; owner.identifier = key; owner.item = [NSStatusBar.systemStatusBar statusItemWithLength:NSVariableStatusItemLength]; self.items[key] = owner; }
    owner.options = options;
    owner.item.button.title = options[@"title"] ?: @""; owner.item.button.image = image;
    owner.item.button.imagePosition = NSImageLeft; owner.item.button.toolTip = options[@"tooltip"];
    owner.item.button.target = owner; owner.item.button.action = @selector(clicked:);
    owner.item.button.accessibilityIdentifier = [@"spark.tray." stringByAppendingString:key];
    owner.item.menu = [options[@"menu"] count] ? Menu(options[@"menu"], owner) : nil;
    resolve(@"null");
  });
}
- (void)invalidate { dispatch_async(dispatch_get_main_queue(), ^{ for (SparkTrayItem *owner in self.items.allValues) [NSStatusBar.systemStatusBar removeStatusItem:owner.item]; [self.items removeAllObjects]; }); }
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params { return std::make_shared<facebook::react::NativeDesktopTraySpecJSI>(params); }
@end
