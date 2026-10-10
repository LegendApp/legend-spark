static void Check(BOOL condition, NSString *message) { if (!condition) { NSLog(@"FAIL: %@", message); exit(1); } }
static NSString *Publish(RNNativeMenu *module, NSArray *items) {
  __block NSString *failure = nil; __block BOOL resolved = NO;
  NSData *data = [NSJSONSerialization dataWithJSONObject:items options:0 error:nil];
  [module publish:[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] resolve:^(id value) { resolved = YES; } reject:^(NSString *code, NSString *message, NSError *error) { failure = code; }];
  Check(resolved || failure, @"Native publication never completed"); return failure;
}
@interface OriginalMenuDelegate : NSObject <NSMenuDelegate>
@property NSUInteger opens;
@property NSUInteger closes;
@property NSUInteger updates;
@end
@implementation OriginalMenuDelegate
- (void)menuWillOpen:(NSMenu *)menu { self.opens++; }
- (void)menuDidClose:(NSMenu *)menu { self.closes++; }
- (void)menuNeedsUpdate:(NSMenu *)menu { self.updates++; }
@end
int main() { @autoreleasepool {
  [NSApplication sharedApplication];
  [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
  NSMenu *main = [NSMenu new];
  NSMenuItem *application = [[NSMenuItem alloc] initWithTitle:@"Localized App" action:nil keyEquivalent:@""]; application.submenu = [NSMenu new]; [main addItem:application];
  NSMenuItem *preferences = [[NSMenuItem alloc] initWithTitle:@"Localized Preferences" action:nil keyEquivalent:@","];
  preferences.keyEquivalentModifierMask = NSEventModifierFlagCommand;
  [application.submenu addItem:preferences];
  NSMenuItem *edit = [[NSMenuItem alloc] initWithTitle:@"Localized Edit" action:nil keyEquivalent:@""]; edit.submenu = [NSMenu new]; [main addItem:edit];
  NSMenuItem *copy = [[NSMenuItem alloc] initWithTitle:@"Localized Copy" action:@selector(copy:) keyEquivalent:@"c"]; [edit.submenu addItem:copy];
  NSApp.mainMenu = main;
  RNNativeMenu *module = [RNNativeMenu new];
  NSDictionary *settings = @{ @"id": @"settings", @"title": @"Settings", @"target": @{ @"role": @"settings" }, @"enabled": @YES, @"_sparkOwner": @"settings-owner" };
  NSDictionary *appRoot = @{ @"id": @"app", @"target": @{ @"menu": @"app" }, @"items": @[settings], @"_sparkOwner": @"settings-owner" };
  Check(!Publish(module, @[appRoot]), @"Unwired storyboard settings slot did not bind");
  Check(preferences.action == @selector(selected:) && application.submenu.numberOfItems == 1, @"Settings binding duplicated the native slot");
  [module selected:preferences]; Check([CapturedEvent[@"itemId"] isEqual:@"settings"], @"Settings action identity was lost");
  Check(!Publish(module, @[]), @"Settings removal failed");
  Check(preferences.action == nil && [preferences.title isEqual:@"Localized Preferences"], @"Settings removal did not restore the unwired slot");
  NSDictionary *item = @{ @"id": @"custom-copy", @"title": @"Copy document", @"enabled": @YES, @"target": @{ @"role": @"copy" }, @"_sparkOwner": @"owner" };
  NSDictionary *root = @{ @"id": @"editor", @"title": @"Edit", @"target": @{ @"menu": @"edit" }, @"items": @[item], @"enabled": @YES, @"_sparkOwner": @"owner" };
  Check(!Publish(module, @[root]), @"Semantic menu binding failed");
  Check([copy.title isEqual:@"Copy document"] && copy.action == @selector(selected:), @"Native command was not bound");
  [module selected:copy]; Check([CapturedEvent[@"itemId"] isEqual:@"custom-copy"], @"Action identity was lost");
  NSMutableDictionary *missing = [root mutableCopy]; missing[@"target"] = @{ @"id": @"missing" };
  Check([Publish(module, @[missing]) isEqual:@"E_NOT_FOUND"], @"Missing target did not reject");
  Check([copy.title isEqual:@"Copy document"] && copy.action == @selector(selected:), @"Failed publication did not restore prior binding");
  Check(!Publish(module, @[]), @"Removal failed");
  Check([copy.title isEqual:@"Localized Copy"] && copy.action == @selector(copy:) && [edit.title isEqual:@"Localized Edit"], @"Removal did not restore native title/action");
  NSDictionary *nativeRole = @{ @"id": @"copy-role", @"role": @"copy", @"target": @{ @"role": @"copy" }, @"enabled": @YES, @"_sparkOwner": @"owner" };
  NSMutableDictionary *roleRoot = [root mutableCopy]; roleRoot[@"items"] = @[nativeRole];
  Check(!Publish(module, @[roleRoot]), @"Native role binding failed");
  Check(copy.action == @selector(copy:) && copy.target == nil, @"Role lost native responder action");
  Check(!Publish(module, @[]), @"Role removal failed");
  NSDictionary *base = @{ @"id": @"tools", @"title": @"Tools", @"items": @[@{ @"id": @"run", @"title": @"Run", @"enabled": @YES, @"_sparkOwner": @"base" }], @"_sparkOwner": @"base" };
  NSDictionary *override = @{ @"id": @"tools", @"title": @"Tools", @"items": @[@{ @"id": @"run", @"title": @"Run other", @"enabled": @YES, @"_sparkOwner": @"other" }], @"_sparkOwner": @"other" };
  Check(!Publish(module, @[base, override]), @"ID contribution failed");
  NSMenuItem *tools = Find(main, @{ @"id": @"tools" }, NO);
  Check(tools.submenu.numberOfItems == 1, @"Overlay duplicated item");
  Check([tools.submenu.itemArray.firstObject.title isEqual:@"Run other"], @"Last owner did not win");
  NSMenuItem *run = tools.submenu.itemArray.firstObject;
  Check(!Publish(module, @[base, override]), @"Unchanged publication failed");
  Check(Find(main, @{ @"id": @"tools" }, NO) == tools && tools.submenu.itemArray.firstObject == run, @"Unchanged publication rebuilt native items");
  Check(!Publish(module, @[base]), @"Overlay removal failed");
  tools = Find(main, @{ @"id": @"tools" }, NO);
  Check([tools.submenu.itemArray.firstObject.title isEqual:@"Run"], @"Overlay removal did not restore base");
  Check(!Publish(module, @[]), @"Base removal failed"); Check(main.numberOfItems == 2, @"Created root leaked");
  OriginalMenuDelegate *originalDelegate = [OriginalMenuDelegate new];
  edit.submenu.delegate = originalDelegate;
  BOOL originalAlternate = copy.alternate, originalHidden = copy.hidden;
  NSControlStateValue originalState = copy.state;
  NSImage *originalImage = copy.image;
  NSEventModifierFlags originalModifiers = copy.keyEquivalentModifierMask;
  NSDictionary *features = @{ @"id": @"features", @"title": @"Features", @"target": @{ @"menu": @"edit" }, @"_sparkOwner": @"features-owner", @"_sparkLifecycle": @YES, @"items": @[
    @{ @"id": @"copy-state", @"title": @"Copy state", @"target": @{ @"role": @"copy" }, @"alternate": @YES, @"mixed": @YES, @"hidden": @YES, @"systemImageName": @"star", @"_sparkOwner": @"features-owner" },
    @{ @"id": @"primary", @"title": @"Primary", @"_sparkOwner": @"features-owner" },
    @{ @"id": @"keyed", @"title": @"Keyed", @"shortcut": @{ @"key": @"k", @"modifiers": @(NSEventModifierFlagCommand) }, @"_sparkOwner": @"features-owner" },
    @{ @"id": @"alternate", @"title": @"Alternate", @"alternate": @YES, @"shortcut": @{ @"key": @"k", @"modifiers": @(NSEventModifierFlagCommand | NSEventModifierFlagShift) }, @"_sparkOwner": @"features-owner" },
    @{ @"id": @"keyless-alternate", @"title": @"Keyless alternate", @"alternate": @YES, @"_sparkOwner": @"features-owner" },
    @{ @"id": @"mixed", @"title": @"Mixed", @"checked": @NO, @"mixed": @YES, @"systemImageName": @"star", @"_sparkOwner": @"features-owner" },
    @{ @"id": @"hidden", @"title": @"Hidden", @"hidden": @YES, @"_sparkOwner": @"features-owner" }
  ] };
  NSMutableDictionary *unobservedFeatures = [features mutableCopy];
  [unobservedFeatures removeObjectForKey:@"_sparkLifecycle"];
  Check(!Publish(module, @[unobservedFeatures]), @"Unobserved features failed to publish");
  Check(edit.submenu.delegate == originalDelegate, @"Menu without lifecycle callbacks installed native observation");
  [module startObserving];
  Check(!Publish(module, @[features]), @"Advanced features failed to publish");
  NSMenuItem *alternate = Find(edit.submenu, @{ @"id": @"alternate" }, NO);
  Check(alternate.alternate && alternate.keyEquivalentModifierMask == (NSEventModifierFlagCommand | NSEventModifierFlagShift), @"Keyed alternate did not keep its validated modifiers");
  NSMenuItem *keylessAlternate = Find(edit.submenu, @{ @"id": @"keyless-alternate" }, NO);
  Check(keylessAlternate.alternate && keylessAlternate.keyEquivalentModifierMask == NSEventModifierFlagOption, @"Keyless alternate did not use the Option mask");
  NSMenuItem *mixed = Find(edit.submenu, @{ @"id": @"mixed" }, NO);
  Check(mixed.state == NSControlStateValueMixed && mixed.image != nil, @"Mixed state or SF Symbol missing");
  CapturedEvent = nil;
  [module selected:Find(edit.submenu, @{ @"id": @"hidden" }, NO)];
  Check(!CapturedEvent, @"Hidden item emitted an action");
  [edit.submenu.delegate menuNeedsUpdate:edit.submenu];
  [edit.submenu.delegate menuWillOpen:edit.submenu];
  Check(originalDelegate.updates == 1 && originalDelegate.opens == 1, @"Original delegate behavior was replaced");
  Check([CapturedEvent isEqual:@{ @"ownerId": @"features-owner", @"itemId": @"features", @"type": @"open" }], @"Menu open identity was lost");
  [edit.submenu.delegate menuDidClose:edit.submenu];
  Check(originalDelegate.closes == 1 && [CapturedEvent[@"type"] isEqual:@"close"], @"Menu close event was lost");
  Check([Publish(module, @[features, missing]) isEqual:@"E_NOT_FOUND"], @"Lifecycle rollback did not reject the missing target");
  CapturedEvent = nil;
  [edit.submenu.delegate menuWillOpen:edit.submenu];
  Check([CapturedEvent[@"ownerId"] isEqual:@"features-owner"] && originalDelegate.opens == 2, @"Rollback lost lifecycle ownership or original delegate");
  [module stopObserving]; CapturedEvent = nil;
  [edit.submenu.delegate menuWillOpen:edit.submenu];
  Check(!CapturedEvent && originalDelegate.opens == 3, @"Unsubscribed lifecycle event emitted or native delegate was lost");
  Check(!Publish(module, @[]), @"Advanced feature removal failed");
  Check(edit.submenu.delegate == originalDelegate, @"Original delegate was not restored");
  Check(copy.alternate == originalAlternate && copy.hidden == originalHidden && copy.state == originalState && copy.image == originalImage && copy.keyEquivalentModifierMask == originalModifiers, [NSString stringWithFormat:@"Removal did not restore native alternate/state/visibility/image/modifiers (alternate %d/%d, hidden %d/%d, state %ld/%ld, image %@/%@, modifiers %lu/%lu)", copy.alternate, originalAlternate, copy.hidden, originalHidden, copy.state, originalState, copy.image, originalImage, copy.keyEquivalentModifierMask, originalModifiers]);
  NSDictionary *observingOverlay = @{ @"id": @"overlay-menu", @"title": @"Overlay", @"target": @{ @"menu": @"edit" }, @"_sparkOwner": @"overlay-owner", @"_sparkLifecycle": @YES, @"items": @[] };
  NSDictionary *quietOverlay = @{ @"id": @"quiet-menu", @"title": @"Quiet overlay", @"target": @{ @"menu": @"edit" }, @"_sparkOwner": @"quiet-owner", @"items": @[] };
  [module startObserving];
  NSUInteger opensBeforeOverlay = originalDelegate.opens;
  Check(!Publish(module, @[features, observingOverlay]), @"Observing overlay failed");
  [edit.submenu.delegate menuWillOpen:edit.submenu];
  Check([CapturedEvent isEqual:@{ @"ownerId": @"overlay-owner", @"itemId": @"overlay-menu", @"type": @"open" }] && originalDelegate.opens == opensBeforeOverlay + 1, @"Latest observing owner did not win or host delegate was called twice");
  Check(!Publish(module, @[features, observingOverlay, quietOverlay]), @"Nonobserving overlay failed");
  [edit.submenu.delegate menuDidClose:edit.submenu];
  Check([CapturedEvent isEqual:@{ @"ownerId": @"overlay-owner", @"itemId": @"overlay-menu", @"type": @"close" }], @"Nonobserving overlay stole lifecycle ownership");
  Check(!Publish(module, @[features, quietOverlay]), @"Observing overlay removal failed");
  [edit.submenu.delegate menuWillOpen:edit.submenu];
  Check([CapturedEvent isEqual:@{ @"ownerId": @"features-owner", @"itemId": @"features", @"type": @"open" }], @"Removing latest observer did not restore the earlier owner");
  Check(!Publish(module, @[]), @"Lifecycle overlay cleanup failed");
  Check(edit.submenu.delegate == originalDelegate, @"Lifecycle overlays did not restore the host delegate");
  [module stopObserving];
  NSMenu *previousHelp = NSApp.helpMenu;
  NSDictionary *help = @{ @"id": @"help", @"title": @"Help", @"target": @{ @"menu": @"help" }, @"_sparkOwner": @"help-owner", @"items": @[@{ @"id": @"guide", @"title": @"Guide", @"_sparkOwner": @"help-owner" }] };
  Check(!Publish(module, @[help]), @"Help registration failed");
  NSMenuItem *helpItem = Find(main, @{ @"id": @"help" }, NO);
  Check(NSApp.helpMenu == helpItem.submenu, @"Help menu was not registered for AppKit search");
  Check([Publish(module, @[help, missing]) isEqual:@"E_NOT_FOUND"], @"Help rollback did not reject the missing target");
  Check(NSApp.helpMenu == Find(main, @{ @"id": @"help" }, NO).submenu, @"Rollback lost Help search registration");
  Check(!Publish(module, @[]), @"Help removal failed");
  Check(NSApp.helpMenu == previousHelp, @"Help cleanup did not restore the prior menu");
  NSMenuItem *hostHelp = [[NSMenuItem alloc] initWithTitle:@"Host Help" action:nil keyEquivalent:@""];
  hostHelp.submenu = [NSMenu new]; [main addItem:hostHelp]; NSApp.helpMenu = hostHelp.submenu;
  Check(!Publish(module, @[help]), @"Existing Help registration failed");
  Check(NSApp.helpMenu == hostHelp.submenu && Find(hostHelp.submenu, @{ @"id": @"guide" }, NO), @"Existing Help menu was replaced instead of extended");
  Check(!Publish(module, @[]), @"Existing Help cleanup failed");
  Check(NSApp.helpMenu == hostHelp.submenu && [hostHelp.title isEqual:@"Host Help"] && !Find(hostHelp.submenu, @{ @"id": @"guide" }, NO), @"Existing Help menu was not restored");
  puts("Application menu tests passed");
} return 0; }
