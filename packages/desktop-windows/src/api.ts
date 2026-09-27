import { validateWindow, type WindowStyle } from "@legendapp/spark-window-options";
export type { WindowStyle } from "@legendapp/spark-window-options";
import Native from "./NativeDesktopWindowManager";
import { Platform } from "react-native";
import { validateWindowsWindowOptions } from "./windows-options";
import { onDesktopEvent } from "@legendapp/spark-desktop-app/src/events";
export type Frame = { x: number; y: number; width: number; height: number };
export type WindowInfo = { id: string; kind: "window" | "overlay"; title: string; visible: boolean; focused: boolean; resizable: boolean; alwaysOnTop: boolean; minWidth: number; maxWidth: number; minimized: boolean; fullscreen: boolean; frame: Frame };
export type Display = { id: string; name: string; frame: Frame; workArea: Frame; scale: number };
export type WindowOptions = WindowStyle & { id: string; kind?: "window" | "overlay"; parentId?: string; modal?: boolean; props?: Record<string, unknown> };
export type WindowEvent = { type: string; windowId: string; requestId?: number };
async function call<T = void>(method: string, args: object = {}): Promise<T> {
  return JSON.parse(await Native.call(method, JSON.stringify(args))) as T;
}
function id(value: string) { if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error("Window id must contain 1–100 letters, numbers, underscores or hyphens"); return value; }
function dimension(value: number) { if (!Number.isFinite(value) || value < 100 || value > 20000) throw new Error("Window dimensions must be between 100 and 20000 points"); }
export function openWindow(options: WindowOptions) {
  id(options.id); if (options.id === "main") throw new Error("Use showWindow for the main window");
  if (options.kind !== undefined && !["window", "overlay"].includes(options.kind)) throw new Error("Invalid window kind");
  if (options.kind === "overlay" && options.modal) throw new Error("An overlay cannot be modal");
  options = options.kind === "overlay" ? { titleBarStyle: "borderless", transparent: true, hasShadow: false, alwaysOnTop: true, resizable: false, minimizable: false, ...options } : options;
  const { id: _id, kind, parentId, modal, props, ...style } = options;
  validateWindow(style);
  if (Platform.OS === "windows") {
    validateWindowsWindowOptions(style);
  }
  if (parentId !== undefined) id(parentId);
  if (parentId === options.id || (modal && !parentId)) throw new Error("Modal windows need a distinct parent");
  return call<WindowInfo>("open", options);
}
export function setWindowOptions(windowId: string, options: WindowStyle) {
  validateWindow(options);
  if (Platform.OS === "windows") validateWindowsWindowOptions(options);
  return call("options", { id: id(windowId), options });
}
export const maximizeWindow = (windowId = "main") => call("maximize", { id: id(windowId) });
export const unmaximizeWindow = (windowId = "main") => call("unmaximize", { id: id(windowId) });
export const centerWindow = (windowId = "main") => call("center", { id: id(windowId) });
export const listWindows = () => call<WindowInfo[]>("list");
export const getDisplays = () => call<Display[]>("displays");
export const getWindow = (windowId = "main") => call<WindowInfo>("info", { id: id(windowId) });
export const closeWindow = (windowId = "main") => call("close", { id: id(windowId) });
export const showWindow = (windowId = "main") => call("show", { id: id(windowId) });
export const hideWindow = (windowId = "main") => call("hide", { id: id(windowId) });
export const minimizeWindow = (windowId = "main") => call("minimize", { id: id(windowId) });
export const setFullscreen = (windowId: string, enabled: boolean) => call("fullscreen", { id: id(windowId), enabled });
export const setWindowTitle = (windowId: string, title: string) => call("title", { id: id(windowId), title });
/** macOS uses screen points with a bottom-left origin; Windows uses virtual-screen pixels with a top-left origin. */
export function setWindowFrame(windowId: string, frame: Frame) {
  dimension(frame.width); dimension(frame.height);
  if (!Number.isFinite(frame.x) || !Number.isFinite(frame.y)) throw new Error("Frame origin must be finite");
  return call("frame", { id: id(windowId), frame });
}
export function onWindowEvent(listener: (event: WindowEvent) => void) {
  return onDesktopEvent(event => { if (typeof event.windowId === "string") listener(event as WindowEvent); });
}
const guards = new Set<string>();
export async function beforeWindowClose(windowId: string, handler: () => boolean | Promise<boolean>) {
  id(windowId);
  if (guards.has(windowId)) throw new Error("This window already has a close handler");
  guards.add(windowId); let removed = false; let pending: number | undefined;
  const subscription = onWindowEvent(event => {
    if (event.windowId !== windowId || event.type !== "beforeClose" || pending === event.requestId) return;
    pending = event.requestId;
    void Promise.resolve().then(handler).then(
      allow => call("replyClose", { id: windowId, requestId: event.requestId, allow: !removed && allow === true }),
      () => call("replyClose", { id: windowId, requestId: event.requestId, allow: false }),
    ).catch(console.error).finally(() => { if (pending === event.requestId) pending = undefined; });
  });
  try { await call("closeGuard", { id: windowId, enabled: true }); }
  catch (error) { subscription.remove(); guards.delete(windowId); throw error; }
  return { async remove() {
    if (removed) return;
    removed = true; subscription.remove(); guards.delete(windowId);
    // Closed secondary windows no longer have a native guard to remove.
    try { await call("closeGuard", { id: windowId, enabled: false }); }
    catch (error) { if ((error as { code?: string }).code !== "E_NOT_FOUND") throw error; }
  } };
}
