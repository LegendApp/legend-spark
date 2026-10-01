#import "RNNativeMenu.h"
#import <React/RCTUtils.h>
#import <AppKit/AppKit.h>
#import <objc/runtime.h>

static char RoleKey, LocationKey;
static NSDictionary<NSString *, NSString *> *RoleSelectors(void) {
  return @{ @"new": @"newDocument:", @"open": @"openDocument:", @"save": @"saveDocument:", @"saveAs": @"saveDocumentAs:", @"clearRecentDocuments": @"clearRecentDocuments:",
    @"about": @"orderFrontStandardAboutPanel:", @"settings": @"showPreferencesWindow:", @"hide": @"hide:", @"hideOthers": @"hideOtherApplications:", @"showAll": @"unhideAllApplications:", @"quit": @"terminate:",
    @"undo": @"undo:", @"redo": @"redo:", @"cut": @"cut:", @"copy": @"copy:", @"paste": @"paste:", @"selectAll": @"selectAll:", @"minimize": @"performMiniaturize:", @"zoom": @"performZoom:", @"close": @"performClose:", @"toggleFullscreen": @"toggleFullScreen:" };
}
static NSString *Role(NSMenuItem *item) {
  NSString *role = objc_getAssociatedObject(item, &RoleKey);
  if (role) return role;
  if (item.submenu && item.submenu == NSApp.servicesMenu) return @"services";
  // React Native's macOS storyboard reserves Command-comma for Preferences,
  // but leaves its action unset until an application supplies a handler.
  if (!item.action && !item.submenu && [item.keyEquivalent isEqual:@","] &&
      item.keyEquivalentModifierMask == NSEventModifierFlagCommand) return @"settings";
  NSString *action = item.action ? NSStringFromSelector(item.action) : @"";
  if ([action isEqual:@"showSettingsWindow:"] || [action isEqual:@"showPreferences:"]) return @"settings";
  for (NSString *key in RoleSelectors()) if ([RoleSelectors()[key] isEqual:action]) return key;
  return nil;
}
static NSMenuItem *Find(NSMenu *menu, NSDictionary *target, BOOL recursive) {
  for (NSMenuItem *item in menu.itemArray) {
    if ((target[@"id"] && [item.identifier isEqual:target[@"id"]]) || (target[@"role"] && [Role(item) isEqual:target[@"role"]]) || (target[@"menu"] && [objc_getAssociatedObject(item, &LocationKey) isEqual:target[@"menu"]])) return item;
    if (recursive && item.submenu) { NSMenuItem *found = Find(item.submenu, target, YES); if (found) return found; }
  }
  return nil;
}
static void Fail(NSString *code, NSString *message) { @throw [NSException exceptionWithName:code reason:message userInfo:nil]; }

@interface RNNativeMenu ()
@property NSMutableArray<void (^)(void)> *undo;
@property NSArray *published;
- (void)restore;
@end
@implementation RNNativeMenu
RCT_EXPORT_MODULE(NativeMenu)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (instancetype)init { if (self = [super init]) { _undo = [NSMutableArray new]; _published = @[]; } return self; }
- (NSArray<NSString *> *)supportedEvents { return @[@"NativeMenuAction"]; }
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params { return std::make_shared<facebook::react::NativeMenuSpecJSI>(params); }
- (void)restore { for (void (^undo)(void) in self.undo.reverseObjectEnumerator) undo(); [self.undo removeAllObjects]; }
- (void)identifyNativeMenus {
  NSMenu *main = NSApp.mainMenu;
  for (NSMenuItem *item in main.itemArray) {
    if (objc_getAssociatedObject(item, &LocationKey)) continue;
    NSString *location = nil;
    if (item == main.itemArray.firstObject) location = @"app";
    else if (item.submenu == NSApp.windowsMenu) location = @"window";
    else if (item.submenu == NSApp.helpMenu) location = @"help";
    else if (Find(item.submenu, @{ @"role": @"copy" }, YES) || Find(item.submenu, @{ @"role": @"undo" }, YES)) location = @"edit";
    else if (Find(item.submenu, @{ @"role": @"open" }, YES) || Find(item.submenu, @{ @"role": @"close" }, YES)) location = @"file";
    else if (Find(item.submenu, @{ @"role": @"toggleFullscreen" }, YES)) location = @"view";
    if (location) objc_setAssociatedObject(item, &LocationKey, location, OBJC_ASSOCIATION_COPY_NONATOMIC);
  }
}
- (NSInteger)index:(NSDictionary *)placement inMenu:(NSMenu *)menu {
  if (!placement) return menu.numberOfItems;
  NSDictionary *target = placement[@"before"] ?: placement[@"after"];
  NSMenuItem *item = Find(menu, target, NO);
  if (!item) Fail(@"E_NOT_FOUND", @"Menu placement target was not found");
  return [menu indexOfItem:item] + (placement[@"after"] ? 1 : 0);
}
- (void)save:(NSMenuItem *)item {
  NSMenu *menu = item.menu; NSInteger index = [menu indexOfItem:item];
  NSString *title = item.title, *key = item.keyEquivalent, *identifier = item.identifier;
  id target = item.target, represented = item.representedObject, role = objc_getAssociatedObject(item, &RoleKey);
  SEL action = item.action; BOOL enabled = item.enabled, hidden = item.hidden;
  NSControlStateValue state = item.state; NSEventModifierFlags modifiers = item.keyEquivalentModifierMask;
  NSImage *image = item.image;
  [self.undo addObject:^{
    item.title = title; item.keyEquivalent = key; item.identifier = identifier; item.target = target; item.action = action;
    item.representedObject = represented; item.enabled = enabled; item.hidden = hidden; item.state = state; item.keyEquivalentModifierMask = modifiers; item.image = image;
    objc_setAssociatedObject(item, &RoleKey, role, OBJC_ASSOCIATION_COPY_NONATOMIC);
    if (item.menu == menu && index >= 0 && [menu indexOfItem:item] != index) { [menu removeItem:item]; [menu insertItem:item atIndex:MIN(index, menu.numberOfItems)]; }
  }];
}
- (void)apply:(NSDictionary *)config to:(NSMenuItem *)item {
  if (config[@"title"]) item.title = config[@"title"];
  if (config[@"enabled"]) item.enabled = [config[@"enabled"] boolValue];
  if (config[@"hidden"]) item.hidden = [config[@"hidden"] boolValue];
  if (config[@"checked"]) item.state = [config[@"checked"] boolValue] ? NSControlStateValueOn : NSControlStateValueOff;
  NSDictionary *shortcut = config[@"shortcut"];
  if (shortcut) { item.keyEquivalent = shortcut[@"key"]; item.keyEquivalentModifierMask = [shortcut[@"modifiers"] unsignedIntegerValue]; }
  if (config[@"systemImageName"] || config[@"imagePath"]) {
    NSImage *image = config[@"systemImageName"] ? [NSImage imageWithSystemSymbolName:config[@"systemImageName"] accessibilityDescription:item.title] : [[NSImage alloc] initWithContentsOfFile:config[@"imagePath"]];
    if (!image) Fail(@"E_INVALID_ARGUMENT", @"Menu image could not be loaded");
    item.image = image;
  }
}
- (void)install:(NSArray *)configs into:(NSMenu *)menu root:(BOOL)root {
  for (NSDictionary *config in configs) {
    if ([config[@"separator"] boolValue]) {
      NSMenuItem *item = NSMenuItem.separatorItem; [menu addItem:item]; [self.undo addObject:^{ if (item.menu) [item.menu removeItem:item]; }]; continue;
    }
    NSDictionary *target = config[@"target"];
    NSMenuItem *item = Find(menu, target ?: @{ @"id": config[@"id"] }, target && !root);
    BOOL existing = item != nil;
    if (target && !existing && !(root && target[@"menu"])) Fail(@"E_NOT_FOUND", @"Menu target was not found");
    if (existing) [self save:item];
    else {
      NSString *label = config[@"title"] ?: config[@"role"];
      item = [[NSMenuItem alloc] initWithTitle:label action:nil keyEquivalent:@""];
      item.identifier = config[@"id"];
      if (root && target[@"menu"]) objc_setAssociatedObject(item, &LocationKey, target[@"menu"], OBJC_ASSOCIATION_COPY_NONATOMIC);
      [menu insertItem:item atIndex:[self index:config[@"placement"] inMenu:menu]];
      [self.undo addObject:^{ if (item.menu) [item.menu removeItem:item]; }];
    }
    if (config[@"items"]) {
      if (existing && !item.submenu) Fail(@"E_INVALID_ARGUMENT", @"Submenu target is not a submenu");
      if (!item.submenu) item.submenu = [[NSMenu alloc] initWithTitle:item.title];
      [self apply:config to:item];
      [self install:config[@"items"] into:item.submenu root:NO];
    } else {
      if (item.submenu && ![config[@"role"] isEqual:@"services"]) Fail(@"E_INVALID_ARGUMENT", @"An action cannot replace a submenu; target it with a submenu item");
      NSString *oldRole = Role(item); if (oldRole) objc_setAssociatedObject(item, &RoleKey, oldRole, OBJC_ASSOCIATION_COPY_NONATOMIC);
      if (config[@"role"]) {
        NSString *role = config[@"role"];
        if ([role isEqual:@"services"]) {
          if (!existing) Fail(@"E_UNSUPPORTED_OPTION", @"Services must target the native services submenu");
        } else {
          item.action = NSSelectorFromString(RoleSelectors()[role]); item.target = nil;
          objc_setAssociatedObject(item, &RoleKey, role, OBJC_ASSOCIATION_COPY_NONATOMIC);
        }
      } else {
        item.action = @selector(selected:); item.target = self;
        item.representedObject = @{ @"ownerId": config[@"_sparkOwner"], @"itemId": config[@"id"] };
      }
      [self apply:config to:item];
      if (config[@"role"] && !item.enabled) item.action = nil;
    }
    if (existing && config[@"placement"]) {
      NSMenu *parent = item.menu;
      // Resolve before removal so self-target placement remains a no-op.
      NSInteger old = [parent indexOfItem:item], position = [self index:config[@"placement"] inMenu:parent];
      [parent removeItem:item]; if (old < position) position--; [parent insertItem:item atIndex:position];
    }
  }
}
- (void)publish:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  RCTExecuteOnMainQueue(^{
    NSError *error = nil; id value = [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:&error];
    if (![value isKindOfClass:NSArray.class]) { reject(@"E_INVALID_ARGUMENT", @"Expected menu array", error); return; }
    if (!NSApp.mainMenu) { reject(@"E_UNAVAILABLE", @"Native application menu is unavailable", nil); return; }
    if ([value isEqual:self.published]) { resolve(nil); return; }
    [self identifyNativeMenus];
    NSArray *previous = self.published;
    [self restore];
    @try { [self install:value into:NSApp.mainMenu root:YES]; self.published = value; resolve(nil); }
    @catch (NSException *failure) {
      [self restore];
      @try { [self install:previous into:NSApp.mainMenu root:YES]; }
      @catch (NSException *rollback) { [self restore]; self.published = @[]; reject(@"E_NATIVE", [NSString stringWithFormat:@"Menu publication failed (%@); restoring previous menus also failed (%@)", failure.reason, rollback.reason], nil); return; }
      reject([failure.name hasPrefix:@"E_"] ? failure.name : @"E_NATIVE", failure.reason, nil);
    }
  });
}
- (void)selected:(NSMenuItem *)sender { if (sender.enabled && !sender.hidden) [self sendEventWithName:@"NativeMenuAction" body:sender.representedObject]; }
- (BOOL)validateMenuItem:(NSMenuItem *)item { return item.enabled; }
- (void)invalidate { RCTExecuteOnMainQueue(^{ [self restore]; self.published = @[]; }); [super invalidate]; }
@end
