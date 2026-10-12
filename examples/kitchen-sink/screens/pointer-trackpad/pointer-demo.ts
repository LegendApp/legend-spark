import { useReducer, useState } from "react";
import { SparkError } from "@legendapp/spark/contracts";
import {
  getPointerAvailability, hideCursorUntilMoved, performHapticFeedback,
  type HapticPattern, type MagnifyEvent, type MouseButtonEvent, type PointerViewProps, type PressureEvent, type RotateEvent, type SwipeEvent,
} from "@legendapp/spark/pointer";

/** Availability readouts, keyed by the testID suffix that shows them. */
export function pointerAvailability() {
  return {
    pointer: getPointerAvailability(), "custom-cursors": getPointerAvailability("customCursors"), "hide-cursor": getPointerAvailability("hideCursorUntilMoved"),
    gestures: getPointerAvailability("gestures"), pressure: getPointerAvailability("pressure"), "mouse-buttons": getPointerAvailability("mouseButtons"), haptics: getPointerAvailability("haptics"),
  };
}
/** React Native `cursor` style values shown as swatches; the driver reports AppKit's cursor for each. */
export const STYLE_CURSORS = ["pointer", "text", "crosshair", "grab", "not-allowed"] as const;
export const HAPTIC_PATTERNS: readonly HapticPattern[] = ["generic", "alignment", "levelChange"];
export const CUSTOM_CURSOR = { type: "symbol", name: "pencil.tip", pointSize: 20 } as const;

/** What the canvas has received: its scale and rotation follow the gestures. */
export type CanvasState = { scale: number; rotation: number; swipe: string | null; smartZooms: number; stage: number; forceClicks: number; button: string | null };
const INITIAL: CanvasState = { scale: 1, rotation: 0, swipe: null, smartZooms: 0, stage: 0, forceClicks: 0, button: null };
type Input =
  | { type: "magnify"; event: MagnifyEvent } | { type: "rotate"; event: RotateEvent } | { type: "swipe"; event: SwipeEvent } | { type: "smartMagnify" }
  | { type: "pressure"; event: PressureEvent } | { type: "mouseButton"; event: MouseButtonEvent } | { type: "reset" };
function reduce(state: CanvasState, input: Input): CanvasState {
  switch (input.type) {
    // AppKit adds magnification to the current scale.
    case "magnify": return { ...state, scale: Math.min(4, Math.max(0.25, state.scale + input.event.magnification)) };
    case "rotate": return { ...state, rotation: state.rotation + input.event.rotation };
    case "swipe": return { ...state, swipe: input.event.direction };
    case "smartMagnify": return { ...state, smartZooms: state.smartZooms + 1, scale: state.scale === 1 ? 2 : 1 };
    case "pressure": return { ...state, stage: input.event.stage, forceClicks: state.forceClicks + (input.event.stage === 2 && state.stage < 2 ? 1 : 0) };
    case "mouseButton": return { ...state, button: input.event.button };
    case "reset": return INITIAL;
  }
}

const describe = (value: unknown) => value instanceof SparkError ? `SparkError:${value.code}` : value instanceof Error ? `Error: ${value.message}` : String(value);

/** The Pointer screen's state: what the canvas received, and the results of the commands, as text for flows. */
export function usePointerDemo() {
  const [canvas, dispatch] = useReducer(reduce, INITIAL);
  const [results, setResults] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  async function run(id: string, operation: () => Promise<void>) {
    try { await operation(); setResults(previous => ({ ...previous, [id]: "resolved" })); }
    catch (cause) { setResults(previous => ({ ...previous, [id]: describe(cause) })); }
  }
  const handlers: PointerViewProps = {
    onMagnify: event => dispatch({ type: "magnify", event }),
    onRotate: event => dispatch({ type: "rotate", event }),
    onSwipe: event => dispatch({ type: "swipe", event }),
    onSmartMagnify: () => dispatch({ type: "smartMagnify" }),
    onPressure: event => dispatch({ type: "pressure", event }),
    onMouseButton: event => dispatch({ type: "mouseButton", event }),
    onError: cause => setError(describe(cause)),
  };
  return {
    canvas, results, error, handlers,
    reset: () => dispatch({ type: "reset" }),
    hide: () => run("hide", hideCursorUntilMoved),
    haptic: (pattern: HapticPattern) => run(`haptic-${pattern}`, () => performHapticFeedback(pattern, { performanceTime: "now" })),
    /** An unknown pattern, to show the typed error. */
    invalidHaptic: () => run("haptic-invalid", () => performHapticFeedback("buzz" as HapticPattern)),
  };
}
