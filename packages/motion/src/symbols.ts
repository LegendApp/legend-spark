import type { ComponentRef } from "react";
import { findNodeHandle, UIManager, type HostComponent } from "react-native";
import { invokeNative, parseNativeResult, SparkError, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { getMotionAvailability, motionModule, type ReducedMotion } from "./motion";
import type { NativeProps } from "./SparkMotionSymbolNativeComponent";

// SF Symbol effects (docs/motion.md#symbol-effects): AppKit's NSSymbolEffect on a MotionSymbol, gated by the macOS
// version that introduced each effect, with Reduce Motion alternates.

/** A mounted `MotionSymbol`, as received through its `ref`. */
export type MotionSymbolTarget = ComponentRef<HostComponent<NativeProps>>;
export type SymbolEffect = "bounce" | "pulse" | "wiggle" | "rotate" | "breathe" | "drawOn" | "drawOff";
/** How a `MotionSymbol` name change animates. */
export type SymbolReplaceTransition = "replace" | "downUp" | "upUp" | "offUp";
export type SymbolEffectDirection = "up" | "down" | "left" | "right" | "forward" | "backward" | "clockwise" | "counterClockwise";
export interface SymbolEffectOptions {
  /** Extra plays after the first; `Infinity` plays until removed. Drawing on or off plays once. */
  repeat?: number;
  /** Playback speed multiplier (1 is the system's). */
  speed?: number;
  /** Animate the symbol's layers one after another instead of as a whole. */
  byLayer?: boolean;
  /** bounce: up or down; rotate: clockwise or counterClockwise; wiggle: any direction (forward and backward follow the layout direction). */
  direction?: SymbolEffectDirection;
  /** While Reduce Motion is on: `fade` (default) pulses instead and fades drawing on or off, `instant` plays nothing, `play` plays as written. */
  reducedMotion?: ReducedMotion;
}
export interface SymbolEffectPlayback {
  /** What played: the effect, `pulse` or `fade` (the Reduce Motion `fade` alternate), or `none` (`instant`). */
  readonly played: SymbolEffect | "fade" | "none";
  /** Stops the effect (an effect repeating until removed); nothing to stop resolves at once. */
  remove(): Promise<void>;
}

/** The macOS version that introduced each effect. */
const SINCE: Record<SymbolEffect | "replace", number> = { bounce: 14, pulse: 14, replace: 14, wiggle: 15, rotate: 15, breathe: 15, drawOn: 26, drawOff: 26 };
const DIRECTIONS: Partial<Record<SymbolEffect, readonly SymbolEffectDirection[]>> = {
  bounce: ["up", "down"], rotate: ["clockwise", "counterClockwise"],
  wiggle: ["up", "down", "left", "right", "forward", "backward", "clockwise", "counterClockwise"],
};
const OPTIONS = ["repeat", "speed", "byLayer", "direction", "reducedMotion"];
const invalid = (message: string): never => { throw new SparkError("E_INVALID_ARGUMENT", message); };

/** Whether `effect` (or the `replace` transition of a name change) plays here: the app was built with an SDK that has it, macOS has it, and the native view is linked. */
export function getSymbolEffectAvailability(effect: SymbolEffect | "replace"): Availability {
  if (!Object.hasOwn(SINCE, effect)) invalid(`Unknown symbol effect ${effect}`);
  const motion = getMotionAvailability();
  if (!motion.available) return motion;
  if (!UIManager.hasViewManagerConfig("SparkMotionSymbol")) return { available: false, reason: "missing-module" };
  return motionModule().supportsSymbolEffect(effect) ? { available: true } : { available: false, reason: "host-restriction" };
}
/** Throws the typed reason `effect` is unavailable. */
export function requireSymbolEffect(effect: SymbolEffect | "replace") {
  const availability = getSymbolEffectAvailability(effect);
  if (availability.available) return;
  if (availability.reason === "host-restriction") throw new SparkError("E_UNAVAILABLE", `The ${effect} symbol effect needs macOS ${SINCE[effect]} or later, and an app built with that SDK`);
  throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", `Symbol effects are unavailable: ${availability.reason}`);
}

function tagOf(target: MotionSymbolTarget | null | undefined): number {
  if (!target || typeof target !== "object") throw new SparkError("E_INVALID_ARGUMENT", "The symbol target is a mounted MotionSymbol ref");
  const tag = findNodeHandle(target);
  if (typeof tag !== "number") throw new SparkError("E_NOT_FOUND", "The MotionSymbol is not mounted");
  return tag;
}

/** Plays an SF Symbol effect on a MotionSymbol, or its Reduce Motion alternate. Rejects E_UNAVAILABLE on a macOS without the effect. */
export function playSymbolEffect(target: MotionSymbolTarget | null, effect: SymbolEffect, options: SymbolEffectOptions = {}): Promise<SymbolEffectPlayback> {
  return invokeNative(async () => {
    requireSymbolEffect(effect);
    if (!options || typeof options !== "object") invalid("Symbol effect options must be an object");
    const unknown = Object.keys(options).find(key => !OPTIONS.includes(key));
    if (unknown) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown symbol effect option ${unknown}`);
    const { repeat = 0, speed = 1, byLayer = false, direction, reducedMotion } = options;
    if (repeat !== Infinity && !(Number.isInteger(repeat) && repeat >= 0)) invalid("repeat must be a non-negative integer or Infinity");
    if (repeat !== 0 && (effect === "drawOn" || effect === "drawOff")) throw new SparkError("E_UNSUPPORTED_OPTION", "Drawing a symbol on or off plays once; it cannot repeat");
    if (!(Number.isFinite(speed) && speed > 0)) invalid("speed must be a positive finite number");
    if (typeof byLayer !== "boolean") invalid("byLayer must be a boolean");
    if (direction !== undefined && !DIRECTIONS[effect]?.includes(direction)) invalid(`The ${effect} effect's direction is ${DIRECTIONS[effect]?.join(", ") ?? "not set"}`);
    if (reducedMotion !== undefined && !["fade", "instant", "play"].includes(reducedMotion)) invalid("reducedMotion is fade, instant or play");
    const native = motionModule(), tag = tagOf(target);
    const request = { tag, effect, repeat: repeat === Infinity ? "infinite" : repeat, speed, byLayer, ...(direction && { direction }), ...(reducedMotion && { reducedMotion }) };
    const { played } = parseNativeResult(await native.playSymbolEffect(JSON.stringify(request)), (value): value is Pick<SymbolEffectPlayback, "played"> =>
      !!value && typeof value === "object" && ["fade", "none", ...Object.keys(SINCE)].includes((value as { played?: string }).played!));
    const lasting = played !== "fade" && played !== "none" && played !== "drawOn" && played !== "drawOff";
    let removal: Promise<void> | undefined;
    return { played, remove: () => removal ??= lasting ? invokeNative(() => native.removeSymbolEffect(JSON.stringify({ tag, effect: played }))) : Promise.resolve() };
  });
}

/** Stops every symbol effect of a MotionSymbol. */
export function stopSymbolEffects(target: MotionSymbolTarget | null): Promise<void> {
  return invokeNative(() => motionModule().removeSymbolEffect(JSON.stringify({ tag: tagOf(target) })));
}
