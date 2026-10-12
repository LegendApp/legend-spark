// Development bundles on macOS only: @legendapp/spark/runtime-entry requires this inside `if (__DEV__)`, on macOS, in
// every JavaScript runtime, so release bundles contain none of the profiler (tests/developer-menu-release.test.ts; the
// release-safety probe's DEVT-REL-05 looks for PROFILER_MARKER in a release build's JavaScript and native code).
import getDevServer from "react-native/Libraries/Core/Devtools/getDevServer";
import type { DevToolsRuntime } from "../devtools";
import { onDesktopEvent } from "../events";
import { registerProfiler, type MissingRuntime, type ProfiledRuntime, type ProfilingFrames } from "../profiler";
import { callAppNative } from "../transport";
import { PROFILER_MARKER } from "./marker";
import { symbolicate } from "./symbolicate";
import { chromeTrace, type CpuProfile, type FrameTimeline } from "./trace";

/**
 * What SparkProfiler.mm returns when it stops: per running runtime, its Hermes profile as a DevTools-format JSON string,
 * or why it has none.
 */
type Answer = { runtime: string; startUs: number; profile: string } | { runtime: string; error: { code: MissingRuntime["code"]; message: string } };
type Recording = { process: string; timeline: FrameTimeline; frames: ProfilingFrames; runtimes: Answer[] };
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const CODES = new Set(["E_TIMEOUT", "E_UNAVAILABLE", "E_INVALID_DATA"]);
const isAnswer = (item: unknown): item is Answer => isObject(item) && typeof item.runtime === "string" && (
  (typeof item.startUs === "number" && typeof item.profile === "string")
  || (isObject(item.error) && CODES.has(item.error.code as string) && typeof item.error.message === "string"));
const isRecording = (value: unknown): value is Recording => isObject(value) && typeof value.process === "string" && isObject(value.timeline)
  && Array.isArray(value.timeline.timestamps) && Array.isArray(value.timeline.motion) && isObject(value.frames) && Array.isArray(value.runtimes)
  && value.runtimes.every(isAnswer);
const isWritten = (value: unknown): value is { directory: string; paths: string[] } => isObject(value) && typeof value.directory === "string"
  && Array.isArray(value.paths) && value.paths.every(path => typeof path === "string");
const isNull = (value: unknown): value is null => value === null;
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

const pad = (value: number, length = 2) => String(value).padStart(length, "0");
/** Local time to the millisecond: 20261012-143000-123. */
export function stamp(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
}
const runtimeOf = (runtime: string): DevToolsRuntime => runtime === "shared" ? "shared" : { isolated: runtime };
/**
 * A file name per runtime: `shared`, or `isolated-<name>` with characters other than letters, digits, `_` and `-`
 * replaced; names that collide once replaced get `-2`, `-3`…
 */
export function runtimeFileNames(runtimes: readonly string[]): string[] {
  const taken = new Set<string>();
  return runtimes.map(runtime => {
    const base = runtime === "shared" ? "shared" : `isolated-${runtime.replace(/[^A-Za-z0-9_-]/g, "-")}`;
    let name = base;
    for (let index = 2; taken.has(name); index++) name = `${base}-${index}`;
    taken.add(name);
    return name;
  });
}
const post = (url: string, body: string) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
/** How many other names writing tries when a file of that name exists, so a collision never loses a recording. */
const NAME_ATTEMPTS = 20;

export function installProfiler(): void {
  registerProfiler({
    start: samplesPerSecond => callAppNative("startProfiling", isNull, { samplesPerSecond }).then(() => undefined),
    recording: () => callAppNative("isProfiling", isBoolean),
    observe: listener => onDesktopEvent(event => { if (typeof event.recording === "boolean") listener(event.recording); }, { types: ["profiling"] }),
    async stop(directory) {
      const target = directory === undefined ? {} : { directory };
      const name = `${PROFILER_MARKER}-${stamp()}`;
      const recording = await callAppNative("stopProfiling", isRecording, target);
      const server = getDevServer(), origin = server.bundleLoadedFromServer ? server.url : undefined;
      // The shared runtime first, then isolated runtimes by name.
      const order = (runtime: string) => runtime === "shared" ? "" : `~${runtime}`;
      const answers = [...recording.runtimes].sort((a, b) => order(a.runtime) < order(b.runtime) ? -1 : 1);
      const missing: MissingRuntime[] = [];
      const parsed: { runtime: string; startUs: number; profile: CpuProfile }[] = [];
      for (const answer of answers) {
        if ("error" in answer) { missing.push({ runtime: runtimeOf(answer.runtime), ...answer.error }); continue; }
        try { parsed.push({ runtime: answer.runtime, startUs: answer.startUs, profile: JSON.parse(answer.profile) as CpuProfile }); }
        catch (error) { missing.push({ runtime: runtimeOf(answer.runtime), code: "E_INVALID_DATA", message: `Hermes's profile is not JSON: ${error instanceof Error ? error.message : String(error)}` }); }
      }
      const runtimes = await Promise.all(parsed.map(async ({ runtime, startUs, profile }) => ({ runtime, startUs, ...await symbolicate(profile, origin, post) })));
      const fileNames = runtimeFileNames(runtimes.map(({ runtime }) => runtime));
      const trace = JSON.stringify(chromeTrace({ process: recording.process, frames: recording.timeline, runtimes }));
      const profiles = runtimes.map(({ profile }) => JSON.stringify(profile));
      let written: { directory: string; paths: string[] } | undefined;
      for (let attempt = 1; !written; attempt++) {
        const base = attempt === 1 ? name : `${name}-${attempt}`;
        const files = [{ name: `${base}.trace.json`, contents: trace }, ...profiles.map((contents, index) => ({ name: `${base}-${fileNames[index]}.cpuprofile`, contents }))];
        try { written = await callAppNative("writeProfile", isWritten, { ...target, files }); }
        catch (error) { if ((error as { code?: string }).code !== "E_ALREADY_EXISTS" || attempt === NAME_ATTEMPTS) throw error; }
      }
      const result = runtimes.map(({ runtime, profile, startUs: _, ...sourceMaps }, index): ProfiledRuntime => ({
        runtime: runtimeOf(runtime), path: written.paths[index + 1]!, samples: profile.samples.length, ...sourceMaps,
      }));
      return { directory: written.directory, trace: written.paths[0]!, profiles: result, missing, frames: recording.frames, motions: recording.timeline.motion.length, truncated: recording.timeline.truncated };
    },
  });
}
