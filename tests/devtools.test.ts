import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ call: vi.fn(), platform: { OS: "macos" }, module: true as boolean }));
vi.mock("react-native", () => ({ Platform: mocks.platform, TurboModuleRegistry: { get: () => mocks.module ? { call: mocks.call } : null } }));
import { getDevToolsAvailability, openDevTools } from "../packages/desktop/devtools";
import { getDevToolsOpener } from "../packages/desktop-app/src/contracts/developer-tools";
import { installDevToolsOpener } from "../packages/desktop-app/src/devtools-opener";
const globals = globalThis as { __DEV__?: boolean; __THREADED_RUNTIME_ENV__?: { runtimeName?: string } };
const calls = () => mocks.call.mock.calls.filter(([name]) => name === "openDevTools").map(([, json]) => JSON.parse(json));
beforeEach(() => {
  mocks.call.mockReset().mockResolvedValue("null"); mocks.platform.OS = "macos"; mocks.module = true;
  globals.__DEV__ = true; delete globals.__THREADED_RUNTIME_ENV__;
});

test("availability is macOS development builds with the desktop module", () => {
  expect(getDevToolsAvailability()).toEqual({ available: true });
  globals.__DEV__ = false; expect(getDevToolsAvailability()).toEqual({ available: false, reason: "development-only" });
  globals.__DEV__ = true; mocks.module = false; expect(getDevToolsAvailability()).toEqual({ available: false, reason: "missing-module" });
  mocks.platform.OS = "windows"; expect(getDevToolsAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
});

test("openDevTools targets the calling runtime unless told otherwise", async () => {
  await openDevTools();
  await openDevTools({ runtime: "shared" });
  await openDevTools({ runtime: { isolated: "ks-plugins" } });
  globals.__THREADED_RUNTIME_ENV__ = { runtimeName: "ks-devtools-worker" };
  await openDevTools();
  await openDevTools({ runtime: "shared" });
  expect(calls()).toEqual([{}, {}, { runtime: "ks-plugins" }, { runtime: "ks-devtools-worker" }, {}]);
});

test("openDevTools validates the whole request before native work", async () => {
  for (const [options, code] of [[null, "E_INVALID_ARGUMENT"], [{ target: "x" }, "E_UNSUPPORTED_OPTION"], [{ runtime: undefined, extra: undefined }, "E_UNSUPPORTED_OPTION"],
    [{ runtime: "main" }, "E_INVALID_ARGUMENT"], [{ runtime: { isolated: "" } }, "E_INVALID_ARGUMENT"], [{ runtime: { isolated: "a", module: {} } }, "E_UNSUPPORTED_OPTION"], [{ runtime: ["a"] }, "E_INVALID_ARGUMENT"]] as const)
    await expect(openDevTools(options as never)).rejects.toMatchObject({ code });
  expect(mocks.call).not.toHaveBeenCalled();
});

test("openDevTools is unavailable outside development builds and reports native failures", async () => {
  globals.__DEV__ = false; await expect(openDevTools()).rejects.toMatchObject({ code: "E_UNAVAILABLE" });
  globals.__DEV__ = true; mocks.platform.OS = "windows"; await expect(openDevTools()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  mocks.platform.OS = "macos"; mocks.module = false; await expect(openDevTools()).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
  expect(mocks.call).not.toHaveBeenCalled();
  mocks.module = true; mocks.call.mockRejectedValue(Object.assign(Error('No debug target "App (isolated runtime: gone)"'), { code: "E_NOT_FOUND" }));
  await expect(openDevTools({ runtime: { isolated: "gone" } })).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  mocks.call.mockResolvedValue("{}"); await expect(openDevTools()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});

test("the Developer menu's Open DevTools opens the key window's runtime through openDevTools", async () => {
  globals.__DEV__ = false; installDevToolsOpener(); expect(getDevToolsOpener()).toBeUndefined();
  globals.__DEV__ = true; installDevToolsOpener();
  const open = getDevToolsOpener()!;
  await open({ runtime: "shared" });
  await open({ runtime: "isolated", name: "ks-plugins" });
  // Called from the shared runtime, the target decides; the caller's own runtime does not.
  globals.__THREADED_RUNTIME_ENV__ = { runtimeName: "other" };
  await open({ runtime: "shared" });
  expect(calls()).toEqual([{}, { runtime: "ks-plugins" }, {}]);
  expect(() => installDevToolsOpener()).toThrow(expect.objectContaining({ code: "E_ALREADY_EXISTS" }));
});

// Release builds: React Native compiles RCT_DEV to 0, so none of the native DevTools code (the ⌥⌘I monitor,
// the dev-server lookup, the module operation) is compiled. RN registers no debug target unless Fusebox is enabled
// (development builds). The release gate (#274) inspects the built app.
test("native DevTools code is compiled only in development builds", () => {
  const body = (file: string) => readFileSync(file, "utf8");
  const devtools = body("packages/desktop-app/macos/SparkDevTools.mm").trim();
  expect(devtools.split("\n").filter(line => line.startsWith("#")).slice(0, 2)).toEqual(['#import "SparkDevTools.h"', "#if RCT_DEV"]);
  expect(devtools.endsWith("#endif")).toBe(true);
  expect(devtools.match(/^#(if|endif)\b/gm)).toEqual(["#if", "#endif"]);
  const header = body("packages/desktop-app/macos/SparkDevTools.h");
  expect(header.slice(header.indexOf("#if RCT_DEV"))).toMatch(/^#if RCT_DEV\n[\s\S]*FOUNDATION_EXPORT void SparkOpenDevTools[\s\S]*\n#endif\n$/);
  expect(header.slice(0, header.indexOf("#if RCT_DEV"))).not.toContain("FOUNDATION_EXPORT");
  const guarded = (source: string, marker: string) => {
    const at = source.indexOf(marker);
    expect(at, marker).toBeGreaterThan(0);
    expect(source.lastIndexOf("#if RCT_DEV", at)).toBeGreaterThan(source.lastIndexOf("#endif", at));
  };
  guarded(body("packages/desktop-app/macos/RNDesktopApp.mm"), "SparkOpenDevTools(");
  guarded(body("packages/desktop-host/AppDelegate.mm"), "SparkInstallDevTools(");
  const host = createRequire(import.meta.url)("../packages/config-plugin/devtools-targets.cjs").replacements["ReactCommon/react/runtime/platform/ios/ReactCommon/RCTHost.mm"] as [string, string][];
  expect(host.find(([, after]) => after.includes("HostTarget::create"))![1]).toContain("if (inspectorFlags.getFuseboxEnabled() && !_inspectorTarget) {");
  expect(host.find(([, after]) => after.includes("_addInspectorPageWithTitle:title]"))![1]).toContain("if (_inspectorTarget) {");
});
