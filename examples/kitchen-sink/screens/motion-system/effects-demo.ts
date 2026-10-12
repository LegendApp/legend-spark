import { animate, getMotionState, motionPath, setMotionValues, spring, timing, type MotionTarget } from "@legendapp/spark/motion";
import type { Way } from "./motion-demo";

// Demo operations for Motion system > Visual effects, through the public @legendapp/spark/motion boundary. Each
// returns the JSON-ready result its readout shows: the animation's outcome and the values it settled at.

export const BLUE = "#2563eb", YELLOW = "#facc15";
export const REVEAL_WIDTH = 200, REVEAL_HEIGHT = 56;
const round = (value: number) => Math.round(value * 100) / 100;

export async function settledValues<K extends string>(target: MotionTarget | null, finished: Promise<{ finished: boolean }>, keys: readonly K[]) {
  const outcome = await finished;
  const { values } = await getMotionState(target);
  return { ...outcome, ...Object.fromEntries(keys.map(key => [key, round(values[key as keyof typeof values])])) as Record<K, number> };
}

/** Blue to yellow (or back) in OKLCH: the midpoint stays saturated. Reports the color it settled at. */
export async function playColor(target: MotionTarget | null, toYellow: boolean) {
  const outcome = await animate(target, { backgroundColor: timing(toYellow ? YELLOW : BLUE, { durationMs: 1200 }) }).finished;
  return { ...outcome, color: (await getMotionState(target)).colors.backgroundColor };
}

/** The color the swatch shows now, mid-animation or at rest. */
export const presentedColor = async (target: MotionTarget | null) => ({ color: (await getMotionState(target)).colors.backgroundColor });

/** Lifts the card: rounder corners, a deeper shadow and a slight scale, all springs on the compositor. */
export const lift = (target: MotionTarget | null, up: boolean) => settledValues(target, animate(target, {
  borderRadius: spring(up ? 20 : 4), shadowOpacity: spring(up ? 0.4 : 0), shadowRadius: spring(up ? 14 : 0), shadowOffsetY: spring(up ? 8 : 0), scale: spring(up ? 1.05 : 1),
}).finished, ["borderRadius", "shadowOpacity", "shadowRadius", "shadowOffsetY", "scaleX"]);

export const blur = (target: MotionTarget | null, on: boolean) => settledValues(target, animate(target, { blur: timing(on ? 6 : 0, { durationMs: 400 }) }).finished, ["blur"]);

/** Turns the card about its vertical axis, seen in perspective. */
export const flip = (target: MotionTarget | null, over: boolean) => settledValues(target, animate(target, { rotateY: spring(over ? 180 : 0, { preset: "smooth" }) }).finished, ["rotateY", "perspective"]);
export const tilt = (target: MotionTarget | null, tilted: boolean) => settledValues(target, animate(target, { rotateX: spring(tilted ? 35 : 0, { preset: "snappy" }) }).finished, ["rotateX"]);

/** Wipes the content in from its leading edge (the trailing inset shrinks), or out again. */
export const wipe = (target: MotionTarget | null, shown: boolean) =>
  settledValues(target, animate(target, { maskInsetEnd: timing(shown ? 0 : REVEAL_WIDTH, { durationMs: 600 }) }).finished, ["maskInsetEnd"]);

/** Opens a circle from the centre until it uncovers the whole card. */
export async function iris(target: MotionTarget | null) {
  const side = 16, x = (REVEAL_WIDTH - side) / 2, y = (REVEAL_HEIGHT - side) / 2;
  await setMotionValues(target, { maskInsetTop: y, maskInsetBottom: y, maskInsetStart: x, maskInsetEnd: x, maskRadius: side / 2 });
  const open = timing(0, { durationMs: 700, easing: "easeOut" });
  return settledValues(target, animate(target, { maskInsetTop: open, maskInsetBottom: open, maskInsetStart: open, maskInsetEnd: open, maskRadius: timing(12, { durationMs: 700 }) }).finished,
    ["maskInsetTop", "maskInsetStart", "maskRadius"]);
}

/** An S-curve in the reading direction, from where the arrow rests to 160 points along. */
export const PATH_LENGTH = 160;
const curve = (way: Way) => `M0 0 C${40 * way} -36 ${120 * way} 36 ${PATH_LENGTH * way} 0`;
/** Moves the arrow along the curve, turning it to the path's heading, or back to where it rests. */
export const travel = (target: MotionTarget | null, there: boolean, way: Way) => settledValues(target, animate(target, there
  ? motionPath(curve(way), { durationMs: 900, rotate: true })
  : { translateX: spring(0, { preset: "smooth" }), translateY: spring(0, { preset: "smooth" }), rotate: spring(way === 1 ? 0 : 180, { preset: "smooth" }) }).finished,
["translateX", "translateY", "rotate"]);
