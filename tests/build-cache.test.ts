import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "../packages/cli/src/build.ts";
import { readJson, writeJson } from "../packages/cli/src/project.ts";

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
