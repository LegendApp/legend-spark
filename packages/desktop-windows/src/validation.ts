import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { menuItems } from "@legendapp/spark-desktop-app/src/contracts/menu";
import type { Size, WindowBounds, WindowOpenOptions, WindowUpdateOptions, MacOSWindowOptions } from "./types";

type ObjectValue = Record<string, unknown>;
export function object<T>(value: T, name: string): asserts value is T & ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SparkError("E_INVALID_ARGUMENT", `${name} must be an object`);
}
export function keys(value: object, allowed: readonly string[]) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported window option: ${key}`);
}
export function windowId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new SparkError("E_INVALID_ARGUMENT", "Window IDs require 1–100 letters, numbers, underscores or hyphens");
}
export function text(value: unknown, name: string, empty = true): asserts value is string {
  if (typeof value !== "string" || value.includes("\0") || (!empty && !value.length)) throw new SparkError("E_INVALID_ARGUMENT", `Invalid ${name}`);
}
export function number(value: unknown, name: string, min: number, max: number): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new SparkError("E_INVALID_ARGUMENT", `${name} must be between ${min} and ${max}`);
}
function enumValue(value: unknown, allowed: readonly string[], name: string) {
  if (value !== undefined && !allowed.includes(value as string)) throw new SparkError("E_INVALID_ARGUMENT", `Invalid ${name}`);
}
function flags(value: ObjectValue, names: readonly string[]) {
  for (const key of names) if (value[key] !== undefined && typeof value[key] !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", `${key} must be boolean`);
}
export function size(value: unknown): asserts value is Size {
  object(value, "size"); keys(value, ["width", "height"]);
  number(value.width, "width", 100, 20000); number(value.height, "height", 100, 20000);
}
function position(value: unknown) {
  object(value, "position"); keys(value, ["displayId", "x", "y"]);
  text(value.displayId, "display ID", false); number(value.x, "x", -10000000, 10000000); number(value.y, "y", -10000000, 10000000);
}
export function bounds(value: unknown): asserts value is WindowBounds {
  object(value, "bounds"); keys(value, ["displayId", "x", "y", "width", "height"]);
  position({ displayId: value.displayId, x: value.x, y: value.y }); size({ width: value.width, height: value.height });
}
function color(value: unknown) {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) throw new SparkError("E_INVALID_ARGUMENT", "Window colors must be #RRGGBB or #RRGGBBAA");
}
/** Snapshot JSON props before a queued native call; no silent coercion or omission. */
export function jsonSnapshot(value: unknown, active = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || active.has(value)) throw new SparkError("E_INVALID_ARGUMENT", "Window props must be finite, acyclic JSON");
  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getOwnPropertySymbols(value).length || Object.keys(value).length !== value.length || Array.from({ length: value.length }, (_, index) => index).some(index => !Object.hasOwn(value, index))) throw new SparkError("E_INVALID_ARGUMENT", "Window props cannot contain sparse arrays");
      return value.map(entry => jsonSnapshot(entry, active));
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new SparkError("E_INVALID_ARGUMENT", "Window props require plain JSON objects");
    if (Object.getOwnPropertySymbols(value).length) throw new SparkError("E_INVALID_ARGUMENT", "Window props cannot contain symbol properties");
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonSnapshot(entry, active)]));
  } finally { active.delete(value); }
}
const common = ["title", "appearance", "titleBarStyle", "backgroundColor", "transparent", "hasShadow", "alwaysOnTop", "resizable", "closable", "minimizable", "minSize", "maxSize", "macos"];
export function validateOptions(options: WindowOpenOptions | WindowUpdateOptions, platform: string, opening: boolean): void {
  object(options, "window options"); keys(options, [...common, ...(opening ? ["id", "component", "props", "size", "position", "show", "restoreBounds", "kind", "parentId", "modal"] : [])]);
  flags(options, ["transparent", "hasShadow", "alwaysOnTop", "resizable", "closable", "minimizable", "show", "restoreBounds", "modal"]);
  if (options.title !== undefined) text(options.title, "title");
  enumValue(options.appearance, ["system", "light", "dark"], "appearance");
  enumValue(options.titleBarStyle, ["default", "overlay", "hidden", "borderless"], "titleBarStyle");
  if (platform === "windows" && options.titleBarStyle === "overlay") throw new SparkError("E_UNSUPPORTED_OPTION", "Windows does not support overlay title bars");
  if (options.backgroundColor !== undefined) color(options.backgroundColor);
  for (const value of [options.minSize, options.maxSize]) if (value !== undefined && value !== null) size(value);
  const min = options.minSize ?? { width: 100, height: 100 }, max = options.maxSize ?? { width: 20000, height: 20000 };
  if (min.width > max.width || min.height > max.height) throw new SparkError("E_INVALID_ARGUMENT", "Minimum window size exceeds maximum");
  if (options.macos !== undefined) {
    if (platform !== "macos") throw new SparkError("E_UNSUPPORTED_OPTION", "macos window options require macOS");
    validateMacOS(options.macos);
    if (!opening && "panelStyle" in options.macos) throw new SparkError("E_UNSUPPORTED_OPTION", "panelStyle is fixed when opening a window");
    if (options.alwaysOnTop !== undefined && options.macos.level !== undefined) throw new SparkError("E_INVALID_ARGUMENT", "Choose alwaysOnTop or a macOS window level");
  }
  if (opening) {
    const value = options as WindowOpenOptions;
    windowId(value.id); if (value.id === "main") throw new SparkError("E_INVALID_ARGUMENT", "The main window is created by the host");
    text(value.component, "registered component", false);
    enumValue(value.kind, ["window", "overlay"], "window kind");
    if (value.parentId !== undefined) windowId(value.parentId);
    if (value.parentId === value.id || (value.modal && (!value.parentId || String(value.kind) === "overlay"))) throw new SparkError("E_INVALID_ARGUMENT", "Modal windows require a distinct parent and cannot be overlays");
    if (value.size !== undefined) {
      size(value.size);
      if (value.size.width < min.width || value.size.height < min.height || value.size.width > max.width || value.size.height > max.height) throw new SparkError("E_INVALID_ARGUMENT", "Window size is outside its constraints");
    }
    if (value.position !== undefined) position(value.position);
    if (value.props !== undefined) { object(value.props, "props"); jsonSnapshot(value.props); }
  }
}
function entries(value: unknown, name: string): ObjectValue[] {
  if (!Array.isArray(value)) throw new SparkError("E_INVALID_ARGUMENT", `${name} must be an array`);
  const ids = new Set<string>();
  for (const item of value) {
    object(item, name); text(item.id, `${name} ID`, false);
    if (ids.has(item.id)) throw new SparkError("E_INVALID_ARGUMENT", `${name} IDs must be unique`);
    ids.add(item.id);
  }
  return value;
}
export function validateMacOS(value: MacOSWindowOptions) {
  object(value, "macos"); keys(value, ["panelStyle", "representedUri", "level", "titleBar", "toolbar", "startupSplitView", "restoreOnLaunch"]);
  enumValue(value.panelStyle, ["utility", "documentModal", "nonactivating"], "panelStyle");
  enumValue(value.level, ["normal", "floating", "modalPanel", "mainMenu", "status", "screenSaver"], "level");
  flags(value, ["restoreOnLaunch"]);
  if (value.representedUri !== undefined && value.representedUri !== null) {
    text(value.representedUri, "represented URI", false);
    try { new URL(value.representedUri); } catch { throw new SparkError("E_INVALID_ARGUMENT", "representedUri must be an absolute URI"); }
  }
  if (value.titleBar !== undefined) {
    const title = value.titleBar; object(title, "titleBar");
    keys(title, ["contentLayout", "transparent", "titleVisibility", "separator", "material", "blendingMode", "materialState", "trafficLights", "controls"]);
    flags(title, ["transparent", "trafficLights"]);
    enumValue(title.contentLayout, ["contentLayoutGuide", "fullSize"], "contentLayout");
    enumValue(title.titleVisibility, ["visible", "hidden"], "titleVisibility");
    enumValue(title.separator, ["automatic", "none", "line", "shadow"], "separator");
    enumValue(title.material, ["none", "glass", "titlebar", "headerView", "hudWindow", "sidebar", "windowBackground"], "material");
    enumValue(title.blendingMode, ["behindWindow", "withinWindow"], "blendingMode");
    enumValue(title.materialState, ["active", "inactive", "followsWindowActiveState"], "materialState");
    if (title.controls !== undefined) for (const control of entries(title.controls, "titlebar control")) {
      keys(control, ["id", "label", "placement", "disabled", "selected", "symbol", "tooltip"]); flags(control, ["disabled", "selected"]);
      enumValue(control.placement, ["left", "right"], "control placement");
      for (const field of ["label", "symbol", "tooltip"]) if (control[field] !== undefined) text(control[field], field);
    }
  }
  if (value.toolbar !== undefined) {
    object(value.toolbar, "toolbar"); keys(value.toolbar, ["visible", "style", "items"]); flags(value.toolbar, ["visible"]);
    enumValue(value.toolbar.style, ["automatic", "expanded", "preference", "unified", "unifiedCompact"], "toolbar style");
    if (value.toolbar.items !== undefined) for (const item of entries(value.toolbar.items, "toolbar item")) {
      const fields: Record<string, string[]> = { button: ["disabled", "bordered", "symbol", "tooltip", "monospacedDigits", "width"], menu: ["disabled", "bordered", "symbol", "tooltip", "width", "items"], label: ["text", "width"], search: ["disabled", "collapses", "placeholder", "value", "width"], segmented: ["segments", "value"] };
      if (typeof item.type !== "string" || !Object.hasOwn(fields, item.type)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown toolbar item type");
      keys(item, ["id", "label", "placement", "type", ...fields[item.type]]);
      flags(item, ["disabled", "bordered", "monospacedDigits", "collapses"]);
      enumValue(item.placement, ["leading", "trailing"], "toolbar placement");
      for (const field of ["label", "symbol", "tooltip", "text", "placeholder"]) if (item[field] !== undefined) text(item[field], field);
      if (item.width !== undefined) number(item.width, "toolbar width", 1, 20000);
      if (item.type === "label") text(item.text, "toolbar text");
      if (item.type === "search" && item.value !== undefined) text(item.value, "search value");
      if (item.type === "menu") menuItems(item.items as never, { types: ["action", "checkbox", "separator", "slider"], icons: ["symbol"] }, "macos");
      if (item.type === "segmented") {
        if (!Array.isArray(item.segments) || !item.segments.length) throw new SparkError("E_INVALID_ARGUMENT", "Toolbar segments must be nonempty");
        const values = new Set<string>();
        for (const segment of item.segments) {
          object(segment, "segment"); keys(segment, ["value", "label", "symbol"]); text(segment.value, "segment value"); text(segment.label, "segment label", false);
          if (segment.symbol !== undefined) text(segment.symbol, "segment symbol", false);
          if (values.has(segment.value)) throw new SparkError("E_INVALID_ARGUMENT", "Segment values must be unique"); values.add(segment.value);
        }
        if (item.value !== null && !values.has(item.value as string)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown toolbar segment value");
      }
    }
  }
  if (value.startupSplitView !== undefined && value.startupSplitView !== null) {
    const split = value.startupSplitView; object(split, "startupSplitView");
    keys(split, ["sidebarWidth", "sidebarMinWidth", "contentMinWidth", "sidebarCollapsed", "appearance", "backgroundColor", "sidebarBackgroundColor", "contentTitlebarHeight"]);
    for (const field of ["sidebarWidth", "sidebarMinWidth", "contentMinWidth"] as const) number(split[field], field, 0, 20000);
    if (split.sidebarWidth < split.sidebarMinWidth && !split.sidebarCollapsed) throw new SparkError("E_INVALID_ARGUMENT", "Sidebar width is below its minimum");
    if (split.contentTitlebarHeight !== undefined) number(split.contentTitlebarHeight, "contentTitlebarHeight", 0, 20000);
    flags(split, ["sidebarCollapsed"]);
    if (!["light", "dark"].includes(split.appearance)) throw new SparkError("E_INVALID_ARGUMENT", "Startup split view requires light or dark appearance");
    color(split.backgroundColor); color(split.sidebarBackgroundColor);
  }
}
