import { beforeEach, expect, test, vi } from "vitest";
// The hang watchdog in @legendapp/spark/diagnostics against a mocked bridge: validation, wire shapes,
// report routing per watchdog, cleanup and availability. tests/hang-watchdog-native.test.ts runs the native core.
const mocks = vi.hoisted(() => ({
  platform: { OS: "macos" },
  calls: [] as { method: string; args: any }[],
  fail: undefined as undefined | ((method: string) => unknown),
  app: {},
  receive: undefined as undefined | ((event: unknown) => void),
  listeners: 0,
}));
vi.mock("react-native", () => ({
  Platform: mocks.platform,
  TurboModuleRegistry: { get: (name: string) => name === "NativeDesktopApp" ? mocks.app : {
    call(method: string, args: string) {
      mocks.calls.push({ method, args: JSON.parse(args) });
      const error = mocks.fail?.(method);
      return error ? Promise.reject(error) : Promise.resolve("null");
    },
  } },
  NativeEventEmitter: class {
    addListener(_name: string, receive: (event: unknown) => void) {
      mocks.receive = receive; mocks.listeners++;
      return { remove() { mocks.listeners--; } };
    }
  },
}));
const diagnostics = await import("../packages/diagnostics/src/index.ts");
beforeEach(() => { mocks.platform.OS = "macos"; mocks.calls.length = 0; mocks.fail = undefined; });

const frame = { address: "0x1868f4308", image: "/usr/lib/system/libsystem_kernel.dylib", imageAddress: "0x1868f0000", imageOffset: 17160, imageUUID: "2B3A1D7E-0F0C-3C8E-9D5B-6A7E8F9A0B1C", symbol: "__semwait_signal", symbolOffset: 8 };
const report = { durationMs: 612.5, thresholdMs: 250, startedAt: 1760000000000, stack: [frame, { address: "0x1000" }], endedBeforeSampling: false };

test("startHangWatchdog starts one native watchdog per owner and routes only its reports to onHang", async () => {
  const first = vi.fn(), second = vi.fn();
  const a = await diagnostics.startHangWatchdog({ onHang: first });
  const b = await diagnostics.startHangWatchdog({ thresholdMs: 1000, onHang: second });
  const [startA, startB] = mocks.calls;
  expect(startA).toEqual({ method: "startHangWatchdog", args: { owner: expect.any(String), thresholdMs: 250 } });
  expect(startB).toEqual({ method: "startHangWatchdog", args: { owner: expect.any(String), thresholdMs: 1000 } });
  expect(startA!.args.owner).not.toBe(startB!.args.owner);
  mocks.receive!({ type: "hang", owner: startA!.args.owner, ...report });
  expect(first).toHaveBeenCalledExactlyOnceWith(report);
  expect(second).not.toHaveBeenCalled();
  // Cleanup stops callbacks at once, joins concurrent calls and stops only that native watchdog.
  await Promise.all([a.remove(), a.remove()]);
  expect(mocks.calls.slice(2)).toEqual([{ method: "stopHangWatchdog", args: { owner: startA!.args.owner } }]);
  mocks.receive!({ type: "hang", owner: startA!.args.owner, ...report });
  expect(first).toHaveBeenCalledTimes(1);
  mocks.receive!({ type: "hang", owner: startB!.args.owner, ...report });
  expect(second).toHaveBeenCalledTimes(1);
  await b.remove();
  expect(mocks.listeners).toBe(0);
});

test("a native report outside the contract fails loudly instead of reaching onHang", async () => {
  const onHang = vi.fn();
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const watchdog = await diagnostics.startHangWatchdog({ onHang });
  const owner = mocks.calls[0]!.args.owner;
  try {
    for (const bad of [{ ...report, durationMs: "1" }, { ...report, stack: [{ image: "x" }] }, { ...report, stack: [{ ...frame, imageOffset: "1" }] }, { ...report, stack: undefined },
      { ...report, endedBeforeSampling: undefined }, { ...report, endedBeforeSampling: 1 }, { ...report, endedBeforeSampling: true }]) mocks.receive!({ type: "hang", owner, ...bad });
    expect(onHang).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledTimes(7);
    expect(errors.mock.calls[0]![0].cause).toMatchObject({ name: "SparkError", code: "E_INVALID_DATA" });
  } finally { errors.mockRestore(); await watchdog.remove(); }
});

test("options are validated before anything starts", async () => {
  const onHang = () => {};
  for (const [options, code] of [
    [undefined, "E_INVALID_ARGUMENT"], [{}, "E_INVALID_ARGUMENT"], [{ onHang: "no" }, "E_INVALID_ARGUMENT"],
    [{ onHang, thresholdMs: 49 }, "E_INVALID_ARGUMENT"], [{ onHang, thresholdMs: 60001 }, "E_INVALID_ARGUMENT"], [{ onHang, thresholdMs: 250.5 }, "E_INVALID_ARGUMENT"],
    [{ onHang, interval: 10 }, "E_UNSUPPORTED_OPTION"], [{ onHang, interval: undefined }, "E_UNSUPPORTED_OPTION"],
  ] as const) await expect(diagnostics.startHangWatchdog(options as never)).rejects.toMatchObject({ name: "SparkError", code });
  for (const duration of [0, 10001, 1.5, Number.NaN, "100"]) await expect(diagnostics.simulateHang(duration as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(mocks.calls).toEqual([]);
  expect(mocks.listeners).toBe(0);
});

test("a native start failure keeps its code and leaves no subscription", async () => {
  mocks.fail = () => Object.assign(new Error("exists"), { code: "E_ALREADY_EXISTS" });
  await expect(diagnostics.startHangWatchdog({ onHang: () => {} })).rejects.toMatchObject({ code: "E_ALREADY_EXISTS" });
  expect(mocks.listeners).toBe(0);
});

test("simulateHang sends its duration and resolves when the main thread is free", async () => {
  await diagnostics.simulateHang(1000);
  expect(mocks.calls).toEqual([{ method: "simulateHang", args: { durationMs: 1000 } }]);
});

test("simulateHang keeps the native E_UNAVAILABLE of a build without the test driver", async () => {
  mocks.fail = method => method === "simulateHang" && Object.assign(new Error("simulateHang exists only in Debug builds and builds with the test driver (macos.testDriverInRelease)"), { code: "E_UNAVAILABLE" });
  await expect(diagnostics.simulateHang(1000)).rejects.toMatchObject({ name: "SparkError", code: "E_UNAVAILABLE" });
});

test("availability is truthful per platform, and unsupported calls reject typed after validation", async () => {
  expect(diagnostics.getHangWatchdogAvailability()).toEqual({ available: true });
  for (const OS of ["windows", "ios", "android", "web"]) {
    mocks.platform.OS = OS;
    expect(diagnostics.getHangWatchdogAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
    await expect(diagnostics.startHangWatchdog({ onHang: () => {} })).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
    await expect(diagnostics.simulateHang(100)).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
    await expect(diagnostics.startHangWatchdog({ onHang: () => {}, thresholdMs: 1 })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  }
  expect(mocks.calls).toEqual([]);
});

test("a missing native module is reported, not papered over", async () => {
  vi.resetModules();
  vi.doMock("react-native", () => ({ Platform: { OS: "macos" }, TurboModuleRegistry: { get: () => null } }));
  const isolated = await import("../packages/diagnostics/src/index.ts");
  expect(isolated.getHangWatchdogAvailability()).toEqual({ available: false, reason: "missing-module" });
  await expect(isolated.startHangWatchdog({ onHang: () => {} })).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
  await expect(isolated.simulateHang(100)).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
  vi.doUnmock("react-native");
});
