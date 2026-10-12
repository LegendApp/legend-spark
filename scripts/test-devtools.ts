// bun scripts/test-devtools.ts — React Native DevTools against a real development session, headless (docs/devtools.md).
// Build first: cd examples/kitchen-sink && bun run rebuild:macos. Starts `spark dev --no-open` for the Kitchen Sink
// (Expo's Metro with React Native's inspector proxy), launches the dev build in driver mode (no window, no focus)
// with its JavaScript from that server, then checks the debug targets at /json/list and drives them over CDP.
// The DevTools frontend is never opened: CHROME_PATH points React Native's browser launcher at a recorder.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { KITCHEN_SINK } from "./e2e/kitchen-sink.ts";
import { startDevSession, type Message, type Target } from "./testing/dev-session.ts";
import { sourceMap } from "./testing/source-map.ts";

const recorder = mkdtempSync(path.join(os.tmpdir(), "ks-devtools-browser-"));
const launches = path.join(recorder, "launches.txt"), chrome = path.join(recorder, "chrome");
writeFileSync(chrome, `#!/bin/sh\nprintf '%s\\n' "$@" >> '${launches}'\n`);
chmodSync(chrome, 0o755);
const dev = await startDevSession({ prefix: "ks-devtools-", env: { CHROME_PATH: chrome } });
const { until, targets, target, connect } = dev;
const probeSource = readFileSync(path.join(KITCHEN_SINK, "screens/devtools/probe.ts"), "utf8");
// Fast Refresh edits a module that is its own refresh boundary, so the screen keeps its worker runtime.
const markerFile = path.join(KITCHEN_SINK, "screens/devtools/FastRefreshMarker.tsx");
const markerSource = readFileSync(markerFile, "utf8");
let debuggerEvents: Message[] = [];
let SHARED = "", WORKER = "";
const pass = (message: string) => console.log(`PASS ${message}`);

try {
  const { driver, name, launchedBundleId } = await dev.launch();
  SHARED = `${name} (shared runtime)`; WORKER = `${name} (isolated runtime: ks-devtools)`;

  // 1. Each runtime is its own named target: the shared runtime at launch, the worker once the DevTools screen runs.
  const shared = await target(SHARED);
  assert.equal(shared.reactNative.capabilities.nativePageReloads, true);
  assert.equal(shared.reactNative.capabilities.prefersFuseboxFrontend, true);
  await driver.navigate("spark-ks://devtools/devtools");
  await driver.waitFor("devtools-devtools-worker-running", 60000);
  const worker = await target(WORKER);
  const listed = (await targets()).map(item => item.title).sort();
  assert.deepEqual(listed, [SHARED, WORKER].sort());
  pass(`/json/list lists ${JSON.stringify(listed)} for ${launchedBundleId}`);

  // 2. Console, evaluation and sources with source maps on the shared runtime.
  let main = await connect(shared);
  debuggerEvents = main.events;
  await main.send("Runtime.enable");
  await main.send("Debugger.enable");
  assert.equal(await main.evaluate("1 + 2"), 3);
  assert.equal(await main.evaluate("ksDevTools.probe('cdp').runtime"), "main");
  await main.evaluate("console.log('ks-devtools-console', 42)");
  const logged = await main.event("Runtime.consoleAPICalled", params => params.args?.[0]?.value === "ks-devtools-console");
  assert.equal(logged.args[1].value, 42);
  pass("shared runtime: Runtime.evaluate and Runtime.consoleAPICalled");
  const script = await main.event("Debugger.scriptParsed", params => String(params.url).includes("/index.bundle"));
  assert.ok(script.sourceMapURL, "the bundle's Debugger.scriptParsed carries a sourceMapURL");
  const mapURL = new URL(script.sourceMapURL, script.url).href;
  const map = sourceMap(await (await fetch(mapURL)).json());
  // As on iOS, the frontend fetches source maps from the server: targets lack nativeSourceCodeFetching.
  assert.notEqual(shared.reactNative.capabilities.nativeSourceCodeFetching, true);
  const line = probeSource.split("\n").findIndex(text => text.includes("runs += 1;"));
  const generated = map.generated("screens/devtools/probe.ts", line);
  assert.ok(generated, "probe.ts is in the source map");
  pass(`sources: the bundle's source map (${mapURL.split("?")[0]}) maps screens/devtools/probe.ts:${line + 1} to bundle line ${generated.line + 1}`);

  // 3. A breakpoint set by URL pauses in probe.ts, then resumes.
  const breakpoint = await main.send("Debugger.setBreakpointByUrl", { url: script.url, lineNumber: generated.line, columnNumber: generated.column });
  assert.ok(breakpoint.breakpointId);
  const call = main.evaluate("ksDevTools.probe('breakpoint').label");
  const paused = await main.event("Debugger.paused", params => params.reason !== "exception");
  const top = paused.callFrames[0];
  assert.equal(top.location.scriptId, script.scriptId);
  const original = map.original(top.location.lineNumber, top.location.columnNumber);
  assert.ok(original?.source.endsWith("screens/devtools/probe.ts") && original.line === line, `paused at ${JSON.stringify(original)}`);
  assert.equal(top.functionName, "probe");
  await main.send("Debugger.resume");
  assert.equal(await call, "breakpoint");
  await main.send("Debugger.removeBreakpoint", { breakpointId: breakpoint.breakpointId });
  pass(`breakpoint: paused in ${top.functionName} at screens/devtools/probe.ts:${line + 1} (hitBreakpoints ${JSON.stringify(paused.hitBreakpoints)}), resumed`);

  // 5. The worker runtime is a separate target with its own heap.
  const background = await connect(worker);
  await background.send("Runtime.enable");
  assert.equal(await background.evaluate("globalThis.__THREADED_RUNTIME_ENV__.runtimeName"), "ks-devtools");
  assert.equal(await background.evaluate("typeof ksDevTools"), "undefined");
  pass("worker runtime: evaluates in the ks-devtools runtime, a separate heap");
  // React Native 0.81's inspector proxy keeps one debugger connection per app process: the worker's replaced it.
  const closed = await until(async () => main.state.closed, "the proxy closes the shared runtime's session", 10000);
  assert.match(closed, /New debugger opened/i);
  main = await connect(shared);
  await main.send("Runtime.enable");
  await main.send("Debugger.enable");
  debuggerEvents = main.events;
  assert.equal(await main.evaluate("1 + 2"), 3);
  pass(`one debugger per app process: connecting to the worker closed the shared runtime's session (${closed}); reconnecting restored it`);

  // 6. openDevTools asks the server to open DevTools for the requested runtime's target.
  const opened = async (runtime: string, item: Target) => {
    const before = existsSync(launches) ? readFileSync(launches, "utf8") : "";
    assert.deepEqual(await main.settle(`ksDevTools.openDevTools({ runtime: ${runtime} })`), {});
    const launch = await until(async () => existsSync(launches) && readFileSync(launches, "utf8").slice(before.length).split("\n").find(arg => arg.startsWith("--app=")), "the server launches the DevTools frontend");
    const page = new URL(item.webSocketDebuggerUrl).searchParams.get("page");
    assert.ok(new URL(launch.slice(6)).searchParams.get("ws")?.endsWith(`page=${page}`), `${launch} opens page ${page}`);
  };
  await opened(`"shared"`, shared);
  await opened(`{ isolated: "ks-devtools" }`, worker);
  assert.deepEqual(await main.settle(`ksDevTools.openDevTools({ runtime: { isolated: "absent" } })`), { error: "E_NOT_FOUND" });
  pass("openDevTools: the server launched the frontend for the shared and the worker target; an absent runtime rejects E_NOT_FOUND");

  // 7. Source edits (Fast Refresh) reach the running app while the session stays attached.
  const marker = `fast-refresh-${Date.now()}`;
  const contexts = main.events.filter(message => message.method === "Runtime.executionContextCreated").length;
  writeFileSync(markerFile, markerSource.replace('const REVISION = "1";', `const REVISION = "${marker}";`));
  try {
    await until(async () => (await main.evaluate("globalThis.ksDevToolsRevision")) === marker, "Fast Refresh delivers the edit");
  } finally { writeFileSync(markerFile, markerSource); }
  await until(async () => (await main.evaluate("globalThis.ksDevToolsRevision")) === "1", "Fast Refresh restores the source");
  // An edit can arrive as a full reload (#291); a request in flight while a runtime reloads gets no reply, so wait
  // until no new execution context has appeared for 3 s.
  let stable = -1, since = Date.now();
  await until(async () => {
    const count = main.events.filter(message => message.method === "Runtime.executionContextCreated").length;
    if (count !== stable) { stable = count; since = Date.now(); }
    return Date.now() - since >= 3000;
  }, "execution contexts settle after the edits");
  assert.equal(await main.evaluate("1 + 1"), 2);
  assert.equal(main.state.closed, undefined);
  const reloads = main.events.filter(message => message.method === "Runtime.executionContextCreated").length - contexts;
  pass(`source edits: both edits reached the running app and the same debugger session stayed attached (${reloads ? `delivered by ${reloads} full reload(s), not a hot update` : "hot updates"})`);

  // 7b. Pause on uncaught exceptions.
  await main.send("Debugger.setPauseOnExceptions", { state: "uncaught" });
  await main.evaluate("ksDevTools.throwUncaught()");
  const exception = await main.event("Debugger.paused", params => params.reason === "exception");
  assert.match(exception.data.description, /Kitchen Sink DevTools: an uncaught exception/);
  await main.send("Debugger.setPauseOnExceptions", { state: "none" });
  await main.send("Debugger.resume");
  pass(`pause on uncaught exceptions: paused with reason "exception" in ${exception.callFrames[0]?.functionName || "an anonymous function"}`);

  // 8. A full reload keeps the shared runtime's target and its session.
  const created = () => main.events.filter(message => message.method === "Runtime.executionContextCreated").length;
  const beforeReload = created();
  await main.send("Page.reload");
  await until(async () => created() > beforeReload, "a new execution context after the reload", 60000);
  assert.equal(await main.evaluate("1 + 1"), 2);
  assert.equal((await target(SHARED)).id, shared.id);
  pass(`reload: the shared target ${shared.id} kept its id and the same session evaluates in the reloaded runtime`);
  // Isolated runtimes are destroyed on reload. Re-registering needs the worker to start again, which it does not:
  // after a reload ThreadedRuntime.run never reaches native (#291). Reported, not asserted.
  await driver.navigate("spark-ks://devtools/devtools");
  const restarted = await driver.waitFor("devtools-devtools-worker-running", 20000).then(() => true, () => false);
  const reloadedWorker = restarted ? (await targets()).find(item => item.title === WORKER && item.id !== worker.id) : undefined;
  console.log(reloadedWorker ? `PASS reload: the worker re-registered as ${reloadedWorker.id}` : "KNOWN ISSUE #291: the worker runtime did not restart after the reload, so it has no target");
} catch (error) {
  const pauses = debuggerEvents.filter(message => message.method === "Debugger.paused" || message.method === "Debugger.resumed");
  console.error(`Shared runtime debugger events: ${JSON.stringify(pauses.map(message => message.method === "Debugger.paused" ? `paused(${message.params.reason}: ${message.params.callFrames?.[0]?.functionName}) ${JSON.stringify(message.params.data?.description ?? "").slice(0, 120)}` : "resumed"))}`);
  dev.printLogs();
  throw error;
} finally {
  await dev.close();
  if (readFileSync(markerFile, "utf8") !== markerSource) writeFileSync(markerFile, markerSource);
  rmSync(recorder, { recursive: true, force: true });
}
