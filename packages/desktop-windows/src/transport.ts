import { Platform } from "react-native";
import { SparkError, asyncRegistration, invokeNative, parseNativeResult, type AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
import { onDesktopEvent, type DesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import Native from "./NativeDesktopWindowManager";
import { windowId } from "./validation";
import type { DisplayInfo, WindowBounds, WindowInfo } from "./types";

/** Internal native transport shared by the public window API and the macOS adapter. Not part of any public entry point. */
export const record = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
export const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export const isSize = (value: unknown) => record(value) && finite(value.width) && value.width > 0 && finite(value.height) && value.height > 0;
export const isBounds = (value: unknown): value is WindowBounds => record(value) && isSize(value) && finite(value.x) && finite(value.y) && typeof value.displayId === "string" && !!value.displayId;
export interface NativeWindowInfo extends WindowInfo { instanceId: string }
export const isInfo = (value: unknown): value is NativeWindowInfo => record(value) && typeof value.id === "string" && typeof value.instanceId === "string" && !!value.instanceId && ["window", "overlay"].includes(value.kind) && typeof value.title === "string" && (value.parentId === null || typeof value.parentId === "string") && [value.modal, value.visible, value.focused, value.minimized, value.fullscreen].every(flag => typeof flag === "boolean") && isBounds(value.bounds);

export async function windowCall<T>(method: string, args: object, validate: (value: unknown) => value is T): Promise<T> {
  if (Platform.OS !== "macos" && Platform.OS !== "windows") throw new SparkError("E_UNSUPPORTED_PLATFORM", "Windows require a desktop host");
  if (!Native) throw new SparkError("E_MODULE_UNAVAILABLE", "The window module is unavailable");
  const native = Native;
  return parseNativeResult(await invokeNative(() => native.call(method, JSON.stringify(args))), validate);
}
export async function windowCommand(method: string, args: object): Promise<void> { await windowCall(method, args, (value): value is null => value === null); }
/** Internal lifetime binding shared by ordinary and AppKit event subscriptions. */
export async function subscribeToWindowInstance(id: string, listener: (event: DesktopEvent) => void, types: readonly string[] = ["focusChanged", "boundsChanged", "visibilityChanged", "fullscreenChanged"]): Promise<AsyncRegistration> {
  windowId(id);
  let instance: string | undefined, stopped = false;
  const buffered: DesktopEvent[] = [];
  const consume = (event: DesktopEvent) => {
    if (stopped || event.windowId !== id) return;
    if (!instance) { buffered.push(event); return; }
    if (event.instanceId !== instance) return;
    try { listener(event); } finally { if (event.type === "closed") { stopped = true; subscription.remove(); } }
  };
  const subscription = onDesktopEvent(consume, { types: [...types, "closed"], target: { field: "windowId", value: id } });
  try { instance = (await windowCall("observe", { id }, isInfo)).instanceId; buffered.splice(0).forEach(consume); }
  catch (cause) { stopped = true; subscription.remove(); throw cause; }
  return asyncRegistration(() => { stopped = true; subscription.remove(); }, async () => {});
}
export async function getNativeDisplays(): Promise<DisplayInfo[]> {
  return windowCall("displays", {}, (value): value is DisplayInfo[] => Array.isArray(value) && value.length > 0 && value.every(item => record(item) && typeof item.id === "string" && !!item.id && (item.persistentId === null || typeof item.persistentId === "string") && typeof item.name === "string" && typeof item.primary === "boolean" && isSize(item.size) && isSize(item.workArea) && finite(item.workArea.x) && finite(item.workArea.y) && finite(item.scaleFactor) && item.scaleFactor > 0) && value.filter(item => item.primary).length === 1 && new Set(value.map(item => item.id)).size === value.length);
}
