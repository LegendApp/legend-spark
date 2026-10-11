import { AppRegistry, NativeModules, Platform, UIManager } from "react-native";
import { SparkError, asyncRegistration, nativeError, type AsyncRegistration, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import type { Menu, MenuAction, MenuRootItem } from "@legendapp/spark-native-menu";
import type { RoutedHotkeyHandlers } from "@legendapp/spark-commands/src/router";
import { addWindowListener, closeWindow, getWindow, getWindowAvailability, openWindow, setWindowOptions, showWindow } from "../api";
import { addMacOSWindowListener } from "../macos";
import type { CloseResult, WindowInfo, WindowOpenOptions } from "../types";
import { keys, object, validateOptions, windowId as validWindowId } from "../validation";
import { DefaultErrorFallback, createWindowRoot, type RootContent, type RootHost, type WindowRootProps } from "./root";
import { createUndoStack } from "./undo";
import type { IsolatedRuntime, NavigatorWindowOptions, UndoMenuLabels, WindowComponentProps, WindowConfigEntry, WindowErrorEvent, WindowInstance, WindowsConfig, WindowsNavigatorOptions } from "./types";

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
}

interface WindowRecord {
  instance: WindowInstance;
  entry: WindowConfigEntry;
  /** Native window confirmed, per-window services installed, not yet closed. */
  open: boolean;
  disposed: boolean;
  /** Native open or post-reload adoption in flight; singleton opens wait for it. */
  pending?: Promise<void>;
  /** The isolated runtime this window holds a use of. */
  runtime?: IsolatedRuntime;
  registrations: AsyncRegistration[];
  subscriptions: { remove(): void }[];
}

const namePattern = /^[a-zA-Z0-9_-]{1,48}$/;
const entryKeys = ["id", "component", "loadComponent", "options", "runtime", "undoMenu", "menus", "onMenuAction", "hotkeys", "macos"];
const UNDO_ID = "spark-windows-undo", REDO_ID = "spark-windows-redo", EDIT_ID = "spark-windows-edit";
const defaultUndoLabels: UndoMenuLabels = { edit: "Edit", undo: label => label ? `Undo ${label}` : "Undo", redo: label => label ? `Redo ${label}` : "Redo" };
/** Registered root module names: `spark.window.<id>` for `id` entries, `spark.window.<name>` otherwise. */
const reservedModules = new Set<string>();
// Isolated runtimes are counted across navigators: one is destroyed only when no window, or window
// being opened, of any navigator uses it.
const runtimeUsers = new Map<string, number>(), runtimeDestroys = new Map<string, Promise<void>>();
const instanceRecords = new WeakMap<WindowInstance, WindowRecord>();
let sequence = 0, navigators = 0;

/** Internal: true once a navigator window has closed. Rejects values that are not navigator windows. */
export function isClosedWindow(window: WindowInstance): boolean {
  const record = instanceRecords.get(window);
  if (!record) throw new SparkError("E_INVALID_ARGUMENT", "Expected a window instance from createWindowsNavigator");
  return record.disposed;
}

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
  fn(entry.menus, "menus"); fn(entry.onMenuAction, "onMenuAction");
  if (entry.hotkeys !== undefined) {
    object(entry.hotkeys, "hotkeys"); keys(entry.hotkeys, ["definitions", "handlers"]);
    if (!Array.isArray(entry.hotkeys.definitions) || typeof entry.hotkeys.handlers !== "function") throw new SparkError("E_INVALID_ARGUMENT", "hotkeys need definitions and a handlers(instance) function");
    if (!options.hotkeys) throw new SparkError("E_INVALID_ARGUMENT", `${name} declares hotkeys; pass the app's hotkey router as options.hotkeys`);
  }
  if (entry.macos !== undefined) {
    object(entry.macos, "macos"); keys(entry.macos, ["toolbar", "onToolbarEvent"]);
    fn(entry.macos.toolbar, "macos.toolbar"); fn(entry.macos.onToolbarEvent, "macos.onToolbarEvent");
  }
}
type RootComponent = Awaited<ReturnType<RootContent["load"]>>;
function contentOf(entry: WindowConfigEntry): RootContent {
  let resolved = entry.component as RootComponent | undefined;
  let pending: Promise<RootComponent> | undefined;
  return {
    runtime: isolated(entry),
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
export function createWindowsNavigator<const T extends WindowsConfig>(config: T, options: WindowsNavigatorOptions = {}): WindowsNavigator<T> {
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
  const listeners = new Set<() => void>();
  let keyWindowId: string | null = null, published: string | null = null, removed = false;
  let menu: Promise<Menu> | undefined, publishing: Promise<void> | undefined;

  const report = (event: WindowErrorEvent) => {
    try { (options.onError ?? console.error)(event); } catch (error) { console.error(error); }
  };
  const emit = () => { for (const listener of [...listeners]) { try { listener(); } catch (error) { console.error(error); } } };
  const live = () => { if (removed) throw new SparkError("E_CLOSED", "The windows navigator was removed"); };
  const entryOf = (name: unknown) => {
    if (typeof name !== "string" || !Object.hasOwn(config, name)) throw new SparkError("E_NOT_FOUND", `Unknown window: ${String(name)}`);
    return config[name];
  };
  const closedError = (cause?: unknown) => new SparkError("E_CLOSED", "The window has closed", { cause });

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
  const cleanup = async (record: WindowRecord) => {
    const { registrations, subscriptions, instance } = record;
    for (const subscription of subscriptions.splice(0)) subscription.remove();
    const results = await Promise.allSettled(registrations.splice(0).map(registration => registration.remove()));
    for (const result of results) if (result.status === "rejected" && nativeError(result.reason).code !== "E_NOT_FOUND") report({ windowId: instance.id, name: instance.name, phase: "cleanup", error: result.reason });
  };
  /** Ends one window instance. Never touches a later window reusing the ID: records are never overwritten. */
  const dispose = (record: WindowRecord) => {
    if (record.disposed) return;
    record.disposed = true; record.open = false;
    const { id } = record.instance;
    if (records.get(id) === record) records.delete(id);
    void cleanup(record);
    releaseRuntime(record);
    if (keyWindowId === id) setKey(null); else if (published === id) requestPublish();
    emit();
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
    if (Platform.OS === "macos" && entry.macos?.onToolbarEvent) {
      const onToolbarEvent = entry.macos.onToolbarEvent;
      keep(await addMacOSWindowListener(id, event => {
        try { onToolbarEvent(event, instance); } catch (error) { fail("toolbar")(error); }
      }, { onError: fail("toolbar") }));
    }
    if (record.disposed) throw closedError();
  };

  const createRecord = (id: string, name: string, entry: WindowConfigEntry): WindowRecord => {
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
    const record: WindowRecord = { instance, entry, open: false, disposed: false, registrations: [], subscriptions: [] };
    instanceRecords.set(instance, record);
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
    adopt({ id, name }) {
      validWindowId(id);
      const existing = records.get(id);
      if (existing) return existing.instance;
      // A root restarted by native after a JavaScript reload: rebuild its record from root props.
      if (removed) throw new SparkError("E_CLOSED", "The windows navigator was removed");
      const record = createRecord(id, name, entryOf(name));
      records.set(id, record);
      void track(record, (async () => {
        let focused = false;
        try { focused = (await getWindow(id)).focused; await installServices(record); }
        catch (error) {
          if (record.disposed) return;
          if (nativeError(error).code !== "E_NOT_FOUND") {
            report({ windowId: id, name, phase: "runtime", error });
            await closeWindow(id).catch(cleanupError => report({ windowId: id, name, phase: "cleanup", error: cleanupError }));
          }
          dispose(record); return;
        }
        record.open = true; emit();
        if (focused) setKey(id);
      })());
      return record.instance;
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
  const openNew = (name: string, entry: WindowConfigEntry, request: OpenRequest): Promise<Opened> => {
    const runtime = isolated(entry);
    if (runtime) {
      const availability = getIsolatedRuntimeAvailability();
      if (!availability.available) return Promise.reject(new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "Isolated window runtimes are unavailable"));
    }
    const id = entry.id ?? `${name}-${Date.now().toString(36)}-${(++sequence).toString(36)}`;
    // Registered and holding its runtime before the first await, so concurrent opens and closes see it.
    const record = createRecord(id, name, entry);
    records.set(id, record);
    let info!: WindowInfo;
    return track(record, (async () => {
      try {
        if (runtime) await runtimeDestroys.get(runtime.isolated);
        await contents.get(name)!.load();
        const windowOptions = { ...entry.options, ...request.options } as WindowOpenOptions;
        const toolbar = Platform.OS === "macos" && entry.macos?.toolbar ? entry.macos.toolbar(record.instance) : undefined;
        // `id` entries keep their props as root props; generated IDs travel with the props.
        const props = entry.id ? request.props : { props: (request.props ?? {}) as WindowRootProps["props"], sparkWindow: { id } } satisfies WindowRootProps;
        info = await openWindow({
          ...windowOptions,
          ...(toolbar ? { macos: { ...windowOptions.macos, toolbar } } : {}),
          id, component: moduleName(name, entry), props,
        } as WindowOpenOptions);
      } catch (error) { dispose(record); throw error; }
      try {
        await installServices(record);
        record.open = true; emit();
      } catch (error) {
        // No partially configured windows: close it, then report the original failure.
        if (!record.disposed) {
          await closeWindow(id).catch(cleanupError => report({ windowId: id, name, phase: "cleanup", error: cleanupError }));
          dispose(record);
        }
        throw error;
      }
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

  const registration = asyncRegistration(() => {
    removed = true; listeners.clear();
    for (const module of modules) reservedModules.delete(module);
  }, async () => {
    // Windows stay open and keep their runtimes; the navigator only stops observing them.
    const owned = [...records.values()];
    records.clear();
    for (const record of owned) { record.disposed = true; record.open = false; }
    await Promise.all(owned.map(cleanup));
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
    remove: registration.remove,
  };
}
