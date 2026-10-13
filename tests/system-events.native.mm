// System event sources and state reads (packages/system/macos/SparkSystemState.mm). tests/system-events-native.test.ts
// inlines the implementation after this prelude. Outside a driver run the observer installs the OS sources and forwards
// their notifications, and the state reads report the host; in a driver run no source is installed, so only
// simulateSystemEvent's events arrive, and the reads report fixed values until a simulation changes them. Notifications
// are posted only to this process's own centers: nothing reaches the system.
#import <AppKit/AppKit.h>
#import <objc/runtime.h>
static NSMutableArray<NSString *> *events;
static void SparkEmit(NSDictionary *event) { [events addObject:event[@"type"]]; }
static BOOL driverActive = NO;
static BOOL SparkTestDriverActive(void) { return driverActive; }
typedef void (^SparkTestDriverReply)(NSDictionary *reply);
typedef void (^SparkTestDriverHandler)(NSDictionary *request, SparkTestDriverReply reply);
static NSMutableDictionary<NSString *, SparkTestDriverHandler> *driverCommands;
static void SparkTestDriverRegisterCommand(NSString *name, SparkTestDriverHandler handler) { if (!driverCommands) driverCommands = [NSMutableDictionary new]; driverCommands[name] = handler; }
static void SparkTestDriverDidSimulateState(NSDictionary *) {}
static NSMutableArray<dispatch_block_t> *startObservers;
static void SparkTestDriverObserveStart(dispatch_block_t observer) { if (!startObservers) startObservers = [NSMutableArray new]; [startObservers addObject:observer]; }
// ACTUAL_IMPLEMENTATION
static int failures = 0;
#define CHECK(...) do { if (!(__VA_ARGS__)) { fprintf(stderr, "FAILED line %d: %s\n", __LINE__, #__VA_ARGS__); failures++; } } while (0)
static void Pump() { for (int i = 0; i < 20; ++i) [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.005]]; }
static const void *Pointer(id object, const char *name) {
  return *(const void **)((uint8_t *)(__bridge void *)object + ivar_getOffset(class_getInstanceVariable([object class], name)));
}
// Every source the observer owns: the network path monitor, memory pressure, proxy store, power source and notification observers.
static NSUInteger Sources(SparkSystemStateObserver *observer) {
  return ([observer valueForKey:@"_path"] ? 1 : 0) + ([observer valueForKey:@"_memory"] ? 1 : 0) + (Pointer(observer, "_proxySource") ? 1 : 0)
    + (Pointer(observer, "_power") ? 1 : 0) + [[observer valueForKey:@"_notifications"] count];
}
// The in-process notifications behind sleep, displaysChanged, timeZoneChanged, thermalChanged and sessionInactive.
static NSArray<NSString *> *PostOSNotifications() {
  [events removeAllObjects];
  NSNotificationCenter *workspace = NSWorkspace.sharedWorkspace.notificationCenter, *local = NSNotificationCenter.defaultCenter;
  [workspace postNotificationName:NSWorkspaceWillSleepNotification object:NSWorkspace.sharedWorkspace];
  [local postNotificationName:NSApplicationDidChangeScreenParametersNotification object:NSApp];
  [local postNotificationName:NSSystemTimeZoneDidChangeNotification object:nil];
  [local postNotificationName:NSProcessInfoThermalStateDidChangeNotification object:NSProcessInfo.processInfo];
  [workspace postNotificationName:NSWorkspaceSessionDidResignActiveNotification object:NSWorkspace.sharedWorkspace];
  Pump();
  return [events copy];
}
static NSDictionary *Network() {
  __block NSDictionary *result; __block BOOL done = NO;
  SparkSystemNetworkStatus(5, ^(NSDictionary *status, NSString *, NSString *) { result = status; done = YES; });
  for (int i = 0; i < 500 && !done; ++i) [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
  return result;
}
static NSDictionary *Preferences() { NSString *error; return SparkAppearancePreferences(&error); }
static NSDictionary *Simulate(NSDictionary *request) {
  __block NSDictionary *answer; driverCommands[@"simulateSystemEvent"](request, ^(NSDictionary *value) { answer = value; }); return answer;
}

int main() { @autoreleasepool {
  [NSApplication sharedApplication];
  events = [NSMutableArray new];
  NSSet *all = [NSSet setWithArray:@[@"sleep", @"wake", @"lock", @"unlock", @"sessionActive", @"sessionInactive", @"powerChanged", @"lowPowerChanged",
    @"thermalChanged", @"networkChanged", @"proxyChanged", @"localeChanged", @"timeZoneChanged", @"clockChanged", @"memoryPressure",
    @"appearanceChanged", @"displaysChanged", @"systemColorsChanged", @"accessibilityDisplayChanged"]];
  NSArray *posted = @[@"sleep", @"displaysChanged", @"timeZoneChanged", @"thermalChanged", @"sessionInactive"];

  // Outside a driver run: every type has its OS source, and the OS notifications arrive as events.
  SparkSystemStateObserver *real = [SparkSystemStateObserver new];
  NSString *error;
  CHECK([real observeTypes:all error:&error]);
  CHECK(Sources(real) == all.count); // one source per type
  CHECK([[NSSet setWithArray:PostOSNotifications()] isEqual:[NSSet setWithArray:posted]]);
  [real observeTypes:[NSSet setWithObject:@"sleep"] error:nil];
  CHECK(Sources(real) == 1);
  CHECK([PostOSNotifications() isEqual:@[@"sleep"]]);
  [real stop];
  CHECK(Sources(real) == 0);
  CHECK(PostOSNotifications().count == 0);

  // Outside a driver run the reads report the host.
  NSDictionary *info = SparkSystemStateInfo(&error);
  [NSTimeZone resetSystemTimeZone];
  CHECK([info[@"timeZone"] isEqual:NSTimeZone.systemTimeZone.name] && [info[@"lowPowerMode"] isEqual:@(NSProcessInfo.processInfo.lowPowerModeEnabled)]);
  CHECK(!info[@"batteryLevel"] && !info[@"idleSeconds"] && !info[@"onBattery"]); // getSystemInfo reads those itself
  NSDictionary *network = Network();
  CHECK([@[@"online", @"offline", @"requiresConnection"] containsObject:network[@"status"]] && [network[@"interfaces"] isKindOfClass:NSArray.class]);
  CHECK([Preferences()[@"invertColors"] isEqual:@(NSWorkspace.sharedWorkspace.accessibilityDisplayShouldInvertColors)]
    && [Preferences()[@"keyboardNavigation"] isEqual:@(NSApp.isFullKeyboardAccessEnabled)]);

  // A driver run: the types are observed with no OS source behind them, so OS notifications never arrive,
  // and simulateSystemEvent still reaches the observer.
  driverActive = YES;
  for (dispatch_block_t observer in startObservers) observer();
  // The reads report fixed values, whatever the host's power, thermal state, time zone, network and settings are.
  info = SparkSystemStateInfo(&error);
  NSDictionary *fixed = @{ @"lowPowerMode": @NO, @"thermalState": @"nominal", @"onBattery": @NO, @"batteryLevel": NSNull.null, @"idleSeconds": @0, @"timeZone": @"UTC" };
  CHECK([[info dictionaryWithValuesForKeys:fixed.allKeys] isEqual:fixed]);
  NSDictionary *proxies = @{ @"http": NSNull.null, @"https": NSNull.null, @"socks": NSNull.null, @"autoConfigURL": NSNull.null };
  CHECK([Network() isEqual:(@{ @"status": @"online", @"interfaces": @[@"wired"], @"expensive": @NO, @"constrained": @NO, @"proxies": proxies })]);
  CHECK([Preferences()[@"invertColors"] isEqual:@NO] && [Preferences()[@"keyboardNavigation"] isEqual:@NO]);
  SparkSystemStateObserver *driven = [SparkSystemStateObserver new];
  CHECK([driven observeTypes:all error:&error]);
  CHECK(Sources(driven) == 0);
  CHECK(PostOSNotifications().count == 0);
  [events removeAllObjects];
  CHECK([Simulate(@{ @"type": @"networkChanged", @"network": @"offline" })[@"ok"] isEqual:@YES]);
  CHECK([Simulate(@{ @"type": @"sleep" })[@"ok"] isEqual:@YES]);
  NSArray *simulated = @[@"networkChanged", @"sleep"];
  CHECK([events isEqual:simulated]);
  // Simulated state replaces the fixed values.
  CHECK([Network() isEqual:(@{ @"status": @"offline", @"interfaces": @[], @"expensive": @NO, @"constrained": @NO, @"proxies": proxies })]);
  CHECK([Simulate(@{ @"type": @"thermalChanged", @"thermalState": @"serious" })[@"ok"] isEqual:@YES]);
  CHECK([SparkSystemStateInfo(&error)[@"thermalState"] isEqual:@"serious"]);
  [driven stop];
  CHECK([Simulate(@{ @"type": @"sleep" })[@"error"][@"code"] isEqual:@"E_NO_OBSERVER"]);

  if (failures) { fprintf(stderr, "%d failures\n", failures); return 1; }
  printf("System event native tests passed\n");
} }
