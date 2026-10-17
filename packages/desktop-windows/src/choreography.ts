import { Platform } from "react-native";
import { SparkError, asyncRegistration, nativeError, type AsyncRegistration, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { getWindowAvailability, openWindow } from "./api";
import { record, subscribeToWindowInstance, windowCall, windowCommand } from "./transport";
import { bounds, keys, number, object, text, windowId } from "./validation";
import type { DisplayRect } from "./special";
import type { WindowBounds, WindowId, WindowOpenOptions } from "./types";

// Window choreography (docs/api-window-contract.md#window-choreography): zooms from and back into a source rectangle,
// animated frame changes, close transitions with focus handoff, and attached windows. The native window module animates
// frames and opacity on the main thread, follows Reduce Motion, and in driver runs follows motion's virtual clock.
// macOS only for now.

/** A feature `getWindowChoreographyAvailability` reports: `zoom` (`openWindowFrom`), `frame` (`animateWindowBounds`), `closeTransition` (`setWindowCloseTransition`), `attach` (`attachWindow`). */
export type WindowChoreographyFeature = "zoom" | "frame" | "closeTransition" | "attach";
const FEATURES: readonly WindowChoreographyFeature[] = ["zoom", "frame", "closeTransition", "attach"];
/** The cubic easing curve of a window animation. */
export type WindowEasing = "linear" | "easeIn" | "easeOut" | "easeInOut";
const EASINGS: readonly WindowEasing[] = ["linear", "easeIn", "easeOut", "easeInOut"];
/** Duration and easing of a window choreography animation. */
export interface WindowTransition {
  /** 0–5000, default 250. */
  durationMs?: number;
  /** Cubic easing, default `easeInOut`. */
  easing?: WindowEasing;
}
/** `finished` is false when another animation of the window, `stopWindowAnimation` or closing interrupted it. `reducedMotion`: Reduce Motion was on, so the frame changed at once and only the opacity faded. */
export interface WindowAnimationResult { finished: boolean; reducedMotion: boolean }
/** A rectangle in a window's React root view, from its top-left corner, as `measureInWindow` reports it (a list row, a thumbnail, a tab). */
export interface WindowContentRect { windowId: WindowId; x: number; y: number; width: number; height: number }
/** Where a choreography starts or ends: a rectangle on a display, or one in a window's content. */
export type WindowSourceRect = DisplayRect | WindowContentRect;

/** Every feature is implemented on macOS. Windows reports `unsupported-platform` (Windows follow-up: docs/api-window-contract.md#window-choreography). */
export function getWindowChoreographyAvailability(feature: WindowChoreographyFeature): Availability {
  if (!FEATURES.includes(feature)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown window choreography feature");
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  return getWindowAvailability();
}
function supported(feature: WindowChoreographyFeature) {
  const availability = getWindowChoreographyAvailability(feature);
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "Window choreography requires macOS");
}
function transition(value: WindowTransition | undefined): Required<WindowTransition> {
  if (value === undefined) return { durationMs: 250, easing: "easeInOut" };
  object(value, "transition"); keys(value, ["durationMs", "easing"]);
  if (value.durationMs !== undefined) number(value.durationMs, "durationMs", 0, 5000);
  if (value.easing !== undefined && !EASINGS.includes(value.easing)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid easing");
  return { durationMs: value.durationMs ?? 250, easing: value.easing ?? "easeInOut" };
}
function sourceRect(value: unknown, name: string): WindowSourceRect {
  object(value, name);
  const owner = "windowId" in value ? "windowId" : "displayId";
  keys(value, [owner, "x", "y", "width", "height"]);
  if (owner === "windowId") windowId(value.windowId); else text(value.displayId, "display ID", false);
  for (const key of ["x", "y"] as const) number(value[key], `${name}.${key}`, -10000000, 10000000);
  for (const key of ["width", "height"] as const) number(value[key], `${name}.${key}`, 0, 20000);
  const { x, y, width, height } = value as unknown as WindowContentRect;
  return owner === "windowId" ? { windowId: value.windowId as string, x, y, width, height } : { displayId: value.displayId as string, x, y, width, height };
}
const isResult = (value: unknown): value is WindowAnimationResult => record(value) && typeof value.finished === "boolean" && typeof value.reducedMotion === "boolean";
const animation = (method: string, args: object) => windowCall(method, args, isResult).then(({ finished, reducedMotion }) => ({ finished, reducedMotion }));

/**
 * Animates the window to `bounds` (an animated compact↔full switch, a Settings pane resize). Resolves when it ends.
 * Under Reduce Motion the frame changes at once. A later animation of the window interrupts this one where it is.
 */
export async function animateWindowBounds(id: WindowId, value: WindowBounds, options?: WindowTransition): Promise<WindowAnimationResult> {
  windowId(id); bounds(value); const timing = transition(options);
  supported("frame");
  return animation("animate", { id, bounds: value, ...timing });
}
/** Stops the window's running animation where it is; that animation resolves `finished: false`. */
export async function stopWindowAnimation(id: WindowId): Promise<void> {
  windowId(id); supported("frame");
  await windowCommand("stopAnimation", { id });
}

/** A close transition for `setWindowCloseTransition`: where the closing window shrinks to and which window takes focus. */
export interface WindowCloseTransition {
  /** Where the window shrinks to as it closes; `null` fades it out where it is. */
  to: WindowSourceRect | null;
  /** The window that takes key focus as the shrink starts. Default: the window `to` is in, else the parent window. */
  focus?: WindowId;
  transition?: WindowTransition;
}
function closeTransition(id: WindowId, value: WindowCloseTransition | null) {
  if (value === null) return null;
  object(value, "close transition"); keys(value, ["to", "focus", "transition"]);
  const to = value.to === null ? null : sourceRect(value.to, "to");
  if (value.focus !== undefined) { windowId(value.focus); if (value.focus === id) throw new SparkError("E_INVALID_ARGUMENT", "A closing window cannot take focus"); }
  return { to, ...(value.focus !== undefined ? { focus: value.focus } : {}), ...transition(value.transition) };
}
/**
 * From now on, closing the window (`closeWindow`, the close button, ⌘W) first shrinks it into `to` while it fades out,
 * handing key focus to `focus`, then closes it; a close guard decides before the shrink starts. Another animation of the
 * window during the shrink cancels the close (`closeWindow` resolves `{ closed: false, reason: "interrupted" }`).
 * `null` removes the transition. Merging a torn-off panel back is a close transition into its slot.
 */
export async function setWindowCloseTransition(id: WindowId, value: WindowCloseTransition | null): Promise<void> {
  windowId(id); const native = closeTransition(id, value);
  supported("closeTransition");
  await windowCommand("closeTransition", { id, transition: native });
}

/** The zoom for `openWindowFrom`: where the window grows from and how it closes back. */
export interface WindowZoomOptions {
  /** The element the window grows from: a list row, a thumbnail, a tab or panel being torn off. */
  from: WindowSourceRect;
  /** Where the window shrinks to when it closes. Default `from`; `null` closes without a transition. */
  closeTo?: WindowSourceRect | null;
  /** The window that takes key focus when it closes (see `setWindowCloseTransition`). */
  focusOnClose?: WindowId;
  transition?: WindowTransition;
}
/** What `openWindowFrom` resolves with: the opened window and its running zoom. */
export interface WindowZoom {
  readonly id: WindowId;
  /** Where the window lands: the frame `openWindow` gave it. */
  readonly bounds: WindowBounds;
  /** Resolves when the zoom ends. */
  readonly finished: Promise<WindowAnimationResult>;
}
/**
 * Opens a window that grows from `from` to its frame while it fades in, with key focus, and by default shrinks back
 * into `from` when it closes. Resolves once the window is opened (hidden at its frame) and the zoom is requested; the
 * window shows at `from` as the zoom starts, and `finished` resolves when the zoom ends. Under Reduce
 * Motion both are cross-fades at the window's frame. The window opens as `openWindow` opens it, so `show: false`,
 * sheets (`modal`) and tabs (`tabbedWith`) are rejected.
 */
export async function openWindowFrom(options: WindowOpenOptions, zoom: WindowZoomOptions): Promise<WindowZoom> {
  object(options, "window options"); object(zoom, "zoom"); keys(zoom, ["from", "closeTo", "focusOnClose", "transition"]);
  if (options.show === false || options.modal || options.tabbedWith !== undefined) throw new SparkError("E_INVALID_ARGUMENT", "A zoom shows an ordinary window: show: false, modal and tabbedWith do not apply");
  const from = sourceRect(zoom.from, "from"), timing = transition(zoom.transition);
  const close = zoom.closeTo === null ? null : closeTransition(options.id, { to: zoom.closeTo === undefined ? from : zoom.closeTo, ...(zoom.focusOnClose !== undefined ? { focus: zoom.focusOnClose } : {}), transition: timing });
  supported("zoom");
  const info = await openWindow({ ...options, show: false });
  const discard = async (cause: unknown) => {
    try { await windowCommand("discard", { id: options.id }); }
    catch (cleanup) { throw new SparkError("E_NATIVE", "Zooming the window and closing it again both failed", { cause: new AggregateError([cause, cleanup]) }); }
    throw cause;
  };
  if (close) await windowCommand("closeTransition", { id: options.id, transition: close }).catch(discard);
  // The native zoom shows the window at once; it can only fail before that (the source's window or display is gone).
  const finished = animation("zoomIn", { id: options.id, from, ...timing }).catch(discard);
  // A caller that ignores `finished` gets no unhandled rejection; one that awaits it still gets the failure.
  finished.catch(() => {});
  return { id: options.id, bounds: info.bounds, finished };
}

/** The parent edge `attachWindow` docks a window at. `leading` and `trailing` follow the app's layout direction. */
export type WindowAttachmentEdge = "leading" | "trailing" | "left" | "right" | "top" | "bottom";
const EDGES: readonly WindowAttachmentEdge[] = ["leading", "trailing", "left", "right", "top", "bottom"];
/** Options for `attachWindow`. */
export interface WindowAttachOptions {
  /** The parent's edge. Leading and trailing follow the app's layout direction. */
  edge: WindowAttachmentEdge;
  /** Along the edge: `start` (the top, or the leading end; default), `center` or `end`. */
  align?: "start" | "center" | "end";
  /** Points between the parent and the window, 0–200, default 0. */
  gap?: number;
  /** A move of the window that ends within this many points of its docked frame docks it; farther undocks it. 0–200, default 24. */
  magnetic?: number;
  /** Hides the window while the app is inactive (palettes, inspectors). Default false. */
  hideWhenInactive?: boolean;
  /** How the window moves into its docked frame. */
  transition?: WindowTransition;
  /** The window docked (`true`) or undocked (`false`, also when the parent closes). */
  onChange?: (event: { windowId: WindowId; attached: boolean }) => void;
  onError?: (error: SparkError) => void;
}
/** The registration `attachWindow` resolves with; `remove()` undocks the window where it is. */
export interface WindowAttachment extends AsyncRegistration {
  readonly id: WindowId;
  readonly parentId: WindowId;
  /** Docked at the parent's edge now. */
  readonly attached: boolean;
}
let attachmentSequence = 0;
/**
 * Docks the window at an edge of `parentId` (a palette, an inspector): it moves there, then moves with the parent as a
 * group and follows the parent's resizes. A person can drag it off (it undocks) and back (it docks magnetically).
 * Resolves once it is docked in place. One attachment per window: attaching again replaces it, and `remove()` of the
 * replaced attachment does nothing. `remove()` undocks it where it is. The attachment ends when either window closes.
 */
export async function attachWindow(id: WindowId, parentId: WindowId, options: WindowAttachOptions): Promise<WindowAttachment> {
  windowId(id); windowId(parentId); object(options, "attach options");
  keys(options, ["edge", "align", "gap", "magnetic", "hideWhenInactive", "transition", "onChange", "onError"]);
  if (id === parentId) throw new SparkError("E_INVALID_ARGUMENT", "A window cannot attach to itself");
  if (!EDGES.includes(options.edge)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid edge");
  if (options.align !== undefined && !["start", "center", "end"].includes(options.align)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid align");
  if (options.gap !== undefined) number(options.gap, "gap", 0, 200);
  if (options.magnetic !== undefined) number(options.magnetic, "magnetic", 0, 200);
  if (options.hideWhenInactive !== undefined && typeof options.hideWhenInactive !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "hideWhenInactive must be boolean");
  for (const key of ["onChange", "onError"] as const) if (options[key] !== undefined && typeof options[key] !== "function") throw new SparkError("E_INVALID_ARGUMENT", `${key} must be a function`);
  const timing = transition(options.transition);
  supported("attach");
  const token = `attach-${Date.now()}-${++attachmentSequence}`;
  let attached = true;
  const report = (cause: unknown) => { try { (options.onError ?? console.error)(nativeError(cause)); } catch (error) { console.error(error); } };
  const subscription = await subscribeToWindowInstance(id, event => {
    if (event.type === "closed") { attached = false; return; }
    if (event.type !== "attachmentChanged" || event.token !== token) return;
    if (typeof event.attached !== "boolean") { report(new SparkError("E_INVALID_DATA", "Malformed attachment event")); return; }
    attached = event.attached;
    try { options.onChange?.({ windowId: id, attached }); } catch (cause) { report(cause); }
  }, ["attachmentChanged"]);
  try {
    await animation("attach", { id, parentId, token, edge: options.edge, align: options.align ?? "start", gap: options.gap ?? 0, magnetic: options.magnetic ?? 24, hideWhenInactive: options.hideWhenInactive ?? false, ...timing });
  } catch (cause) { await subscription.remove(); throw cause; }
  const registration = asyncRegistration(() => { void subscription.remove(); }, async () => {
    try { await windowCommand("detach", { id, token }); } catch (cause) { if (nativeError(cause).code !== "E_NOT_FOUND") throw cause; }
    attached = false;
  });
  return { id, parentId, get attached() { return attached; }, remove: registration.remove };
}
