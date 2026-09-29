import { test, expect } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { nativePackages, runtimeFor, incompatible, writeJson, VERSION } from "../packages/cli/src/project.ts";
import { readRuntime, findGo, registerRuntime } from "../packages/cli/src/local.ts";
import { architecture, projectPlatform, windowsArchitecture } from "../packages/cli/src/platform.ts";
import { buildWindows, isWindowsDebugProduct, preserveWindowsBuildOutputs } from "../packages/cli/src/windows.ts";
const { patchHost, withoutPackaging, unpackagedApp } = require("../packages/config-plugin/windows.plugin.cjs");
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-windows-test-"));
  writeJson(path.join(root, "package.json"), { name: "app", dependencies: {} });
  writeJson(path.join(root, "app.json"), { expo: { name: "App", platforms: ["windows"] } });
  return { root, close: () => rmSync(root, { recursive: true, force: true }) };
}
test("Windows uses the shared graph and runtime identity, including native source changes", () => {
  const f = fixture();
  try {
    const baseline = runtimeFor(f.root, nativePackages(f.root), "go");
    expect(projectPlatform(f.root)).toBe("windows");
    expect(baseline.platform).toBe("windows"); expect(baseline.arch).toBe(architecture("windows"));
    writeFileSync(path.join(f.root, "App.tsx"), "export default 1");
    expect(runtimeFor(f.root, nativePackages(f.root), "go").fingerprint).toBe(baseline.fingerprint);
    writeJson(path.join(f.root, "node_modules/probe/package.json"), { name: "probe", version: "1" });
    mkdirSync(path.join(f.root, "node_modules/probe/windows"));
    const source = path.join(f.root, "node_modules/probe/windows/Module.cpp");
    writeFileSync(source, "first");
    writeJson(path.join(f.root, "package.json"), { dependencies: { probe: "1" } });
    expect(incompatible(baseline, nativePackages(f.root), "windows")).toEqual(["probe"]);
    const custom = runtimeFor(f.root, nativePackages(f.root), "dev");
    writeJson(path.join(f.root, "node_modules/probe/windows/packages.lock.json"), { restored: true });
    writeJson(path.join(f.root, "node_modules/probe/windows/obj/project.assets.json"), { generated: true });
    expect(incompatible(custom, nativePackages(f.root), "windows")).toEqual([]);
    writeFileSync(source, "second");
    expect(incompatible(custom, nativePackages(f.root), "windows")).toEqual(["probe"]);
    expect(incompatible(custom, [], "macos")).toEqual(["framework runtime version/platform mismatch"]);
  } finally { f.close(); }
});
test("Windows rejects direct native dependencies without Windows implementations", () => {
  const f = fixture();
  try {
    writeJson(path.join(f.root, "node_modules/mac-only/package.json"), { name: "mac-only", version: "1", codegenConfig: {} });
    writeJson(path.join(f.root, "package.json"), { dependencies: { "mac-only": "1" } });
    expect(() => nativePackages(f.root)).toThrow("no Windows implementation");
  } finally { f.close(); }
});
test("Windows includes host-provided SDK modules without separate native projects", () => {
  const f = fixture();
  try {
    const names = ["@legendapp/spark-desktop-app", "@legendapp/spark-desktop-windows", "@legendapp/spark-desktop-shortcuts", "@legendapp/spark-native-menu", "@legendapp/spark-updates"];
    for (const name of names) writeJson(path.join(f.root, "node_modules", name, "package.json"), { name, version: "1", spark: { nativeModules: [name] } });
    writeJson(path.join(f.root, "package.json"), { dependencies: Object.fromEntries(names.map(name => [name, "1"])) });
    expect(nativePackages(f.root).map(pkg => pkg.name).sort()).toEqual(names.sort());
  } finally { f.close(); }
});
test("runtime surface hooks are conditional, repeatable, and removable", () => {
  const source = '#include "NativeModules.h"\nAddAttributedModules(packageBuilder, true);\nwinrt::init_apartment(winrt::apartment_type::single_threaded);\nauto settings{reactNativeWin32App.ReactNativeHost().InstanceSettings()};\nappWindow.Resize({1000, 1000});\n';
  const core = readFileSync(new URL("../packages/desktop-host/windows/runtime.inc", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../packages/desktop-host/windows/runtimes.inc", import.meta.url), "utf8");
  const metadata = { mode: "dev", fingerprint: "b".repeat(64) };
  const first = patchHost(source, core + worker, metadata);
  expect(patchHost(first, core + worker, metadata)).toBe(first);
  expect(first.match(/SparkWin::RegisterRuntimeSurface\(packageBuilder\)/g)).toHaveLength(1);
  expect(patchHost(first, core, metadata)).not.toContain("RegisterRuntimeSurface");
  expect(() => patchHost(source.replace("AddAttributedModules(packageBuilder, true);", ""), core + worker, metadata)).toThrow("cannot register runtime surfaces");
});
test("the shared Go registry keeps Windows and macOS runtimes separate", () => {
  const f = fixture(), previous = process.env.SPARK_HOME;
  process.env.SPARK_HOME = path.join(f.root, "registry");
  try {
    const win = path.join(f.root, "windows-runtime"), mac = path.join(f.root, "mac-runtime.app");
    writeJson(path.join(win, "spark-runtime.json"), { schema: 1, framework: VERSION, platform: "windows", arch: architecture("windows"), mode: "go", modules: {}, fingerprint: "win" });
    writeFileSync(path.join(win, "MyApp.exe"), "fixture, not executable");
    writeJson(path.join(mac, "Contents/Resources/spark-runtime.json"), { schema: 1, framework: VERSION, platform: "macos", arch: "arm64", mode: "go", modules: {}, fingerprint: "mac" });
    mkdirSync(path.join(mac, "Contents/MacOS"));
    registerRuntime(win); registerRuntime(mac);
    expect(findGo([], mac, "windows")?.app).toBe(win);
    expect(findGo([], win, "macos")?.app).toBe(mac);
    rmSync(path.join(win, "MyApp.exe")); expect(readRuntime(win)).toBeUndefined();
  } finally { if (previous === undefined) delete process.env.SPARK_HOME; else process.env.SPARK_HOME = previous; f.close(); }
});
test("the config plugin embeds the shared runtime and keeps repeatable host hooks", () => {
  const source = '#include "NativeModules.h"\nint main() {\n  winrt::init_apartment(winrt::apartment_type::single_threaded);\n  auto settings{reactNativeWin32App.ReactNativeHost().InstanceSettings()};\n  appWindow.Title(L"Go");\n  appWindow.Resize({1000, 1000});\n}\n';
  const core = readFileSync(new URL("../packages/desktop-host/windows/runtime.inc", import.meta.url), "utf8");
  const metadata = { mode: "dev", fingerprint: "a".repeat(64), platform: "windows", arch: "x64" };
  const embedded = core + '\nvoid helper() { appWindow.Resize({400, 300}); }\n';
  const first = patchHost(source, embedded, metadata);
  expect(patchHost(first, embedded, metadata)).toBe(first);
  expect(first).toContain("void helper() { appWindow.Resize({400, 300}); }");
  expect(first.match(/SparkWin::ForwardLaunch\(\)/g)).toHaveLength(1);
  expect(first.indexOf("SparkWin::ForwardLaunch()")).toBeLessThan(first.indexOf("auto settings{"));
  expect(() => patchHost(source.replace("winrt::init_apartment(winrt::apartment_type::single_threaded);", ""), core, metadata)).toThrow("template changed");
  expect(first).toContain('"mode":"dev"'); expect(first).toContain("NativeSparkRuntime");
  expect(() => patchHost("wrong template", core, metadata)).toThrow("template changed");
  const globals: any[] = [];
  const document = [{ Project: [{ PropertyGroup: globals, ":@": { "@_Label": "Globals" } }] }];
  unpackagedApp(document); const json = JSON.stringify(document); unpackagedApp(document);
  expect(JSON.stringify(document)).toBe(json);
  expect(globals.find(node => node.WindowsPackageType).WindowsPackageType).toEqual([{ "#text": "None" }]);
  const solution = 'Project("TYPE") = "App", "App.vcxproj", "{APP}"\r\nEndProject\r\nProject("TYPE") = "Pack", "Pack.wapproj", "{PACK}"\r\nEndProject\r\n{PACK}.Debug = Debug\r\n';
  expect(withoutPackaging(solution)).toContain("App.vcxproj"); expect(withoutPackaging(solution)).not.toContain("PACK");
});
test("Windows production builds fail explicitly before running native tools", async () => {
  await expect(buildWindows("unused", "release", false)).rejects.toThrow("production builds");
});

test("Windows canonical config does not require a macOS bundle identity", () => {
  const { toExpo } = require("../packages/config-plugin/config.cjs");
  const config = toExpo({ name: "Windows", version: "1.0.0", projectId: "test-windows", platforms: ["windows"] });
  expect(config.expo.platforms).toEqual(["windows"]);
  expect(config.expo.macos).toBeUndefined();
  expect(config.expo.windows.displayName).toBe("Windows");
  expect(() => toExpo({ name: "Mac", version: "1.0.0", projectId: "test-mac" })).toThrow("bundleIdentifier");
});



test("Windows architecture follows the native CPU, including emulated CLI processes", () => {
  expect(windowsArchitecture("win32", "arm64", {})).toBe("arm64");
  expect(windowsArchitecture("win32", "arm64", { PROCESSOR_ARCHITECTURE: "AMD64" })).toBe("arm64");
  expect(windowsArchitecture("win32", "x86_64", {})).toBe("x64");
  expect(windowsArchitecture("win32", "x64", { PROCESSOR_ARCHITECTURE: "ARM64" })).toBe("arm64");
  expect(windowsArchitecture("win32", "x64", { PROCESSOR_ARCHITECTURE: "AMD64", PROCESSOR_ARCHITEW6432: "ARM64" })).toBe("arm64");
  expect(windowsArchitecture("win32", "x64", { PROCESSOR_ARCHITECTURE: "AMD64" })).toBe("x64");
  expect(windowsArchitecture("darwin", "arm64", {})).toBe("x64");
  expect(windowsArchitecture("darwin", "arm64", { SPARK_WINDOWS_ARCH: "ARM64" })).toBe("arm64");
  expect(windowsArchitecture("win32", "arm64", { SPARK_WINDOWS_ARCH: "x64" })).toBe("x64");
  expect(() => windowsArchitecture("win32", "x64", { SPARK_WINDOWS_ARCH: "x86" })).toThrow("SPARK_WINDOWS_ARCH");
  expect(() => windowsArchitecture("win32", "ia32", {})).toThrow("Unsupported Windows architecture");
});

test("Windows runtime fingerprints and registry selection distinguish both architectures", () => {
  const f = fixture(), previousHome = process.env.SPARK_HOME, previousArch = process.env.SPARK_WINDOWS_ARCH;
  process.env.SPARK_HOME = path.join(f.root, "registry");
  try {
    process.env.SPARK_WINDOWS_ARCH = "x64";
    const x64 = runtimeFor(f.root, [], "go");
    const x64App = path.join(f.root, "x64-runtime");
    writeJson(path.join(x64App, "spark-runtime.json"), x64);
    writeFileSync(path.join(x64App, "MyApp.exe"), "fixture");
    registerRuntime(x64App);
    process.env.SPARK_WINDOWS_ARCH = "arm64";
    const arm64 = runtimeFor(f.root, [], "go");
    expect(arm64.arch).toBe("arm64");
    expect(arm64.fingerprint).not.toBe(x64.fingerprint);
    expect(readRuntime(x64App)?.arch).toBe("x64");
    expect(incompatible(x64, [], "windows")).not.toEqual([]);
    expect(findGo([], x64App, "windows")).toBeUndefined();
    const arm64App = path.join(f.root, "arm64-runtime");
    writeJson(path.join(arm64App, "spark-runtime.json"), arm64);
    writeFileSync(path.join(arm64App, "MyApp.exe"), "fixture");
    registerRuntime(arm64App);
    expect(findGo([], x64App, "windows")?.app).toBe(arm64App);
    process.env.SPARK_WINDOWS_ARCH = "x64";
    expect(readRuntime(arm64App)?.arch).toBe("arm64");
    expect(findGo([], arm64App, "windows")?.app).toBe(x64App);
  } finally {
    if (previousHome === undefined) delete process.env.SPARK_HOME; else process.env.SPARK_HOME = previousHome;
    if (previousArch === undefined) delete process.env.SPARK_WINDOWS_ARCH; else process.env.SPARK_WINDOWS_ARCH = previousArch;
    f.close();
  }
});

test("Windows output discovery selects Debug executables for the requested architecture", () => {
  expect(isWindowsDebugProduct("ARM64/Debug/MyApp/MyApp.exe", "arm64")).toBe(true);
  expect(isWindowsDebugProduct(String.raw`x64\Debug\MyApp\MyApp.exe`, "x64")).toBe(true);
  expect(isWindowsDebugProduct("x64/Debug/MyApp/MyApp.exe", "arm64")).toBe(false);
  expect(isWindowsDebugProduct("ARM64/Release/MyApp/MyApp.exe", "arm64")).toBe(false);
  expect(isWindowsDebugProduct("ARM64/Debug/MyApp/Other.exe", "arm64")).toBe(false);
  expect(isWindowsDebugProduct("Debug/MyApp.exe", "arm64")).toBe(false);
});


test("Windows associations preserve project identity and validate shell inputs", async () => {
  const { associationPlan } = await import("../packages/cli/src/windows-associations.ts");
  const expo = { name: "Editor", scheme: ["spark-editor", "spark-editor"], extra: { spark: { projectId: "editor", documentTypes: [{ name: "Text", contentTypes: ["public.plain-text"] }, { name: "Custom", extensions: ["CUSTOM"] }] } } };
  const plan = associationPlan(expo, String.raw`C:\Program Files\Editor\MyApp.exe`);
  expect(plan.protocols).toEqual(["spark-editor"]);
  expect(plan.extensions).toEqual(["txt", "custom"]);
  expect(plan.appId).toMatch(/^Spark\.[a-f0-9]{64}$/);
  expect(associationPlan({ ...expo, name: "Renamed" }, plan.executable).appId).toBe(plan.appId);
  expect(() => associationPlan({ ...expo, scheme: "bad/path" }, plan.executable)).toThrow();
  expect(() => associationPlan(expo, 'C:\\app.exe" evil')).toThrow();
  expect(() => associationPlan({ ...expo, extra: { spark: { projectId: "x", documentTypes: [{ name: "Unknown", contentTypes: ["custom.unknown"] }] } } }, plan.executable)).toThrow("Add extensions");
});

test("Windows cold-launch defaults cannot terminate the embedded C++ string", () => {
  const source = '#include "NativeModules.h"\nwinrt::init_apartment(winrt::apartment_type::single_threaded);\nappWindow.Resize({1000, 1000});\nauto settings{reactNativeWin32App.ReactNativeHost().InstanceSettings()};';
  const runtime = readFileSync(new URL("../packages/desktop-host/windows/runtime.inc", import.meta.url), "utf8");
  const output = patchHost(source, runtime, { mode: "dev", fingerprint: "a".repeat(64) }, { SPARK_PROJECT_NAME: ')spark"; malicious();' });
  expect(output).not.toContain(')spark"; malicious');
  expect(output).toContain('\\u0029spark');
  expect(output).toContain('SparkInitializeEnvironment();');
});

for (const fail of [false, true]) test(`Windows prebuild preserves native outputs after ${fail ? "failure" : "success"}`, async () => {
  const f = fixture();
  const outputs = ["windows/ARM64/Debug/Microsoft.UI.Xaml/resources.pri", "windows/MyApp/ARM64/Debug/MyApp.obj", "windows/x64/Debug/MyApp.exe"];
  try {
    for (const output of outputs) {
      mkdirSync(path.dirname(path.join(f.root, output)), { recursive: true });
      writeFileSync(path.join(f.root, output), output);
    }
    const source = path.join(f.root, "windows/MyApp/MyApp.cpp");
    writeFileSync(source, "original");
    const prepare = preserveWindowsBuildOutputs(f.root, async () => {
      for (const output of outputs) expect(existsSync(path.join(f.root, output))).toBe(false);
      expect(readFileSync(source, "utf8")).toBe("original");
      writeFileSync(source, "updated");
      if (fail) throw new Error("prebuild failed");
    });
    if (fail) await expect(prepare).rejects.toThrow("prebuild failed");
    else await prepare;
    for (const output of outputs) expect(readFileSync(path.join(f.root, output), "utf8")).toBe(output);
    expect(readFileSync(source, "utf8")).toBe("updated");
  } finally { f.close(); }
});
