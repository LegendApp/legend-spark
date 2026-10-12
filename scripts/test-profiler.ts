// bun scripts/test-profiler.ts — profiling against a real development session, headless (docs/devtools.md#profiling).
// Build first: cd examples/kitchen-sink && bun run rebuild:macos. Starts a development session
// (scripts/testing/dev-session.ts) on the Kitchen Sink's Profiling screen, whose worker runtime runs too, and checks:
// React Native DevTools' Profiler, Tracing (Performance panel) and HeapProfiler (Memory panel) domains on each runtime's
// target over CDP, then startProfiling/stopProfiling: the Chrome trace and the source-mapped .cpuprofile of each
// runtime, written only into a temporary directory. Frame and motion checks need a display that is awake: the display
// link delivers no frames while it sleeps, which the script reports instead of failing.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProfilingResult } from "../packages/desktop-app/src/profiler.ts";
import type { ChromeTrace, CpuProfile } from "../packages/desktop-app/src/profiler/trace.ts";
import { KITCHEN_SINK } from "./e2e/kitchen-sink.ts";
import { startDevSession, type Cdp } from "./testing/dev-session.ts";
import { sourceMap } from "./testing/source-map.ts";

const dev = await startDevSession({ prefix: "ks-profiler-" });
const output = mkdtempSync(path.join(os.tmpdir(), "ks-profiler-output-"));
const pass = (message: string) => console.log(`PASS ${message}`);
const WORKLOAD = "screens/devtools/profiling-workload.ts";
// fibonacci's lines (from 0): its declaration through its closing brace.
const source = readFileSync(path.join(KITCHEN_SINK, WORKLOAD), "utf8").split("\n");
const from = source.findIndex(line => line.startsWith("function fibonacci"));
const fibonacci = { from, to: source.indexOf("}", from) };
// Each runtime builds its own marker from the tag (screens/devtools/profiling-demo.ts, devtools-tasks.ts), so only its heap holds it.
const tag = Date.now().toString(36), markers = { shared: `ks-heap-shared:${tag}`, worker: `ks-heap-worker:${tag}` };
let defaultDirectory: string | undefined;

/** The bundle's source map, from the target's Debugger.scriptParsed (as the DevTools frontend loads it). */
async function bundleMap(cdp: Cdp, bundle: RegExp) {
  await cdp.send("Debugger.enable");
  const script = await cdp.event("Debugger.scriptParsed", params => bundle.test(String(params.url)) && !!params.sourceMapURL);
  const map = sourceMap(await (await fetch(new URL(script.sourceMapURL, script.url).href)).json());
  await cdp.send("Debugger.disable");
  return map;
}
/** fibonacci's frames in a Hermes profile (lines and columns from 1) mapped through the source map: each must land in its body. */
function fibonacciFrames(profile: CpuProfile, map: ReturnType<typeof sourceMap>) {
  const frames = profile.nodes.filter(node => node.callFrame.functionName === "fibonacci").map(node => map.original(node.callFrame.lineNumber - 1, node.callFrame.columnNumber - 1));
  assert.ok(frames.length > 0, "the profile has fibonacci frames");
  for (const frame of frames) assert.ok(frame?.source.endsWith(WORKLOAD) && frame.line >= fibonacci.from && frame.line <= fibonacci.to, `fibonacci maps into ${WORKLOAD}: ${JSON.stringify(frame)}`);
  return frames.length;
}
/** Chunks of a heap snapshot (HeapProfiler.addHeapSnapshotChunk) since `mark`. */
const snapshot = (cdp: Cdp, mark: number) => cdp.events.slice(mark).filter(message => message.method === "HeapProfiler.addHeapSnapshotChunk").map(message => message.params.chunk).join("");

try {
  const { driver, name } = await dev.launch();
  await driver.navigate("spark-ks://devtools/profiling");
  await driver.waitFor("devtools-profiling-worker-running", 60000);
  const sharedTarget = await dev.target(`${name} (shared runtime)`), workerTarget = await dev.target(`${name} (isolated runtime: ks-devtools)`);

  // 1. DevTools on the shared runtime: the JavaScript profiler, the Performance panel's tracing, the Memory panel.
  let cdp = await dev.connect(sharedTarget);
  await cdp.send("Runtime.enable");
  const sharedMap = await bundleMap(cdp, /\/index\.bundle/);
  await cdp.send("Profiler.start");
  await cdp.evaluate("ksProfiling.workload(300)");
  const { profile } = await cdp.send("Profiler.stop") as { profile: CpuProfile };
  pass(`DevTools Profiler (shared runtime): ${profile.samples.length} samples; ${fibonacciFrames(profile, sharedMap)} fibonacci frames map into ${WORKLOAD} through the bundle's source map`);

  await cdp.send("Tracing.start", {});
  await cdp.evaluate("ksProfiling.workload(300)");
  await cdp.send("Tracing.end");
  await cdp.event("Tracing.tracingComplete");
  const traced = cdp.events.filter(message => message.method === "Tracing.dataCollected").flatMap(message => message.params.value as { name: string; args?: { data?: { cpuProfile?: { nodes?: { callFrame: { functionName: string } }[] } } } }[]);
  const chunks = traced.filter(event => event.name === "ProfileChunk");
  assert.ok(chunks.some(event => event.args?.data?.cpuProfile?.nodes?.some(node => node.callFrame.functionName === "fibonacci")), "the Performance panel's trace samples fibonacci");
  pass(`DevTools Performance panel (Tracing.start/end): ${traced.length} trace events, ${chunks.length} ProfileChunk events with fibonacci samples`);

  assert.equal(await cdp.evaluate(`ksProfiling.allocate(${JSON.stringify(tag)})`), markers.shared);
  assert.deepEqual(await cdp.settle(`ksProfiling.workerAllocate(${JSON.stringify(tag)})`), { value: true });
  let mark = cdp.events.length;
  await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
  const sharedHeap = snapshot(cdp, mark);
  assert.ok(sharedHeap.includes(markers.shared) && !sharedHeap.includes(markers.worker), "the shared runtime's snapshot holds its own marker only");
  JSON.parse(sharedHeap);
  mark = cdp.events.length;
  await cdp.send("HeapProfiler.startTrackingHeapObjects", { trackAllocations: true });
  await cdp.evaluate(`ksProfiling.allocate(${JSON.stringify(`${tag}-tracked`)})`);
  await cdp.send("HeapProfiler.stopTrackingHeapObjects", { reportProgress: false });
  const tracked = JSON.parse(snapshot(cdp, mark)) as { trace_function_infos: unknown[]; samples: unknown[] };
  const updates = cdp.events.slice(mark).filter(message => message.method === "HeapProfiler.heapStatsUpdate").length;
  assert.ok(tracked.trace_function_infos.length > 0 && tracked.samples.length > 0 && updates > 0, "the allocation timeline has allocation stacks, samples and heap stats");
  await cdp.send("HeapProfiler.startSampling", { samplingInterval: 1024 });
  await cdp.evaluate(`ksProfiling.allocate(${JSON.stringify(`${tag}-sampled`)})`);
  const { profile: sampled } = await cdp.send("HeapProfiler.stopSampling") as { profile: { head: { children: unknown[] }; samples: unknown[] } };
  assert.ok(sampled.head.children.length > 0 && sampled.samples.length > 0, "allocation sampling has a call tree and samples");
  pass(`DevTools Memory (shared runtime): a ${(sharedHeap.length / 1e6).toFixed(1)} MB snapshot with ${markers.shared} and not the worker's marker; an allocation timeline (${tracked.trace_function_infos.length} functions, ${updates} heap stats updates); allocation sampling (${sampled.samples.length} samples)`);

  // 2. DevTools on the worker runtime (React Native 0.81 keeps one debugger per app process: this closes the shared session).
  const worker = await dev.connect(workerTarget);
  await worker.send("Runtime.enable");
  const workerMap = await bundleMap(worker, /\/\.threaded-runtime\/entry\.bundle/);
  await worker.send("Profiler.start");
  await driver.tap({ testID: "devtools-profiling-worker-workload" });
  await new Promise(resolve => setTimeout(resolve, 800));
  const { profile: workerProfile } = await worker.send("Profiler.stop") as { profile: CpuProfile };
  pass(`DevTools Profiler (worker runtime ks-devtools): ${workerProfile.samples.length} samples; ${fibonacciFrames(workerProfile, workerMap)} fibonacci frames map into ${WORKLOAD} through the worker bundle's source map`);
  mark = worker.events.length;
  await worker.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
  const workerHeap = snapshot(worker, mark);
  assert.ok(workerHeap.includes(markers.worker) && !workerHeap.includes(markers.shared), "the worker's snapshot holds its own marker only");
  pass(`DevTools Memory (worker runtime): a ${(workerHeap.length / 1e6).toFixed(1)} MB snapshot with ${markers.worker} and not the shared runtime's marker`);
  worker.close();

  // 3. startProfiling/stopProfiling: every runtime's samples and the frame timeline, written only where asked.
  cdp = await dev.connect(sharedTarget);
  await cdp.send("Runtime.enable");
  assert.deepEqual(await cdp.evaluate("ksProfiling.availability()"), { available: true });
  assert.deepEqual(await cdp.settle("ksProfiling.start({ samplesPerSecond: 0 })"), { error: "E_INVALID_ARGUMENT" });
  assert.deepEqual(await cdp.settle("ksProfiling.start({ interval: 1 })"), { error: "E_UNSUPPORTED_OPTION" });
  assert.deepEqual(await cdp.settle("ksProfiling.stop()"), { error: "E_NOT_FOUND" });
  assert.deepEqual(await cdp.settle("ksProfiling.recording()"), { value: false });
  assert.deepEqual(await cdp.settle("ksProfiling.start()"), {});
  assert.deepEqual(await cdp.settle("ksProfiling.recording()"), { value: true });
  // The screen follows the recording it did not start.
  await driver.waitFor("devtools-profiling-recording-recording", 10000);
  assert.deepEqual(await cdp.settle("ksProfiling.start()"), { error: "E_BUSY" });
  await cdp.evaluate("ksProfiling.workload(300)");
  await driver.tap({ testID: "devtools-profiling-worker-workload" });
  await driver.tap({ testID: "devtools-profiling-animate" });
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.deepEqual(await cdp.settle(`ksProfiling.stop({ directory: ${JSON.stringify(path.join(output, "absent"))} })`), { error: "E_NOT_FOUND" });
  assert.deepEqual(await cdp.settle("ksProfiling.stop({ directory: 'relative' })"), { error: "E_INVALID_ARGUMENT" });
  const stopped = await cdp.settle(`ksProfiling.stop({ directory: ${JSON.stringify(output)} })`);
  assert.equal(stopped.error, undefined, `stopProfiling: ${stopped.error}`);
  const result = stopped.value as ProfilingResult;
  assert.deepEqual(readdirSync(output).sort(), [result.trace, ...result.profiles.map(item => item.path)].map(file => path.basename(file)).sort());
  assert.ok([result.trace, ...result.profiles.map(item => item.path)].every(file => path.dirname(file) === output), "every file is in the directory asked for");
  pass(`invalid options reject (E_INVALID_ARGUMENT, E_UNSUPPORTED_OPTION), stop without a recording E_NOT_FOUND, a second start E_BUSY, a missing directory E_NOT_FOUND (still recording); stop wrote ${readdirSync(output).length} files, all in ${output}`);

  assert.deepEqual(await cdp.settle("ksProfiling.recording()"), { value: false });
  await driver.waitFor("devtools-profiling-recording-idle", 10000);
  assert.deepEqual(result.profiles.map(item => item.runtime), ["shared", { isolated: "ks-devtools" }]);
  assert.deepEqual(result.missing, []);
  for (const item of result.profiles) {
    assert.equal(item.sourceMaps, "applied", `${JSON.stringify(item.runtime)}: ${"reason" in item ? item.reason : ""}`);
    const written = JSON.parse(readFileSync(item.path, "utf8")) as CpuProfile;
    assert.equal(written.samples.length, item.samples);
    const frames = written.nodes.filter(node => node.callFrame.functionName === "fibonacci").map(node => node.callFrame);
    assert.ok(frames.length && frames.every(frame => frame.url.endsWith(WORKLOAD) && frame.lineNumber >= fibonacci.from && frame.lineNumber <= fibonacci.to), `${item.path}: fibonacci is source-mapped (${JSON.stringify(frames[0])})`);
  }
  pass(`profiles: ${result.profiles.map(item => `${JSON.stringify(item.runtime)} ${item.samples} samples`).join(", ")}; fibonacci frames name ${WORKLOAD} at lines ${fibonacci.from + 1}-${fibonacci.to + 1}`);

  const trace = JSON.parse(readFileSync(result.trace, "utf8")) as ChromeTrace;
  const threads = Object.fromEntries(trace.traceEvents.filter(event => event.name === "thread_name").map(event => [event.args!.name, event.tid]));
  assert.deepEqual(Object.keys(threads).sort(), ["Compositor (motion)", "JavaScript (isolated runtime: ks-devtools)", "JavaScript (shared runtime)", "Main thread (display-link frames)"]);
  for (const runtime of ["JavaScript (shared runtime)", "JavaScript (isolated runtime: ks-devtools)"]) {
    const slices = trace.traceEvents.filter(event => event.tid === threads[runtime] && event.name === "fibonacci");
    assert.ok(slices.length > 0 && slices.every(event => String(event.args?.url).endsWith(WORKLOAD) && event.ts >= 0 && event.dur! > 0), `${runtime} has fibonacci slices`);
  }
  pass(`trace: ${trace.traceEvents.length} events on ${Object.keys(threads).length} threads; each runtime's thread has source-mapped fibonacci slices`);

  const frameEvents = trace.traceEvents.filter(event => event.tid === threads["Main thread (display-link frames)"] && event.ph === "X");
  const motion = trace.traceEvents.filter(event => event.tid === threads["Compositor (motion)"] && event.ph === "X");
  if (result.frames.frames < 2) console.log(`SKIP frames: the display link delivered ${result.frames.frames} frames (is the display asleep?), so the frame timeline and motion are not checked`);
  else {
    assert.equal(frameEvents.length, result.frames.frames - 1);
    assert.equal(frameEvents.reduce((dropped, event) => dropped + ((event.args?.dropped as number) ?? 0), 0), result.frames.droppedFrames);
    assert.ok(motion.some(event => event.name === "devtools-profiling-box" && event.dur! > 400_000), `the box's 600 ms slide is on the compositor track: ${JSON.stringify(motion)}`);
    pass(`frame timeline: ${result.frames.frames} frames at ${result.frames.refreshRate} Hz (${result.frames.droppedFrames} dropped) as ${frameEvents.length} main-thread slices; ${motion.length} motion slice(s), the box's slide included`);
  }

  // 4. Without a directory the files go to a new temporary directory.
  assert.deepEqual(await cdp.settle("ksProfiling.start({ samplesPerSecond: 100 })"), {});
  const temporary = (await cdp.settle("ksProfiling.stop()")).value as ProfilingResult;
  defaultDirectory = temporary.directory;
  // The app's temporary directory (NSTemporaryDirectory) is inside the user's, per app.
  assert.ok(temporary.directory.startsWith(os.tmpdir()), `${temporary.directory} is in ${os.tmpdir()}`);
  assert.match(path.basename(temporary.directory), /^spark-profiler-/);
  assert.deepEqual(readdirSync(temporary.directory).sort(), [temporary.trace, ...temporary.profiles.map(item => item.path)].map(file => path.basename(file)).sort());
  pass(`default directory: ${temporary.directory}, a new directory in the app's temporary directory with ${readdirSync(temporary.directory).length} files`);
} catch (error) {
  dev.printLogs();
  throw error;
} finally {
  await dev.close();
  rmSync(output, { recursive: true, force: true });
  if (defaultDirectory) rmSync(defaultDirectory, { recursive: true, force: true });
  if (existsSync(output) || (defaultDirectory && existsSync(defaultDirectory))) throw new Error("the profiles this run wrote were not removed");
}
