// Test double for the driver backend: a fake app and driver session that record calls. Not a production backend.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ProcessLog } from "../packages/cli/src/process.ts";
import { DriverError, type DriverElement, type DriverMenuItem, type DriverWindow, type Frame, type InputTarget } from "../scripts/e2e/driver.ts";
import type { DriverApp, DriverClient } from "../scripts/e2e/runner/driver-backend.ts";

export const FRAME: Frame = { x: 10, y: 20, width: 100, height: 40 };

const describeTarget = (target: InputTarget) => "testID" in target ? `${target.testID}+${target.offset ? `${target.offset.x},${target.offset.y}` : "center"}` : `${target.point.x},${target.point.y}@${target.window ?? "main"}`;

/**
 * A driver session. `elements` lists the in-process accessibility view: `views` as elements of the main window, each
 * from the `elements` call (1-based) its value names, plus `extra`.
 */
export class FakeDriver implements DriverClient {
  running = true;
  private calls = 0;
  private readonly directory = mkdtempSync(path.join(tmpdir(), "fake-driver-"));
  constructor(private readonly log: string[], private readonly views: Record<string, number>, private readonly extra: () => DriverElement[] = () => [], private readonly menuBar: DriverMenuItem[] = []) {}

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
  constructor(private readonly views: Record<string, number> = {}, private readonly bundleId = "so.legend.spark.examples.kitchensink", readonly menuBar: DriverMenuItem[] = []) {}

  readonly reserved = { arguments: ["-RCT_jsLocation"], env: ["SPARK_TEST_DRIVER_DIR", "SPARK_BUNDLE_URL"], locale: ["-AppleLanguages", "-AppleLocale"] };

  async open(options: { dev: boolean }) { this.log.push(options.dev ? "open dev" : "open"); return { app: "/Apps/KitchenSink.app", bundleId: this.bundleId }; }
  async clearState() { this.log.push("clearState"); return ["defaults:so.legend.spark.examples.kitchensink"]; }
  async launch(options: { locale?: string; arguments: readonly string[]; env: Readonly<Record<string, string>>; log: ProcessLog }) {
    const extra = [...(options.arguments.length ? [`args=${options.arguments.join(" ")}`] : []), ...(Object.keys(options.env).length ? [`env=${JSON.stringify(options.env)}`] : [])];
    this.log.push([`launch locale=${options.locale ?? "-"}`, ...extra, `log=${path.basename(options.log.file)}`].join(" "));
    writeFileSync(options.log.file, "app log");
    const driver = new FakeDriver(this.log, this.views, () => this.elements, this.menuBar);
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
fs.writeFileSync(path.join(dir, "launch.json"), JSON.stringify({ argv: process.argv.slice(2), extra: process.env.FAKE_EXTRA }));
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
      else if (message.command === "capture") { fs.writeFileSync(path.join(dir, message.name + ".png"), "png", { mode: 0o600 }); Object.assign(reply, { file: message.name + ".png", width: 2000, height: 1400, scale: 2 }); }
      send(reply);
      if (message.command === "quit") { socket.end(); server.close(); }
    }
  });
});
server.listen(path.join(dir, "driver.sock"));
`;
