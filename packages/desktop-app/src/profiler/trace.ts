// The frame timeline as a Chrome trace (JSON Trace Event Format), which Chrome DevTools' Performance panel, React Native
// DevTools and Perfetto (ui.perfetto.dev) open. Pure: the development profiler (./install.ts) and the e2e runner's
// assertFrames (scripts/e2e/runner/driver-motion.ts) build their traces here from the same native recorder
// (SparkFrameTimeline, docs/devtools.md#frame-timeline).

/** Main-thread display-link frames and motion, in milliseconds from the start of the recording. */
export interface FrameTimeline {
  /** Each display-link callback: a frame the main thread was free to produce. */
  timestamps: readonly number[];
  /** The display's refresh interval. */
  intervalMs: number;
  /** Each MotionView's animation, by its testID (or `MotionView <tag>`), from its first to its last animated frame. */
  motion: readonly { view: string; startMs: number; endMs: number }[];
  /** The recorder kept only its first frames (docs/devtools.md#frame-timeline). */
  truncated: boolean;
}
/** A sampling profile in the DevTools `Profiler.Profile` shape, lines and columns from 0 (./symbolicate.ts normalizes Hermes's). */
export interface CpuProfile {
  nodes: { id: number; callFrame: CallFrame; children?: number[]; parent?: number; hitCount?: number }[];
  /** Microseconds, on the clock of `RuntimeProfile.startUs`. */
  startTime: number;
  endTime: number;
  samples: number[];
  timeDeltas: number[];
}
export interface CallFrame { functionName: string; scriptId: string; url: string; lineNumber: number; columnNumber: number }
/** One runtime's samples; `startUs` is its profile clock when the recording started. */
export interface RuntimeProfile { runtime: string; profile: CpuProfile; startUs: number }
export interface TraceEvent { name: string; ph: "X" | "M"; pid: number; tid: number; ts: number; dur?: number; cat?: string; args?: Record<string, unknown> }
export interface ChromeTrace { traceEvents: TraceEvent[]; displayTimeUnit: "ms" }

const PID = 1, MAIN = 1, COMPOSITOR = 2, JS = 10;
const us = (ms: number) => Math.round(ms * 1000);
const meta = (name: string, tid: number, args: Record<string, unknown>): TraceEvent => ({ name, ph: "M", pid: PID, tid, ts: 0, args });
/** The thread label of a runtime: `shared` or an isolated runtime's name. */
export const runtimeLabel = (runtime: string) => runtime === "shared" ? "JavaScript (shared runtime)" : `JavaScript (isolated runtime: ${runtime})`;

/** Frames as slices between consecutive callbacks; a gap of more than one interval is named for the frames it dropped. */
function frameEvents({ timestamps, intervalMs }: FrameTimeline): TraceEvent[] {
  const events: TraceEvent[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    const start = timestamps[i - 1]!, gap = timestamps[i]! - start;
    const dropped = intervalMs > 0 ? Math.round(gap / intervalMs) - 1 : 0;
    events.push({ name: dropped > 0 ? `Dropped ${dropped} frame${dropped === 1 ? "" : "s"}` : "Frame", cat: "frame", ph: "X", pid: PID, tid: MAIN, ts: us(start), dur: us(gap), args: { gapMs: gap, ...(dropped > 0 ? { dropped } : {}) } });
  }
  return events;
}

/** The node ids of a sample's stack, outermost first, without Hermes's `[root]`. */
function stacks(profile: CpuProfile): (id: number) => number[] {
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const parents = new Map<number, number>();
  for (const node of profile.nodes) {
    if (node.parent !== undefined) parents.set(node.id, node.parent);
    for (const child of node.children ?? []) parents.set(child, node.id);
  }
  const cache = new Map<number, number[]>();
  return id => {
    let stack = cache.get(id);
    if (stack) return stack;
    stack = [];
    for (let at: number | undefined = id; at !== undefined && nodes.get(at)?.callFrame.functionName !== "[root]"; at = parents.get(at)) stack.unshift(at);
    cache.set(id, stack);
    return stack;
  };
}

/**
 * A runtime's samples as nested slices on its own thread, the way a flame chart reads them: a sample's stack holds from
 * its time until the next sample's, and a frame that consecutive samples share is one slice.
 */
function sampleEvents({ profile, startUs }: RuntimeProfile, tid: number): TraceEvent[] {
  const stackOf = stacks(profile), frames = new Map(profile.nodes.map(node => [node.id, node.callFrame]));
  const events: TraceEvent[] = [], open: { id: number; start: number }[] = [];
  const close = (depth: number, at: number) => {
    while (open.length > depth) {
      const { id, start } = open.pop()!, frame = frames.get(id)!;
      if (at <= start) continue;
      events.push({ name: frame.functionName || "(anonymous)", cat: "js", ph: "X", pid: PID, tid, ts: start - startUs, dur: at - start,
        args: frame.url && !frame.url.startsWith("[") ? { url: frame.url, line: frame.lineNumber + 1, column: frame.columnNumber + 1 } : {} });
    }
  };
  let time = profile.startTime;
  profile.samples.forEach((sample, index) => {
    time += profile.timeDeltas[index] ?? 0;
    const stack = stackOf(sample);
    let common = 0;
    while (common < open.length && common < stack.length && open[common]!.id === stack[common]) common++;
    close(common, time);
    for (const id of stack.slice(common)) open.push({ id, start: time });
  });
  close(0, Math.max(time, profile.endTime));
  return events;
}

/**
 * One trace: the main thread's frames, a compositor track with each MotionView's animations, and a thread per
 * JavaScript runtime with its sampled stacks, all on the recording's clock (microseconds from its start).
 */
export function chromeTrace({ process, frames, runtimes = [] }: { process: string; frames: FrameTimeline; runtimes?: readonly RuntimeProfile[] }): ChromeTrace {
  const traceEvents: TraceEvent[] = [
    meta("process_name", MAIN, { name: process }),
    meta("thread_name", MAIN, { name: "Main thread (display-link frames)" }), meta("thread_sort_index", MAIN, { sort_index: 0 }),
    meta("thread_name", COMPOSITOR, { name: "Compositor (motion)" }), meta("thread_sort_index", COMPOSITOR, { sort_index: 1 }),
    ...frameEvents(frames),
    ...frames.motion.map(({ view, startMs, endMs }): TraceEvent => ({ name: view, cat: "motion", ph: "X", pid: PID, tid: COMPOSITOR, ts: us(startMs), dur: us(endMs - startMs) })),
  ];
  runtimes.forEach((runtime, index) => {
    const tid = JS + index;
    traceEvents.push(meta("thread_name", tid, { name: runtimeLabel(runtime.runtime) }), meta("thread_sort_index", tid, { sort_index: 2 + index }), ...sampleEvents(runtime, tid));
  });
  return { traceEvents, displayTimeUnit: "ms" };
}
