import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "../packages/cli/src/build.ts";
import { readJson, writeJson } from "../packages/cli/src/project.ts";
import { preserveMacOSPods } from "../packages/cli/src/native-preparation.ts";

const commands = vi.hoisted(() => ({ run: vi.fn(), restore: true }));
vi.mock("../packages/cli/src/commands.ts", () => ({ doctor: vi.fn(), binary: (_root: string, name: string) => name, run: commands.run }));
vi.mock("../packages/cli/src/native-patch-preflight.ts", () => ({ assertNativePatchPreflight: vi.fn() }));

let root: string;
let moduleRoot: string;
const write = (file: string, value = "") => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, value); };
const framework = () => path.join(moduleRoot, "Fixture.xcframework");
const commandCount = (name: string) => commands.run.mock.calls.filter(([, argv]) => argv[0] === name || argv.includes(name)).length;
const configure = (release = false) => writeJson(path.join(root, "app.json"), { expo: {
  name: "Fixture", slug: "fixture", version: "1.0.0", platforms: ["macos"],
  extra: { spark: { projectId: "test.fixture", ...(release ? { updates: { feedURL: "https://example.com/feed.xml", publicKey: Buffer.alloc(32).toString("base64") } } : {}) } },
} });

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "spark-build-cache-"));
  moduleRoot = path.join(root, "node_modules/fixture");
  writeJson(path.join(root, "package.json"), { main: "index.ts", dependencies: { fixture: "1.0.0" } });
  writeJson(path.join(moduleRoot, "package.json"), { name: "fixture", version: "1.0.0", spark: { nativeModules: ["Fixture"] } });
  write(path.join(moduleRoot, "src/NativeFixture.ts"), "export const native = 1;");
  write(path.join(moduleRoot, "macos/Fixture.mm"), "native source");
  configure();
  commands.restore = true;
  commands.run.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  commands.run.mockImplementation(async (_root: string, argv: string[]) => {
    if (argv.includes("prebuild")) {
      rmSync(path.join(root, "macos"), { recursive: true, force: true });
      mkdirSync(path.join(root, "macos/Fixture.xcworkspace"), { recursive: true });
      write(path.join(root, "macos/Fixture.xcodeproj/project.pbxproj"), "fixture project");
      write(path.join(root, "macos/Fixture/Info.plist"), JSON.stringify({ SparkProjectIdentifier: "test.fixture" }));
    } else if (argv[0] === "pod") {
      write(path.join(root, "macos/Pods/Manifest.lock"), "fixture");
      write(path.join(root, "macos/Pods/Target Support Files/Fixture/Fixture-xcframeworks.sh"), 'install_xcframework "${PODS_ROOT}/../../node_modules/fixture/Fixture.xcframework" "Fixture" "framework" "macos-arm64_x86_64"\n');
      if (commands.restore) {
        write(path.join(framework(), "Info.plist"), "fixture");
        mkdirSync(path.join(framework(), "macos-arm64_x86_64"), { recursive: true });
      }
    } else if (argv.includes("export:embed")) {
      write(argv[argv.indexOf("--bundle-output") + 1]!, "fixture bundle");
      write(argv[argv.indexOf("--sourcemap-output") + 1]!, JSON.stringify({ sources: [] }));
    } else if (argv[0] === "plutil" && argv.includes("json")) {
      return readFileSync(argv.at(-1)!, "utf8");
    } else if (argv[0] === "xcodebuild") {
      const derived = argv[argv.indexOf("-derivedDataPath") + 1]!;
      const configuration = argv[argv.indexOf("-configuration") + 1]!;
      write(path.join(derived, "Build/Products", configuration, "Fixture.app/Contents/Resources/main.jsbundle"), "built bundle");
    }
    return "";
  });
});

afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

test.each(["dev", "preview", "release"] as const)("%s builds select the renamed scheme product and clear only that output directory", async mode => {
  configure(true);
  const first = await build(root, mode);
  const config = readJson(path.join(root, "app.json"));
  config.expo.name = "Renamed Fixture";
  writeJson(path.join(root, "app.json"), config);
  const run = commands.run.getMockImplementation()!;
  commands.run.mockImplementation(async (...args) => {
    const result = await run(...args);
    const argv = args[1];
    if (argv.includes("prebuild")) {
      renameSync(path.join(root, "macos/Fixture.xcworkspace"), path.join(root, "macos/RenamedFixture.xcworkspace"));
    } else if (argv[0] === "xcodebuild") {
      expect(argv[argv.indexOf("-scheme") + 1]).toBe("RenamedFixture-macOS");
      const derived = argv[argv.indexOf("-derivedDataPath") + 1]!;
      const configuration = argv[argv.indexOf("-configuration") + 1]!;
      const resources = path.join(derived, "Build/Products", configuration, "RenamedFixture.app/Contents/Resources");
      write(path.join(resources, "main.jsbundle"), "renamed bundle");
      symlinkSync("main.jsbundle", path.join(resources, "bundle-link"));
    }
    return result;
  });
  const output = path.dirname(first.app);
  const otherMode = path.join(path.dirname(output), mode === "dev" ? "release" : "dev", "keep");
  const otherArch = path.join(root, ".spark/products", `macos-${first.runtime.arch === "arm64" ? "x64" : "arm64"}`, mode, "keep");
  write(otherMode, "other mode");
  write(otherArch, "other architecture");
  const renamed = await build(root, mode);
  expect(renamed.app).toBe(path.join(output, "RenamedFixture.app"));
  expect(readFileSync(path.join(renamed.app, "Contents/Resources/main.jsbundle"), "utf8")).toBe("renamed bundle");
  expect(readlinkSync(path.join(renamed.app, "Contents/Resources/bundle-link"))).toBe("main.jsbundle");
  expect(existsSync(first.app)).toBe(false);
  expect(readFileSync(otherMode, "utf8")).toBe("other mode");
  expect(readFileSync(otherArch, "utf8")).toBe("other architecture");
  expect(readJson(path.join(root, `.spark/${mode}-build.json`)).app).toBe(renamed.app);
  expect(await build(root, mode)).toEqual(renamed);
  expect(commandCount("xcodebuild")).toBe(2);
});

test("a missing expected product rejects without replacing the cached app or receipt, and a retry succeeds", async () => {
  const first = await build(root, "dev");
  const receipt = readFileSync(path.join(root, ".spark/dev-build.json"), "utf8");
  const run = commands.run.getMockImplementation()!;
  commands.run.mockImplementation(async (...args) => {
    const result = await run(...args);
    const argv = args[1];
    if (argv[0] === "xcodebuild") {
      const derived = argv[argv.indexOf("-derivedDataPath") + 1]!;
      const products = path.join(derived, "Build/Products/Debug");
      rmSync(path.join(products, "Fixture.app"), { recursive: true });
      write(path.join(products, "OldFixture.app/Contents/Resources/main.jsbundle"), "stale bundle");
    }
    return result;
  });
  write(path.join(moduleRoot, "macos/Fixture.mm"), "changed source");
  await expect(build(root, "dev")).rejects.toThrow("Build completed without Fixture.app.");
  expect(readFileSync(path.join(first.app, "Contents/Resources/main.jsbundle"), "utf8")).toBe("built bundle");
  expect(readFileSync(path.join(root, ".spark/dev-build.json"), "utf8")).toBe(receipt);
  expect(existsSync(path.join(root, ".spark/build.lock"))).toBe(false);
  commands.run.mockImplementation(run);
  expect((await build(root, "dev")).app).toBe(first.app);
  expect(readFileSync(path.join(first.app, "Contents/Resources/main.jsbundle"), "utf8")).toBe("built bundle");
});

test("legacy receipts with a stale product rebuild once instead of bypassing product selection", async () => {
  const first = await build(root, "dev");
  const stale = path.join(path.dirname(first.app), "OldFixture.app");
  renameSync(first.app, stale);
  write(path.join(stale, "Contents/Resources/main.jsbundle"), "stale bundle");
  const receiptFile = path.join(root, ".spark/dev-build.json");
  const legacy = readJson(receiptFile);
  // The old CLI saved current fingerprints even when it copied an old bundle.
  legacy.app = stale;
  delete legacy.product;
  writeJson(receiptFile, legacy);
  const rebuilt = await build(root, "dev");
  expect(rebuilt.app).toBe(first.app);
  expect(readFileSync(path.join(rebuilt.app, "Contents/Resources/main.jsbundle"), "utf8")).toBe("built bundle");
  expect(existsSync(stale)).toBe(false);
  expect(readJson(receiptFile).product).toBe("Fixture.app");
  expect(await build(root, "dev")).toEqual(rebuilt);
  expect(commandCount("xcodebuild")).toBe(2);
});

test("dev -> release -> dev reuses the dev app despite release preparation and missing build intermediates", async () => {
  const dev = await build(root, "dev");
  expect(commandCount("xcodebuild")).toBe(1);
  await build(root, "dev");
  expect(commandCount("xcodebuild")).toBe(1);
  configure(true);
  await build(root, "release");
  expect(commandCount("xcodebuild")).toBe(2);
  expect(readJson(path.join(root, ".spark/native-preparation.json")).fingerprint).not.toBe(readJson(path.join(root, ".spark/dev-build.json")).preparation.fingerprint);
  configure();
  rmSync(path.join(root, "macos"), { recursive: true });
  rmSync(framework(), { recursive: true });
  expect(await build(root, "dev")).toEqual(dev);
  expect(commandCount("xcodebuild")).toBe(2);
  expect(commandCount("pod")).toBe(2);
});

test("native edits compile incrementally, while configuration and package moves refresh preparation", async () => {
  await build(root, "dev");
  write(path.join(moduleRoot, "macos/Fixture.mm"), "changed native source");
  await build(root, "dev");
  expect(commandCount("xcodebuild")).toBe(2);
  expect(commandCount("prebuild")).toBe(1);
  configure(true);
  await build(root, "dev");
  expect(commandCount("prebuild")).toBe(2);
  const moved = path.join(root, "node_modules/relocated");
  renameSync(moduleRoot, moved);
  moduleRoot = moved;
  writeJson(path.join(root, "package.json"), { main: "index.ts", dependencies: { relocated: "1.0.0" } });
  const run = commands.run.getMockImplementation()!;
  commands.run.mockImplementation(async (...args) => {
    const result = await run(...args);
    if (args[1][0] === "pod") {
      const script = path.join(root, "macos/Pods/Target Support Files/Fixture/Fixture-xcframeworks.sh");
      write(script, readFileSync(script, "utf8").replace("/node_modules/fixture/", "/node_modules/relocated/"));
    }
    return result;
  });
  await build(root, "dev");
  expect(commandCount("prebuild")).toBe(3);
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining("fixture location changed"));
});

test("codegen and podspec edits update Pods without regenerating the native project", async () => {
  await build(root, "dev");
  const archive = path.join(root, "macos/Pods/hermes-engine-artifacts/hermes-version-debug.tar.gz");
  write(archive, "cached Hermes download");
  const inode = statSync(archive).ino;
  for (const file of ["src/NativeFixture.ts", "Fixture.podspec"]) {
    write(path.join(root, "macos/build/generated/obsolete.cpp"), "old codegen");
    write(path.join(moduleRoot, file), "changed preparation source");
    await build(root, "dev");
    expect(commandCount("prebuild")).toBe(1);
    expect(statSync(archive).ino).toBe(inode);
    expect(existsSync(path.join(root, "macos/build/generated/obsolete.cpp"))).toBe(false);
    await build(root, "dev");
  }
  expect(commandCount("pod")).toBe(3);
  expect(commandCount("xcodebuild")).toBe(3);
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Updating CocoaPods dependencies:"));
});

test("configuration changes retain the Pods sandbox, lockfile and Hermes downloads", async () => {
  await build(root, "dev");
  const archive = path.join(root, "macos/Pods/hermes-engine-artifacts/hermes-version-debug.tar.gz");
  const lock = path.join(root, "macos/Podfile.lock");
  write(archive, "cached Hermes download");
  write(lock, "locked Hermes version");
  symlinkSync("hermes-engine-artifacts", path.join(root, "macos/Pods/archive-link"));
  const inode = statSync(archive).ino;
  configure(true);
  await build(root, "dev");
  expect(commandCount("prebuild")).toBe(2);
  expect(statSync(archive).ino).toBe(inode);
  expect(readFileSync(path.join(root, "macos/Pods/archive-link/hermes-version-debug.tar.gz"), "utf8")).toBe("cached Hermes download");
  expect(readFileSync(lock, "utf8")).toBe("locked Hermes version");
  await build(root, "dev", true);
  expect(statSync(archive).ino).toBe(inode);
  expect(commandCount("prebuild")).toBe(3);
});

test("missing CocoaPods state restores Pods without regenerating a valid native project", async () => {
  await build(root, "dev");
  rmSync(path.join(root, "macos/Pods/Manifest.lock"));
  write(path.join(moduleRoot, "macos/Fixture.mm"), "changed native source");
  await build(root, "dev");
  expect(commandCount("prebuild")).toBe(1);
  expect(commandCount("pod")).toBe(2);
});

test("host and entitlement metadata edits regenerate the project while retaining Hermes", async () => {
  const host = path.join(root, "node_modules/@legendapp/spark-desktop-host");
  writeJson(path.join(host, "package.json"), { name: "@legendapp/spark-desktop-host", version: "1.0.0" });
  writeJson(path.join(root, "package.json"), { main: "index.ts", dependencies: { fixture: "1.0.0", "@legendapp/spark-desktop-host": "1.0.0" } });
  write(path.join(host, "AppDelegate.mm"), "host source");
  await build(root, "dev");
  const archive = path.join(root, "macos/Pods/hermes-engine-artifacts/hermes-version-debug.tar.gz");
  write(archive, "cached Hermes download");
  const inode = statSync(archive).ino;
  write(path.join(host, "AppDelegate.mm"), "changed host source");
  await build(root, "dev");
  expect(commandCount("prebuild")).toBe(2);
  const metadata = readJson(path.join(moduleRoot, "package.json"));
  metadata.spark.entitlements = { macos: { "com.apple.security.device.camera": true } };
  writeJson(path.join(moduleRoot, "package.json"), metadata);
  await build(root, "dev");
  await build(root, "dev");
  expect(commandCount("prebuild")).toBe(3);
  expect(commandCount("xcodebuild")).toBe(3);
  expect(statSync(archive).ino).toBe(inode);
});

test("failed prebuild restores cached Pods and a retry regenerates before recording success", async () => {
  await build(root, "dev");
  const archive = path.join(root, "macos/Pods/hermes-engine-artifacts/hermes-version-debug.tar.gz");
  write(archive, "cached Hermes download");
  const inode = statSync(archive).ino;
  const receipt = readFileSync(path.join(root, ".spark/dev-build.json"), "utf8");
  const run = commands.run.getMockImplementation()!;
  commands.run.mockImplementation(async (...args) => {
    const result = await run(...args);
    if (args[1].includes("prebuild")) throw new Error("prebuild failed");
    return result;
  });
  configure(true);
  await expect(build(root, "dev")).rejects.toThrow("prebuild failed");
  expect(statSync(archive).ino).toBe(inode);
  expect(existsSync(path.join(root, ".spark/native-preparation.json"))).toBe(false);
  expect(readFileSync(path.join(root, ".spark/dev-build.json"), "utf8")).toBe(receipt);
  expect(commandCount("xcodebuild")).toBe(1);
  commands.run.mockImplementation(run);
  await build(root, "dev");
  await build(root, "dev");
  expect(statSync(archive).ino).toBe(inode);
  expect(commandCount("prebuild")).toBe(3);
  expect(commandCount("xcodebuild")).toBe(2);
});

test("retry recovers Pods stranded by a terminated prebuild without copying archives", async () => {
  const cache = path.join(root, ".spark/prebuild-cache/macos");
  const archive = path.join(cache, "Pods/hermes-engine-artifacts/hermes-version-debug.tar.gz");
  write(archive, "cached Hermes download");
  write(path.join(cache, "Podfile.lock"), "locked Hermes version");
  const inode = statSync(archive).ino;
  await preserveMacOSPods(root, async () => {
    expect(existsSync(path.join(root, "macos/Pods"))).toBe(false);
    rmSync(path.join(root, "macos"), { recursive: true, force: true });
  });
  expect(statSync(path.join(root, "macos/Pods/hermes-engine-artifacts/hermes-version-debug.tar.gz")).ino).toBe(inode);
  expect(readFileSync(path.join(root, "macos/Podfile.lock"), "utf8")).toBe("locked Hermes version");
  expect(existsSync(cache)).toBe(false);
});

test("conflicting interrupted caches stop without overwriting either Pods copy", async () => {
  const source = path.join(root, ".spark/prebuild-cache/macos/Pods/archive");
  const destination = path.join(root, "macos/Pods/archive");
  write(source, "saved archive");
  write(destination, "existing archive");
  const prepare = vi.fn();
  await expect(preserveMacOSPods(root, prepare)).rejects.toThrow("Cannot restore CocoaPods cache");
  expect(prepare).not.toHaveBeenCalled();
  expect(readFileSync(source, "utf8")).toBe("saved archive");
  expect(readFileSync(destination, "utf8")).toBe("existing archive");
});

test("legacy receipts rebuild once, missing apps rebuild, and force bypasses reuse", async () => {
  const first = await build(root, "dev");
  const file = path.join(root, ".spark/dev-build.json");
  const legacy = readJson(file);
  delete legacy.preparation;
  writeJson(file, legacy);
  await build(root, "dev");
  expect(commandCount("xcodebuild")).toBe(2);
  await build(root, "dev");
  expect(commandCount("xcodebuild")).toBe(2);
  rmSync(first.app, { recursive: true });
  await build(root, "dev");
  expect(commandCount("xcodebuild")).toBe(3);
  await build(root, "dev", true);
  expect(commandCount("xcodebuild")).toBe(4);
  expect(commandCount("prebuild")).toBe(2);
});

test("missing staged frameworks rerun pods without clean prebuild before compilation", async () => {
  await build(root, "dev");
  rmSync(framework(), { recursive: true });
  write(path.join(moduleRoot, "macos/Fixture.mm"), "changed native source");
  await build(root, "dev");
  expect(commandCount("pod")).toBe(2);
  expect(commandCount("prebuild")).toBe(1);
  expect(commandCount("xcodebuild")).toBe(2);
  expect(existsSync(framework())).toBe(true);
});

test("failed artifact restoration stops before Xcode and does not publish a successful build receipt", async () => {
  const first = await build(root, "dev");
  const receipt = readFileSync(path.join(root, ".spark/dev-build.json"), "utf8");
  rmSync(framework(), { recursive: true });
  write(path.join(moduleRoot, "macos/Fixture.mm"), "changed native source");
  commands.restore = false;
  await expect(build(root, "dev")).rejects.toThrow("Native frameworks are missing after pod install");
  expect(commandCount("xcodebuild")).toBe(1);
  expect(readFileSync(path.join(root, ".spark/dev-build.json"), "utf8")).toBe(receipt);
  expect(existsSync(first.app)).toBe(true);
  commands.restore = true;
  await build(root, "dev");
  expect(commandCount("xcodebuild")).toBe(2);
});

test("a missing macOS slice is restored even when the XCFramework container survives", async () => {
  await build(root, "dev");
  rmSync(path.join(framework(), "macos-arm64_x86_64"), { recursive: true });
  write(path.join(moduleRoot, "macos/Fixture.mm"), "changed native source");
  await build(root, "dev");
  expect(commandCount("pod")).toBe(2);
  expect(commandCount("prebuild")).toBe(1);
  expect(commandCount("xcodebuild")).toBe(2);
});
