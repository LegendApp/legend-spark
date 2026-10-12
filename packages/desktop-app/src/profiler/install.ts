// Development bundles on macOS only: @legendapp/spark/runtime-entry requires this inside `if (__DEV__)`, on macOS, in
// every JavaScript runtime, so release bundles contain none of the profiler (tests/developer-menu-release.test.ts; the
// release-safety probe's DEVT-REL-05 looks for PROFILER_MARKER in a release build's JavaScript and native code).
import getDevServer from "react-native/Libraries/Core/Devtools/getDevServer";
import { registerProfiler, type ProfiledRuntime, type ProfilingFrames } from "../profiler";
import { callAppNative } from "../transport";
import { PROFILER_MARKER } from "./marker";
import { symbolicate } from "./symbolicate";
import { chromeTrace, type FrameTimeline } from "./trace";

/** What SparkProfiler.mm returns when it stops: each runtime's Hermes profile is a DevTools-format JSON string. */
type Recording = { process: string; timeline: FrameTimeline; frames: ProfilingFrames; runtimes: { runtime: string; startUs: number; profile: string }[] };
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isRecording = (value: unknown): value is Recording => isObject(value) && typeof value.process === "string" && isObject(value.timeline)
  && Array.isArray(value.timeline.timestamps) && Array.isArray(value.timeline.motion) && isObject(value.frames) && Array.isArray(value.runtimes)
  && value.runtimes.every(item => isObject(item) && typeof item.runtime === "string" && typeof item.startUs === "number" && typeof item.profile === "string");
const isWritten = (value: unknown): value is { directory: string; paths: string[] } => isObject(value) && typeof value.directory === "string"
  && Array.isArray(value.paths) && value.paths.every(path => typeof path === "string");
const isNull = (value: unknown): value is null => value === null;

const pad = (value: number) => String(value).padStart(2, "0");
function stamp(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
const post = (url: string, body: string) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });

export function installProfiler(): void {
  registerProfiler({
    start: samplesPerSecond => callAppNative("startProfiling", isNull, { samplesPerSecond }).then(() => undefined),
    async stop(directory) {
      const target = directory === undefined ? {} : { directory };
      const recording = await callAppNative("stopProfiling", isRecording, target);
      const server = getDevServer(), origin = server.bundleLoadedFromServer ? server.url : undefined;
      // The shared runtime first, then isolated runtimes by name; native lists them in the order they answered.
      const order = (runtime: string) => runtime === "shared" ? "" : `~${runtime}`;
      const answered = [...recording.runtimes].sort((a, b) => order(a.runtime) < order(b.runtime) ? -1 : 1);
      const runtimes = await Promise.all(answered.map(async ({ runtime, startUs, profile }) => ({ runtime, startUs, ...await symbolicate(JSON.parse(profile), origin, post) })));
      const name = `${PROFILER_MARKER}-${stamp()}`;
      const files = [
        { name: `${name}.trace.json`, contents: JSON.stringify(chromeTrace({ process: recording.process, frames: recording.timeline, runtimes })) },
        ...runtimes.map(({ runtime, profile }) => ({ name: `${name}-${runtime === "shared" ? "shared" : `isolated-${runtime.replace(/[^A-Za-z0-9_-]/g, "-")}`}.cpuprofile`, contents: JSON.stringify(profile) })),
      ];
      const written = await callAppNative("writeProfile", isWritten, { ...target, files });
      const profiles = runtimes.map(({ runtime, profile, startUs: _, ...sourceMaps }, index): ProfiledRuntime => ({
        runtime: runtime === "shared" ? "shared" : { isolated: runtime }, path: written.paths[index + 1]!, samples: profile.samples.length, ...sourceMaps,
      }));
      return { directory: written.directory, trace: written.paths[0]!, profiles, frames: recording.frames, motions: recording.timeline.motion.length, truncated: recording.timeline.truncated };
    },
  });
}
