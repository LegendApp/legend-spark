import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { runOk } from "./subprocess";

const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "macos" }, TurboModuleRegistry: { get: () => ({ call: mocks.call }) }, NativeEventEmitter: class { addListener() { return { remove() {} }; } } }));
import { getAppContext } from "../packages/desktop-app/src/api";

test.skipIf(process.platform !== "darwin")("raw native products return context accepted by getAppContext", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-context-"));
  try {
    const source = readFileSync("packages/desktop-app/macos/SparkDesktop.mm", "utf8");
    const context = source.slice(source.indexOf("NSDictionary *SparkContext(void)"), source.indexOf("NSString *SparkNamespace(void)"));
    const input = path.join(directory, "context.mm");
    writeFileSync(input, `#import <Foundation/Foundation.h>
#import <objc/runtime.h>
@interface ContextBundle : NSBundle
@end
@implementation ContextBundle
+ (NSBundle *)mainBundle { return [ContextBundle new]; }
- (NSString *)pathForResource:(NSString *)name ofType:(NSString *)type { return NSProcessInfo.processInfo.environment[@"TEST_RUNTIME"]; }
- (id)objectForInfoDictionaryKey:(NSString *)key { return @"Test App"; }
- (NSString *)bundleIdentifier { return @"test.app"; }
@end
${context}
int main() { @autoreleasepool {
  method_setImplementation(class_getClassMethod(NSBundle.class, @selector(mainBundle)), method_getImplementation(class_getClassMethod(ContextBundle.class, @selector(mainBundle))));
  NSData *data = [NSJSONSerialization dataWithJSONObject:SparkContext() options:0 error:nil];
  puts([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
} }
`);
    for (const debug of [true, false]) {
      const binary = path.join(directory, debug ? "debug" : "release");
      await runOk("clang++", ["-fobjc-arc", "-fblocks", `-DDEBUG=${Number(debug)}`, "-framework", "Foundation", input, "-o", binary]);
      const runtimeFile = path.join(directory, "runtime.json");
      for (const manifest of [undefined, "invalid json", "[]", JSON.stringify({ mode: "preview", modules: { clipboard: "1" } })]) {
        if (manifest !== undefined) writeFileSync(runtimeFile, manifest);
        const value = JSON.parse(await runOk(binary, [], { env: { ...process.env, TEST_RUNTIME: manifest === undefined ? "" : runtimeFile } }));
        value.launch = { safeMode: null, relaunched: false, instance: "primary" };
        mocks.call.mockResolvedValue(JSON.stringify(value));
        expect((await getAppContext()).runtime).toEqual(manifest?.startsWith("{") ? { mode: "preview", modules: { clipboard: "1" } } : { mode: debug ? "dev" : "release", modules: {} });
      }
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 30000);
