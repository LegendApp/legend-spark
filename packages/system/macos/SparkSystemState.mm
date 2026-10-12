#import "SparkSystemState.h"
#import "SparkAppearancePreferences.h"
#import <AppKit/AppKit.h>
#import <CFNetwork/CFNetwork.h>
#import <Network/Network.h>
#import <SystemConfiguration/SystemConfiguration.h>
#import <RNDesktopApp/SparkDesktop.h>
#import <RNDesktopApp/SparkTestDriver.h>
#include <sys/sysctl.h>

// State set by the test driver's simulateSystemEvent (docs/system.md#testing-system-events); empty outside driver runs.
static NSMutableDictionary *overrides;

static NSString *Thermal(NSProcessInfoThermalState state) {
  switch (state) {
    case NSProcessInfoThermalStateNominal: return @"nominal";
    case NSProcessInfoThermalStateFair: return @"fair";
    case NSProcessInfoThermalStateSerious: return @"serious";
    case NSProcessInfoThermalStateCritical: return @"critical";
  }
  return nil; // A state newer than this SDK.
}
// sysctl.proc_translated is 1 under Rosetta, 0 natively, and absent (ENOENT) on Intel Macs.
static BOOL Translated(void) {
  int value = 0; size_t size = sizeof value;
  return sysctlbyname("sysctl.proc_translated", &value, &size, NULL, 0) == 0 && value == 1;
}
NSDictionary *SparkSystemStateInfo(NSString **error) {
  NSProcessInfo *process = NSProcessInfo.processInfo;
  NSString *thermal = Thermal(process.thermalState);
  if (!thermal) { *error = [NSString stringWithFormat:@"Unknown thermal state %ld", (long)process.thermalState]; return nil; }
  [NSTimeZone resetSystemTimeZone];
  NSMutableDictionary *info = [@{ @"translated": @(Translated()), @"timeZone": NSTimeZone.systemTimeZone.name,
    @"lowPowerMode": @(process.isLowPowerModeEnabled), @"thermalState": thermal } mutableCopy];
  for (NSString *key in @[@"lowPowerMode", @"thermalState", @"onBattery"]) if (overrides[key]) info[key] = overrides[key];
  return info;
}

static id Proxy(NSDictionary *settings, CFStringRef enable, CFStringRef host, CFStringRef port) {
  NSString *name = settings[(__bridge NSString *)host];
  if (![settings[(__bridge NSString *)enable] boolValue] || !name.length) return NSNull.null;
  NSNumber *number = settings[(__bridge NSString *)port];
  return number ? [NSString stringWithFormat:@"%@:%@", name, number] : name;
}
static NSDictionary *NetworkStatus(nw_path_t path, NSString **error) {
  nw_path_status_t status = nw_path_get_status(path);
  if (status == nw_path_status_invalid) { *error = @"The network path is invalid"; return nil; }
  NSDictionary *settings = CFBridgingRelease(CFNetworkCopySystemProxySettings());
  if (!settings) { *error = @"Could not read the system proxy settings"; return nil; }
  NSString *autoConfig = [settings[(__bridge NSString *)kCFNetworkProxiesProxyAutoConfigEnable] boolValue] ? settings[(__bridge NSString *)kCFNetworkProxiesProxyAutoConfigURLString] : nil;
  NSDictionary *proxies = @{
    @"http": Proxy(settings, kCFNetworkProxiesHTTPEnable, kCFNetworkProxiesHTTPProxy, kCFNetworkProxiesHTTPPort),
    @"https": Proxy(settings, kCFNetworkProxiesHTTPSEnable, kCFNetworkProxiesHTTPSProxy, kCFNetworkProxiesHTTPSPort),
    @"socks": Proxy(settings, kCFNetworkProxiesSOCKSEnable, kCFNetworkProxiesSOCKSProxy, kCFNetworkProxiesSOCKSPort),
    @"autoConfigURL": autoConfig.length ? autoConfig : NSNull.null,
  };
  // A driver-run override replaces the whole path: an offline path has no interfaces.
  if ([overrides[@"network"] isEqual:@"offline"]) return @{ @"status": @"offline", @"interfaces": @[], @"expensive": @NO, @"constrained": @NO, @"proxies": proxies };
  NSMutableArray *interfaces = [NSMutableArray new];
  NSArray *types = @[@[@(nw_interface_type_wifi), @"wifi"], @[@(nw_interface_type_wired), @"wired"], @[@(nw_interface_type_cellular), @"cellular"],
    @[@(nw_interface_type_loopback), @"loopback"], @[@(nw_interface_type_other), @"other"]];
  for (NSArray *type in types) if (nw_path_uses_interface_type(path, (nw_interface_type_t)[type[0] intValue])) [interfaces addObject:type[1]];
  NSString *reported = [overrides[@"network"] isEqual:@"online"] ? @"online"
    : status == nw_path_status_satisfied ? @"online" : status == nw_path_status_satisfiable ? @"requiresConnection" : @"offline";
  return @{ @"status": reported, @"interfaces": interfaces, @"expensive": @(nw_path_is_expensive(path)), @"constrained": @(nw_path_is_constrained(path)), @"proxies": proxies };
}
void SparkSystemNetworkStatus(NSTimeInterval timeout, void (^completion)(NSDictionary *, NSString *, NSString *)) {
  // A path monitor delivers the current path first; this one stops after it, or at the timeout.
  nw_path_monitor_t probe = nw_path_monitor_create();
  if (!probe) { completion(nil, @"E_NATIVE", @"Could not create a network path monitor"); return; }
  __block BOOL finished = NO;
  void (^finish)(NSDictionary *, NSString *, NSString *) = ^(NSDictionary *status, NSString *code, NSString *error) {
    if (finished) return;
    finished = YES;
    nw_path_monitor_cancel(probe);
    completion(status, code, error);
  };
  nw_path_monitor_set_queue(probe, dispatch_get_main_queue());
  nw_path_monitor_set_update_handler(probe, ^(nw_path_t path) {
    NSString *error; NSDictionary *status = NetworkStatus(path, &error);
    finish(status, status ? nil : @"E_NATIVE", error);
  });
  nw_path_monitor_start(probe);
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(timeout * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    finish(nil, @"E_TIMEOUT", [NSString stringWithFormat:@"No network path within %.0f seconds", timeout]);
  });
}

// Live observers, so the driver can tell whether an event type has a subscriber.
static NSHashTable<SparkSystemStateObserver *> *LiveObservers(void) {
  static NSHashTable *table;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ table = [NSHashTable weakObjectsHashTable]; });
  return table;
}
static void ProxiesChanged(SCDynamicStoreRef, CFArrayRef, void *) { SparkEmit(@{ @"type": @"proxyChanged" }); }

@implementation SparkSystemStateObserver {
  NSSet<NSString *> *_types;
  NSMutableDictionary<NSString *, NSArray *> *_notifications; // type -> @[center, token]
  nw_path_monitor_t _path;
  dispatch_source_t _memory;
  SCDynamicStoreRef _proxyStore;
  CFRunLoopSourceRef _proxySource;
}
- (instancetype)init { if (self = [super init]) { _types = [NSSet set]; _notifications = [NSMutableDictionary new]; } return self; }
- (void)dealloc { [self stop]; }
- (BOOL)observes:(NSString *)type { return [_types containsObject:type]; }

- (BOOL)startProxies:(NSString **)error {
  SCDynamicStoreContext context = {};
  SCDynamicStoreRef store = SCDynamicStoreCreate(NULL, CFSTR("Spark system events"), ProxiesChanged, &context);
  CFStringRef key = store ? SCDynamicStoreKeyCreateProxies(NULL) : NULL;
  BOOL watching = key && SCDynamicStoreSetNotificationKeys(store, (__bridge CFArrayRef)@[(__bridge NSString *)key], NULL);
  if (key) CFRelease(key);
  CFRunLoopSourceRef source = watching ? SCDynamicStoreCreateRunLoopSource(NULL, store, 0) : NULL;
  if (!source) {
    if (store) CFRelease(store);
    *error = [NSString stringWithFormat:@"Could not observe proxy settings: %s", SCErrorString(SCError())];
    return NO;
  }
  _proxyStore = store; _proxySource = source;
  CFRunLoopAddSource(CFRunLoopGetMain(), source, kCFRunLoopCommonModes);
  return YES;
}
- (void)stopProxies {
  if (!_proxySource) return;
  CFRunLoopRemoveSource(CFRunLoopGetMain(), _proxySource, kCFRunLoopCommonModes);
  CFRelease(_proxySource); CFRelease(_proxyStore); _proxySource = NULL; _proxyStore = NULL;
}
- (BOOL)startMemory:(NSString **)error {
  dispatch_source_t source = dispatch_source_create(DISPATCH_SOURCE_TYPE_MEMORYPRESSURE, 0,
    DISPATCH_MEMORYPRESSURE_NORMAL | DISPATCH_MEMORYPRESSURE_WARN | DISPATCH_MEMORYPRESSURE_CRITICAL, dispatch_get_main_queue());
  if (!source) { *error = @"Could not observe memory pressure"; return NO; }
  dispatch_source_set_event_handler(source, ^{
    unsigned long level = dispatch_source_get_data(source);
    SparkEmit(@{ @"type": @"memoryPressure", @"level": level & DISPATCH_MEMORYPRESSURE_CRITICAL ? @"critical" : level & DISPATCH_MEMORYPRESSURE_WARN ? @"warning" : @"normal" });
  });
  // Activated at once: libdispatch traps when an inactive source is released.
  dispatch_activate(source);
  _memory = source;
  return YES;
}
- (void)stopMemory { if (_memory) { dispatch_source_cancel(_memory); _memory = nil; } }
- (BOOL)startPath:(NSString **)error {
  nw_path_monitor_t monitor = nw_path_monitor_create();
  if (!monitor) { *error = @"Could not create a network path monitor"; return NO; }
  // The first path is the current state, not a change.
  __block BOOL initial = YES;
  nw_path_monitor_set_queue(monitor, dispatch_get_main_queue());
  nw_path_monitor_set_update_handler(monitor, ^(nw_path_t) { if (initial) initial = NO; else SparkEmit(@{ @"type": @"networkChanged" }); });
  nw_path_monitor_start(monitor);
  _path = monitor;
  return YES;
}
- (void)stopPath { if (_path) { nw_path_monitor_cancel(_path); _path = nil; } }

- (BOOL)observeTypes:(NSSet<NSString *> *)types error:(NSString **)error {
  // Create the sources that can fail first, so a failure leaves the previous sources as they were.
  BOOL proxies = [types containsObject:@"proxyChanged"], memory = [types containsObject:@"memoryPressure"], network = [types containsObject:@"networkChanged"];
  BOOL newProxies = NO, newMemory = NO;
  if (proxies && !_proxySource) { if (![self startProxies:error]) return NO; newProxies = YES; }
  if (memory && !_memory) {
    if (![self startMemory:error]) { if (newProxies) [self stopProxies]; return NO; }
    newMemory = YES;
  }
  if (network && !_path && ![self startPath:error]) {
    if (newProxies) [self stopProxies];
    if (newMemory) [self stopMemory];
    return NO;
  }
  if (!proxies) [self stopProxies];
  if (!memory) [self stopMemory];
  if (!network) [self stopPath];
  NSNotificationCenter *workspace = NSWorkspace.sharedWorkspace.notificationCenter, *local = NSNotificationCenter.defaultCenter;
  NSDictionary<NSString *, NSArray *> *definitions = @{
    @"sessionActive": @[workspace, NSWorkspaceSessionDidBecomeActiveNotification],
    @"sessionInactive": @[workspace, NSWorkspaceSessionDidResignActiveNotification],
    @"lowPowerChanged": @[local, NSProcessInfoPowerStateDidChangeNotification],
    @"thermalChanged": @[local, NSProcessInfoThermalStateDidChangeNotification],
    @"localeChanged": @[local, NSCurrentLocaleDidChangeNotification],
    @"timeZoneChanged": @[local, NSSystemTimeZoneDidChangeNotification],
    @"clockChanged": @[local, NSSystemClockDidChangeNotification],
    @"systemColorsChanged": @[local, NSSystemColorsDidChangeNotification],
    @"accessibilityDisplayChanged": @[workspace, NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification],
  };
  [definitions enumerateKeysAndObjectsUsingBlock:^(NSString *type, NSArray *definition, BOOL *) {
    NSArray *entry = self->_notifications[type];
    if ([types containsObject:type] && !entry) {
      // Process info notifications arrive on arbitrary threads; the main queue serializes them with the rest.
      id token = [definition[0] addObserverForName:definition[1] object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *) { SparkEmit(@{ @"type": type }); }];
      self->_notifications[type] = @[definition[0], token];
    } else if (![types containsObject:type] && entry) {
      [entry[0] removeObserver:entry[1]];
      [self->_notifications removeObjectForKey:type];
    }
  }];
  _types = [types copy];
  if (types.count) [LiveObservers() addObject:self]; else [LiveObservers() removeObject:self];
  return YES;
}
- (void)stop { [self observeTypes:[NSSet set] error:nil]; }
@end

#if SPARK_TEST_DRIVER
// Test driver: {"command": "simulateSystemEvent", "type", ...} delivers a system event through the same
// emitter as the OS observers, so a flow can exercise events it must not cause (sleep, lock, thermal
// pressure, accessibility settings). The state fields listed for an event type go with it and override what
// getSystemInfo, getNetworkStatus and getAppearancePreferences report until the app quits; memoryPressure needs
// `level`. The OS is untouched. Reachable only through an authenticated driver session.
static NSDictionary *DriverFailure(NSString *code, NSString *message) { return @{ @"ok": @NO, @"error": @{ @"code": code, @"message": message } }; }
static BOOL IsBool(id value) { return [value isKindOfClass:NSNumber.class] && CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID(); }
static BOOL IsHex(id value) {
  return [value isKindOfClass:NSString.class] && [value rangeOfString:@"^#[0-9a-f]{6}$" options:NSRegularExpressionSearch].location != NSNotFound;
}
@interface SparkSystemStateDriver : NSObject
@end
@implementation SparkSystemStateDriver
+ (void)load {
  SparkTestDriverRegisterCommand(@"simulateSystemEvent", ^(NSDictionary *request, SparkTestDriverReply reply) {
    NSArray *plain = @[@"sleep", @"wake", @"lock", @"unlock", @"sessionActive", @"sessionInactive", @"proxyChanged", @"localeChanged",
      @"timeZoneChanged", @"clockChanged", @"displaysChanged"];
    // Event type -> its state fields -> the values each accepts: a list, @"bool" or @"hex" (#rrggbb).
    NSDictionary<NSString *, NSDictionary *> *stateful = @{
      @"thermalChanged": @{ @"thermalState": @[@"nominal", @"fair", @"serious", @"critical"] }, @"lowPowerChanged": @{ @"lowPowerMode": @"bool" },
      @"powerChanged": @{ @"onBattery": @"bool" }, @"networkChanged": @{ @"network": @[@"online", @"offline"] },
      @"memoryPressure": @{ @"level": @[@"normal", @"warning", @"critical"] },
      @"appearanceChanged": @{ @"appearance": @[@"light", @"dark"], @"automaticAppearance": @"bool" },
      @"systemColorsChanged": @{ @"accentColor": @"hex", @"highlightColor": @"hex" },
      @"accessibilityDisplayChanged": @{ @"increaseContrast": @"bool", @"reduceTransparency": @"bool", @"reduceMotion": @"bool",
        @"differentiateWithoutColor": @"bool", @"invertColors": @"bool" },
    };
    NSString *type = request[@"type"];
    if (![type isKindOfClass:NSString.class] || (![plain containsObject:type] && !stateful[type])) { reply(DriverFailure(@"E_INVALID_ARGUMENT", @"simulateSystemEvent expects a system event type")); return; }
    NSDictionary *fields = stateful[type] ?: @{};
    NSMutableDictionary *values = [NSMutableDictionary new];
    for (NSString *key in request) {
      if ([@[@"command", @"type", @"id"] containsObject:key]) continue;
      id accepts = fields[key], value = request[key];
      if (!accepts) { reply(DriverFailure(@"E_INVALID_ARGUMENT", [NSString stringWithFormat:@"%@ does not apply to %@", key, type])); return; }
      BOOL valid = [accepts isEqual:@"bool"] ? IsBool(value) : [accepts isEqual:@"hex"] ? IsHex(value) : [accepts containsObject:value];
      if (!valid) { reply(DriverFailure(@"E_INVALID_ARGUMENT", [NSString stringWithFormat:@"Invalid %@", key])); return; }
      values[key] = value;
    }
    if ([type isEqual:@"memoryPressure"] && !values[@"level"]) { reply(DriverFailure(@"E_INVALID_ARGUMENT", @"memoryPressure needs a level")); return; }
    BOOL observed = NO;
    for (SparkSystemStateObserver *observer in LiveObservers()) observed = observed || [observer observes:type];
    if (!observed) { reply(DriverFailure(@"E_NO_OBSERVER", [NSString stringWithFormat:@"No onSystemEvent registration receives %@", type])); return; }
    if ([type isEqual:@"memoryPressure"]) { SparkEmit(@{ @"type": type, @"level": values[@"level"] }); reply(@{ @"ok": @YES }); return; }
    if ([@[@"appearanceChanged", @"systemColorsChanged", @"accessibilityDisplayChanged"] containsObject:type]) SparkSimulateAppearancePreferences(values);
    else if (values.count) { if (!overrides) overrides = [NSMutableDictionary new]; [overrides addEntriesFromDictionary:values]; }
    if (values.count) SparkTestDriverDidSimulateState(values);
    SparkEmit(@{ @"type": type });
    reply(@{ @"ok": @YES });
  });
}
@end
#endif
