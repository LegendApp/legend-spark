import { beforeEach, expect, test, vi } from "vitest";
// @legendapp/spark/permissions against a mocked bridge: state mapping, validation, wire shapes, errors, change events and availability.
const calls: { method: string; args: any }[] = [];
let reply: (method: string, args: any) => unknown = () => null;
let call = (method: string, args: string): Promise<string> => { calls.push({ method, args: JSON.parse(args) }); return Promise.resolve(JSON.stringify(reply(method, JSON.parse(args)))); };
const record = call;
const platform = { OS: "macos" };
const module = { call: (method: string, args: string) => call(method, args) };
const emitted: ((event: unknown) => void)[] = [];
class NativeEventEmitter { addListener(_name: string, listener: (event: unknown) => void) { emitted.push(listener); return { remove() {} }; } }
vi.doMock("react-native", () => ({ Platform: platform, TurboModuleRegistry: { get: () => module }, NativeEventEmitter }));
const permissions = await import("../packages/permissions/src/index.ts");
const emit = (event: object) => emitted.forEach(listener => listener(event));
const ALL = { camera: "notDetermined", microphone: "notDetermined", screenRecording: "notGranted", accessibility: "notGranted", inputMonitoring: "notDetermined", contacts: "notDetermined", calendar: "notDetermined", photos: "notDetermined", location: "notDetermined", speechRecognition: "notDetermined" };
beforeEach(() => { platform.OS = "macos"; call = record; reply = () => null; calls.length = 0; });

test("availability reports macOS and other platforms; unsupported calls reject after validation", async () => {
  expect(permissions.getPermissionAvailability()).toEqual({ available: true });
  platform.OS = "windows";
  expect(permissions.getPermissionAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
  await expect(permissions.getPermissionStatus("camera")).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(permissions.requestPermission("microphone")).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(permissions.openPermissionSettings("photos")).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(permissions.addPermissionListener(() => {})).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(permissions.getPermissionStatus("bluetooth" as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(calls).toEqual([]);
});

test("every native authorization maps to a status, granted and canAskAgain, keeping the native state", async () => {
  const cases: [string, string, boolean, boolean | null][] = [
    ["notDetermined", "undetermined", false, true], ["authorized", "granted", true, false], ["denied", "denied", false, false],
    ["restricted", "denied", false, false], ["unknown", "unknown", false, null],
  ];
  for (const [authorization, status, granted, canAskAgain] of cases) {
    reply = () => authorization;
    expect(await permissions.getPermissionStatus("camera")).toEqual({ kind: "camera", status, granted, canAskAgain, macos: { authorization } });
  }
  reply = () => "writeOnly";
  expect(await permissions.requestPermission("calendar")).toEqual({ kind: "calendar", status: "denied", granted: false, canAskAgain: true, macos: { authorization: "writeOnly" } });
  reply = () => "notGranted";
  expect(await permissions.getPermissionStatus("screenRecording")).toEqual({ kind: "screenRecording", status: "denied", granted: false, canAskAgain: null, macos: { authorization: "notGranted" } });
  expect(calls.map(entry => entry.method)).toEqual(["status", "status", "status", "status", "status", "request", "status"]);
  expect(calls[5]!.args).toEqual({ kind: "calendar" });
});

test("a state the kind cannot have, or a malformed result, rejects E_INVALID_DATA", async () => {
  reply = () => "writeOnly";
  await expect(permissions.getPermissionStatus("camera")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  reply = () => "notDetermined";
  await expect(permissions.getPermissionStatus("accessibility")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  reply = () => ({ authorization: "authorized" });
  await expect(permissions.getPermissionStatus("photos")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});

test("automation takes the target app's bundle identifier; other kinds and options are rejected", async () => {
  reply = () => "authorized";
  expect((await permissions.getPermissionStatus("automation", { target: "com.apple.finder" })).granted).toBe(true);
  expect(calls[0]).toEqual({ method: "status", args: { kind: "automation", target: "com.apple.finder" } });
  await expect(permissions.requestPermission("automation")).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(permissions.requestPermission("automation", { target: "not a bundle id" })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(permissions.getPermissionStatus("camera", { target: "com.apple.finder" })).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(permissions.getPermissionStatus("camera", { prompt: true } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(permissions.getPermissionStatus("camera", { target: undefined, extra: undefined } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(permissions.getPermissionStatus("camera", null as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(calls).toHaveLength(1);
});

test("native errors keep their Spark codes", async () => {
  call = () => Promise.reject(Object.assign(new Error("Requesting camera permission needs NSCameraUsageDescription in the app's Info.plist"), { code: "E_UNAVAILABLE" }));
  await expect(permissions.requestPermission("camera")).rejects.toMatchObject({ code: "E_UNAVAILABLE", message: expect.stringContaining("NSCameraUsageDescription") });
  call = () => Promise.reject(Object.assign(new Error("com.apple.finder is not running"), { code: "E_NOT_FOUND" }));
  await expect(permissions.getPermissionStatus("automation", { target: "com.apple.finder" })).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  call = () => Promise.reject(new Error("boom"));
  await expect(permissions.openPermissionSettings("camera")).rejects.toMatchObject({ code: "E_NATIVE" });
});

test("openPermissionSettings sends the kind and resolves void", async () => {
  await expect(permissions.openPermissionSettings("inputMonitoring")).resolves.toBeUndefined();
  expect(calls).toEqual([{ method: "openSettings", args: { kind: "inputMonitoring" } }]);
  await expect(permissions.openPermissionSettings("wifi" as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
});

test("a listener gets one event per changed kind it asked for, in sequence, and removal stops observation once", async () => {
  reply = method => method === "observe" ? { sequence: 4, permissions: ALL } : null;
  const events: unknown[] = [];
  const registration = await permissions.addPermissionListener(event => events.push(event), { kinds: ["camera", "location"] });
  expect(calls.map(entry => entry.method)).toEqual(["observe"]);
  emit({ type: "permissionsChanged", sequence: 4, permissions: { ...ALL, camera: "authorized" } }); // Already in the snapshot.
  emit({ type: "permissionsChanged", sequence: 5, permissions: { ...ALL, camera: "authorized", microphone: "denied" } });
  emit({ type: "permissionsChanged", sequence: 6, permissions: { ...ALL, camera: "authorized", microphone: "denied", location: "denied" } });
  emit({ type: "permissionsChanged", sequence: 5, permissions: ALL }); // Stale.
  emit({ type: "unrelated", sequence: 7, permissions: ALL });
  expect(events).toEqual([
    { kind: "camera", permission: { kind: "camera", status: "granted", granted: true, canAskAgain: false, macos: { authorization: "authorized" } }, previous: { kind: "camera", status: "undetermined", granted: false, canAskAgain: true, macos: { authorization: "notDetermined" } } },
    { kind: "location", permission: { kind: "location", status: "denied", granted: false, canAskAgain: false, macos: { authorization: "denied" } }, previous: { kind: "location", status: "undetermined", granted: false, canAskAgain: true, macos: { authorization: "notDetermined" } } },
  ]);
  await Promise.all([registration.remove(), registration.remove()]);
  emit({ type: "permissionsChanged", sequence: 8, permissions: { ...ALL, camera: "denied" } });
  expect(events).toHaveLength(2);
  expect(calls.map(entry => entry.method)).toEqual(["observe", "unobserve"]);
});

test("events before the snapshot are replayed after it; malformed events and throwing listeners go to onError", async () => {
  let resolveObserve!: (value: string) => void;
  call = (method, args) => { calls.push({ method, args: JSON.parse(args) }); return method === "observe" ? new Promise(resolve => { resolveObserve = resolve; }) : Promise.resolve("null"); };
  const events: string[] = [], errors: string[] = [];
  const pending = permissions.addPermissionListener(event => { events.push(`${event.kind}:${event.permission.status}`); if (event.kind === "photos") throw new Error("listener failed"); }, { onError: error => errors.push(error.code) });
  emit({ type: "permissionsChanged", sequence: 2, permissions: { ...ALL, contacts: "denied" } });
  resolveObserve(JSON.stringify({ sequence: 1, permissions: ALL }));
  const registration = await pending;
  expect(events).toEqual(["contacts:denied"]);
  emit({ type: "permissionsChanged", sequence: 3, permissions: { ...ALL, camera: "bogus" } });
  emit({ type: "permissionsChanged", sequence: 4, permissions: { ...ALL, contacts: "denied", photos: "authorized" } });
  expect(events).toEqual(["contacts:denied", "photos:granted"]);
  expect(errors).toEqual(["E_INVALID_DATA", "E_NATIVE"]);
  await registration.remove();
});

test("a malformed snapshot releases native observation and rejects; bad listener arguments reject before native", async () => {
  reply = method => method === "observe" ? { sequence: 1, permissions: { camera: "authorized" } } : null;
  await expect(permissions.addPermissionListener(() => {})).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  expect(calls.map(entry => entry.method)).toEqual(["observe", "unobserve"]);
  calls.length = 0;
  await expect(permissions.addPermissionListener(() => {}, { kinds: ["automation" as never] })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(permissions.addPermissionListener(() => {}, { kinds: [] })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(permissions.addPermissionListener(() => {}, { interval: 5 } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(permissions.addPermissionListener("nope" as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(calls).toEqual([]);
});

test("without the native module, availability reports missing-module and calls reject E_MODULE_UNAVAILABLE", async () => {
  vi.resetModules();
  vi.doMock("react-native", () => ({ Platform: platform, TurboModuleRegistry: { get: () => null }, NativeEventEmitter }));
  const missing = await import("../packages/permissions/src/index.ts");
  expect(missing.getPermissionAvailability()).toEqual({ available: false, reason: "missing-module" });
  await expect(missing.requestPermission("location")).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
});
