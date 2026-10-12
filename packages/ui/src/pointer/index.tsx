import { Platform, StyleSheet, type NativeSyntheticEvent, type ViewProps } from "react-native";
import { invokeNative, nativeError, SparkError, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { callback, finite, macosViewAvailability, requireAvailable } from "../specialized";
import NativeSparkPointer, { type Spec } from "./NativeSparkPointer";
import NativePointerView from "./PointerViewNativeComponent";

/**
 * Pointer features on macOS (docs/pointer.md). Standard cursors are React Native's `cursor` style; this module adds:
 * - `customCursors`: a PointerView's `customCursor`, an SF Symbol or an image file.
 * - `hideCursorUntilMoved`: hideCursorUntilMoved(). Text inputs already hide the cursor while typing.
 * - `gestures`: a PointerView's onMagnify, onRotate, onSwipe and onSmartMagnify (trackpad).
 * - `pressure`: a PointerView's onPressure (Force Touch trackpad).
 * - `mouseButtons`: a PointerView's onMouseButton (back and forward).
 * - `haptics`: performHapticFeedback() (Force Touch trackpad).
 * Gestures, pressure and haptics need the hardware; macOS cannot tell whether it is present, so availability reports
 * the API path, not the device.
 */
export type PointerFeature = "customCursors" | "hideCursorUntilMoved" | "gestures" | "pressure" | "mouseButtons" | "haptics";
const VIEW_FEATURES: readonly PointerFeature[] = ["customCursors", "gestures", "pressure", "mouseButtons"];
const MODULE_FEATURES: readonly PointerFeature[] = ["hideCursorUntilMoved", "haptics"];

/** Without a feature, whether every pointer feature is usable. */
export function getPointerAvailability(feature?: PointerFeature): Availability {
  if (feature !== undefined && !VIEW_FEATURES.includes(feature) && !MODULE_FEATURES.includes(feature)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown pointer feature");
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  if (feature === undefined || VIEW_FEATURES.includes(feature)) {
    const view = macosViewAvailability("SparkPointerView");
    if (!view.available) return view;
  }
  if ((feature === undefined || MODULE_FEATURES.includes(feature)) && !NativeSparkPointer) return { available: false, reason: "missing-module" };
  return { available: true };
}
function native(feature: PointerFeature): Spec {
  requireAvailable(getPointerAvailability(feature), "Pointer");
  return NativeSparkPointer!;
}

/** Hides the cursor until the pointer moves, as text inputs do on every typed key. */
export function hideCursorUntilMoved(): Promise<void> {
  return invokeNative(() => native("hideCursorUntilMoved").hideCursorUntilMoved());
}

/** AppKit's NSHapticFeedbackPattern. */
export type HapticPattern = "generic" | "alignment" | "levelChange";
/** When the feedback plays: `default` (soon), `now`, or `drawCompleted` (after the next screen update). */
export type HapticPerformanceTime = "default" | "now" | "drawCompleted";
export interface HapticFeedbackOptions { performanceTime?: HapticPerformanceTime }
const PATTERNS: readonly HapticPattern[] = ["generic", "alignment", "levelChange"];
const TIMES: readonly HapticPerformanceTime[] = ["default", "now", "drawCompleted"];
/**
 * Plays haptic feedback on a Force Touch trackpad. It resolves once AppKit has the request; without such a trackpad
 * (a mouse, or another trackpad) nothing plays and it still resolves.
 */
export function performHapticFeedback(pattern: HapticPattern, options: HapticFeedbackOptions = {}): Promise<void> {
  return invokeNative(() => {
    if (!PATTERNS.includes(pattern)) throw new SparkError("E_INVALID_ARGUMENT", "Expected a haptic pattern: generic, alignment or levelChange");
    if (!options || typeof options !== "object" || Array.isArray(options)) throw new SparkError("E_INVALID_ARGUMENT", "Expected haptic feedback options");
    for (const key of Object.keys(options)) if (key !== "performanceTime") throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported haptic feedback option: ${key}`);
    const time = options.performanceTime ?? "default";
    if (!TIMES.includes(time)) throw new SparkError("E_INVALID_ARGUMENT", "Expected a performance time: default, now or drawCompleted");
    return native("haptics").performHapticFeedback(pattern, time);
  });
}

/** Points; a hot spot is measured from the image's top-left. */
export interface PointerPoint { x: number; y: number }
export type CustomCursor =
  /** An SF Symbol at `pointSize` (16); the hot spot defaults to its center. */
  | { type: "symbol"; name: string; pointSize?: number; hotSpot?: PointerPoint }
  /** An image file (absolute path), at its size in points. */
  | { type: "image"; path: string; hotSpot: PointerPoint };
/** NSEvent's gesture phase. A trackpad gesture begins, changes and ends (or is cancelled). */
export type GesturePhase = "began" | "stationary" | "changed" | "ended" | "cancelled" | "mayBegin" | "none";
/** Where the event happened: points from the PointerView's top-left. */
export interface PointerLocation { x: number; y: number }
/** `magnification` is the change to add to the current scale (AppKit adds it): 0.1 makes 1.0 into 1.1 and 2.0 into 2.1. */
export interface MagnifyEvent extends PointerLocation { magnification: number; phase: GesturePhase }
/** `rotation` is the change in degrees, clockwise as React Native's rotate transform. */
export interface RotateEvent extends PointerLocation { rotation: number; phase: GesturePhase }
/** A three-finger swipe (with the trackpad set to swipe between pages with three fingers). */
export interface SwipeEvent extends PointerLocation { direction: "left" | "right" | "up" | "down" }
/** A two-finger double tap. */
export type SmartMagnifyEvent = PointerLocation;
/** Force Touch pressure during a click: `stage` 1 is a click, 2 a force click; `stageTransition` approaches the next stage. */
export interface PressureEvent extends PointerLocation { pressure: number; stage: 0 | 1 | 2; stageTransition: number }
/** Reported when the button is released. */
export interface MouseButtonEvent extends PointerLocation { button: "back" | "forward" }
export interface PointerViewProps extends ViewProps {
  /** Covers the view, except descendants with their own cursor. Use it or the `cursor` style, not both. */
  customCursor?: CustomCursor;
  onMagnify?: (event: MagnifyEvent) => void;
  onRotate?: (event: RotateEvent) => void;
  onSwipe?: (event: SwipeEvent) => void;
  onSmartMagnify?: (event: SmartMagnifyEvent) => void;
  onPressure?: (event: PressureEvent) => void;
  onMouseButton?: (event: MouseButtonEvent) => void;
  /** A custom cursor that cannot be loaded (E_INVALID_ARGUMENT), or a malformed native event (E_INVALID_DATA). Default console.error. */
  onError?: (error: SparkError) => void;
}

const CURSOR_KEYS = { symbol: ["type", "name", "pointSize", "hotSpot"], image: ["type", "path", "hotSpot"] } as const;
function point(value: unknown, name: string): asserts value is PointerPoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SparkError("E_INVALID_ARGUMENT", `Expected ${name} {x, y}`);
  for (const key of Object.keys(value)) if (key !== "x" && key !== "y") throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported ${name} key: ${key}`);
  finite((value as PointerPoint).x, `${name} x`); finite((value as PointerPoint).y, `${name} y`);
}
/** The custom cursor as native props; throws for an invalid one. */
function cursorProps(cursor: CustomCursor | undefined) {
  if (cursor === undefined) return { cursorType: "", cursorName: "", cursorPointSize: 0, cursorHasHotSpot: false, cursorHotSpotX: 0, cursorHotSpotY: 0 };
  if (!cursor || typeof cursor !== "object" || (cursor.type !== "symbol" && cursor.type !== "image")) throw new SparkError("E_INVALID_ARGUMENT", "A custom cursor is a symbol or an image");
  for (const key of Object.keys(cursor)) if (!(CURSOR_KEYS[cursor.type] as readonly string[]).includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported ${cursor.type} cursor option: ${key}`);
  const name = cursor.type === "symbol" ? cursor.name : cursor.path;
  if (typeof name !== "string" || !name.trim() || name.includes("\0")) throw new SparkError("E_INVALID_ARGUMENT", cursor.type === "symbol" ? "Expected an SF Symbol name" : "Expected an image path");
  if (cursor.type === "image" && !name.startsWith("/")) throw new SparkError("E_INVALID_ARGUMENT", "A cursor image path is absolute");
  const pointSize = cursor.type === "symbol" ? cursor.pointSize ?? 16 : 0;
  if (cursor.type === "symbol") finite(pointSize, "cursor point size", 1, 256);
  if (cursor.type === "image" || cursor.hotSpot !== undefined) point(cursor.hotSpot, "hotSpot");
  return { cursorType: cursor.type, cursorName: name, cursorPointSize: pointSize, cursorHasHotSpot: cursor.hotSpot !== undefined, cursorHotSpotX: cursor.hotSpot?.x ?? 0, cursorHotSpotY: cursor.hotSpot?.y ?? 0 };
}

type NativeInput = { type: string; x: number; y: number; magnification: number; rotation: number; phase: string; direction: string; pressure: number; stage: number; stageTransition: number; button: string };
const PHASES: readonly string[] = ["began", "stationary", "changed", "ended", "cancelled", "mayBegin", "none"];
const DIRECTIONS: readonly string[] = ["left", "right", "up", "down"];
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value);
/** The typed event for a native pointer input, or undefined when it breaks the contract. */
function parseInput(data: NativeInput | undefined) {
  if (!data || !number(data.x) || !number(data.y)) return undefined;
  const at = { x: data.x, y: data.y };
  switch (data.type) {
    case "magnify": return number(data.magnification) && PHASES.includes(data.phase) ? { type: "magnify", event: { ...at, magnification: data.magnification, phase: data.phase as GesturePhase } } as const : undefined;
    case "rotate": return number(data.rotation) && PHASES.includes(data.phase) ? { type: "rotate", event: { ...at, rotation: data.rotation, phase: data.phase as GesturePhase } } as const : undefined;
    case "swipe": return DIRECTIONS.includes(data.direction) ? { type: "swipe", event: { ...at, direction: data.direction as SwipeEvent["direction"] } } as const : undefined;
    case "smartMagnify": return { type: "smartMagnify", event: at } as const;
    case "pressure": return number(data.pressure) && number(data.stageTransition) && (data.stage === 0 || data.stage === 1 || data.stage === 2)
      ? { type: "pressure", event: { ...at, pressure: data.pressure, stage: data.stage, stageTransition: data.stageTransition } } as const : undefined;
    case "mouseButton": return data.button === "back" || data.button === "forward" ? { type: "mouseButton", event: { ...at, button: data.button } } as const : undefined;
    default: return undefined;
  }
}

/**
 * A View with a custom cursor that reports trackpad gestures, Force Touch pressure and the back and forward mouse
 * buttons over it, including over its descendants. Events it has no handler for pass on to the views behind it.
 * macOS only; elsewhere rendering throws.
 */
export function PointerView(props: PointerViewProps) {
  const { customCursor, onMagnify, onRotate, onSwipe, onSmartMagnify, onPressure, onMouseButton, onError, ...view } = props;
  const handlers = { magnify: onMagnify, rotate: onRotate, swipe: onSwipe, smartMagnify: onSmartMagnify, pressure: onPressure, mouseButton: onMouseButton };
  for (const [type, handler] of Object.entries(handlers)) callback(handler, type);
  callback(onError, "error");
  const cursor = cursorProps(customCursor);
  if (customCursor !== undefined && StyleSheet.flatten(view.style)?.cursor !== undefined) throw new SparkError("E_INVALID_ARGUMENT", "Use customCursor or the cursor style, not both");
  requireAvailable(macosViewAvailability("SparkPointerView"), "PointerView");
  const report = (error: SparkError) => (onError ?? console.error)(error);
  function input(event: NativeSyntheticEvent<NativeInput>) {
    const parsed = parseInput(event?.nativeEvent);
    if (!parsed) { report(new SparkError("E_INVALID_DATA", "Invalid native pointer event")); return; }
    (handlers[parsed.type] as ((event: unknown) => void) | undefined)?.(parsed.event);
  }
  function failed(event: NativeSyntheticEvent<{ code: string; message: string }>) {
    const data = event?.nativeEvent;
    report(typeof data?.code === "string" && typeof data.message === "string" ? nativeError(Object.assign(new Error(data.message), { code: data.code })) : new SparkError("E_INVALID_DATA", "Invalid native pointer view error"));
  }
  const handledEvents = Object.entries(handlers).filter(([, handler]) => handler).map(([type]) => type);
  return <NativePointerView {...view} {...cursor} handledEvents={handledEvents} onPointerInput={input} onPointerViewError={failed} />;
}
