import { expect, test } from "vitest";
import { runOk } from "./subprocess.ts";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skipIf(process.platform !== "darwin")("AppKit menu publication binds semantic targets, rolls back failures and restores owners", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-menu-test-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    // Exercise the real implementation, replacing only the RN bridge declarations/dispatch.
    const source = readFileSync(path.join(root, "packages/native-menu/ios/RNNativeMenu.mm"), "utf8").split("\n").filter(line => !line.startsWith('#import "RNNativeMenu.h"') && !line.startsWith('#import "SparkDeveloperMenu.h"') && !line.startsWith("#import <React/") && !line.startsWith("#import <RNDesktopApp/") && !line.startsWith("- (std::shared_ptr")).join("\n");
    const stubs = `#import <AppKit/AppKit.h>
typedef void (^RCTPromiseResolveBlock)(id);
typedef void (^RCTPromiseRejectBlock)(NSString *, NSString *, NSError *);
#define RCT_EXPORT_MODULE(name)
static void RCTExecuteOnMainQueue(void (^operation)(void)) { operation(); }
// Spark's strings in English: the keys are the English text (tests/framework-strings.test.ts).
static NSString *SparkLocalizedString(NSString *key) { return key; }
static NSDictionary *SparkContext(void) { return @{ @"name": @"Probe" }; }
static NSDictionary *CapturedEvent;
@interface RCTEventEmitter : NSObject
- (void)sendEventWithName:(NSString *)name body:(id)body;
- (void)invalidate;
@end
@implementation RCTEventEmitter
- (void)sendEventWithName:(NSString *)name body:(id)body { CapturedEvent = body; }
- (void)invalidate {}
@end
@interface RNNativeMenu : RCTEventEmitter @end
`;
    const input = path.join(directory, "Menu.mm"), output = path.join(directory, "test");
    writeFileSync(input, stubs + source + readFileSync(path.join(root, "tests/application-menu.native.mm"), "utf8"));
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++17", "-framework", "AppKit", input, "-o", output]);
    expect(await runOk(output, [], { timeout: 15000 })).toContain("Application menu tests passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 25000);
