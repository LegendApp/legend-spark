// Test double for the driver backend: a fake app and driver session that record calls. Not a production backend.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ProcessLog } from "../packages/cli/src/process.ts";
import { DriverError, type DriverWindow, type Frame } from "../scripts/e2e/driver.ts";
import type { DriverApp, DriverClient } from "../scripts/e2e/runner/driver-backend.ts";

export const FRAME: Frame = { x: 10, y: 20, width: 100, height: 40 };

/** A driver session. `views` maps testIDs to the waitFor call (1-based) from which they are found. */
export class FakeDriver implements DriverClient {
  running = true;
  private waits = 0;
  private readonly directory = mkdtempSync(path.join(tmpdir(), "fake-driver-"));
  constructor(private readonly log: string[], private readonly views: Record<string, number>) {}

  async navigate(url: string) { this.log.push(`navigate ${url}`); }
  async openFile(file: string) { this.log.push(`openFile ${file}`); }
  async waitFor(testID: string, timeoutMs?: number) {
    this.log.push(`waitFor ${testID} ${timeoutMs}`);
    this.waits++;
    if (!(testID in this.views) || this.waits < this.views[testID]!) throw new DriverError("E_TIMEOUT", `No view with testID ${testID}`);
    return { window: "spark.main", frame: FRAME };
  }
  async setAppAppearance(appearance: "light" | "dark", timeoutMs?: number) { this.log.push(`setAppAppearance ${appearance} ${timeoutMs}`); return { changed: true }; }
  async capture(window: DriverWindow, name: string) {
    this.log.push(`capture ${window} ${name}`);
    const file = path.join(this.directory, `${name}.png`);
    writeFileSync(file, `png ${name}`);
    return { file, width: 2000, height: 1400, scale: 2 };
  }
  async quit() { this.log.push("quit"); this.running = false; }
  async close() { this.log.push("close"); this.running = false; }
}

/** The app under test. Each launch returns a new FakeDriver sharing `log` and `views`. */
export class FakeApp implements DriverApp {
  readonly log: string[] = [];
  readonly drivers: FakeDriver[] = [];
  constructor(private readonly views: Record<string, number> = {}, private readonly bundleId = "so.legend.spark.examples.kitchensink") {}

  readonly reserved = { arguments: ["-RCT_jsLocation"], env: ["SPARK_TEST_DRIVER_DIR", "SPARK_BUNDLE_URL"], locale: ["-AppleLanguages", "-AppleLocale"] };

  async open() { this.log.push("open"); return { app: "/Apps/KitchenSink.app", bundleId: this.bundleId }; }
  async clearState() { this.log.push("clearState"); return ["defaults:so.legend.spark.examples.kitchensink"]; }
  async launch(options: { locale?: string; arguments: readonly string[]; env: Readonly<Record<string, string>>; log: ProcessLog }) {
    const extra = [...(options.arguments.length ? [`args=${options.arguments.join(" ")}`] : []), ...(Object.keys(options.env).length ? [`env=${JSON.stringify(options.env)}`] : [])];
    this.log.push([`launch locale=${options.locale ?? "-"}`, ...extra, `log=${path.basename(options.log.file)}`].join(" "));
    writeFileSync(options.log.file, "app log");
    const driver = new FakeDriver(this.log, this.views);
    this.drivers.push(driver);
    return driver;
  }
  async close() { this.log.push("app close"); }
}
