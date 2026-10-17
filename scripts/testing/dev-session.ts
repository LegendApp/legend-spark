// A headless development session of the Kitchen Sink for React Native DevTools checks (scripts/test-devtools.ts,
// scripts/test-network-inspector.ts). Starts `spark dev --no-open` (Expo's Metro with React Native's inspector proxy),
// launches the dev build in driver mode (no window, no focus) with its JavaScript from that server, and talks CDP to
// the debug targets at /json/list. Build first: cd examples/kitchen-sink && bun run rebuild:macos.
import assert from "node:assert/strict";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { availablePort } from "../../packages/cli/src/local.ts";
import { processLog, spawnProcess } from "../../packages/cli/src/process.ts";
import { readJson, stateFile } from "../../packages/cli/src/project.ts";
import type { Driver } from "../e2e/driver.ts";
import { KITCHEN_SINK, KitchenSinkApp } from "../e2e/kitchen-sink.ts";

export type Target = { id: string; title: string; description: string; appId: string; webSocketDebuggerUrl: string; devtoolsFrontendUrl: string; reactNative: { logicalDeviceId: string; capabilities: Record<string, unknown> } };
export type Message = { id?: number; method?: string; params?: any; result?: any; error?: { message: string } };
export type Cdp = Awaited<ReturnType<DevSession["connect"]>>;
export type DevSession = Awaited<ReturnType<typeof startDevSession>>;

/** `env` reaches spark dev (and React Native's browser launcher); `args` are more spark dev options; `prefix` names the scratch directory. */
export async function startDevSession(options: { prefix: string; env?: Record<string, string>; args?: string[] }) {
  const work = mkdtempSync(path.join(os.tmpdir(), options.prefix));
  const sessionLog = path.join(work, "spark-dev.log"), appLog = path.join(work, "app.log");
  const port = await availablePort();
  const base = `http://127.0.0.1:${port}`;
  const app = new KitchenSinkApp(undefined, new URL(base));
  const log = openSync(sessionLog, "a");
  const session = spawnProcess([process.execPath, path.join(import.meta.dirname, "../spark.mjs"), "dev", "--platform", "macos", "--no-open", "--port", String(port), "--max-workers", "2", ...options.args ?? []], {
    cwd: KITCHEN_SINK, env: { ...process.env, CI: "false", ...options.env }, stdin: "ignore", stdout: log, stderr: log,
  });
  const sockets: WebSocket[] = [];
  let driver: Driver | undefined;
  let launchedBundleId = "";

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
  /** The launched app's debug targets: in an isolated driver session, the clone registers as its own bundle identifier. */
  const targets = async () => (await (await fetch(`${base}/json/list`)).json() as Target[]).filter(target => target.appId === launchedBundleId);
  const target = (title: string) => until(async () => (await targets()).find(item => item.title === title), `debug target "${title}" at /json/list`);

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
    return { send, event, evaluate, settle, events, state, close: () => socket.close() };
  }

  /** Opens the dev build in driver mode once spark dev is ready; `name` is its CFBundleName. */
  async function launch() {
    const launched = await app.open();
    launchedBundleId = launched.launchedBundleId;
    const name = readFileSync(path.join(launched.app, "Contents/Info.plist"), "utf8").match(/<key>CFBundleName<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
    assert.ok(name, "CFBundleName");
    await until(async () => existsSync(stateFile(KITCHEN_SINK, "session.json")) && readJson(stateFile(KITCHEN_SINK, "session.json")).port === port && (await fetch(`${base}/status`)).ok, "spark dev ready", 120000);
    const sessionState = readJson(stateFile(KITCHEN_SINK, "session.json"));
    assert.equal(sessionState.compatible, true, `The dev build is not compatible with this session: ${sessionState.reason}`);
    driver = await app.launch({ log: processLog(appLog) });
    return { driver, name, launchedBundleId };
  }

  /** Prints the last lines of the session's and the app's logs (after a failure). */
  function printLogs() {
    for (const [label, file] of [["spark dev", sessionLog], ["App", appLog]] as const)
      if (existsSync(file)) console.error(`${label} log (last 40 lines):\n${readFileSync(file, "utf8").split("\n").slice(-40).join("\n")}`);
  }

  /** Ends the driver session (the driven app quits when its connection closes) and stops spark dev. */
  async function close() {
    for (const socket of sockets) socket.close();
    if (driver?.running) await driver.quit().catch(() => undefined);
    await driver?.close();
    await app.close();
    session.kill("SIGTERM");
    await session.exited;
    closeSync(log);
    rmSync(work, { recursive: true, force: true });
  }
  // Interrupted: stop the session and end the driver session too.
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void close().finally(() => process.exit(130)); });

  return { base, work, until, targets, target, connect, launch, printLogs, close };
}
