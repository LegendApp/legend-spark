import { beforeEach, expect, test, vi } from "vitest";
// @legendapp/spark/capture against a mocked bridge: validation, wire shapes, session lifecycles, levels, and the
// permission checks that keep capture from prompting.
const calls: { method: string; args: any }[] = [];
let reply: (method: string, args: any) => unknown = () => null;
let permissions: Record<string, string> = {};
const platform = { OS: "macos" };
const media = { call: (method: string, args: string) => { calls.push({ method, args: JSON.parse(args) }); return Promise.resolve(reply(method, JSON.parse(args))).then(value => JSON.stringify(value)); } };
const permissionModule = { call: (method: string, args: string) => { calls.push({ method: `permission.${method}`, args: JSON.parse(args) }); return Promise.resolve(JSON.stringify(permissions[JSON.parse(args).kind])); } };
const app = { call: () => Promise.resolve("null"), addListener() {}, removeListeners() {} };
const listeners: ((event: unknown) => void)[] = [];
class NativeEventEmitter { addListener(_name: string, listener: (event: unknown) => void) { listeners.push(listener); return { remove() { listeners.splice(listeners.indexOf(listener), 1); } }; } }
vi.doMock("react-native", () => ({ Platform: platform, TurboModuleRegistry: { get: (name: string) => ({ NativeDesktopMedia: media, NativeDesktopPermissions: permissionModule })[name] ?? app }, NativeEventEmitter }));
vi.doMock("react-native/Libraries/Utilities/codegenNativeComponent", () => ({ default: (name: string) => name }));
const capture = await import("../packages/media/src/capture.tsx");
const emit = (event: object) => [...listeners].forEach(listener => listener(event));
const methods = () => calls.map(entry => entry.method);
/** Sessions: the call settles when the session ends; "started" arrives first. */
function sessions() {
  const ends = new Map<string, (value: unknown) => void>();
  reply = (method, args) => {
    if (["captureRecordAudio", "captureCamera", "captureRecordScreen"].includes(method)) {
      setTimeout(() => emit({ type: "capture", id: args.id, event: "started" }), 1);
      return new Promise(resolve => ends.set(args.id, resolve));
    }
    if (method === "captureStop") ends.get(args.id)!(calls.find(entry => entry.args.id === args.id)!.method === "captureCamera" ? null : { status: "recorded", uri: "/tmp/a.m4a", duration: 1.5, size: 2048 });
    if (method === "captureCancel") ends.get(args.id)!({ status: "cancelled" });
    if (method === "capturePhoto") return { uri: "/tmp/p.jpg", width: 1280, height: 720 };
    if (method === "captureCameraStatus") return { width: 1280, height: 720 };
    return null;
  };
  return ends;
}
beforeEach(() => {
  platform.OS = "macos"; reply = () => null; calls.length = 0;
  permissions = { microphone: "authorized", camera: "authorized", screenRecording: "authorized" };
});

test("availability reports macOS and other platforms; unsupported and invalid calls reject before native work", async () => {
  platform.OS = "windows";
  for (const kind of ["camera", "microphone", "screen"] as const) expect(await capture.getCaptureAvailability(kind)).toEqual({ available: false, reason: "unsupported-platform" });
  expect(await capture.getScreenRecordingAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
  await expect(capture.getCaptureDevices("camera")).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(capture.startAudioRecording()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(capture.startCamera()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(capture.getScreenCaptureSources()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(capture.captureScreenshot()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(capture.startScreenRecording()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  expect(() => capture.CameraView({ session: null })).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_PLATFORM" }));
  platform.OS = "macos";
  await expect(capture.getCaptureAvailability("speaker" as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(capture.getCaptureDevices("speaker" as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(capture.startAudioRecording({ deviceId: "" })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(capture.startAudioRecording({ onLevel: 1 as never })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(capture.startAudioRecording({ format: "wav" } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(capture.startCamera({ resolution: "4k" } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(capture.captureScreenshot({ display: 1, window: 2 })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(capture.captureScreenshot({ display: -1 })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(capture.startScreenRecording({ showsCursor: "yes" as never })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(() => capture.CameraView({ session: null, contentFit: "stretch" as never })).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  expect(calls).toEqual([]);
});

test("nothing reaches a device without its permission, and nothing asks for one", async () => {
  permissions = { microphone: "notDetermined", camera: "denied", screenRecording: "notGranted" };
  await expect(capture.startAudioRecording()).rejects.toMatchObject({ code: "E_PERMISSION_DENIED", message: expect.stringContaining("microphone") });
  await expect(capture.startCamera()).rejects.toMatchObject({ code: "E_PERMISSION_DENIED", message: expect.stringContaining("camera") });
  await expect(capture.getScreenCaptureSources()).rejects.toMatchObject({ code: "E_PERMISSION_DENIED", message: expect.stringContaining("screenRecording") });
  await expect(capture.captureScreenshot()).rejects.toMatchObject({ code: "E_PERMISSION_DENIED" });
  await expect(capture.startScreenRecording()).rejects.toMatchObject({ code: "E_PERMISSION_DENIED" });
  expect(methods()).toEqual(Array(5).fill("permission.status"));
});

test("devices, screen recording availability, sources and screenshots are validated", async () => {
  const camera = { id: "cam-1", name: "FaceTime HD Camera", kind: "camera", default: true };
  const sources = { displays: [{ id: 1, width: 1440, height: 900 }], windows: [{ id: 2, title: null, app: "Finder", width: 800, height: 600 }] };
  reply = method => ({ captureDevices: [camera], captureAvailability: { camera: "missing-entitlement", microphone: "available", screenRecording: false }, captureScreenSources: sources, captureScreenshot: { uri: "/tmp/s.png", width: 2880, height: 1800 } })[method];
  expect(await capture.getCaptureDevices("camera")).toEqual([camera]);
  expect(calls.at(-1)).toEqual({ method: "captureDevices", args: { kind: "camera" } });
  expect(await capture.getScreenRecordingAvailability()).toEqual({ available: false, reason: "host-restriction" });
  expect(await capture.getCaptureAvailability("camera")).toEqual({ available: false, reason: "missing-entitlement" });
  expect(await capture.getCaptureAvailability("microphone")).toEqual({ available: true });
  expect(await capture.getCaptureAvailability("screen")).toEqual({ available: true });
  expect(await capture.getScreenCaptureSources()).toEqual(sources);
  expect(await capture.captureScreenshot({ window: 2, showsCursor: false, uri: "/tmp/s.png" })).toEqual({ uri: "/tmp/s.png", width: 2880, height: 1800 });
  expect(calls.at(-1)).toEqual({ method: "captureScreenshot", args: { options: { window: 2, showsCursor: false, uri: "/tmp/s.png" } } });
  reply = () => [{ ...camera, kind: "speaker" }];
  await expect(capture.getCaptureDevices("camera")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  reply = () => Promise.reject(Object.assign(new Error("No window has the id 9"), { code: "E_NOT_FOUND" }));
  await expect(capture.captureScreenshot({ window: 9 })).rejects.toMatchObject({ code: "E_NOT_FOUND" });
});

test("an audio recording resolves once it runs, reports its own levels, and stops with the file", async () => {
  sessions();
  const levels: number[] = [];
  const recording = await capture.startAudioRecording({ deviceId: "mic-1", uri: "/tmp/a.m4a", onLevel: level => levels.push(level.average) });
  const start = calls.find(entry => entry.method === "captureRecordAudio")!;
  expect(start.args).toEqual({ id: recording.id, options: { deviceId: "mic-1", uri: "/tmp/a.m4a", levels: true } });
  emit({ type: "capture", id: recording.id, event: "level", average: -30, peak: -24 });
  emit({ type: "capture", id: "capture-other", event: "level", average: -10, peak: -4 });
  emit({ type: "capture", id: recording.id, event: "level", average: "loud", peak: -4 });
  expect(levels).toEqual([-30]);
  const outcome = await recording.stop();
  expect(outcome).toEqual({ status: "recorded", uri: "/tmp/a.m4a", duration: 1.5, size: 2048 });
  expect(await recording.result).toBe(outcome);
  emit({ type: "capture", id: recording.id, event: "level", average: -20, peak: -14 });
  expect(levels).toEqual([-30]);
  const quiet = await capture.startAudioRecording();
  expect(calls.at(-1)!.args.options).toEqual({ levels: false });
  await quiet.cancel();
  expect(await quiet.result).toEqual({ status: "cancelled" });
});

test("abort cancels a recording; a device that goes away rejects the result; a failure before running rejects the start", async () => {
  const ends = sessions();
  const controller = new AbortController();
  const recording = await capture.startScreenRecording({ display: 1, signal: controller.signal });
  expect(calls.find(entry => entry.method === "captureRecordScreen")!.args.options).toEqual({ display: 1 });
  controller.abort();
  expect(await recording.result).toEqual({ status: "cancelled" });
  const unplugged = await capture.startAudioRecording();
  ends.get(unplugged.id)!(Promise.reject(Object.assign(new Error("The simulated microphone was disconnected"), { code: "E_UNAVAILABLE" })));
  await expect(unplugged.result).rejects.toMatchObject({ code: "E_UNAVAILABLE" });
  await expect(capture.startAudioRecording({ signal: AbortSignal.abort() })).rejects.toMatchObject({ code: "E_ABORTED" });
  reply = method => method === "captureRecordAudio" ? Promise.reject(Object.assign(new Error("Another audio capture is running"), { code: "E_BUSY" })) : null;
  await expect(capture.startAudioRecording()).rejects.toMatchObject({ code: "E_BUSY" });
  reply = method => method === "captureRecordAudio" ? { status: "recording" } : null;
  await expect(capture.startAudioRecording()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});

test("a camera takes photos, reports its size, and ends once stopped or disconnected", async () => {
  const ends = sessions();
  const camera = await capture.startCamera({ deviceId: "cam-1" });
  expect(calls.find(entry => entry.method === "captureCamera")!.args).toEqual({ id: camera.id, options: { deviceId: "cam-1" } });
  expect(await camera.getStatus()).toEqual({ width: 1280, height: 720 });
  expect(await camera.takePhoto({ uri: "/tmp/p.jpg" })).toEqual({ uri: "/tmp/p.jpg", width: 1280, height: 720 });
  expect(calls.at(-1)).toEqual({ method: "capturePhoto", args: { id: camera.id, options: { uri: "/tmp/p.jpg" } } });
  await expect(camera.takePhoto({ format: "heic" } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await camera.stop();
  await expect(camera.ended).resolves.toBeUndefined();
  const element = capture.CameraView({ session: camera, contentFit: "cover" }) as unknown as { props: Record<string, unknown> };
  expect(element.props).toEqual({ sessionId: camera.id, contentFit: "cover" });
  const unplugged = await capture.startCamera();
  ends.get(unplugged.id)!(Promise.reject(Object.assign(new Error("The simulated camera was disconnected"), { code: "E_UNAVAILABLE" })));
  await expect(unplugged.ended).rejects.toMatchObject({ code: "E_UNAVAILABLE" });
});
