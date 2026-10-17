import { Platform } from "react-native";
import { SparkError, asyncRegistration, nativeError, type AsyncRegistration, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { addWindowListener, closeWindow, getCursorPoint, getDisplays, getWindow, getWindowAvailability, hideWindow, openWindow, setWindowBounds, showWindow } from "./api";
import { addDisplayListener, getDisplayDetails } from "./displays";
import { keys, number, object, text } from "./validation";
import type { CloseResult, DisplayId, DisplayInfo, Size, WindowBounds, WindowId, WindowInfo, WindowOpenOptions } from "./types";

// Special window types (docs/api-window-contract.md#special-window-types): ordinary Spark windows opened with
// AppKit panel styles, levels and collection behaviors, placed and driven by these controllers. macOS only for now.

/** A special window kind `getSpecialWindowAvailability` reports, one per controller in this module. macOS only for now. */
export type SpecialWindowType = "commandBar" | "hud" | "preview" | "pictureInPicture" | "popover" | "edgeDrawer" | "overlay" | "desktopWidget" | "presenter";
const TYPES: readonly SpecialWindowType[] = ["commandBar", "hud", "preview", "pictureInPicture", "popover", "edgeDrawer", "overlay", "desktopWidget", "presenter"];
/** A special window's content: a registered root component and its JSON props, as `openWindow` takes them. */
export interface SpecialWindowContent {
  id: WindowId;
  component: string;
  props?: Record<string, unknown>;
  title?: string;
  appearance?: "system" | "light" | "dark";
}
/** A rectangle in logical units from a display's top-left corner, of any size (a tray item, a thumbnail). */
export interface DisplayRect { displayId: DisplayId; x: number; y: number; width: number; height: number }
/** A corner of a display's work area. */
export type ScreenCorner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
/** An edge of a display's work area. */
export type ScreenEdge = "left" | "right" | "top" | "bottom";
/** Behind-window vibrancy under transparent content (`macos.backgroundMaterial`). */
export type SpecialWindowMaterial = "popover" | "hudWindow" | "sidebar" | "windowBackground" | "none";
/** `onError` receives a controller's background failures (a hide after focus loss, a hotkey toggle); default `console.error`. */
export interface SpecialWindowErrorOptions { onError?: (error: SparkError) => void }

/** Every type is implemented on macOS. Windows reports `unsupported-platform` (Windows follow-up: docs/api-window-contract.md#special-window-types). */
export function getSpecialWindowAvailability(type?: SpecialWindowType): Availability {
  if (type !== undefined && !TYPES.includes(type)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown special window type");
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  return getWindowAvailability();
}
function supported(type: SpecialWindowType) {
  const availability = getSpecialWindowAvailability(type);
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", `${type} windows require macOS`);
}

const CONTENT = ["id", "component", "props", "title", "appearance"] as const;
function validate(type: SpecialWindowType, options: object, allowed: readonly string[]) {
  object(options, `${type} options`); keys(options, [...CONTENT, ...allowed]);
  supported(type);
}
function content({ id, component, props, title, appearance }: SpecialWindowContent): Pick<WindowOpenOptions, "id" | "component" | "props" | "title" | "appearance"> {
  return { id, component, ...(props !== undefined ? { props } : {}), ...(title !== undefined ? { title } : {}), ...(appearance !== undefined ? { appearance } : {}) };
}
function enumeration<T extends string>(value: unknown, allowed: readonly T[], name: string): asserts value is T {
  if (!allowed.includes(value as T)) throw new SparkError("E_INVALID_ARGUMENT", `Invalid ${name}`);
}
const MATERIALS: readonly SpecialWindowMaterial[] = ["popover", "hudWindow", "sidebar", "windowBackground", "none"];
const CORNERS: readonly ScreenCorner[] = ["topLeft", "topRight", "bottomLeft", "bottomRight"];
const EDGES: readonly ScreenEdge[] = ["left", "right", "top", "bottom"];
function size(value: unknown, name = "size"): asserts value is Size {
  object(value, name); keys(value, ["width", "height"]);
  number(value.width, `${name}.width`, 100, 20000); number(value.height, `${name}.height`, 100, 20000);
}
function rect(value: unknown, name: string): asserts value is DisplayRect {
  object(value, name); keys(value, ["displayId", "x", "y", "width", "height"]);
  text(value.displayId, "display ID", false);
  for (const key of ["x", "y"] as const) number(value[key], `${name}.${key}`, -10000000, 10000000);
  for (const key of ["width", "height"] as const) number(value[key], `${name}.${key}`, 0, 20000);
}
function report(options: SpecialWindowErrorOptions, cause: unknown) { try { (options.onError ?? console.error)(nativeError(cause)); } catch (error) { console.error(error); } }
const round = (value: number) => Math.round(value);
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

async function display(displayId?: DisplayId): Promise<DisplayInfo> {
  const displays = await getDisplays();
  const found = displayId === undefined ? displays.find(item => item.primary) : displays.find(item => item.id === displayId);
  if (!found) throw new SparkError("E_NOT_FOUND", "Display is disconnected");
  return found;
}
/** The display under the pointer: where a person summoning a window is looking. */
async function activeDisplay(displayId?: DisplayId) { return display(displayId ?? (await getCursorPoint()).displayId); }
/** Horizontally centered in the work area, with the window's vertical center `fraction` of the way down it, kept inside. */
function placed({ id, workArea: area }: DisplayInfo, { width, height }: Size, fraction: number): WindowBounds {
  return { displayId: id, width, height, x: round(area.x + (area.width - width) / 2), y: round(clamp(area.y + area.height * fraction - height / 2, area.y, area.y + area.height - height)) };
}
function corner({ id, workArea: area }: DisplayInfo, { width, height }: Size, at: ScreenCorner, margin: number): WindowBounds {
  return { displayId: id, width, height, x: at.endsWith("Left") ? area.x + margin : area.x + area.width - margin - width, y: at.startsWith("top") ? area.y + margin : area.y + area.height - margin - height };
}

/** Serializes a controller's commands and rejects them once its window is gone. */
function controller(id: WindowId, name: string) {
  let queue: Promise<unknown> = Promise.resolve(), closed = false;
  return {
    get closed() { return closed; },
    close() { closed = true; },
    run<T>(task: () => Promise<T>): Promise<T> {
      if (closed) return Promise.reject(new SparkError("E_CLOSED", `The ${name} ${id} has closed`));
      const next = queue.then(() => { if (closed) throw new SparkError("E_CLOSED", `The ${name} ${id} has closed`); return task(); });
      queue = next.catch(() => {});
      return next;
    },
  };
}
/** Listens until the window closes; `onClosed` runs once if it closes some other way than the controller. */
async function watch(id: WindowId, listeners: { focusChanged?: (focused: boolean) => void; visibilityChanged?: (visible: boolean) => void; closed: () => void }) {
  const registrations: AsyncRegistration[] = [];
  try {
    registrations.push(await addWindowListener(id, "closed", listeners.closed));
    if (listeners.focusChanged) registrations.push(await addWindowListener(id, "focusChanged", event => listeners.focusChanged!(event.focused)));
    if (listeners.visibilityChanged) registrations.push(await addWindowListener(id, "visibilityChanged", event => listeners.visibilityChanged!(event.visible)));
  } catch (cause) { await Promise.allSettled(registrations.map(item => item.remove())); throw cause; }
  return { remove: () => Promise.all(registrations.map(item => item.remove())).then(() => {}) };
}
/** Opens the window, then runs `setup`; a setup failure closes the window again and rejects with the failure. */
async function openWith<T>(options: WindowOpenOptions, setup: (info: WindowInfo) => Promise<T>): Promise<T> {
  const info = await openWindow(options);
  try { return await setup(info); }
  catch (cause) {
    try { await closeWindow(options.id); } catch (cleanup) { throw new SparkError("E_NATIVE", "Special window setup and cleanup both failed", { cause: new AggregateError([cause, cleanup]) }); }
    throw cause;
  }
}
const ANIMATION_MS = 200;
const PANEL = { panelStyle: "nonactivating", spaces: "all", fullScreenAuxiliary: true, ignoresCycle: true } as const;

// Command bar ---------------------------------------------------------------------------------------------------

/** Options for `createCommandBar`. `size` is 100–20000 logical units. */
export interface CommandBarOptions extends SpecialWindowContent, SpecialWindowErrorOptions {
  size: Size;
  /** Global accelerator that shows and hides the bar from any app (`@legendapp/spark/global-shortcuts` must be installed). */
  hotkey?: string;
  /** Default `popover`. */
  material?: SpecialWindowMaterial;
}
/** Options for `CommandBar.show`. */
export interface CommandBarShowOptions {
  /** Default: the display under the pointer. */
  displayId?: DisplayId;
}
/** The controller `createCommandBar` resolves with. Its commands run in order and reject `E_CLOSED` once the window has closed. */
export interface CommandBar extends AsyncRegistration {
  readonly id: WindowId;
  readonly shown: boolean;
  /** Centers the bar horizontally on the display with its top a fifth of the way down the work area, shows it and gives it key focus without activating the app. */
  show(options?: CommandBarShowOptions): Promise<void>;
  hide(): Promise<void>;
  toggle(): Promise<void>;
}
/**
 * A Spotlight-style command bar: a non-activating panel that joins every Space and shows over fullscreen apps,
 * with behind-window blur, hidden until shown; it hides when it loses key focus. `remove()` unregisters the
 * hotkey and closes the window.
 */
export async function createCommandBar(options: CommandBarOptions): Promise<CommandBar> {
  validate("commandBar", options, ["size", "hotkey", "material", "onError"]);
  size(options.size);
  if (options.hotkey !== undefined) text(options.hotkey, "hotkey", false);
  if (options.material !== undefined) enumeration(options.material, MATERIALS, "material");
  if (options.onError !== undefined && typeof options.onError !== "function") throw new SparkError("E_INVALID_ARGUMENT", "onError must be a function");
  const shortcuts = options.hotkey === undefined ? undefined : await import("@legendapp/spark-global-shortcuts").catch(cause => {
    throw new SparkError("E_MODULE_UNAVAILABLE", "A command bar hotkey requires @legendapp/spark/global-shortcuts", { cause });
  });
  const { id } = options, state = controller(id, "command bar");
  let shown = false;
  const hide = () => state.run(async () => { if (!shown) return; shown = false; await hideWindow(id); });
  const show = async (showOptions: CommandBarShowOptions = {}) => {
    object(showOptions, "show options"); keys(showOptions, ["displayId"]);
    return state.run(async () => {
      const target = await activeDisplay(showOptions.displayId);
      await setWindowBounds(id, placed(target, options.size, 0.2 + options.size.height / 2 / target.workArea.height));
      await showWindow(id, { focus: true });
      shown = true;
    });
  };
  const toggle = () => shown ? hide() : show();
  return openWith({
    ...content(options), size: options.size, show: false, titleBarStyle: "hidden", transparent: true, hasShadow: true, resizable: false, minimizable: false, closable: false,
    macos: { ...PANEL, level: "floating", backgroundMaterial: options.material ?? "popover" },
  }, async () => {
    let hotkey: AsyncRegistration | undefined;
    const watching = await watch(id, {
      focusChanged: focused => { if (!focused && shown) hide().catch(cause => report(options, cause)); },
      visibilityChanged: visible => { shown = visible; },
      closed: () => { state.close(); hotkey?.remove().catch(cause => report(options, cause)); },
    });
    try { if (shortcuts) hotkey = await shortcuts.registerGlobalShortcut(options.hotkey!, () => { toggle().catch(cause => report(options, cause)); }); }
    catch (cause) { await watching.remove(); throw cause; }
    const registration = asyncRegistration(() => { state.close(); }, async () => {
      await hotkey?.remove(); await watching.remove();
      try { await closeWindow(id); } catch (cause) { if (nativeError(cause).code !== "E_NOT_FOUND") throw cause; }
    });
    return { id, get shown() { return shown; }, show, hide, toggle, remove: registration.remove };
  });
}

// HUD -----------------------------------------------------------------------------------------------------------

/** Options for `createHUD`. `size` is 100–20000 logical units; `material` defaults to `hudWindow`. */
export interface HUDOptions extends SpecialWindowContent { size: Size; material?: SpecialWindowMaterial }
/** Options for `HUD.show`. `displayId` defaults to the primary display. */
export interface HUDShowOptions {
  displayId?: DisplayId;
  /** Hides the HUD after this many milliseconds (0–60000, default 1500); 0 keeps it until `hide()`. Showing it again restarts the time. */
  durationMs?: number;
}
/** The controller `createHUD` resolves with. Its commands run in order and reject `E_CLOSED` once the window has closed; `remove()` closes the window. */
export interface HUD extends AsyncRegistration { readonly id: WindowId; readonly shown: boolean; show(options?: HUDShowOptions): Promise<void>; hide(): Promise<void> }
/**
 * A HUD overlay (the volume or brightness bezel): a borderless, click-through, never-key panel with HUD
 * vibrancy above other windows, every Space and fullscreen apps. Each show centers it horizontally on the
 * display (default primary), two thirds of the way down the work area.
 */
export async function createHUD(options: HUDOptions): Promise<HUD> {
  validate("hud", options, ["size", "material"]);
  size(options.size);
  if (options.material !== undefined) enumeration(options.material, MATERIALS, "material");
  const { id } = options, state = controller(id, "HUD");
  let shown = false, timer: ReturnType<typeof setTimeout> | undefined;
  const stopTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const hide = () => state.run(async () => { stopTimer(); if (!shown) return; shown = false; await hideWindow(id); });
  return openWith({
    ...content(options), kind: "overlay", size: options.size, show: false, ignoreMouseEvents: true,
    // An overlay is a status-level, non-activating panel on every Space and over fullscreen apps.
    macos: { ignoresCycle: true, backgroundMaterial: options.material ?? "hudWindow" },
  }, async () => {
    const watching = await watch(id, { visibilityChanged: visible => { shown = visible; }, closed: () => { stopTimer(); state.close(); } });
    const registration = asyncRegistration(() => { stopTimer(); state.close(); }, async () => {
      await watching.remove();
      try { await closeWindow(id); } catch (cause) { if (nativeError(cause).code !== "E_NOT_FOUND") throw cause; }
    });
    return {
      id, get shown() { return shown; }, hide, remove: registration.remove,
      async show(showOptions: HUDShowOptions = {}) {
        object(showOptions, "show options"); keys(showOptions, ["displayId", "durationMs"]);
        if (showOptions.durationMs !== undefined) number(showOptions.durationMs, "durationMs", 0, 60000);
        return state.run(async () => {
          stopTimer();
          await setWindowBounds(id, placed(await display(showOptions.displayId), options.size, 2 / 3));
          await showWindow(id, { focus: false });
          shown = true;
          const duration = showOptions.durationMs ?? 1500;
          if (duration > 0) timer = setTimeout(() => { timer = undefined; hide().catch(error => report({}, error)); }, duration);
        });
      },
    };
  });
}

// Preview -------------------------------------------------------------------------------------------------------

/** Options for `openPreviewWindow`. `size` is 100–20000 logical units. */
export interface PreviewWindowOptions extends SpecialWindowContent {
  size: Size;
  /** Where the previewed item is (a thumbnail): the window grows from it when it opens and shrinks back into it when it closes. */
  from?: DisplayRect;
  /** Default: the display of `from`, else the primary display. */
  displayId?: DisplayId;
}
/** The controller `openPreviewWindow` resolves with. `close()` shrinks the window back into `from`, when given, then closes it. */
export interface PreviewWindow { readonly id: WindowId; close(): Promise<CloseResult> }
/** Smallest frame a window takes (100 × 100), centered on `from`. */
function grownFrom(from: DisplayRect): WindowBounds {
  const width = Math.max(100, from.width), height = Math.max(100, from.height);
  return { displayId: from.displayId, width, height, x: round(from.x + (from.width - width) / 2), y: round(from.y + (from.height - height) / 2) };
}
/** A Quick Look-style preview: a floating HUD panel (dark translucent title bar) centered on the display, zooming from and to `from`. */
export async function openPreviewWindow(options: PreviewWindowOptions): Promise<PreviewWindow> {
  validate("preview", options, ["size", "from", "displayId"]);
  size(options.size);
  if (options.from !== undefined) rect(options.from, "from");
  if (options.displayId !== undefined) text(options.displayId, "display ID", false);
  const { id, from } = options, target = await display(options.displayId ?? from?.displayId);
  const final = placed(target, options.size, 0.5), start = from ? grownFrom(from) : final;
  const state = controller(id, "preview");
  return openWith({
    ...content(options), size: { width: start.width, height: start.height }, position: { displayId: start.displayId, x: start.x, y: start.y }, show: false,
    minimizable: false, macos: { panelStyle: "hud", level: "floating" },
  }, async () => {
    const watching = await watch(id, { closed: () => { state.close(); } });
    try {
      await showWindow(id, { focus: true });
      if (from) await setWindowBounds(id, final, { macos: { durationMs: ANIMATION_MS } });
    } catch (cause) { await watching.remove(); throw cause; }
    return {
      id,
      close: () => state.run(async () => {
        if (from) await setWindowBounds(id, grownFrom(from), { macos: { durationMs: ANIMATION_MS } });
        const result = await closeWindow(id);
        if (result.closed) { state.close(); await watching.remove(); }
        return result;
      }),
    };
  });
}

// Picture in picture -------------------------------------------------------------------------------------------

/** Options for `openPictureInPicture`. `size` is 100–20000 logical units and sets the kept aspect ratio. */
export interface PictureInPictureOptions extends SpecialWindowContent {
  size: Size;
  /** Default `bottomRight`. */
  corner?: ScreenCorner;
  /** Default: the primary display. */
  displayId?: DisplayId;
  /** Distance from the work area's edges, 0–500 (default 16). */
  margin?: number;
}
/** The controller `openPictureInPicture` resolves with. `snapTo` animates the window to a corner, of its current display by default. */
export interface PictureInPicture { readonly id: WindowId; snapTo(corner: ScreenCorner, options?: { displayId?: DisplayId }): Promise<void>; close(): Promise<CloseResult> }
/**
 * A picture-in-picture window: floating above other apps' windows, on every Space and over fullscreen apps,
 * keeping its aspect ratio while resized, never activating the app. Wherever it is moved or dragged it
 * snaps to the nearest corner of its display (`macos.cornerSnapping`).
 */
export async function openPictureInPicture(options: PictureInPictureOptions): Promise<PictureInPicture> {
  validate("pictureInPicture", options, ["size", "corner", "displayId", "margin"]);
  size(options.size);
  if (options.corner !== undefined) enumeration(options.corner, CORNERS, "corner");
  if (options.margin !== undefined) number(options.margin, "margin", 0, 500);
  if (options.displayId !== undefined) text(options.displayId, "display ID", false);
  const { id } = options, margin = options.margin ?? 16, state = controller(id, "picture-in-picture window");
  const start = corner(await display(options.displayId), options.size, options.corner ?? "bottomRight", margin);
  return openWith({
    ...content(options), size: options.size, position: { displayId: start.displayId, x: start.x, y: start.y }, show: false,
    titleBarStyle: "hidden", minimizable: false, hasShadow: true, aspectRatio: options.size.width / options.size.height,
    macos: { ...PANEL, level: "floating", cornerSnapping: { margin } },
  }, async () => {
    const watching = await watch(id, { closed: () => { state.close(); } });
    try { await showWindow(id, { focus: false }); } catch (cause) { await watching.remove(); throw cause; }
    return {
      id,
      async snapTo(at, snapOptions = {}) {
        enumeration(at, CORNERS, "corner"); object(snapOptions, "snap options"); keys(snapOptions, ["displayId"]);
        return state.run(async () => {
          const { bounds } = await getWindow(id);
          await setWindowBounds(id, corner(await display(snapOptions.displayId ?? bounds.displayId), bounds, at, margin), { macos: { durationMs: ANIMATION_MS } });
        });
      },
      close: () => state.run(async () => {
        const result = await closeWindow(id);
        if (result.closed) { state.close(); await watching.remove(); }
        return result;
      }),
    };
  });
}

// Popover ------------------------------------------------------------------------------------------------------

/** What a popover hangs below: a rectangle (`Tray.getBounds()` for a tray item), or the notch (the menu bar's center on displays without one). */
export type PopoverAnchor = { type: "rect"; rect: DisplayRect } | { type: "notch"; displayId?: DisplayId };
/** Options for `openPopover`. `size` is 100–20000 logical units. */
export interface PopoverOptions extends SpecialWindowContent {
  size: Size;
  anchor: PopoverAnchor;
  /** Closes the popover when it loses key focus (a click elsewhere). Default true. */
  dismissOnBlur?: boolean;
  /** Default `popover`. */
  material?: SpecialWindowMaterial;
}
/** The controller `openPopover` resolves with. Commands reject `E_CLOSED` once the popover has closed. */
export interface Popover { readonly id: WindowId; close(): Promise<CloseResult> }
const POPOVER_GAP = 4;
/**
 * A menu bar, tray or notch popover: a non-activating panel with popover vibrancy, centered below its anchor
 * and kept inside the display, given key focus; it closes when it loses key focus. Without `displayId` a
 * notch popover uses the first display with a notch (a top safe area), else the primary display.
 */
export async function openPopover(options: PopoverOptions): Promise<Popover> {
  validate("popover", options, ["size", "anchor", "dismissOnBlur", "material"]);
  size(options.size);
  const anchor = options.anchor; object(anchor, "anchor");
  if (anchor.type === "rect") { keys(anchor, ["type", "rect"]); rect(anchor.rect, "anchor.rect"); }
  else if (anchor.type === "notch") { keys(anchor, ["type", "displayId"]); if (anchor.displayId !== undefined) text(anchor.displayId, "display ID", false); }
  else throw new SparkError("E_INVALID_ARGUMENT", "Invalid popover anchor");
  if (options.dismissOnBlur !== undefined && typeof options.dismissOnBlur !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "dismissOnBlur must be boolean");
  if (options.material !== undefined) enumeration(options.material, MATERIALS, "material");
  const { id } = options, { width, height } = options.size, state = controller(id, "popover");
  let below: DisplayRect, target: DisplayInfo;
  if (anchor.type === "rect") { below = anchor.rect; target = await display(below.displayId); }
  else {
    const details = await getDisplayDetails();
    const notched = anchor.displayId === undefined ? details.find(item => item.safeArea.top > 0) ?? details.find(item => item.primary) : details.find(item => item.id === anchor.displayId);
    if (!notched) throw new SparkError("E_NOT_FOUND", "Display is disconnected");
    target = await display(notched.id);
    below = { displayId: notched.id, x: notched.size.width / 2, y: 0, width: 0, height: Math.max(notched.workArea.y, notched.safeArea.top) };
  }
  const x = round(clamp(below.x + below.width / 2 - width / 2, 0, target.size.width - width)), y = round(below.y + below.height + POPOVER_GAP);
  let watching: AsyncRegistration | undefined;
  const close = () => state.run(async () => {
    const result = await closeWindow(id);
    if (result.closed) { state.close(); await watching?.remove(); }
    return result;
  });
  return openWith({
    ...content(options), size: options.size, position: { displayId: target.id, x, y }, show: false,
    titleBarStyle: "hidden", transparent: true, resizable: false, minimizable: false, closable: false,
    macos: { ...PANEL, level: "floating", backgroundMaterial: options.material ?? "popover" },
  }, async () => {
    watching = await watch(id, {
      focusChanged: focused => { if (!focused && options.dismissOnBlur !== false && !state.closed) close().catch(error => report({}, error)); },
      closed: () => { state.close(); },
    });
    try { await showWindow(id, { focus: true }); } catch (cause) { await watching.remove(); throw cause; }
    return { id, close };
  });
}

// Edge drawer --------------------------------------------------------------------------------------------------

/** Options for `createEdgeDrawer`. Lengths are logical units. */
export interface EdgeDrawerOptions extends SpecialWindowContent {
  edge: ScreenEdge;
  /** How far the drawer reaches into the display (100–20000). */
  thickness: number;
  /** Along the edge, centered (100–20000). Default: the whole edge of the work area. */
  length?: number;
  /** Default: the primary display. */
  displayId?: DisplayId;
  /** Default `sidebar`. */
  material?: SpecialWindowMaterial;
}
/** The controller `createEdgeDrawer` resolves with. `open` and `close` slide the drawer in and out; commands reject `E_CLOSED` once its window has closed. */
export interface EdgeDrawer extends AsyncRegistration { readonly id: WindowId; readonly isOpen: boolean; open(): Promise<void>; close(): Promise<void>; toggle(): Promise<void> }
function drawerFrame({ id, workArea: area }: DisplayInfo, edge: ScreenEdge, thickness: number, length: number | undefined, open: boolean): WindowBounds {
  const vertical = edge === "left" || edge === "right";
  const along = Math.min(length ?? (vertical ? area.height : area.width), vertical ? area.height : area.width);
  const width = vertical ? thickness : along, height = vertical ? along : thickness, out = open ? 0 : thickness;
  const x = edge === "left" ? area.x - out : edge === "right" ? area.x + area.width - thickness + out : round(area.x + (area.width - width) / 2);
  const y = edge === "top" ? area.y - out : edge === "bottom" ? area.y + area.height - thickness + out : round(area.y + (area.height - height) / 2);
  return { displayId: id, x, y, width, height };
}
/**
 * A drawer that slides in from an edge of a display's work area over other windows (and out again when closed),
 * a non-activating panel on every Space. Hidden until opened; `remove()` closes its window.
 */
export async function createEdgeDrawer(options: EdgeDrawerOptions): Promise<EdgeDrawer> {
  validate("edgeDrawer", options, ["edge", "thickness", "length", "displayId", "material"]);
  enumeration(options.edge, EDGES, "edge");
  number(options.thickness, "thickness", 100, 20000);
  if (options.length !== undefined) number(options.length, "length", 100, 20000);
  if (options.displayId !== undefined) text(options.displayId, "display ID", false);
  if (options.material !== undefined) enumeration(options.material, MATERIALS, "material");
  const { id, edge, thickness, length } = options, state = controller(id, "edge drawer");
  const frame = async (open: boolean) => drawerFrame(await display(options.displayId), edge, thickness, length, open);
  const closedFrame = await frame(false);
  let isOpen = false;
  const open = () => state.run(async () => {
    if (isOpen) return;
    await setWindowBounds(id, await frame(false));
    await showWindow(id, { focus: true });
    isOpen = true;
    await setWindowBounds(id, await frame(true), { macos: { durationMs: ANIMATION_MS } });
  });
  const close = () => state.run(async () => {
    if (!isOpen) return;
    isOpen = false;
    await setWindowBounds(id, await frame(false), { macos: { durationMs: ANIMATION_MS } });
    await hideWindow(id);
  });
  return openWith({
    ...content(options), size: { width: closedFrame.width, height: closedFrame.height }, position: { displayId: closedFrame.displayId, x: closedFrame.x, y: closedFrame.y }, show: false,
    titleBarStyle: "hidden", transparent: true, hasShadow: true, resizable: false, minimizable: false, closable: false,
    macos: { ...PANEL, level: "floating", backgroundMaterial: options.material ?? "sidebar" },
  }, async () => {
    const watching = await watch(id, { closed: () => { state.close(); } });
    const registration = asyncRegistration(() => { state.close(); }, async () => {
      await watching.remove();
      try { await closeWindow(id); } catch (cause) { if (nativeError(cause).code !== "E_NOT_FOUND") throw cause; }
    });
    return { id, get isOpen() { return isOpen; }, open, close, toggle: () => isOpen ? close() : open(), remove: registration.remove };
  });
}

// Overlay and desktop widget -----------------------------------------------------------------------------------

/** Options for `openOverlay`. */
export interface OverlayOptions extends SpecialWindowContent {
  /** Default: the whole primary display. */
  rect?: DisplayRect;
  /** Mouse events pass through to whatever is behind the overlay. Default true. */
  clickThrough?: boolean;
}
/**
 * A transparent overlay: borderless, shadowless, never key, above other apps' windows (status level), on every
 * Space and over fullscreen apps, and by default click-through. Close it with `closeWindow`.
 */
export async function openOverlay(options: OverlayOptions): Promise<WindowInfo> {
  validate("overlay", options, ["rect", "clickThrough"]);
  if (options.rect !== undefined) rect(options.rect, "rect");
  if (options.clickThrough !== undefined && typeof options.clickThrough !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "clickThrough must be boolean");
  let area: DisplayRect;
  if (options.rect) area = options.rect;
  else { const { id, size: whole } = await display(); area = { displayId: id, x: 0, y: 0, ...whole }; }
  size({ width: area.width, height: area.height }, "rect");
  return openWindow({ ...content(options), kind: "overlay", size: { width: area.width, height: area.height }, position: { displayId: area.displayId, x: area.x, y: area.y }, ignoreMouseEvents: options.clickThrough ?? true });
}

/** Options for `openDesktopWidget`. `size` (100–20000) and `position` are logical units, `position` from the display's top-left corner. */
export interface DesktopWidgetOptions extends SpecialWindowContent {
  size: Size;
  position: { displayId: DisplayId; x: number; y: number };
  material?: SpecialWindowMaterial;
}
/**
 * A desktop widget: a borderless, transparent window on the desktop layer, above the desktop picture and below
 * the desktop icons and every app window, on every Space, left in place by Mission Control and Show Desktop
 * and out of the ⌘` cycle. Close it with `closeWindow`.
 */
export async function openDesktopWidget(options: DesktopWidgetOptions): Promise<WindowInfo> {
  validate("desktopWidget", options, ["size", "position", "material"]);
  size(options.size);
  object(options.position, "position"); keys(options.position, ["displayId", "x", "y"]);
  if (options.material !== undefined) enumeration(options.material, MATERIALS, "material");
  return openWindow({
    ...content(options), size: options.size, position: options.position, titleBarStyle: "borderless", transparent: true, hasShadow: false, resizable: false, minimizable: false, closable: false,
    macos: { panelStyle: "nonactivating", level: "desktop", spaces: "all", stationary: true, ignoresCycle: true, ...(options.material ? { backgroundMaterial: options.material } : {}) },
  });
}

// Presenter mode -----------------------------------------------------------------------------------------------

/** Why presenter mode ended: `stop()` was called, a display disconnected, or one of its windows closed. */
export type PresenterEndReason = "stopped" | "displayRemoved" | "windowClosed";
/** Options for `startPresenterMode`. The audience and controller windows need different IDs and different displays. */
export interface PresenterModeOptions {
  /** Fills the audience display, above its menu bar. */
  audience: SpecialWindowContent;
  /** An ordinary window centered on the controller display (default 1000 × 700, fitted into its work area). */
  controller: SpecialWindowContent & { size?: Size };
  /** Default: the first display that is not primary. */
  audienceDisplayId?: DisplayId;
  /** Default: the primary display, or the first other display when the audience is on the primary one. */
  controllerDisplayId?: DisplayId;
  /** Called once when presenter mode ends; `stop()` ends it with `stopped`. */
  onEnd?: (event: { reason: PresenterEndReason }) => void;
}
/** The session `startPresenterMode` resolves with. */
export interface PresenterMode {
  readonly audienceDisplayId: DisplayId;
  readonly controllerDisplayId: DisplayId;
  /** Moves the audience and controller windows to each other's display. */
  swapDisplays(): Promise<void>;
  /** Closes both windows. */
  stop(): Promise<void>;
}
/**
 * Presenter mode: the audience window fills one display while the presenter's controller window is on another.
 * It needs two displays (E_UNAVAILABLE with one). When either display disconnects or either window closes,
 * presenter mode ends and closes the other window.
 */
export async function startPresenterMode(options: PresenterModeOptions): Promise<PresenterMode> {
  object(options, "presenter options"); keys(options, ["audience", "controller", "audienceDisplayId", "controllerDisplayId", "onEnd"]);
  for (const [name, value] of [["audience", options.audience], ["controller", options.controller]] as const) { object(value, name); keys(value, [...CONTENT, ...(name === "controller" ? ["size"] : [])]); }
  if (options.controller.size !== undefined) size(options.controller.size, "controller.size");
  if (options.onEnd !== undefined && typeof options.onEnd !== "function") throw new SparkError("E_INVALID_ARGUMENT", "onEnd must be a function");
  supported("presenter");
  if (options.audience.id === options.controller.id) throw new SparkError("E_INVALID_ARGUMENT", "The audience and controller windows need different IDs");
  const displays = await getDisplays();
  if (displays.length < 2) throw new SparkError("E_UNAVAILABLE", "Presenter mode needs two displays");
  const find = (displayId: DisplayId) => displays.find(item => item.id === displayId) ?? (() => { throw new SparkError("E_NOT_FOUND", "Display is disconnected"); })();
  let audience = options.audienceDisplayId !== undefined ? find(options.audienceDisplayId) : displays.find(item => !item.primary)!;
  let presenter = options.controllerDisplayId !== undefined ? find(options.controllerDisplayId) : displays.find(item => item.primary && item !== audience) ?? displays.find(item => item !== audience)!;
  if (audience.id === presenter.id) throw new SparkError("E_INVALID_ARGUMENT", "The audience and controller need different displays");
  const audienceFrame = ({ id, size: { width, height } }: DisplayInfo): WindowBounds => ({ displayId: id, x: 0, y: 0, width, height });
  const controllerFrame = (target: DisplayInfo): WindowBounds => {
    const wanted = options.controller.size ?? { width: 1000, height: 700 };
    const fitted = { width: Math.max(100, Math.min(wanted.width, target.workArea.width)), height: Math.max(100, Math.min(wanted.height, target.workArea.height)) };
    return placed(target, fitted, 0.5);
  };
  const ids = [options.audience.id, options.controller.id] as const;
  const state = controller(ids[0], "presenter mode");
  let ended = false, watching: AsyncRegistration[] = [];
  const end = async (reason: PresenterEndReason) => {
    if (ended) return;
    ended = true; state.close();
    await Promise.allSettled(watching.map(item => item.remove()));
    const results = await Promise.allSettled(ids.map(id => closeWindow(id).catch(cause => { if (nativeError(cause).code !== "E_NOT_FOUND") throw cause; })));
    try { options.onEnd?.({ reason }); } catch (error) { console.error(error); }
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
  };
  const a = audienceFrame(audience), c = controllerFrame(presenter);
  await openWindow({ ...content(options.audience), size: { width: a.width, height: a.height }, position: { displayId: a.displayId, x: a.x, y: a.y },
    titleBarStyle: "borderless", hasShadow: false, resizable: false, minimizable: false, macos: { level: "status", ignoresCycle: true } });
  try {
    await openWindow({ ...content(options.controller), size: { width: c.width, height: c.height }, position: { displayId: c.displayId, x: c.x, y: c.y } });
    const closed = () => { end("windowClosed").catch(error => console.error(error)); };
    watching = [await addWindowListener(ids[0], "closed", closed), await addWindowListener(ids[1], "closed", closed)];
    watching.push(await addDisplayListener(event => { if (event.removed.includes(audience.id) || event.removed.includes(presenter.id)) end("displayRemoved").catch(error => console.error(error)); }));
  } catch (cause) {
    ended = true;
    await Promise.allSettled([...watching.map(item => item.remove()), ...ids.map(id => closeWindow(id))]);
    throw cause;
  }
  return {
    get audienceDisplayId() { return audience.id; },
    get controllerDisplayId() { return presenter.id; },
    swapDisplays: () => state.run(async () => {
      const current = await getDisplays();
      const nextAudience = current.find(item => item.id === presenter.id), nextPresenter = current.find(item => item.id === audience.id);
      if (!nextAudience || !nextPresenter) throw new SparkError("E_NOT_FOUND", "Display is disconnected");
      await setWindowBounds(ids[0], audienceFrame(nextAudience));
      await setWindowBounds(ids[1], controllerFrame(nextPresenter));
      audience = nextAudience; presenter = nextPresenter;
    }),
    stop: () => ended ? Promise.resolve() : end("stopped"),
  };
}
