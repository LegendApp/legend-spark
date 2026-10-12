import { AppRegistry, NativeModules, Platform, UIManager } from "react-native";
import { SparkError, asyncRegistration, nativeError, type AsyncRegistration, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import type { Menu, MenuAction, MenuRootItem } from "@legendapp/spark-native-menu";
import type { RoutedHotkeyHandlers } from "@legendapp/spark-commands/src/router";
import { addWindowListener, centerWindow, closeWindow, getDisplays, getWindow, getWindowAvailability, handleWindowNewTab, listWindowTabGroups, openWindow, selectWindowTab, setWindowBounds, setWindowOptions, showWindow, windowPoolCommand } from "../api";
import { addMacOSWindowListener } from "../macos";
import { addTitleListener } from "../title-changes";
import type { CloseResult, DisplayInfo, WindowBounds, WindowInfo, WindowOpenOptions } from "../types";
import { APPEARANCE_OPTIONS, bounds as validBounds, keys, object, validateOptions, windowId as validWindowId } from "../validation";
import { instanceRecord, jsonCopy, registerInstance, restorableStates, windowStates, type InstanceRecord } from "./instances";
import { createWindowPools, generatedId, validatePerformance } from "./pool";
import { DefaultErrorFallback, createWindowRoot, type RootContent, type RootHost, type ThrottleStore, type WindowRootProps } from "./root";
import { createUndoStack } from "./undo";
import type { DuplicateWindowOptions, IsolatedRuntime, NavigatorWindowOptions, NewWindowTab, NewWindowTabRequest, SavedWindow, UndoMenuLabels, WindowComponentProps, WindowConfigEntry, WindowErrorEvent, WindowInstance, WindowPoolState, WindowSession, WindowSessionFeature, WindowsConfig, WindowsNavigatorOptions } from "./types";

export type NavigatorOpenOptions<P> = { props: P; options?: NavigatorWindowOptions };
type OpenArguments<P> = {} extends P ? [options?: { props?: P; options?: NavigatorWindowOptions }] : [options: NavigatorOpenOptions<P>];
/**
 * Application-lifetime registry of named windows. `remove()` stops its listeners and menus;
 * it does not close windows.
 */
export interface WindowsNavigator<T extends WindowsConfig> extends AsyncRegistration {
  /** Opens a window and resolves its native info. Rejects E_ALREADY_EXISTS while an `id` entry's window is open. */
  open<K extends keyof T>(name: K, ...args: OpenArguments<WindowComponentProps<T[K]>>): Promise<WindowInfo>;
  /** Opens a window and resolves its handle; for an `id` entry with a live window, shows and focuses it instead. */
  openInstance<K extends keyof T>(name: K, ...args: OpenArguments<WindowComponentProps<T[K]>>): Promise<WindowInstance>;
  /** Closes an `id` entry's window. */
  close(name: keyof T): Promise<CloseResult>;
  /** Shows and focuses an `id` entry's window. */
  show(name: keyof T): Promise<void>;
  /** The window ID of an `id` entry. */
  getId(name: keyof T): string;
  prefetch(name: keyof T): Promise<void>;
  /** The open window with this ID, if this navigator owns it. */
  get(windowId: string): WindowInstance | undefined;
  /** Open windows in opening order, optionally for one entry. */
  list(name?: keyof T): WindowInstance[];
  /** This navigator's window that is currently key, or null. */
  getKeyWindowId(): string | null;
  /** Notifies when windows open or close, or the key window changes. */
  subscribe(listener: () => void): { remove(): void };
  /**
   * A JSON snapshot of the open windows, in opening order: entry, ID, props, title, visibility, frame,
   * restorable window state (`createWindowState` with `restorationKey`), macOS tab groups and the key
   * window. Rejects `E_INVALID_DATA` when a restorable value is not JSON.
   */
  getSession(): Promise<WindowSession>;
  /**
   * Opens a saved session's windows with their IDs, props, titles, frames and restorable state, rejoins
   * their tab groups and selected tabs, and focuses the saved key window. A frame on a display that is
   * no longer connected moves to the primary display, fitted into its work area. Validates the whole
   * session first: unknown entries, malformed data and IDs that are already open reject before any
   * window opens. If a window then fails to open, the windows it already opened are closed and it
   * rejects with that failure. Resolves the windows in the session's order.
   */
  restoreSession(session: WindowSession): Promise<WindowInstance[]>;
  /**
   * New Window: opens another window of the source's entry with its props and title, cascaded from its
   * frame. Its window states start attached to the source's app-scoped values and with copies of its
   * restorable private values; `detached` copies attached restorable values too, so nothing is shared.
   * Singleton (`id`) entries reject `E_INVALID_ARGUMENT`.
   */
  duplicate(source: WindowInstance, options?: DuplicateWindowOptions): Promise<WindowInstance>;
  /**
   * Notifies when the session may have changed: a window opened, closed, moved, resized, was shown,
   * hidden, retitled or retabbed, the key window changed, or a restorable value changed. Changes
   * coalesce on a 250 ms trailing timer; a closing window notifies at once. Save `getSession()`
   * from here to survive a crash, and from `beforeQuit`. Native observation runs only while a listener exists.
   */
  subscribeToSession(listener: () => void): { remove(): void };
  /**
   * Starts a `pool` entry's window pool and creates warm windows up to `count` (default `pool.prewarm`) within its
   * limits, one at a time. From then on its windows park on close and become warm again, and opens use warm windows.
   * Resolves the pool's state; rejects `E_MODULE_UNAVAILABLE` without @legendapp/spark-system.
   */
  prewarm(name: keyof T, count?: number): Promise<WindowPoolState>;
  /** A `pool` entry's warm windows, limits, measured cost and counters. */
  getPool(name: keyof T): WindowPoolState;
  /** Closes the warm windows of one `pool` entry, or all, for real, and stops refilling until the next `prewarm`. */
  trimPool(name?: keyof T): Promise<void>;
}

interface WindowRecord extends InstanceRecord {
  instance: WindowInstance;
  entry: WindowConfigEntry;
  /** The props the window opened with (root props after a reload). */
  props: Record<string, unknown> | undefined;
  /** Native window confirmed, per-window services installed, not yet closed. */
  open: boolean;
  disposed: boolean;
  /** Native open or post-reload adoption in flight; singleton opens wait for it. */
  pending?: Promise<void>;
  /** The isolated runtime this window holds a use of. */
  runtime?: IsolatedRuntime;
  registrations: AsyncRegistration[];
  subscriptions: { remove(): void }[];
  /** Frame and tab listeners, installed while `subscribeToSession` has listeners. */
  observing?: Promise<AsyncRegistration[]>;
  /** A pooled window's use, matched by its root. */
  use?: number;
  /** Resolves when the content first commits. */
  committed?: () => void;
  /** Background render throttling: hidden or minimized, and fully covered. */
  hidden: boolean;
  occluded: boolean;
  throttle?: ThrottleStore & { notify(): void };
}

const namePattern = /^[a-zA-Z0-9_-]{1,48}$/;
const entryKeys = ["id", "component", "loadComponent", "options", "runtime", "undoMenu", "menus", "onMenuAction", "hotkeys", "newTab", "macos", "pool", "throttle"];
const UNDO_ID = "spark-windows-undo", REDO_ID = "spark-windows-redo", EDIT_ID = "spark-windows-edit";
const defaultUndoLabels: UndoMenuLabels = { edit: "Edit", undo: label => label ? `Undo ${label}` : "Undo", redo: label => label ? `Redo ${label}` : "Redo" };
/** Registered root module names: `spark.window.<id>` for `id` entries, `spark.window.<name>` otherwise. */
const reservedModules = new Set<string>();
// Isolated runtimes are counted across navigators: one is destroyed only when no window, or window
// being opened, of any navigator uses it.
const runtimeUsers = new Map<string, number>(), runtimeDestroys = new Map<string, Promise<void>>();
let navigators = 0, uses = 0;
/** How long a taken warm window's content may take to render before the open fails. */
const COMMIT_TIMEOUT_MS = 10000;

function isComponent(value: unknown) {
  return typeof value === "function" || (!!value && typeof value === "object" && [Symbol.for("react.memo"), Symbol.for("react.forward_ref"), Symbol.for("react.lazy")].includes((value as { $$typeof?: symbol }).$$typeof!));
}
function fn(value: unknown, name: string) {
  if (value !== undefined && typeof value !== "function") throw new SparkError("E_INVALID_ARGUMENT", `${name} must be a function`);
}
function isolated(entry: WindowConfigEntry): IsolatedRuntime | undefined {
  return entry.runtime && entry.runtime !== "shared" ? entry.runtime : undefined;
}
function noIdentity(options: object | undefined, name: string) {
  if (options === undefined) return;
  object(options, name);
  for (const key of ["id", "component", "props"]) if (key in options) throw new SparkError("E_INVALID_ARGUMENT", "Navigator identity and props cannot be overridden in options");
}

/** Isolated windows need the Runtimes native module and its threaded surface view. Loads no Runtimes JavaScript. */
export function getIsolatedRuntimeAvailability(): Availability {
  const windows = getWindowAvailability();
  if (!windows.available) return windows;
  const surface = (UIManager as { hasViewManagerConfig?: (name: string) => boolean }).hasViewManagerConfig?.("ThreadedRuntimeSurface") === true;
  return NativeModules.ThreadedRuntime && surface ? { available: true } : { available: false, reason: "missing-module" };
}

/**
 * Sessions work wherever windows do. `tabs` (tab groups in sessions, `duplicate` with `tab`) needs
 * native window tabs: macOS only for now; Windows rejects them `E_UNSUPPORTED_OPTION`.
 */
export function getWindowSessionAvailability(feature?: WindowSessionFeature): Availability {
  if (feature !== undefined && feature !== "tabs") throw new SparkError("E_INVALID_ARGUMENT", "Unknown window session feature");
  return getWindowAvailability(feature === "tabs" ? "tabbing" : undefined);
}
const tabsSupported = () => getWindowAvailability("tabbing").available;

/** The saved display, else the primary display with the frame fitted into its work area. */
function placement(saved: SavedWindow["bounds"], displays: DisplayInfo[]): WindowBounds {
  const display = displays.find(item => saved.persistentDisplayId !== null ? item.persistentId === saved.persistentDisplayId : item.id === saved.displayId);
  if (display) return { displayId: display.id, x: saved.x, y: saved.y, width: saved.width, height: saved.height };
  return fit(saved, displays.find(item => item.primary)!);
}
function fit(frame: Omit<WindowBounds, "displayId">, display: DisplayInfo): WindowBounds {
  const area = display.workArea, width = Math.min(frame.width, area.width), height = Math.min(frame.height, area.height);
  const clamp = (value: number, min: number, size: number, extent: number) => Math.min(Math.max(value, min), min + extent - size);
  return { displayId: display.id, x: clamp(frame.x, area.x, width, area.width), y: clamp(frame.y, area.y, height, area.height), width, height };
}
/** How long session changes settle before `subscribeToSession` listeners run. */
const SESSION_DELAY_MS = 250;
/** macOS New Window cascades by about a title bar. */
const CASCADE = 24;

const moduleName = (name: string, entry: WindowConfigEntry) => `spark.window.${entry.id ?? name}`;
function validateEntry(name: string, entry: WindowConfigEntry, options: WindowsNavigatorOptions, modules: Set<string>) {
  if (!namePattern.test(name)) throw new SparkError("E_INVALID_ARGUMENT", `Window names require 1–48 letters, numbers, underscores or hyphens: ${name}`);
  object(entry, "window registration"); keys(entry, entryKeys);
  if (entry.id !== undefined) validWindowId(entry.id);
  const module = moduleName(name, entry);
  if (entry.id === "main" || modules.has(module) || reservedModules.has(module)) throw new SparkError("E_ALREADY_EXISTS", "Window ID or name is already registered or reserved");
  modules.add(module);
  if ((entry.component !== undefined) === (entry.loadComponent !== undefined) || (entry.component !== undefined && !isComponent(entry.component)) || (entry.loadComponent !== undefined && typeof entry.loadComponent !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Register exactly one component or loadComponent");
  noIdentity(entry.options, "registration options");
  if (entry.options) validateOptions({ ...entry.options, id: "registration", component: "registration" } as WindowOpenOptions, Platform.OS, true);
  const runtime = entry.runtime;
  if (runtime !== undefined && runtime !== "shared") {
    object(runtime, "runtime"); keys(runtime, ["isolated", "module"]);
    if (!namePattern.test(runtime.isolated)) throw new SparkError("E_INVALID_ARGUMENT", `${name}: isolated runtime names require 1–48 letters, numbers, underscores or hyphens`);
    if (!runtime.module || !isComponent(runtime.module.Threaded) || typeof runtime.module.ThreadedRuntime?.destroy !== "function") throw new SparkError("E_INVALID_ARGUMENT", `${name}: pass the @react-native-runtimes/core module as runtime.module`);
    if (typeof (entry.component as { __threadedRuntime?: { name?: unknown } } | undefined)?.__threadedRuntime?.name !== "string") throw new SparkError("E_INVALID_ARGUMENT", `${name}: isolated windows render a threadedComponent(...) component`);
  }
  if (entry.undoMenu !== undefined && typeof entry.undoMenu !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "undoMenu must be boolean");
  fn(entry.menus, "menus"); fn(entry.onMenuAction, "onMenuAction"); fn(entry.newTab, "newTab");
  if (entry.newTab && Platform.OS !== "macos") throw new SparkError("E_UNSUPPORTED_OPTION", `${Platform.OS === "windows" ? "Windows" : Platform.OS} does not support newTab yet`);
  if (entry.hotkeys !== undefined) {
    object(entry.hotkeys, "hotkeys"); keys(entry.hotkeys, ["definitions", "handlers"]);
    if (!Array.isArray(entry.hotkeys.definitions) || typeof entry.hotkeys.handlers !== "function") throw new SparkError("E_INVALID_ARGUMENT", "hotkeys need definitions and a handlers(instance) function");
    if (!options.hotkeys) throw new SparkError("E_INVALID_ARGUMENT", `${name} declares hotkeys; pass the app's hotkey router as options.hotkeys`);
  }
  if (entry.macos !== undefined) {
    object(entry.macos, "macos"); keys(entry.macos, ["toolbar", "onToolbarEvent"]);
    fn(entry.macos.toolbar, "macos.toolbar"); fn(entry.macos.onToolbarEvent, "macos.onToolbarEvent");
  }
  validatePerformance(name, entry);
}
type RootComponent = Awaited<ReturnType<RootContent["load"]>>;
function contentOf(entry: WindowConfigEntry): RootContent {
  let resolved = entry.component as RootComponent | undefined;
  let pending: Promise<RootComponent> | undefined;
  return {
    runtime: isolated(entry),
    throttle: entry.throttle === true,
    resolved: () => resolved,
    async load() {
      if (resolved) return resolved;
      pending ??= Promise.resolve().then(() => entry.loadComponent!()).then(value => {
        const result = value && typeof value === "object" && "default" in value ? value.default : value;
        if (!isComponent(result)) throw new SparkError("E_INVALID_DATA", "Window loader did not return a React component");
        return resolved = result as RootComponent;
      }).catch(cause => { pending = undefined; throw cause; });
      return pending;
    },
  };
}

/**
 * Registers named windows. An entry with `id` is a singleton; one without opens a new window per
 * `open`. Each window gets an undo stack, menus that follow the key window, window-scoped hotkeys,
 * a macOS toolbar and an error boundary.
 */
type NewTabCheck<T extends WindowsConfig> = { [K in keyof T]: { newTab?: (instance: WindowInstance) => NewWindowTab<T> | Promise<NewWindowTab<T>> } };
export function createWindowsNavigator<const T extends WindowsConfig>(config: T & NewTabCheck<T>, options: WindowsNavigatorOptions = {}): WindowsNavigator<T> {
  object(config, "navigator configuration"); object(options, "navigator options");
  keys(options, ["hotkeys", "undoLabels", "errorFallback", "onError"]);
  const entries = Object.entries(config), modules = new Set<string>();
  for (const [name, entry] of entries) validateEntry(name, entry, options, modules);
  if (options.hotkeys !== undefined && typeof options.hotkeys?.register !== "function") throw new SparkError("E_INVALID_ARGUMENT", "options.hotkeys must be a hotkey router");
  if (options.undoLabels !== undefined && (typeof options.undoLabels?.edit !== "string" || typeof options.undoLabels.undo !== "function" || typeof options.undoLabels.redo !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "undoLabels need edit, undo(label) and redo(label)");
  if (options.errorFallback !== undefined && !isComponent(options.errorFallback)) throw new SparkError("E_INVALID_ARGUMENT", "errorFallback must be a React component");
  fn(options.onError, "onError");
  const labels = options.undoLabels ?? defaultUndoLabels;
  const usesMenus = entries.some(([, entry]) => entry.menus || entry.undoMenu);
  const menuOwnerId = `spark-windows-${++navigators}`;

  const records = new Map<string, WindowRecord>();
  const contents = new Map(entries.map(([name, entry]) => [name, contentOf(entry)]));
  const listeners = new Set<() => void>(), sessionListeners = new Set<() => void>();
  let sessionTimer: ReturnType<typeof setTimeout> | undefined;
  let keyWindowId: string | null = null, published: string | null = null, removed = false;
  let menu: Promise<Menu> | undefined, publishing: Promise<void> | undefined;

  const report = (event: WindowErrorEvent) => {
    try { (options.onError ?? console.error)(event); } catch (error) { console.error(error); }
  };
  const notify = (set: Set<() => void>) => { for (const listener of [...set]) { try { listener(); } catch (error) { console.error(error); } } };
  // Coalesced on a trailing timer: a scroll, live resize or burst of edits notifies at most every 250 ms.
  const cancelSession = () => { clearTimeout(sessionTimer); sessionTimer = undefined; };
  const flushSession = () => { cancelSession(); if (!removed && sessionListeners.size) notify(sessionListeners); };
  const sessionChanged = () => {
    if (!sessionListeners.size || sessionTimer !== undefined || removed) return;
    sessionTimer = setTimeout(flushSession, SESSION_DELAY_MS);
  };
  const emit = () => { notify(listeners); sessionChanged(); };
  const stopTitles = addTitleListener(id => { if (records.get(id)?.open) sessionChanged(); });
  const live = () => { if (removed) throw new SparkError("E_CLOSED", "The windows navigator was removed"); };
  const entryOf = (name: unknown) => {
    if (typeof name !== "string" || !Object.hasOwn(config, name)) throw new SparkError("E_NOT_FOUND", `Unknown window: ${String(name)}`);
    return config[name];
  };
  const closedError = (cause?: unknown) => new SparkError("E_CLOSED", "The window has closed", { cause });
  const pools = createWindowPools(entries, { moduleName: name => moduleName(name, config[name]), load: name => contents.get(name)!.load(), report });

  // The menu bar follows the key window: one menu owner whose contribution is the key window's.
  const menuItemsFor = (windowId: string | null): MenuRootItem[] => {
    const record = windowId ? records.get(windowId) : undefined;
    if (!record?.open) return [];
    const { entry, instance } = record, items: MenuRootItem[] = [];
    if (entry.menus) {
      try { items.push(...entry.menus(instance)); }
      catch (error) { report({ windowId: instance.id, name: instance.name, phase: "menu", error }); }
    }
    if (entry.undoMenu) {
      const state = instance.undo.getState(), macos = Platform.OS === "macos";
      items.push({ type: "submenu", id: EDIT_ID, label: labels.edit, target: { menu: "edit" }, items: [
        { type: "action", id: UNDO_ID, label: labels.undo(state.undoLabel), disabled: !state.canUndo, ...(macos ? { target: { role: "undo" } } : { shortcut: "CmdOrCtrl+Z" }) },
        { type: "action", id: REDO_ID, label: labels.redo(state.redoLabel), disabled: !state.canRedo, ...(macos ? { target: { role: "redo" } } : { shortcut: "CmdOrCtrl+Y" }) },
      ] });
    }
    return items;
  };
  const onMenuAction = (action: MenuAction) => {
    // Route to the window whose contribution is published, not one that became key since.
    const record = published ? records.get(published) : undefined;
    if (!record?.open) return;
    const { instance, entry } = record;
    const fail = (error: unknown) => report({ windowId: instance.id, name: instance.name, phase: "menu", error });
    try {
      if (action.itemId === UNDO_ID && entry.undoMenu) { instance.undo.undo(); return; }
      if (action.itemId === REDO_ID && entry.undoMenu) { instance.undo.redo(); return; }
      Promise.resolve(entry.onMenuAction?.(action, instance)).catch(fail);
    } catch (error) { fail(error); }
  };
  // Loaded only when an entry declares menus, so basic window use never needs the menu module.
  const ensureMenu = () => {
    if (!menu) {
      const created = import("@legendapp/spark-native-menu").catch(cause => {
        throw new SparkError("E_MODULE_UNAVAILABLE", "Per-window menus require @legendapp/spark-native-menu", { cause });
      }).then(({ createMenu }) => createMenu({ id: menuOwnerId, items: [], onAction: onMenuAction }));
      menu = created;
      created.catch(() => { if (menu === created) menu = undefined; });
    }
    return menu;
  };
  // At most one menu update per tick: bursts of focus and undo changes publish the final state once.
  // Menu.update serializes publications and skips unchanged trees.
  const publish = (): Promise<void> => publishing ??= Promise.resolve().then(async () => {
    publishing = undefined;
    if (removed) return;
    const windowId = keyWindowId, items = menuItemsFor(windowId);
    // Windows without menus never load the menu module.
    if (menu || items.length) await (await ensureMenu()).update({ items });
    published = windowId;
  });
  const requestPublish = () => {
    if (!usesMenus) return;
    publish().catch(error => {
      const record = keyWindowId ? records.get(keyWindowId) : undefined;
      report({ windowId: keyWindowId ?? "", name: record?.instance.name ?? "", phase: "menu", error });
    });
  };
  const setKey = (next: string | null) => {
    if (keyWindowId === next) return;
    keyWindowId = next; emit(); requestPublish();
  };

  const releaseRuntime = (record: WindowRecord) => {
    const runtime = record.runtime;
    if (!runtime) return;
    record.runtime = undefined;
    const name = runtime.isolated, users = runtimeUsers.get(name)! - 1;
    if (users > 0) { runtimeUsers.set(name, users); return; }
    runtimeUsers.delete(name);
    const destroy = Promise.resolve().then(() => runtime.module.ThreadedRuntime.destroy(name))
      .catch(error => report({ windowId: record.instance.id, name: record.instance.name, phase: "runtime", error }))
      .finally(() => { if (runtimeDestroys.get(name) === destroy) runtimeDestroys.delete(name); });
    runtimeDestroys.set(name, destroy);
  };
  /** Frame and tab-group listeners for `subscribeToSession`; native observation only while it has listeners. */
  const observe = (record: WindowRecord) => {
    if (record.observing || !record.open || !sessionListeners.size) return;
    const { id, name } = record.instance, fail = (error: unknown) => report({ windowId: id, name, phase: "runtime", error });
    const types = tabsSupported() ? ["boundsChanged", "visibilityChanged", "tabGroupChanged"] as const : ["boundsChanged", "visibilityChanged"] as const;
    record.observing = Promise.allSettled(types.map(type => addWindowListener(id, type, sessionChanged, { onError: fail }))).then(results => {
      for (const result of results) if (result.status === "rejected" && nativeError(result.reason).code !== "E_NOT_FOUND") fail(result.reason);
      return results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
    });
  };
  const unobserve = (record: WindowRecord) => {
    const observing = record.observing;
    record.observing = undefined;
    return observing?.then(async registrations => {
      const results = await Promise.allSettled(registrations.map(registration => registration.remove()));
      for (const result of results) if (result.status === "rejected" && nativeError(result.reason).code !== "E_NOT_FOUND") report({ windowId: record.instance.id, name: record.instance.name, phase: "cleanup", error: result.reason });
    });
  };
  const cleanup = async (record: WindowRecord) => {
    const { registrations, subscriptions, instance } = record;
    for (const listener of [...record.closeListeners]) { try { listener(); } catch (error) { console.error(error); } }
    record.closeListeners.clear();
    void unobserve(record);
    for (const subscription of subscriptions.splice(0)) subscription.remove();
    const results = await Promise.allSettled(registrations.splice(0).map(registration => registration.remove()));
    for (const result of results) if (result.status === "rejected" && nativeError(result.reason).code !== "E_NOT_FOUND") report({ windowId: instance.id, name: instance.name, phase: "cleanup", error: result.reason });
  };
  /** Ends one window instance. Never touches a later window reusing the ID: records are never overwritten. */
  const dispose = (record: WindowRecord) => {
    if (record.disposed) return;
    const wasOpen = record.open;
    record.disposed = true; record.open = false;
    const { id } = record.instance;
    if (records.get(id) === record) records.delete(id);
    void cleanup(record);
    releaseRuntime(record);
    if (keyWindowId === id) setKey(null); else if (published === id) requestPublish();
    emit();
    // A closing window can be the last change before quitting: save without waiting.
    if (wasOpen) flushSession();
    // A pooled window parked instead of closing: warm again, or closed for real.
    if (wasOpen && record.entry.pool) pools.recycle(id).catch(error => report({ windowId: id, name: record.instance.name, phase: "cleanup", error }));
  };
  const setVisibility = (record: WindowRecord, change: Partial<Pick<WindowRecord, "hidden" | "occluded">>) => {
    Object.assign(record, change); record.throttle?.notify();
  };

  /** Closure tracking first, bound to this native instance; then focus, undo menu, hotkeys and toolbar events. */
  const installServices = async (record: WindowRecord) => {
    const { instance, entry } = record, { id, name } = instance;
    const fail = (phase: WindowErrorEvent["phase"]) => (error: unknown) => report({ windowId: id, name, phase, error });
    const keep = (registration: AsyncRegistration) => { if (record.disposed) registration.remove().catch(fail("cleanup")); else record.registrations.push(registration); };
    try { keep(await addWindowListener(id, "closed", () => dispose(record), { onError: fail("runtime") })); }
    catch (error) {
      if (nativeError(error).code !== "E_NOT_FOUND") throw error;
      dispose(record); throw closedError(error);
    }
    if (entry.menus || entry.undoMenu) await ensureMenu();
    keep(await addWindowListener(id, "focusChanged", event => {
      if (event.focused) setKey(id); else if (keyWindowId === id) setKey(null);
    }, { onError: fail("runtime") }));
    if (entry.throttle) {
      keep(await addWindowListener(id, "visibilityChanged", event => setVisibility(record, { hidden: !event.visible }), { onError: fail("runtime") }));
      keep(await addWindowListener(id, "occlusionChanged", event => setVisibility(record, { occluded: event.occluded }), { onError: fail("runtime") }));
    }
    if (entry.undoMenu) {
      const subscription = instance.undo.subscribe(() => { if (keyWindowId === id) requestPublish(); });
      if (record.disposed) subscription.remove(); else record.subscriptions.push(subscription);
    }
    if (entry.hotkeys) {
      const handlers = entry.hotkeys.handlers(instance), wrapped: RoutedHotkeyHandlers = {};
      for (const [command, handler] of Object.entries(handlers)) {
        if (typeof handler !== "function") continue;
        wrapped[command] = context => {
          try { return handler(context); } catch (error) { fail("hotkey")(error); }
        };
      }
      keep(await options.hotkeys!.register({ definitions: entry.hotkeys.definitions, handlers: wrapped, scope: { kind: "window", windowId: id } }));
    }
    if (entry.newTab) {
      const newTab = entry.newTab;
      // The new window joins this window's tab group; failures are reported, never thrown at AppKit.
      keep(await handleWindowNewTab(id, async () => {
        const request: NewWindowTabRequest = await newTab(instance);
        object(request, "new tab"); keys(request, ["name", "props", "options"]);
        if (entryOf(request.name).id !== undefined) throw new SparkError("E_INVALID_ARGUMENT", `${request.name} has a fixed window ID and cannot open as a new tab`);
        await openInstance(request.name, { props: request.props, options: { ...request.options, tabbedWith: id } });
      }, { onError: fail("newTab") }));
    }
    if (Platform.OS === "macos" && entry.macos?.onToolbarEvent) {
      const onToolbarEvent = entry.macos.onToolbarEvent;
      keep(await addMacOSWindowListener(id, event => {
        try { onToolbarEvent(event, instance); } catch (error) { fail("toolbar")(error); }
      }, { onError: fail("toolbar") }));
    }
    if (record.disposed) throw closedError();
  };

  const createRecord = (id: string, name: string, entry: WindowConfigEntry, props: WindowRecord["props"], seeds?: Pick<WindowRecord, "seeds" | "restored">): WindowRecord => {
    const runtime = isolated(entry);
    const ensureLive = () => { if (record.disposed) throw closedError(); };
    const instance: WindowInstance = {
      id, name, runtime: runtime ? "isolated" : "shared", undo: createUndoStack(),
      isOpen: () => record.open,
      async focus() { ensureLive(); await showWindow(id, { focus: true }); },
      async close() {
        ensureLive();
        const result = await closeWindow(id);
        if (result.closed) dispose(record);
        return result;
      },
      refreshMenus: () => keyWindowId === id && usesMenus ? publish() : Promise.resolve(),
      async refreshToolbar() {
        if (Platform.OS !== "macos" || !entry.macos?.toolbar) return;
        ensureLive();
        await setWindowOptions(id, { macos: { toolbar: entry.macos.toolbar(instance) } });
      },
    };
    const record: WindowRecord = {
      instance, entry, props, open: false, disposed: false, registrations: [], subscriptions: [], hidden: false, occluded: false,
      closeListeners: new Set(), seeds: seeds?.seeds ?? new Map(), restored: seeds?.restored ?? new Map(), sessionChanged,
    };
    registerInstance(instance, record);
    if (runtime) { record.runtime = runtime; runtimeUsers.set(runtime.isolated, (runtimeUsers.get(runtime.isolated) ?? 0) + 1); }
    return record;
  };
  const track = (record: WindowRecord, work: Promise<void>) => {
    const settled = work.then(() => {}, () => {});
    record.pending = settled;
    settled.then(() => { if (record.pending === settled) record.pending = undefined; });
    return work;
  };

  const host: RootHost = {
    adopt({ id, name, props, use }) {
      validWindowId(id);
      const existing = records.get(id);
      if (existing) return existing.instance;
      // A root restarted by native after a JavaScript reload: rebuild its record from root props.
      if (removed) throw new SparkError("E_CLOSED", "The windows navigator was removed");
      const record = createRecord(id, name, entryOf(name), props);
      record.use = use;
      records.set(id, record);
      void track(record, (async () => {
        let focused = false;
        try { const info = await getWindow(id); focused = info.focused; setVisibility(record, { hidden: !info.visible }); await installServices(record); }
        catch (error) {
          if (record.disposed) return;
          if (nativeError(error).code !== "E_NOT_FOUND") {
            report({ windowId: id, name, phase: "runtime", error });
            await closeWindow(id).catch(cleanupError => report({ windowId: id, name, phase: "cleanup", error: cleanupError }));
          }
          dispose(record); return;
        }
        record.open = true; observe(record); emit();
        if (focused) setKey(id);
      })());
      return record.instance;
    },
    warm: id => pools.warm(id),
    committed(instance) { const record = records.get(instance.id); if (record?.instance === instance) record.committed?.(); },
    throttle(instance) {
      const record = records.get(instance.id);
      if (record?.instance !== instance) return { subscribe: () => () => {}, get: () => false };
      if (!record.throttle) {
        const listeners = new Set<() => void>();
        record.throttle = {
          subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
          get: () => record.entry.throttle === true && (record.hidden || record.occluded),
          notify: () => notify(listeners),
        };
      }
      return record.throttle;
    },
    report,
    fallback: options.errorFallback ?? DefaultErrorFallback,
  };
  for (const [name, entry] of entries) {
    const Root = createWindowRoot(host, contents.get(name)!, name, entry.id);
    AppRegistry.registerComponent(moduleName(name, entry), () => Root);
  }
  for (const module of modules) reservedModules.add(module);

  type OpenRequest = { props?: unknown; options?: NavigatorWindowOptions };
  type Opened = { instance: WindowInstance; info: WindowInfo };
  const validRequest = (name: unknown, request: OpenRequest = {}) => {
    live();
    const entry = entryOf(name);
    object(request, "open request"); keys(request, ["props", "options"]);
    noIdentity(request.options, "open options");
    validateOptions({ ...entry.options, ...request.options, id: "request", component: "request", props: request.props } as WindowOpenOptions, Platform.OS, true);
    return { name: name as string, entry, request };
  };
  /** `restore` opens with a saved ID and starts the window states from saved or duplicated values. */
  const openNew = (name: string, entry: WindowConfigEntry, request: OpenRequest, restore?: { id?: string } & Pick<WindowRecord, "seeds" | "restored">): Promise<Opened> => {
    const runtime = isolated(entry);
    if (runtime) {
      const availability = getIsolatedRuntimeAvailability();
      if (!availability.available) return Promise.reject(new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "Isolated window runtimes are unavailable"));
    }
    const warm = restore?.id === undefined ? pools.take(name, request.options) : undefined;
    if (warm) return claim(warm, name, entry, request, restore);
    const id = entry.id ?? restore?.id ?? generatedId(name);
    // A saved or fixed ID can have been taken since it was checked (a concurrent open, adoption or restore).
    if (records.has(id)) return Promise.reject(new SparkError("E_ALREADY_EXISTS", `Window is already open: ${id}`));
    // Registered and holding its runtime before the first await, so concurrent opens and closes see it.
    const record = createRecord(id, name, entry, request.props as WindowRecord["props"], restore);
    if (entry.pool) record.use = ++uses;
    records.set(id, record);
    let info!: WindowInfo;
    return track(record, (async () => {
      try {
        if (runtime) await runtimeDestroys.get(runtime.isolated);
        await contents.get(name)!.load();
        const windowOptions = { ...entry.options, ...request.options } as WindowOpenOptions;
        const toolbar = Platform.OS === "macos" && entry.macos?.toolbar ? entry.macos.toolbar(record.instance) : undefined;
        // `id` entries keep their props as root props; generated IDs travel with the props.
        const props = entry.id ? request.props : { ...(request.props !== undefined ? { props: request.props as WindowRootProps["props"] } : {}), sparkWindow: { id, ...(record.use ? { use: record.use } : {}) } } satisfies WindowRootProps;
        info = await openWindow({
          ...windowOptions,
          ...(toolbar ? { macos: { ...windowOptions.macos, toolbar } } : {}),
          id, component: moduleName(name, entry), props,
        } as WindowOpenOptions);
        setVisibility(record, { hidden: !info.visible });
      } catch (error) { dispose(record); throw error; }
      try {
        await installServices(record);
        if (entry.pool) await pools.track(name, id, info);
        record.open = true; observe(record); emit();
      } catch (error) {
        // No partially configured windows: close it, then report the original failure.
        if (!record.disposed) {
          await (entry.pool ? pools.release(id) : closeWindow(id)).catch(cleanupError => report({ windowId: id, name, phase: "cleanup", error: cleanupError }));
          dispose(record);
        }
        throw error;
      }
      if (entry.pool) pools.refill(name);
    })()).then(() => ({ instance: record.instance, info }));
  };
  /**
   * Opens a warm pooled window: its root gets the props natively and mounts the content, the window gets the entry's
   * and the open's options, title and frame (resetting what its last use changed), and it shows once the content has
   * committed, so the first paint is the content.
   */
  const claim = (id: string, name: string, entry: WindowConfigEntry, request: OpenRequest, restore?: Pick<WindowRecord, "seeds" | "restored">): Promise<Opened> => {
    const record = createRecord(id, name, entry, request.props as WindowRecord["props"], restore);
    const options = { ...entry.options, ...request.options } as NavigatorWindowOptions & { size?: { width: number; height: number }; position?: { displayId: string; x: number; y: number }; show?: boolean };
    record.use = ++uses;
    record.hidden = options.show === false;
    records.set(id, record);
    let info!: WindowInfo, timer: ReturnType<typeof setTimeout> | undefined;
    const committed = new Promise<void>((resolve, reject) => {
      record.committed = resolve;
      timer = setTimeout(() => reject(new SparkError("E_TIMEOUT", "The window's content did not render")), COMMIT_TIMEOUT_MS);
    });
    return track(record, (async () => {
      try {
        await windowPoolCommand("rootProps", { id, props: { props: request.props as WindowRootProps["props"], sparkWindow: { id, use: record.use } } satisfies WindowRootProps });
        await installServices(record);
        const created = pools.created(id)!;
        const appearance = Object.fromEntries(Object.entries(options).filter(([key]) => APPEARANCE_OPTIONS.includes(key)));
        const toolbar = entry.macos?.toolbar ? entry.macos.toolbar(record.instance) : undefined;
        await setWindowOptions(id, { title: created.title, ...appearance, ...(toolbar ? { macos: { toolbar } } : {}) });
        const size = options.size ?? { width: created.bounds.width, height: created.bounds.height };
        await setWindowBounds(id, { ...(options.position ?? created.bounds), ...size });
        if (!options.position) await centerWindow(id, { displayId: created.bounds.displayId });
        await committed;
        if (options.show !== false) await showWindow(id, { focus: true });
        info = await getWindow(id);
        record.open = true; observe(record); emit();
      } catch (error) {
        if (!record.disposed) dispose(record);
        await pools.release(id).catch(cleanupError => report({ windowId: id, name, phase: "cleanup", error: cleanupError }));
        throw error;
      } finally { clearTimeout(timer); record.committed = undefined; }
      pools.refill(name);
    })()).then(() => ({ instance: record.instance, info }));
  };
  const fixedId = (name: unknown) => {
    const id = entryOf(name).id;
    if (id === undefined) throw new SparkError("E_INVALID_ARGUMENT", `${String(name)} has no fixed window ID; use the handle from openInstance()`);
    return id;
  };
  /** The tracked record for a fixed ID, after dropping one whose native window has already gone. */
  const liveRecord = async (id: string) => {
    for (let existing = records.get(id); existing; existing = records.get(id)) {
      if (existing.pending) return existing;
      try { await getWindow(id); return existing; }
      catch (error) {
        if (records.get(id) !== existing) continue;
        if (nativeError(error).code !== "E_NOT_FOUND") throw error;
        dispose(existing); // Closed natively before its closed event arrived.
      }
    }
    return undefined;
  };
  const open = async (...args: [unknown, OpenRequest?]): Promise<WindowInfo> => {
    const { name, entry, request } = validRequest(...args);
    if (entry.id !== undefined && await liveRecord(entry.id)) throw new SparkError("E_ALREADY_EXISTS", `Window is already open: ${entry.id}`);
    return (await openNew(name, entry, request)).info;
  };
  const openInstance = async (...args: [unknown, OpenRequest?]): Promise<WindowInstance> => {
    const { name, entry, request } = validRequest(...args);
    if (entry.id === undefined) return (await openNew(name, entry, request)).instance;
    // Singleton: wait out an open or post-reload adoption in flight; never replace a live record.
    for (let existing = records.get(entry.id); existing; existing = records.get(entry.id)) {
      if (existing.pending) { await existing.pending; continue; }
      try { await existing.instance.focus(); return existing.instance; }
      catch (error) {
        if (records.get(entry.id) !== existing) continue;
        if (nativeError(error).code !== "E_NOT_FOUND") throw error;
        dispose(existing); // Closed natively before its closed event arrived.
      }
    }
    return (await openNew(name, entry, request)).instance;
  };

  /** The record of a live window this navigator owns. */
  const ownRecord = (window: WindowInstance) => {
    if (instanceRecord(window).disposed) throw closedError();
    const record = records.get(window.id);
    if (record?.instance !== window || !record.open) throw new SparkError("E_INVALID_ARGUMENT", `Window ${window.id} belongs to another navigator`);
    return record;
  };
  /** Restorable values by key: registered states, plus saved values whose state does not exist yet. */
  const savedState = (record: WindowRecord) => {
    const state: Record<string, unknown> = Object.fromEntries(record.restored);
    for (const [key, internals] of restorableStates) {
      const value = internals.snapshot(record.instance);
      if (value !== undefined) state[key] = value;
    }
    return jsonCopy(state, "Restorable window state") as Record<string, unknown>;
  };
  const getSession = async (): Promise<WindowSession> => {
    live();
    const open = [...records.values()].filter(record => record.open);
    const [infos, displays, groups] = await Promise.all([
      Promise.all(open.map(record => getWindow(record.instance.id).catch(error => {
        if (nativeError(error).code === "E_NOT_FOUND") return null; // Closed natively; its closed event is on the way.
        throw error;
      }))),
      getDisplays(),
      tabsSupported() ? listWindowTabGroups() : Promise.resolve([]),
    ]);
    const windows: SavedWindow[] = [];
    open.forEach((record, index) => {
      const info = infos[index];
      if (!info) return;
      const { id, name } = record.instance;
      windows.push({
        id, name, props: record.props === undefined ? null : jsonCopy(record.props, "Window props") as Record<string, unknown>,
        title: info.title, visible: info.visible,
        bounds: { ...info.bounds, persistentDisplayId: displays.find(display => display.id === info.bounds.displayId)?.persistentId ?? null },
        state: savedState(record),
      });
    });
    const saved = new Set(windows.map(window => window.id));
    // AppKit reports a group's background tabs as not visible: a tab is shown with its group. A group with no
    // visible window is saved as hidden windows, since a hidden window cannot open as a tab.
    const tabGroups = groups.map(group => ({ windowIds: group.windowIds.filter(id => saved.has(id)), selectedWindowId: group.selectedWindowId !== null && saved.has(group.selectedWindowId) ? group.selectedWindowId : null }))
      .filter(group => group.windowIds.length > 1 && windows.some(window => window.visible && group.windowIds.includes(window.id)));
    for (const window of windows) if (tabGroups.some(group => group.windowIds.includes(window.id))) window.visible = true;
    return { version: 1, windows, tabGroups, keyWindowId: keyWindowId !== null && saved.has(keyWindowId) ? keyWindowId : null };
  };
  const invalid = (message: string) => new SparkError("E_INVALID_DATA", `Invalid window session: ${message}`);
  /** Malformed sessions reject E_INVALID_DATA, whichever argument check found the problem. */
  const validSession = (session: WindowSession) => {
    try { validSessionData(session); }
    catch (error) {
      if (error instanceof SparkError && (error.code === "E_INVALID_ARGUMENT" || error.code === "E_UNSUPPORTED_OPTION")) throw new SparkError("E_INVALID_DATA", `Invalid window session: ${error.message}`, { cause: error });
      throw error;
    }
    if (session.tabGroups.length && !tabsSupported()) throw new SparkError("E_UNSUPPORTED_OPTION", `${Platform.OS === "windows" ? "Windows" : Platform.OS} does not support window tab groups yet`);
    for (const saved of session.windows) if (records.has(saved.id)) throw new SparkError("E_ALREADY_EXISTS", `Window is already open: ${saved.id}`);
  };
  const validSessionData = (session: WindowSession) => {
    object(session, "window session"); keys(session, ["version", "windows", "tabGroups", "keyWindowId"]);
    if (session.version !== 1) throw invalid("unknown version");
    if (!Array.isArray(session.windows) || !Array.isArray(session.tabGroups)) throw invalid("windows and tabGroups must be arrays");
    const ids = new Set<string>();
    for (const saved of session.windows) {
      object(saved, "saved window"); keys(saved, ["id", "name", "props", "title", "visible", "bounds", "state"]);
      validWindowId(saved.id);
      if (ids.has(saved.id)) throw invalid(`window ${saved.id} appears twice`);
      ids.add(saved.id);
      const entry = entryOf(saved.name);
      if (entry.id !== undefined && entry.id !== saved.id) throw invalid(`${saved.name} opens as ${entry.id}, not ${saved.id}`);
      if (saved.props !== null) { object(saved.props, "saved props"); jsonCopy(saved.props, "Saved props"); }
      if (typeof saved.title !== "string" || typeof saved.visible !== "boolean") throw invalid(`window ${saved.id} needs a title and visibility`);
      object(saved.bounds, "saved bounds");
      const { persistentDisplayId, ...frame } = saved.bounds;
      validBounds(frame);
      if (persistentDisplayId !== null && typeof persistentDisplayId !== "string") throw invalid("persistentDisplayId must be a string or null");
      object(saved.state, "saved state"); jsonCopy(saved.state, "Saved window state");
    }
    const grouped = new Set<string>();
    for (const group of session.tabGroups) {
      object(group, "tab group"); keys(group, ["windowIds", "selectedWindowId"]);
      if (!Array.isArray(group.windowIds) || group.windowIds.length < 2) throw invalid("a tab group needs two or more windows");
      for (const id of group.windowIds) {
        if (!ids.has(id) || grouped.has(id)) throw invalid(`tab group window ${String(id)} is unknown or in two groups`);
        grouped.add(id);
      }
      if (group.selectedWindowId !== null && !group.windowIds.includes(group.selectedWindowId)) throw invalid("a tab group's selected window must be one of its windows");
    }
    if (session.keyWindowId !== null && !ids.has(session.keyWindowId)) throw invalid("the key window must be one of the session's windows");
    for (const saved of session.windows) if (!saved.visible && grouped.has(saved.id)) throw invalid(`hidden window ${saved.id} cannot be in a tab group`);
  };
  const restoreSession = async (session: WindowSession): Promise<WindowInstance[]> => {
    live(); validSession(session);
    const displays = await getDisplays();
    const groupOf = new Map(session.tabGroups.flatMap(group => group.windowIds.map(id => [id, group] as const)));
    const byId = new Map(session.windows.map(saved => [saved.id, saved]));
    // A tab group opens together, in tab order: each window after the first joins as the group's last tab.
    const order: SavedWindow[] = [], placed = new Set<string>();
    for (const saved of session.windows) for (const id of groupOf.get(saved.id)?.windowIds ?? [saved.id]) {
      if (!placed.has(id)) { placed.add(id); order.push(byId.get(id)!); }
    }
    const opened = new Map<string, WindowInstance>();
    try {
      for (const saved of order) {
        const first = groupOf.get(saved.id)?.windowIds[0];
        const frame = placement(saved.bounds, displays);
        const options: NavigatorWindowOptions = {
          title: saved.title, show: saved.visible, size: { width: frame.width, height: frame.height },
          ...(first !== undefined && first !== saved.id ? { tabbedWith: first } : { position: { displayId: frame.displayId, x: frame.x, y: frame.y } }),
        };
        const { instance } = await openNew(saved.name, entryOf(saved.name), { props: saved.props ?? undefined, options }, { id: saved.id, seeds: new Map(), restored: new Map(Object.entries(saved.state)) });
        opened.set(saved.id, instance);
      }
      for (const group of session.tabGroups) if (group.selectedWindowId !== null) await selectWindowTab(group.selectedWindowId);
      if (session.keyWindowId !== null) await opened.get(session.keyWindowId)!.focus();
    } catch (error) {
      await Promise.allSettled([...opened.values()].map(instance => instance.isOpen() ? instance.close() : undefined));
      throw error;
    }
    return session.windows.map(saved => opened.get(saved.id)!);
  };
  const duplicate = async (source: WindowInstance, request: DuplicateWindowOptions = {}): Promise<WindowInstance> => {
    live();
    const record = ownRecord(source);
    object(request, "duplicate options"); keys(request, ["props", "options", "detached", "tab"]);
    if (record.entry.id !== undefined) throw new SparkError("E_INVALID_ARGUMENT", `${source.name} is a single window and cannot be duplicated`);
    for (const flag of ["detached", "tab"] as const) if (request[flag] !== undefined && typeof request[flag] !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", `${flag} must be boolean`);
    if (request.props !== undefined) object(request.props, "duplicate props");
    noIdentity(request.options, "duplicate options");
    if (request.tab && !tabsSupported()) throw new SparkError("E_UNSUPPORTED_OPTION", `${Platform.OS === "windows" ? "Windows" : Platform.OS} does not support window tabs yet`);
    const detached = request.detached === true;
    const seeds: WindowRecord["seeds"] = new Map();
    for (const state of windowStates) {
      const seed = state.duplicate(source, detached);
      if (seed) seeds.set(state, seed);
    }
    // Saved values whose state does not exist yet travel too.
    const restored = new Map([...record.restored].filter(([key]) => !restorableStates.has(key)).map(([key, value]) => [key, jsonCopy(value, "Restorable window state")]));
    const [info, displays] = await Promise.all([getWindow(source.id), getDisplays()]);
    const display = displays.find(item => item.id === info.bounds.displayId) ?? displays.find(item => item.primary)!;
    const frame = fit({ x: info.bounds.x + CASCADE, y: info.bounds.y + CASCADE, width: info.bounds.width, height: info.bounds.height }, display);
    const options: NavigatorWindowOptions = {
      title: info.title,
      ...(request.tab ? { tabbedWith: source.id } : { position: { displayId: frame.displayId, x: frame.x, y: frame.y }, size: { width: frame.width, height: frame.height } }),
      ...request.options,
    };
    const props = record.props === undefined && request.props === undefined ? undefined : { ...record.props, ...request.props };
    const { name, entry } = validRequest(source.name, { props, options });
    return (await openNew(name, entry, { props, options }, { seeds, restored })).instance;
  };

  const registration = asyncRegistration(() => {
    removed = true; listeners.clear(); sessionListeners.clear(); cancelSession(); stopTitles();
    for (const module of modules) reservedModules.delete(module);
  }, async () => {
    // Windows stay open and keep their runtimes; the navigator only stops observing them.
    const owned = [...records.values()];
    records.clear();
    for (const record of owned) { record.disposed = true; record.open = false; }
    await Promise.all(owned.map(cleanup));
    await pools.remove();
    const pending = menu; menu = undefined;
    if (pending) await (await pending.catch(() => undefined))?.remove();
  });

  return {
    open: open as WindowsNavigator<T>["open"],
    openInstance: openInstance as WindowsNavigator<T>["openInstance"],
    async close(name) {
      live();
      const id = fixedId(name), result = await closeWindow(id);
      const record = records.get(id);
      if (result.closed && record) dispose(record);
      return result;
    },
    async show(name) { live(); await showWindow(fixedId(name)); },
    getId: fixedId,
    get(windowId) { live(); const record = records.get(windowId); return record?.open ? record.instance : undefined; },
    list(name) {
      live();
      if (name !== undefined) entryOf(name);
      return [...records.values()].filter(record => record.open && (name === undefined || record.instance.name === name)).map(record => record.instance);
    },
    getKeyWindowId: () => { live(); return keyWindowId; },
    subscribe(listener) {
      live();
      if (typeof listener !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected a listener");
      listeners.add(listener); return { remove() { listeners.delete(listener); } };
    },
    async prefetch(name) { live(); entryOf(name); await contents.get(name as string)!.load(); },
    getSession,
    restoreSession,
    duplicate,
    async prewarm(name, count) { live(); entryOf(name); return pools.prewarm(name, count, [...records.values()].filter(record => record.open && record.instance.name === name).map(record => record.instance.id)); },
    getPool(name) { live(); entryOf(name); return pools.state(name); },
    async trimPool(name) { live(); if (name !== undefined) entryOf(name); await pools.trim(name); },
    subscribeToSession(listener) {
      live();
      if (typeof listener !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected a listener");
      sessionListeners.add(listener);
      if (sessionListeners.size === 1) for (const record of records.values()) observe(record);
      return { remove() {
        if (!sessionListeners.delete(listener) || sessionListeners.size) return;
        cancelSession();
        for (const record of records.values()) void unobserve(record);
      } };
    },
    remove: registration.remove,
  };
}
