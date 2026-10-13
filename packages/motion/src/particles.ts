import { invokeNative, parseNativeResult, SparkError, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { parseColor, type MotionColor } from "./colors";
import { getMotionAvailability, motionModule, tagOf, type MotionTarget, type ReducedMotion } from "./motion";
import { bounded, only, point, type MotionPoint } from "./shaders";
import { invalid } from "./specs";

// Particles (docs/motion.md#shader-effects-and-particles): a MotionEmitter's CAEmitterLayer, which the window server
// simulates and draws. JavaScript starts and stops it; nothing runs per particle in the app.

/** A built-in white shape (tinted by `color`), or an SF Symbol this macOS has. */
export type ParticleImage = "circle" | "square" | "star" | "spark" | { symbol: string };
/** One kind of particle. Angles are degrees on screen (0 points right, 90 down); spin is clockwise. */
export interface ParticleCell {
  /** Default `circle`, 16 points across at scale 1. */
  image?: ParticleImage;
  /** Default white. */
  color?: MotionColor;
  /** Particles per second while emitting, 0-500. */
  birthRate: number;
  /** How long each particle lives, 1-10000 ms, give or take `lifetimeRangeMs`. */
  lifetimeMs: number;
  lifetimeRangeMs?: number;
  /** Points per second, give or take `velocityRange`. */
  velocity?: number;
  velocityRange?: number;
  /** The direction particles leave in (default 0), and how wide a spread around it (default 360: every direction). */
  emissionAngle?: number;
  emissionRange?: number;
  /** Degrees per second, give or take `spinRange`. */
  spin?: number;
  spinRange?: number;
  /** Size multiplier (default 1), give or take `scaleRange`, changing by `scaleSpeed` per second. */
  scale?: number;
  scaleRange?: number;
  scaleSpeed?: number;
  /** Opacity change per second (negative fades particles out). */
  alphaSpeed?: number;
  /** Points per second squared; `{ x: 0, y: 200 }` is gravity. */
  acceleration?: MotionPoint;
}
export interface ParticleEmitter {
  /** Where particles are born: a point, along a line, or inside a rectangle or circle (default `point`). */
  shape?: "point" | "line" | "rectangle" | "circle";
  /** The emitter's centre, in points from the view's top-left corner. Default: the view's centre. */
  position?: MotionPoint;
  /** The line's length (`width`), or the rectangle's or circle's size. Default: the view's size. */
  size?: { width: number; height: number };
  /** `additive` makes overlapping particles brighter, for sparks and glows (default `normal`). */
  blend?: "normal" | "additive";
  /** The random seed, so a run's particles are the same every time (default 1). */
  seed?: number;
  /** One to eight kinds of particle. */
  cells: readonly ParticleCell[];
}
export interface ParticleOptions {
  /** Emit for this long, on the view's layer clock, then stop. Default: until stopParticles. */
  durationMs?: number;
  /** While Reduce Motion is on, particles (which travel) are not emitted unless this is `play` (default `fade`: nothing). */
  reducedMotion?: ReducedMotion;
}
export interface ParticlePlayback {
  /** `particles`, or `none` when Reduce Motion kept them from playing. */
  readonly played: "particles" | "none";
}

/** The most particles an emitter may keep alive at once (each cell's birth rate times its longest lifetime). */
export const PARTICLE_BUDGET = 1000;
const SHAPES = ["point", "line", "rectangle", "circle"];
const IMAGES = ["circle", "square", "star", "spark"];
const CELL_KEYS = ["image", "color", "birthRate", "lifetimeMs", "lifetimeRangeMs", "velocity", "velocityRange", "emissionAngle", "emissionRange", "spin", "spinRange", "scale", "scaleRange", "scaleSpeed", "alphaSpeed", "acceleration"];
const LIMIT = 100000;

/** Particles show wherever motion does: Core Animation's emitter needs nothing else. */
export function getParticleAvailability(): Availability { return getMotionAvailability(); }

function cell(value: ParticleCell, index: number) {
  const name = `cells[${index}]`;
  if (!value || typeof value !== "object") invalid(`${name} must be an object`);
  only(value, CELL_KEYS, name);
  const { image = "circle", color } = value;
  if (typeof image === "string" ? !IMAGES.includes(image) : !(image && typeof image === "object" && typeof image.symbol === "string" && image.symbol && Object.keys(image).length === 1))
    invalid(`${name}.image is ${IMAGES.join(", ")} or { symbol }`);
  if (typeof image === "object" && !motionModule().hasSymbol(image.symbol)) throw new SparkError("E_NOT_FOUND", `This macOS has no SF Symbol named ${image.symbol}`);
  const birthRate = bounded(value.birthRate, `${name}.birthRate`, 0, 500), lifetimeMs = bounded(value.lifetimeMs, `${name}.lifetimeMs`, 1, 10000);
  if (birthRate === undefined || lifetimeMs === undefined) invalid(`${name} needs birthRate and lifetimeMs`);
  const range = (key: keyof ParticleCell, min = -LIMIT) => bounded(value[key], `${name}.${key}`, min, LIMIT);
  return {
    image, color: color === undefined ? undefined : parseColor(color, `${name}.color`), birthRate, lifetimeMs,
    lifetimeRangeMs: bounded(value.lifetimeRangeMs, `${name}.lifetimeRangeMs`, 0, 10000), velocity: range("velocity"), velocityRange: range("velocityRange", 0),
    emissionAngle: bounded(value.emissionAngle, `${name}.emissionAngle`, -360, 360), emissionRange: bounded(value.emissionRange, `${name}.emissionRange`, 0, 360),
    spin: range("spin"), spinRange: range("spinRange", 0), scale: bounded(value.scale, `${name}.scale`, 0, 100), scaleRange: bounded(value.scaleRange, `${name}.scaleRange`, 0, 100),
    scaleSpeed: range("scaleSpeed"), alphaSpeed: range("alphaSpeed"), acceleration: point(value.acceleration, `${name}.acceleration`),
  };
}

/** Validates an emitter into the JSON the native view takes; more live particles than PARTICLE_BUDGET is E_INVALID_ARGUMENT. */
export function emitterJson(emitter: ParticleEmitter): string {
  if (!emitter || typeof emitter !== "object") invalid("emitter must be an object");
  only(emitter, ["shape", "position", "size", "blend", "seed", "cells"], "The emitter");
  const { shape, blend, seed, size, cells } = emitter;
  if (shape !== undefined && !SHAPES.includes(shape)) invalid(`shape is ${SHAPES.join(", ")}`);
  if (blend !== undefined && blend !== "normal" && blend !== "additive") invalid("blend is normal or additive");
  if (seed !== undefined && !(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff)) invalid("seed is an integer from 0 to 4294967295");
  if (size !== undefined && !(size && typeof size === "object" && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width >= 0 && size.height >= 0 && Object.keys(size).length === 2))
    invalid("size is { width, height } in points");
  if (!Array.isArray(cells) || cells.length < 1 || cells.length > 8) invalid("cells has one to eight particle kinds");
  const parsed = cells.map(cell);
  const alive = parsed.reduce((total, { birthRate, lifetimeMs, lifetimeRangeMs = 0 }) => total + birthRate * (lifetimeMs + lifetimeRangeMs) / 1000, 0);
  if (alive > PARTICLE_BUDGET) invalid(`The emitter would keep about ${Math.round(alive)} particles alive; at most ${PARTICLE_BUDGET} (lower birthRate or lifetimeMs)`);
  return JSON.stringify({ shape, position: point(emitter.position, "position"), size, blend, seed, cells: parsed });
}

const PLAYED = ["particles", "none"];
/** Starts a MotionEmitter's particles, or nothing under Reduce Motion (see `reducedMotion`). Particles alive when it stops finish their lifetime. */
export function startParticles(target: MotionTarget | null, options: ParticleOptions = {}): Promise<ParticlePlayback> {
  return invokeNative(async () => {
    if (!options || typeof options !== "object") invalid("Particle options must be an object");
    const unknown = Object.keys(options).find(key => key !== "durationMs" && key !== "reducedMotion");
    if (unknown) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown particle option ${unknown}`);
    const { durationMs, reducedMotion } = options;
    if (durationMs !== undefined && !(Number.isFinite(durationMs) && durationMs > 0)) invalid("durationMs must be a positive finite number");
    if (reducedMotion !== undefined && !["fade", "instant", "play"].includes(reducedMotion)) invalid("reducedMotion is fade, instant or play");
    const json = await motionModule().startParticles(JSON.stringify({ tag: tagOf(target), durationMs, reducedMotion }));
    const { played } = parseNativeResult(json, (value): value is ParticlePlayback => !!value && typeof value === "object" && PLAYED.includes((value as { played?: string }).played!));
    return { played };
  });
}

/** Stops a MotionEmitter's particles; the ones alive finish their lifetime. */
export function stopParticles(target: MotionTarget | null): Promise<void> {
  return invokeNative(() => motionModule().stopParticles(JSON.stringify({ tag: tagOf(target) })));
}
