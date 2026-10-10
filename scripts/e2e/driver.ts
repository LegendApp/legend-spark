// Client for the Spark in-app test driver (docs/test-driver.md).
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, watch, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnProcess, type ManagedProcess, type ProcessLog } from "../../packages/cli/src/process.ts";

export type DriverWindow = "main" | "key" | `id:${string}` | `title:${string}`;
export type Frame = { x: number; y: number; width: number; height: number };
export type Capture = { file: string; width: number; height: number; scale: number };
export type LaunchOptions = { executable: string; args?: string[]; env?: Record<string, string>; log?: ProcessLog; startTimeoutMs?: number };
type Reply = { id?: unknown; ok: boolean; error?: { code: string; message: string }; [key: string]: unknown };

export class DriverError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); }
}

/** Launches an app in driver mode: a private run directory, a one-time token file, and the socket the app creates there. */
export async function launchDriver(options: LaunchOptions): Promise<Driver> {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-driver-")); // mkdtemp creates it 0700.
  const socket = path.join(directory, "driver.sock");
  if (Buffer.byteLength(socket) >= 104) throw new Error(`Driver socket path is too long for a Unix socket: ${socket}`);
  const token = randomBytes(32).toString("hex");
  writeFileSync(path.join(directory, "token"), token, { mode: 0o600, flag: "wx" });
  const app = spawnProcess([options.executable, ...(options.args ?? [])], {
    env: { ...process.env, ...options.env, SPARK_TEST_DRIVER_DIR: directory },
    stdout: options.log ?? "inherit", stderr: options.log ?? "inherit",
  });
  try {
    await socketReady(socket, app, options.startTimeoutMs ?? 30000);
    const connection = await new Promise<net.Socket>((resolve, reject) => {
      const client = net.createConnection(socket, () => { client.off("error", reject); resolve(client); });
      client.once("error", reject);
    });
    const driver = new Driver(connection, app, directory);
    await driver.request({ token }, 10000);
    return driver;
  } catch (error) {
    app.kill(); await app.exited;
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function socketReady(socket: string, app: ManagedProcess, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const watcher = watch(path.dirname(socket));
    const timer = setTimeout(() => finish(new Error(`The app did not start its driver within ${timeoutMs} ms`)), timeoutMs);
    function finish(error?: Error) { watcher.close(); clearTimeout(timer); error ? reject(error) : resolve(); }
    watcher.on("change", () => { if (existsSync(socket)) finish(); });
    watcher.on("error", finish);
    app.exited.then(code => finish(new Error(`The app exited (${code}) before its driver started`)));
    if (existsSync(socket)) finish();
  });
}

/** One authenticated session; requests run one at a time. Quitting or disconnecting quits the app. */
export class Driver {
  private buffer = "";
  private waiting?: { resolve: (reply: Reply) => void; reject: (error: Error) => void };
  private queue: Promise<unknown> = Promise.resolve();
  private failure?: Error;
  private nextId = 0;

  constructor(private readonly socket: net.Socket, readonly app: ManagedProcess, readonly directory: string) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      for (let end = this.buffer.indexOf("\n"); end >= 0; end = this.buffer.indexOf("\n")) {
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        const waiting = this.waiting;
        this.waiting = undefined;
        if (!waiting) { this.fail(new Error(`Unexpected driver message: ${line}`)); return; }
        try { waiting.resolve(JSON.parse(line)); } catch { waiting.reject(new Error(`Invalid driver message: ${line}`)); }
      }
    });
    socket.on("error", error => this.fail(error));
    socket.on("close", () => this.fail(new Error("The driver closed the connection")));
  }

  private fail(error: Error) {
    this.failure ??= error;
    this.waiting?.reject(error);
    this.waiting = undefined;
  }

  /** Sends one message and resolves with its successful reply. `limitMs` guards against a hung app. */
  request(message: Record<string, unknown>, limitMs: number): Promise<Reply> {
    const exchange = async () => {
      if (this.failure) throw this.failure;
      const id = "token" in message ? undefined : ++this.nextId;
      const reply = await new Promise<Reply>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`No driver reply within ${limitMs} ms to ${JSON.stringify(message.command)}`)), limitMs);
        this.waiting = { resolve: reply => { clearTimeout(timer); resolve(reply); }, reject: error => { clearTimeout(timer); reject(error); } };
        this.socket.write(`${JSON.stringify(id === undefined ? message : { ...message, id })}\n`);
      });
      if (id !== undefined && reply.id !== id) throw new Error(`Driver reply ${JSON.stringify(reply.id)} does not answer request ${id}`);
      if (!reply.ok) throw new DriverError(reply.error?.code ?? "E_DRIVER", reply.error?.message ?? "Request failed");
      return reply;
    };
    const result = this.queue.then(exchange);
    this.queue = result.catch(() => undefined);
    return result;
  }

  async ping() { await this.request({ command: "ping" }, 10000); }
  /** Delivers a deep link through the app's URL handling once its first render has settled. */
  async navigate(url: string, timeoutMs = 30000) { await this.request({ command: "navigate", url, timeoutMs }, timeoutMs + 10000); }
  /** Waits for a visible view whose accessibility identifier (React Native testID) matches. */
  async waitFor(testID: string, timeoutMs = 10000) {
    const reply = await this.request({ command: "waitFor", testID, timeoutMs }, timeoutMs + 10000);
    return { window: reply.window as string, frame: reply.frame as Frame };
  }
  /** Sets the app-level appearance (not the OS setting) and waits for the UI to re-render. */
  async setAppAppearance(appearance: "light" | "dark", timeoutMs = 10000) {
    return { changed: (await this.request({ command: "setAppAppearance", appearance, timeoutMs }, timeoutMs + 10000)).changed as boolean };
  }
  /** Renders a window in-process to `<run directory>/<name>.png` once mounted UI updates settle. */
  async capture(window: DriverWindow, name: string, timeoutMs = 5000): Promise<Capture> {
    const reply = await this.request({ command: "capture", window, name, timeoutMs }, timeoutMs + 10000);
    return { file: path.join(this.directory, reply.file as string), width: reply.width as number, height: reply.height as number, scale: reply.scale as number };
  }
  /** Ends the session; the app quits through its normal termination path. */
  async quit(timeoutMs = 15000) {
    await this.request({ command: "quit" }, 10000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const exited = await Promise.race([this.app.exited.then(() => true), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })]);
    clearTimeout(timer);
    if (!exited) { this.app.kill("SIGKILL"); await this.app.exited; throw new Error(`The app did not quit within ${timeoutMs} ms`); }
  }
  /** Kills the app if it is still running and removes the run directory, including captures. */
  async close() {
    this.socket.destroy();
    if (this.app.exitCode === null && this.app.signalCode === null) { this.app.kill(); await this.app.exited; }
    rmSync(this.directory, { recursive: true, force: true });
  }
}
