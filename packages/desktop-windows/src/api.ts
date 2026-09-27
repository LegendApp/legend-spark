import { Platform } from "react-native";
import { SparkError, asyncRegistration, invokeNative, nativeError, parseNativeResult, type Availability, type AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
import { onDesktopEvent, type DesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import Native from "./NativeDesktopWindowManager";
import { createMacOSWindow, macosNative, updateMacOSWindow } from "./macos-adapter";
import { bounds, keys, object, text, validateOptions, windowId } from "./validation";
import type { CenterWindowOptions, CloseResult, DisplayInfo, ShowWindowOptions, WindowBounds, WindowEventMap, WindowInfo, WindowOpenOptions, WindowUpdateOptions } from "./types";
export type * from "./types";

export async function getWindowAvailability(): Promise<Availability> {
  if (Platform.OS !== "macos" && Platform.OS !== "windows") return { available: false, reason: "unsupported-platform" };
  if (!Native) return { available: false, reason: "missing-module" };
  if (Platform.OS === "macos") try { macosNative(); } catch { return { available: false, reason: "missing-module" }; }
  return { available: true };
}
export async function windowCall<T>(method: string, args: object, validate: (value: unknown) => value is T): Promise<T> {
  if (Platform.OS !== "macos" && Platform.OS !== "windows") throw new SparkError("E_UNSUPPORTED_PLATFORM", "Windows require a desktop host");
  if (!Native) throw new SparkError("E_MODULE_UNAVAILABLE", "The window module is unavailable");
  const native = Native;
  return parseNativeResult(await invokeNative(() => native.call(method, JSON.stringify(args))), validate);
}
export async function windowCommand(method: string, args: object): Promise<void> { await windowCall(method, args, (value): value is null => value === null); }
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isSize = (value: unknown) => record(value) && finite(value.width) && value.width > 0 && finite(value.height) && value.height > 0;
const isBounds = (value: unknown): value is WindowBounds => record(value) && isSize(value) && finite(value.x) && finite(value.y) && typeof value.displayId === "string" && !!value.displayId;
interface NativeWindowInfo extends WindowInfo { instanceId: string }
const isInfo = (value: unknown): value is NativeWindowInfo => record(value) && typeof value.id === "string" && typeof value.instanceId === "string" && !!value.instanceId && ["window", "overlay"].includes(value.kind) && typeof value.title === "string" && (value.parentId === null || typeof value.parentId === "string") && [value.modal, value.visible, value.focused, value.minimized, value.fullscreen].every(flag => typeof flag === "boolean") && isBounds(value.bounds);
function publicInfo(value: NativeWindowInfo): WindowInfo {
  const { id, kind, title, parentId, modal, visible, focused, minimized, fullscreen, bounds: { displayId, x, y, width, height } } = value;
  return { id, kind, title, parentId, modal, visible, focused, minimized, fullscreen, bounds: { displayId, x, y, width, height } };
}
export async function openWindow(options: WindowOpenOptions): Promise<WindowInfo> {
  validateOptions(options, Platform.OS, true);
  // Optional undefined fields may be omitted; props have already undergone strict JSON validation.
  const snapshot = JSON.parse(JSON.stringify(options)) as WindowOpenOptions;
  if (snapshot.kind === "overlay") Object.assign(snapshot, { titleBarStyle: "borderless", transparent: true, hasShadow: false, alwaysOnTop: true, resizable: false, minimizable: false, ...snapshot });
  if (Platform.OS === "macos") {
    await createMacOSWindow(snapshot);
    try {
      const info = await windowCall("completeOpen", snapshot, isInfo);
      // Common chrome is applied first; explicit AppKit groups own their corresponding fields.
      if (snapshot.macos) await updateMacOSWindow(snapshot.id, snapshot.macos);
      return snapshot.macos ? getWindow(snapshot.id) : publicInfo(info);
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
export async function getDisplays(): Promise<DisplayInfo[]> {
  return windowCall("displays", {}, (value): value is DisplayInfo[] => Array.isArray(value) && value.length > 0 && value.every(item => record(item) && typeof item.id === "string" && !!item.id && (item.persistentId === null || typeof item.persistentId === "string") && typeof item.name === "string" && typeof item.primary === "boolean" && isSize(item.size) && isSize(item.workArea) && finite(item.workArea.x) && finite(item.workArea.y) && finite(item.scaleFactor) && item.scaleFactor > 0) && value.filter(item => item.primary).length === 1 && new Set(value.map(item => item.id)).size === value.length);
}
export async function setWindowOptions(id: string, options: WindowUpdateOptions): Promise<void> {
  windowId(id); validateOptions(options, Platform.OS, false);
  const snapshot = JSON.parse(JSON.stringify(options)) as WindowUpdateOptions;
  await windowCommand("options", { id, options: snapshot });
  if (snapshot.macos) await updateMacOSWindow(id, snapshot.macos);
}
export async function setWindowBounds(id: string, value: WindowBounds): Promise<void> { windowId(id); bounds(value); await windowCommand("bounds", { id, bounds: value }); }
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
/** Internal lifetime binding shared by ordinary and AppKit events. */
export async function subscribeToWindowInstance(id: string, listener: (event: DesktopEvent) => void): Promise<AsyncRegistration> {
  windowId(id);
  let instance: string | undefined, stopped = false;
  const buffered: DesktopEvent[] = [];
  const consume = (event: DesktopEvent) => {
    if (stopped || event.windowId !== id) return;
    if (!instance) { buffered.push(event); return; }
    if (event.instanceId !== instance) return;
    try { listener(event); } finally { if (event.type === "closed") { stopped = true; subscription.remove(); } }
  };
  const subscription = onDesktopEvent(consume);
  try { instance = (await windowCall("observe", { id }, isInfo)).instanceId; buffered.splice(0).forEach(consume); }
  catch (cause) { stopped = true; subscription.remove(); throw cause; }
  return asyncRegistration(() => { stopped = true; subscription.remove(); }, async () => {});
}
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
  });
}
const guards = new Map<string, AsyncRegistration>();
const creatingGuards = new Set<string>();
const orphanGuards = new Map<string, AsyncRegistration>();
let guardSequence = 0;
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
  }); } catch (cause) { creatingGuards.delete(id); throw cause; }
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
