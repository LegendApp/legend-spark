import { SparkError, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { parseColor, type MotionColor } from "./colors";
import { getMotionAvailability, motionModule } from "./motion";
import { invalid, type MotionNumberProperty } from "./specs";

// Shader effects (docs/motion.md#shader-effects-and-particles): Spark's built-in effects on a MotionShader's layer, each
// driven by one engine property. There is no user-supplied shader source.

/** The built-in shader effects a MotionShader shows; `getShaderEffectAvailability` says whether one works here. */
export type ShaderEffect = "ripple" | "dissolve" | "distortion" | "specular";
/** Points from the view's top-left corner, as a press event's `locationX` and `locationY`. */
export interface MotionPoint { x: number; y: number }
/** A ring that travels out from `origin` as `rippleProgress` goes from 0 to 1, bending what is under it. */
export interface RippleEffect {
  type: "ripple";
  /** Where the ring starts. Default: the view's centre. */
  origin?: MotionPoint;
  /** The ring's width in points, 1-400 (default 24). */
  width?: number;
  /** The ring's refraction index at its strongest, 1-3 (default 1.7; 1 bends nothing). */
  refraction?: number;
}
/** The view breaks up along a noise pattern as `dissolveProgress` goes from 0 (shown) to 1 (gone). */
export interface DissolveEffect {
  type: "dissolve";
  /** The noise's cell size in points, 2-200 (default 12). */
  cellSize?: number;
  /** How soft the dissolving edge is, 0.01-1 (default 0.1). */
  softness?: number;
}
/** A bulge (`distortion` above 0) or pinch (below 0) of the content around `center`; `distortion` is -1 to 1. */
export interface DistortionEffect {
  type: "distortion";
  /** Default: the view's centre. */
  center?: MotionPoint;
  /** The distorted circle's radius in points (default: half the view's shorter side). */
  radius?: number;
}
/** A band of light that sweeps across the view as `specularProgress` goes from 0 to 1, like light over glass. */
export interface SpecularEffect {
  type: "specular";
  /** The sweep's direction in degrees: 0 runs from the left edge to the right one, 90 from the top down (default 20). */
  angle?: number;
  /** The band's half-width as a share of the sweep, 0.01-1 (default 0.25). */
  width?: number;
  /** The band's opacity at its centre, 0-1 (default 0.6). */
  intensity?: number;
  /** Default white. */
  color?: MotionColor;
}
/** A MotionShader's `effect` with its settings, by `type`. Each is driven by one motion property (`SHADER_PROPERTIES`). */
export type MotionShaderEffect = RippleEffect | DissolveEffect | DistortionEffect | SpecularEffect;

/** The engine property each effect is driven by. */
export const SHADER_PROPERTIES: Readonly<Record<ShaderEffect, MotionNumberProperty>> = {
  ripple: "rippleProgress", dissolve: "dissolveProgress", distortion: "distortion", specular: "specularProgress",
};
const EFFECTS = Object.keys(SHADER_PROPERTIES) as ShaderEffect[];

/** Whether `effect` shows here: motion is available, and for `dissolve` this Mac has a Metal device. */
export function getShaderEffectAvailability(effect: ShaderEffect): Availability {
  if (!EFFECTS.includes(effect)) invalid(`Unknown shader effect ${effect}`);
  const motion = getMotionAvailability();
  if (!motion.available) return motion;
  return motionModule().supportsShaderEffect(effect) ? { available: true } : { available: false, reason: "host-restriction" };
}

/** Throws the typed reason `effect` is unavailable. */
export function requireShaderEffect(effect: ShaderEffect) {
  const availability = getShaderEffectAvailability(effect);
  if (availability.available) return;
  if (availability.reason === "host-restriction") throw new SparkError("E_UNAVAILABLE", `The ${effect} effect needs a Metal device, and this Mac has none`);
  throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", `Shader effects are unavailable: ${availability.reason}`);
}

/** A finite number in [min, max] (or above min when `open`), or the default. */
export function bounded(value: unknown, name: string, min: number, max: number, open = false): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (open && value === min)) invalid(`${name} is a number from ${min} to ${max}${open ? ", above " + min : ""}`);
  return value as number;
}
export function point(value: unknown, name: string): MotionPoint | undefined {
  if (value === undefined) return undefined;
  const { x, y } = (value ?? {}) as Partial<MotionPoint>;
  if (!value || typeof value !== "object" || Object.keys(value).some(key => key !== "x" && key !== "y") || !Number.isFinite(x) || !Number.isFinite(y)) invalid(`${name} is { x, y } in points`);
  return { x: x!, y: y! };
}
export function only(value: object, keys: readonly string[], name: string) {
  const unknown = Object.keys(value).find(key => !keys.includes(key));
  if (unknown) invalid(`${name} has no option ${unknown}`);
}

/** Validates an effect (and that it is available here) into the JSON the native view takes. */
export function shaderEffectJson(effect: MotionShaderEffect): string {
  if (!effect || typeof effect !== "object" || !EFFECTS.includes(effect.type)) invalid(`effect.type is ${EFFECTS.join(", ")}`);
  requireShaderEffect(effect.type);
  const name = `The ${effect.type} effect`;
  switch (effect.type) {
    case "ripple":
      only(effect, ["type", "origin", "width", "refraction"], name);
      return JSON.stringify({ type: "ripple", origin: point(effect.origin, "origin"), width: bounded(effect.width, "width", 1, 400), refraction: bounded(effect.refraction, "refraction", 1, 3) });
    case "dissolve":
      only(effect, ["type", "cellSize", "softness"], name);
      return JSON.stringify({ type: "dissolve", cellSize: bounded(effect.cellSize, "cellSize", 2, 200), softness: bounded(effect.softness, "softness", 0.01, 1) });
    case "distortion":
      only(effect, ["type", "center", "radius"], name);
      return JSON.stringify({ type: "distortion", center: point(effect.center, "center"), radius: bounded(effect.radius, "radius", 0, 10000, true) });
    case "specular":
      only(effect, ["type", "angle", "width", "intensity", "color"], name);
      return JSON.stringify({ type: "specular", angle: bounded(effect.angle, "angle", -360, 360), width: bounded(effect.width, "width", 0.01, 1), intensity: bounded(effect.intensity, "intensity", 0, 1),
        color: effect.color === undefined ? undefined : parseColor(effect.color, "color") });
  }
}
