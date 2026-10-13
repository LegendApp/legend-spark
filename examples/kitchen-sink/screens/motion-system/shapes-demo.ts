import { animate, getMotionState, spring, timing, type MotionTarget } from "@legendapp/spark/motion";

// Demo operations for Motion system > Shapes, through the public @legendapp/spark/motion boundary. Each returns the
// JSON-ready result its readout shows: the animation's outcome and the values it settled at.

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * A circle, a star and a square in a 120-point box, each starting at the top centre and drawn clockwise, so their
 * points correspond. They have 4, 10 and 5 segments: the engine subdivides the circle and the square to 10.
 */
export const SHAPES = [
  "M60 12 C86.51 12 108 33.49 108 60 C108 86.51 86.51 108 60 108 C33.49 108 12 86.51 12 60 C12 33.49 33.49 12 60 12 Z",
  "M60 12 L72.3 45 L107.6 46.5 L80 68.5 L89.4 102.5 L60 83 L30.6 102.5 L40 68.5 L12.4 46.5 L47.7 45 Z",
  "M60 12 H108 V108 H12 V12 Z",
] as const;
/** Each shape's fill: the fill animates in OKLCH with the morph. */
export const FILLS = ["#2563eb", "#f59e0b", "#16a34a"] as const;
/** A checkmark in a 72-point box, drawn by animating strokeEnd. */
export const CHECK = "M16 38 L30 52 L58 22";
/** A ring in a 72-point box from 12 o'clock, clockwise: strokeEnd is the progress. */
export const RING = "M36 8 C51.46 8 64 20.54 64 36 C64 51.46 51.46 64 36 64 C20.54 64 8 51.46 8 36 C8 20.54 20.54 8 36 8";
export const PROGRESS = [0.25, 0.5, 0.75, 1] as const;

async function settled<K extends "morph" | "strokeEnd">(target: MotionTarget | null, finished: Promise<{ finished: boolean }>, key: K) {
  const outcome = await finished;
  const { values, colors } = await getMotionState(target);
  return { ...outcome, [key]: round(values[key]), ...(key === "morph" ? { fillColor: colors.fillColor } : {}) };
}

/** Springs to shape `index`, and its fill to that shape's color (in OKLCH, without overshoot). */
export const morphTo = (target: MotionTarget | null, index: number) =>
  settled(target, animate(target, { morph: spring(index, { preset: "snappy" }), fillColor: spring(FILLS[index]!, { preset: "smooth" }) }).finished, "morph");

/** Draws the checkmark on (or off) along its length: ease-in-out, so halfway through it is half drawn. */
export const drawCheck = (target: MotionTarget | null, on: boolean) =>
  settled(target, animate(target, { strokeEnd: timing(on ? 1 : 0, { durationMs: 600 }) }).finished, "strokeEnd");

export const setProgress = (target: MotionTarget | null, progress: number) =>
  settled(target, animate(target, { strokeEnd: spring(progress, { preset: "smooth" }) }).finished, "strokeEnd");

/** What the shapes show now, mid-animation or at rest. */
export async function presented(shape: MotionTarget | null, check: MotionTarget | null) {
  const [morph, stroke] = await Promise.all([getMotionState(shape), getMotionState(check)]);
  return { morph: round(morph.values.morph), strokeEnd: round(stroke.values.strokeEnd) };
}
