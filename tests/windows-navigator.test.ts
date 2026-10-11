import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import React, { act, memo, StrictMode } from "react";
const { create } = createRequire(import.meta.url)("react-test-renderer");

type Listener = { id: string; token: number; type: string; listener: (event: object) => void; removed: boolean };
const mocks = vi.hoisted(() => ({
  platform: { OS: "macos" },
  roots: new Map<string, () => any>(),
  native: { ThreadedRuntime: {} as unknown },
  viewManagers: new Set(["ThreadedRuntimeSurface"]),
  windowAvailability: { available: true } as object,
  /** Live native windows: ID → instance token. */
  windows: new Map<string, number>(),
  token: 0,
  listeners: [] as Listener[],
  app: new Set<(event: object) => void>(),
  toolbar: new Map<string, (event: object) => void>(),
  openWindow: vi.fn(), closeWindow: vi.fn(), showWindow: vi.fn(), getWindow: vi.fn(), setWindowOptions: vi.fn(),
  addWindowListener: vi.fn(), addMacOSWindowListener: vi.fn(), createMenu: vi.fn(),
  menu: { update: vi.fn(), remove: vi.fn() },
  menuAction: undefined as undefined | ((action: object) => void),
}));
vi.mock("react-native", () => ({
  Platform: mocks.platform, NativeModules: mocks.native,
  AppRegistry: { registerComponent: (name: string, factory: () => unknown) => mocks.roots.set(name, factory) },
  UIManager: { hasViewManagerConfig: (name: string) => mocks.viewManagers.has(name) },
  StyleSheet: { create: (styles: object) => styles, hairlineWidth: 1 },
  View: "View", Text: "Text", Pressable: "Pressable", useColorScheme: () => "light",
}));
vi.mock("../packages/desktop-windows/src/api", () => ({
  getWindowAvailability: () => mocks.windowAvailability,
  openWindow: mocks.openWindow, closeWindow: mocks.closeWindow, showWindow: mocks.showWindow, getWindow: mocks.getWindow,
  setWindowOptions: mocks.setWindowOptions, addWindowListener: mocks.addWindowListener,
}));
vi.mock("../packages/desktop-windows/src/macos", () => ({ addMacOSWindowListener: mocks.addMacOSWindowListener }));
vi.mock("@legendapp/spark-native-menu", () => ({ createMenu: mocks.createMenu }));
// The app-level windowClosed event carries only the ID; it must never drive instance disposal.
vi.mock("@legendapp/spark-desktop-app", () => ({ addAppListener: (type: string, listener: (event: object) => void) => {
  if (type !== "windowClosed") return { remove() {} };
  mocks.app.add(listener); return { remove: () => mocks.app.delete(listener) };
} }));
import {
  createWindowState, createWindowsNavigator, getIsolatedRuntimeAvailability, useUndoState, useWindowId, useWindowInstance, useWindowState,
  type NavigatorWindowOptions, type WindowConfigEntry, type WindowInstance, type WindowsConfig,
} from "../packages/desktop-windows/src/windows";
import type { WindowInfo } from "../packages/desktop-windows/src/types";

const tick = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
const failure = (code: string) => Object.assign(new Error(code), { code });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const deliver = (id: string, token: number | undefined, type: string, event: object) => {
  for (const entry of [...mocks.listeners]) if (!entry.removed && entry.id === id && entry.token === token && entry.type === type) entry.listener({ windowId: id, ...event });
};
/** Closes the native window now; returns the delivery of its instance's closed event, for the test to send late. */
function nativeClose(id: string) {
  const token = mocks.windows.get(id);
  mocks.windows.delete(id);
  return () => { deliver(id, token, "closed", {}); for (const listener of [...mocks.app]) listener({ type: "windowClosed", windowId: id }); };
}
const focus = (id: string, focused: boolean) => deliver(id, mocks.windows.get(id), "focusChanged", { focused });
const removers: Array<() => Promise<void>> = [];
function track<T extends { remove(): Promise<void> }>(value: T) { removers.push(() => value.remove()); return value; }
let rendered: any;
async function mount(element: React.ReactElement) { await act(async () => { rendered = create(element); }); }
const rootProps = (call: number) => mocks.openWindow.mock.calls[call][0].props;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.platform.OS = "macos"; mocks.native.ThreadedRuntime = {}; mocks.viewManagers = new Set(["ThreadedRuntimeSurface"]); mocks.windowAvailability = { available: true };
  mocks.windows.clear(); mocks.listeners = []; mocks.toolbar.clear(); mocks.menuAction = undefined;
  mocks.openWindow.mockReset().mockImplementation(async (options: { id: string }) => {
    if (mocks.windows.has(options.id)) throw failure("E_ALREADY_EXISTS");
    mocks.windows.set(options.id, ++mocks.token); return { id: options.id };
  });
  mocks.closeWindow.mockReset().mockImplementation(async (id: string) => {
    if (!mocks.windows.has(id)) throw failure("E_NOT_FOUND");
    void Promise.resolve().then(nativeClose(id)); return { closed: true };
  });
  mocks.showWindow.mockReset().mockImplementation(async (id: string) => { if (!mocks.windows.has(id)) throw failure("E_NOT_FOUND"); });
  mocks.getWindow.mockReset().mockImplementation(async (id: string) => { if (!mocks.windows.has(id)) throw failure("E_NOT_FOUND"); return { id, focused: false }; });
  mocks.setWindowOptions.mockReset().mockResolvedValue(undefined);
  mocks.addWindowListener.mockReset().mockImplementation(async (id: string, type: string, listener: (event: object) => void) => {
    if (!mocks.windows.has(id)) throw failure("E_NOT_FOUND");
    const entry: Listener = { id, token: mocks.windows.get(id)!, type, listener, removed: false };
    mocks.listeners.push(entry);
    return { remove: vi.fn(async () => { entry.removed = true; }) };
  });
  mocks.addMacOSWindowListener.mockReset().mockImplementation(async (id: string, listener: (event: object) => void) => { mocks.toolbar.set(id, listener); return { remove: vi.fn(async () => {}) }; });
  mocks.menu.update.mockReset().mockResolvedValue(undefined); mocks.menu.remove.mockReset().mockResolvedValue(undefined);
  mocks.createMenu.mockReset().mockImplementation(async (options: { onAction(action: object): void }) => { mocks.menuAction = options.onAction; return mocks.menu; });
  const original = console.error; vi.spyOn(console, "error").mockImplementation((...args) => { if (!String(args[0]).startsWith("react-test-renderer is deprecated")) original(...args); });
});
afterEach(async () => {
  if (rendered) await act(async () => { rendered.unmount(); rendered = undefined; });
  for (const remove of removers.splice(0)) await remove();
  vi.restoreAllMocks();
});

test("isolated-runtime availability is answered locally and truthfully", () => {
  expect(getIsolatedRuntimeAvailability()).toEqual({ available: true });
  mocks.viewManagers.clear();
  expect(getIsolatedRuntimeAvailability()).toEqual({ available: false, reason: "missing-module" });
  mocks.viewManagers.add("ThreadedRuntimeSurface"); mocks.native.ThreadedRuntime = undefined;
  expect(getIsolatedRuntimeAvailability()).toEqual({ available: false, reason: "missing-module" });
  mocks.windowAvailability = { available: false, reason: "unsupported-platform" };
  expect(getIsolatedRuntimeAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
});

test("entries without an id open distinct windows and drop them when closed", async () => {
  const Editor = (_: { doc: string }) => null;
  const windows = track(createWindowsNavigator({ factoryEditor: { component: Editor, options: { title: "Editor" } } }));
  const changes = vi.fn(); windows.subscribe(changes);
  const one = await windows.openInstance("factoryEditor", { props: { doc: "a" } });
  const two = await windows.openInstance("factoryEditor", { props: { doc: "b" }, options: { title: "Second" } });
  expect(one.id).not.toBe(two.id); expect(one.id).toMatch(/^factoryEditor-/); expect(one.name).toBe("factoryEditor");
  expect(mocks.openWindow.mock.calls[0][0]).toMatchObject({ id: one.id, component: "spark.window.factoryEditor", title: "Editor", props: { props: { doc: "a" }, sparkWindow: { id: one.id } } });
  expect(mocks.openWindow.mock.calls[1][0].title).toBe("Second");
  expect(windows.list()).toEqual([one, two]); expect(windows.get(one.id)).toBe(one); expect(one.isOpen()).toBe(true);
  expect(await one.close()).toEqual({ closed: true });
  expect(windows.list()).toEqual([two]); expect(one.isOpen()).toBe(false); expect(windows.get(one.id)).toBeUndefined();
  await expect(one.focus()).rejects.toMatchObject({ code: "E_CLOSED" });
  nativeClose(two.id)(); expect(windows.list()).toEqual([]);
  expect(changes).toHaveBeenCalled();
  if (false) {
    // @ts-expect-error Required props cannot be omitted.
    void windows.openInstance("factoryEditor");
    // @ts-expect-error Props are inferred from the component.
    void windows.openInstance("factoryEditor", { props: { doc: 1 } });
    // @ts-expect-error Identity cannot be overridden at open time.
    void windows.openInstance("factoryEditor", { props: { doc: "a" }, options: { id: "x" } });
  }
});

test("singletons open once, join concurrent opens and focus the live window", async () => {
  const windows = track(createWindowsNavigator({ prefs: { id: "prefs", component: () => null } }));
  const [a, b] = await Promise.all([windows.openInstance("prefs"), windows.openInstance("prefs")]);
  expect(a).toBe(b); expect(a.id).toBe("prefs"); expect(mocks.openWindow).toHaveBeenCalledTimes(1);
  mocks.showWindow.mockClear();
  expect(await windows.openInstance("prefs")).toBe(a);
  expect(mocks.openWindow).toHaveBeenCalledTimes(1); expect(mocks.showWindow).toHaveBeenCalledWith("prefs", { focus: true });
  await a.close(); const reopened = await windows.openInstance("prefs");
  expect(reopened).not.toBe(a); expect(mocks.openWindow).toHaveBeenCalledTimes(2);
});

test("a late close event of an earlier singleton instance never disposes the window reusing its ID", async () => {
  const drafts = createWindowState<{ text: string }>({ initial: () => ({ text: "" }) });
  const windows = track(createWindowsNavigator({ prefs: { id: "prefs", component: () => null } }));
  // Closed natively (title-bar button); its closed event has not arrived yet.
  const first = await windows.openInstance("prefs");
  drafts.get(first).text.set("first");
  const lateFirst = nativeClose("prefs");
  const second = await windows.openInstance("prefs");
  expect(second).not.toBe(first); expect(first.isOpen()).toBe(false);
  drafts.get(second).text.set("second");
  lateFirst(); await tick();
  expect(windows.get("prefs")).toBe(second); expect(second.isOpen()).toBe(true);
  expect(drafts.get(second).text.get()).toBe("second");
  expect(() => drafts.get(first)).toThrow(expect.objectContaining({ code: "E_CLOSED" }));
  // Closed through the handle: close() resolves before the native event is delivered.
  let lateSecond!: () => void;
  mocks.closeWindow.mockImplementationOnce(async (id: string) => { lateSecond = nativeClose(id); return { closed: true }; });
  expect(await second.close()).toEqual({ closed: true });
  const third = await windows.openInstance("prefs");
  lateSecond(); await tick();
  expect(windows.list()).toEqual([third]); expect(third.isOpen()).toBe(true);
  expect(drafts.get(third).text.get()).toBe("");
  await expect(second.close()).rejects.toMatchObject({ code: "E_CLOSED" });
  expect(mocks.closeWindow).toHaveBeenCalledTimes(1);
});

test("a singleton open during post-reload adoption waits for it and never replaces the adopted window", async () => {
  const Inspector = () => React.createElement("Inspector", { owner: useWindowId() });
  const windows = track(createWindowsNavigator({ inspector: { id: "inspector", component: Inspector, menus: () => [] }, inspectorPanel: { component: Inspector } }));
  mocks.windows.set("inspector", ++mocks.token);
  const lookup = deferred<{ id: string; focused: boolean }>();
  mocks.getWindow.mockReturnValueOnce(lookup.promise);
  const Root = mocks.roots.get("spark.window.inspector")!();
  await mount(React.createElement(StrictMode, null, React.createElement(Root)));
  expect(rendered.root.findByType("Inspector").props.owner).toBe("inspector");
  const opened = windows.openInstance("inspector");
  await tick(); expect(mocks.openWindow).not.toHaveBeenCalled();
  lookup.resolve({ id: "inspector", focused: true });
  const instance = await opened;
  expect(mocks.openWindow).not.toHaveBeenCalled(); expect(mocks.getWindow).toHaveBeenCalledTimes(1);
  expect(windows.list()).toEqual([instance]); expect(windows.getKeyWindowId()).toBe("inspector");
  expect(mocks.showWindow).toHaveBeenCalledWith("inspector", { focus: true });
  // A restarted root whose native window is gone is dropped.
  const PanelRoot = mocks.roots.get("spark.window.inspectorPanel")!();
  await act(async () => { rendered.update(React.createElement(PanelRoot, { props: {}, sparkWindow: { id: "inspector-gone" } })); });
  await act(tick); expect(mocks.getWindow).toHaveBeenCalledWith("inspector-gone"); expect(windows.get("inspector-gone")).toBeUndefined();
});

test("isolated runtimes are reserved before opening and destroyed only after their last window, across navigators", async () => {
  const destroy = vi.fn(async (_name: string) => {});
  const Threaded = (props: object) => React.createElement("Threaded", props);
  const Panel = Object.assign(() => null, { __threadedRuntime: { name: "panel" } });
  const module = { Threaded, ThreadedRuntime: { destroy } } as never;
  const windows = track(createWindowsNavigator({ isoPanel: { component: Panel, runtime: { isolated: "plugins", module } } }));
  const others = track(createWindowsNavigator({ isoOther: { component: Panel, runtime: { isolated: "plugins", module } } }));
  mocks.viewManagers.clear();
  await expect(windows.openInstance("isoPanel")).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
  expect(mocks.openWindow).not.toHaveBeenCalled();
  mocks.viewManagers.add("ThreadedRuntimeSurface");
  const first = await windows.openInstance("isoPanel", { props: { label: "x" } });
  expect(first.runtime).toBe("isolated");
  await mount(React.createElement(mocks.roots.get("spark.window.isoPanel")!(), rootProps(0)));
  expect(rendered.root.findByType("Threaded").props).toMatchObject({ component: Panel, props: { label: "x" }, runtimeName: "plugins", surfaceKey: first.id });
  // An open still in flight holds the runtime while the last open window closes.
  const native = deferred<{ id: string }>();
  mocks.openWindow.mockImplementationOnce(async (options: { id: string }) => { await native.promise; mocks.windows.set(options.id, ++mocks.token); return { id: options.id }; });
  const second = windows.openInstance("isoPanel");
  await tick(); await first.close(); await tick();
  expect(destroy).not.toHaveBeenCalled();
  native.resolve({ id: "" }); const opened = await second;
  // Another navigator's window on the same runtime also holds it.
  const other = await others.openInstance("isoOther");
  await opened.close(); await tick(); expect(destroy).not.toHaveBeenCalled();
  // A destroy in flight completes before the runtime is used again.
  const destroyed = deferred<void>(); destroy.mockReturnValueOnce(destroyed.promise);
  await other.close(); await tick(); expect(destroy).toHaveBeenCalledWith("plugins");
  const reopening = windows.openInstance("isoPanel");
  await tick(); expect(mocks.openWindow).toHaveBeenCalledTimes(3);
  destroyed.resolve(); await reopening; expect(mocks.openWindow).toHaveBeenCalledTimes(4);
  expect(() => createWindowsNavigator({ isoBad: { component: () => null, runtime: { isolated: "x", module } } })).toThrow(/threadedComponent/);
});

test("the menu bar follows the key window, routes actions to the published window and coalesces updates", async () => {
  const onMenuAction = vi.fn(), onError = vi.fn();
  const windows = track(createWindowsNavigator({ menuNote: {
    component: () => null, undoMenu: true, onMenuAction,
    menus: instance => [{ type: "submenu", id: "note", label: "Note", items: [{ type: "action", id: "info", label: `Info ${instance.id}` }] }],
  } }, { onError }));
  const a = await windows.openInstance("menuNote"), b = await windows.openInstance("menuNote");
  expect(mocks.createMenu).toHaveBeenCalledTimes(1); expect(mocks.createMenu.mock.calls[0][0]).toMatchObject({ id: expect.stringMatching(/^spark-windows-/), items: [] });
  const published = () => mocks.menu.update.mock.calls.at(-1)![0].items;
  focus(a.id, true); await tick();
  expect(windows.getKeyWindowId()).toBe(a.id);
  expect(published()[0].items[0].label).toBe(`Info ${a.id}`);
  expect(published()[1]).toMatchObject({ id: "spark-windows-edit", target: { menu: "edit" }, items: [{ id: "spark-windows-undo", label: "Undo", disabled: true, target: { role: "undo" } }, { id: "spark-windows-redo", target: { role: "redo" } }] });
  mocks.menu.update.mockClear();
  let value = 0;
  for (let n = 0; n < 5; n++) a.undo.push({ label: "Typing", undo: () => value--, redo: () => value++ });
  await tick();
  expect(mocks.menu.update).toHaveBeenCalledTimes(1);
  expect(published()[1].items[0]).toMatchObject({ label: "Undo Typing", disabled: false });
  focus(a.id, false); focus(b.id, true); await tick();
  expect(published()[0].items[0].label).toBe(`Info ${b.id}`); expect(published()[1].items[0].disabled).toBe(true);
  mocks.menuAction!({ type: "action", itemId: "info" }); await tick();
  expect(onMenuAction).toHaveBeenCalledWith({ type: "action", itemId: "info" }, b);
  focus(b.id, false); focus(a.id, true); await tick();
  mocks.menuAction!({ type: "action", itemId: "spark-windows-undo" }); expect(value).toBe(-1);
  focus(a.id, false); await tick(); expect(published()).toEqual([]); expect(windows.getKeyWindowId()).toBeNull();
  onMenuAction.mockImplementationOnce(() => { throw new Error("handler"); });
  focus(b.id, true); await tick(); mocks.menuAction!({ type: "action", itemId: "info" });
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ windowId: b.id, name: "menuNote", phase: "menu" }));
  mocks.platform.OS = "windows"; focus(b.id, false); focus(a.id, true); await tick();
  expect(published()[1].items[0]).toMatchObject({ shortcut: "CmdOrCtrl+Z" }); expect(published()[1].items[0].target).toBeUndefined();
});

test("hotkeys register in each window's scope, report handler failures and are removed with the window", async () => {
  const removed = vi.fn(async () => {}), register = vi.fn(async (_options: any) => ({ remove: removed, setEnabled: vi.fn() }));
  const onError = vi.fn(), star = vi.fn(() => { throw new Error("boom"); });
  const windows = track(createWindowsNavigator({ keyNote: { component: () => null, hotkeys: { definitions: [{ id: "star", title: "Star", defaultBindings: ["CmdOrCtrl+J"] }], handlers: () => ({ star }) } } }, { hotkeys: { register } as never, onError }));
  const note = await windows.openInstance("keyNote");
  expect(register.mock.calls[0][0]).toMatchObject({ scope: { kind: "window", windowId: note.id }, definitions: [{ id: "star" }] });
  register.mock.calls[0][0].handlers.star({}); expect(onError).toHaveBeenCalledWith(expect.objectContaining({ phase: "hotkey", windowId: note.id }));
  nativeClose(note.id)(); await tick(); expect(removed).toHaveBeenCalledTimes(1);
  expect(() => createWindowsNavigator({ keyless: { component: () => null, hotkeys: { definitions: [], handlers: () => ({}) } } })).toThrow(/hotkey router/);
});

test("setup failures close the native window and reject with the original error", async () => {
  const error = failure("E_UNSUPPORTED_PLATFORM");
  const windows = track(createWindowsNavigator({ failingNote: { component: () => null, hotkeys: { definitions: [], handlers: () => ({}) } } }, { hotkeys: { register: async () => { throw error; } } as never }));
  await expect(windows.openInstance("failingNote")).rejects.toBe(error);
  expect(mocks.closeWindow).toHaveBeenCalledTimes(1); expect(mocks.showWindow).not.toHaveBeenCalled(); expect(windows.list()).toEqual([]);
  // A window closed before its services are installed rejects E_CLOSED and leaves nothing behind.
  const plain = track(createWindowsNavigator({ vanishing: { component: () => null } }));
  mocks.openWindow.mockImplementationOnce(async (options: { id: string }) => ({ id: options.id }));
  await expect(plain.openInstance("vanishing")).rejects.toMatchObject({ code: "E_CLOSED" });
  expect(plain.list()).toEqual([]);
});

test("macOS toolbars come from the entry, refresh per window, route events, and are skipped on Windows", async () => {
  const onToolbarEvent = vi.fn(); let label = "One";
  const windows = track(createWindowsNavigator({ barNote: { component: () => null, macos: {
    toolbar: () => ({ items: [{ type: "button", id: "label", label }] }),
    onToolbarEvent,
  } } }));
  const note = await windows.openInstance("barNote", { options: { macos: { titleBar: { transparent: true } } } });
  expect(mocks.openWindow.mock.calls[0][0].macos).toMatchObject({ titleBar: { transparent: true }, toolbar: { items: [{ label: "One" }] } });
  label = "Two"; await note.refreshToolbar();
  expect(mocks.setWindowOptions).toHaveBeenCalledWith(note.id, { macos: { toolbar: { items: [expect.objectContaining({ label: "Two" })] } } });
  mocks.toolbar.get(note.id)!({ type: "toolbarAction", windowId: note.id, itemId: "label" });
  expect(onToolbarEvent).toHaveBeenCalledWith(expect.objectContaining({ itemId: "label" }), note);
  mocks.platform.OS = "windows"; mocks.setWindowOptions.mockClear(); mocks.addMacOSWindowListener.mockClear();
  const other = await windows.openInstance("barNote");
  expect(mocks.openWindow.mock.calls[1][0].macos).toBeUndefined(); expect(mocks.addMacOSWindowListener).not.toHaveBeenCalled();
  await other.refreshToolbar(); expect(mocks.setWindowOptions).not.toHaveBeenCalled();
});

test("a render error replaces only that window's content, reports it and can be retried or closed", async () => {
  let fail = true; const onError = vi.fn();
  function Fragile() { if (fail) throw new Error("render failed"); return React.createElement("Healthy"); }
  const windows = track(createWindowsNavigator({ fragile: { component: Fragile }, sturdy: { component: () => React.createElement("Sturdy") } }, { onError }));
  const broken = await windows.openInstance("fragile"), fine = await windows.openInstance("sturdy");
  const view = (name: string, call: number) => React.createElement(mocks.roots.get(`spark.window.${name}`)!(), rootProps(call));
  await mount(React.createElement("App", null, view("fragile", 0), view("sturdy", 1)));
  expect(rendered.root.findByProps({ testID: "spark-window-error" })).toBeTruthy();
  expect(rendered.root.findAllByType("Sturdy")).toHaveLength(1);
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ windowId: broken.id, name: "fragile", phase: "render", error: expect.objectContaining({ message: "render failed" }) }));
  fail = false;
  await act(async () => rendered.root.findByProps({ testID: "spark-window-error-retry" }).props.onPress());
  expect(rendered.root.findAllByType("Healthy")).toHaveLength(1); expect(fine.isOpen()).toBe(true);
  fail = true;
  const Fallback = ({ windowId, close }: { windowId: string; close(): void }) => React.createElement("Custom", { windowId, close });
  const custom = track(createWindowsNavigator({ customFallback: { component: Fragile } }, { errorFallback: Fallback, onError }));
  const crashed = await custom.openInstance("customFallback");
  await act(async () => { rendered.update(view("customFallback", 2)); });
  await act(async () => rendered.root.findByType("Custom").props.close());
  expect(mocks.closeWindow).toHaveBeenCalledWith(crashed.id); expect(crashed.isOpen()).toBe(false);
});

test("loaders run before native creation, retry after failure, and restarted roots wait for them", async () => {
  const Editor = memo(({ documentId }: { documentId: string }) => React.createElement("Editor", { documentId, owner: useWindowId() }));
  const gate = deferred<{ default: typeof Editor }>();
  const load = vi.fn(() => gate.promise).mockRejectedValueOnce(Error("load failed"));
  const windows = track(createWindowsNavigator({ lazyEditor: { id: "lazy-editor", loadComponent: load } }));
  await expect(windows.openInstance("lazyEditor", { props: { documentId: "first" } })).rejects.toThrow("load failed");
  expect(mocks.openWindow).not.toHaveBeenCalled(); expect(windows.list()).toEqual([]);
  // A root restarted after a reload renders nothing until the component loads.
  mocks.windows.set("lazy-editor", ++mocks.token);
  const Root = mocks.roots.get("spark.window.lazy-editor")!();
  await mount(React.createElement(StrictMode, null, React.createElement(Root, { documentId: "restored" })));
  expect(rendered.toJSON()).toBeNull();
  await act(async () => { gate.resolve({ default: Editor }); await tick(); });
  expect(rendered.root.findByType("Editor").props).toMatchObject({ owner: "lazy-editor", documentId: "restored" });
  expect(load).toHaveBeenCalledTimes(2); expect(windows.get("lazy-editor")?.id).toBe("lazy-editor");
  if (false) {
    // @ts-expect-error Required component props cannot be omitted.
    void windows.openInstance("lazyEditor");
    // @ts-expect-error Props remain inferred through the loader.
    void windows.openInstance("lazyEditor", { props: { documentId: 1 } });
  }
});

test("window state scopes values per window instance, promotes without copying and attaches other windows", async () => {
  const state = createWindowState<{ count: number }>({ initial: () => ({ count: 0 }) });
  const windows = track(createWindowsNavigator({ scoped: { component: () => null } }));
  const a = await windows.openInstance("scoped"), b = await windows.openInstance("scoped");
  const first = state.get(a), second = state.get(b);
  first.count.set(3); expect(second.count.get()).toBe(0); expect(state.get(a)).toBe(first);
  const changes = vi.fn(); state.subscribe(a, changes);
  expect(state.promote(a, "doc")).toBe(first); expect(state.getBinding(a)).toBe("doc"); expect(changes).toHaveBeenCalledTimes(1);
  expect(state.attach(b, "doc")).toBe(first); expect(state.get(b).count.get()).toBe(3);
  expect(() => state.promote(b, "other")).toThrow(expect.objectContaining({ code: "E_BUSY" }));
  expect(() => state.release("doc")).toThrow(expect.objectContaining({ code: "E_BUSY" }));
  await a.close(); await b.close(); await tick();
  for (const call of [() => state.get(a), () => state.getBinding(a), () => state.attach(a, "doc"), () => state.subscribe(a, () => {})]) expect(call).toThrow(expect.objectContaining({ code: "E_CLOSED" }));
  expect(state.getShared("doc")).toBe(first);
  state.release("doc"); expect(state.getShared("doc")).toBeUndefined();
  const c = await windows.openInstance("scoped");
  expect(() => state.attach(c, "doc")).toThrow(expect.objectContaining({ code: "E_NOT_FOUND" }));
  expect(() => state.get({ id: "x" } as WindowInstance)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  state.share("x", { count: 9 }); expect(() => state.share("x", { count: 1 })).toThrow(expect.objectContaining({ code: "E_ALREADY_EXISTS" }));
  state.remove(); expect(() => state.get(c)).toThrow(expect.objectContaining({ code: "E_CLOSED" }));
});

test("hooks observe the window instance, its undo stack and its state binding", async () => {
  const state = createWindowState<{ n: number }>({ initial: () => ({ n: 1 }) });
  let instance!: WindowInstance; let renders = 0;
  function Probe() {
    instance = useWindowInstance();
    const undo = useUndoState(), value$ = useWindowState(state);
    renders++;
    return React.createElement("Probe", { canUndo: undo.canUndo, n: value$.n.peek() });
  }
  const windows = track(createWindowsNavigator({ hooked: { component: Probe } }));
  const opened = await windows.openInstance("hooked");
  await mount(React.createElement(mocks.roots.get("spark.window.hooked")!(), rootProps(0)));
  expect(instance).toBe(opened);
  const probe = () => rendered.root.findByType("Probe").props;
  expect(probe()).toEqual({ canUndo: false, n: 1 });
  await act(async () => instance.undo.push({ undo() {}, redo() {} })); expect(probe().canUndo).toBe(true);
  state.share("shared", { n: 7 }); const before = renders;
  await act(async () => { state.attach(instance, "shared"); }); expect(probe().n).toBe(7); expect(renders).toBeGreaterThan(before);
  await expect(act(async () => { rendered.update(React.createElement(Probe)); })).rejects.toMatchObject({ code: "E_UNAVAILABLE" });
  rendered = undefined;
});

test("registration validates entries before registering roots, and a removed navigator stops answering", async () => {
  const size = mocks.roots.size, Component = () => null;
  expect(() => createWindowsNavigator({ "bad name": { component: Component } })).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  expect(() => createWindowsNavigator({ valid: { component: Component, extra: true } as never })).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_OPTION" }));
  expect(() => createWindowsNavigator({ valid: { component: Component, options: { id: "x" } as never } })).toThrow(/identity/);
  expect(() => createWindowsNavigator({ valid: { id: "main", component: Component } })).toThrow(expect.objectContaining({ code: "E_ALREADY_EXISTS" }));
  expect(() => createWindowsNavigator({ valid: { component: "nope" as never } })).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  expect(() => createWindowsNavigator({ valid: { component: Component, loadComponent: async () => Component } as never })).toThrow(/exactly one/);
  expect(mocks.roots.size).toBe(size);
  const windows = createWindowsNavigator({ dupe: { id: "dupe-window", component: Component } });
  // Root modules are unique: an entry name without id, or an id, registers once; names alone may repeat across navigators.
  track(createWindowsNavigator({ named: { component: Component } }));
  expect(() => createWindowsNavigator({ named: { component: Component } })).toThrow(expect.objectContaining({ code: "E_ALREADY_EXISTS" }));
  track(createWindowsNavigator({ dupe: { id: "dupe-elsewhere", component: Component } }));
  expect(() => createWindowsNavigator({ other: { id: "dupe-window", component: Component } })).toThrow(expect.objectContaining({ code: "E_ALREADY_EXISTS" }));
  await expect((windows.openInstance as (name: string) => Promise<unknown>)("missing")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  await expect(windows.openInstance("dupe", { options: { component: "x" } } as never)).rejects.toThrow(/identity/);
  expect(mocks.openWindow).not.toHaveBeenCalled();
  const open = await windows.openInstance("dupe");
  await windows.remove();
  await expect(windows.openInstance("dupe")).rejects.toMatchObject({ code: "E_CLOSED" });
  for (const call of [() => windows.get(open.id), () => windows.list(), () => windows.getKeyWindowId()]) expect(call).toThrow(expect.objectContaining({ code: "E_CLOSED" }));
  expect(open.isOpen()).toBe(false); expect(mocks.closeWindow).not.toHaveBeenCalled();
  track(createWindowsNavigator({ dupe: { id: "dupe-window-2", component: Component } }));
});

// The navigator's existing contract, as consumed by LegendApp/legend-apps (music, markdown, code, diff).
test("compat: open resolves WindowInfo, rejects E_ALREADY_EXISTS while open, and close/show/getId/prefetch keep their contract", async () => {
  const Settings = ({ section }: { section?: string }) => React.createElement("Settings", { section, owner: useWindowId() });
  const load = vi.fn(async () => ({ default: Settings }));
  const config = {
    SettingsWindow: { id: "compat-settings", loadComponent: load, options: { title: "Settings", size: { width: 500, height: 400 } } },
    Viewer: { id: "compat-viewer", component: (_: { path: string }) => null },
  } satisfies WindowsConfig;
  const navigator = track(createWindowsNavigator(config));
  expect(navigator.getId("SettingsWindow")).toBe("compat-settings");
  await navigator.prefetch("SettingsWindow"); expect(load).toHaveBeenCalledTimes(1);
  mocks.openWindow.mockImplementation(async (options: { id: string; title?: string }) => {
    if (mocks.windows.has(options.id)) throw failure("E_ALREADY_EXISTS");
    mocks.windows.set(options.id, ++mocks.token); return { id: options.id, title: options.title ?? "" };
  });
  const info: WindowInfo = await navigator.open("SettingsWindow", { props: { section: "general" }, options: { title: "Preferences" } });
  expect(info).toEqual({ id: "compat-settings", title: "Preferences" });
  expect(mocks.openWindow.mock.calls[0][0]).toEqual({ title: "Preferences", size: { width: 500, height: 400 }, id: "compat-settings", component: "spark.window.compat-settings", props: { section: "general" } });
  expect(mocks.showWindow).not.toHaveBeenCalled();
  // Root props are the component's props, and the root owns its window ID.
  await mount(React.createElement(mocks.roots.get("spark.window.compat-settings")!(), { section: "general", windowId: "wrong" }));
  expect(rendered.root.findByType("Settings").props).toEqual({ section: "general", owner: "compat-settings" });
  // legend-apps' openOrShowWindow: open, and on E_ALREADY_EXISTS show the existing window.
  const openOrShowWindow = (id: string, open: () => Promise<WindowInfo>) => open().catch(async (error: { code?: string }) => {
    if (error.code !== "E_ALREADY_EXISTS") throw error;
    await mocks.showWindow(id); return mocks.getWindow(id) as Promise<WindowInfo>;
  });
  await expect(navigator.open("SettingsWindow")).rejects.toMatchObject({ code: "E_ALREADY_EXISTS" });
  expect(await openOrShowWindow(navigator.getId("SettingsWindow"), () => navigator.open("SettingsWindow"))).toMatchObject({ id: "compat-settings" });
  expect(mocks.openWindow).toHaveBeenCalledTimes(1);
  await navigator.show("SettingsWindow"); expect(mocks.showWindow).toHaveBeenLastCalledWith("compat-settings");
  expect(await navigator.close("SettingsWindow")).toEqual({ closed: true });
  expect((await navigator.open("SettingsWindow")).id).toBe("compat-settings");
  // A window closed natively whose event has not arrived yet does not block reopening.
  nativeClose("compat-settings");
  expect((await navigator.open("SettingsWindow")).id).toBe("compat-settings");
  await expect(navigator.close("Viewer")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  await navigator.open("Viewer", { props: { path: "/a" } });
  expect(mocks.openWindow.mock.calls.at(-1)![0].props).toEqual({ path: "/a" });
  if (false) {
    // @ts-expect-error Required component props cannot be omitted.
    void navigator.open("Viewer");
    // @ts-expect-error Props are inferred through the loader.
    void navigator.open("SettingsWindow", { props: { section: 1 } });
    // @ts-expect-error Identity cannot be overridden at open time.
    void navigator.open("SettingsWindow", { options: { id: "other" } });
    const typed: WindowConfigEntry<{ path: string }> = { id: "typed", component: (_: { path: string }) => null };
    // @ts-expect-error A typed entry checks its component's props.
    const mistyped: WindowConfigEntry<{ path: string }> = { id: "typed", component: (_: { path: number }) => null };
    const options: NavigatorWindowOptions = { title: "x" };
    void [typed, mistyped, options];
  }
});

test("compat: identity overrides and failed loaders reject before native creation; entries without id have no getId", async () => {
  const loadComponent = vi.fn(async () => () => null).mockRejectedValueOnce(Error("load failed"));
  const navigator = track(createWindowsNavigator({ editor: { id: "compat-editor", loadComponent }, many: { component: () => null } }));
  await expect(navigator.open("editor", { options: { id: "other" } } as never)).rejects.toThrow(/identity/i);
  expect(loadComponent).not.toHaveBeenCalled();
  await expect(navigator.open("editor")).rejects.toThrow("load failed");
  expect(mocks.openWindow).not.toHaveBeenCalled();
  await navigator.open("editor"); expect(loadComponent).toHaveBeenCalledTimes(2);
  expect(() => navigator.getId("many")).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  await expect(navigator.close("many")).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  const one = await navigator.open("many"), two = await navigator.open("many");
  expect(one.id).not.toBe(two.id);
});
