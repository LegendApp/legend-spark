import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { COLOR_PROPERTIES, colorStops, parseColor, type ColorComponent, type MotionColor, type MotionColorProperty, type Oklch } from "./colors";

// Animation descriptions. Builders validate their arguments and return frozen, normalized
// specs: exactly the JSON the native engine receives. Native code validates the same rules
// again (packages/motion/cpp), so malformed transport input can never crash the engine.

/** Properties that take numbers (docs/motion.md#properties-and-units). */
export type MotionNumberProperty =
  | "opacity" | "translateX" | "translateY" | "scale" | "scaleX" | "scaleY" | "rotate" | "rotateX" | "rotateY" | "perspective"
  | "borderRadius" | "shadowOpacity" | "shadowRadius" | "shadowOffsetX" | "shadowOffsetY" | "blur"
  | "maskInsetTop" | "maskInsetBottom" | "maskInsetStart" | "maskInsetEnd" | "maskRadius"
  /** A MotionMaterial's material opacity and its tint's opacity, 0-1 (docs/motion.md#backdrop-materials). */
  | "materialIntensity" | "materialTintOpacity"
  /**
   * A MotionShape's morph between its paths (0 is the first; 1.5 halfway from the second to the third), the trimmed
   * ends of its stroke (0-1 of its length) and its stroke width in points (docs/motion.md#shapes).
   */
  | "morph" | "strokeStart" | "strokeEnd" | "strokeWidth"
  /** A MotionShader's effect: 0-1 progress, and the distortion's strength from -1 to 1 (docs/motion.md#shader-effects-and-particles). */
  | "rippleProgress" | "dissolveProgress" | "distortion" | "specularProgress";
export type { MotionColorProperty };
/** Any property the motion engine animates: a number property or a color property. */
export type MotionProperty = MotionNumberProperty | MotionColorProperty;
/** Properties as the engine stores them: `scale` drives `scaleX` and `scaleY`, a color its OKLCH components. */
export type MotionChannelProperty = Exclude<MotionNumberProperty, "scale"> | ColorComponent;
/** Values to set at once (`initial`, `setMotionValues`): numbers for number properties, colors for color properties. */
export type MotionValues = Partial<Record<MotionNumberProperty, number> & Record<MotionColorProperty, MotionColor>>;
/** What an animation of a property animates to: a number, or a color for a color property. */
export type MotionValue = number | MotionColor;
/** A cubic Bézier easing's control points, as in CSS `cubic-bezier()`; x1 and x2 must be within 0-1. */
export type CubicBezier = readonly [x1: number, y1: number, x2: number, y2: number];
/** A named easing curve or a cubic Bézier. `easeIn`, `easeOut` and `easeInOut` are CSS's curves; `standard` is (0.4, 0, 0.2, 1). */
export type Easing = "linear" | "easeIn" | "easeOut" | "easeInOut" | "standard" | CubicBezier;
/**
 * Named springs, as response and bounce: `default` 550 ms and 0.175, `smooth` 500 ms and 0, `snappy` 500 ms and 0.15,
 * `bouncy` 500 ms and 0.3, `interactive` 150 ms and 0.14 (SwiftUI's springs).
 */
export type SpringPreset = "default" | "smooth" | "snappy" | "bouncy" | "interactive";

/** Options every animation builder takes. `delayMs` is the start delay in milliseconds. Invalid values throw E_INVALID_ARGUMENT. */
export interface AnimationOptions {
  /** Start velocity in units per second. Overrides the velocity inherited from an interrupted animation (gesture hand-off). */
  velocity?: number;
  delayMs?: number;
  /** Extra plays after the first; `Infinity` repeats until interrupted. */
  repeat?: number;
  /** Alternate direction on every repeat. */
  reverse?: boolean;
  /** Settling thresholds; the defaults depend on the property (see docs/motion.md). */
  restDelta?: number;
  restSpeed?: number;
}
/** Exactly one parameterization: `preset`, `responseMs`/`bounce`, or `mass`/`stiffness`/`damping`. None means `preset: "default"`. */
export interface SpringOptions extends AnimationOptions {
  preset?: SpringPreset;
  responseMs?: number;
  /** -1 < bounce < 1: 0 is critically damped, positive overshoots, negative is overdamped. */
  bounce?: number;
  mass?: number;
  stiffness?: number;
  damping?: number;
}
/** Options for `timing`: `durationMs` (default 250) and `easing` (default `easeInOut`). */
export interface TimingOptions extends AnimationOptions { durationMs?: number; easing?: Easing }
/** Options for `keyframes`. `durationMs` is the whole animation's length in milliseconds; the easing defaults to `easeInOut`. */
export interface KeyframesOptions extends AnimationOptions {
  durationMs: number;
  /** Where each value is reached, strictly increasing in (0, 1] and ending at 1. Defaults to even spacing. */
  offsets?: readonly number[];
  /** One easing, or one per segment. */
  easing?: Easing | readonly Easing[];
}
/** Options for `decay`, which cannot repeat or reverse. `deceleration` defaults to 0.998; `clamp` bounds the value. */
export interface DecayOptions extends Omit<AnimationOptions, "repeat" | "reverse"> {
  /** Velocity retained per millisecond, 0 < deceleration < 1 (React Native's convention). */
  deceleration?: number;
  clamp?: readonly [min: number, max: number];
  /** The spring that settles on a crossed clamp bound. Defaults to `{ responseMs: 300, bounce: 0 }`. */
  clampSpring?: Omit<SpringOptions, keyof AnimationOptions>;
}
/** Options for `sequence`, applied to the whole chain. A sequence of colors takes no velocity. */
export type SequenceOptions = AnimationOptions;

type Common = { velocity?: number; delayMs?: number; repeat?: number | "infinite"; reverse?: boolean; restDelta?: number; restSpeed?: number };
type SpringParameters = { mass: number; stiffness: number; damping: number };
/** A spring from `spring()`, normalized to mass, stiffness and damping. An infinite `repeat` is `"infinite"`. */
export type SpringSpec<V extends MotionValue = number> = Readonly<Common & SpringParameters & { type: "spring"; to: V }>;
/** A timing from `timing()`, its easing resolved to a cubic Bézier. */
export type TimingSpec<V extends MotionValue = number> = Readonly<Common & { type: "timing"; to: V; durationMs: number; easing: CubicBezier }>;
/** Keyframes from `keyframes()`: the values, their offsets, and one easing for all segments or one per value. */
export type KeyframesSpec<V extends MotionValue = number> = Readonly<Common & { type: "keyframes"; durationMs: number; values: readonly V[]; offsets: readonly number[]; easings: readonly CubicBezier[] }>;
/** A decay from `decay()`. With `clamp`, `bounce` holds the clamp spring's mass, stiffness and damping. */
export type DecaySpec = Readonly<Omit<Common, "repeat" | "reverse"> & { type: "decay"; deceleration: number; clamp?: readonly [number, number]; bounce?: SpringParameters }>;
/** A sequence from `sequence()`. */
export type SequenceSpec<V extends MotionValue = number> = Readonly<Common & { type: "sequence"; steps: readonly MotionSpec<V>[] }>;
/** An animation of numbers, or of colors (`V` is MotionColor): colors cannot decay. */
export type MotionSpec<V extends MotionValue = number> = SpringSpec<V> | TimingSpec<V> | KeyframesSpec<V> | SequenceSpec<V> | (V extends number ? DecaySpec : never);

export const MOTION_PROPERTIES: readonly MotionProperty[] = [
  "opacity", "translateX", "translateY", "scale", "scaleX", "scaleY", "rotate", "rotateX", "rotateY", "perspective",
  "borderRadius", "backgroundColor", "shadowOpacity", "shadowRadius", "shadowOffsetX", "shadowOffsetY", "blur",
  "maskInsetTop", "maskInsetBottom", "maskInsetStart", "maskInsetEnd", "maskRadius", "materialIntensity", "materialTintOpacity",
  "morph", "strokeStart", "strokeEnd", "strokeWidth", "fillColor", "strokeColor",
  "rippleProgress", "dissolveProgress", "distortion", "specularProgress",
];
export const isColorProperty = (property: string): property is MotionColorProperty => (COLOR_PROPERTIES as readonly string[]).includes(property);
const EASINGS: Record<Exclude<Easing, CubicBezier>, CubicBezier> = {
  linear: [0, 0, 1, 1], easeIn: [0.42, 0, 1, 1], easeOut: [0, 0, 0.58, 1], easeInOut: [0.42, 0, 0.58, 1], standard: [0.4, 0, 0.2, 1],
};
/** macOS presets: SwiftUI's `.spring`, `.smooth`, `.snappy`, `.bouncy` and `.interactiveSpring`. */
const PRESETS: Record<SpringPreset, { responseMs: number; bounce: number }> = {
  default: { responseMs: 550, bounce: 0.175 }, smooth: { responseMs: 500, bounce: 0 }, snappy: { responseMs: 500, bounce: 0.15 },
  bouncy: { responseMs: 500, bounce: 0.3 }, interactive: { responseMs: 150, bounce: 0.14 },
};
const created = new WeakSet<object>();

export function invalid(message: string): never { throw new SparkError("E_INVALID_ARGUMENT", message); }
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
function number(value: unknown, name: string, test: (value: number) => boolean = () => true, rule = "a finite number"): number {
  if (!finite(value) || !test(value)) invalid(`${name} must be ${rule}`);
  return value;
}
function options<T extends object>(value: T | undefined, allowed: readonly string[], name: string): Partial<T> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${name} options must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown ${name} option: ${key}`);
  return value;
}
const COMMON = ["velocity", "delayMs", "repeat", "reverse", "restDelta", "restSpeed"] as const;
function common(value: AnimationOptions, repeatable = true): Common {
  const out: Common = {};
  if (value.velocity !== undefined) out.velocity = number(value.velocity, "velocity");
  if (value.delayMs !== undefined) out.delayMs = number(value.delayMs, "delayMs", v => v >= 0, "a non-negative finite number");
  if (value.restDelta !== undefined) out.restDelta = number(value.restDelta, "restDelta", v => v > 0, "a positive finite number");
  if (value.restSpeed !== undefined) out.restSpeed = number(value.restSpeed, "restSpeed", v => v > 0, "a positive finite number");
  if (value.repeat !== undefined) {
    if (value.repeat !== Infinity && !(Number.isInteger(value.repeat) && value.repeat >= 0)) invalid("repeat must be a non-negative integer or Infinity");
    if (value.repeat !== 0 && !repeatable) invalid("Decay depends on its start velocity, so it cannot repeat or reverse");
    out.repeat = value.repeat === Infinity ? "infinite" : value.repeat;
  }
  if (value.reverse !== undefined) {
    if (typeof value.reverse !== "boolean") invalid("reverse must be a boolean");
    if (value.reverse && !repeatable) invalid("Decay depends on its start velocity, so it cannot repeat or reverse");
    out.reverse = value.reverse;
  }
  return out;
}
function seal<T extends MotionSpec<MotionValue>>(spec: T): T {
  created.add(Object.freeze(spec));
  return spec;
}
export function isMotionSpec(value: unknown): value is MotionSpec<MotionValue> { return typeof value === "object" && value !== null && created.has(value); }

/** A target is a finite number or a color; a color animation takes no velocity or rest thresholds (each component has its own). */
function target<V extends MotionValue>(value: V, name: string, settings: AnimationOptions): V {
  if (typeof value === "string") {
    parseColor(value, name);
    const own = (["velocity", "restDelta", "restSpeed"] as const).find(key => settings[key] !== undefined);
    if (own) throw new SparkError("E_UNSUPPORTED_OPTION", `A color animation has no ${own}: each OKLCH component has its own`);
    return value;
  }
  return number(value, name) as V;
}
/** Whether a spec animates colors; every step and keyframe of one spec is of one kind. */
export function animatesColor(spec: MotionSpec<MotionValue>): boolean {
  if (spec.type === "spring" || spec.type === "timing") return typeof spec.to === "string";
  if (spec.type === "keyframes") return typeof spec.values[0] === "string";
  if (spec.type === "sequence") return animatesColor(spec.steps[0]!);
  return false;
}

export function easing(value: Easing): CubicBezier {
  if (typeof value === "string") return Object.hasOwn(EASINGS, value) ? EASINGS[value as keyof typeof EASINGS] : invalid(`Unknown easing ${value}`);
  if (!Array.isArray(value) || value.length !== 4 || !value.every(finite)) invalid("A cubic Bézier easing is four finite numbers");
  const [x1, y1, x2, y2] = value;
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) invalid("Cubic Bézier x coordinates must be between 0 and 1");
  return [x1, y1, x2, y2];
}

/** SwiftUI's perceptual spring: stiffness (2π / response)² · mass, damping ratio 1 − bounce (or 1 / (1 + bounce) below 0). */
function springParameters(value: Omit<SpringOptions, keyof AnimationOptions>): SpringParameters {
  const physical = value.mass !== undefined || value.stiffness !== undefined || value.damping !== undefined;
  const perceptual = value.responseMs !== undefined || value.bounce !== undefined;
  if ([physical, perceptual, value.preset !== undefined].filter(Boolean).length > 1) invalid("Use one spring parameterization: preset, responseMs/bounce, or mass/stiffness/damping");
  if (physical) {
    const positive = (name: "mass" | "stiffness" | "damping", fallback?: number) => number(value[name] ?? fallback, name, v => v > 0, "a positive finite number");
    return { mass: positive("mass", 1), stiffness: positive("stiffness"), damping: positive("damping") };
  }
  if (value.preset !== undefined && !Object.hasOwn(PRESETS, value.preset)) invalid(`Unknown spring preset ${value.preset}`);
  const { responseMs, bounce } = perceptual ? { responseMs: value.responseMs, bounce: value.bounce ?? 0 } : PRESETS[value.preset ?? "default"];
  const response = number(responseMs, "responseMs", v => v > 0, "a positive finite number") / 1000;
  number(bounce, "bounce", v => v > -1 && v < 1, "between -1 and 1 (exclusive)");
  const ratio = bounce >= 0 ? 1 - bounce : 1 / (1 + bounce);
  return { mass: 1, stiffness: (2 * Math.PI / response) ** 2, damping: 4 * Math.PI * ratio / response };
}
const SPRING = ["preset", "responseMs", "bounce", "mass", "stiffness", "damping"] as const;

/** A spring to a number, or to a color (in OKLCH). */
export function spring(to: number, springOptions?: SpringOptions): SpringSpec;
export function spring(to: MotionColor, springOptions?: SpringOptions): SpringSpec<MotionColor>;
export function spring(to: MotionValue, springOptions?: SpringOptions): SpringSpec<MotionValue> {
  const value = options(springOptions, [...COMMON, ...SPRING], "spring");
  return seal({ type: "spring", to: target(to, "A spring target", value), ...springParameters(value), ...common(value) });
}

/** An eased transition to a number, or to a color (in OKLCH). */
export function timing(to: number, timingOptions?: TimingOptions): TimingSpec;
export function timing(to: MotionColor, timingOptions?: TimingOptions): TimingSpec<MotionColor>;
export function timing(to: MotionValue, timingOptions?: TimingOptions): TimingSpec<MotionValue> {
  const value = options(timingOptions, [...COMMON, "durationMs", "easing"], "timing");
  const durationMs = number(value.durationMs ?? 250, "durationMs", v => v >= 0, "a non-negative finite number");
  return seal({ type: "timing", to: target(to, "A timing target", value), durationMs, easing: easing(value.easing ?? "easeInOut"), ...common(value) });
}

/** Passes through numbers, or colors (in OKLCH), at their offsets. */
export function keyframes(values: readonly number[], keyframeOptions: KeyframesOptions): KeyframesSpec;
export function keyframes(values: readonly MotionColor[], keyframeOptions: KeyframesOptions): KeyframesSpec<MotionColor>;
export function keyframes(values: readonly MotionValue[], keyframeOptions: KeyframesOptions): KeyframesSpec<MotionValue> {
  const value = options(keyframeOptions, [...COMMON, "durationMs", "offsets", "easing"], "keyframes");
  if (!Array.isArray(values) || values.length === 0) invalid("Keyframes need at least one value");
  if (values.some(item => typeof item !== typeof values[0])) invalid("Keyframe values are all numbers or all colors");
  values.forEach(item => target(item, "Keyframe values", value));
  const durationMs = number(value.durationMs, "durationMs", v => v >= 0, "a non-negative finite number");
  const offsets = value.offsets ?? values.map((_, index) => (index + 1) / values.length);
  if (!Array.isArray(offsets) || offsets.length !== values.length) invalid("Keyframes need one offset per value");
  offsets.forEach((offset, index) => number(offset, "Keyframe offsets", v => v > (index ? offsets[index - 1]! : 0) && v <= 1, "strictly increasing within (0, 1]"));
  if (offsets[offsets.length - 1] !== 1) invalid("The last keyframe offset must be 1");
  const given = value.easing ?? "easeInOut";
  const list = Array.isArray(given) && !finite(given[0]) ? given as readonly Easing[] : [given as Easing];
  if (list.length !== 1 && list.length !== values.length) invalid("Keyframes need one easing, or one easing per value");
  return seal({ type: "keyframes", durationMs, values: [...values], offsets: [...offsets], easings: list.map(easing), ...common(value) });
}

/**
 * Decelerates from the start velocity (`velocity`, or the one inherited from an interrupted animation), as after a fling; numbers only.
 * Throws E_INVALID_ARGUMENT for invalid options and E_UNSUPPORTED_OPTION for unknown ones.
 */
export function decay(decayOptions?: DecayOptions): DecaySpec {
  const value = options(decayOptions, ["velocity", "delayMs", "restDelta", "restSpeed", "deceleration", "clamp", "clampSpring"], "decay");
  const deceleration = number(value.deceleration ?? 0.998, "deceleration", v => v > 0 && v < 1, "between 0 and 1 (exclusive)");
  const spec: { -readonly [K in keyof DecaySpec]: DecaySpec[K] } = { type: "decay", deceleration, ...common(value, false) };
  if (value.clamp !== undefined) {
    const [min, max] = Array.isArray(value.clamp) && value.clamp.length === 2 ? value.clamp : invalid("clamp is [min, max]");
    if (!finite(min) || !finite(max) || min > max) invalid("clamp is [min, max] with finite min <= max");
    spec.clamp = [min, max];
    spec.bounce = springParameters(value.clampSpring === undefined ? { responseMs: 300, bounce: 0 } : options(value.clampSpring, SPRING, "clampSpring"));
  } else if (value.clampSpring !== undefined) invalid("clampSpring needs clamp");
  return seal(spec);
}

const hasDecay = (spec: MotionSpec<MotionValue>): boolean => spec.type === "decay" || (spec.type === "sequence" && spec.steps.some(hasDecay));
/** A per-property chain: each step starts from the previous step's end value and velocity. Steps are all numbers or all colors. */
export function sequence<V extends MotionValue = number>(steps: readonly MotionSpec<V>[], sequenceOptions?: SequenceOptions): SequenceSpec<V> {
  const value = options(sequenceOptions, COMMON, "sequence");
  if (!Array.isArray(steps) || steps.length === 0) invalid("A sequence needs at least one step");
  for (const step of steps) {
    if (!isMotionSpec(step)) invalid("Sequence steps are specs from spring(), timing(), keyframes(), decay() or sequence()");
    if (step.type !== "decay" && step.repeat === "infinite") invalid("A sequence step cannot repeat forever");
  }
  if (steps.some(step => animatesColor(step) !== animatesColor(steps[0]!))) invalid("Sequence steps are all numbers or all colors");
  if (animatesColor(steps[0]!) && value.velocity !== undefined) throw new SparkError("E_UNSUPPORTED_OPTION", "A color animation has no velocity: each OKLCH component has its own");
  return seal({ type: "sequence", steps: [...steps], ...common(value, !steps.some(hasDecay)) }) as SequenceSpec<V>;
}

/** Every color a spec passes through, in order. */
function stops(spec: MotionSpec<MotionValue>): MotionColor[] {
  if (spec.type === "spring" || spec.type === "timing") return [spec.to as MotionColor];
  if (spec.type === "keyframes") return spec.values as MotionColor[];
  return spec.type === "sequence" ? spec.steps.flatMap(stops) : [];
}
/** The spec with its colors replaced, in order, by one component's values. */
function component(spec: MotionSpec<MotionValue>, next: () => number): MotionSpec {
  if (spec.type === "spring" || spec.type === "timing") return { ...spec, to: next() } as MotionSpec;
  if (spec.type === "keyframes") return { ...spec, values: spec.values.map(next) };
  if (spec.type === "sequence") return { ...spec, steps: spec.steps.map(step => component(step, next)) };
  return spec;
}
/** A color animation of `property` as the engine runs it: one animation per OKLCH component, leaving out components that never show (colors.ts). */
export function colorTracks(spec: MotionSpec<MotionValue>, property: MotionColorProperty): [ColorComponent, MotionSpec][] {
  const parsed: Oklch[] = stops(spec).map(stop => parseColor(stop));
  return colorStops(parsed, property).map(([name, values]) => {
    let index = 0;
    return [name, component(spec, () => values[index++]!)];
  });
}

/**
 * How layout changes and shared elements animate: a spring (the default, `{ preset: "smooth" }`) or a timing curve.
 * Each property animates to the value it was heading for, so there is no target.
 */
export type MotionTransition =
  | ({ type?: "spring" } & Omit<SpringOptions, keyof AnimationOptions>)
  | ({ type: "timing" } & Omit<TimingOptions, keyof AnimationOptions>);

/** The transition's spec without a target, as the native hand-off receives it. */
export function transitionSpec(value: MotionTransition = { preset: "smooth" }): Omit<SpringSpec, "to"> | Omit<TimingSpec, "to"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("transition options must be an object");
  const { type = "spring", ...rest } = value;
  if (type !== "spring" && type !== "timing") invalid("transition type is spring or timing");
  const { to: _to, ...spec } = type === "spring"
    ? spring(0, options(rest as SpringOptions, SPRING, "spring transition"))
    : timing(0, options(rest as TimingOptions, ["durationMs", "easing"], "timing transition"));
  return spec;
}

/** Expands `scale` and validates property names, keeping caller order. Colors stay whole: callers expand them. */
export function channels<V extends Partial<Record<MotionProperty, unknown>>>(values: V, name: string): [Exclude<MotionProperty, "scale">, V[keyof V]][] {
  type T = V[keyof V];
  if (!values || typeof values !== "object" || Array.isArray(values)) invalid(`${name} must be an object of motion properties`);
  const entries = Object.entries(values) as [MotionProperty, T][];
  if (entries.length === 0) invalid(`${name} needs at least one property`);
  if ("scale" in values && ("scaleX" in values || "scaleY" in values)) invalid("scale cannot be combined with scaleX or scaleY");
  return entries.flatMap(([property, value]): [Exclude<MotionProperty, "scale">, T][] => {
    if (!MOTION_PROPERTIES.includes(property)) invalid(`Unknown motion property ${property}`);
    return property === "scale" ? [["scaleX", value], ["scaleY", value]] : [[property, value]];
  });
}
