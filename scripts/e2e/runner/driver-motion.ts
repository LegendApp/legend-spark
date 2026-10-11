// Motion and frame commands of the driver backend (docs/e2e-flows.md#motion-and-frames): captureMotion, assertMotion,
// interruptAt and assertFrames, on the motion telemetry and frame counters of the in-app driver
// (docs/motion.md#motion-telemetry, docs/test-driver.md#frame-timing). A metric the app cannot measure fails typed;
// nothing is estimated on the runner side.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { DriverError, type FrameReport, type Motion, type MotionInterruption, type MotionProperty, type MotionSamples, type MotionState, type MotionUntil } from "../driver.ts";
import type { FlowCommand } from "../format/parser.ts";
import { Failure, type CommandContext, type CommandHandler, type FailureKind } from "./backend.ts";
import { ms } from "./executor.ts";
import { describe } from "./selectors.ts";

/** What these commands use of a driver session (`Driver` in scripts/e2e/driver.ts). */
export type MotionClient = {
  motionState(testID: string): Promise<MotionState>;
  waitForMotion(testID: string, until: MotionUntil, timeoutMs?: number): Promise<MotionState>;
  sampleMotion(testID: string, range?: { fromMs?: number; toMs?: number; intervalMs?: number }): Promise<MotionSamples>;
  startFrames(): Promise<{ refreshRate: number }>;
  stopFrames(): Promise<FrameReport>;
};

/** The engine's rest thresholds (docs/motion.md#springs): what counts as the same value and velocity across an interruption. */
const REST: Record<MotionProperty, { delta: number; speed: number }> = {
  opacity: { delta: 0.0005, speed: 0.005 }, scaleX: { delta: 0.0005, speed: 0.005 }, scaleY: { delta: 0.0005, speed: 0.005 },
  translateX: { delta: 0.01, speed: 0.1 }, translateY: { delta: 0.01, speed: 0.1 }, rotate: { delta: 0.01, speed: 0.1 },
};
const TRANSLATION: MotionProperty[] = ["translateX", "translateY"];
const KINDS = { spring: ["spring"], timing: ["timing", "keyframes"] } as const;
const DRIVER_FAILURES: Record<string, FailureKind> = {
  E_TIMEOUT: "timeout", E_NOT_FOUND: "not-found", E_PASSED: "assertion", E_INVALID_ARGUMENT: "invalid",
  E_UNSUPPORTED_OPTION: "unsupported", E_UNKNOWN_COMMAND: "unsupported", E_UNAVAILABLE: "unsupported",
};
const FILE_NAME = /^[A-Za-z0-9_-]{1,100}$/;

/** Driver failures as typed flow failures: `E_UNKNOWN_COMMAND` means the app does not link the motion module. */
async function driven<T>(what: string, call: () => Promise<T>): Promise<T> {
  try { return await call(); } catch (error) {
    if (error instanceof DriverError) throw new Failure(DRIVER_FAILURES[error.code] ?? "error", `${what}: ${error.message}`);
    throw error;
  }
}
const round = (value: number) => Math.round(value * 100) / 100;
const pixels = (value: unknown) => typeof value === "number" ? value : parseFloat(String(value));
const describeMoves = (motion: Motion) => motion.properties.map(property => `${property} ${motion.kinds[property] ?? "set"}`).join(", ") || "nothing";
const describeHandoff = ({ property, before, after }: MotionInterruption) =>
  `${property} ${round(before.value)} at ${round(before.velocity)}/s → ${round(after.value)} at ${round(after.velocity)}/s`;
/** An interruption that changed the property's value or velocity beyond the engine's rest thresholds. */
const jumps = ({ property, before, after }: MotionInterruption) =>
  Math.abs(after.value - before.value) > REST[property].delta || Math.abs(after.velocity - before.velocity) > Math.max(REST[property].speed, 1e-6 * Math.abs(before.velocity));

/** Overshoot past the final value in the direction of travel, in points, over the translation properties that travelled. */
function overshoot(motion: Motion, samples: MotionSamples): number | undefined {
  let worst: number | undefined;
  for (const property of TRANSLATION) {
    const end = samples.samples.at(-1)!.values[property], direction = Math.sign(end - motion.startValues[property]);
    if (!direction) continue;
    worst = Math.max(worst ?? 0, ...samples.samples.map(sample => (sample.values[property] - end) * direction));
  }
  return worst;
}

export function motionCommands(client: () => MotionClient): Record<string, CommandHandler> {
  /** Motion is read by testID: the MotionView with that testID or containing the view with it. */
  async function target(selector: unknown, context: CommandContext) {
    const { element } = await context.resolve(selector);
    if (!element.id) throw new Failure("unsupported", `backend driver reads motion by testID, and ${describe(selector)} matched an element without one`);
    return element.id;
  }
  const settled = (id: string, what: string, context: CommandContext) => driven(what, () => client().waitForMotion(id, { settled: true }, context.timeoutMs));

  /** Captures the window at each progress point of the motion (percent of its start to its end) and compares it with `<golden>-<percent>`. */
  async function frames(id: string, { at, golden }: { at: number[]; golden: string }, context: CommandContext) {
    if ((await driven("assertMotion frames", () => client().motionState(id))).clock !== "virtual")
      throw new Failure("invalid", "assertMotion frames are exact frames of the virtual clock; run setClock: virtual before the motion starts");
    const failures: Failure[] = [];
    for (const percent of [...at].sort((a, b) => a - b)) {
      await driven(`assertMotion frames at ${percent}%`, () => client().waitForMotion(id, { progress: percent / 100 }, context.timeoutMs));
      const screenshot: FlowCommand = { name: "assertScreenshot", args: { golden: `${golden}-${String(percent).replace(".", "_")}` }, location: context.command.location };
      try { await context.run([screenshot]); } catch (error) {
        const failure = (error as { failure?: unknown }).failure ?? error;
        if (!(failure instanceof Failure) || failure.kind !== "assertion") throw error;
        failures.push(failure);
      }
    }
    if (failures.length) throw new Failure("assertion", failures.map(failure => failure.message).join("\n"), { artifacts: failures.flatMap(failure => failure.details.artifacts ?? []) });
  }

  return {
    /** Waits for the target's motion after the last input, until it settles (or `until` from its start), and writes its samples. */
    captureMotion: async (args, context) => {
      const name = String(args.name);
      if (!FILE_NAME.test(name)) throw new Failure("invalid", `captureMotion name ${JSON.stringify(name)} must be 1-100 letters, digits, _ and -`);
      const id = await target(args.target, context), until = args.until ?? "settled";
      const elapsed = until === "settled" ? undefined : ms(until as string | number);
      const state = await driven("captureMotion", () => client().waitForMotion(id, elapsed === undefined ? { settled: true } : { elapsedMs: elapsed }, context.timeoutMs));
      const motion = state.motion!;
      const toMs = Math.min(elapsed === undefined ? Infinity : motion.startMs + elapsed, motion.endMs ?? Infinity, state.timeMs);
      const recording = await driven("captureMotion", () => client().sampleMotion(id, { toMs }));
      const file = path.join(context.outputDir, `${name}.motion.json`);
      writeFileSync(file, `${JSON.stringify({ testID: id, clock: state.clock, motion, ...recording }, null, 2)}\n`);
      context.addArtifact({ kind: "output", path: file });
    },

    /**
     * Asserts the target's motion after the last input, once it settles: its kind, settle time, overshoot and velocity
     * continuity across interruptions. `frames` first captures it at progress points (virtual clock).
     */
    assertMotion: async (args, context) => {
      const id = await target(args.target, context);
      if (args.kind === "none") {
        const others = ["velocityContinuous", "overshoot", "settlesWithin", "frames"].filter(key => args[key] !== undefined);
        if (others.length) throw new Failure("invalid", `assertMotion kind: none has no motion to check ${others.join(", ")} on`);
        const { motion } = await driven("assertMotion", () => client().motionState(id));
        if (motion?.afterInput) throw new Failure("assertion", `${id} moved after the last input (${describeMoves(motion)})`);
        return;
      }
      if (args.frames) await frames(id, args.frames as { at: number[]; golden: string }, context);
      const motion = (await settled(id, "assertMotion", context)).motion!;
      const problems: string[] = [];
      // From its start, or its last interruption: the input that the flow waits on started or redirected it there.
      if (args.settlesWithin !== undefined && motion.endMs! - motion.latestMs > ms(args.settlesWithin as string | number))
        problems.push(`it settled ${round(motion.endMs! - motion.latestMs)} ms after it ${motion.latestMs === motion.startMs ? "started" : "was last interrupted"}, not within ${args.settlesWithin}`);
      if (args.kind !== undefined) {
        const kind = args.kind as "spring" | "timing" | "crossfade", moved = motion.properties;
        const matches = kind === "crossfade" ? moved.length > 0 && moved.every(property => property === "opacity")
          : moved.length > 0 && moved.every(property => (KINDS[kind] as readonly string[]).includes(motion.kinds[property] ?? ""));
        if (!matches) problems.push(`it is not a ${kind}: it moved ${describeMoves(motion)}`);
      }
      if (args.velocityContinuous !== undefined) {
        const broken = motion.interruptions.filter(jumps);
        if (args.velocityContinuous === true && !motion.interruptions.length) problems.push("it was never interrupted, so velocity continuity was not exercised");
        else if (args.velocityContinuous === true && broken.length) problems.push(`an interruption changed value or velocity: ${broken.map(describeHandoff).join("; ")}`);
        else if (args.velocityContinuous === false && !broken.length) problems.push("no interruption changed its value or velocity");
      }
      if (args.overshoot !== undefined) {
        const measured = overshoot(motion, await driven("assertMotion", () => client().sampleMotion(id, { toMs: motion.endMs! })));
        const { min, max } = args.overshoot as { min?: unknown; max?: unknown };
        if (measured === undefined) problems.push(`overshoot is measured on a translation that travels; it moved ${describeMoves(motion)}`);
        else if (min !== undefined && measured < pixels(min)) problems.push(`it overshot ${round(measured)}px, less than ${pixels(min)}px`);
        else if (max !== undefined && measured > pixels(max)) problems.push(`it overshot ${round(measured)}px, more than ${pixels(max)}px`);
      }
      if (problems.length) throw new Failure("assertion", `the motion of ${id} after the last input: ${problems.join("; ")}`);
    },

    /** Waits until the target's motion reaches `progress` (exactly, on the virtual clock), then runs `with`. */
    interruptAt: async (args, context) => {
      if (args.target === undefined) throw new Failure("unsupported", "backend driver needs interruptAt target: the view whose motion progress it waits for");
      const id = await target(args.target, context);
      await driven("interruptAt", () => client().waitForMotion(id, { progress: args.progress as number }, context.timeoutMs));
      await context.run([args.with as FlowCommand]);
    },

    /** Counts main-thread display-link frames while `during` runs; records `frames.fps` and `frames.dropped`. */
    assertFrames: async (args, context) => {
      await driven("assertFrames", () => client().startFrames());
      try { await context.run([args.during as FlowCommand]); } catch (error) {
        await client().stopFrames().catch(() => undefined);
        throw error;
      }
      const report = await driven("assertFrames", () => client().stopFrames());
      context.metric("frames.fps", report.fps);
      context.metric("frames.dropped", report.droppedFrames);
      const problems: string[] = [], fps = args.fps as { min?: number; max?: number } | undefined;
      if (fps?.min !== undefined && report.fps < fps.min) problems.push(`${round(report.fps)} fps is below ${fps.min}`);
      if (fps?.max !== undefined && report.fps > fps.max) problems.push(`${round(report.fps)} fps is above ${fps.max}`);
      if (args.dropped !== undefined && report.droppedFrames > (args.dropped as number)) problems.push(`${report.droppedFrames} frames dropped, more than ${args.dropped}`);
      if (problems.length) throw new Failure("assertion", `${problems.join("; ")} (${report.frames} frames over ${round(report.durationMs)} ms at ${report.refreshRate} Hz; longest gap ${round(report.maxFrameGapMs)} ms)`);
    },
  };
}
