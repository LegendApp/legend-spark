static void Check(BOOL condition, NSString *message) { if (!condition) { NSLog(@"FAIL: %@", message); exit(1); } }
static NSString *Publish(RNNativeMenu *module, NSArray *items) {
  __block NSString *failure = nil; __block BOOL resolved = NO;
  NSData *data = [NSJSONSerialization dataWithJSONObject:items options:0 error:nil];
  [module publish:[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] resolve:^(id value) { resolved = YES; } reject:^(NSString *code, NSString *message, NSError *error) { failure = code; }];
  Check(resolved || failure, @"Native publication never completed"); return failure;
}

// @react-native-runtimes/core and React Native view classes, looked up by name as in an app.
@interface RCTSurfaceHostingView : NSView @end
@implementation RCTSurfaceHostingView @end
@interface ThreadedRuntimeSurfaceView : NSView
@property (copy) NSString *runtimeName;
@end
@implementation ThreadedRuntimeSurfaceView @end
@interface TestHost : NSObject
@property RCTModuleRegistry *moduleRegistry;
@end
@implementation TestHost @end
static NSMutableDictionary<NSString *, TestHost *> *IsolatedHosts;
static NSUInteger HostsCreated;
@interface ThreadedRuntime : NSObject @end
@implementation ThreadedRuntime
+ (NSArray<NSString *> *)runtimeNames { return IsolatedHosts.allKeys; }
+ (TestHost *)ensureHostWithRuntimeName:(NSString *)name { if (!IsolatedHosts[name]) HostsCreated++; return IsolatedHosts[name]; }
@end
@interface TestFactory : NSObject
@property TestHost *reactHost;
@end
@implementation TestFactory @end
@interface TestDelegate : NSObject <NSApplicationDelegate>
@property TestFactory *rootViewFactory;
@end
@implementation TestDelegate @end

static NSWindow *KeyWindow;
static TestHost *Host(RCTDevSettings *settings, id monitor) {
  TestHost *host = [TestHost new];
  host.moduleRegistry = [RCTModuleRegistry new];
  host.moduleRegistry.modules = monitor ? @{ @"DevSettings": settings, @"PerfMonitor": monitor } : @{ @"DevSettings": settings };
  return host;
}
static NSWindow *Window(NSView *root) {
  NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 200, 200) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:YES];
  window.contentView = root;
  return window;
}
static NSMenuItem *Item(NSMenu *menu, NSString *identifier) {
  for (NSMenuItem *item in menu.itemArray) {
    if ([item.identifier isEqual:identifier]) return item;
    NSMenuItem *found = item.submenu ? Item(item.submenu, identifier) : nil;
    if (found) return found;
  }
  return nil;
}

int main() { @autoreleasepool {
  [NSApplication sharedApplication];
  [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
  // A driven test process never has a key window; substitute the one each case needs.
  method_setImplementation(class_getInstanceMethod(NSApplication.class, @selector(keyWindow)), imp_implementationWithBlock(^NSWindow *(id application) { return KeyWindow; }));
  Events = [NSMutableArray new]; IsolatedHosts = [NSMutableDictionary new];
  TestDelegate *delegate = [TestDelegate new]; delegate.rootViewFactory = [TestFactory new];
  NSApp.delegate = delegate;

  RCTDevSettings *sharedSettings = [RCTDevSettings new], *isolatedSettings = [RCTDevSettings new];
  sharedSettings.bundleManager = [RCTBundleManager new]; sharedSettings.bundleManager.bundleURL = [NSURL URLWithString:@"http://127.0.0.1:8081/index.bundle"];
  sharedSettings.isHotLoadingAvailable = YES; sharedSettings.isHotLoadingEnabled = YES;
  isolatedSettings.isHotLoadingAvailable = YES; isolatedSettings.isHotLoadingEnabled = NO;
  RCTPerfMonitor *sharedMonitor = [RCTPerfMonitor new], *isolatedMonitor = [RCTPerfMonitor new];
  TestHost *sharedHost = Host(sharedSettings, sharedMonitor);
  IsolatedHosts[@"ks-plugins"] = Host(isolatedSettings, isolatedMonitor);

  // Targets: an isolated navigator window, a shared React Native window and a window without React Native.
  NSView *sharedRoot = [RCTSurfaceHostingView new];
  NSView *isolatedRoot = [RCTSurfaceHostingView new], *wrapper = [NSView new];
  wrapper.accessibilityIdentifier = @"spark-window-surface-plugin-1";
  ThreadedRuntimeSurfaceView *surface = [ThreadedRuntimeSurfaceView new]; surface.runtimeName = @"ks-plugins";
  [wrapper addSubview:surface]; [isolatedRoot addSubview:wrapper];
  ThreadedRuntimeSurfaceView *embedded = [ThreadedRuntimeSurfaceView new]; embedded.runtimeName = @"embedded-worker";
  [sharedRoot addSubview:embedded];
  NSWindow *shared = Window(sharedRoot), *isolated = Window(isolatedRoot), *plain = Window([NSView new]);
  Check([SparkDeveloperTarget(isolated) isEqual:(@{ @"runtime": @"isolated", @"name": @"ks-plugins" })], @"An isolated window did not target its runtime");
  Check([SparkDeveloperTarget(shared) isEqual:(@{ @"runtime": @"shared" })], @"A threaded component inside a shared window retargeted the window");
  Check(SparkDeveloperTarget(plain) == nil && SparkDeveloperTarget(nil) == nil, @"A window without React Native had a target");

  // Publication through RNNativeMenu: instructions reach the items, and the hidden trigger keeps its key equivalent.
  NSMenu *main = [NSMenu new];
  NSMenuItem *application = [[NSMenuItem alloc] initWithTitle:@"App" action:nil keyEquivalent:@""]; application.submenu = [NSMenu new]; [main addItem:application];
  NSMenuItem *windowMenu = [[NSMenuItem alloc] initWithTitle:@"Window" action:nil keyEquivalent:@""]; windowMenu.submenu = [NSMenu new];
  [main addItem:windowMenu]; NSApp.mainMenu = main; NSApp.windowsMenu = windowMenu.submenu;
  RNNativeMenu *module = [RNNativeMenu new];
  Check([[module supportedEvents] containsObject:@"NativeDeveloperMenu"], @"Development builds did not declare the Developer menu event");
  NSString *owner = @"developer-owner";
  NSDictionary *(^leaf)(NSString *, NSDictionary *) = ^(NSString *identifier, NSDictionary *instruction) { return @{ @"id": identifier, @"title": identifier, @"enabled": @YES, @"_sparkOwner": owner, @"_sparkDev": instruction }; };
  NSDictionary *info = @{ @"action": @"bundleInfo", @"title": @"Bundle Info", @"ok": @"OK", @"copy": @"Copy", @"labels": @{ @"bundleURL": @"Bundle URL", @"runtime": @"Runtime" }, @"runtimes": @{ @"shared": @"Shared runtime", @"isolated": @"Isolated runtime “{name}”" }, @"lines": @[@"Spark: test"] };
  NSArray *items = @[leaf(@"reload", @{ @"action": @"reload" }), leaf(@"devtools", @{ @"action": @"openDevTools", @"available": @NO, @"toolTip": @"Unavailable" }),
    leaf(@"inspector", @{ @"action": @"toggleInspector" }), leaf(@"perf", @{ @"action": @"togglePerfMonitor" }), leaf(@"fast-refresh", @{ @"action": @"toggleFastRefresh" }),
    leaf(@"start-profiling", @{ @"action": @"startProfiling", @"available": @YES }), leaf(@"stop-profiling", @{ @"action": @"stopProfiling", @"prompt": @"Save Profile Here", @"message": @"Choose a folder" }),
    leaf(@"info", info), @{ @"id": @"show", @"title": @"Show", @"enabled": @YES, @"hidden": @YES, @"_sparkOwner": owner, @"shortcut": @{ @"key": @"z", @"modifiers": @(NSEventModifierFlagControl | NSEventModifierFlagCommand) }, @"_sparkDev": @{ @"action": @"showMenu" } }];
  NSDictionary *root = @{ @"id": @"spark-developer", @"title": @"Developer", @"enabled": @YES, @"_sparkOwner": owner, @"placement": @{ @"before": @{ @"menu": @"window" } }, @"items": items };
  NSString *failure = Publish(module, @[root]);
  Check(!failure, [NSString stringWithFormat:@"The Developer menu did not publish: %@", failure]);
  Check([main.itemArray[1].identifier isEqual:@"spark-developer"] && main.itemArray[2] == windowMenu, @"The Developer menu was not placed before Window");
  NSMenuItem *reload = Item(main, @"reload"), *devtools = Item(main, @"devtools"), *inspector = Item(main, @"inspector"), *perf = Item(main, @"perf"), *fast = Item(main, @"fast-refresh"), *show = Item(main, @"show");
  Check([devtools.toolTip isEqual:@"Unavailable"], @"Open DevTools lost its unavailable tooltip");
  Check(show.hidden && show.allowsKeyEquivalentWhenHidden && [show.keyEquivalent isEqual:@"z"], @"The hidden trigger cannot fire its key equivalent");

  // No key window: only the app-wide Reload is enabled, and only while the shared runtime has a host.
  KeyWindow = nil;
  Check(![module validateMenuItem:reload], @"Reload was enabled without a shared runtime");
  delegate.rootViewFactory.reactHost = sharedHost;
  Check([module validateMenuItem:reload] && [module validateMenuItem:show], @"Reload or the trigger was disabled");
  for (NSMenuItem *item in @[devtools, inspector, perf, fast, Item(main, @"info")]) Check(![module validateMenuItem:item], [NSString stringWithFormat:@"%@ was enabled without a key window", item.identifier]);
  [module selected:reload]; Check([ReloadReason isEqual:@"Spark Developer menu"], @"Reload did not trigger a React Native reload");
  // Profiling acts on the whole app, whatever window is key: Start while nothing records, Stop while something does.
  NSMenuItem *startProfiling = Item(main, @"start-profiling"), *stopProfiling = Item(main, @"stop-profiling");
  Check([module validateMenuItem:startProfiling] && ![module validateMenuItem:stopProfiling], @"Start Profiling was disabled or Stop Profiling enabled while idle without a key window");
  ProfilerRecording = YES;
  Check(![module validateMenuItem:startProfiling] && [module validateMenuItem:stopProfiling], @"Start Profiling was enabled or Stop Profiling disabled while recording");
  ProfilerRecording = NO;

  // Shared key window: its runtime's settings, checkmark and monitor.
  KeyWindow = shared;
  Check([module validateMenuItem:inspector] && [module validateMenuItem:perf], @"Shared runtime items were disabled");
  Check([module validateMenuItem:fast] && fast.state == NSControlStateValueOn, @"Fast Refresh did not show the shared runtime's state");
  Check(![module validateMenuItem:devtools], @"Open DevTools was enabled without DevTools support");
  [module selected:inspector]; [module selected:fast]; [module selected:perf];
  Check(sharedSettings.inspectorToggles == 1 && !sharedSettings.isHotLoadingEnabled && sharedMonitor.shows == 1 && sharedSettings.isPerfMonitorShown, @"Shared runtime actions missed their host");
  [module selected:perf]; Check(sharedMonitor.hides == 1 && !sharedSettings.isPerfMonitorShown, @"The perf monitor did not hide");
  Check(isolatedSettings.inspectorToggles == 0 && isolatedMonitor.shows == 0, @"Shared runtime actions reached the isolated runtime");

  // Isolated key window: the isolated runtime's host, never a newly created one.
  KeyWindow = isolated;
  Check([module validateMenuItem:fast] && fast.state == NSControlStateValueOff, @"Fast Refresh did not show the isolated runtime's state");
  [module selected:inspector]; [module selected:fast]; [module selected:perf];
  Check(isolatedSettings.inspectorToggles == 1 && isolatedSettings.isHotLoadingEnabled && isolatedMonitor.shows == 1, @"Isolated runtime actions missed their host");
  Check(sharedSettings.inspectorToggles == 1, @"Isolated runtime actions reached the shared runtime");
  [IsolatedHosts removeObjectForKey:@"ks-plugins"];
  Check(![module validateMenuItem:inspector] && HostsCreated == 0, @"A destroyed isolated runtime was recreated or targeted");
  IsolatedHosts[@"ks-plugins"] = Host(isolatedSettings, isolatedMonitor);

  // Open DevTools is JavaScript's: the event carries the target, and only while observed.
  NSMutableDictionary *available = [root mutableCopy];
  NSMutableArray *availableItems = [items mutableCopy]; availableItems[1] = leaf(@"devtools", @{ @"action": @"openDevTools", @"available": @YES });
  available[@"items"] = availableItems;
  Check(!Publish(module, @[available]), @"Republishing with DevTools support failed");
  devtools = Item(main, @"devtools");
  Check(devtools.toolTip == nil && [module validateMenuItem:devtools], @"Open DevTools stayed unavailable");
  [module selected:devtools]; Check(Events.count == 0, @"An unobserved Developer menu event was sent");
  [module startObserving]; [module selected:devtools];
  Check([Events.lastObject[@"name"] isEqual:@"NativeDeveloperMenu"] && [Events.lastObject[@"body"] isEqual:(@{ @"action": @"openDevTools", @"target": @{ @"runtime": @"isolated", @"name": @"ks-plugins" } })], @"Open DevTools did not carry the isolated target");
  [module selected:Item(main, @"start-profiling")];
  Check([Events.lastObject[@"body"] isEqual:(@{ @"action": @"startProfiling" })], @"Start Profiling was not handed to JavaScript");
  for (NSDictionary *event in Events) Check(![event[@"name"] isEqual:@"NativeMenuAction"], @"A Developer menu item was delivered as an app menu action");
  // Without the profiler in the bundle, Start Profiling stays disabled.
  NSMutableArray *withoutProfiler = [availableItems mutableCopy];
  withoutProfiler[5] = leaf(@"start-profiling", @{ @"action": @"startProfiling", @"available": @NO, @"toolTip": @"No profiler" });
  available[@"items"] = withoutProfiler;
  Check(!Publish(module, @[available]), @"Republishing without the profiler failed");
  Check(![module validateMenuItem:Item(main, @"start-profiling")] && [Item(main, @"start-profiling").toolTip isEqual:@"No profiler"], @"Start Profiling was enabled without the profiler");

  Check(!Publish(module, @[]), @"The Developer menu did not unpublish");
  Check(main.numberOfItems == 2 && !Item(main, @"show"), @"Removal left Developer menu items behind");
  puts("Developer menu tests passed");
} return 0; }
