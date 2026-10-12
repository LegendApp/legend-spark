import { beforeEach, expect, test, vi } from "vitest";
// Crash reporting in @legendapp/spark/diagnostics against a mocked bridge: consent, validation, report
// contracts, the JavaScript global handler and availability. tests/crash-reporting-native.test.ts runs the native core.
const mocks = vi.hoisted(() => {
  const state = {
    platform: { OS: "macos" },
    calls: [] as { method: string; args: any }[],
    results: {} as Record<string, unknown>,
    recorded: [] as any[],
    recordId: "1760000000000-42-js1",
    previous: vi.fn(),
    handler: undefined as undefined | ((error: unknown, isFatal?: boolean) => void),
  };
  (globalThis as any).ErrorUtils = { getGlobalHandler: () => state.previous, setGlobalHandler: (handler: typeof state.handler) => { state.handler = handler; } };
  return state;
});
vi.mock("react-native", () => ({
  Platform: mocks.platform,
  TurboModuleRegistry: { get: () => ({
    call(method: string, args: string) {
      mocks.calls.push({ method, args: JSON.parse(args) });
      const result = mocks.results[method];
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(JSON.stringify(result ?? null));
    },
    recordJavaScriptError(json: string) { mocks.recorded.push(JSON.parse(json)); return mocks.recordId; },
  }) },
  NativeEventEmitter: class { addListener() { return { remove() {} }; } },
}));
const diagnostics = await import("../packages/diagnostics/src/index.ts");
beforeEach(() => {
  mocks.platform.OS = "macos"; mocks.calls.length = 0; mocks.recorded.length = 0; mocks.previous.mockReset();
  mocks.recordId = "1760000000000-42-js1";
  mocks.results = { getConsent: true, getReports: [] };
});

const app = { version: "1.0", build: "7" };
const native = {
  id: "1760000000000-42", kind: "native", createdAt: 1760000000000, simulated: true, app, signal: "SIGSEGV", signalCode: 2, faultAddress: "0x0", mainThread: true,
  stack: [{ address: "0x100003f00", image: "/Applications/App.app/Contents/MacOS/App", imageAddress: "0x100000000", imageOffset: 16128, imageUUID: "2B3A1D7E-0F0C-3C8E-9D5B-6A7E8F9A0B1C", symbol: "SparkCrashNow", symbolOffset: 12 }],
};
const javascript = { id: "1760000000001-42-js1", kind: "javascript", createdAt: 1760000000001, simulated: false, app, fatal: true, name: "TypeError", message: "x is undefined", stack: "TypeError: x is undefined\n    at f (index.bundle:1:2)" };

test("consent is read and written natively; setting it validates first", async () => {
  expect(await diagnostics.getCrashReportingConsent()).toBe(true);
  await diagnostics.setCrashReportingConsent(false);
  await expect(diagnostics.setCrashReportingConsent("yes" as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(mocks.calls).toEqual([{ method: "getConsent", args: {} }, { method: "setConsent", args: { granted: false } }]);
  mocks.results.getConsent = "true";
  await expect(diagnostics.getCrashReportingConsent()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});

test("reports pass through when they match the contract, and fail loudly when they do not", async () => {
  mocks.results.getReports = [javascript, native];
  expect(await diagnostics.getCrashReports()).toEqual([javascript, native]);
  for (const bad of [{ ...native, signal: "SIGKILL" }, { ...native, stack: [{ image: "x" }] }, { ...native, exception: { name: 1 } }, { ...javascript, fatal: false }, { ...javascript, app: {} }, { ...native, kind: "other" }]) {
    mocks.results.getReports = [bad];
    await expect(diagnostics.getCrashReports()).rejects.toMatchObject({ name: "SparkError", code: "E_INVALID_DATA" });
  }
});

test("deleteCrashReports sends ids, or nothing to delete all; bad ids reject before native", async () => {
  await diagnostics.deleteCrashReports([native.id]);
  await diagnostics.deleteCrashReports();
  for (const ids of ["x", [1], ["../escape"], [""]]) await expect(diagnostics.deleteCrashReports(ids as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(mocks.calls).toEqual([{ method: "deleteReports", args: { ids: [native.id] } }, { method: "deleteReports", args: {} }]);
});

test("simulateCrash crashes a native helper through the bridge, or records a real TypeError without passing it on", async () => {
  mocks.results.simulateCrash = native;
  expect(await diagnostics.simulateCrash("badAccess")).toEqual(native);
  expect(mocks.calls).toEqual([{ method: "getConsent", args: {} }, { method: "simulateCrash", args: { kind: "badAccess" } }]);

  mocks.calls.length = 0;
  mocks.results.getReports = [{ ...javascript, id: mocks.recordId, simulated: true }];
  expect(await diagnostics.simulateCrash("javascript")).toMatchObject({ id: mocks.recordId, kind: "javascript" });
  expect(mocks.recorded).toEqual([{ fatal: true, simulated: true, name: "TypeError", message: expect.any(String), stack: expect.stringContaining("sparkSimulatedJavaScriptCrash") }]);
  expect(mocks.previous).not.toHaveBeenCalled();

  mocks.recordId = "";
  await expect(diagnostics.simulateCrash("javascript")).rejects.toMatchObject({ code: "E_NATIVE" });
  await expect(diagnostics.simulateCrash("segfault" as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  mocks.results.getConsent = false;
  mocks.calls.length = 0;
  await expect(diagnostics.simulateCrash("abort")).rejects.toMatchObject({ code: "E_PERMISSION_DENIED" });
  expect(mocks.calls).toEqual([{ method: "getConsent", args: {} }]);
});

test("the global handler records fatal errors synchronously, then hands every error to the previous handler", () => {
  const error = new TypeError("x is undefined");
  mocks.handler!(error, true);
  expect(mocks.recorded).toEqual([{ fatal: true, simulated: false, name: "TypeError", message: "x is undefined", stack: error.stack }]);
  expect(mocks.previous).toHaveBeenCalledWith(error, true);
  mocks.handler!("thrown string", true);
  expect(mocks.recorded[1]).toMatchObject({ name: "Error", message: "thrown string" });
  mocks.handler!(error, false);
  expect(mocks.recorded).toHaveLength(2);
  expect(mocks.previous).toHaveBeenCalledTimes(3);
});

test("availability is truthful per platform, and unsupported calls reject typed after validation", async () => {
  expect(diagnostics.getCrashReportingAvailability()).toEqual({ available: true });
  for (const OS of ["windows", "ios", "android", "web"]) {
    mocks.platform.OS = OS;
    expect(diagnostics.getCrashReportingAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
    for (const call of [() => diagnostics.getCrashReportingConsent(), () => diagnostics.setCrashReportingConsent(true), () => diagnostics.getCrashReports(), () => diagnostics.deleteCrashReports(), () => diagnostics.simulateCrash("abort")])
      await expect(call()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
    await expect(diagnostics.simulateCrash("x" as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  }
  expect(mocks.calls).toEqual([]);
});

test("a missing native module is reported, not papered over, and installs no handler", async () => {
  vi.resetModules();
  const set = vi.fn();
  (globalThis as any).ErrorUtils = { getGlobalHandler: () => () => {}, setGlobalHandler: set };
  vi.doMock("react-native", () => ({ Platform: { OS: "macos" }, TurboModuleRegistry: { get: () => null } }));
  const isolated = await import("../packages/diagnostics/src/index.ts");
  expect(isolated.getCrashReportingAvailability()).toEqual({ available: false, reason: "missing-module" });
  await expect(isolated.getCrashReports()).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
  expect(set).not.toHaveBeenCalled();
  vi.doUnmock("react-native");
});
