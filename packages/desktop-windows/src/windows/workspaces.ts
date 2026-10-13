import { Platform, TurboModuleRegistry } from "react-native";
import { SparkError, asyncRegistration, nativeError, type AsyncRegistration, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import type { Menu, MenuAction, MenuItem, MenuRootItem } from "@legendapp/spark-native-menu";
import { getDisplays, getWindow, getWindowAvailability, setWindowFullscreen } from "../api";
import type { CloseResult, DisplayId, DisplayInfo, WindowId } from "../types";
import { sessionChecks, type WindowsNavigator } from "./createWindowsNavigator";
import type { SavedWindow, WindowInstance, WindowSession, WindowsConfig } from "./types";

type Rect = { x: number; y: number; width: number; height: number };
/** A display as it was when a workspace was saved. */
export interface SavedDisplay { id: DisplayId; persistentId: string | null; primary: boolean; workArea: Rect }
/** A named window layout: a navigator session and the displays it was saved on. */
export interface WindowWorkspace {
  name: string;
  /** Milliseconds since the epoch. */
  savedAt: number;
  displays: SavedDisplay[];
  session: WindowSession;
  /** Windows that were in native fullscreen, each in its own Space; restore puts them back into fullscreen. */
  fullscreenWindowIds: WindowId[];
}
/**
 * Where a restored window went. `exact`: its saved display at its saved frame. `moved`: another display with a work area
 * of the same size, at the same place in it. `scaled`: a display with a different work area (another display, or the
 * same one at another resolution); the frame keeps its proportions within the work area.
 */
export interface WorkspacePlacement { windowId: WindowId; displayId: DisplayId; layout: "exact" | "moved" | "scaled" }
/**
 * `vetoed` / `interrupted`: a window the restore had to close stayed open. `failed`: a workspace window could not open
 * or enter fullscreen. Either way the windows the restore had closed are reopened as they were (`rolledBack`).
 */
export type WorkspaceRestoreResult =
  | { restored: true; windows: WindowInstance[]; placements: WorkspacePlacement[] }
  | { restored: false; reason: Extract<CloseResult, { closed: false }>["reason"]; windowId: WindowId; rolledBack: boolean }
  | { restored: false; reason: "failed"; error: unknown; rolledBack: boolean };
export interface WorkspaceMenuLabels { workspaces: string; save: string }
/**
 * A Workspaces menu, before the Window menu: Save Workspace…, then one item per saved workspace that restores it. Its own
 * menu rather than an overlay of Window, so the system's localized Window title is never replaced.
 */
export interface WorkspaceMenuOptions {
  /** English by default. */
  labels?: WorkspaceMenuLabels;
  /** Save Workspace… asks the app for a name; null cancels. */
  requestName(): string | null | Promise<string | null>;
  saveShortcut?: string;
  /** Shortcuts for the first workspaces in list order, such as `Ctrl+CmdOrCtrl+1`…`9`. */
  restoreShortcuts?: readonly string[];
}
export interface WindowWorkspacesOptions {
  menu?: WorkspaceMenuOptions;
  /** Menu action failures and menu updates that could not read the workspaces. Defaults to console.error. */
  onError?: (error: unknown) => void;
}
/** Saved window workspaces of one navigator, stored in the app's data directory (`workspaces.json`). */
export interface WindowWorkspaces extends AsyncRegistration {
  /** In the order they were first saved. Rejects `E_INVALID_DATA` while the file is corrupt or of an unknown version. */
  list(): Promise<WindowWorkspace[]>;
  /** Saves the navigator's open windows and the connected displays under `name`, replacing a workspace of that name. */
  save(name: string): Promise<WindowWorkspace>;
  /**
   * Closes the navigator's open windows (each close runs its guard) and opens the workspace's windows, adapted to the
   * displays connected now; fullscreen windows enter fullscreen again. The saved session is checked before any window closes.
   */
  restore(name: string): Promise<WorkspaceRestoreResult>;
  rename(name: string, newName: string): Promise<void>;
  delete(name: string): Promise<void>;
  /** Deletes the workspaces file, corrupt or not. */
  clear(): Promise<void>;
  /** Notifies after a save, rename, delete or clear. */
  subscribe(listener: () => void): { remove(): void };
  /** Relabels the Workspaces menu, for example after a language change. Rejects without `menu`. */
  setMenuLabels(labels: WorkspaceMenuLabels): Promise<void>;
}

const FILE = "workspaces.json";
/** Limits checked when the file is read and when a workspace is saved. */
export const WORKSPACE_LIMITS = { workspaces: 100, windows: 200, fileBytes: 4 * 1024 * 1024 } as const;
const defaultLabels: WorkspaceMenuLabels = { workspaces: "Workspaces", save: "Save Workspace…" };
let controllers = 0;

/**
 * macOS: the navigator's windows and displays, and the file-system module for the app's data directory. Windows reports
 * `unsupported-platform` (#445). Spaces and Stage Manager have no public API: a restore opens windows on the
 * active Space, and Stage Manager arranges them as it does any new window (docs/api-window-contract.md#workspaces).
 */
export function getWindowWorkspaceAvailability(): Availability {
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  const windows = getWindowAvailability();
  if (!windows.available) return windows;
  return TurboModuleRegistry.get("NativeDesktopFileSystem") ? { available: true } : { available: false, reason: "missing-module" };
}
function available() {
  const availability = getWindowWorkspaceAvailability();
  if (availability.available) return;
  if (availability.reason === "unsupported-platform") throw new SparkError("E_UNSUPPORTED_PLATFORM", `${Platform.OS === "windows" ? "Windows" : Platform.OS} does not support window workspaces yet`);
  throw new SparkError("E_MODULE_UNAVAILABLE", "Window workspaces need @legendapp/spark-file-system to store them in the app's data directory");
}

const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
/** Not a type guard, so typed options keep their types. */
const isObject = (value: unknown): boolean => plain(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const exactKeys = (value: Record<string, unknown>, names: readonly string[]) => Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const isRect = (value: unknown, positive: boolean): value is Rect => plain(value) && exactKeys(value, ["x", "y", "width", "height"]) && [value.x, value.y, value.width, value.height].every(finite) && (!positive || ((value.width as number) > 0 && (value.height as number) > 0));
const nullableText = (value: unknown) => value === null || typeof value === "string";
export function validName(name: unknown): asserts name is string {
  if (typeof name !== "string" || !name.length || name.length > 100 || name.trim() !== name || /[\u0000-\u001f\u007f]/.test(name)) throw new SparkError("E_INVALID_ARGUMENT", "Workspace names are 1–100 characters without control characters or surrounding spaces");
}
function savedWindow(value: unknown, displays: Set<string>): value is SavedWindow {
  if (!plain(value) || !exactKeys(value, ["id", "name", "props", "title", "visible", "bounds", "state"])) return false;
  const { bounds } = value;
  return typeof value.id === "string" && typeof value.name === "string" && (value.props === null || plain(value.props)) && typeof value.title === "string" && typeof value.visible === "boolean" && plain(value.state)
    && plain(bounds) && exactKeys(bounds, ["displayId", "x", "y", "width", "height", "persistentDisplayId"]) && typeof bounds.displayId === "string" && displays.has(bounds.displayId)
    && isRect({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, true) && nullableText(bounds.persistentDisplayId);
}
function session(value: unknown, displays: Set<string>): value is WindowSession {
  if (!plain(value) || !exactKeys(value, ["version", "windows", "tabGroups", "keyWindowId"]) || value.version !== 1 || !Array.isArray(value.windows) || !Array.isArray(value.tabGroups) || !nullableText(value.keyWindowId)) return false;
  return value.windows.every(window => savedWindow(window, displays)) && value.tabGroups.every(group => plain(group) && exactKeys(group, ["windowIds", "selectedWindowId"]) && Array.isArray(group.windowIds) && group.windowIds.every(id => typeof id === "string") && nullableText(group.selectedWindowId));
}
function workspace(value: unknown): value is WindowWorkspace {
  if (!plain(value) || !exactKeys(value, ["name", "savedAt", "displays", "session", "fullscreenWindowIds"]) || !finite(value.savedAt) || value.savedAt < 0 || !Array.isArray(value.displays) || !Array.isArray(value.fullscreenWindowIds)) return false;
  try { validName(value.name); } catch { return false; }
  const displays = value.displays;
  if (!displays.every(display => plain(display) && exactKeys(display, ["id", "persistentId", "primary", "workArea"]) && typeof display.id === "string" && nullableText(display.persistentId) && typeof display.primary === "boolean" && isRect(display.workArea, true))) return false;
  const ids = new Set(displays.map(display => (display as SavedDisplay).id));
  if (ids.size !== displays.length || !session(value.session, ids) || value.session.windows.length > WORKSPACE_LIMITS.windows) return false;
  const windows = new Set(value.session.windows.map(window => window.id));
  return new Set(value.fullscreenWindowIds).size === value.fullscreenWindowIds.length && value.fullscreenWindowIds.every(id => typeof id === "string" && windows.has(id));
}
/**
 * The workspaces file: `{ version: 1, workspaces }`, at most 4 MB, 100 workspaces and 200 windows each. Anything else, or
 * JSON that does not parse, rejects `E_INVALID_DATA`.
 */
export function parseWorkspaces(text: string, path: string): WindowWorkspace[] {
  // UTF-16 length bounds the UTF-8 size from below; checked before parsing.
  if (text.length > WORKSPACE_LIMITS.fileBytes) throw new SparkError("E_INVALID_DATA", `The workspaces file is larger than ${WORKSPACE_LIMITS.fileBytes} bytes: ${path}`);
  let value: unknown;
  try { value = JSON.parse(text); }
  catch (cause) { throw new SparkError("E_INVALID_DATA", `The workspaces file is not JSON: ${path}`, { cause }); }
  if (!plain(value) || !exactKeys(value, ["version", "workspaces"])) throw new SparkError("E_INVALID_DATA", `The workspaces file is not a workspace list: ${path}`);
  if (value.version !== 1) throw new SparkError("E_INVALID_DATA", `The workspaces file has an unknown version (${JSON.stringify(value.version)}): ${path}`);
  const list = value.workspaces;
  if (!Array.isArray(list)) throw new SparkError("E_INVALID_DATA", `The workspaces file has no workspace list: ${path}`);
  if (list.length > WORKSPACE_LIMITS.workspaces) throw new SparkError("E_INVALID_DATA", `The workspaces file has more than ${WORKSPACE_LIMITS.workspaces} workspaces: ${path}`);
  list.forEach((item, index) => { if (!workspace(item)) throw new SparkError("E_INVALID_DATA", `Workspace ${index + 1} in the workspaces file is malformed: ${path}`); });
  if (new Set(list.map(item => (item as WindowWorkspace).name)).size !== list.length) throw new SparkError("E_INVALID_DATA", `The workspaces file names a workspace twice: ${path}`);
  return list as WindowWorkspace[];
}

/**
 * Maps each saved display to a connected one: the display with the same `persistentId` (or, when neither has one, the
 * same display ID); else, for the saved primary, the
 * primary display if it is not taken; else the first display not taken; else the primary display.
 */
function mapDisplays(saved: SavedDisplay[], displays: DisplayInfo[]) {
  const primary = displays.find(display => display.primary) ?? displays[0];
  if (!primary) throw new SparkError("E_UNAVAILABLE", "No display is connected");
  const taken = new Set<string>(), mapped = new Map<string, { display: DisplayInfo; same: boolean }>();
  for (const display of saved) {
    // Without a persistent ID on either side, the same display ID is the same display.
    const found = displays.find(item => !taken.has(item.id) && (display.persistentId === null ? item.persistentId === null && item.id === display.id : item.persistentId === display.persistentId));
    if (found) { taken.add(found.id); mapped.set(display.id, { display: found, same: true }); }
  }
  for (const display of [...saved].sort((a, b) => Number(b.primary) - Number(a.primary))) {
    if (mapped.has(display.id)) continue;
    const found = display.primary && !taken.has(primary.id) ? primary : displays.find(item => !taken.has(item.id));
    if (found) taken.add(found.id);
    mapped.set(display.id, { display: found ?? primary, same: false });
  }
  return mapped;
}
const MIN = 100;
/** The workspace's session with every frame on a connected display, and where each window goes. */
export function adaptWorkspace(workspace: WindowWorkspace, displays: DisplayInfo[]): { session: WindowSession; placements: WorkspacePlacement[] } {
  const mapped = mapDisplays(workspace.displays, displays);
  const savedDisplays = new Map(workspace.displays.map(display => [display.id, display]));
  const placements: WorkspacePlacement[] = [];
  const windows = workspace.session.windows.map(window => {
    const { displayId, persistentDisplayId: _, ...frame } = window.bounds;
    const from = savedDisplays.get(displayId)!.workArea, { display, same } = mapped.get(displayId)!, to = display.workArea;
    const sameSize = from.width === to.width && from.height === to.height;
    const layout = same && sameSize && from.x === to.x && from.y === to.y ? "exact" : sameSize ? "moved" : "scaled";
    placements.push({ windowId: window.id, displayId: display.id, layout });
    let next = frame;
    if (layout !== "exact") {
      const sx = to.width / from.width, sy = to.height / from.height;
      const width = Math.min(to.width, Math.max(MIN, Math.round(frame.width * sx))), height = Math.min(to.height, Math.max(MIN, Math.round(frame.height * sy)));
      const clamp = (value: number, min: number, size: number, extent: number) => Math.min(Math.max(value, min), min + extent - size);
      next = {
        x: clamp(Math.round(to.x + (frame.x - from.x) * sx), to.x, width, to.width),
        y: clamp(Math.round(to.y + (frame.y - from.y) * sy), to.y, height, to.height),
        width, height,
      };
    }
    return { ...window, bounds: { displayId: display.id, ...next, persistentDisplayId: display.persistentId } };
  });
  return { session: { ...workspace.session, windows }, placements };
}

async function fileSystem() {
  return import("@legendapp/spark-file-system").catch(cause => {
    throw new SparkError("E_MODULE_UNAVAILABLE", "Window workspaces need @legendapp/spark-file-system to store them in the app's data directory", { cause });
  });
}

/**
 * Saved, named window layouts for a navigator, persisted in the app's data directory and restored onto the displays
 * connected now. With `menu`, publishes a Workspaces menu: Save Workspace… and one item per workspace, with shortcuts.
 * Resolves once the menu is published. macOS only for now.
 */
function validLabels(labels: unknown): asserts labels is WorkspaceMenuLabels {
  if (!plain(labels) || !exactKeys(labels, ["workspaces", "save"]) || Object.values(labels).some(label => typeof label !== "string" || !label.trim())) throw new SparkError("E_INVALID_ARGUMENT", "Workspace menu labels need workspaces and save");
}
const isGone = (error: unknown) => ["E_NOT_FOUND", "E_CLOSED"].includes(nativeError(error).code);
/** The windows of `session` with these IDs, with the tab groups and key window that still apply to them. */
function subset(session: WindowSession, ids: Set<string>): WindowSession {
  const windows = session.windows.filter(window => ids.has(window.id));
  const tabGroups = session.tabGroups.map(group => ({ windowIds: group.windowIds.filter(id => ids.has(id)), selectedWindowId: group.selectedWindowId !== null && ids.has(group.selectedWindowId) ? group.selectedWindowId : null }))
    .filter(group => group.windowIds.length > 1);
  return { version: 1, windows, tabGroups, keyWindowId: session.keyWindowId !== null && ids.has(session.keyWindowId) ? session.keyWindowId : null };
}

export async function createWindowWorkspaces<T extends WindowsConfig>(navigator: WindowsNavigator<T>, options: WindowWorkspacesOptions = {}): Promise<WindowWorkspaces> {
  available();
  const check = sessionChecks.get(navigator);
  if (!check) throw new SparkError("E_INVALID_ARGUMENT", "Pass a navigator from createWindowsNavigator");
  if (!isObject(options) || Object.keys(options).some(key => key !== "menu" && key !== "onError")) throw new SparkError("E_INVALID_ARGUMENT", "Workspace options take menu and onError");
  if (options.onError !== undefined && typeof options.onError !== "function") throw new SparkError("E_INVALID_ARGUMENT", "onError must be a function");
  const menuOptions = options.menu;
  if (menuOptions !== undefined) {
    if (!isObject(menuOptions) || Object.keys(menuOptions).some(key => !["labels", "requestName", "saveShortcut", "restoreShortcuts"].includes(key)) || typeof menuOptions.requestName !== "function") throw new SparkError("E_INVALID_ARGUMENT", "The workspace menu needs requestName and takes labels, saveShortcut and restoreShortcuts");
    if (menuOptions.labels !== undefined) validLabels(menuOptions.labels);
    if (menuOptions.saveShortcut !== undefined && typeof menuOptions.saveShortcut !== "string") throw new SparkError("E_INVALID_ARGUMENT", "saveShortcut must be a string");
    if (menuOptions.restoreShortcuts !== undefined && (!Array.isArray(menuOptions.restoreShortcuts) || menuOptions.restoreShortcuts.some(item => typeof item !== "string"))) throw new SparkError("E_INVALID_ARGUMENT", "restoreShortcuts must be strings");
  }
  const report = options.onError ?? ((error: unknown) => console.error(error));
  const files = await fileSystem();
  const listeners = new Set<() => void>();
  // Menu owner and item IDs are this controller's own, so two controllers never share an item ID.
  const owner = `spark-workspaces-${++controllers}`;
  let location: Promise<string> | undefined, removed = false, menu: Menu | undefined;
  let labels = menuOptions?.labels ?? defaultLabels;
  let queue: Promise<unknown> = Promise.resolve();
  /** One operation at a time, in call order: a restore and a save never interleave. */
  const serial = <R>(operation: () => Promise<R>): Promise<R> => {
    if (removed) return Promise.reject(new SparkError("E_CLOSED", "Workspaces were removed"));
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  const path = () => location ??= files.getDirectory("data").then(async root => { await files.mkdir(root); return `${root}/${FILE}`; }).catch(error => { location = undefined; throw error; });
  /**
   * Reads the file every time (another controller or process may have written it), checking its size before reading
   * it. `text` is null without a file. A corrupt file rejects every operation until `clear()`.
   */
  const read = async (): Promise<{ text: string | null; list: WindowWorkspace[] }> => {
    const file = await path();
    let text: string;
    try {
      if ((await files.stat(file)).size > WORKSPACE_LIMITS.fileBytes) throw new SparkError("E_INVALID_DATA", `The workspaces file is larger than ${WORKSPACE_LIMITS.fileBytes} bytes: ${file}`);
      text = await files.readText(file);
    } catch (error) { if (nativeError(error).code === "E_NOT_FOUND") return { text: null, list: [] }; throw error; }
    return { text, list: parseWorkspaces(text, file) };
  };
  /**
   * Re-reads the file and replaces it only if nobody changed it since (compare and swap; a missing file is created only
   * if it is still missing). Retries a few times when another writer got in between, then rejects `E_BUSY`.
   */
  const mutate = async (change: (list: WindowWorkspace[]) => WindowWorkspace[] | undefined) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { text, list } = await read();
      const next = change(list);
      if (!next) return;
      if (next.length > WORKSPACE_LIMITS.workspaces) throw new SparkError("E_INVALID_ARGUMENT", `At most ${WORKSPACE_LIMITS.workspaces} workspaces can be saved`);
      const file = await path(), output = `${JSON.stringify({ version: 1, workspaces: next }, null, 2)}\n`;
      if (text !== null) {
        if ((await files.writeTextIfUnchanged(file, text, output)).written) return changed();
        continue;
      }
      try { await files.writeChunks(file, [new TextEncoder().encode(output)], { mode: "createNew" }); return changed(); }
      catch (error) { if (nativeError(error).code !== "E_ALREADY_EXISTS") throw error; }
    }
    throw new SparkError("E_BUSY", "The workspaces file kept changing while it was written; try again");
  };
  const find = (list: WindowWorkspace[], name: string) => {
    validName(name);
    const found = list.find(item => item.name === name);
    if (!found) throw new SparkError("E_NOT_FOUND", `No workspace is named ${name}`);
    return found;
  };

  const save = (name: string) => serial(async () => {
    validName(name);
    const displays = await getDisplays(), current = await navigator.getSession();
    if (current.windows.length > WORKSPACE_LIMITS.windows) throw new SparkError("E_INVALID_ARGUMENT", `A workspace holds at most ${WORKSPACE_LIMITS.windows} windows`);
    if (current.windows.some(window => !displays.some(display => display.id === window.bounds.displayId))) throw new SparkError("E_BUSY", "The displays changed while the workspace was saved; save it again");
    const fullscreen = await Promise.all(current.windows.map(window => getWindow(window.id).then(info => info.fullscreen, error => {
      if (isGone(error)) return false; // Closed since the session was read.
      throw error;
    })));
    const saved: WindowWorkspace = {
      name, savedAt: Date.now(),
      displays: displays.map(({ id, persistentId, primary, workArea }) => ({ id, persistentId, primary, workArea: { ...workArea } })),
      session: current, fullscreenWindowIds: current.windows.filter((_, index) => fullscreen[index]).map(window => window.id),
    };
    await mutate(list => {
      const index = list.findIndex(item => item.name === name);
      return index < 0 ? [...list, saved] : list.map((item, at) => at === index ? saved : item);
    });
    return saved;
  });
  /** Reopens the windows a restore closed, as they were. Reports a failure and resolves whether it worked. */
  const rollBack = async (previous: WindowSession, closed: Set<string>) => {
    if (!closed.size) return true;
    try { await navigator.restoreSession(subset(previous, closed)); return true; }
    catch (error) { report(error); return false; }
  };
  const restore = (name: string) => serial(async (): Promise<WorkspaceRestoreResult> => {
    const saved = find((await read()).list, name);
    const { session: adapted, placements } = adaptWorkspace(saved, await getDisplays());
    check(adapted);
    // What is open now, to reopen if the restore stops or fails after closing windows.
    const previous = await navigator.getSession(), closed = new Set<string>();
    for (const window of navigator.list()) {
      if (!window.isOpen()) continue;
      let result: CloseResult;
      try { result = await window.close(); }
      catch (error) { if (isGone(error)) { closed.add(window.id); continue; } return { restored: false, reason: "failed", error, rolledBack: await rollBack(previous, closed) }; }
      if (!result.closed) return { restored: false, reason: result.reason, windowId: window.id, rolledBack: await rollBack(previous, closed) };
      closed.add(window.id);
    }
    let windows: WindowInstance[] = [];
    try {
      windows = await navigator.restoreSession(adapted);
      for (const id of saved.fullscreenWindowIds) await setWindowFullscreen(id, true);
    } catch (error) {
      await Promise.allSettled(windows.map(window => window.isOpen() ? window.close() : undefined));
      return { restored: false, reason: "failed", error, rolledBack: await rollBack(previous, closed) };
    }
    return { restored: true, windows, placements };
  });
  const rename = (name: string, newName: string) => serial(async () => {
    validName(name); validName(newName);
    await mutate(list => {
      const found = find(list, name);
      if (newName === name) return undefined;
      if (list.some(item => item.name === newName)) throw new SparkError("E_ALREADY_EXISTS", `A workspace is already named ${newName}`);
      return list.map(item => item === found ? { ...item, name: newName } : item);
    });
  });
  const remove = (name: string) => serial(async () => {
    validName(name);
    await mutate(list => { const found = find(list, name); return list.filter(item => item !== found); });
  });
  const clear = () => serial(async () => {
    try { await files.remove(await path()); }
    catch (error) { if (nativeError(error).code !== "E_NOT_FOUND") throw error; }
    changed();
  });

  // The Workspaces menu lists the workspaces from the last successful read. Each name keeps one item ID for this
  // controller's lifetime (a renamed workspace gets a new one), so a click always names the workspace its item showed.
  const itemIds = new Map<string, string>(), itemNames = new Map<string, string>();
  const itemId = (name: string) => {
    let id = itemIds.get(name);
    if (!id) { id = `${owner}-restore-${itemIds.size + 1}`; itemIds.set(name, id); itemNames.set(id, name); }
    return id;
  };
  const saveId = `${owner}-save`;
  const menuItems = (names: string[]): MenuRootItem[] => {
    const { saveShortcut, restoreShortcuts = [] } = menuOptions!;
    const restoreItems: MenuItem[] = names.map((name, index) => ({ type: "action", id: itemId(name), label: name, ...(restoreShortcuts[index] ? { shortcut: restoreShortcuts[index] } : {}) }));
    return [{ type: "submenu", id: owner, label: labels.workspaces, placement: { before: { menu: "window" } }, items: [
      { type: "action", id: saveId, label: labels.save, ...(saveShortcut ? { shortcut: saveShortcut } : {}) },
      ...(restoreItems.length ? [{ type: "separator" } as const, ...restoreItems] : []),
    ] }];
  };
  const names = async () => {
    try { return (await read()).list.map(item => item.name); }
    catch (error) { report(error); return []; }
  };
  let publishing: Promise<void> = Promise.resolve();
  const publish = () => publishing = publishing.then(async () => {
    if (!menu || removed) return;
    await menu.update({ items: menuItems(await names()) });
  }).catch(report);
  function changed() {
    for (const listener of [...listeners]) { try { listener(); } catch (error) { report(error); } }
    void publish();
  }
  const onAction = (action: MenuAction) => {
    const run = async () => {
      if (action.itemId === saveId) {
        const name = await menuOptions!.requestName();
        if (name !== null) await save(name);
        return;
      }
      const name = itemNames.get(action.itemId);
      if (name === undefined) return;
      const result = await restore(name);
      if (!result.restored && result.reason === "failed") report(result.error);
    };
    run().catch(report);
  };
  if (menuOptions) {
    const { createMenu } = await import("@legendapp/spark-native-menu").catch(cause => {
      throw new SparkError("E_MODULE_UNAVAILABLE", "The workspace menu requires @legendapp/spark-native-menu", { cause });
    });
    menu = await createMenu({ id: owner, items: menuItems(await names()), onAction });
  }

  return {
    list: () => serial(async () => (await read()).list),
    save, restore, rename, delete: remove, clear,
    subscribe(listener) {
      if (typeof listener !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected a listener");
      listeners.add(listener);
      return { remove() { listeners.delete(listener); } };
    },
    async setMenuLabels(next) {
      if (removed) throw new SparkError("E_CLOSED", "Workspaces were removed");
      if (!menu) throw new SparkError("E_INVALID_ARGUMENT", "These workspaces were created without a menu");
      validLabels(next);
      labels = { ...next };
      await publish();
    },
    remove: asyncRegistration(() => { removed = true; listeners.clear(); }, async () => { await publishing; await menu?.remove(); }).remove,
  };
}
