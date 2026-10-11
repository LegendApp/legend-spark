import { expect, test } from "vitest";
import { runOk } from "./subprocess.ts";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Compiles the real RNNativeMenu.mm and SparkDeveloperMenu.mm as a development build (RCT_DEV 1), replacing only
// React Native: hosts, module registries, DevSettings, the perf monitor and @react-native-runtimes/core classes.
test.skipIf(process.platform !== "darwin")("the Developer menu targets the key window's runtime and validates against it", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-developer-menu-test-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const strip = (file: string) => readFileSync(path.join(root, file), "utf8").split("\n")
      .filter(line => !/^#import (<React\/|"RNNativeMenu\.h"|"SparkDeveloperMenu\.h")/.test(line) && !line.startsWith("- (std::shared_ptr")).join("\n");
    const stubs = `#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#define RCT_DEV 1
#define RCT_EXPORT_MODULE(name)
typedef void (^RCTPromiseResolveBlock)(id);
typedef void (^RCTPromiseRejectBlock)(NSString *, NSString *, NSError *);
static void RCTExecuteOnMainQueue(void (^operation)(void)) { operation(); }
static NSString *ReloadReason;
static void RCTTriggerReloadCommandListeners(NSString *reason) { ReloadReason = reason; }
static NSMutableArray<NSDictionary *> *Events;
@interface RCTEventEmitter : NSObject
- (void)sendEventWithName:(NSString *)name body:(id)body;
- (void)invalidate;
@end
@implementation RCTEventEmitter
- (void)sendEventWithName:(NSString *)name body:(id)body { [Events addObject:@{ @"name": name, @"body": body }]; }
- (void)invalidate {}
@end
@interface RNNativeMenu : RCTEventEmitter @end
@interface RCTBundleManager : NSObject
@property NSURL *bundleURL;
@end
@implementation RCTBundleManager @end
@interface RCTDevSettings : NSObject
@property BOOL isHotLoadingEnabled, isHotLoadingAvailable, isPerfMonitorShown;
@property NSUInteger inspectorToggles;
@property RCTBundleManager *bundleManager;
- (void)toggleElementInspector;
@end
@implementation RCTDevSettings
- (void)toggleElementInspector { self.inspectorToggles++; }
@end
@interface RCTPerfMonitor : NSObject { NSWindow *_containerWindow; }
@property NSUInteger shows, hides;
@end
@implementation RCTPerfMonitor
- (void)show { self.shows++; _containerWindow = [NSWindow new]; [_containerWindow orderFront:nil]; }
- (void)hide { self.hides++; [_containerWindow orderOut:nil]; _containerWindow = nil; }
@end
@interface RCTModuleRegistry : NSObject
@property NSDictionary<NSString *, id> *modules;
- (id)moduleForName:(const char *)name;
@end
@implementation RCTModuleRegistry
- (id)moduleForName:(const char *)name { return self.modules[@(name)]; }
@end
`;
    const input = path.join(directory, "DeveloperMenu.mm"), output = path.join(directory, "test");
    writeFileSync(input, [stubs, strip("packages/native-menu/ios/SparkDeveloperMenu.h"), strip("packages/native-menu/ios/RNNativeMenu.mm"),
      strip("packages/native-menu/ios/SparkDeveloperMenu.mm"), readFileSync(path.join(root, "tests/developer-menu.native.mm"), "utf8")].join("\n"));
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++17", "-framework", "AppKit", input, "-o", output]);
    expect(await runOk(output, [], { timeout: 15000 })).toContain("Developer menu tests passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 25000);
