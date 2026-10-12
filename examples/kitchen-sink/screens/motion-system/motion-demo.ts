import { useEffect, useState, type RefObject } from "react";
import { useI18n } from "../../shell/app-controller";
import { SparkError } from "@legendapp/spark/contracts";
import {
  animate, decay, getMotionState, keyframes, linkScroll, recordMotionFrames, sequence, setMotionValues, spring, stagger, stopMotion, timeline, timing,
  type MotionAnimation, type MotionTarget, type SpringPreset,
} from "@legendapp/spark/motion";
import type { AsyncRegistration } from "@legendapp/spark/contracts";

// Demo operations for the motion screens, all through the public @legendapp/spark/motion
// boundary. Each returns the JSON-ready result its readout shows, so flows can assert it.
export const PRESETS: readonly SpringPreset[] = ["default", "smooth", "snappy", "bouncy", "interactive"];
export const TRACK = 240;
/** Boxes start at the track's leading edge and move with the reading direction: -1 in right-to-left locales. */
export type Way = 1 | -1;
export const SCROLL_SOURCE = "motion-system-scroll-source";
export type Targets = readonly (MotionTarget | null)[];

const round = (value: number) => Math.round(value * 10) / 10;
export const describeError = (error: unknown) => error instanceof SparkError ? `SparkError:${error.code}` : `Unexpected error: ${String(error)}`;
const settled = (animation: MotionAnimation) => animation.finished;

/** The physical parameters a preset resolves to on this platform. */
export function presetParameters(preset: SpringPreset) {
  const { mass, stiffness, damping } = spring(0, { preset });
  return { mass, stiffness: round(stiffness), damping: round(damping) };
}
/** Moves every preset box to the other end of the track; resolves with each box's outcome. */
export function playPresets(targets: Targets, forward: boolean, way: Way) {
  return Promise.all(targets.map((target, index) => settled(animate(target, { translateX: spring(forward ? way * TRACK : 0, { preset: PRESETS[index] }) }))));
}

export const startSlide = (target: MotionTarget | null, way: Way) => settled(animate(target, { translateX: timing(way * TRACK, { durationMs: 4000, easing: "linear" }) }));
async function snapshot(target: MotionTarget | null) {
  const { values, velocities } = await getMotionState(target);
  return { value: round(values.translateX), velocity: round(velocities.translateX) };
}
/** Velocity continuity: the spring that replaces the slide starts from the slide's value and velocity. */
export async function interrupt(target: MotionTarget | null) {
  const before = await snapshot(target);
  const replacement = animate(target, { translateX: spring(0, { preset: "bouncy" }) });
  const after = await snapshot(target);
  return { before, after, ...(await replacement.finished) };
}
/** Gesture hand-off: a release velocity (points per second) seeds the spring. */
export const release = (target: MotionTarget | null, way: Way) => settled(animate(target, { translateX: spring(way * TRACK / 2, { preset: "snappy", velocity: way * 2400 }) }));

/** Freezes the slider where it is; the state shows nothing animating and zero velocity. */
export async function stop(target: MotionTarget | null) {
  await stopMotion(target, ["translateX"]);
  return { ...(await snapshot(target)), animating: (await getMotionState(target)).animating };
}
/** Puts the slider back at the start immediately, as a drag would. */
export async function reset(target: MotionTarget | null) {
  await setMotionValues(target, { translateX: 0 });
  return snapshot(target);
}

export const playKeyframes = (target: MotionTarget | null, way: Way) =>
  settled(animate(target, { translateX: keyframes([TRACK, TRACK / 3, TRACK * 0.66, 0].map(x => way * x), { durationMs: 1200, offsets: [0.3, 0.55, 0.8, 1], easing: "easeOut" }), rotate: keyframes([20, -20, 0], { durationMs: 1200 }) }));
export const playSequence = (target: MotionTarget | null, way: Way) =>
  settled(animate(target, { translateX: sequence([timing(way * TRACK, { durationMs: 400 }), spring(way * TRACK / 2, { preset: "bouncy" })], { repeat: 1, reverse: true }), scale: sequence([timing(1.25, { durationMs: 200 }), spring(1)]) }));
export const playStagger = (targets: Targets) =>
  settled(stagger(targets, { translateY: sequence([timing(-24, { durationMs: 160, easing: "easeOut" }), spring(0, { preset: "bouncy" })]) }, { eachMs: 70, from: "center" }));
/** The second view starts when the first one's natively solved spring settles. */
export const playTimeline = (first: MotionTarget | null, second: MotionTarget | null, forward: boolean, way: Way) => settled(timeline([
  { target: first, values: { translateX: spring(forward ? way * TRACK : 0, { preset: "snappy" }), opacity: timing(forward ? 0.4 : 1) } },
  { target: second, values: { translateX: spring(forward ? way * TRACK : 0, { preset: "snappy" }) }, after: "previous" },
]));
export const playDecay = (target: MotionTarget | null, velocity: number, way: Way) =>
  settled(animate(target, { translateX: decay({ velocity: way * velocity, clamp: way > 0 ? [0, TRACK] : [-TRACK, 0] }) }));

export const link = (target: MotionTarget | null) => linkScroll(target, {
  source: { nativeID: SCROLL_SOURCE }, input: [0, 200, 400], output: { opacity: [1, 0.5, 0.2], scale: [1, 0.8, 0.6], rotate: [0, 90, 180] },
});

/** The runner loops from mount until unmount; it is the target of the JavaScript-block report. */
export function useLoop(target: RefObject<MotionTarget | null>, way: Way) {
  const [text, setText] = useState("");
  useEffect(() => {
    let active = true, loop: MotionAnimation | undefined;
    const report = (value: string) => { if (active) setText(value); };
    Promise.resolve().then(() => {
      loop = animate(target.current, { translateX: timing(way * TRACK, { durationMs: 1500, repeat: Infinity, reverse: true }) });
      report(JSON.stringify("running"));
      return loop.finished;
    }).then(result => report(JSON.stringify(result)), error => report(describeError(error)));
    return () => { active = false; void loop?.stop(); };
  }, [target, way]);
  return text;
}

/** Blocks the JavaScript thread for 500 ms while recording 1.5 s of the running loop's frames. */
export async function blockJs(target: MotionTarget | null) {
  const frames = recordMotionFrames(target, { durationMs: 1500 });
  const started = Date.now();
  while (Date.now() - started < 500) { /* deliberately busy: no JavaScript runs */ }
  const blockedMs = Date.now() - started;
  const { frames: count, animatedFrames, droppedFrames, stalledFrames, maxFrameGapMs, refreshRate, durationMs } = await frames;
  return { blockedMs, frames: count, animatedFrames, droppedFrames, stalledFrames, maxFrameGapMs: round(maxFrameGapMs), refreshRate, durationMs: round(durationMs) };
}

/** The badge's linked values, as the engine presents them. */
export async function badgeState(target: MotionTarget | null) {
  const { values } = await getMotionState(target);
  return { opacity: round(values.opacity), scale: round(values.scaleX), rotate: round(values.rotate) };
}

export function useWay(): Way { return useI18n().rtl ? -1 : 1; }

/** One readout per action: the JSON result or a typed error. */
export function useReadout() {
  const [text, setText] = useState("");
  return {
    text,
    run(operation: () => Promise<unknown>) {
      setText("…");
      Promise.resolve().then(operation).then(result => setText(JSON.stringify(result ?? null)), error => setText(describeError(error)));
    },
  };
}

/** The current scroll link, if any; linking twice replaces nothing and reports E_BUSY from the engine. */
export function useScrollLink() {
  const [registration, setRegistration] = useState<AsyncRegistration>();
  const readout = useReadout();
  return {
    text: readout.text,
    link: (target: MotionTarget | null) => readout.run(async () => { setRegistration(await link(target)); return "linked"; }),
    unlink: () => readout.run(async () => { await registration?.remove(); setRegistration(undefined); return registration ? "unlinked" : "not linked"; }),
  };
}
