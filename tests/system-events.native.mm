// System event sources (packages/system/macos/SparkSystemState.mm). tests/system-events-native.test.ts inlines the
// implementation after this prelude. Outside a driver run the observer installs the OS sources and forwards their
// notifications; in a driver run it installs none, so only simulateSystemEvent's events arrive. Notifications are
// posted only to this process's own centers: nothing reaches the system.
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

  // A driver run: the types are observed with no OS source behind them, so OS notifications never arrive,
  // and simulateSystemEvent still reaches the observer.
  driverActive = YES;
  SparkSystemStateObserver *driven = [SparkSystemStateObserver new];
  CHECK([driven observeTypes:all error:&error]);
  CHECK(Sources(driven) == 0);
  CHECK(PostOSNotifications().count == 0);
  [events removeAllObjects];
  CHECK([Simulate(@{ @"type": @"networkChanged", @"network": @"offline" })[@"ok"] isEqual:@YES]);
  CHECK([Simulate(@{ @"type": @"sleep" })[@"ok"] isEqual:@YES]);
  NSArray *simulated = @[@"networkChanged", @"sleep"];
  CHECK([events isEqual:simulated]);
  [driven stop];
  CHECK([Simulate(@{ @"type": @"sleep" })[@"error"][@"code"] isEqual:@"E_NO_OBSERVER"]);

  if (failures) { fprintf(stderr, "%d failures\n", failures); return 1; }
  printf("System event native tests passed\n");
} }
