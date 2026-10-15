import { Platform } from "react-native";
import { SparkError, asyncRegistration, nativeError, type AsyncRegistration, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
export type { AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
import { onDesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import Native from "./NativeDesktopWindowManager";
import { createMacOSWindow, macosNative, updateMacOSWindow } from "./macos-adapter";
import { bounds, keys, number, object, text, validateOptions, windowId } from "./validation";
import { getNativeDisplays, isBounds, isInfo, record, subscribeToWindowInstance, windowCall, windowCommand, type NativeWindowInfo } from "./transport";
import type { CenterWindowOptions, CloseResult, CursorPoint, DisplayInfo, SetWindowBoundsOptions, ShowWindowOptions, WindowBounds, WindowEventMap, WindowInfo, WindowOpenOptions, WindowUpdateOptions } from "./types";
export type * from "./types";

export function getWindowAvailability(): Availability {
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return { available: false, reason: "unsupported-platform" };
  if (!Native) return { available: false, reason: "missing-module" };
  if (Platform.OS === "macos") try { macosNative(); } catch { return { available: false, reason: "missing-module" }; }
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
      const info = await windowCall("completeOpen", snapshot, isInfo);
      // Common chrome is applied first; explicit AppKit groups own their corresponding fields.
      if (!snapshot.macos && snapshot.appearance === undefined && snapshot.backgroundColor === undefined) return publicInfo(info);
      await updateMacOSWindow(snapshot.id, snapshot);
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
  if (!snapshot.macos || Object.keys(snapshot).some(key => key !== "macos")) {
    await windowCommand("options", { id, options: snapshot });
  }
  if (Platform.OS === "macos" && (snapshot.macos || snapshot.appearance !== undefined || snapshot.backgroundColor !== undefined)) await updateMacOSWindow(id, snapshot);
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
/** Registration acknowledges the live native instance. Removal stops callbacks immediately. */
export async function addWindowListener<K extends keyof WindowEventMap>(id: string, type: K, listener: (event: WindowEventMap[K]) => void, options: WindowListenerOptions = {}): Promise<AsyncRegistration> {
  windowId(id); object(options, "listener options"); keys(options, ["onError"]);
  if (!["focusChanged", "boundsChanged", "visibilityChanged", "fullscreenChanged", "closed"].includes(type) || typeof listener !== "function" || (options.onError !== undefined && typeof options.onError !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Invalid window listener");
  return subscribeToWindowInstance(id, event => {
    if (event.type !== type) return;
    const valid = type === "closed" || (type === "boundsChanged" ? isBounds(event.bounds) : typeof event[type === "focusChanged" ? "focused" : type === "visibilityChanged" ? "visible" : "fullscreen"] === "boolean");
    if (!valid) { report(options, new SparkError("E_INVALID_DATA", "Malformed window event")); return; }
    const payload = { windowId: id, ...(type === "boundsChanged" ? { bounds: event.bounds } : type === "focusChanged" ? { focused: event.focused } : type === "visibilityChanged" ? { visible: event.visible } : type === "fullscreenChanged" ? { fullscreen: event.fullscreen } : {}) };
    try { listener(payload as WindowEventMap[K]); } catch (cause) { report(options, cause); }
  }, [type]);
}
interface CloseGuardOwner {
  handler: () => boolean | Promise<boolean>;
  options: WindowListenerOptions;
  stopped: boolean;
  registration: AsyncRegistration;
}
interface CloseGuard {
  owner?: CloseGuardOwner;
  acquire(handler: CloseGuardOwner["handler"], options: WindowListenerOptions): AsyncRegistration;
}
const guards = new Map<string, CloseGuard>();
const creatingGuards = new Set<string>();
const orphanGuards = new Map<string, AsyncRegistration>();
let guardSequence = 0;
/** One owner per window. Replacement waits for removal; native protection survives the handoff. */
export async function beforeWindowClose(id: string, handler: () => boolean | Promise<boolean>, options: WindowListenerOptions = {}): Promise<AsyncRegistration> {
  windowId(id); object(options, "guard options"); keys(options, ["onError"]);
  if (typeof handler !== "function" || (options.onError !== undefined && typeof options.onError !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Expected window close callbacks");
  if (creatingGuards.has(id)) throw new SparkError("E_BUSY", "Window already has a close guard");
  creatingGuards.add(id);
  try {
    if (orphanGuards.has(id)) { await orphanGuards.get(id)!.remove(); orphanGuards.delete(id); }
    const existing = guards.get(id);
    if (existing) {
      if (existing.owner && !existing.owner.stopped) throw new SparkError("E_BUSY", "Window already has a close guard");
      if (existing.owner) await existing.owner.registration.remove();
      if (guards.get(id) === existing) return existing.acquire(handler, options);
    }
    return await createCloseGuard(id, handler, options);
  } finally { creatingGuards.delete(id); }
}
async function createCloseGuard(id: string, handler: CloseGuardOwner["handler"], options: WindowListenerOptions): Promise<AsyncRegistration> {
  const guardId = `close-${Date.now()}-${++guardSequence}`;
  let closed = false, instance: string | undefined, request: number | undefined, latestRequest = 0;
  let subscription: ReturnType<typeof onDesktopEvent>;
  const stop = () => { closed = true; request = undefined; subscription.remove(); if (guards.get(id) === guard) guards.delete(id); };
  const guard: CloseGuard = { acquire(handler, options) {
    const owner: CloseGuardOwner = { handler, options, stopped: false, registration: asyncRegistration(() => {
      owner.stopped = true; request = undefined;
    }, async () => {
      // Keep the native dispatcher installed for this window instance. Re-arming
      // acknowledges removal and cancels pending decisions without an unguarded gap.
      try { if (!closed && instance) await windowCommand("closeGuard", { id, instanceId: instance, guardId, enabled: true }); }
      catch (cause) { if (nativeError(cause).code !== "E_NOT_FOUND") throw cause; stop(); }
      if (guard.owner === owner) guard.owner = undefined;
    }) };
    guard.owner = owner;
    return owner.registration;
  } };
  const registration = guard.acquire(handler, options);
  subscription = onDesktopEvent(event => {
    if (closed || event.windowId !== id || event.instanceId !== instance) return;
    if (event.type === "closed") { stop(); return; }
    if (event.guardId !== guardId) return;
    const owner = guard.owner;
    if (event.type === "closeGuardTimeout") { request = undefined; if (owner && !owner.stopped) report(owner.options, new SparkError("E_TIMEOUT", "Window close guard exceeded 30 seconds")); return; }
    if (event.type !== "beforeClose" || !Number.isSafeInteger(event.requestId) || (event.requestId as number) <= latestRequest) return;
    const current = latestRequest = request = event.requestId as number;
    void Promise.resolve().then(() => owner ? !owner.stopped && owner.handler() : true).catch(cause => { if (owner && !owner.stopped) report(owner.options, cause); return false; }).then(async allow => {
      if (closed || request !== current) return;
      await windowCommand("replyClose", { id, instanceId: instance, guardId, requestId: current, allow: guard.owner === owner && allow === true });
    }).catch(cause => { if (owner && !owner.stopped) report(owner.options, cause); }).finally(() => { if (request === current) request = undefined; });
  }, { types: ["closed", "beforeClose", "closeGuardTimeout"], target: { field: "windowId", value: id } });
  try {
    instance = (await windowCall("observe", { id }, isInfo)).instanceId;
    await windowCommand("closeGuard", { id, instanceId: instance, guardId, enabled: true });
    if (!closed) guards.set(id, guard);
    return registration;
  } catch (cause) {
    const cleanup = asyncRegistration(stop, async () => {
      try { if (instance) await windowCommand("closeGuard", { id, instanceId: instance, guardId, enabled: false }); }
      catch (cause) { if (nativeError(cause).code !== "E_NOT_FOUND") throw cause; }
    });
    try { await cleanup.remove(); } catch (error) { orphanGuards.set(id, cleanup); report(options, error); }
    throw cause;
  }
}
