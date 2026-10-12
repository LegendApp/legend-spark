import { useRef, useState, useSyncExternalStore } from "react";
import { ThreadedRuntime } from "@react-native-runtimes/core";
import { addProfilingListener, getProfilerAvailability, isProfiling, startProfiling, stopProfiling, type ProfilingResult, type StartProfilingOptions, type StopProfilingOptions } from "@legendapp/spark/devtools";
import { animate, timing, type MotionTarget } from "@legendapp/spark/motion";
import { useI18n } from "../../shell/app-controller";
import { WORKER, workerAllocate, workerWorkload } from "../../devtools-tasks";
import { errorText, serial, useWorkerRuntime } from "./devtools-demo";
import { profilingWorkload } from "./profiling-workload";

/** How far the box slides, in points, and how long each workload keeps its runtime busy. */
export const TRACK = 200;
const WORKLOAD_MS = 300;
export type Recording = "idle" | "recording" | "saved" | "failed";

/**
 * Whether the app records, whoever started it (this screen, the Developer menu or another runtime): isProfiling once,
 * then the profiler's start and stop events.
 */
let recordingNow = false;
function subscribeRecording(changed: () => void) {
  const set = (value: boolean) => { recordingNow = value; changed(); };
  const subscription = addProfilingListener(set);
  isProfiling().then(set, error => console.error("isProfiling failed", error));
  return () => subscription.remove();
}
const none = () => () => {};
function useProfilerRecording(enabled: boolean) {
  return useSyncExternalStore(enabled ? subscribeRecording : none, () => enabled && recordingNow);
}

/** Retains an object marked `ks-heap-shared:<tag>` in this runtime's heap, so a heap snapshot of it (DevTools › Memory) finds it. */
export function allocate(tag: string): string {
  const marker = `ks-heap-shared:${tag}`;
  (globalThis as { ksHeapMarker?: unknown }).ksHeapMarker = { marker, items: Array.from({ length: 1000 }, (_, index) => ({ index })) };
  return marker;
}
/** The same in the ks-devtools worker runtime, which the screen runs. */
const inWorker = {
  workload: (milliseconds: number) => serial(() => ThreadedRuntime.run(WORKER, workerWorkload, milliseconds)),
  allocate: (tag: string) => serial(() => ThreadedRuntime.run(WORKER, workerAllocate, tag)),
};

/** What the screen shows of a saved profile: where its files are and what each holds. */
export function describeProfile(result: ProfilingResult): string {
  const runtimes = result.profiles.map(profile => `${profile.runtime === "shared" ? "shared" : profile.runtime.isolated}: ${profile.samples} samples, source maps ${profile.sourceMaps}`);
  const { frames, droppedFrames, fps, refreshRate } = result.frames;
  const missing = result.missing.map(item => `${item.runtime === "shared" ? "shared" : item.runtime.isolated}: ${item.code}`);
  return [result.trace, ...result.profiles.map(profile => profile.path), ...runtimes, ...missing,
    `${frames} frames, ${droppedFrames} dropped, ${fps.toFixed(1)} fps at ${refreshRate} Hz; ${result.motions} motion${result.motions === 1 ? "" : "s"}${result.truncated ? " (truncated)" : ""}`].join("\n");
}

export function useProfilingDemo() {
  const availability = getProfilerAvailability();
  const worker = useWorkerRuntime(availability.available);
  const way = useI18n().rtl ? -1 : 1;
  const box = useRef<MotionTarget | null>(null);
  const moved = useRef(false);
  const live = useProfilerRecording(availability.available);
  // What this screen last saw of a recording it stopped; the live state comes from the profiler.
  const [outcome, setOutcome] = useState<"idle" | "saved" | "failed">("idle");
  const recording: Recording = live ? "recording" : outcome;
  const [result, setResult] = useState<string>();
  const fail = (error: unknown) => { setOutcome("failed"); setResult(errorText(error)); };
  const report = (operation: () => Promise<unknown> | unknown) => Promise.resolve().then(operation).then(value => setResult(String(value)), error => setResult(errorText(error)));
  return {
    availability, worker, box, recording, result,
    start: () => startProfiling().then(() => setResult(undefined), fail),
    stop: () => stopProfiling().then(value => { setOutcome("saved"); setResult(describeProfile(value)); }, fail),
    workload: () => report(() => profilingWorkload(WORKLOAD_MS)),
    workerWorkload: () => report(() => inWorker.workload(WORKLOAD_MS)),
    animate: () => {
      moved.current = !moved.current;
      return report(() => animate(box.current, { translateX: timing(moved.current ? way * TRACK : 0, { durationMs: 600 }) }).finished.then(value => JSON.stringify(value)));
    },
    allocate: () => report(() => allocate("button")),
  };
}

// In the shared runtime's DevTools console, or over CDP (scripts/test-profiler.ts): ksProfiling.start(), ksProfiling.stop({ directory }).
if (__DEV__) (globalThis as { ksProfiling?: unknown }).ksProfiling = {
  availability: getProfilerAvailability,
  recording: isProfiling,
  start: (options?: StartProfilingOptions) => startProfiling(options),
  stop: (options?: StopProfilingOptions) => stopProfiling(options),
  workload: profilingWorkload,
  workerWorkload: inWorker.workload,
  allocate,
  workerAllocate: inWorker.allocate,
};
