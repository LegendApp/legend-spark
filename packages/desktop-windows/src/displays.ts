import { Platform } from "react-native";
import { SparkError, asyncRegistration, nativeError, type AsyncRegistration, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { onDesktopEvent, type DesktopEvent } from "@legendapp/spark-desktop-app/src/events";
import Native from "./NativeDesktopWindowManager";
import { finite, isDisplayInfo, isDisplayList, record, windowCall, windowCommand } from "./transport";
import type { DisplayId, DisplayInfo } from "./types";
export type { AsyncRegistration } from "@legendapp/spark-desktop-app/src/contracts";
export type { DisplayId, DisplayInfo } from "./types";

export interface DisplayInsets { top: number; left: number; bottom: number; right: number }
/** In Hz. A fixed-rate display reports one rate; ProMotion and adaptive-sync displays vary between minimum and maximum. */
export interface DisplayRefreshRate { minimum: number; maximum: number; variable: boolean }
export interface DisplayColorSpace {
  /** The display profile's name as AppKit localizes it ("Color LCD" in English); for showing, not for matching. Null when the profile has none. */
  name: string | null;
  /** "p3" when the display can show the Display P3 gamut, else "srgb": P3-capable or not, not a precise gamut. */
  gamut: "srgb" | "p3";
}
/** Extended dynamic range headroom: the largest color component value, where 1 is SDR white. */
export interface DisplayEDRHeadroom {
  /** Available now; it follows brightness and whether content on screen requested EDR. */
  current: number;
  /** The most the display can reach. 1 means no EDR. */
  potential: number;
  /** In a reference (fixed brightness) preset; null when the display has none. */
  reference: number | null;
}
export interface DisplayDetails extends DisplayInfo {
  /** Top-left corner in the display arrangement: logical units from the primary display's top-left, Y downward. */
  origin: { x: number; y: number };
  /** Insets, in logical units, of the area clear of the camera housing (notch). Zero without one. */
  safeArea: DisplayInsets;
  refreshRate: DisplayRefreshRate;
  colorSpace: DisplayColorSpace;
  edrHeadroom: DisplayEDRHeadroom;
}
export type DisplayField = Exclude<keyof DisplayDetails, "id">;
/** One reported change: the new display list and what differs from the previous one. */
export interface DisplayChangeEvent {
  displays: DisplayDetails[];
  added: DisplayId[];
  removed: DisplayId[];
  changed: { id: DisplayId; fields: DisplayField[] }[];
}
export interface DisplayListenerOptions { onError?: (error: SparkError) => void }

const FIELDS: readonly DisplayField[] = ["persistentId", "name", "primary", "origin", "size", "workArea", "scaleFactor", "safeArea", "refreshRate", "colorSpace", "edrHeadroom"];
const numbers = (value: unknown, keys: readonly string[]) => record(value) && keys.every(key => finite(value[key]));
function isDetails(item: unknown): item is DisplayDetails {
  if (!isDisplayInfo(item)) return false;
  const { origin, safeArea, refreshRate: rate, colorSpace: color, edrHeadroom: edr } = item as unknown as Record<string, any>;
  return numbers(origin, ["x", "y"]) && numbers(safeArea, ["top", "left", "bottom", "right"])
    && numbers(rate, ["minimum", "maximum"]) && rate.minimum > 0 && rate.minimum <= rate.maximum && rate.variable === (rate.minimum < rate.maximum)
    && record(color) && (color.name === null || typeof color.name === "string") && ["srgb", "p3"].includes(color.gamut)
    && numbers(edr, ["current", "potential"]) && (edr.reference === null || finite(edr.reference));
}
const isDetailsList = (value: unknown): value is DisplayDetails[] => isDisplayList(value, isDetails);

/** macOS only. Windows reports `unsupported-platform`; its implementation is tracked in #318. */
export function getDisplayAvailability(): Availability {
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  return Native ? { available: true } : { available: false, reason: "missing-module" };
}
function requireAvailable() {
  const availability = getDisplayAvailability();
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", "Display details require macOS with the window module installed");
}

/** Every connected display, primary included, with arrangement, safe area, refresh rate, color space and EDR headroom. */
export async function getDisplayDetails(): Promise<DisplayDetails[]> {
  requireAvailable();
  return windowCall("displayDetails", {}, isDetailsList);
}

/** Structural equality of JSON values, independent of key order. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => same(value, b[index]));
  if (!record(a) || !record(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
}
function compare(previous: readonly DisplayDetails[], displays: DisplayDetails[]): DisplayChangeEvent | undefined {
  const before = new Map(previous.map(display => [display.id, display]));
  const ids = new Set(displays.map(display => display.id));
  const added = displays.filter(display => !before.has(display.id)).map(display => display.id);
  const removed = previous.filter(display => !ids.has(display.id)).map(display => display.id);
  const changed = displays.flatMap(display => {
    const old = before.get(display.id);
    const fields = old ? FIELDS.filter(field => !same(old[field], display[field])) : [];
    return fields.length ? [{ id: display.id, fields }] : [];
  });
  return added.length || removed.length || changed.length ? { displays, added, removed, changed } : undefined;
}
function report(options: DisplayListenerOptions, cause: unknown) { try { (options.onError ?? console.error)(nativeError(cause)); } catch (error) { console.error(error); } }

/**
 * Calls `listener` when a display connects or disconnects, the arrangement or primary display changes,
 * or a display's resolution, work area, scale, safe area, refresh rate, color space or EDR headroom
 * changes. Resolves once native observation runs; it stops with the last listener.
 */
export async function addDisplayListener(listener: (event: DisplayChangeEvent) => void, options: DisplayListenerOptions = {}): Promise<AsyncRegistration> {
  if (typeof listener !== "function" || !record(options) || (options.onError !== undefined && typeof options.onError !== "function")) throw new SparkError("E_INVALID_ARGUMENT", "Invalid display listener");
  for (const key of Object.keys(options)) if (key !== "onError") throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported display listener option: ${key}`);
  requireAvailable();
  let last: DisplayDetails[] | undefined, sequence = 0, stopped = false;
  const buffered: DesktopEvent[] = [];
  const consume = (event: DesktopEvent) => {
    if (stopped) return;
    if (!last) { buffered.push(event); return; }
    if (!finite(event.sequence) || event.sequence <= sequence) return;
    sequence = event.sequence;
    if (!isDetailsList(event.displays)) { report(options, new SparkError("E_INVALID_DATA", "Malformed display event")); return; }
    const change = compare(last, event.displays);
    last = event.displays;
    if (change) try { listener(change); } catch (cause) { report(options, cause); }
  };
  // Not /system's payload-free "displaysChanged" (onSystemEvent): a separate event type, so neither stream reaches the other.
  const subscription = onDesktopEvent(consume, { types: ["displayDetailsChanged"] });
  let observing = false;
  try {
    // Native observation starts before the snapshot is validated, so a rejected snapshot must release it.
    const snapshot = await windowCall("observeDisplays", {}, (value): value is unknown => true);
    observing = true;
    if (!record(snapshot) || !finite(snapshot.sequence) || !isDetailsList(snapshot.displays)) throw new SparkError("E_INVALID_DATA", "Malformed display snapshot");
    sequence = snapshot.sequence; last = snapshot.displays;
    buffered.splice(0).forEach(consume);
  } catch (cause) {
    stopped = true; subscription.remove();
    if (observing) await windowCommand("unobserveDisplays", {}).catch(error => report(options, error));
    throw cause;
  }
  return asyncRegistration(() => { stopped = true; subscription.remove(); }, () => windowCommand("unobserveDisplays", {}));
}
