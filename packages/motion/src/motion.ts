import type { ComponentRef } from "react";
import { findNodeHandle, Platform, UIManager, type HostComponent } from "react-native";
import { asyncRegistration, invokeNative, parseNativeResult, SparkError, type AsyncRegistration, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import NativeSparkMotion, { type Spec } from "./NativeSparkMotion";
import type { NativeProps } from "./SparkMotionViewNativeComponent";
import { COLOR_COMPONENTS, colorStops, colorValues, formatColor, parseColor, type MotionColor } from "./colors";
import {
  animatesColor, channels, colorTracks, invalid, isMotionSpec, MOTION_PROPERTIES, spring,
  type MotionChannelProperty, type MotionColorProperty, type MotionNumberProperty, type MotionProperty, type MotionSpec, type MotionValues,
} from "./specs";

// Imperative motion API. One call sends one validated JSON plan; the native engine solves,
// schedules and bakes it onto the compositor and resolves `finished` when it settles.

/** A mounted `MotionView`, as received through its `ref`. */
export type MotionTarget = ComponentRef<HostComponent<NativeProps>>;
/** A number or spec per number property; a color or color spec for `backgroundColor`. A bare value means a default spring to it. */
export type MotionAnimationValues = Partial<Record<MotionNumberProperty, number | MotionSpec> & Record<MotionColorProperty, MotionColor | MotionSpec<MotionColor>>>;
/**
 * What a step without its own `reducedValues` plays while the user has Reduce Motion on (docs/motion.md#reduce-motion):
 * `fade` (default) changes transforms at once and fades opacity (a view that only moves fades in where it lands),
 * `instant` changes every value at once, `play` plays the animation as written (motion the user asked for, such as a drag).
 */
export type ReducedMotion = "fade" | "instant" | "play";
/** macOS haptic patterns (NSHapticFeedbackPattern). */
export type MotionHaptic = "generic" | "alignment" | "levelChange";
/** A haptic and/or a system sound, played on the display frame that shows `at` (docs/motion.md#cues). */
export interface MotionCue {
  /** Milliseconds after the animation starts (at most its end), or `end`. Under Reduce Motion the time scales with the alternate. */
  at: number | "end";
  haptic?: MotionHaptic;
  /** A system sound name, such as `Tink` (NSSound soundNamed:). */
  sound?: string;
}
/** Options of one animation plan: `animate`, `stagger` and `timeline`. */
export interface MotionPlanOptions {
  reducedMotion?: ReducedMotion;
  /** While the view's window is hidden or fully occluded: `complete` (default) jumps finite animations to their end; `pause` holds them. Infinite repeats always pause. */
  whenHidden?: "complete" | "pause";
  cues?: readonly MotionCue[];
}
export interface AnimateOptions extends MotionPlanOptions {
  delayMs?: number;
  /** The designed Reduce Motion alternate, played instead of `values` while Reduce Motion is on. */
  reducedValues?: MotionAnimationValues;
}
export interface MotionAnimation {
  /** Resolves when every animated property settles, `{ finished: false }` if interrupted or unmounted. Rejects with a SparkError the engine raised. */
  readonly finished: Promise<{ finished: boolean }>;
  /** Freezes the animation's properties at their presented values. */
  stop(): Promise<void>;
}
export interface StaggerOptions extends MotionPlanOptions { eachMs: number; from?: "first" | "last" | "center"; delayMs?: number; reducedValues?: MotionAnimationValues }
export interface TimelineStep { target: MotionTarget | null; values: MotionAnimationValues; after?: "start" | "previous"; offsetMs?: number; reducedValues?: MotionAnimationValues }
/** What motion follows of the system and of a view's window. */
export interface MotionEnvironment {
  /** The user's Reduce Motion setting; animations started while it is on play their alternate. */
  reduceMotion: boolean;
  /** The user's Reduce Transparency setting; AppKit then draws backdrop materials opaque (docs/motion.md#backdrop-materials). */
  reduceTransparency: boolean;
  lowPowerMode: boolean;
  /** The refresh rate of the display showing the view's window (the main display without a view); null without a display. */
  maximumFrameRate: number | null;
  /** The rate motion samples and asks the compositor for: the display's, at most 120 Hz, at most 60 Hz in Low Power Mode. */
  frameRate: number;
  /** Whether the view's window is visible (not hidden, minimized or fully occluded); null without a view. */
  windowVisible: boolean | null;
}
export interface MotionState {
  values: Record<MotionChannelProperty, number>;
  /** Units per second. */
  velocities: Record<MotionChannelProperty, number>;
  animating: MotionChannelProperty[];
  /** Color properties as they show now, as CSS `oklch(L C H / A)`. */
  colors: Record<MotionColorProperty, MotionColor>;
}
export interface ScrollLinkOptions {
  /** The React Native ScrollView whose `nativeID` matches, in the target's window. */
  source: { nativeID: string };
  axis?: "x" | "y";
  /** Scroll offsets in points, strictly increasing. */
  input: readonly number[];
  /** One output per input stop, for each linked property: numbers, or colors for `backgroundColor` (interpolated in OKLCH). */
  output: Partial<Record<MotionNumberProperty, readonly number[]> & Record<MotionColorProperty, readonly MotionColor[]>>;
  /** Beyond the first and last stop: hold the end values (`clamp`, default) or continue the end segments (`extend`). */
  extrapolate?: "clamp" | "extend";
}
export interface MotionFrameReport {
  frames: number;
  /** Frames while an animation was due to move. */
  animatedFrames: number;
  /** Missed display-link intervals. */
  droppedFrames: number;
  /** Animated frames whose presented value did not change from the previous frame. */
  stalledFrames: number;
  maxFrameGapMs: number;
  refreshRate: number;
  durationMs: number;
}

const CHANNELS: readonly MotionChannelProperty[] = [...MOTION_PROPERTIES.filter((property): property is Exclude<MotionNumberProperty, "scale"> => property !== "scale" && property !== "backgroundColor"), ...COLOR_COMPONENTS];
type Group = { tag: number; after?: "start" | "previous"; offsetMs?: number; tracks: Record<string, MotionSpec>; reducedTracks?: Record<string, MotionSpec> };
const HAPTICS: readonly MotionHaptic[] = ["generic", "alignment", "levelChange"];
const PLAN_OPTIONS = ["reducedMotion", "whenHidden", "cues"] as const;
let nextId = 0;

export function getMotionAvailability(): Availability {
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  return NativeSparkMotion && UIManager.hasViewManagerConfig("SparkMotionView") ? { available: true } : { available: false, reason: "missing-module" };
}

/** The native module, or the typed reason motion is unavailable. Nothing animates without it. */
export function motionModule(): Spec {
  const availability = getMotionAvailability();
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", `Motion is unavailable: ${availability.reason}`);
  return NativeSparkMotion!;
}

function tagOf(target: MotionTarget | null | undefined): number {
  if (!target || typeof target !== "object") invalid("The motion target is a mounted MotionView ref");
  const tag = findNodeHandle(target);
  if (typeof tag !== "number") throw new SparkError("E_NOT_FOUND", "The MotionView is not mounted");
  return tag;
}
function offset(value: number | undefined, name: string) {
  if (value !== undefined && !(Number.isFinite(value) && value >= 0)) invalid(`${name} must be a non-negative finite number`);
  return value;
}
/** Validates animation values: bare values become default springs; colors become one animation per OKLCH component. */
export function tracks(values: MotionAnimationValues): Record<string, MotionSpec> {
  return Object.fromEntries(channels(values, "Animation values").flatMap(([property, value]): [string, MotionSpec][] => {
    const color = property === "backgroundColor";
    const spec = typeof value === "number" || typeof value === "string" ? spring(value as never) : value;
    if (!isMotionSpec(spec)) invalid(`${property} takes a ${color ? "color" : "number"} or a spec from spring(), timing(), keyframes(), ${color ? "" : "decay() "}or sequence()`);
    if (animatesColor(spec) !== color) invalid(color ? `${property} animates to colors` : `${property} animates to numbers, not colors`);
    return color ? colorTracks(spec) : [[property, spec as MotionSpec]];
  }));
}
/** Values to set at once: numbers, and every OKLCH component of a color. */
export function motionValues(values: MotionValues, name: string): Record<string, number> {
  return Object.fromEntries(channels(values, name).flatMap(([property, value]): [string, number][] => {
    if (property === "backgroundColor") return Object.entries(colorValues(value, `${name}.${property}`));
    return [[property, Number.isFinite(value) ? value as number : invalid(`${name}.${property} must be a finite number`)]];
  }));
}
function known(value: object, allowed: readonly string[], name: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${name} must be an object`);
  const unknown = Object.keys(value).find(key => !allowed.includes(key));
  if (unknown) invalid(`${name} has no option ${unknown}`);
}
function cue(value: MotionCue): MotionCue {
  known(value, ["at", "haptic", "sound"], "A cue");
  const { at, haptic, sound } = value;
  if (at !== "end" && !(Number.isFinite(at) && at >= 0)) invalid("A cue's at is end or a non-negative finite number of milliseconds");
  if (haptic !== undefined && !HAPTICS.includes(haptic)) invalid("haptic is generic, alignment or levelChange");
  if (sound !== undefined && (typeof sound !== "string" || !sound)) invalid("sound is a non-empty system sound name");
  if (haptic === undefined && sound === undefined) invalid("A cue needs a haptic or a sound");
  return { at, ...(haptic === undefined ? {} : { haptic }), ...(sound === undefined ? {} : { sound }) };
}
/** The plan's options as the engine reads them; omitted ones keep its defaults. */
function plan({ reducedMotion, whenHidden, cues }: MotionPlanOptions) {
  if (reducedMotion !== undefined && reducedMotion !== "fade" && reducedMotion !== "instant" && reducedMotion !== "play") invalid("reducedMotion is fade, instant or play");
  if (whenHidden !== undefined && whenHidden !== "complete" && whenHidden !== "pause") invalid("whenHidden is complete or pause");
  if (cues !== undefined && !Array.isArray(cues)) invalid("cues must be an array");
  return { ...(reducedMotion && { reducedMotion }), ...(whenHidden && { whenHidden }), ...(cues?.length ? { cues: cues.map(cue) } : {}) };
}
function start(native: Spec, groups: Group[], options: MotionPlanOptions): MotionAnimation {
  const id = `motion-${++nextId}`;
  const request = JSON.stringify({ id, groups, ...plan(options) });
  const finished = invokeNative(() => native.run(request))
    .then(json => parseNativeResult(json, (value): value is { finished: boolean } => !!value && typeof value === "object" && typeof (value as { finished?: unknown }).finished === "boolean"));
  return { finished, stop: () => invokeNative(() => native.stopAnimation(id)) };
}

/** Animates one MotionView. A bare number means `spring(value)` with the platform default preset. */
export function animate(target: MotionTarget | null, values: MotionAnimationValues, options: AnimateOptions = {}): MotionAnimation {
  known(options, ["delayMs", "reducedValues", ...PLAN_OPTIONS], "animate options");
  const { delayMs, reducedValues, ...rest } = options;
  return timeline([{ target, values, offsetMs: delayMs, reducedValues }], rest);
}

/** One timeline: each step starts relative to the timeline start, or after the previous step's natively solved end. */
export function timeline(steps: readonly TimelineStep[], options: MotionPlanOptions = {}): MotionAnimation {
  const native = motionModule();
  known(options, PLAN_OPTIONS, "timeline options");
  if (!Array.isArray(steps) || steps.length === 0) invalid("A timeline needs at least one step");
  const groups = steps.map(({ target, values, after, offsetMs, reducedValues }, index): Group => {
    if (after !== undefined && after !== "start" && after !== "previous") invalid("after is start or previous");
    if (after === "previous" && index === 0) invalid("The first timeline step has no previous step");
    return { tag: tagOf(target), after, offsetMs: offset(offsetMs, "offsetMs"), tracks: tracks(values), ...(reducedValues === undefined ? {} : { reducedTracks: tracks(reducedValues) }) };
  });
  return start(native, groups, options);
}

/** The same animation on several MotionViews, `eachMs` apart, in one native plan. */
export function stagger(targets: readonly (MotionTarget | null)[], values: MotionAnimationValues, options: StaggerOptions): MotionAnimation {
  if (!Array.isArray(targets) || targets.length === 0) invalid("stagger needs at least one target");
  known(options, ["eachMs", "from", "delayMs", "reducedValues", ...PLAN_OPTIONS], "stagger options");
  const { eachMs: each, from = "first", delayMs: delay, reducedValues, ...rest } = options;
  const eachMs = offset(each, "eachMs") ?? invalid("stagger needs eachMs");
  const delayMs = offset(delay, "delayMs") ?? 0;
  if (from !== "first" && from !== "last" && from !== "center") invalid("from is first, last or center");
  const last = targets.length - 1;
  const rank = (index: number) => from === "first" ? index : from === "last" ? last - index : Math.abs(index - last / 2);
  return timeline(targets.map((target, index) => ({ target, values, reducedValues, offsetMs: delayMs + rank(index) * eachMs })), rest);
}

/** Sets values immediately, interrupting their animations (use while tracking a gesture). */
export function setMotionValues(target: MotionTarget | null, values: MotionValues): Promise<void> {
  return invokeNative(() => {
    return motionModule().set(JSON.stringify({ tag: tagOf(target), values: motionValues(values, "Motion values") }));
  });
}

/** Freezes the given properties (all by default) at their presented values. */
export function stopMotion(target: MotionTarget | null, properties: readonly MotionProperty[] = MOTION_PROPERTIES.filter(property => property !== "scale")): Promise<void> {
  return invokeNative(() => {
    if (!Array.isArray(properties)) invalid("properties must be an array");
    const names = channels(Object.fromEntries(properties.map(property => [property, true])), "properties")
      .flatMap(([property]): readonly MotionChannelProperty[] => property === "backgroundColor" ? COLOR_COMPONENTS : [property]);
    return motionModule().stop(JSON.stringify({ tag: tagOf(target), properties: [...new Set(names)] }));
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isValues = (value: unknown) => isRecord(value) && CHANNELS.every(property => typeof value[property] === "number");
/** The presented value and velocity of every property, evaluated analytically now. */
export function getMotionState(target: MotionTarget | null): Promise<MotionState> {
  return invokeNative(async () => {
    const state = parseNativeResult(await motionModule().getState(tagOf(target)), (value): value is Omit<MotionState, "colors"> =>
      isRecord(value) && isValues(value.values) && isValues(value.velocities) && Array.isArray(value.animating) && value.animating.every(item => CHANNELS.includes(item)));
    return { ...state, colors: { backgroundColor: formatColor(COLOR_COMPONENTS.map(component => state.values[component])) } };
  });
}

/** Drives properties from a scroll offset on the native main thread; no JavaScript runs per scroll event. Linked properties reject animate/set with E_BUSY until removed. */
export function linkScroll(target: MotionTarget | null, options: ScrollLinkOptions): Promise<AsyncRegistration> {
  return invokeNative(async () => {
    const native = motionModule();
    const { source, axis = "y", input, output, extrapolate = "clamp" } = options ?? invalid("linkScroll needs options");
    if (!source || typeof source.nativeID !== "string" || !source.nativeID) invalid("source.nativeID must be a non-empty string");
    if (axis !== "x" && axis !== "y") invalid("axis is x or y");
    if (extrapolate !== "clamp" && extrapolate !== "extend") invalid("extrapolate is clamp or extend");
    if (!Array.isArray(input) || input.length < 2 || !input.every(Number.isFinite) || input.some((stop, index) => index > 0 && stop <= input[index - 1]!)) invalid("input needs at least two strictly increasing finite stops");
    const outputs = channels(output, "output").flatMap(([property, values]): [string, readonly number[]][] => {
      if (!Array.isArray(values) || values.length !== input.length) invalid(`output.${property} needs one value per input stop`);
      if (property !== "backgroundColor") return values.every(Number.isFinite) ? [[property, values as number[]]] : invalid(`output.${property} needs finite numbers`);
      const components = colorStops(values.map(value => parseColor(value, `output.${property}`)));
      return COLOR_COMPONENTS.flatMap(name => components[name] ? [[name, components[name]]] : []);
    });
    const id = `motion-link-${++nextId}`;
    await native.link(JSON.stringify({ id, tag: tagOf(target), nativeID: source.nativeID, axis, clamp: extrapolate === "clamp", input, output: Object.fromEntries(outputs) }));
    return asyncRegistration(() => {}, () => invokeNative(() => native.unlink(id)));
  });
}

/**
 * Reduce Motion, Reduce Transparency, Low Power Mode, the frame rate motion runs at, and whether the target's window is visible. Without a
 * target it reads the main display. Read it when it matters: animations read the system themselves when they start.
 */
export function getMotionEnvironment(target?: MotionTarget | null): Promise<MotionEnvironment> {
  return invokeNative(async () => {
    const native = motionModule();
    const json = await native.environment(target === undefined ? 0 : tagOf(target));
    return parseNativeResult(json, (value): value is MotionEnvironment => isRecord(value) && typeof value.reduceMotion === "boolean" && typeof value.reduceTransparency === "boolean" && typeof value.lowPowerMode === "boolean"
      && (value.maximumFrameRate === null || typeof value.maximumFrameRate === "number") && typeof value.frameRate === "number"
      && (value.windowVisible === null || typeof value.windowVisible === "boolean"));
  });
}

/** Samples the target's presentation layer on its display link for `durationMs` (real clock only). */
export function recordMotionFrames(target: MotionTarget | null, options: { durationMs: number }): Promise<MotionFrameReport> {
  return invokeNative(async () => {
    const durationMs = options?.durationMs;
    if (!(Number.isFinite(durationMs) && durationMs > 0 && durationMs <= 10000)) invalid("durationMs must be greater than 0 and at most 10000");
    const json = await motionModule().recordFrames(JSON.stringify({ tag: tagOf(target), durationMs }));
    const keys = ["frames", "animatedFrames", "droppedFrames", "stalledFrames", "maxFrameGapMs", "refreshRate", "durationMs"] as const;
    return parseNativeResult(json, (value): value is MotionFrameReport => isRecord(value) && keys.every(key => typeof value[key] === "number"));
  });
}
