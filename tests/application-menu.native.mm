static void Check(BOOL condition, NSString *message) { if (!condition) { NSLog(@"FAIL: %@", message); exit(1); } }
static NSString *Publish(RNNativeMenu *module, NSArray *items) {
  __block NSString *failure = nil; __block BOOL resolved = NO;
  NSData *data = [NSJSONSerialization dataWithJSONObject:items options:0 error:nil];
  [module publish:[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] resolve:^(id value) { resolved = YES; } reject:^(NSString *code, NSString *message, NSError *error) { failure = code; }];
  Check(resolved || failure, @"Native publication never completed"); return failure;
}
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
  puts("Application menu tests passed");
} return 0; }
