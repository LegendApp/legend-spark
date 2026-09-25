import { expect, test } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { composeHostExtension } = require("../packages/config-plugin/host-extension.cjs");

test("host extensions subclass Spark's real bootstrap instead of replacing it", () => {
  const host = readFileSync(new URL("../packages/desktop-host/AppDelegate.mm", import.meta.url), "utf8");
  const source = '@implementation AppDelegate\n- (void)applicationDidFinishLaunching:(NSNotification *)note { [super applicationDidFinishLaunching:note]; }\n@end';
  const result = composeHostExtension(host, source, '#import <RCTAppDelegate.h>\n@interface AppDelegate : RCTAppDelegate <NSWindowDelegate>\n@end');
  expect(result.header).toContain("@interface SparkAppDelegate : RCTAppDelegate");
  expect(result.header).toContain("@interface AppDelegate : SparkAppDelegate <NSWindowDelegate>");
  expect(result.source).toContain("SparkAcquireInstance()");
  expect(result.source).toContain("@implementation SparkAppDelegate");
  expect(result.source).toContain(source);
  expect(() => composeHostExtension(host, source, "@interface AppDelegate : NSObject\n@end")).toThrow("RCTAppDelegate");
  expect(() => composeHostExtension(host, "", "")).toThrow("exactly one");
});
