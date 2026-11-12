import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { runOk } from "./subprocess";

test.skipIf(process.platform !== "darwin")("native launch and data keys isolate bundle clones while retaining Go project isolation", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-clone-identity-"));
  try {
    const source = readFileSync("packages/desktop-app/macos/SparkDesktop.mm", "utf8");
    const hash = source.includes("static NSString *SparkHashedNamespace") ? source.slice(source.indexOf("static NSString *SparkHashedNamespace"), source.indexOf("NSDictionary *SparkContext(void)")) : "";
    const functions = hash + source.slice(source.indexOf("NSString *SparkNamespace(void)"), source.indexOf("NSDictionary *SparkInitialProps"));
    const instance = source.match(/SparkInstanceAcquire\(NSTemporaryDirectory\(\), ([^,]+),/)![1];
    const files = readFileSync("packages/file-system/macos/RNDesktopFileSystem.mm", "utf8");
    const storage = files.match(/\[base URLByAppendingPathComponent:(\w+\(\)) isDirectory:YES\]/)![1];
    const input = path.join(directory, "identity.mm"), binary = path.join(directory, "identity");
    writeFileSync(input, `#import <Foundation/Foundation.h>
#import <CommonCrypto/CommonDigest.h>
#import <objc/runtime.h>
@interface IdentityBundle : NSBundle
@end
@implementation IdentityBundle
+ (NSBundle *)mainBundle { return [IdentityBundle new]; }
- (NSString *)bundleIdentifier { return NSProcessInfo.processInfo.environment[@"BUNDLE_ID"]; }
- (id)objectForInfoDictionaryKey:(NSString *)key { return @"test.original"; }
@end
NSDictionary *SparkContext(void) { return @{ @"projectId": NSProcessInfo.processInfo.environment[@"PROJECT_ID"], @"runtime": @{ @"mode": NSProcessInfo.processInfo.environment[@"MODE"] } }; }
${functions}
int main() { @autoreleasepool {
  method_setImplementation(class_getClassMethod(NSBundle.class, @selector(mainBundle)), method_getImplementation(class_getClassMethod(IdentityBundle.class, @selector(mainBundle))));
  NSDictionary *result = @{ @"instance": ${instance}, @"data": ${storage}, @"project": SparkNamespace(), @"configured": SparkConfiguredBundleIdentifier() ?: NSNull.null };
  puts([[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:result options:0 error:nil] encoding:NSUTF8StringEncoding].UTF8String);
} }
`);
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-DDEBUG=1", "-framework", "Foundation", input, "-o", binary]);
    const keys = async (bundle: string, project = "stable-project", mode = "dev", configured: string | null = "test.original") => {
      const env: NodeJS.ProcessEnv = { ...process.env, BUNDLE_ID: bundle, PROJECT_ID: project, MODE: mode };
      if (configured === null) delete env.SPARK_PROJECT_BUNDLE_IDENTIFIER;
      else env.SPARK_PROJECT_BUNDLE_IDENTIFIER = configured;
      return JSON.parse(await runOk(binary, [], { env }));
    };
    const original = await keys("test.original"), clone = await keys("test.clone");
    expect(clone.instance).not.toBe(original.instance);
    expect(clone.data).not.toBe(original.data);
    expect(original.data).toBe("test.original/Spark");
    expect(clone.project).toBe(original.project);
    expect(clone.configured).toBe("test.original");
    expect(await keys("test.original")).toEqual(original);
    const goA = await keys("test.runner", "a", "go"), goB = await keys("test.runner", "b", "go");
    expect(goA.configured).toBe("test.original");
    expect((await keys("test.runner", "a", "go", null)).configured).toBeNull();
    expect(goA.instance).not.toBe(goB.instance);
    expect(goA.data).not.toBe(goB.data);
    expect((await keys("test.runner.clone", "a", "go")).instance).not.toBe(goA.instance);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 30000);
