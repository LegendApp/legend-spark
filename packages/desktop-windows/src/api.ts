import { Platform } from "react-native";
import { titleChanged } from "./title-changes";
import { SparkError, asyncRegistration, nativeError, type AsyncRegistration, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
export type { AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
import { onDesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import Native from "./NativeDesktopWindowManager";
import { COMMON_MACOS, appKitOptions, createMacOSWindow, macosNative, updateMacOSWindow } from "./macos-adapter";
import { bounds, keys, number, object, text, validateOptions, windowId } from "./validation";
import { getNativeDisplays, isBounds, isInfo, record, subscribeToWindowInstance, windowCall, windowCommand, type NativeWindowInfo } from "./transport";
import type { CenterWindowOptions, CloseResult, CursorPoint, DisplayInfo, SetWindowBoundsOptions, ShowWindowOptions, ToolbarFeature, WindowBounds, WindowEventMap, WindowInfo, WindowNewTabEvent, WindowOpenOptions, WindowOption, WindowTabGroup, WindowUpdateOptions } from "./types";
export type * from "./types";

const WINDOW_OPTIONS: readonly WindowOption[] = ["aspectRatio", "opacity", "contentProtection", "ignoreMouseEvents", "tabbing", "spaces", "simpleFullscreen", "documentEdited", "backgroundMaterial", "subtitle", "trafficLightPosition", "fullScreenAuxiliary", "stationary", "ignoresCycle", "cornerSnapping"];
/** With an option, reports whether this platform implements it. Every listed option is macOS-only today; unlisted options work wherever windows do. */
export function getWindowAvailability(option?: WindowOption): Availability {
  if (option !== undefined && !WINDOW_OPTIONS.includes(option)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown window option");
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return { available: false, reason: "unsupported-platform" };
  if (!Native) return { available: false, reason: "missing-module" };
  if (Platform.OS === "macos") try { macosNative(); } catch { return { available: false, reason: "missing-module" }; }
  if (option !== undefined && Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  return { available: true };
}
const TOOLBAR_FEATURES: readonly ToolbarFeature[] = ["customization", "displayMode", "overflow", "shown", "sidebarToggle"];
/**
 * Window toolbars (`macos.toolbar`) are an AppKit `NSToolbar`. Windows has no toolbar yet: every feature
 * reports `unsupported-platform` there, and toolbar options reject with `E_UNSUPPORTED_OPTION`.
 */
export function getToolbarAvailability(feature?: ToolbarFeature): Availability {
  if (feature !== undefined && !TOOLBAR_FEATURES.includes(feature)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown toolbar feature");
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  try { macosNative(); } catch { return { available: false, reason: "missing-module" }; }
  return { available: true };
}
function publicInfo(value: NativeWindowInfo): WindowInfo {
  const { id, kind, title, parentId, modal, visible, focused, minimized, maximized, fullscreen, bounds: { displayId, x, y, width, height } } = value;
  return { id, kind, title, parentId, modal, visible, focused, minimized, maximized, fullscreen, bounds: { displayId, x, y, width, height } };
}
export async function openWindow(options: WindowOpenOptions): Promise<WindowInfo> {
  validateOptions(options, Platform.OS, true);
  // Optional undefined fields may be omitted; props have already undergone strict JSON validation.
  const snapshot = JSON.parse(JSON.stringify(options)) as WindowOpenOptions;
  if (snapshot.kind === "overlay") Object.assign(snapshot, { titleBarStyle: "borderless", transparent: true, hasShadow: false, alwaysOnTop: true, resizable: false, minimizable: false, ...snapshot });
  if (Platform.OS === "macos") {
    if (snapshot.kind === "overlay" && options.alwaysOnTop === undefined && options.macos?.level === undefined) {
      snapshot.macos = { ...snapshot.macos, level: "status" };
      delete snapshot.alwaysOnTop;
    }
    await createMacOSWindow(snapshot);
    try {
      // Simple fullscreen hides the chrome applied below, so it is entered last.
      const simpleFullscreen = snapshot.macos?.simpleFullscreen;
      if (simpleFullscreen !== undefined) delete snapshot.macos!.simpleFullscreen;
      const info = await windowCall("completeOpen", snapshot, isInfo);
      // Common chrome is applied first; explicit AppKit groups own their corresponding fields.
      const appKit = appKitOptions(snapshot.macos);
      if (!appKit && !simpleFullscreen) return publicInfo(info);
      if (appKit) await updateMacOSWindow(snapshot.id, appKit);
      if (simpleFullscreen) await windowCommand("options", { id: snapshot.id, options: { macos: { simpleFullscreen } } });
      // The window now exists: reflect the applied chrome, but a transient read-back
      // failure must not discard a window that opened successfully, so fall back to info.
      try { return await getWindow(snapshot.id); } catch { return publicInfo(info); }
    } catch (cause) {
      try { await windowCommand("discard", { id: snapshot.id }); }
      catch (cleanup) { throw new SparkError("E_NATIVE", "Window opening and cleanup both failed", { cause: new AggregateError([cause, cleanup]) }); }
      throw cause;
    }
  }
  return publicInfo(await windowCall("open", snapshot, isInfo));
}
export async function getWindow(id: string): Promise<WindowInfo> { windowId(id); return publicInfo(await windowCall("info", { id }, isInfo)); }
export async function listWindows(): Promise<WindowInfo[]> { return (await windowCall("list", {}, (value): value is NativeWindowInfo[] => Array.isArray(value) && value.every(isInfo))).map(publicInfo); }
export async function getDisplays(): Promise<DisplayInfo[]> { return getNativeDisplays(); }
/** Pointer position in Spark's coordinate vocabulary: logical units relative to the containing display's top-left corner. */
export async function getCursorPoint(): Promise<CursorPoint> { return windowCall("cursorPoint", {}, (value): value is CursorPoint => record(value) && typeof value.displayId === "string" && Number.isFinite(value.x) && Number.isFinite(value.y)); }
export async function setWindowOptions(id: string, options: WindowUpdateOptions): Promise<void> {
  windowId(id); validateOptions(options, Platform.OS, false);
  const snapshot = JSON.parse(JSON.stringify(options)) as WindowUpdateOptions;
  // Publish each field to the module that owns it. The window module also checks title-bar
  // changes against simple fullscreen, so any titleBar group goes through it first.
  const appKit = appKitOptions(snapshot.macos);
  if (!snapshot.macos || Object.keys(snapshot).some(key => key !== "macos") || snapshot.macos.titleBar || Object.keys(snapshot.macos).some(key => COMMON_MACOS.includes(key))) {
    await windowCommand("options", { id, options: snapshot });
    if (snapshot.title !== undefined) titleChanged(id);
  }
  if (appKit) await updateMacOSWindow(id, appKit);
}
/** Portable frame change. Animated moves are macOS-only: pass `macos.durationMs` and the call rejects on Windows rather than ignoring the request. */
export async function setWindowBounds(id: string, value: WindowBounds, options: SetWindowBoundsOptions = {}): Promise<void> {
  windowId(id); bounds(value); object(options, "bounds options"); keys(options, ["macos"]);
  if (options.macos !== undefined) {
    if (Platform.OS !== "macos") throw new SparkError("E_UNSUPPORTED_OPTION", "macos bounds options require macOS");
    const macos = options.macos; object(macos, "macos"); keys(macos, ["durationMs"]);
    if (macos.durationMs !== undefined) number(macos.durationMs, "durationMs", 0, 60000);
    await windowCommand("bounds", { id, bounds: value, durationMs: macos.durationMs ?? 0 });
    return;
  }
  await windowCommand("bounds", { id, bounds: value });
}
export async function showWindow(id: string, options: ShowWindowOptions = {}): Promise<void> {
  windowId(id); object(options, "show options"); keys(options, ["focus"]);
  if (options.focus !== undefined && typeof options.focus !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "focus must be boolean");
  await windowCommand("show", { id, focus: options.focus ?? true });
}
export async function centerWindow(id: string, options: CenterWindowOptions = {}): Promise<void> {
  windowId(id); object(options, "center options"); keys(options, ["displayId"]);
  if (options.displayId !== undefined) text(options.displayId, "display ID", false);
  await windowCommand("center", { id, ...options });
}
export async function hideWindow(id: string): Promise<void> { windowId(id); await windowCommand("hide", { id }); }
export async function minimizeWindow(id: string): Promise<void> { windowId(id); await windowCommand("minimize", { id }); }
export async function maximizeWindow(id: string): Promise<void> { windowId(id); await windowCommand("maximize", { id }); }
export async function unmaximizeWindow(id: string): Promise<void> { windowId(id); await windowCommand("unmaximize", { id }); }
export async function setWindowFullscreen(id: string, enabled: boolean): Promise<void> {
  windowId(id); if (typeof enabled !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "fullscreen must be boolean");
  await windowCommand("fullscreen", { id, enabled });
}
const closing = new Map<string, Promise<CloseResult>>();
export async function closeWindow(id: string): Promise<CloseResult> {
  windowId(id);
  let pending = closing.get(id);
  if (!pending) {
    pending = windowCall("close", { id }, (value): value is CloseResult => record(value) && (value.closed === true || (value.closed === false && value.reason === "vetoed"))).finally(() => closing.delete(id));
    closing.set(id, pending);
  }
  return pending;
}
export interface WindowListenerOptions { onError?: (error: SparkError) => void }
function report(options: WindowListenerOptions, cause: unknown) { try { (options.onError ?? console.error)(nativeError(cause)); } catch (error) { console.error(error); } }
const TAB_EVENTS: readonly string[] = ["tabGroupChanged", "tabSelectionChanged"];
/** Window pools (`windows/pool.ts`): park on close, hand a warm root new props, close for real. Not public. */
export async function windowPoolCommand(method: "pool" | "rootProps" | "discard", args: { id: string } & Record<string, unknown>): Promise<void> { await windowCommand(method, args); }
/** The process's physical footprint in bytes. Not public. */
export async function processFootprint(): Promise<number> { return (await windowCall("footprint", {}, (value): value is { bytes: number } => record(value) && Number.isSafeInteger(value.bytes) && (value.bytes as number) >= 0)).bytes; }
/** Registration acknowledges the live native instance. Removal stops callbacks immediately. */
export async function addWindowListener<K extends keyof WindowEventMap>(id: string, type: K, listener: (event: WindowEventMap[K]) => void, options: WindowListenerOptions = {}): Promise<AsyncRegistration> {
  windowId(id); object(options, "listener options"); keys(options, ["onError"]);
  if (!["focusChanged", "boundsChanged", "visibilityChanged", "fullscreenChanged", "occlusionChanged", "closed", ...TAB_EVENTS].includes(type) || typeof listener !== "function" || (options.onError !== undefined && typeof options.onError !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Invalid window listener");
  if (TAB_EVENTS.includes(type)) tabsSupported();
  if (type === "occlusionChanged" && Platform.OS !== "macos") throw new SparkError("E_UNSUPPORTED_PLATFORM", "Window occlusion events require macOS");
  return subscribeToWindowInstance(id, event => {
    if (event.type !== type) return;
    const valid = type === "closed" || (type === "boundsChanged" ? isBounds(event.bounds) : type === "tabGroupChanged" ? isTabGroup(event.tabGroup) : type === "tabSelectionChanged" ? nullableId(event.selectedWindowId) : typeof event[type === "focusChanged" ? "focused" : type === "visibilityChanged" ? "visible" : type === "occlusionChanged" ? "occluded" : "fullscreen"] === "boolean");
    if (!valid) { report(options, new SparkError("E_INVALID_DATA", "Malformed window event")); return; }
    const payload = { windowId: id, ...(type === "boundsChanged" ? { bounds: event.bounds } : type === "focusChanged" ? { focused: event.focused } : type === "visibilityChanged" ? { visible: event.visible } : type === "occlusionChanged" ? { occluded: event.occluded } : type === "fullscreenChanged" ? { fullscreen: event.fullscreen } : type === "tabGroupChanged" ? { tabGroup: tabGroup(event.tabGroup as WindowTabGroup) } : type === "tabSelectionChanged" ? { selectedWindowId: event.selectedWindowId } : {}) };
    try { listener(payload as WindowEventMap[K]); } catch (cause) { report(options, cause); }
  }, [type]);
}

// Native window tabs (docs/api-window-contract.md#window-tabs). macOS only; Windows follow-up #295.
function tabsSupported() { if (Platform.OS !== "macos") throw new SparkError("E_UNSUPPORTED_PLATFORM", "Native window tabs require macOS"); }
const nullableId = (value: unknown): value is string | null => value === null || (typeof value === "string" && !!value);
const isTabGroup = (value: unknown): value is WindowTabGroup => record(value) && Array.isArray(value.windowIds) && value.windowIds.every(id => typeof id === "string" && !!id) && nullableId(value.selectedWindowId) && typeof value.tabBarVisible === "boolean";
const tabGroup = ({ windowIds, selectedWindowId, tabBarVisible }: WindowTabGroup): WindowTabGroup => ({ windowIds, selectedWindowId, tabBarVisible });
/** The Spark windows that share this window's tab group, in tab order. */
export async function getWindowTabGroup(id: string): Promise<WindowTabGroup> { windowId(id); tabsSupported(); return tabGroup(await windowCall("tabGroup", { id }, isTabGroup)); }
/** Every Spark window's tab group, each once, in no particular order. */
export async function listWindowTabGroups(): Promise<WindowTabGroup[]> { tabsSupported(); return (await windowCall("tabGroups", {}, (value): value is WindowTabGroup[] => Array.isArray(value) && value.every(isTabGroup))).map(tabGroup); }
/** Makes this window the selected tab of its group. */
export async function selectWindowTab(id: string): Promise<void> { windowId(id); tabsSupported(); await windowCommand("selectTab", { id }); }
/** Moves this tab out of its group into a window of its own (Window ▸ Move Tab to New Window). */
export async function moveTabToNewWindow(id: string): Promise<void> { windowId(id); tabsSupported(); await windowCommand("moveTabToNewWindow", { id }); }
/** Moves every shown window with this window's tabbing identifier into its tab group (Window ▸ Merge All Windows). */
export async function mergeAllWindows(id: string): Promise<void> { windowId(id); tabsSupported(); await windowCommand("mergeAllWindows", { id }); }
/** Shows or hides the tab bar of a window that has no other tabs; a group of several tabs always shows it and rejects E_BUSY. */
export async function setWindowTabBarVisible(id: string, visible: boolean): Promise<void> {
  windowId(id); if (typeof visible !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "visible must be boolean");
  tabsSupported(); await windowCommand("tabBar", { id, visible });
}
let tabHandlerSequence = 0;
/**
 * Shows the tab bar's + button on this window; a click, or the `newTab` menu role while the window is key,
 * calls the handler, which opens the new tab (`openWindow({ ..., tabbedWith: windowId })`). One handler per
 * window: a second registration rejects E_BUSY until the first is removed. Removal hides the button.
 */
export async function handleWindowNewTab(id: string, handler: (event: WindowNewTabEvent) => unknown, options: WindowListenerOptions = {}): Promise<AsyncRegistration> {
  windowId(id); object(options, "handler options"); keys(options, ["onError"]);
  if (typeof handler !== "function" || (options.onError !== undefined && typeof options.onError !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Expected new-tab callbacks");
  tabsSupported();
  const handlerId = `tab-${Date.now()}-${++tabHandlerSequence}`;
  const subscription = await subscribeToWindowInstance(id, event => {
    if (event.type !== "newTabRequested" || event.handlerId !== handlerId) return;
    void Promise.resolve().then(() => handler({ windowId: id })).catch(cause => report(options, cause));
  }, ["newTabRequested"]);
  const disable = async () => {
    try { await windowCommand("newTab", { id, handlerId, enabled: false }); }
    catch (cause) { if (nativeError(cause).code !== "E_NOT_FOUND") throw cause; }
  };
  try { await windowCommand("newTab", { id, handlerId, enabled: true }); }
  catch (cause) { await subscription.remove(); throw cause; }
  return asyncRegistration(() => { void subscription.remove(); }, disable);
}
const guards = new Map<string, AsyncRegistration>();
const creatingGuards = new Set<string>();
const orphanGuards = new Map<string, AsyncRegistration>();
let guardSequence = 0;
/** Each window accepts one close guard; a second registration rejects E_BUSY until the first is removed. Removal is idempotent. */
export async function beforeWindowClose(id: string, handler: () => boolean | Promise<boolean>, options: WindowListenerOptions = {}): Promise<AsyncRegistration> {
  windowId(id); object(options, "guard options"); keys(options, ["onError"]);
  if (typeof handler !== "function" || (options.onError !== undefined && typeof options.onError !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Expected window close callbacks");
  if (orphanGuards.has(id)) { await orphanGuards.get(id)!.remove(); orphanGuards.delete(id); }
  if (guards.has(id) || creatingGuards.has(id)) throw new SparkError("E_BUSY", "Window already has a close guard");
  creatingGuards.add(id);
  const guardId = `close-${Date.now()}-${++guardSequence}`;
  let stopped = false, instance: string | undefined, request: number | undefined, latestRequest = 0;
  let subscription: ReturnType<typeof onDesktopEvent>;
  try { subscription = onDesktopEvent(event => {
    if (stopped || event.windowId !== id || event.instanceId !== instance) return;
    if (event.type === "closed") { stopped = true; subscription.remove(); guards.delete(id); return; }
    if (event.guardId !== guardId) return;
    if (event.type === "closeGuardTimeout") { request = undefined; report(options, new SparkError("E_TIMEOUT", "Window close guard exceeded 30 seconds")); return; }
    if (event.type !== "beforeClose" || !Number.isSafeInteger(event.requestId) || (event.requestId as number) <= latestRequest) return;
    const current = latestRequest = request = event.requestId as number;
    void Promise.resolve().then(() => stopped ? false : handler()).catch(cause => { report(options, cause); return false; }).then(async allow => {
      if (stopped || request !== current) return;
      await windowCommand("replyClose", { id, instanceId: instance, guardId, requestId: current, allow: allow === true });
    }).catch(cause => report(options, cause)).finally(() => { if (request === current) request = undefined; });
  }, { types: ["closed", "beforeClose", "closeGuardTimeout"], target: { field: "windowId", value: id } }); } catch (cause) { creatingGuards.delete(id); throw cause; }
  const registration = asyncRegistration(() => { stopped = true; subscription.remove(); }, async () => {
    try { if (instance) await windowCommand("closeGuard", { id, instanceId: instance, guardId, enabled: false }); }
    catch (cause) { if (nativeError(cause).code !== "E_NOT_FOUND") throw cause; }
    if (guards.get(id) === registration) guards.delete(id);
  });
  try {
    instance = (await windowCall("observe", { id }, isInfo)).instanceId;
    await windowCommand("closeGuard", { id, instanceId: instance, guardId, enabled: true });
    if (!stopped) guards.set(id, registration); return registration;
  } catch (cause) {
    try { await registration.remove(); } catch (cleanup) { orphanGuards.set(id, registration); report(options, cleanup); }
    throw cause;
  } finally { creatingGuards.delete(id); }
}
