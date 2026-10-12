import { beforeEach, expect, test, vi } from "vitest";
// The special window controllers over a mocked window API (packages/desktop-windows/src/special.ts). Native
// behavior (panel styles, levels, collection behaviors, corner snapping, simulated displays) is covered by
// tests/window.native.mm and tests/window-manager.native.mm; driver flows are in e2e/flows/multiwindow/special-*.yaml.
const mocks = vi.hoisted(() => ({
  platform: { OS: "macos" },
  windowListeners: new Map<string, Map<string, Set<(event: any) => void>>>(),
  displayListeners: new Set<(event: any) => void>(),
  shortcuts: new Map<string, () => void>(),
  bounds: new Map<string, any>(),
  calls: [] as unknown[][],
  displays: [] as any[],
  details: [] as any[],
  cursor: { displayId: "1", x: 10, y: 10 },
}));
vi.mock("react-native", () => ({ Platform: mocks.platform }));
const record = (name: string) => (...args: unknown[]) => { mocks.calls.push([name, ...args]); };
vi.mock("../packages/desktop-windows/src/api", () => ({
  getWindowAvailability: () => ({ available: true }),
  getDisplays: async () => mocks.displays,
  getCursorPoint: async () => mocks.cursor,
  openWindow: vi.fn(async (options: any) => {
    record("open")(options);
    const position = options.position ?? { displayId: "1", x: 0, y: 0 };
    mocks.bounds.set(options.id, { ...position, ...(options.size ?? { width: 640, height: 480 }) });
    return { id: options.id, bounds: mocks.bounds.get(options.id) };
  }),
  getWindow: async (id: string) => ({ id, bounds: mocks.bounds.get(id) }),
  setWindowBounds: vi.fn(async (id: string, bounds: any, options?: any) => { record("bounds")(id, bounds, ...(options ? [options] : [])); mocks.bounds.set(id, bounds); }),
  showWindow: vi.fn(async (id: string, options: any) => { record("show")(id, options); }),
  hideWindow: vi.fn(async (id: string) => { record("hide")(id); }),
  closeWindow: vi.fn(async (id: string) => { record("close")(id); emitWindow(id, "closed", {}); return { closed: true }; }),
  addWindowListener: vi.fn(async (id: string, type: string, listener: (event: any) => void) => {
    const types = mocks.windowListeners.get(id) ?? new Map(); mocks.windowListeners.set(id, types);
    const set = types.get(type) ?? new Set(); types.set(type, set); set.add(listener);
    return { remove: async () => { set.delete(listener); } };
  }),
}));
vi.mock("../packages/desktop-windows/src/displays", () => ({
  getDisplayDetails: async () => mocks.details,
  addDisplayListener: async (listener: (event: any) => void) => { mocks.displayListeners.add(listener); return { remove: async () => { mocks.displayListeners.delete(listener); } }; },
}));
vi.mock("@legendapp/spark-global-shortcuts", () => ({
  registerGlobalShortcut: vi.fn(async (accelerator: string, handler: () => void) => {
    mocks.shortcuts.set(accelerator, handler);
    return { remove: async () => { mocks.shortcuts.delete(accelerator); } };
  }),
}));
function emitWindow(id: string, type: string, event: object) { for (const listener of [...mocks.windowListeners.get(id)?.get(type) ?? []]) listener({ windowId: id, ...event }); }
import * as special from "../packages/desktop-windows/src/special";
const tick = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
const display = (id: string, primary: boolean, width: number, height: number, menuBar = 0) => ({ id, persistentId: null, name: id, primary, size: { width, height }, workArea: { x: 0, y: menuBar, width, height: height - menuBar }, scaleFactor: 2 });
const calls = (name: string) => mocks.calls.filter(call => call[0] === name).map(call => call.slice(1));

beforeEach(() => {
  mocks.platform.OS = "macos";
  mocks.windowListeners.clear(); mocks.displayListeners.clear(); mocks.shortcuts.clear(); mocks.bounds.clear(); mocks.calls.length = 0;
  mocks.displays = [display("1", true, 1512, 982, 32), display("2", false, 1920, 1080)];
  mocks.details = mocks.displays.map(item => ({ ...item, safeArea: { top: item.id === "1" ? 32 : 0, left: 0, bottom: 0, right: 0 } }));
  mocks.cursor = { displayId: "2", x: 5, y: 5 };
});

test("availability: every type on macOS, unsupported-platform elsewhere, and every factory rejects there", async () => {
  expect(special.getSpecialWindowAvailability()).toEqual({ available: true });
  expect(special.getSpecialWindowAvailability("presenter")).toEqual({ available: true });
  expect(() => special.getSpecialWindowAvailability("sheet" as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  mocks.platform.OS = "windows";
  expect(special.getSpecialWindowAvailability("commandBar")).toEqual({ available: false, reason: "unsupported-platform" });
  const content = { id: "w", component: "C" }, size = { width: 400, height: 300 };
  for (const open of [
    () => special.createCommandBar({ ...content, size }), () => special.createHUD({ ...content, size }), () => special.openPreviewWindow({ ...content, size }),
    () => special.openPictureInPicture({ ...content, size }), () => special.openPopover({ ...content, size, anchor: { type: "notch" } }),
    () => special.createEdgeDrawer({ ...content, edge: "left", thickness: 300 }), () => special.openOverlay(content),
    () => special.openDesktopWidget({ ...content, size, position: { displayId: "1", x: 0, y: 0 } }), () => special.startPresenterMode({ audience: { id: "a", component: "A" }, controller: content }),
  ]) await expect(open()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
  expect(mocks.calls).toEqual([]);
});

test("command bar: a hidden non-activating panel; the hotkey toggles it centered on the pointer's display, and losing focus hides it", async () => {
  const bar = await special.createCommandBar({ id: "palette", component: "Palette", size: { width: 680, height: 100 }, hotkey: "Cmd+Shift+Space" });
  expect(calls("open")[0]![0]).toMatchObject({ id: "palette", show: false, titleBarStyle: "hidden", transparent: true, resizable: false,
    macos: { panelStyle: "nonactivating", level: "floating", spaces: "all", fullScreenAuxiliary: true, ignoresCycle: true, backgroundMaterial: "popover" } });
  expect(bar.shown).toBe(false);
  mocks.shortcuts.get("Cmd+Shift+Space")!(); await tick();
  // Display 2 (under the pointer): centered, its top a fifth of the way down the 1080-point work area.
  expect(calls("bounds")[0]).toEqual(["palette", { displayId: "2", width: 680, height: 100, x: 620, y: 216 }]);
  expect(calls("show")[0]).toEqual(["palette", { focus: true }]);
  expect(bar.shown).toBe(true);
  emitWindow("palette", "focusChanged", { focused: false }); await tick();
  expect(calls("hide")).toEqual([["palette"]]); expect(bar.shown).toBe(false);
  await bar.show({ displayId: "1" });
  expect(calls("bounds")[1]).toEqual(["palette", { displayId: "1", width: 680, height: 100, x: 416, y: 222 }]);
  await bar.toggle(); expect(bar.shown).toBe(false);
  await bar.remove();
  expect(mocks.shortcuts.size).toBe(0); expect(calls("close")).toEqual([["palette"]]);
  await expect(bar.show()).rejects.toMatchObject({ code: "E_CLOSED" });
});

test("command bar: invalid options reject before opening; a window closed elsewhere ends the controller and its hotkey", async () => {
  await expect(special.createCommandBar({ id: "p", component: "P", size: { width: 50, height: 72 } })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(special.createCommandBar({ id: "p", component: "P", size: { width: 680, height: 100 }, blur: true } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(special.createCommandBar({ id: "p", component: "P", size: { width: 680, height: 100 }, material: "glass" as never })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  expect(mocks.calls).toEqual([]);
  const bar = await special.createCommandBar({ id: "p", component: "P", size: { width: 680, height: 100 }, hotkey: "Cmd+K" });
  emitWindow("p", "closed", {}); await tick();
  expect(mocks.shortcuts.size).toBe(0);
  await expect(bar.toggle()).rejects.toMatchObject({ code: "E_CLOSED" });
});

test("HUD: a click-through overlay shown two thirds down the display; it hides itself after durationMs and restarts on show", async () => {
  vi.useFakeTimers();
  try {
    const hud = await special.createHUD({ id: "volume", component: "Volume", size: { width: 200, height: 200 } });
    expect(calls("open")[0]![0]).toMatchObject({ kind: "overlay", ignoreMouseEvents: true, show: false, macos: { backgroundMaterial: "hudWindow" } });
    expect(calls("open")[0]![0]).not.toHaveProperty("macos.level");
    await hud.show({ durationMs: 1000 });
    // Primary display: work area 32–982; the center two thirds down (32 + 633.33) less half the height.
    expect(calls("bounds")[0]).toEqual(["volume", { displayId: "1", width: 200, height: 200, x: 656, y: 565 }]);
    expect(calls("show")[0]).toEqual(["volume", { focus: false }]);
    await vi.advanceTimersByTimeAsync(600);
    await hud.show({ durationMs: 1000 });
    await vi.advanceTimersByTimeAsync(600);
    expect(calls("hide")).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    expect(calls("hide")).toEqual([["volume"]]); expect(hud.shown).toBe(false);
    await hud.show({ durationMs: 0 });
    await vi.advanceTimersByTimeAsync(60000);
    expect(calls("hide")).toHaveLength(1);
    await expect(hud.show({ durationMs: -1 })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
    await hud.remove();
  } finally { vi.useRealTimers(); }
});

test("preview: a floating HUD panel grows from the thumbnail to the center and shrinks back before closing", async () => {
  const from = { displayId: "2", x: 100, y: 200, width: 64, height: 48 };
  const preview = await special.openPreviewWindow({ id: "look", component: "Look", size: { width: 800, height: 600 }, from });
  expect(calls("open")[0]![0]).toMatchObject({ size: { width: 100, height: 100 }, position: { displayId: "2", x: 82, y: 174 }, show: false, macos: { panelStyle: "hud", level: "floating" } });
  expect(calls("show")[0]).toEqual(["look", { focus: true }]);
  expect(calls("bounds")[0]).toEqual(["look", { displayId: "2", width: 800, height: 600, x: 560, y: 240 }, { macos: { durationMs: 200 } }]);
  expect(await preview.close()).toEqual({ closed: true });
  expect(calls("bounds")[1]).toEqual(["look", { displayId: "2", width: 100, height: 100, x: 82, y: 174 }, { macos: { durationMs: 200 } }]);
  await expect(preview.close()).rejects.toMatchObject({ code: "E_CLOSED" });
});

test("picture in picture: opens at a corner with corner snapping and its aspect ratio; snapTo moves it to another corner", async () => {
  const pip = await special.openPictureInPicture({ id: "pip", component: "Video", size: { width: 320, height: 180 }, corner: "topLeft", margin: 20 });
  expect(calls("open")[0]![0]).toMatchObject({ position: { displayId: "1", x: 20, y: 52 }, aspectRatio: 320 / 180, titleBarStyle: "hidden",
    macos: { panelStyle: "nonactivating", level: "floating", spaces: "all", fullScreenAuxiliary: true, cornerSnapping: { margin: 20 } } });
  expect(calls("show")[0]).toEqual(["pip", { focus: false }]);
  await pip.snapTo("bottomRight", { displayId: "2" });
  expect(calls("bounds")[0]).toEqual(["pip", { displayId: "2", width: 320, height: 180, x: 1580, y: 880 }, { macos: { durationMs: 200 } }]);
  await expect(pip.snapTo("middle" as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await pip.close();
});

test("popover: hangs centered below a tray rect, inside the display, and closes when it loses focus", async () => {
  const popover = await special.openPopover({ id: "menu", component: "Menu", size: { width: 300, height: 400 }, anchor: { type: "rect", rect: { displayId: "1", x: 1490, y: 0, width: 22, height: 24 } } });
  // Centered on the item would overflow the right edge: kept inside the 1512-point display.
  expect(calls("open")[0]![0]).toMatchObject({ position: { displayId: "1", x: 1212, y: 28 }, titleBarStyle: "hidden", macos: { panelStyle: "nonactivating", backgroundMaterial: "popover" } });
  expect(calls("show")[0]).toEqual(["menu", { focus: true }]);
  emitWindow("menu", "focusChanged", { focused: false }); await tick();
  expect(calls("close")).toEqual([["menu"]]);
  await expect(popover.close()).rejects.toMatchObject({ code: "E_CLOSED" });
});

test("popover: the notch anchor uses the notched display's menu bar, or a given display; dismissOnBlur false keeps it open", async () => {
  const kept = await special.openPopover({ id: "notch", component: "N", size: { width: 400, height: 200 }, anchor: { type: "notch" }, dismissOnBlur: false });
  expect(calls("open")[0]![0]).toMatchObject({ position: { displayId: "1", x: 556, y: 36 } });
  emitWindow("notch", "focusChanged", { focused: false }); await tick();
  expect(calls("close")).toEqual([]);
  // Closing removes its listeners, so a later window with the same ID is not watched.
  await kept.close();
  expect([...mocks.windowListeners.get("notch")!.values()].every(set => set.size === 0)).toBe(true);
  await special.openPopover({ id: "notch-2", component: "N", size: { width: 400, height: 200 }, anchor: { type: "notch", displayId: "2" } });
  expect(calls("open")[1]![0]).toMatchObject({ position: { displayId: "2", x: 760, y: 4 } });
  await expect(special.openPopover({ id: "x", component: "N", size: { width: 400, height: 200 }, anchor: { type: "notch", displayId: "9" } })).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  await expect(special.openPopover({ id: "x", component: "N", size: { width: 400, height: 200 }, anchor: { type: "cursor" } as never })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
});

test("edge drawer: slides in from past the edge and back out, then hides", async () => {
  const drawer = await special.createEdgeDrawer({ id: "drawer", component: "D", edge: "right", thickness: 320, length: 600, displayId: "2" });
  expect(calls("open")[0]![0]).toMatchObject({ size: { width: 320, height: 600 }, position: { displayId: "2", x: 1920, y: 240 }, show: false, macos: { backgroundMaterial: "sidebar" } });
  await drawer.open();
  expect(calls("bounds")).toEqual([
    ["drawer", { displayId: "2", x: 1920, y: 240, width: 320, height: 600 }],
    ["drawer", { displayId: "2", x: 1600, y: 240, width: 320, height: 600 }, { macos: { durationMs: 200 } }],
  ]);
  expect(drawer.isOpen).toBe(true);
  await drawer.toggle();
  expect(calls("bounds")[2]).toEqual(["drawer", { displayId: "2", x: 1920, y: 240, width: 320, height: 600 }, { macos: { durationMs: 200 } }]);
  expect(calls("hide")).toEqual([["drawer"]]); expect(drawer.isOpen).toBe(false);
  const top = await special.createEdgeDrawer({ id: "top", component: "D", edge: "top", thickness: 200 });
  expect(calls("open")[1]![0]).toMatchObject({ size: { width: 1512, height: 200 }, position: { displayId: "1", x: 0, y: -168 } });
  await top.remove(); await drawer.remove();
  await expect(special.createEdgeDrawer({ id: "d", component: "D", edge: "left", thickness: 50 })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
});

test("overlay covers the display and is click-through; the desktop widget sits on the desktop layer", async () => {
  await special.openOverlay({ id: "overlay", component: "O" });
  expect(calls("open")[0]![0]).toMatchObject({ kind: "overlay", size: { width: 1512, height: 982 }, position: { displayId: "1", x: 0, y: 0 }, ignoreMouseEvents: true });
  await special.openOverlay({ id: "overlay-2", component: "O", rect: { displayId: "2", x: 10, y: 10, width: 300, height: 200 }, clickThrough: false });
  expect(calls("open")[1]![0]).toMatchObject({ size: { width: 300, height: 200 }, position: { displayId: "2", x: 10, y: 10 }, ignoreMouseEvents: false });
  await special.openDesktopWidget({ id: "clock", component: "Clock", size: { width: 200, height: 200 }, position: { displayId: "1", x: 40, y: 80 } });
  expect(calls("open")[2]![0]).toMatchObject({ titleBarStyle: "borderless", transparent: true, hasShadow: false,
    macos: { panelStyle: "nonactivating", level: "desktop", spaces: "all", stationary: true, ignoresCycle: true } });
});

test("presenter mode: audience fills the other display, controller centered on the primary one; swap, display removal and window closing end it", async () => {
  const ended: string[] = [];
  const presenter = await special.startPresenterMode({ audience: { id: "slides", component: "Slides" }, controller: { id: "notes", component: "Notes" }, onEnd: ({ reason }) => ended.push(reason) });
  expect(presenter.audienceDisplayId).toBe("2"); expect(presenter.controllerDisplayId).toBe("1");
  expect(calls("open")[0]![0]).toMatchObject({ id: "slides", size: { width: 1920, height: 1080 }, position: { displayId: "2", x: 0, y: 0 }, titleBarStyle: "borderless", macos: { level: "status" } });
  expect(calls("open")[1]![0]).toMatchObject({ id: "notes", size: { width: 1000, height: 700 }, position: { displayId: "1", x: 256, y: 157 } });
  await presenter.swapDisplays();
  expect(calls("bounds")).toEqual([["slides", { displayId: "1", x: 0, y: 0, width: 1512, height: 982 }], ["notes", { displayId: "2", width: 1000, height: 700, x: 460, y: 190 }]]);
  expect(presenter.audienceDisplayId).toBe("1");
  for (const listener of mocks.displayListeners) listener({ displays: [mocks.displays[0]], added: [], removed: ["2"], changed: [] });
  await tick();
  expect(ended).toEqual(["displayRemoved"]); expect(calls("close").map(([id]) => id).sort()).toEqual(["notes", "slides"]);
  await presenter.stop(); expect(ended).toEqual(["displayRemoved"]);

  mocks.calls.length = 0;
  const second = await special.startPresenterMode({ audience: { id: "slides", component: "Slides" }, controller: { id: "notes", component: "Notes", size: { width: 4000, height: 300 } }, audienceDisplayId: "1", onEnd: ({ reason }) => ended.push(reason) });
  expect(second.controllerDisplayId).toBe("2");
  expect(calls("open")[1]![0]).toMatchObject({ size: { width: 1920, height: 300 } });
  emitWindow("notes", "closed", {}); await tick();
  expect(ended).toEqual(["displayRemoved", "windowClosed"]);
});

test("presenter mode needs two displays and distinct windows", async () => {
  const options = { audience: { id: "slides", component: "Slides" }, controller: { id: "notes", component: "Notes" } };
  await expect(special.startPresenterMode({ ...options, controller: { id: "slides", component: "Notes" } })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(special.startPresenterMode({ ...options, audienceDisplayId: "1", controllerDisplayId: "1" })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(special.startPresenterMode({ ...options, audienceDisplayId: "9" })).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  mocks.displays = [mocks.displays[0]];
  await expect(special.startPresenterMode(options)).rejects.toMatchObject({ code: "E_UNAVAILABLE" });
  expect(calls("open")).toEqual([]);
});
