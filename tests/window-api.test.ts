import { beforeEach, afterEach, expect, test, vi } from "vitest";
const { call, platform, listeners, managed } = vi.hoisted(() => ({ call: vi.fn(), platform: { OS: "windows" }, listeners: new Set<(event: any) => void>(), managed: { openWindow: vi.fn(async (_options: string) => '{"success":true}'), setWindowOptions: vi.fn(async () => '{"success":true}') } }));
vi.mock("react-native", () => ({ Platform: platform }));
vi.mock("../packages/desktop-windows/src/NativeDesktopWindowManager", () => ({ default: { call } }));
vi.mock("../packages/desktop-windows/src/window-manager/NativeWindowManager", () => ({ default: managed }));
vi.mock("@legendapp/spark-desktop-app/src/events", () => ({ onDesktopEvent: (fn: (event: any) => void) => { listeners.add(fn); return { remove: () => listeners.delete(fn) }; } }));
import * as windows from "../packages/desktop-windows/src/api";
const info = { id: "editor", instanceId: "instance-1", kind: "window", title: "Editor", parentId: null, modal: false, visible: true, focused: true, minimized: false, fullscreen: false, bounds: { displayId: "display", x: 10, y: 20, width: 640, height: 480 } };
const emit = (event: object) => listeners.forEach(listener => listener({ windowId: "editor", instanceId: "instance-1", ...event }));
const tick = async () => { for (let n=0;n<10;n++) await Promise.resolve(); };
beforeEach(() => { platform.OS = "windows"; call.mockReset().mockImplementation(async (method: string) => JSON.stringify(["open", "info", "observe", "completeOpen"].includes(method) ? info : method === "close" ? { closed: true } : null)); managed.openWindow.mockClear(); managed.setWindowOptions.mockClear(); listeners.clear(); });
afterEach(() => vi.restoreAllMocks());
test("availability is answered synchronously without a native call", async () => {
  expect(windows.getWindowAvailability()).toEqual({ available: true });
  platform.OS = "ios";
  expect(windows.getWindowAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
  expect(call).not.toHaveBeenCalled();
});
test("invalid arguments reject asynchronously before native calls", async () => {
  for (const id of ["", "main", "../editor"]) await expect(windows.openWindow({ id, component: "Editor" })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(windows.setWindowBounds("editor", { ...info.bounds, x: NaN })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(windows.showWindow(undefined as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(call).not.toHaveBeenCalled();
});
test("opening snapshots props and exposes only the public info shape", async () => {
  const props = { doc: { id: "notes" } };
  const pending = windows.openWindow({ id: "editor", component: "Editor", props }); props.doc.id = "changed";
  expect(await pending).toEqual(expect.not.objectContaining({ instanceId: expect.anything() }));
  expect(JSON.parse(call.mock.calls[0][1])).toMatchObject({ id: "editor", component: "Editor", props: { doc: { id: "notes" } } });
  call.mockResolvedValueOnce('{"id":"editor"}'); await expect(windows.getWindow("editor")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});
test("overlay defaults are explicit and unsupported macOS options reject", async () => {
  await windows.openWindow({ id: "overlay", component: "Overlay", kind: "overlay" });
  expect(JSON.parse(call.mock.calls[0][1])).toMatchObject({ kind: "overlay", transparent: true, titleBarStyle: "borderless", resizable: false });
  await expect(windows.setWindowOptions("editor", { macos: { level: "floating" } })).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
});
test("close calls join and wait for the actual veto or closed response", async () => {
  let finish!: (value: string) => void; call.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
  const first = windows.closeWindow("editor"), second = windows.closeWindow("editor");
  expect(call).toHaveBeenCalledTimes(1); finish('{"closed":false,"reason":"vetoed"}');
  expect(await first).toEqual({ closed: false, reason: "vetoed" }); expect(await second).toEqual(await first);
  expect(await windows.closeWindow("editor")).toEqual({ closed: true });
});
test("listeners bind to a native generation and stop on close or removal", async () => {
  const listener = vi.fn(), onError = vi.fn();
  const sub = await windows.addWindowListener("editor", "focusChanged", listener, { onError });
  emit({ type: "focusChanged", focused: true }); expect(listener).toHaveBeenCalledExactlyOnceWith({ windowId: "editor", focused: true });
  emit({ type: "focusChanged", focused: "yes" }); expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_INVALID_DATA" }));
  emit({ type: "closed" }); emit({ type: "focusChanged", instanceId: "instance-2", focused: true }); expect(listener).toHaveBeenCalledTimes(1); expect(listeners.size).toBe(0);
  await sub.remove(); await sub.remove();
});
test("guard decisions ignore stale requests and failed removal can retry", async () => {
  const answers: ((allow: boolean) => void)[] = [], onError = vi.fn();
  const guard = await windows.beforeWindowClose("editor", () => new Promise<boolean>(resolve => answers.push(resolve)), { onError });
  const registration = JSON.parse(call.mock.calls.find(([method]) => method === "closeGuard")![1]);
  const event = { type: "beforeClose", guardId: registration.guardId };
  emit({ ...event, requestId: 1 }); emit({ ...event, requestId: 1 }); await tick(); expect(answers).toHaveLength(1);
  emit({ ...event, requestId: 2 }); await tick(); answers[0](true); await tick(); expect(call.mock.calls.filter(([method]) => method === "replyClose")).toHaveLength(0);
  answers[1](false); await tick(); expect(JSON.parse(call.mock.calls.find(([method]) => method === "replyClose")![1])).toMatchObject({ requestId: 2, allow: false, instanceId: "instance-1" });
  call.mockRejectedValueOnce(new Error("cleanup")); await expect(guard.remove()).rejects.toMatchObject({ code: "E_NATIVE" }); expect(listeners.size).toBe(0);
  await guard.remove(); const replacement = await windows.beforeWindowClose("editor", () => true); await replacement.remove();
});
test("macOS precreates hidden registered roots and closes a failed opening", async () => {
  platform.OS = "macos";
  await windows.openWindow({ id: "editor", component: "Editor", props: { id: "note" } });
  expect(JSON.parse(managed.openWindow.mock.calls[0][0])).toMatchObject({ identifier: "editor", moduleName: "Editor", initialProperties: { id: "note" }, deferOrderFront: true });
  call.mockRejectedValueOnce(Object.assign(new Error("display removed"), { code: "E_NOT_FOUND" }));
  await expect(windows.openWindow({ id: "editor", component: "Editor" })).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  expect(call.mock.calls.at(-1)?.[0]).toBe("discard");
});
test("completed and timed-out requests cannot run the guard again", async () => {
  const handler = vi.fn(() => true), onError = vi.fn();
  const guard = await windows.beforeWindowClose("editor", handler, { onError });
  const { guardId } = JSON.parse(call.mock.calls.find(([method]) => method === "closeGuard")![1]);
  emit({ type: "beforeClose", guardId, requestId: 1 }); await tick();
  emit({ type: "beforeClose", guardId, requestId: 1 }); await tick(); expect(handler).toHaveBeenCalledTimes(1);
  emit({ type: "closeGuardTimeout", guardId }); expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_TIMEOUT" }));
  emit({ type: "closed" });
  const replacement = await windows.beforeWindowClose("editor", () => true); await replacement.remove(); await guard.remove();
});
test("macOS toolbar events carry finite numeric slider values and strip native fields", async () => {
  platform.OS = "macos"; const { addMacOSWindowListener } = await import("../packages/desktop-windows/src/macos");
  const listener = vi.fn(), onError = vi.fn(); const registration = await addMacOSWindowListener("editor", listener, { onError });
  emit({ type: "toolbarMenuAction", itemId: "menu", action: { type: "valueChanged", itemId: "volume", value: 0.375 }, nativePrivate: true });
  expect(listener).toHaveBeenCalledExactlyOnceWith({ type: "toolbarMenuAction", windowId: "editor", itemId: "menu", action: { type: "valueChanged", itemId: "volume", value: 0.375 } });
  emit({ type: "toolbarMenuAction", itemId: "menu", action: { type: "valueChanged", itemId: "volume", value: "0.5" } });
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_INVALID_DATA" })); await registration.remove();
});
