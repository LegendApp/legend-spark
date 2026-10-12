import { Platform } from "react-native";
import { SparkError, type Subscription } from "./contracts";
import type { DevToolsAvailability, DevToolsRuntime } from "./devtools";

// The profiler's public surface. Release-safe: the profiler itself (native recording, symbolication, trace files) lives
// in ./profiler/, which @legendapp/spark/runtime-entry requires only in development bundles and which registers itself
// here, and its native half compiles only into development builds (docs/devtools.md#profiling).

export interface StartProfilingOptions {
  /** Hermes samples each JavaScript runtime this many times per second, 1 to 10000. Default 1000. */
  samplesPerSecond?: number;
}
export interface StopProfilingOptions {
  /** An existing directory to write the files into. Default: a new directory in the system's temporary directory. */
  directory?: string;
}
/** Main-thread display-link frames while profiling, as the test driver's frame counter reports them. */
export interface ProfilingFrames { frames: number; droppedFrames: number; maxFrameGapMs: number; durationMs: number; fps: number; refreshRate: number }
/**
 * One JavaScript runtime's samples, written as a `.cpuprofile` (Chrome DevTools' format). `sourceMaps` is `applied` when
 * the development server mapped its frames to source files and lines, else `unavailable` with the `reason`.
 */
export type ProfiledRuntime = { runtime: DevToolsRuntime; path: string; samples: number } & ({ sourceMaps: "applied" } | { sourceMaps: "unavailable"; reason: string });
/**
 * A runtime that was running but whose samples are not in the profile: `E_TIMEOUT` when its JavaScript thread did not
 * hand them over within 10 s, `E_UNAVAILABLE` when it is not Hermes, `E_INVALID_DATA` when Hermes's profile was not
 * readable. The other runtimes' profiles are written all the same.
 */
export interface MissingRuntime { runtime: DevToolsRuntime; code: "E_TIMEOUT" | "E_UNAVAILABLE" | "E_INVALID_DATA"; message: string }
export interface ProfilingResult {
  /** Where the files are. */
  directory: string;
  /** The Chrome trace (Trace Event Format) for Chrome DevTools, React Native DevTools or Perfetto: frames, motion and every runtime's samples. */
  trace: string;
  profiles: ProfiledRuntime[];
  /** Runtimes that were running whose samples could not be collected; empty when every runtime answered. */
  missing: MissingRuntime[];
  frames: ProfilingFrames;
  /** MotionView animations on the trace's compositor track. */
  motions: number;
  /** The frame timeline kept only its first frames (docs/devtools.md#frame-timeline). */
  truncated: boolean;
}

/** Internal: what ./profiler registers. */
export interface Profiler {
  start(samplesPerSecond: number): Promise<void>;
  stop(directory: string | undefined): Promise<ProfilingResult>;
  recording(): Promise<boolean>;
  observe(listener: (recording: boolean) => void): Subscription;
}
let profiler: Profiler | undefined;
/** Internal, development bundles only: one profiler per JavaScript runtime. */
export function registerProfiler(implementation: Profiler): void {
  if (profiler) throw new SparkError("E_ALREADY_EXISTS", "A profiler is already registered");
  profiler = implementation;
}

/**
 * The profiler exists on macOS in development bundles, in every JavaScript runtime, once
 * `@legendapp/spark/runtime-entry` has installed it (`missing-module` otherwise). Release bundles contain none of it.
 */
export function getProfilerAvailability(): DevToolsAvailability {
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  if (!__DEV__) return { available: false, reason: "development-only" };
  return profiler ? { available: true } : { available: false, reason: "missing-module" };
}
const codes = { "unsupported-platform": "E_UNSUPPORTED_PLATFORM", "missing-module": "E_MODULE_UNAVAILABLE", "host-restriction": "E_UNAVAILABLE", "development-only": "E_UNAVAILABLE" } as const;
function available(): Profiler {
  const availability = getProfilerAvailability();
  if (!availability.available) throw new SparkError(codes[availability.reason], "The profiler is unavailable: " + availability.reason);
  return profiler!;
}
function options<T extends object>(value: T, keys: readonly (keyof T & string)[]): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SparkError("E_INVALID_ARGUMENT", "Expected profiling options");
  for (const key of Object.keys(value)) if (!keys.includes(key as keyof T & string)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unknown profiling option: ${key}`);
  return value;
}

/**
 * Starts profiling the app: Hermes's sampling profiler in every JavaScript runtime, and the frame timeline (main-thread
 * frames and MotionView animations). One recording at a time per app: rejects `E_BUSY` while one runs, whoever started it.
 */
export async function startProfiling(startOptions: StartProfilingOptions = {}): Promise<void> {
  const { samplesPerSecond = 1000 } = options(startOptions, ["samplesPerSecond"]);
  if (!Number.isInteger(samplesPerSecond) || samplesPerSecond < 1 || samplesPerSecond > 10000) throw new SparkError("E_INVALID_ARGUMENT", "samplesPerSecond must be an integer from 1 to 10000");
  await available().start(samplesPerSecond);
}

/**
 * Stops the recording and writes a Chrome trace and a `.cpuprofile` per runtime, source-mapped through the development
 * server, into `directory` (default: a new temporary directory). Rejects `E_NOT_FOUND` when nothing is recording, or
 * when `directory` is not an existing directory, which keeps the recording running.
 */
export async function stopProfiling(stopOptions: StopProfilingOptions = {}): Promise<ProfilingResult> {
  const { directory } = options(stopOptions, ["directory"]);
  if (directory !== undefined && (typeof directory !== "string" || !directory.startsWith("/"))) throw new SparkError("E_INVALID_ARGUMENT", "directory must be an absolute path");
  return available().stop(directory);
}

/** Whether a recording runs in this app, whichever runtime or the Developer menu started it. */
export async function isProfiling(): Promise<boolean> {
  return available().recording();
}

/**
 * Calls `listener` with `true` when a recording starts and `false` when it stops, whichever runtime or the Developer
 * menu started or stopped it.
 */
export function addProfilingListener(listener: (recording: boolean) => void): Subscription {
  if (typeof listener !== "function") throw new SparkError("E_INVALID_ARGUMENT", "Expected a listener function");
  return available().observe(listener);
}
