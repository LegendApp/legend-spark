// bun scripts/test-devtools.ts — React Native DevTools against a real development session, headless (docs/devtools.md).
// Build first: cd examples/kitchen-sink && bun run rebuild:macos. Starts `spark dev --no-open` for the Kitchen Sink
// (Expo's Metro with React Native's inspector proxy), launches the dev build in driver mode (no window, no focus)
// with its JavaScript from that server, then checks the debug targets at /json/list and drives them over CDP.
// The DevTools frontend is never opened: CHROME_PATH points React Native's browser launcher at a recorder.
import assert from "node:assert/strict";
import { chmodSync, closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { availablePort } from "../packages/cli/src/local.ts";
import { processLog, spawnProcess } from "../packages/cli/src/process.ts";
import { readJson, stateFile } from "../packages/cli/src/project.ts";
import type { Driver } from "./e2e/driver.ts";
import { KITCHEN_SINK, KitchenSinkApp } from "./e2e/kitchen-sink.ts";

type Target = { id: string; title: string; description: string; appId: string; webSocketDebuggerUrl: string; devtoolsFrontendUrl: string; reactNative: { logicalDeviceId: string; capabilities: Record<string, unknown> } };
type Message = { id?: number; method?: string; params?: any; result?: any; error?: { message: string } };

const root = path.resolve(import.meta.dirname, "..");
const work = mkdtempSync(path.join(os.tmpdir(), "ks-devtools-"));
const sessionLog = path.join(work, "spark-dev.log"), appLog = path.join(work, "app.log"), launches = path.join(work, "launches.txt");
const chrome = path.join(work, "chrome");
writeFileSync(chrome, `#!/bin/sh\nprintf '%s\\n' "$@" >> '${launches}'\n`);
chmodSync(chrome, 0o755);
const port = await availablePort();
const base = `http://127.0.0.1:${port}`;
const app = new KitchenSinkApp(undefined, new URL(base));
const { app: bundle, bundleId } = await app.open();
const name = readFileSync(path.join(bundle, "Contents/Info.plist"), "utf8").match(/<key>CFBundleName<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
assert.ok(name, "CFBundleName");
const SHARED = `${name} (shared runtime)`, WORKER = `${name} (isolated runtime: ks-devtools)`;
const probeSource = readFileSync(path.join(KITCHEN_SINK, "screens/devtools/probe.ts"), "utf8");
// Fast Refresh edits a module that is its own refresh boundary, so the screen keeps its worker runtime.
const markerFile = path.join(KITCHEN_SINK, "screens/devtools/FastRefreshMarker.tsx");
const markerSource = readFileSync(markerFile, "utf8");
const log = openSync(sessionLog, "a");
const session = spawnProcess([process.execPath, path.join(root, "scripts/spark.mjs"), "dev", "--platform", "macos", "--no-open", "--port", String(port), "--max-workers", "2"], {
  cwd: KITCHEN_SINK, env: { ...process.env, CI: "false", CHROME_PATH: chrome }, stdin: "ignore", stdout: log, stderr: log,
});
let driver: Driver | undefined;
let debuggerEvents: Message[] = [];
const sockets: WebSocket[] = [];
// Interrupted: stop the session too (the driven app quits when its driver connection closes).
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { session.kill("SIGTERM"); void session.exited.then(() => process.exit(130)); });

async function until<T>(check: () => Promise<T | undefined | false>, label: string, timeout = 60000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (session.exitCode !== null) throw new Error(`spark dev exited (${session.exitCode}). See ${sessionLog}`);
    const value = await check().catch(() => undefined);
    if (value) return value;
    await sleep(200);
  }
  throw new Error(`Timed out: ${label}`);
}
const targets = async () => (await (await fetch(`${base}/json/list`)).json() as Target[]).filter(target => target.appId === bundleId);
const target = (title: string) => until(async () => (await targets()).find(item => item.title === title), `debug target "${title}" at /json/list`);
const pass = (message: string) => console.log(`PASS ${message}`);

/** A CDP client for one debug target: requests by id, plus every event it has received. */
async function connect(item: Target) {
  const socket = new WebSocket(item.webSocketDebuggerUrl);
  sockets.push(socket);
  const events: Message[] = [];
  const pending = new Map<number, (message: Message) => void>();
  const state: { closed?: string } = {};
  socket.onclose = event => { state.closed = `${event.code} ${event.reason}`; for (const resolve of pending.values()) resolve({ error: { message: `the session closed (${state.closed})` } }); };
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data)) as Message;
    if (message.id !== undefined) pending.get(message.id)?.(message);
    else events.push(message);
  };
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error(`Could not connect to ${item.webSocketDebuggerUrl}`)); });
  let next = 0;
  const send = (method: string, params: object = {}) => new Promise<any>((resolve, reject) => {
    if (state.closed) { reject(new Error(`${method}: the session closed (${state.closed})`)); return; }
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`No CDP reply to ${method} within 30 s`)); }, 30000);
    pending.set(id, message => { clearTimeout(timer); pending.delete(id); message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result); });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const event = (method: string, match: (params: any) => boolean = () => true, timeout = 20000) =>
    until(async () => events.find(message => message.method === method && match(message.params))?.params, `CDP ${method}`, timeout);
  const evaluate = async (expression: string) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, returnByValue: true });
    if (exceptionDetails) throw new Error(`${expression}: ${JSON.stringify(exceptionDetails.exception?.description ?? exceptionDetails.text)}`);
    return result.value;
  };
  // Hermes's awaitPromise does not await React Native's Promise polyfill, so a promise reports into a global.
  const settle = async (expression: string) => {
    const key = `__ksDevToolsResult${++next}`;
    await evaluate(`(${expression}).then(value => { globalThis.${key} = { value }; }, error => { globalThis.${key} = { error: error.code ?? String(error) }; }), 0`);
    return until(async () => await evaluate(`globalThis.${key}`), `${expression} settles`, 30000) as Promise<{ value?: unknown; error?: string }>;
  };
  return { send, event, evaluate, settle, events, state };
}

// Source map v3: generated [line, column] <-> [source, line] for the probe module (lines and columns from 0).
function sourceMap(map: { sources: string[]; mappings: string }) {
  const digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const segments: { line: number; column: number; source: number; sourceLine: number }[] = [];
  let source = 0, sourceLine = 0, sourceColumn = 0;
  map.mappings.split(";").forEach((text, line) => {
    let column = 0;
    for (const segment of text.split(",").filter(Boolean)) {
      const values: number[] = [];
      for (let i = 0, value = 0, shift = 0; i < segment.length; i++) {
        const digit = digits.indexOf(segment[i]!);
        value += (digit & 31) << shift;
        if (digit & 32) { shift += 5; continue; }
        values.push(value & 1 ? -(value >>> 1) : value >>> 1); value = 0; shift = 0;
      }
      column += values[0]!;
      if (values.length < 4) continue;
      source += values[1]!; sourceLine += values[2]!; sourceColumn += values[3]!;
      segments.push({ line, column, source, sourceLine });
    }
  });
  return {
    generated(file: string, line: number) { return segments.find(item => map.sources[item.source]!.endsWith(file) && item.sourceLine === line); },
    original(line: number, column: number) {
      const item = segments.filter(entry => entry.line === line && entry.column <= column).at(-1);
      return item && { source: map.sources[item.source]!, line: item.sourceLine };
    },
  };
}

try {
  await until(async () => existsSync(stateFile(KITCHEN_SINK, "session.json")) && readJson(stateFile(KITCHEN_SINK, "session.json")).port === port && (await fetch(`${base}/status`)).ok, "spark dev ready", 120000);
  const sessionState = readJson(stateFile(KITCHEN_SINK, "session.json"));
  assert.equal(sessionState.compatible, true, `The dev build is not compatible with this session: ${sessionState.reason}`);
  driver = await app.launch({ log: processLog(appLog) });

  // 1. Each runtime is its own named target: the shared runtime at launch, the worker once the DevTools screen runs.
  const shared = await target(SHARED);
  assert.equal(shared.reactNative.capabilities.nativePageReloads, true);
  assert.equal(shared.reactNative.capabilities.prefersFuseboxFrontend, true);
  await driver.navigate("spark-ks://devtools/devtools");
  await driver.waitFor("devtools-devtools-worker-running", 60000);
  const worker = await target(WORKER);
  const listed = (await targets()).map(item => item.title).sort();
  assert.deepEqual(listed, [SHARED, WORKER].sort());
  pass(`/json/list lists ${JSON.stringify(listed)} for ${bundleId}`);

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
  await driver.quit();
  driver = undefined;
} catch (error) {
  const pauses = debuggerEvents.filter(message => message.method === "Debugger.paused" || message.method === "Debugger.resumed");
  console.error(`Shared runtime debugger events: ${JSON.stringify(pauses.map(message => message.method === "Debugger.paused" ? `paused(${message.params.reason}: ${message.params.callFrames?.[0]?.functionName}) ${JSON.stringify(message.params.data?.description ?? "").slice(0, 120)}` : "resumed"))}`);
  for (const [label, file] of [["spark dev", sessionLog], ["App", appLog]] as const)
    if (existsSync(file)) console.error(`${label} log (last 40 lines):\n${readFileSync(file, "utf8").split("\n").slice(-40).join("\n")}`);
  throw error;
} finally {
  for (const socket of sockets) socket.close();
  await driver?.close();
  await app.close();
  session.kill("SIGTERM");
  await session.exited;
  closeSync(log);
  if (readFileSync(markerFile, "utf8") !== markerSource) writeFileSync(markerFile, markerSource);
  rmSync(work, { recursive: true, force: true });
}
