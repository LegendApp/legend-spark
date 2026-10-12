import type { ComponentRef } from "react";
import { findNodeHandle, Platform, UIManager, type HostComponent } from "react-native";
import { asyncRegistration, invokeNative, parseNativeResult, SparkError, type AsyncRegistration, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import NativeSparkMotion, { type Spec } from "./NativeSparkMotion";
import type { NativeProps } from "./SparkMotionViewNativeComponent";
import { channels, invalid, isMotionSpec, MOTION_PROPERTIES, spring, type MotionChannelProperty, type MotionProperty, type MotionSpec, type MotionValues } from "./specs";

// Imperative motion API. One call sends one validated JSON plan; the native engine solves,
// schedules and bakes it onto the compositor and resolves `finished` when it settles.

/** A mounted `MotionView`, as received through its `ref`. */
export type MotionTarget = ComponentRef<HostComponent<NativeProps>>;
export type MotionAnimationValues = Partial<Record<MotionProperty, number | MotionSpec>>;
export interface AnimateOptions { delayMs?: number }
export interface MotionAnimation {
  /** Resolves when every animated property settles, `{ finished: false }` if interrupted or unmounted. Rejects with a SparkError the engine raised. */
  readonly finished: Promise<{ finished: boolean }>;
  /** Freezes the animation's properties at their presented values. */
  stop(): Promise<void>;
}
export interface StaggerOptions { eachMs: number; from?: "first" | "last" | "center"; delayMs?: number }
export interface TimelineStep { target: MotionTarget | null; values: MotionAnimationValues; after?: "start" | "previous"; offsetMs?: number }
export interface MotionState {
  values: Record<MotionChannelProperty, number>;
  /** Units per second. */
  velocities: Record<MotionChannelProperty, number>;
  animating: MotionChannelProperty[];
}
export interface ScrollLinkOptions {
  /** The React Native ScrollView whose `nativeID` matches, in the target's window. */
  source: { nativeID: string };
  axis?: "x" | "y";
  /** Scroll offsets in points, strictly increasing. */
  input: readonly number[];
  /** One output per input stop, for each linked property. */
  output: Partial<Record<MotionProperty, readonly number[]>>;
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

const CHANNELS = MOTION_PROPERTIES.filter((property): property is MotionChannelProperty => property !== "scale");
type Group = { tag: number; after?: "start" | "previous"; offsetMs?: number; tracks: Record<string, MotionSpec> };
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
/** Validates animation values: numbers become default springs. */
export function tracks(values: MotionAnimationValues): Record<string, MotionSpec> {
  return Object.fromEntries(channels(values, "Animation values").map(([property, value]) => {
    if (typeof value === "number") return [property, spring(value)];
    if (!isMotionSpec(value)) invalid(`${property} takes a number or a spec from spring(), timing(), keyframes(), decay() or sequence()`);
    return [property, value];
  }));
}
function start(native: Spec, groups: Group[]): MotionAnimation {
  const id = `motion-${++nextId}`;
  const finished = invokeNative(() => native.run(JSON.stringify({ id, groups })))
    .then(json => parseNativeResult(json, (value): value is { finished: boolean } => !!value && typeof value === "object" && typeof (value as { finished?: unknown }).finished === "boolean"));
  return { finished, stop: () => invokeNative(() => native.stopAnimation(id)) };
}

/** Animates one MotionView. A bare number means `spring(value)` with the platform default preset. */
export function animate(target: MotionTarget | null, values: MotionAnimationValues, options: AnimateOptions = {}): MotionAnimation {
  return timeline([{ target, values, offsetMs: options.delayMs }]);
}

/** One timeline: each step starts relative to the timeline start, or after the previous step's natively solved end. */
export function timeline(steps: readonly TimelineStep[]): MotionAnimation {
  const native = motionModule();
  if (!Array.isArray(steps) || steps.length === 0) invalid("A timeline needs at least one step");
  const groups = steps.map(({ target, values, after, offsetMs }, index): Group => {
    if (after !== undefined && after !== "start" && after !== "previous") invalid("after is start or previous");
    if (after === "previous" && index === 0) invalid("The first timeline step has no previous step");
    return { tag: tagOf(target), after, offsetMs: offset(offsetMs, "offsetMs"), tracks: tracks(values) };
  });
  return start(native, groups);
}

/** The same animation on several MotionViews, `eachMs` apart, in one native plan. */
export function stagger(targets: readonly (MotionTarget | null)[], values: MotionAnimationValues, options: StaggerOptions): MotionAnimation {
  if (!Array.isArray(targets) || targets.length === 0) invalid("stagger needs at least one target");
  const eachMs = offset(options?.eachMs, "eachMs") ?? invalid("stagger needs eachMs");
  const delayMs = offset(options.delayMs, "delayMs") ?? 0;
  const from = options.from ?? "first";
  if (from !== "first" && from !== "last" && from !== "center") invalid("from is first, last or center");
  const last = targets.length - 1;
  const rank = (index: number) => from === "first" ? index : from === "last" ? last - index : Math.abs(index - last / 2);
  return timeline(targets.map((target, index) => ({ target, values, offsetMs: delayMs + rank(index) * eachMs })));
}

/** Sets values immediately, interrupting their animations (use while tracking a gesture). */
export function setMotionValues(target: MotionTarget | null, values: MotionValues): Promise<void> {
  return invokeNative(() => {
    const entries = channels(values, "Motion values").map(([property, value]) => [property, Number.isFinite(value) ? value : invalid(`${property} must be a finite number`)]);
    return motionModule().set(JSON.stringify({ tag: tagOf(target), values: Object.fromEntries(entries) }));
  });
}

/** Freezes the given properties (all by default) at their presented values. */
export function stopMotion(target: MotionTarget | null, properties: readonly MotionProperty[] = CHANNELS): Promise<void> {
  return invokeNative(() => {
    if (!Array.isArray(properties)) invalid("properties must be an array");
    const names = channels(Object.fromEntries(properties.map(property => [property, true])), "properties").map(([property]) => property);
    return motionModule().stop(JSON.stringify({ tag: tagOf(target), properties: [...new Set(names)] }));
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isValues = (value: unknown) => isRecord(value) && CHANNELS.every(property => typeof value[property] === "number");
/** The presented value and velocity of every property, evaluated analytically now. */
export function getMotionState(target: MotionTarget | null): Promise<MotionState> {
  return invokeNative(async () => parseNativeResult(await motionModule().getState(tagOf(target)), (value): value is MotionState =>
    isRecord(value) && isValues(value.values) && isValues(value.velocities) && Array.isArray(value.animating) && value.animating.every(item => CHANNELS.includes(item))));
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
    const outputs = channels(output, "output").map(([property, values]) => {
      if (!Array.isArray(values) || values.length !== input.length || !values.every(Number.isFinite)) invalid(`output.${property} needs one finite value per input stop`);
      return [property, values];
    });
    const id = `motion-link-${++nextId}`;
    await native.link(JSON.stringify({ id, tag: tagOf(target), nativeID: source.nativeID, axis, clamp: extrapolate === "clamp", input, output: Object.fromEntries(outputs) }));
    return asyncRegistration(() => {}, () => invokeNative(() => native.unlink(id)));
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
