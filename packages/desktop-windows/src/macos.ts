import { SparkError, invokeNative, nativeError, parseNativeResult, type AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
export type { AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
import { macosCommand, macosNative } from "./macos-adapter";
import { subscribeToWindowInstance } from "./transport";
import { noteWindowChanged, type WindowListenerOptions } from "./api";
import { keys, number, object, text, windowId } from "./validation";
import type { MacOSToolbarState, MacOSWindowBlurOptions, MacOSWindowEvent } from "./types";
export type { MacOSWindowBlurOptions, MacOSWindowEvent, MacOSToolbarDisplayMode, MacOSToolbarItem, MacOSToolbarOptions, MacOSToolbarState, MenuAction } from "./types";
/** Animated frame changes go through `setWindowBounds` from `/windows` with a `macos.durationMs` group, which rejects on Windows. */
export async function setWindowBlur(id: string, options: MacOSWindowBlurOptions): Promise<void> {
  const native = macosNative(); windowId(id); object(options, "blur options"); keys(options, ["radius", "durationMs"]);
  number(options.radius, "radius", 0, 1000); if (options.durationMs !== undefined) number(options.durationMs, "durationMs", 0, 60000);
  noteWindowChanged(id);
  await macosCommand(() => native.setWindowBlur(id, options.radius, options.durationMs ?? 0));
}
/** Options for `focusToolbarSearch`. `value` replaces the field's text first; an empty string clears it. */
export interface FocusToolbarSearchOptions { value?: string }
/** Focuses the toolbar search item `itemId`. macOS only: rejects `E_UNSUPPORTED_PLATFORM` elsewhere. */
export async function focusToolbarSearch(id: string, itemId: string, options: FocusToolbarSearchOptions = {}): Promise<void> {
  const native = macosNative(); windowId(id); text(itemId, "toolbar item ID", false); object(options, "search options"); keys(options, ["value"]);
  if (options.value !== undefined) text(options.value, "search value");
  await macosCommand(() => native.focusToolbarSearchItem(id, itemId, options.value ?? null));
}
/** Replaces the text of toolbar item `itemId` (a label item's text, or a button's title and label) without resending the toolbar. macOS only: rejects `E_UNSUPPORTED_PLATFORM` elsewhere. */
export async function setToolbarItemText(id: string, itemId: string, value: string): Promise<void> {
  const native = macosNative(); windowId(id); text(itemId, "toolbar item ID", false); text(value, "toolbar text");
  noteWindowChanged(id);
  await macosCommand(() => native.setWindowToolbarItemText(id, itemId, value));
}
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.every(id => typeof id === "string");
const isToolbarState = (value: unknown): value is MacOSToolbarState => {
  const state = value as MacOSToolbarState;
  return !!state && typeof state === "object" && typeof state.shown === "boolean" && ["icon", "label", "iconAndLabel"].includes(state.displayMode)
    && (state.customizationId === null || typeof state.customizationId === "string") && ids(state.itemIds) && ids(state.overflowItemIds);
};
/** The toolbar as AppKit has it now, including the user's customization and which items overflow at the current width. Rejects `E_NOT_FOUND` when the window has no toolbar. */
export async function getToolbarState(id: string): Promise<MacOSToolbarState> {
  const native = macosNative(); windowId(id);
  const { shown, displayMode, customizationId, itemIds, overflowItemIds } = parseNativeResult(await invokeNative(() => native.getWindowToolbarState(id)), isToolbarState);
  return { shown, displayMode, customizationId, itemIds, overflowItemIds };
}
/** Opens AppKit's Customize Toolbar sheet on the window. Requires `macos.toolbar.customization`; resolves when the sheet opens. */
export async function showToolbarCustomizationPalette(id: string): Promise<void> {
  const native = macosNative(); windowId(id);
  await invokeNative(() => native.runWindowToolbarCustomizationPalette(id));
}
/**
 * Listens for the window's title-bar control, toolbar, segmented, search and toolbar menu events. Registration
 * acknowledges the live native instance. macOS only: rejects `E_UNSUPPORTED_PLATFORM` elsewhere.
 */
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
