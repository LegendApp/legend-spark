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
/**
 * What pointer input addresses: the first visible view with a testID (scrolled into view; `offset` points from its
 * top-left, else its center), or a point in waitFor frame coordinates of a window.
 */
export type InputTarget = { testID: string; offset?: { x: number; y: number } } | { point: { x: number; y: number }; window?: DriverWindow };
export type Modifier = "cmd" | "ctrl" | "option" | "shift" | "fn";
/** A `simulateSystemEvent` flow command: an event type plus the state it implies (scripts/e2e/format/commands.ts). */
export type SimulatedSystemEvent = {
  type: string; thermal?: string; lowPower?: boolean; source?: "battery" | "ac"; network?: "online" | "offline"; level?: string;
  appearance?: "light" | "dark"; automaticAppearance?: boolean; accentColor?: string; highlightColor?: string;
  increaseContrast?: boolean; reduceTransparency?: boolean; reduceMotion?: boolean; differentiateWithoutColor?: boolean; invertColors?: boolean;
};
export type MouseButton = "left" | "right" | "back" | "forward";
/** A trackpad gesture (docs/test-driver.md#input). `rotation` is AppKit's: degrees, counterclockwise positive. */
export type Gesture =
  | { kind: "magnify"; magnification: number; steps?: number }
  | { kind: "rotate"; rotation: number; steps?: number }
  | { kind: "swipe"; direction: "left" | "right" | "up" | "down" }
  | { kind: "smartMagnify" }
  | { kind: "pressure"; stage?: 1 | 2 };
/** The cursor AppKit would show (docs/test-driver.md#cursor). */
export type DriverCursor = { cursor: string; hiddenUntilMoved: boolean };
/** One entry of `elements`: a visible view with a testID, or an accessibility element, in waitFor frame coordinates. */
export type DriverElement = { key: string; parent?: string; window: string; id?: string; role?: string; label?: string; text?: string; value?: string; frame: Frame };
export type DriverWindowInfo = { id: string; title: string; key: boolean; main: boolean; frame: Frame };
/** One application menu item as AppKit holds it (`menus`). `shortcut.modifiers` are NSEventModifierFlags bits. */
export type DriverMenuItem =
  | { separator: true }
  | { separator?: undefined; title: string; id?: string; enabled: boolean; hidden: boolean; state: "on" | "off" | "mixed"; shortcut?: { key: string; modifiers: number }; toolTip?: string; alternate?: boolean; items?: DriverMenuItem[] };
/** Motion telemetry (docs/motion.md#motion-telemetry). Times are engine milliseconds; values are points, degrees, opacity and scale. */
export type MotionProperty = "opacity" | "translateX" | "translateY" | "scaleX" | "scaleY" | "rotate";
export type MotionValues = Record<MotionProperty, number>;
export type MotionInterruption = { timeMs: number; property: MotionProperty; before: { value: number; velocity: number }; after: { value: number; velocity: number } };
/** A view's latest motion: from rest to rest. `endMs` is null while an animation repeats forever; `afterInput` once it started or was interrupted after the last driver input. */
export type Motion = {
  startMs: number; endMs: number | null; latestMs: number; settled: boolean; progress: number | null; afterInput: boolean; startValues: MotionValues;
  properties: MotionProperty[]; kinds: Partial<Record<MotionProperty, "spring" | "timing" | "keyframes" | "decay" | "sequence">>; interruptions: MotionInterruption[]; truncated: boolean;
};
export type MotionState = { tag: number; clock: "virtual" | "real"; timeMs: number; values: MotionValues; velocities: MotionValues; animating: MotionProperty[]; motion: Motion | null };
export type MotionSample = { tMs: number; values: MotionValues; velocities: MotionValues };
export type MotionSamples = { fromMs: number; toMs: number; intervalMs: number; truncated: boolean; samples: MotionSample[] };
/** What waitForMotion waits for, after motion of the view started or was interrupted after the last driver input. */
export type MotionUntil = { progress: number } | { elapsedMs: number } | { settled: true };
/** Main-thread display-link cadence between startFrames and stopFrames (docs/test-driver.md#frame-timing). */
export type FrameReport = { frames: number; droppedFrames: number; maxFrameGapMs: number; durationMs: number; fps: number; refreshRate: number };
export type LaunchOptions = { executable: string; args?: string[]; env?: Record<string, string>; log?: ProcessLog; startTimeoutMs?: number };
type Reply = { id?: unknown; ok: boolean; error?: { code: string; message: string }; [key: string]: unknown };

/** The environment variable that starts the in-app driver; the launch sets it. */
export const DRIVER_ENV = "SPARK_TEST_DRIVER_DIR";

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
    env: { ...process.env, ...options.env, [DRIVER_ENV]: directory },
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

const clock = (reply: Reply) => ({ mode: reply.mode as "virtual" | "real", timeMs: reply.timeMs as number });
const body = <T>({ id: _id, ok: _ok, ...rest }: Reply) => rest as T;

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
  /** Opens an existing file (absolute path) through the app's open-file handling once its first render has settled. */
  async openFile(file: string, timeoutMs = 30000) { await this.request({ command: "openFile", path: file, timeoutMs }, timeoutMs + 10000); }
  /** Waits for a visible view whose accessibility identifier (React Native testID) matches. */
  async waitFor(testID: string, timeoutMs = 10000) {
    const reply = await this.request({ command: "waitFor", testID, timeoutMs }, timeoutMs + 10000);
    return { window: reply.window as string, frame: reply.frame as Frame };
  }
  /** The in-process accessibility view: windows (front to back) and their elements, with parent keys. */
  async elements() {
    const reply = await this.request({ command: "elements" }, 10000);
    return { windows: reply.windows as DriverWindowInfo[], elements: reply.elements as DriverElement[] };
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
  /** The application menu bar, validated as when a user opens it. A driven app shows no menu bar, but has one. */
  async menus() { return (await this.request({ command: "menus" }, 10000)).menus as DriverMenuItem[]; }
  /** Switches the motion engine's clock (docs/motion.md#virtual-clock-for-the-test-driver). Needs the motion module in the app. */
  async setClock(mode: "virtual" | "real") { return clock(await this.request({ command: "setClock", mode }, 10000)); }
  /** Advances the virtual motion clock and every motion layer together. */
  async advanceClock(durationMs: number) { return clock(await this.request({ command: "advanceClock", durationMs }, 10000)); }
  /** Delivers a system event through the system module (docs/system.md#testing-system-events), with the state it implies. */
  async simulateSystemEvent({ type, thermal, lowPower, source, network, level, appearance, automaticAppearance, accentColor, highlightColor,
    increaseContrast, reduceTransparency, reduceMotion, differentiateWithoutColor, invertColors }: SimulatedSystemEvent) {
    const state = { thermalState: thermal, lowPowerMode: lowPower, onBattery: source === undefined ? undefined : source === "battery", network, level, appearance, automaticAppearance,
      accentColor, highlightColor, increaseContrast, reduceTransparency, reduceMotion, differentiateWithoutColor, invertColors };
    await this.request({ command: "simulateSystemEvent", type, ...Object.fromEntries(Object.entries(state).filter(([, value]) => value !== undefined)) }, 10000);
  }
  /** Engine state of the MotionView with (or containing the view with) this testID, and its latest motion. */
  async motionState(testID: string) { return body<MotionState>(await this.request({ command: "motionState", testID }, 10000)); }
  /**
   * Waits up to `timeoutMs` for motion of the view started or interrupted after the last driver input, then until it
   * reaches `until`. On the virtual clock it advances the clock exactly there.
   */
  async waitForMotion(testID: string, until: MotionUntil, timeoutMs = 10000) {
    return body<MotionState>(await this.request({ command: "waitForMotion", testID, ...until, timeoutMs }, timeoutMs + 10000));
  }
  /** Values and velocities of the view's latest motion, evaluated from its history, every `intervalMs` from `fromMs` to `toMs`. */
  async sampleMotion(testID: string, range: { fromMs?: number; toMs?: number; intervalMs?: number } = {}) {
    return body<MotionSamples>(await this.request({ command: "sampleMotion", testID, ...range }, 30000));
  }
  /** Starts counting main-thread display-link frames. */
  async startFrames() { return { refreshRate: (await this.request({ command: "startFrames" }, 10000)).refreshRate as number }; }
  /** Stops counting and reports frames, drops and the largest gap since startFrames. */
  async stopFrames() { return body<FrameReport>(await this.request({ command: "stopFrames" }, 10000)); }
  /** Reports `displays` (DisplayDetails) through @legendapp/spark/displays instead of the real ones; null restores them (docs/displays.md#simulated-displays). */
  async simulateDisplays(displays: readonly object[] | null) { await this.request({ command: "simulateDisplays", displays }, 10000); }
  /** Clicks a target in-process (docs/test-driver.md#input): `clickCount` 1-3, left, right, back or forward button. */
  async tap(target: InputTarget, options: { button?: MouseButton; clickCount?: number; modifiers?: Modifier[] } = {}) {
    await this.request({ command: "tap", ...target, ...options }, 10000);
  }
  /** Moves the driver's pointer onto a target: tracking-area enter and exit events and a mouse move. */
  async hover(target: InputTarget) { await this.request({ command: "hover", ...target }, 10000); }
  /** Presses at `from`, moves in `steps` (10) to `to`, and releases; both in one window. */
  async drag(from: InputTarget, to: InputTarget, options: { steps?: number; modifiers?: Modifier[] } = {}) {
    const window = "window" in from ? from.window : "window" in to ? to.window : undefined;
    const point = (target: InputTarget) => "testID" in target ? { testID: target.testID, ...(target.offset ? { offset: target.offset } : {}) } : { point: target.point };
    await this.request({ command: "drag", from: point(from), to: point(to), ...(window ? { window } : {}), ...options }, 10000);
  }
  /** Scrolls over a target, positive toward the end of the content: points with `precise`, else lines. */
  async scroll(target: InputTarget, delta: { deltaX?: number; deltaY?: number; precise?: boolean }) {
    await this.request({ command: "scroll", ...target, ...delta }, 10000);
  }
  /** Performs a trackpad gesture over a target, after moving the driver's pointer there. */
  async gesture(target: InputTarget, gesture: Gesture, modifiers?: Modifier[]) {
    await this.request({ command: "gesture", ...target, ...gesture, ...(modifiers ? { modifiers } : {}) }, 10000);
  }
  /** The cursor AppKit would show over a target, or at the driver's pointer; the pointer does not move. */
  async cursor(target?: InputTarget): Promise<DriverCursor> {
    const reply = await this.request({ command: "cursor", ...target }, 10000);
    return { cursor: reply.cursor as string, hiddenUntilMoved: reply.hiddenUntilMoved as boolean };
  }
  /** Presses one key (a character, or AppKit's function-key character such as "\uf700") in the window of the last pointer input, or `window`. */
  async pressKey(key: string, modifiers: Modifier[] = [], window?: DriverWindow) {
    await this.request({ command: "pressKey", key, modifiers, ...(window ? { window } : {}) }, 10000);
  }
  /** Types text as one key press per character, in the window of the last pointer input, or `window`. */
  async typeText(text: string, window?: DriverWindow) { await this.request({ command: "typeText", text, ...(window ? { window } : {}) }, 30000); }
  /** Ends the session; the app quits through its normal termination path. */
  async quit(timeoutMs = 15000) {
    await this.request({ command: "quit" }, 10000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const exited = await Promise.race([this.app.exited.then(() => true), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })]);
    clearTimeout(timer);
    if (!exited) { this.app.kill("SIGKILL"); await this.app.exited; throw new Error(`The app did not quit within ${timeoutMs} ms`); }
  }
  /** Whether the app process is still running. */
  get running() { return this.app.exitCode === null && this.app.signalCode === null; }
  /** Kills the app if it is still running and removes the run directory, including captures. */
  async close() {
    this.socket.destroy();
    if (this.running) { this.app.kill(); await this.app.exited; }
    rmSync(this.directory, { recursive: true, force: true });
  }
}
