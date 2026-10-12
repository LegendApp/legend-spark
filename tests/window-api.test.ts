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
afterEach(() => vi.restoreAllMocks());
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
  // Window pools close a pooled window for real when its options changed during a use; other windows are not tracked.
  expect(windows.pooledWindows.has("editor")).toBe(false);
  windows.pooledWindows.set("editor", false);
  await windows.setWindowOptions("editor", { title: "Changed" });
  expect(windows.pooledWindows.get("editor")).toBe(true);
  windows.pooledWindows.delete("editor");
});

test("option availability is truthful per platform and rejects unknown options", () => {
  const options = ["aspectRatio", "opacity", "contentProtection", "ignoreMouseEvents", "tabbing", "spaces", "simpleFullscreen", "documentEdited", "backgroundMaterial", "subtitle", "trafficLightPosition", "fullScreenAuxiliary", "stationary", "ignoresCycle", "cornerSnapping"] as const;
  platform.OS = "macos";
  for (const option of options) expect(windows.getWindowAvailability(option)).toEqual({ available: true });
  platform.OS = "windows";
  expect(windows.getWindowAvailability()).toEqual({ available: true });
  for (const option of options) expect(windows.getWindowAvailability(option)).toEqual({ available: false, reason: "unsupported-platform" });
  platform.OS = "ios";
  expect(windows.getWindowAvailability("opacity")).toEqual({ available: false, reason: "unsupported-platform" });
  expect(() => windows.getWindowAvailability("resizable" as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  expect(call).not.toHaveBeenCalled();
});
test("macOS option updates go only to the module that owns each field", async () => {
  platform.OS = "macos";
  const sent = () => call.mock.calls.filter(([method]) => method === "options").map(([, args]) => JSON.parse(args).options);
  await windows.setWindowOptions("editor", { opacity: 0.5, macos: { documentEdited: true, titleBar: { subtitle: "Draft" } } });
  expect(sent()).toEqual([{ opacity: 0.5, macos: { documentEdited: true, titleBar: { subtitle: "Draft" } } }]);
  expect(managed.setWindowOptions).not.toHaveBeenCalled();
  // Title-bar groups pass through the window module (simple fullscreen guard) before AppKit applies them.
  await windows.setWindowOptions("editor", { macos: { titleBar: { trafficLights: false, trafficLightPosition: { x: 20, y: 18 } } } });
  expect(sent()).toHaveLength(2);
  expect(JSON.parse(managed.setWindowOptions.mock.calls[0][1]).windowStyle).toEqual({ trafficLights: false });
  await windows.setWindowOptions("editor", { macos: { level: "floating" } });
  expect(sent()).toHaveLength(2);
  expect(managed.setWindowOptions).toHaveBeenCalledTimes(2);
});
test("special window options: collection behaviors and corner snapping go to the window module, the HUD panel and desktop level to AppKit", async () => {
  platform.OS = "macos";
  managed.getConstantsJson = () => JSON.stringify({ WINDOW_LEVEL_STATUS: 25, WINDOW_LEVEL_FLOATING: 3, WINDOW_LEVEL_DESKTOP: -2147483622 });
  const sent = () => call.mock.calls.filter(([method]) => method === "options").map(([, args]) => JSON.parse(args).options);
  await windows.setWindowOptions("editor", { macos: { fullScreenAuxiliary: true, stationary: true, ignoresCycle: true, cornerSnapping: { margin: 12 } } });
  expect(sent()).toEqual([{ macos: { fullScreenAuxiliary: true, stationary: true, ignoresCycle: true, cornerSnapping: { margin: 12 } } }]);
  expect(managed.setWindowOptions).not.toHaveBeenCalled();
  await windows.setWindowOptions("editor", { macos: { cornerSnapping: null, level: "desktop" } });
  expect(sent()[1]).toEqual({ macos: { cornerSnapping: null, level: "desktop" } });
  expect(JSON.parse(managed.setWindowOptions.mock.calls[0][1])).toMatchObject({ level: -2147483622 });
  await windows.openWindow({ id: "preview", component: "Preview", macos: { panelStyle: "hud" } });
  expect(JSON.parse(managed.openWindow.mock.calls.at(-1)![0])).toMatchObject({ windowStyle: { panelStyle: "hud" } });
  for (const macos of [{ cornerSnapping: { margin: 501 } }, { cornerSnapping: { margin: 4, corner: "topLeft" } }, { stationary: "yes" }, { level: "wallpaper" }, { panelStyle: "sheet" }]) {
    await expect(windows.openWindow({ id: "bad", component: "Bad", macos } as never)).rejects.toMatchObject({ code: expect.stringMatching(/^E_(INVALID_ARGUMENT|UNSUPPORTED_OPTION)$/) });
  }
  await expect(windows.setWindowOptions("editor", { macos: { panelStyle: "hud" } } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  platform.OS = "windows";
  await expect(windows.setWindowOptions("editor", { macos: { stationary: true } })).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
});
test("macOS opening applies options with the window and enters simple fullscreen last", async () => {
  platform.OS = "macos";
  await windows.openWindow({ id: "editor", component: "Editor", opacity: 0.9, macos: { spaces: "all", titleBar: { subtitle: "Draft" } } });
  expect(JSON.parse(call.mock.calls.find(([method]) => method === "completeOpen")![1])).toMatchObject({ opacity: 0.9, macos: { spaces: "all", titleBar: { subtitle: "Draft" } } });
  expect(managed.setWindowOptions).not.toHaveBeenCalled();
  call.mockClear();
  await windows.openWindow({ id: "editor", component: "Editor", macos: { simpleFullscreen: true, toolbar: { visible: true } } });
  const methods = call.mock.calls.map(([method]) => method);
  expect(methods.slice(0, 2)).toEqual(["completeOpen", "options"]);
  expect(JSON.parse(call.mock.calls[0][1]).macos).toEqual({ toolbar: { visible: true } });
  expect(JSON.parse(call.mock.calls[1][1])).toEqual({ id: "editor", options: { macos: { simpleFullscreen: true } } });
  expect(managed.setWindowOptions).toHaveBeenCalledOnce();
  expect(managed.setWindowOptions.mock.invocationCallOrder[0]).toBeLessThan(call.mock.invocationCallOrder[1]);
});

const group = { windowIds: ["editor", "notes"], selectedWindowId: "notes", tabBarVisible: true };
test("tab groups are macOS-only and validated at the native boundary", async () => {
  for (const operation of [() => windows.getWindowTabGroup("editor"), () => windows.listWindowTabGroups(), () => windows.selectWindowTab("editor"), () => windows.moveTabToNewWindow("editor"),
    () => windows.mergeAllWindows("editor"), () => windows.setWindowTabBarVisible("editor", true), () => windows.handleWindowNewTab("editor", () => {}), () => windows.addWindowListener("editor", "tabGroupChanged", () => {})])
    await expect(operation()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  await expect(windows.openWindow({ id: "notes", component: "Notes", tabbedWith: "editor" })).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION", message: "Windows does not support tabbedWith yet" });
  await expect(windows.setWindowOptions("editor", { tabbing: { mode: "preferred" } })).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION", message: "Windows does not support tabbing yet" });
  expect(call).not.toHaveBeenCalled();
  platform.OS = "macos";
  call.mockImplementation(async (method: string) => JSON.stringify(method === "tabGroup" ? { ...group, native: true } : method === "tabGroups" ? [group, { windowIds: ["main"], selectedWindowId: "main", tabBarVisible: false }] : null));
  expect(await windows.getWindowTabGroup("editor")).toEqual(group);
  expect(await windows.listWindowTabGroups()).toEqual([group, { windowIds: ["main"], selectedWindowId: "main", tabBarVisible: false }]);
  for (const [operation, method, args] of [[() => windows.selectWindowTab("notes"), "selectTab", { id: "notes" }], [() => windows.moveTabToNewWindow("notes"), "moveTabToNewWindow", { id: "notes" }],
    [() => windows.mergeAllWindows("editor"), "mergeAllWindows", { id: "editor" }], [() => windows.setWindowTabBarVisible("editor", false), "tabBar", { id: "editor", visible: false }]] as const) {
    await operation(); expect(call.mock.calls.at(-1)![0]).toBe(method); expect(JSON.parse(call.mock.calls.at(-1)![1])).toEqual(args);
  }
  call.mockResolvedValueOnce(JSON.stringify({ windowIds: ["editor"], selectedWindowId: 3, tabBarVisible: false }));
  await expect(windows.getWindowTabGroup("editor")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  await expect(windows.setWindowTabBarVisible("editor", "yes" as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(windows.selectWindowTab("../editor")).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
});
test("tab listeners deliver validated group and selection changes for the live instance", async () => {
  platform.OS = "macos";
  const changed = vi.fn(), selected = vi.fn(), onError = vi.fn();
  const groupChanges = await windows.addWindowListener("editor", "tabGroupChanged", changed, { onError });
  const selections = await windows.addWindowListener("editor", "tabSelectionChanged", selected, { onError });
  emit({ type: "tabGroupChanged", tabGroup: { ...group, extra: 1 } }); emit({ type: "tabSelectionChanged", selectedWindowId: null });
  expect(changed).toHaveBeenCalledExactlyOnceWith({ windowId: "editor", tabGroup: group });
  expect(selected).toHaveBeenCalledExactlyOnceWith({ windowId: "editor", selectedWindowId: null });
  emit({ type: "tabGroupChanged", tabGroup: { windowIds: "editor" } }); emit({ type: "tabSelectionChanged", selectedWindowId: "" });
  expect(onError).toHaveBeenCalledTimes(2); expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "E_INVALID_DATA" }));
  emit({ type: "tabSelectionChanged", instanceId: "instance-2", selectedWindowId: "notes" }); expect(selected).toHaveBeenCalledTimes(1);
  await groupChanges.remove(); await selections.remove();
});
test("a new-tab handler owns the + button of the live window until removed", async () => {
  platform.OS = "macos";
  const handler = vi.fn(async () => { throw new Error("open failed"); }), onError = vi.fn();
  const registration = await windows.handleWindowNewTab("editor", handler, { onError });
  const enabled = JSON.parse(call.mock.calls.find(([method]) => method === "newTab")![1]);
  expect(enabled).toEqual({ id: "editor", handlerId: expect.stringMatching(/^tab-/), enabled: true });
  emit({ type: "newTabRequested", handlerId: "another" }); emit({ type: "newTabRequested", handlerId: enabled.handlerId }); await tick();
  expect(handler).toHaveBeenCalledExactlyOnceWith({ windowId: "editor" });
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "open failed" }));
  await registration.remove(); await registration.remove();
  expect(call.mock.calls.filter(([method]) => method === "newTab").map(([, args]) => JSON.parse(args).enabled)).toEqual([true, false]);
  emit({ type: "newTabRequested", handlerId: enabled.handlerId }); await tick(); expect(handler).toHaveBeenCalledTimes(1);
  // A second handler rejects natively; nothing stays subscribed.
  call.mockImplementation(async (method: string) => { if (method === "newTab") throw Object.assign(new Error("busy"), { code: "E_BUSY" }); return JSON.stringify(info); });
  await expect(windows.handleWindowNewTab("editor", handler)).rejects.toMatchObject({ code: "E_BUSY" });
  expect(listeners.size).toBe(0);
  await expect(windows.handleWindowNewTab("editor", "open" as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
});
test("macOS tab options reach the window module at open and on update", async () => {
  platform.OS = "macos";
  await windows.openWindow({ id: "notes", component: "Notes", tabbedWith: "editor", tabbing: { identifier: "docs" } });
  expect(JSON.parse(call.mock.calls.find(([method]) => method === "completeOpen")![1])).toMatchObject({ tabbedWith: "editor", tabbing: { identifier: "docs" } });
  await windows.setWindowOptions("editor", { tabbing: { mode: "disallowed" } });
  expect(JSON.parse(call.mock.calls.at(-1)![1])).toEqual({ id: "editor", options: { tabbing: { mode: "disallowed" } } });
  expect(managed.setWindowOptions).not.toHaveBeenCalled();
});
