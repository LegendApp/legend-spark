import { beforeEach, afterEach, expect, test, vi } from "vitest";
const { call, platform, listeners, managed } = vi.hoisted(() => ({ call: vi.fn(), platform: { OS: "windows" }, listeners: new Set<(event: any) => void>(), managed: { getConstantsJson: () => JSON.stringify({ WINDOW_LEVEL_STATUS: 25, WINDOW_LEVEL_FLOATING: 3 }), openWindow: vi.fn(async (_options: string) => '{"success":true}'), setWindowOptions: vi.fn(async (_id: string, _options: string) => '{"success":true}') } }));
vi.mock("react-native", () => ({ Platform: platform }));
vi.mock("../packages/desktop-windows/src/NativeDesktopWindowManager", () => ({ default: { call } }));
vi.mock("../packages/desktop-windows/src/window-manager/NativeWindowManager", () => ({ default: managed }));
vi.mock("@legendapp/spark-desktop-app/src/events", () => ({ onDesktopEvent: (fn: (event: any) => void) => { listeners.add(fn); return { remove: () => listeners.delete(fn) }; } }));
import * as windows from "../packages/desktop-windows/src/api";
const info = { id: "editor", instanceId: "instance-1", kind: "window", title: "Editor", parentId: null, modal: false, visible: true, focused: true, minimized: false, maximized: false, fullscreen: false, bounds: { displayId: "display", x: 10, y: 20, width: 640, height: 480 } };
const emit = (event: object) => listeners.forEach(listener => listener({ windowId: "editor", instanceId: "instance-1", ...event }));
const tick = async () => { for (let n=0;n<10;n++) await Promise.resolve(); };
beforeEach(() => { platform.OS = "windows"; call.mockReset().mockImplementation(async (method: string) => JSON.stringify(["open", "info", "observe", "completeOpen"].includes(method) ? info : method === "close" ? { closed: true } : null)); managed.openWindow.mockClear(); managed.setWindowOptions.mockClear(); listeners.clear(); });
afterEach(() => { emit({ type: "closed" }); vi.restoreAllMocks(); });
test("availability is answered synchronously without a native call", async () => {
  expect(windows.getWindowAvailability()).toEqual({ available: true });
  platform.OS = "ios";
  expect(windows.getWindowAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
  expect(call).not.toHaveBeenCalled();
});
test("cursor point resolves display-relative coordinates and validates the reply", async () => {
  call.mockImplementation(async (method: string) => JSON.stringify(method === "cursorPoint" ? { displayId: "display", x: 12, y: 34 } : null));
  expect(await windows.getCursorPoint()).toEqual({ displayId: "display", x: 12, y: 34 });
  call.mockImplementation(async (method: string) => JSON.stringify(method === "cursorPoint" ? { displayId: "display", x: "12", y: 34 } : null));
  await expect(windows.getCursorPoint()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});
test("window info exposes and validates maximized state", async () => {
  expect(await windows.getWindow("editor")).toMatchObject({ maximized: false });
  call.mockImplementation(async () => JSON.stringify({ ...info, maximized: true }));
  expect((await windows.getWindow("editor")).maximized).toBe(true);
  call.mockImplementation(async () => JSON.stringify({ ...info, maximized: "yes" }));
  await expect(windows.getWindow("editor")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});
test("invalid arguments reject asynchronously before native calls", async () => {
  for (const id of ["", "main", "../editor"]) await expect(windows.openWindow({ id, component: "Editor" })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(windows.setWindowBounds("editor", { ...info.bounds, x: NaN })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(windows.setWindowBounds("editor", { ...info.bounds }, { durationMs: 200 } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(windows.showWindow(undefined as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(call).not.toHaveBeenCalled();
});
test("bounds animation options are macOS-only and reach the native command", async () => {
  platform.OS = "macos";
  await windows.setWindowBounds("editor", info.bounds, { macos: { durationMs: 250 } });
  expect(JSON.parse(call.mock.calls.at(-1)![1])).toMatchObject({ durationMs: 250 });
  await windows.setWindowBounds("editor", info.bounds);
  expect(JSON.parse(call.mock.calls.at(-1)![1])).not.toHaveProperty("durationMs");
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
test("macOS overlays use status level unless a level or always-on-top choice is supplied", async () => {
  platform.OS = "macos";
  await windows.openWindow({ id: "overlay", component: "Overlay", kind: "overlay" });
  expect(JSON.parse(managed.setWindowOptions.mock.calls.at(-1)![1])).toMatchObject({ level: 25 });
  expect(JSON.parse(call.mock.calls.find(([method]) => method === "completeOpen")![1])).not.toHaveProperty("alwaysOnTop");
  await windows.openWindow({ id: "custom", component: "Overlay", kind: "overlay", macos: { level: "floating" } });
  expect(JSON.parse(managed.setWindowOptions.mock.calls.at(-1)![1])).toMatchObject({ level: 3 });
  managed.setWindowOptions.mockClear();
  await windows.openWindow({ id: "normal", component: "Overlay", kind: "overlay", alwaysOnTop: false });
  expect(managed.setWindowOptions).not.toHaveBeenCalled();
  expect(JSON.parse(call.mock.calls.at(-1)![1])).toMatchObject({ alwaysOnTop: false });
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
  call.mockRejectedValueOnce(new Error("cleanup")); await expect(guard.remove()).rejects.toMatchObject({ code: "E_NATIVE" }); expect(listeners.size).toBe(1);
  await guard.remove(); const replacement = await windows.beforeWindowClose("editor", () => true); await replacement.remove();
});
test("close guard replacement waits for teardown and stays protected throughout the swap", async () => {
  const previous = vi.fn(() => true), next = vi.fn(() => false);
  let protectedWindow = false, finishRemoval!: () => void, deferRemoval = false;
  call.mockImplementation(async (method: string, json: string) => {
    if (method === "observe") return JSON.stringify(info);
    if (method === "closeGuard") {
      const { enabled } = JSON.parse(json);
      if (deferRemoval) {
        deferRemoval = false;
        await new Promise<void>(resolve => { finishRemoval = () => { protectedWindow = enabled; resolve(); }; });
      } else protectedWindow = enabled;
    }
    return "null";
  });
  const guard = await windows.beforeWindowClose("editor", previous);
  const { guardId } = JSON.parse(call.mock.calls.find(([method]) => method === "closeGuard")![1]);
  deferRemoval = true;
  const removal = guard.remove();
  await tick();
  let replacementReady = false;
  const replacement = windows.beforeWindowClose("editor", next).then(value => { replacementReady = true; return value; });
  // Attach immediately so a regression rejecting E_BUSY is reported by the assertion below.
  void replacement.catch(() => {});
  await tick();
  expect(replacementReady).toBe(false);
  expect(protectedWindow).toBe(true);
  emit({ type: "beforeClose", guardId, requestId: 1 }); await tick();
  expect(previous).not.toHaveBeenCalled();
  expect(call.mock.calls.filter(([method]) => method === "replyClose").map(([, json]) => JSON.parse(json))).toContainEqual(expect.objectContaining({ requestId: 1, allow: false }));
  finishRemoval();
  // Native protection must still be present before JavaScript sees the acknowledgement.
  expect(protectedWindow).toBe(true);
  await removal;
  const current = await replacement;
  emit({ type: "beforeClose", guardId, requestId: 2 }); await tick();
  expect(next).toHaveBeenCalledOnce();
  expect(JSON.parse(call.mock.calls.filter(([method]) => method === "replyClose").at(-1)![1])).toMatchObject({ requestId: 2, allow: false });
  await guard.remove();
  emit({ type: "beforeClose", guardId, requestId: 3 }); await tick();
  expect(next).toHaveBeenCalledTimes(2);
  await current.remove();
  emit({ type: "beforeClose", guardId, requestId: 4 }); await tick();
  expect(next).toHaveBeenCalledTimes(2);
  expect(JSON.parse(call.mock.calls.filter(([method]) => method === "replyClose").at(-1)![1])).toMatchObject({ requestId: 4, allow: true });
  emit({ type: "closed" }); expect(listeners.size).toBe(0);
});
test("only one replacement can wait on close-guard removal, and failed teardown can retry", async () => {
  const guard = await windows.beforeWindowClose("editor", () => true);
  let failRemoval!: (error: Error) => void;
  call.mockImplementationOnce(() => new Promise<string>((_resolve, reject) => { failRemoval = reject; }));
  const removal = guard.remove(); await tick();
  const replacement = windows.beforeWindowClose("editor", () => false);
  await expect(windows.beforeWindowClose("editor", () => true)).rejects.toMatchObject({ code: "E_BUSY" });
  const outcomes = Promise.allSettled([removal, replacement]);
  failRemoval(new Error("cleanup"));
  expect(await outcomes).toEqual([
    { status: "rejected", reason: expect.objectContaining({ code: "E_NATIVE" }) },
    { status: "rejected", reason: expect.objectContaining({ code: "E_NATIVE" }) },
  ]);
  const current = await windows.beforeWindowClose("editor", () => false);
  await expect(windows.beforeWindowClose("editor", () => true)).rejects.toMatchObject({ code: "E_BUSY" });
  await guard.remove(); await current.remove();
});
test("a removed owner's late decision cannot allow closing under its replacement", async () => {
  let answer!: (allow: boolean) => void;
  const guard = await windows.beforeWindowClose("editor", () => new Promise<boolean>(resolve => { answer = resolve; }));
  const { guardId } = JSON.parse(call.mock.calls.find(([method]) => method === "closeGuard")![1]);
  emit({ type: "beforeClose", guardId, requestId: 1 }); await tick();
  const removal = guard.remove();
  const handler = vi.fn(() => false), current = await windows.beforeWindowClose("editor", handler);
  await removal;
  answer(true); await tick();
  expect(call.mock.calls.filter(([method]) => method === "replyClose")).toHaveLength(0);
  emit({ type: "beforeClose", guardId, requestId: 2 }); await tick();
  expect(handler).toHaveBeenCalledOnce();
  expect(JSON.parse(call.mock.calls.filter(([method]) => method === "replyClose").at(-1)![1])).toMatchObject({ requestId: 2, allow: false });
  await current.remove();
});
test("acquiring a guard vetoes an automatic close decision already queued without an owner", async () => {
  const guard = await windows.beforeWindowClose("editor", () => true);
  const { guardId } = JSON.parse(call.mock.calls.find(([method]) => method === "closeGuard")![1]);
  await guard.remove();
  emit({ type: "beforeClose", guardId, requestId: 1 });
  const handler = vi.fn(() => false), current = await windows.beforeWindowClose("editor", handler);
  await tick();
  expect(JSON.parse(call.mock.calls.filter(([method]) => method === "replyClose").at(-1)![1])).toMatchObject({ requestId: 1, allow: false });
  emit({ type: "beforeClose", guardId, requestId: 2 }); await tick();
  expect(handler).toHaveBeenCalledOnce();
  await current.remove();
});
test("macOS precreates hidden registered roots and closes a failed opening", async () => {
  platform.OS = "macos";
  await windows.openWindow({ id: "editor", component: "Editor", props: { id: "note" } });
  expect(JSON.parse(managed.openWindow.mock.calls[0][0])).toMatchObject({ identifier: "editor", moduleName: "Editor", initialProperties: { id: "note" }, deferOrderFront: true });
  call.mockRejectedValueOnce(Object.assign(new Error("display removed"), { code: "E_NOT_FOUND" }));
  await expect(windows.openWindow({ id: "editor", component: "Editor" })).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  expect(call.mock.calls.at(-1)?.[0]).toBe("discard");
});
test("macOS native chrome receives common appearance and background on creation and sparse updates", async () => {
  platform.OS = "macos";
  await windows.openWindow({ id: "editor", component: "Editor", appearance: "light", backgroundColor: "#f5f6f8", macos: { titleBar: { transparent: true, contentLayout: "fullSize" } } });
  const style = { appearance: "light", backgroundColor: "#f5f6f8", titlebarAppearsTransparent: true, contentLayoutMode: "fullSize" };
  expect(JSON.parse(managed.openWindow.mock.calls[0][0]).windowStyle).toEqual(style);
  expect(JSON.parse(managed.setWindowOptions.mock.calls[0][1]).windowStyle).toEqual(style);
  await windows.setWindowOptions("editor", { appearance: "dark", backgroundColor: "#191A1B" });
  expect(JSON.parse(managed.setWindowOptions.mock.calls.at(-1)![1]).windowStyle).toEqual({ appearance: "dark", backgroundColor: "#191A1B" });
  await windows.setWindowOptions("editor", { appearance: "system" });
  expect(JSON.parse(managed.setWindowOptions.mock.calls.at(-1)![1]).windowStyle).toEqual({ appearance: "system" });
  await windows.setWindowOptions("editor", { backgroundColor: "#f5f6f8" });
  expect(JSON.parse(managed.setWindowOptions.mock.calls.at(-1)![1]).windowStyle).toEqual({ backgroundColor: "#f5f6f8" });
  await windows.setWindowOptions("editor", { macos: { titleBar: { contentLayout: "contentLayoutGuide" } } });
  expect(JSON.parse(managed.setWindowOptions.mock.calls.at(-1)![1]).windowStyle).toEqual({ contentLayoutMode: "contentLayoutGuide" });
  await windows.openWindow({ id: "plain", component: "Editor", appearance: "light", backgroundColor: "#f5f6f8" });
  expect(JSON.parse(managed.openWindow.mock.calls.at(-1)![0]).windowStyle).toEqual({ appearance: "light", backgroundColor: "#f5f6f8" });
  expect(JSON.parse(managed.setWindowOptions.mock.calls.at(-1)![1]).windowStyle).toEqual({ appearance: "light", backgroundColor: "#f5f6f8" });
});
test("a transient macOS read-back failure after chrome is applied keeps the opened window", async () => {
  platform.OS = "macos";
  call.mockImplementation(async (method: string) => {
    if (method === "info") throw Object.assign(new Error("display removed"), { code: "E_NOT_FOUND" });
    return JSON.stringify(["completeOpen"].includes(method) ? info : null);
  });
  const opened = await windows.openWindow({ id: "editor", component: "Editor", macos: { restoreOnLaunch: true } });
  expect(opened).toEqual(expect.objectContaining({ id: "editor", title: "Editor" }));
  expect(call.mock.calls.map(([method]) => method)).not.toContain("discard");
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

test("macOS toolbar-only updates bypass portable window geometry", async () => {
  platform.OS = "macos";
  await windows.setWindowOptions("editor", { macos: { toolbar: { items: [{ type: "menu", id: "appearance", items: [{ type: "slider", id: "brightness", label: "Brightness", min: 0, max: 100, value: 80 }] }] } } });
  expect(call).not.toHaveBeenCalled();
  expect(managed.setWindowOptions).toHaveBeenCalledOnce();
  const item = JSON.parse(managed.setWindowOptions.mock.calls[0][1]).windowStyle.toolbarItems[0];
  expect(item.menuItems[0].slider.value).toBe(80);
  expect(item).not.toHaveProperty("items");
  await windows.setWindowOptions("editor", { title: "Renamed", macos: { toolbar: { visible: true } } });
  expect(call).toHaveBeenCalledWith("options", expect.any(String));
  await windows.setWindowOptions("editor", {});
  expect(call).toHaveBeenCalledTimes(2);
});
