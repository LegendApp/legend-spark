import { useCallback, useState, type RefObject } from "react";
import { animate, getMotionEnvironment, keyframes, sequence, setMotionValues, spring, timing, type MotionEnvironment, type MotionTarget, type ReducedMotion } from "@legendapp/spark/motion";
import { onSystemEvent } from "@legendapp/spark/system";
import { useRegistrations } from "../../shell/registrations";
import { describeError, TRACK, type Way } from "./motion-demo";

// Demo operations for Motion system > Accessibility, power and lifecycle, through the public
// @legendapp/spark/motion boundary. Each returns the JSON-ready result its readout shows.

/** Slides the card to the other end. Under Reduce Motion it plays the plan's alternate: `fade` (default) or `instant`. */
export const slide = (target: MotionTarget | null, forward: boolean, way: Way, reducedMotion?: ReducedMotion) =>
  animate(target, { translateX: spring(forward ? way * TRACK : 0, { preset: "snappy" }) }, reducedMotion ? { reducedMotion } : {}).finished;

/** Error feedback: a shake, whose designed Reduce Motion alternate is a dim pulse in place. */
export const shake = (target: MotionTarget | null, way: Way) => animate(target, { translateX: keyframes([-12, 12, -8, 8, 0].map(x => way * x), { durationMs: 400 }) }, {
  reducedValues: { opacity: sequence([timing(0.4, { durationMs: 100 }), timing(1, { durationMs: 200 })]) },
}).finished;

/** A spinner that repeats forever (it pauses while the window is hidden) and an 8 s slide (it completes when hidden). */
export async function startHidden(spinner: MotionTarget | null, slider: MotionTarget | null, way: Way) {
  await Promise.all([setMotionValues(spinner, { rotate: 0 }), setMotionValues(slider, { translateX: 0 })]);
  animate(spinner, { rotate: timing(360, { durationMs: 1200, easing: "linear", repeat: Infinity }) });
  return animate(slider, { translateX: timing(way * TRACK, { durationMs: 8000, easing: "linear" }) }, { whenHidden: "complete" }).finished;
}

/** A spring with an alignment haptic on its first frame and a level-change haptic and the Tink sound on the frame it settles. */
export const playCues = (target: MotionTarget | null, forward: boolean, way: Way) => animate(target, { translateX: spring(forward ? way * TRACK : 0, { preset: "bouncy" }) }, {
  cues: [{ at: 0, haptic: "alignment" }, { at: "end", haptic: "levelChange", sound: "Tink" }],
}).finished;

export const startLong = (target: MotionTarget | null, way: Way) => animate(target, { translateX: timing(way * TRACK, { durationMs: 10000, easing: "linear" }) }).finished;

const ENVIRONMENT: readonly (keyof MotionEnvironment)[] = ["reduceMotion", "lowPowerMode", "maximumFrameRate", "frameRate", "windowVisible"];
/**
 * The motion environment of `target`'s window, or of the main display without a target (`keys` of it): `refresh` reads
 * it, and Reduce Motion and Low Power Mode changes re-read it.
 */
export function useMotionEnvironment(target: RefObject<MotionTarget | null> | undefined, keys: readonly (keyof MotionEnvironment)[] = ENVIRONMENT) {
  const [text, setText] = useState("");
  const report = useCallback((error: unknown) => setText(describeError(error)), []);
  const refresh = useCallback(() => { getMotionEnvironment(target ? target.current : undefined).then(environment =>
    setText(JSON.stringify(Object.fromEntries(keys.map(key => [key, environment[key]])))), report); }, [target, keys, report]);
  useRegistrations(hold => { hold(onSystemEvent(refresh, { types: ["accessibilityDisplayChanged", "lowPowerChanged"] })); }, report, [refresh, report]);
  return { text, refresh };
}
