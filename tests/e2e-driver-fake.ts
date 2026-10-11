// Test double for the driver backend: a fake app and driver session that record calls. Not a production backend.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ProcessLog } from "../packages/cli/src/process.ts";
import type { DriverElement, DriverWindow, Frame, InputTarget } from "../scripts/e2e/driver.ts";
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
  constructor(private readonly log: string[], private readonly views: Record<string, number>, private readonly extra: () => DriverElement[] = () => []) {}

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
  async quit() { this.log.push("quit"); this.running = false; }
  async close() { this.log.push("close"); this.running = false; }
}

/** The app under test. Each launch returns a new FakeDriver sharing `log`, `views` and `elements`. */
export class FakeApp implements DriverApp {
  readonly log: string[] = [];
  readonly drivers: FakeDriver[] = [];
  /** Extra elements of the in-process accessibility view; tests may change them while a flow runs. */
  elements: DriverElement[] = [];
  constructor(private readonly views: Record<string, number> = {}, private readonly bundleId = "so.legend.spark.examples.kitchensink") {}

  readonly reserved = { arguments: ["-RCT_jsLocation"], env: ["SPARK_TEST_DRIVER_DIR", "SPARK_BUNDLE_URL"], locale: ["-AppleLanguages", "-AppleLocale"] };

  async open() { this.log.push("open"); return { app: "/Apps/KitchenSink.app", bundleId: this.bundleId }; }
  async clearState() { this.log.push("clearState"); return ["defaults:so.legend.spark.examples.kitchensink"]; }
  async launch(options: { locale?: string; arguments: readonly string[]; env: Readonly<Record<string, string>>; log: ProcessLog }) {
    const extra = [...(options.arguments.length ? [`args=${options.arguments.join(" ")}`] : []), ...(Object.keys(options.env).length ? [`env=${JSON.stringify(options.env)}`] : [])];
    this.log.push([`launch locale=${options.locale ?? "-"}`, ...extra, `log=${path.basename(options.log.file)}`].join(" "));
    writeFileSync(options.log.file, "app log");
    const driver = new FakeDriver(this.log, this.views, () => this.elements);
    this.drivers.push(driver);
    return driver;
  }
  async close() { this.log.push("app close"); }
}
