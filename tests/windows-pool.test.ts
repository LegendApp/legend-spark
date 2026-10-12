import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { useState } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");

// A simulated native side: each window renders its registered root with its current root props, as the host does;
// pooled windows park on close (new instance token, hidden) and `rootProps` re-renders the root.
type Listener = { id: string; token: number; type: string; listener: (event: object) => void; removed: boolean };
type NativeWindow = { token: number; props: object; component: string; visible: boolean; pooled: boolean; title: string; renderer?: any };
const mocks = vi.hoisted(() => ({
  platform: { OS: "macos" },
  roots: new Map<string, () => any>(),
  turbo: new Set(["NativeDesktopSystem"]),
  windowAvailability: { available: true } as object,
  windows: new Map<string, NativeWindow>(),
  token: 0,
  footprint: 0,
  /** Footprint growth per created window. */
  windowCost: 20 * 1024 * 1024,
  listeners: [] as Listener[],
  pressure: undefined as undefined | ((event: object) => void),
  calls: [] as string[],
  openWindow: vi.fn(), windowPoolCommand: vi.fn(), closeWindow: vi.fn(), showWindow: vi.fn(), getWindow: vi.fn(),
  setWindowOptions: vi.fn(), setWindowBounds: vi.fn(), centerWindow: vi.fn(), addWindowListener: vi.fn(),
}));
vi.mock("react-native", () => ({
  Platform: mocks.platform, NativeModules: {},
  TurboModuleRegistry: { get: (name: string) => mocks.turbo.has(name) ? {} : null },
  AppRegistry: { registerComponent: (name: string, factory: () => unknown) => mocks.roots.set(name, factory) },
  UIManager: { hasViewManagerConfig: () => false },
  StyleSheet: { create: (styles: object) => styles, hairlineWidth: 1 },
  View: "View", Text: "Text", Pressable: "Pressable", useColorScheme: () => "light",
}));
vi.mock("../packages/desktop-windows/src/api", () => ({
  getWindowAvailability: () => mocks.windowAvailability,
  openWindow: mocks.openWindow, closeWindow: mocks.closeWindow, showWindow: mocks.showWindow, getWindow: mocks.getWindow,
  setWindowOptions: mocks.setWindowOptions, setWindowBounds: mocks.setWindowBounds, centerWindow: mocks.centerWindow,
  addWindowListener: mocks.addWindowListener, windowPoolCommand: mocks.windowPoolCommand,
  processFootprint: async () => mocks.footprint, handleWindowNewTab: vi.fn(), listWindowTabGroups: vi.fn(), selectWindowTab: vi.fn(), getDisplays: vi.fn(),
}));
vi.mock("../packages/desktop-windows/src/macos", () => ({ addMacOSWindowListener: vi.fn() }));
vi.mock("@legendapp/spark-system", () => ({
  onSystemEvent: async (handler: (event: object) => void) => { mocks.pressure = handler; return { remove: async () => { mocks.pressure = undefined; } }; },
}));
import { createWindowsNavigator, getWindowPerformanceAvailability, useWindowInstance, type WindowsConfig } from "../packages/desktop-windows/src/windows";

const MB = 1024 * 1024;
const tick = async () => { for (let n = 0; n < 10; n++) await new Promise(resolve => setTimeout(resolve, 0)); };
const failure = (code: string) => Object.assign(new Error(code), { code });
const info = (id: string) => {
  const window = mocks.windows.get(id);
  if (!window) throw failure("E_NOT_FOUND");
  return { id, title: window.title, visible: window.visible, focused: false, bounds: { displayId: "1", x: 0, y: 0, width: 640, height: 480 } };
};
const deliver = (id: string, token: number, type: string, event: object) => {
  for (const entry of [...mocks.listeners]) if (!entry.removed && entry.id === id && entry.token === token && entry.type === type) entry.listener({ windowId: id, ...event });
};
async function render(id: string) {
  const window = mocks.windows.get(id)!;
  const Root = mocks.roots.get(window.component)!();
  // Legacy roots render and run layout effects synchronously, as the native host's root does before it returns.
  if (window.renderer) window.renderer.update(React.createElement(Root, window.props));
  else window.renderer = create(React.createElement(Root, window.props));
}
/** The user's close button: a pooled window parks, any other closes. */
async function nativeClose(id: string) {
  const window = mocks.windows.get(id)!, token = window.token;
  if (window.pooled) { window.token = ++mocks.token; window.visible = false; }
  else { mocks.windows.delete(id); window.renderer?.unmount(); }
  deliver(id, token, "closed", {});
  await tick();
}
const setVisible = (id: string, visible: boolean) => { const window = mocks.windows.get(id)!; window.visible = visible; deliver(id, window.token, "visibilityChanged", { visible }); };
const contents = (id: string) => mocks.windows.get(id)?.renderer?.toJSON();
const removers: Array<() => Promise<void>> = [];
function track<T extends { remove(): Promise<void> }>(value: T) { removers.push(() => value.remove()); return value; }

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
  mocks.platform.OS = "macos"; mocks.turbo = new Set(["NativeDesktopSystem"]); mocks.windowAvailability = { available: true };
  mocks.windows.clear(); mocks.listeners = []; mocks.footprint = 100 * MB; mocks.windowCost = 20 * MB; mocks.pressure = undefined; mocks.calls = [];
  mocks.openWindow.mockReset().mockImplementation(async (options: { id: string; component: string; props: object; show?: boolean; title?: string }) => {
    if (mocks.windows.has(options.id)) throw failure("E_ALREADY_EXISTS");
    mocks.calls.push(`open ${options.id}`);
    mocks.windows.set(options.id, { token: ++mocks.token, props: options.props, component: options.component, visible: options.show !== false, pooled: false, title: options.title ?? "" });
    mocks.footprint += mocks.windowCost;
    await render(options.id);
    return info(options.id);
  });
  mocks.windowPoolCommand.mockReset().mockImplementation(async (method: string, args: { id: string; enabled?: boolean; props?: object }) => {
    const window = mocks.windows.get(args.id);
    if (!window) throw failure("E_NOT_FOUND");
    mocks.calls.push(`${method} ${args.id}`);
    if (method === "pool") window.pooled = args.enabled!;
    if (method === "rootProps") { window.props = args.props!; void render(args.id); }
    if (method === "discard") { mocks.windows.delete(args.id); mocks.footprint -= mocks.windowCost; window.renderer?.unmount(); deliver(args.id, window.token, "closed", {}); }
  });
  mocks.closeWindow.mockReset().mockImplementation(async (id: string) => {
    if (!mocks.windows.has(id)) throw failure("E_NOT_FOUND");
    void Promise.resolve().then(() => nativeClose(id)); return { closed: true };
  });
  mocks.showWindow.mockReset().mockImplementation(async (id: string) => { mocks.calls.push(`show ${id}`); setVisible(id, true); });
  mocks.getWindow.mockReset().mockImplementation(async (id: string) => info(id));
  mocks.setWindowOptions.mockReset().mockImplementation(async (id: string, options: { title?: string }) => { info(id); if (options.title !== undefined) mocks.windows.get(id)!.title = options.title; });
  mocks.setWindowBounds.mockReset().mockResolvedValue(undefined); mocks.centerWindow.mockReset().mockResolvedValue(undefined);
  mocks.addWindowListener.mockReset().mockImplementation(async (id: string, type: string, listener: (event: object) => void) => {
    const window = mocks.windows.get(id);
    if (!window) throw failure("E_NOT_FOUND");
    const entry: Listener = { id, token: window.token, type, listener, removed: false };
    mocks.listeners.push(entry);
    return { remove: vi.fn(async () => { entry.removed = true; }) };
  });
  const original = console.error; vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => {
  for (const remove of removers.splice(0)) await remove();
  for (const window of mocks.windows.values()) window.renderer?.unmount();
  vi.restoreAllMocks();
});

let renders = 0;
function Note({ title }: { title: string }) {
  renders++;
  const window = useWindowInstance();
  const [mountedAs] = useState(title);
  return React.createElement("Note", { title, mountedAs, window: window.id });
}
const pooled = (pool: object = {}, extra: object = {}) => ({ note: { component: Note, options: { title: "Note", size: { width: 640, height: 480 } }, pool, ...extra } }) satisfies WindowsConfig;

test("availability is local and truthful per feature and platform", () => {
  expect(getWindowPerformanceAvailability("pool")).toEqual({ available: true });
  expect(getWindowPerformanceAvailability("throttle")).toEqual({ available: true });
  mocks.turbo.clear();
  expect(getWindowPerformanceAvailability("pool")).toEqual({ available: false, reason: "missing-module" });
  expect(getWindowPerformanceAvailability("throttle")).toEqual({ available: true });
  mocks.windowAvailability = { available: false, reason: "missing-module" };
  expect(getWindowPerformanceAvailability("throttle")).toEqual({ available: false, reason: "missing-module" });
  mocks.platform.OS = "windows";
  expect(getWindowPerformanceAvailability("pool")).toEqual({ available: false, reason: "unsupported-platform" });
  expect(getWindowPerformanceAvailability("throttle")).toEqual({ available: false, reason: "unsupported-platform" });
  expect(() => getWindowPerformanceAvailability("speed" as never)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
});

test("pool and throttle registrations are validated; Windows rejects them as unsupported", () => {
  const bad = (entry: object, code: string) => expect(() => createWindowsNavigator({ bad: { component: Note, ...entry } } as never)).toThrow(expect.objectContaining({ code }));
  bad({ id: "fixed", pool: {} }, "E_INVALID_ARGUMENT");
  bad({ pool: { max: 9 } }, "E_INVALID_ARGUMENT");
  bad({ pool: { max: 1, prewarm: 2 } }, "E_INVALID_ARGUMENT");
  bad({ pool: { memoryBudgetMB: 0 } }, "E_INVALID_ARGUMENT");
  bad({ pool: { memoryBudgetMB: 1.5 } }, "E_INVALID_ARGUMENT");
  bad({ pool: { warm: 1 } }, "E_UNSUPPORTED_OPTION");
  bad({ throttle: "yes" }, "E_INVALID_ARGUMENT");
  mocks.platform.OS = "windows";
  bad({ pool: {} }, "E_UNSUPPORTED_OPTION");
  bad({ throttle: true }, "E_UNSUPPORTED_OPTION");
  track(createWindowsNavigator({ unthrottled: { component: Note, throttle: false } }));
});

test("prewarm creates measured warm windows that render nothing; an open takes one and shows it after its content commits", async () => {
  const windows = track(createWindowsNavigator(pooled()));
  expect(windows.getPool("note")).toMatchObject({ warm: 0, target: 0, max: 2, memoryBudgetMB: 64, measuredWindowMB: null, hits: 0, misses: 0 });
  // Before prewarm the entry behaves like any other: no warm window, nothing counted.
  const state = await windows.prewarm("note");
  expect(state).toMatchObject({ warm: 1, target: 1, measuredWindowMB: 20, memoryPressure: false });
  const [warm] = [...mocks.windows.keys()];
  expect(mocks.openWindow.mock.calls[0][0]).toMatchObject({ id: warm, show: false, title: "Note", props: { sparkWindow: { id: warm, use: 0 } } });
  expect(mocks.windows.get(warm)).toMatchObject({ pooled: true, visible: false });
  expect(contents(warm)).toBeNull();
  mocks.calls = [];
  const note = await windows.openInstance("note", { props: { title: "First" }, options: { title: "First" } });
  expect(note.id).toBe(warm);
  expect(contents(warm)).toMatchObject({ type: "Note", props: { title: "First", window: warm } });
  // Props first, then the window is shown only after the content committed.
  expect(mocks.calls.slice(0, 2)).toEqual([`rootProps ${warm}`, `show ${warm}`]);
  expect(mocks.setWindowOptions).toHaveBeenCalledWith(warm, { title: "First" });
  expect(mocks.setWindowBounds).toHaveBeenCalledWith(warm, expect.objectContaining({ width: 640, height: 480 }));
  expect(mocks.centerWindow).toHaveBeenCalledWith(warm, { displayId: "1" });
  await tick();
  // The pool refills to its target after the open.
  expect(windows.getPool("note")).toMatchObject({ warm: 1, hits: 1, misses: 0 });
  expect(windows.list()).toEqual([note]);
});

test("a closed pooled window parks, unmounts its content and is reused with fresh state; the next instance is distinct", async () => {
  const windows = track(createWindowsNavigator(pooled({ prewarm: 0 })));
  await windows.prewarm("note");
  const first = await windows.openInstance("note", { props: { title: "One" } });
  expect(windows.getPool("note")).toMatchObject({ warm: 0, misses: 1 });
  expect(mocks.windows.get(first.id)!.pooled).toBe(true);
  await nativeClose(first.id);
  expect(first.isOpen()).toBe(false);
  expect(windows.getPool("note").warm).toBe(1);
  expect(contents(first.id)).toBeNull();
  const second = await windows.openInstance("note", { props: { title: "Two" } });
  expect(second.id).toBe(first.id); expect(second).not.toBe(first);
  expect(contents(second.id)).toMatchObject({ props: { title: "Two", mountedAs: "Two" } });
  await expect(first.focus()).rejects.toMatchObject({ code: "E_CLOSED" });
  // A title the last use set is reset to the window's creation title.
  expect(mocks.setWindowOptions).toHaveBeenLastCalledWith(second.id, { title: "Note" });
  expect(windows.getPool("note")).toMatchObject({ hits: 1, misses: 1, released: 0 });
});

test("windows past max are closed for real when they close", async () => {
  const windows = track(createWindowsNavigator(pooled({ prewarm: 0, max: 1 })));
  await windows.prewarm("note");
  const a = await windows.openInstance("note", { props: { title: "A" } }), b = await windows.openInstance("note", { props: { title: "B" } });
  await nativeClose(a.id); await nativeClose(b.id);
  expect(windows.getPool("note")).toMatchObject({ warm: 1, released: 1 });
  expect(mocks.windows.has(a.id)).toBe(true); expect(mocks.windows.has(b.id)).toBe(false);
});

test("the memory budget limits warm windows to what fits the largest measured cost", async () => {
  mocks.windowCost = 40 * MB;
  const windows = track(createWindowsNavigator(pooled({ prewarm: 3, max: 3, memoryBudgetMB: 100 })));
  // 100 MB holds two 40 MB windows, not three.
  expect(await windows.prewarm("note")).toMatchObject({ warm: 2, measuredWindowMB: 40 });
  // A costlier window measured by the refill lowers the limit to one: the oldest warm window is released.
  mocks.windowCost = 60 * MB;
  await windows.openInstance("note", { props: { title: "Open" } });
  await tick();
  expect(windows.getPool("note")).toMatchObject({ warm: 1, measuredWindowMB: 60, released: 1 });
});

test("memory pressure releases every warm window and stops refilling until it returns to normal", async () => {
  const windows = track(createWindowsNavigator({ ...pooled({ prewarm: 2 }), other: { component: Note, pool: { prewarm: 1 } } }));
  await windows.prewarm("note"); await windows.prewarm("other");
  expect(mocks.windows.size).toBe(3);
  mocks.pressure!({ type: "memoryPressure", level: "warning" }); await tick();
  expect(mocks.windows.size).toBe(0);
  expect(windows.getPool("note")).toMatchObject({ warm: 0, memoryPressure: true, released: 2 });
  const note = await windows.openInstance("note", { props: { title: "Under pressure" } });
  await nativeClose(note.id);
  expect(mocks.windows.size).toBe(0);
  mocks.pressure!({ type: "memoryPressure", level: "normal" }); await tick();
  expect(windows.getPool("note")).toMatchObject({ warm: 2, memoryPressure: false });
  expect(windows.getPool("other").warm).toBe(1);
});

test("opens whose options a warm window cannot take open a new window and count a miss", async () => {
  const windows = track(createWindowsNavigator(pooled()));
  await windows.prewarm("note");
  const warm = [...mocks.windows.keys()][0];
  const parent = await windows.openInstance("note", { props: { title: "Parent" } });
  expect(parent.id).toBe(warm); await tick();
  const child = await windows.openInstance("note", { props: { title: "Sheet" }, options: { kind: "window", parentId: parent.id, modal: true } });
  expect(child.id).not.toBe(warm);
  expect(windows.getPool("note")).toMatchObject({ hits: 1, misses: 1 });
});

test("trimPool closes warm windows for real; remove releases them and stops parking open windows", async () => {
  const windows = createWindowsNavigator(pooled({ prewarm: 2 }));
  await windows.prewarm("note");
  await windows.trimPool("note");
  expect(windows.getPool("note")).toMatchObject({ warm: 0, target: 0, released: 2 });
  expect(mocks.windows.size).toBe(0);
  await expect(windows.trimPool("nope" as never)).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  await windows.prewarm("note", 1);
  const open = await windows.openInstance("note", { props: { title: "Open" } });
  await tick();
  await windows.remove();
  expect(mocks.pressure).toBeUndefined();
  expect([...mocks.windows.keys()]).toEqual([open.id]);
  expect(mocks.windows.get(open.id)!.pooled).toBe(false);
  expect(() => windows.getPool("note")).toThrow(expect.objectContaining({ code: "E_CLOSED" }));
});

test("after a reload, warm roots are released and parked windows no pool owns close for real", async () => {
  const windows = track(createWindowsNavigator(pooled()));
  mocks.windows.set("note-orphan", { token: ++mocks.token, props: { sparkWindow: { id: "note-orphan", use: 0 } }, component: "spark.window.note", visible: false, pooled: true, title: "Note" });
  await render("note-orphan"); await tick();
  expect(mocks.windows.has("note-orphan")).toBe(false);
  expect(windows.list()).toEqual([]);
  // An open pooled window restarted after a reload is adopted; when it parks on close, no pool owns it, so it closes for real.
  mocks.windows.set("note-open", { token: ++mocks.token, props: { props: { title: "Kept" }, sparkWindow: { id: "note-open", use: 3 } }, component: "spark.window.note", visible: true, pooled: true, title: "Kept" });
  await render("note-open"); await tick();
  expect(windows.list().map(window => window.id)).toEqual(["note-open"]);
  expect(contents("note-open")).toMatchObject({ props: { title: "Kept" } });
  await nativeClose("note-open"); await tick();
  expect(windows.list()).toEqual([]);
  expect(mocks.windows.has("note-open")).toBe(false);
});

test("prewarm rejects E_MODULE_UNAVAILABLE without the system module, and E_INVALID_ARGUMENT for entries without a pool", async () => {
  mocks.turbo.clear();
  const windows = track(createWindowsNavigator(pooled()));
  await expect(windows.prewarm("note")).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
  expect(mocks.windows.size).toBe(0);
  const plain = track(createWindowsNavigator({ plain: { component: Note } }));
  await expect(plain.prewarm("plain")).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(plain.prewarm("plain" as never, -1)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
});

test("a warm window whose content never commits is released and the open rejects E_TIMEOUT", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const windows = track(createWindowsNavigator(pooled()));
    await windows.prewarm("note");
    const warm = [...mocks.windows.keys()][0];
    mocks.windowPoolCommand.mockImplementationOnce(async () => {}); // rootProps lost: the root never re-renders
    const opening = windows.openInstance("note", { props: { title: "Lost" } });
    const outcome = expect(opening).rejects.toMatchObject({ code: "E_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(10000); await outcome;
    expect(mocks.windows.has(warm)).toBe(false);
    expect(windows.list()).toEqual([]);
  } finally { vi.useRealTimers(); }
});

test("a throttled window's content stops re-rendering while hidden or covered, keeps its state and catches up when visible", async () => {
  const counter = { value: 0, listeners: new Set<() => void>() };
  const bump = () => { counter.value++; for (const listener of counter.listeners) listener(); };
  let counted = 0;
  function Clock() {
    counted++;
    const value = React.useSyncExternalStore(listener => { counter.listeners.add(listener); return () => counter.listeners.delete(listener); }, () => counter.value);
    return React.createElement("Clock", { value });
  }
  const windows = track(createWindowsNavigator({ clock: { component: Clock, throttle: true }, plain: { component: Clock } }));
  const clock = await windows.openInstance("clock"), plain = await windows.openInstance("plain");
  // Opened without props: the root props carry none (undefined is not JSON).
  expect(mocks.openWindow.mock.calls[0][0].props).toEqual({ sparkWindow: { id: clock.id } });
  bump(); await tick();
  expect(contents(clock.id)).toMatchObject({ props: { value: 1 } });
  setVisible(clock.id, false); await tick();
  const before = counted;
  for (let n = 0; n < 5; n++) { bump(); await tick(); }
  // Only the unthrottled window rendered the five changes.
  expect(counted - before).toBe(5);
  expect(contents(plain.id)).toMatchObject({ props: { value: 6 } });
  setVisible(clock.id, true); await tick();
  expect(contents(clock.id)).toMatchObject({ props: { value: 6 } });
  // Covered by other windows (AppKit occlusion) throttles the same way.
  const token = mocks.windows.get(clock.id)!.token;
  deliver(clock.id, token, "occlusionChanged", { occluded: true }); await tick();
  const covered = counted;
  bump(); await tick();
  expect(counted - covered).toBe(1);
  deliver(clock.id, token, "occlusionChanged", { occluded: false }); await tick();
  expect(contents(clock.id)).toMatchObject({ props: { value: 7 } });
  expect(mocks.addWindowListener).toHaveBeenCalledWith(clock.id, "occlusionChanged", expect.any(Function), expect.anything());
  expect(mocks.addWindowListener).not.toHaveBeenCalledWith(plain.id, "occlusionChanged", expect.any(Function), expect.anything());
});
