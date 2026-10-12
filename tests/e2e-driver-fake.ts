// Test double for the driver backend: a fake app and driver session that record calls. Not a production backend.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ProcessLog } from "../packages/cli/src/process.ts";
import { DriverError, type DriverElement, type DriverMenuItem, type DriverWindow, type Frame, type FrameReport, type InputTarget, type Motion, type MotionSample, type MotionState, type MotionUntil, type SimulatedSystemEvent } from "../scripts/e2e/driver.ts";
import type { DriverApp, DriverClient } from "../scripts/e2e/runner/driver-backend.ts";

export const FRAME: Frame = { x: 10, y: 20, width: 100, height: 40 };
export const FRAMES: FrameReport = { frames: 61, droppedFrames: 0, maxFrameGapMs: 8.4, durationMs: 500, fps: 120, refreshRate: 120 };

/** A scripted motion for a testID: the telemetry the driver reports once it has settled, its samples, and the motion clock. */
export type FakeMotion = { motion: Motion; samples: MotionSample[]; clock?: "virtual" | "real" };
export const REST_VALUES = { opacity: 1, translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotate: 0 };
/** A settled motion from `startMs` to `endMs`; `overrides` replace any field. */
export const fakeMotion = (overrides: Partial<Motion> = {}): Motion => ({
  startMs: 1000, endMs: 1400, latestMs: 1000, settled: true, progress: 1, afterInput: true, startValues: REST_VALUES,
  properties: ["translateX"], kinds: { translateX: "spring" }, interruptions: [], truncated: false, ...overrides,
});
/** Samples of translateX at 0, 100, ... ms from `startMs`. */
export const fakeSamples = (translateX: number[], startMs = 1000): MotionSample[] =>
  translateX.map((value, index) => ({ tMs: startMs + index * 100, values: { ...REST_VALUES, translateX: value }, velocities: { ...REST_VALUES, opacity: 0, scaleX: 0, scaleY: 0 } }));

const describeTarget = (target: InputTarget) => "testID" in target ? `${target.testID}+${target.offset ? `${target.offset.x},${target.offset.y}` : "center"}` : `${target.point.x},${target.point.y}@${target.window ?? "main"}`;

/**
 * A driver session. `elements` lists the in-process accessibility view: `views` as elements of the main window, each
 * from the `elements` call (1-based) its value names, plus `extra`.
 */
export class FakeDriver implements DriverClient {
  running = true;
  private calls = 0;
  private readonly directory = mkdtempSync(path.join(tmpdir(), "fake-driver-"));
  constructor(private readonly log: string[], private readonly views: Record<string, number>, private readonly extra: () => DriverElement[] = () => [], private readonly menuBar: DriverMenuItem[] = [],
    private readonly motions: () => Record<string, FakeMotion> = () => ({}), private readonly frames: () => FrameReport | DriverError = () => FRAMES) {}

  async navigate(url: string) { this.log.push(`navigate ${url}`); }
  async openFile(file: string) { this.log.push(`openFile ${file}`); }
  async setAppAppearance(appearance: "light" | "dark", timeoutMs?: number) { this.log.push(`setAppAppearance ${appearance} ${timeoutMs}`); return { changed: true }; }
  async capture(window: DriverWindow, name: string) {
    this.log.push(`capture ${window} ${name}`);
    const file = path.join(this.directory, `${name}.png`);
    writeFileSync(file, `png ${name}`);
    return { file, width: 2000, height: 1400, scale: 2 };
  }
  async setClock(mode: "virtual" | "real") { this.log.push(`setClock ${mode}`); }
  async advanceClock(durationMs: number) { this.log.push(`advanceClock ${durationMs}`); }
  async simulateSystemEvent(event: SimulatedSystemEvent) { this.log.push(`simulateSystemEvent ${JSON.stringify(event)}`); }
  private motionOf(testID: string) {
    const scripted = this.motions()[testID];
    const state: MotionState = { tag: 7, clock: scripted?.clock ?? "virtual", timeMs: scripted?.motion.endMs ?? 0, values: REST_VALUES, velocities: REST_VALUES, animating: [], motion: scripted?.motion ?? null };
    return { scripted, state };
  }
  async motionState(testID: string) { this.log.push(`motionState ${testID}`); return this.motionOf(testID).state; }
  async waitForMotion(testID: string, until: MotionUntil, timeoutMs?: number) {
    this.log.push(`waitForMotion ${testID} ${JSON.stringify(until)} ${timeoutMs}`);
    const { scripted, state } = this.motionOf(testID);
    if (!scripted) throw new DriverError("E_TIMEOUT", "No motion of the view started or was interrupted after the last driver input");
    return state;
  }
  async sampleMotion(testID: string, range: { fromMs?: number; toMs?: number; intervalMs?: number } = {}) {
    this.log.push(`sampleMotion ${testID} ${JSON.stringify(range)}`);
    const { scripted } = this.motionOf(testID);
    return { fromMs: scripted!.motion.startMs, toMs: range.toMs ?? scripted!.motion.endMs!, intervalMs: 100, truncated: false, samples: scripted!.samples };
  }
  async startFrames() { this.log.push("startFrames"); return { refreshRate: 120 }; }
  async stopFrames() {
    this.log.push("stopFrames");
    const frames = this.frames();
    if (frames instanceof DriverError) throw frames;
    return frames;
  }
  async simulateDisplays(displays: readonly object[] | null) { this.log.push(`simulateDisplays ${JSON.stringify(displays)}`); }
  async elements() {
    this.log.push("elements");
    const calls = ++this.calls;
    const own: DriverElement[] = Object.entries(this.views).filter(([, from]) => from <= calls).map(([id]) => ({ key: id, window: "spark.main", id, frame: FRAME }));
    return { windows: [{ id: "spark.main", title: "Kitchen Sink", key: false, main: true, frame: { x: 0, y: 0, width: 1000, height: 700 } }], elements: [...own, ...this.extra()] };
  }
  async tap(target: InputTarget, options: object = {}) { this.log.push(`tap ${describeTarget(target)} ${JSON.stringify(options)}`); }
  async hover(target: InputTarget) { this.log.push(`hover ${describeTarget(target)}`); }
  async drag(from: InputTarget, to: InputTarget, options: object = {}) { this.log.push(`drag ${describeTarget(from)} ${describeTarget(to)} ${JSON.stringify(options)}`); }
  async scroll(target: InputTarget, delta: object) { this.log.push(`scroll ${describeTarget(target)} ${JSON.stringify(delta)}`); }
  async pressKey(key: string, modifiers: string[] = []) { this.log.push(`pressKey ${JSON.stringify(key)} ${modifiers.join("+")}`); }
  async typeText(text: string) { this.log.push(`typeText ${text}`); }
  async menus() { this.log.push("menus"); return this.menuBar; }
  async quit() { this.log.push("quit"); this.running = false; }
  async close() { this.log.push("close"); this.running = false; }
}

/** The app under test. Each launch returns a new FakeDriver sharing `log`, `views` and `elements`. */
export class FakeApp implements DriverApp {
  readonly log: string[] = [];
  readonly drivers: FakeDriver[] = [];
  /** Extra elements of the in-process accessibility view; tests may change them while a flow runs. */
  elements: DriverElement[] = [];
  /** Scripted motion telemetry by testID, and the next frame report (or driver failure). */
  motions: Record<string, FakeMotion> = {};
  frames: FrameReport | DriverError = FRAMES;
  constructor(private readonly views: Record<string, number> = {}, private readonly bundleId = "so.legend.spark.examples.kitchensink", readonly menuBar: DriverMenuItem[] = []) {}

  readonly reserved = { arguments: ["-RCT_jsLocation"], env: ["SPARK_TEST_DRIVER_DIR", "SPARK_BUNDLE_URL"], locale: ["-AppleLanguages", "-AppleLocale"] };

  async open(options: { dev: boolean }) { this.log.push(options.dev ? "open dev" : "open"); return { app: "/Apps/KitchenSink.app", bundleId: this.bundleId, launchedBundleId: `${this.bundleId}.driver` }; }
  async clearState() { this.log.push("clearState"); return ["defaults:so.legend.spark.examples.kitchensink"]; }
  async launch(options: { locale?: string; arguments: readonly string[]; env: Readonly<Record<string, string>>; log: ProcessLog }) {
    const extra = [...(options.arguments.length ? [`args=${options.arguments.join(" ")}`] : []), ...(Object.keys(options.env).length ? [`env=${JSON.stringify(options.env)}`] : [])];
    this.log.push([`launch locale=${options.locale ?? "-"}`, ...extra, `log=${path.basename(options.log.file)}`].join(" "));
    writeFileSync(options.log.file, "app log");
    const driver = new FakeDriver(this.log, this.views, () => this.elements, this.menuBar, () => this.motions, () => this.frames);
    this.drivers.push(driver);
    return driver;
  }
  async close() { this.log.push("app close"); }
}

/** A stand-in app (a Node script) that implements the driver's launch contract and protocol and records its argv in `launch.json`. */
export const FAKE_DRIVER_APP = String.raw`
const fs = require("node:fs"), net = require("node:net"), path = require("node:path");
const dir = process.env.SPARK_TEST_DRIVER_DIR;
if (process.env.FAKE_EXIT) process.exit(Number(process.env.FAKE_EXIT));
const mode = file => fs.statSync(file).mode & 0o777;
if (!dir || mode(dir) !== 0o700 || mode(path.join(dir, "token")) !== 0o600) process.exit(2);
const token = fs.readFileSync(path.join(dir, "token"), "utf8");
fs.unlinkSync(path.join(dir, "token"));
fs.writeFileSync(path.join(dir, "launch.json"), JSON.stringify({ argv: process.argv.slice(2), extra: process.env.FAKE_EXTRA, home: process.env.CFFIXED_USER_HOME, suffix: process.env.DIRHELPER_USER_DIR_SUFFIX }));
const server = net.createServer(socket => {
  let buffer = "", authenticated = false;
  const send = message => socket.write(JSON.stringify(message) + "\n");
  socket.on("data", chunk => {
    buffer += chunk;
    for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      if (!authenticated) {
        if (message.token !== token) { send({ ok: false, error: { code: "E_AUTH", message: "Authentication failed" } }); socket.end(); server.close(); return; }
        authenticated = true; send({ ok: true, protocol: 1 }); continue;
      }
      const reply = { id: message.id, ok: true };
      if (message.command === "waitFor" && message.testID === "missing") Object.assign(reply, { ok: false, error: { code: "E_TIMEOUT", message: "No view with testID missing" } });
      else if (message.command === "waitFor") Object.assign(reply, { window: "spark.main", frame: { x: 0, y: 0, width: 10, height: 20 } });
      else if (message.command === "openFile" && message.path !== "/fixtures/notes.md") Object.assign(reply, { ok: false, error: { code: "E_NOT_FOUND", message: "No file at " + message.path } });
      else if (message.command === "setAppAppearance") reply.changed = message.appearance === "dark";
      else if (message.command === "setClock") Object.assign(reply, { mode: message.mode, timeMs: 1000 });
      else if (message.command === "advanceClock") Object.assign(reply, { mode: "virtual", timeMs: 1000 + message.durationMs });
      else if (message.command === "waitForMotion") Object.assign(reply, { clock: "virtual", timeMs: 1100, echo: { testID: message.testID, progress: message.progress, timeoutMs: message.timeoutMs } });
      else if (message.command === "sampleMotion") Object.assign(reply, { fromMs: message.fromMs, toMs: 1100, intervalMs: message.intervalMs, truncated: false, samples: [] });
      else if (message.command === "startFrames") reply.refreshRate = 120;
      else if (message.command === "stopFrames") Object.assign(reply, { frames: 61, droppedFrames: 0, maxFrameGapMs: 8.3, durationMs: 500, fps: 120, refreshRate: 120 });
      else if (message.command === "capture") { fs.writeFileSync(path.join(dir, message.name + ".png"), "png", { mode: 0o600 }); Object.assign(reply, { file: message.name + ".png", width: 2000, height: 1400, scale: 2 }); }
      send(reply);
      if (message.command === "quit") { socket.end(); server.close(); }
    }
  });
});
server.listen(path.join(dir, "driver.sock"));
`;
