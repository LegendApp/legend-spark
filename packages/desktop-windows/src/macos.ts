import { SparkError, nativeError, type AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
export type { AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
import { macosCommand, macosNative } from "./macos-adapter";
import { subscribeToWindowInstance } from "./transport";
import { type WindowListenerOptions } from "./api";
import { keys, number, object, text, windowId } from "./validation";
import type { MacOSWindowBlurOptions, MacOSWindowEvent } from "./types";
export type { MacOSWindowBlurOptions, MacOSWindowEvent, MacOSToolbarItem, MacOSToolbarOptions } from "./types";
/** Animated frame changes go through `setWindowBounds` from `/windows` with a `macos.durationMs` group, which rejects on Windows. */
export async function setWindowBlur(id: string, options: MacOSWindowBlurOptions): Promise<void> {
  const native = macosNative(); windowId(id); object(options, "blur options"); keys(options, ["radius", "durationMs"]);
  number(options.radius, "radius", 0, 1000); if (options.durationMs !== undefined) number(options.durationMs, "durationMs", 0, 60000);
  await macosCommand(() => native.setWindowBlur(id, options.radius, options.durationMs ?? 0));
}
export interface FocusToolbarSearchOptions { value?: string }
export async function focusToolbarSearch(id: string, itemId: string, options: FocusToolbarSearchOptions = {}): Promise<void> {
  const native = macosNative(); windowId(id); text(itemId, "toolbar item ID", false); object(options, "search options"); keys(options, ["value"]);
  if (options.value !== undefined) text(options.value, "search value");
  await macosCommand(() => native.focusToolbarSearchItem(id, itemId, options.value ?? null));
}
export async function setToolbarItemText(id: string, itemId: string, value: string): Promise<void> {
  const native = macosNative(); windowId(id); text(itemId, "toolbar item ID", false); text(value, "toolbar text");
  await macosCommand(() => native.setWindowToolbarItemText(id, itemId, value));
}
export async function addMacOSWindowListener(id: string, listener: (event: MacOSWindowEvent) => void, options: WindowListenerOptions = {}): Promise<AsyncRegistration> {
  macosNative(); windowId(id); object(options, "listener options"); keys(options, ["onError"]);
  if (typeof listener !== "function" || (options.onError !== undefined && typeof options.onError !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Expected window event callbacks");
  return subscribeToWindowInstance(id, event => {
    if (!["titleBarAction", "toolbarAction", "toolbarSelectionChanged", "toolbarSearchChanged", "toolbarSearchSubmitted", "toolbarMenuAction"].includes(event.type)) return;
    const report = (cause: unknown) => { if (options.onError) options.onError(nativeError(cause)); else console.error(cause); };
    const error = () => report(new SparkError("E_INVALID_DATA", "Malformed macOS window event"));
    const base = { windowId: id, type: event.type };
    let payload: unknown;
    if (event.type === "titleBarAction") {
      if (typeof event.controlId !== "string" || !event.controlId) return error();
      payload = { ...base, controlId: event.controlId };
    } else {
      if (typeof event.itemId !== "string" || !event.itemId) return error();
      if (event.type === "toolbarAction") payload = { ...base, itemId: event.itemId };
      else if (event.type === "toolbarMenuAction") {
        const action = event.action as any;
        if (!action || typeof action.itemId !== "string" || !action.itemId || (action.type !== "action" && !(action.type === "valueChanged" && typeof action.value === "number" && Number.isFinite(action.value)))) return error();
        payload = { ...base, itemId: event.itemId, action: action.type === "action" ? { type: "action", itemId: action.itemId } : { type: "valueChanged", itemId: action.itemId, value: action.value } };
      } else {
        if (typeof event.value !== "string" || (event.type !== "toolbarSelectionChanged" && typeof event.shiftKey !== "boolean")) return error();
        payload = { ...base, itemId: event.itemId, value: event.value, ...(event.type !== "toolbarSelectionChanged" ? { shiftKey: event.shiftKey } : {}) };
      }
    }
    try { listener(payload as MacOSWindowEvent); } catch (cause) { report(cause); }
  }, ["titleBarAction", "toolbarAction", "toolbarSelectionChanged", "toolbarSearchChanged", "toolbarSearchSubmitted", "toolbarMenuAction"]);
}
