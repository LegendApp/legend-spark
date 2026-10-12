// The development profiler (docs/devtools.md#profiling): the public API's availability and validation, the Chrome trace
// of the frame timeline and each runtime's samples, source mapping through the development server, and what the
// installed profiler writes. A real recording: scripts/test-profiler.ts.
import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ platform: { OS: "macos" }, calls: [] as [string, unknown][], answers: new Map<string, unknown>() }));
vi.mock("react-native", () => ({ Platform: mocks.platform }));
vi.mock("react-native/Libraries/Core/Devtools/getDevServer", () => ({ default: () => ({ url: "http://127.0.0.1:8081/", bundleLoadedFromServer: true }) }));
vi.mock("../packages/desktop-app/src/transport", () => ({
  callAppNative: async (method: string, validate: (value: unknown) => boolean, args: object) => {
    mocks.calls.push([method, args]);
    const answer = mocks.answers.get(method);
    if (!validate(answer)) throw new Error(`${method}: invalid answer`);
    return answer;
  },
}));

import { chromeTrace, type CpuProfile, type FrameTimeline } from "../packages/desktop-app/src/profiler/trace";
import { symbolicate, type Post } from "../packages/desktop-app/src/profiler/symbolicate";

const globals = globalThis as { __DEV__?: boolean };
const BUNDLE = "http://127.0.0.1:8081/index.bundle?platform=macos";
const frame = (functionName: string, url = BUNDLE, lineNumber = 1, columnNumber = 1) => ({ functionName, scriptId: "0", url, lineNumber, columnNumber });
/** [root] → main → (work → fib) | idle, with samples main/work/fib, main/work/fib, main/work, idle. */
function profile(): CpuProfile {
  return {
    nodes: [
      { id: 1, callFrame: frame("[root]", "[root]", 0, 0), children: [2, 5] },
      { id: 2, callFrame: frame("main", BUNDLE, 10, 5), children: [3] },
      { id: 3, callFrame: frame("work", BUNDLE, 20, 3), children: [4] },
      { id: 4, callFrame: frame("fib", BUNDLE, 30, 7) },
      { id: 5, callFrame: frame("(idle)", "", 0, 0) },
    ],
    startTime: 1_000_000, endTime: 1_004_000, samples: [4, 4, 3, 5], timeDeltas: [0, 1000, 1000, 1000],
  };
}
const timeline: FrameTimeline = { timestamps: [0, 8.3, 16.7, 50], intervalMs: 8.333, motion: [{ view: "box", startMs: 8.3, endMs: 50 }], truncated: false };

describe("trace", () => {
  test("frames are main-thread slices named for the frames a gap dropped, and motion is on the compositor track", () => {
    const { traceEvents } = chromeTrace({ process: "KitchenSink", frames: timeline });
    expect(traceEvents.filter(event => event.ph === "M" && event.name === "thread_name").map(event => [event.tid, event.args!.name])).toEqual([[1, "Main thread (display-link frames)"], [2, "Compositor (motion)"]]);
    expect(traceEvents.filter(event => event.cat === "frame").map(event => [event.name, event.ts, event.dur])).toEqual([["Frame", 0, 8300], ["Frame", 8300, 8400], ["Dropped 3 frames", 16700, 33300]]);
    expect(traceEvents.find(event => event.cat === "motion")).toEqual({ name: "box", cat: "motion", ph: "X", pid: 1, tid: 2, ts: 8300, dur: 41700 });
  });

  test("a runtime's samples nest as a flame chart on its own thread, on the recording's clock", () => {
    const { traceEvents } = chromeTrace({ process: "KitchenSink", frames: { ...timeline, motion: [] }, runtimes: [{ runtime: "shared", profile: profile(), startUs: 999_000 }, { runtime: "ks-devtools", profile: profile(), startUs: 1_000_000 }] });
    expect(traceEvents.filter(event => event.name === "thread_name").map(event => event.args!.name)).toEqual(["Main thread (display-link frames)", "Compositor (motion)", "JavaScript (shared runtime)", "JavaScript (isolated runtime: ks-devtools)"]);
    const shared = traceEvents.filter(event => event.tid === 10 && event.ph === "X").map(event => [event.name, event.ts, event.dur]);
    // main and work hold from the first sample to the idle sample; fib for two samples; [root] is never a slice.
    expect(shared).toEqual([["fib", 1000, 2000], ["work", 1000, 3000], ["main", 1000, 3000], ["(idle)", 4000, 1000]]);
    expect(traceEvents.find(event => event.tid === 11 && event.name === "fib")).toMatchObject({ ts: 0, dur: 2000, args: { url: BUNDLE, line: 31, column: 8 } });
  });
});

describe("symbolicate", () => {
  const mapped = (stack: { file: string; lineNumber: number; column: number; methodName: string }[]) =>
    stack.map(item => item.methodName === "work" ? { file: item.file, lineNumber: null, column: null } : { file: `/src/${item.methodName}.ts`, lineNumber: item.lineNumber + 100, column: item.column + 1 });
  test("each distinct bundle frame goes to the development server once and comes back with its source, lines and columns from 0", async () => {
    const requests: unknown[] = [];
    const post: Post = async (url, body) => { const { stack } = JSON.parse(body); requests.push([url, stack]); return { ok: true, status: 200, json: async () => ({ stack: mapped(stack) }) }; };
    const result = await symbolicate(profile(), "http://127.0.0.1:8081/", post);
    expect(requests).toEqual([["http://127.0.0.1:8081/symbolicate", [
      { file: BUNDLE, lineNumber: 10, column: 4, methodName: "main" }, { file: BUNDLE, lineNumber: 20, column: 2, methodName: "work" }, { file: BUNDLE, lineNumber: 30, column: 6, methodName: "fib" },
    ]]]);
    expect(result.sourceMaps).toBe("applied");
    expect(result.profile.nodes.map(node => [node.callFrame.functionName, node.callFrame.url, node.callFrame.lineNumber, node.callFrame.columnNumber])).toEqual([
      // A position the source maps do not cover (work) keeps its place in the bundle, from 0.
      ["[root]", "[root]", 0, 0], ["main", "/src/main.ts", 109, 5], ["work", BUNDLE, 19, 2], ["fib", "/src/fib.ts", 129, 7], ["(idle)", "", 0, 0],
    ]);
  });

  test("without a server or a usable answer the profile keeps its bundle positions and says why", async () => {
    const fails = (answer: () => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>): Post => () => answer();
    const lines = (result: { profile: CpuProfile }) => result.profile.nodes.map(node => node.callFrame.lineNumber);
    expect(await symbolicate(profile(), undefined, fails(async () => { throw new Error("unreachable"); }))).toMatchObject({ sourceMaps: "unavailable", reason: "the JavaScript did not come from a development server" });
    expect(await symbolicate(profile(), "http://s/", fails(async () => ({ ok: false, status: 500, json: async () => ({}) })))).toMatchObject({ sourceMaps: "unavailable", reason: "http://s/symbolicate answered 500" });
    expect(await symbolicate(profile(), "http://s/", fails(async () => { throw new Error("refused"); }))).toMatchObject({ sourceMaps: "unavailable", reason: "http://s/symbolicate failed: refused" });
    const short = await symbolicate(profile(), "http://s/", fails(async () => ({ ok: true, status: 200, json: async () => ({ stack: [] }) })));
    expect(short).toMatchObject({ sourceMaps: "unavailable", reason: "http://s/symbolicate answered with another stack" });
    expect(lines(short)).toEqual([0, 9, 19, 29, 0]);
  });

  test("a profile with no bundle frames needs no server", async () => {
    const post = vi.fn<Post>();
    const idle: CpuProfile = { ...profile(), nodes: [{ id: 1, callFrame: frame("[root]", "[root]", 0, 0) }], samples: [1], timeDeltas: [0] };
    expect(await symbolicate(idle, undefined, post)).toMatchObject({ sourceMaps: "applied" });
    expect(post).not.toHaveBeenCalled();
  });
});

describe("public API", () => {
  test("availability and errors follow the platform, the bundle and the runtime entry's installation", async () => {
    vi.resetModules();
    globals.__DEV__ = true; mocks.platform.OS = "macos";
    const api = await import("../packages/desktop-app/src/profiler");
    expect(api.getProfilerAvailability()).toEqual({ available: false, reason: "missing-module" });
    await expect(api.startProfiling()).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
    const start = vi.fn(async () => {}), stop = vi.fn(async () => ({}) as never);
    api.registerProfiler({ start, stop });
    expect(() => api.registerProfiler({ start, stop })).toThrow(expect.objectContaining({ code: "E_ALREADY_EXISTS" }));
    expect(api.getProfilerAvailability()).toEqual({ available: true });
    await api.startProfiling();
    await api.startProfiling({ samplesPerSecond: 250 });
    expect(start.mock.calls).toEqual([[1000], [250]]);
    for (const samplesPerSecond of [0, 10001, 1.5, Number.NaN]) await expect(api.startProfiling({ samplesPerSecond })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
    await expect(api.startProfiling({ interval: 1 } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
    await expect(api.startProfiling(null as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
    await expect(api.stopProfiling({ directory: "relative" })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
    await api.stopProfiling({ directory: "/tmp/profiles" });
    await api.stopProfiling();
    expect(stop.mock.calls).toEqual([["/tmp/profiles"], [undefined]]);
    globals.__DEV__ = false;
    expect(api.getProfilerAvailability()).toEqual({ available: false, reason: "development-only" });
    await expect(api.stopProfiling()).rejects.toMatchObject({ code: "E_UNAVAILABLE" });
    mocks.platform.OS = "windows";
    expect(api.getProfilerAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
    await expect(api.startProfiling()).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
    globals.__DEV__ = true; mocks.platform.OS = "macos";
  });

  test("the installed profiler collects every runtime, source-maps it, and writes the trace and a .cpuprofile per runtime", async () => {
    vi.resetModules();
    mocks.calls.length = 0;
    const frames = { frames: 4, droppedFrames: 3, maxFrameGapMs: 33.3, durationMs: 50, fps: 60, refreshRate: 120 };
    const runtimes = [{ runtime: "ks-devtools", startUs: 1_000_000, profile: JSON.stringify(profile()) }, { runtime: "shared", startUs: 1_000_000, profile: JSON.stringify(profile()) }];
    mocks.answers.set("startProfiling", null);
    mocks.answers.set("stopProfiling", { process: "KitchenSink", timeline, frames, runtimes });
    mocks.answers.set("writeProfile", { directory: "/tmp/p", paths: ["/tmp/p/a.trace.json", "/tmp/p/b.cpuprofile", "/tmp/p/c.cpuprofile"] });
    const post = vi.fn(async (_url: string, body: string) => new Response(JSON.stringify({ stack: JSON.parse(body).stack.map((item: { methodName: string }) => ({ file: `/src/${item.methodName}.ts`, lineNumber: 1, column: 0 })) })));
    vi.stubGlobal("fetch", (url: string, init: { body: string }) => post(url, init.body));
    const { installProfiler } = await import("../packages/desktop-app/src/profiler/install");
    const api = await import("../packages/desktop-app/src/profiler");
    installProfiler();
    await api.startProfiling({ samplesPerSecond: 100 });
    const result = await api.stopProfiling({ directory: "/tmp/p" });
    vi.unstubAllGlobals();
    expect(mocks.calls.map(([method]) => method)).toEqual(["startProfiling", "stopProfiling", "writeProfile"]);
    expect(mocks.calls[0]![1]).toEqual({ samplesPerSecond: 100 });
    expect(mocks.calls[1]![1]).toEqual({ directory: "/tmp/p" });
    const { directory, files } = mocks.calls[2]![1] as { directory: string; files: { name: string; contents: string }[] };
    expect(directory).toBe("/tmp/p");
    // The shared runtime first; every name starts with the marker the release-safety probe looks for.
    expect(files.map(file => file.name)).toEqual([
      expect.stringMatching(/^spark-profiler-\d{8}-\d{6}\.trace\.json$/), expect.stringMatching(/^spark-profiler-\d{8}-\d{6}-shared\.cpuprofile$/), expect.stringMatching(/^spark-profiler-\d{8}-\d{6}-isolated-ks-devtools\.cpuprofile$/),
    ]);
    expect(post).toHaveBeenCalledTimes(2);
    expect(JSON.parse(files[1]!.contents).nodes[3].callFrame).toMatchObject({ url: "/src/fib.ts", lineNumber: 0 });
    expect(JSON.parse(files[0]!.contents).traceEvents.filter((event: { name: string }) => event.name === "thread_name").map((event: { args: { name: string } }) => event.args.name))
      .toEqual(["Main thread (display-link frames)", "Compositor (motion)", "JavaScript (shared runtime)", "JavaScript (isolated runtime: ks-devtools)"]);
    expect(result).toEqual({
      directory: "/tmp/p", trace: "/tmp/p/a.trace.json", frames, motions: 1, truncated: false,
      profiles: [{ runtime: "shared", path: "/tmp/p/b.cpuprofile", samples: 4, sourceMaps: "applied" }, { runtime: { isolated: "ks-devtools" }, path: "/tmp/p/c.cpuprofile", samples: 4, sourceMaps: "applied" }],
    });
  });
});
