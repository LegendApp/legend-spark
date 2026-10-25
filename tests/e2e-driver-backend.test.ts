import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { DriverError } from "../scripts/e2e/driver.ts";
import { runFlows } from "../scripts/e2e/runner/executor.ts";
import { DriverBackend } from "../scripts/e2e/runner/driver-backend.ts";
import { FakeApp, FRAME } from "./e2e-driver-fake.ts";
import { VirtualClock } from "./e2e-runner-backend.ts";

const HEADER = "appId: so.legend.spark.examples.kitchensink\nname: Driver flow\nintent: The test intent.\n";

async function run(commands: string, app = new FakeApp(), header = "") {
  const dir = mkdtempSync(path.join(tmpdir(), "e2e-driver-"));
  mkdirSync(path.join(dir, "flows/area"), { recursive: true });
  writeFileSync(path.join(dir, "flows/area/test.yaml"), `${HEADER}${header}---\n${commands}`);
  const results = await runFlows([path.join(dir, "flows/area/test.yaml")], { backends: [new DriverBackend(app)], runDir: path.join(dir, "run"), clock: new VirtualClock() });
  return { results, result: results[0]!, app, dir };
}

describe("command mapping", () => {
  test("launchApp launches with the matrix locale, applies the matrix appearance, and delivers openUrl with navigate", async () => {
    const { results, app } = await run('- launchApp: { openUrl: "spark-ks://native-controls/buttons" }', new FakeApp(), "matrix:\n  appearance: [light, dark]\n  locale: [ar]\n");
    expect(results.map(result => result.status)).toEqual(["passed", "passed"]);
    expect(app.log).toEqual([
      "open", "launch locale=ar log=app-1.log", "setAppAppearance light 30000", "navigate spark-ks://native-controls/buttons", "quit", "close", "app close",
      "open", "launch locale=ar log=app-1.log", "setAppAppearance dark 30000", "navigate spark-ks://native-controls/buttons", "quit", "close", "app close",
    ]);
  });

  test("launchApp restarts a running app; with stopApp: false it only delivers the URL", async () => {
    const { result, app } = await run('- launchApp\n- launchApp: { openUrl: "spark-ks://a/b", stopApp: false }\n- launchApp: { stopApp: true }\n- stopApp');
    expect(result.status).toBe("passed");
    expect(app.log).toEqual(["open", "launch locale=- log=app-1.log", "navigate spark-ks://a/b", "quit", "close", "launch locale=- log=app-2.log", "quit", "close", "app close"]);
  });

  test("clearState deletes the app's state after the running app quits and before the next launch", async () => {
    const { result, app, dir } = await run("- launchApp: { clearState: true }\n- launchApp: { clearState: true }\n- launchApp: { clearState: false }");
    expect(result.status).toBe("passed");
    const logs = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(file => path.basename(file).startsWith("clear-state-")).sort();
    expect(logs.map(file => path.basename(file))).toEqual(["clear-state-1.log", "clear-state-2.log"]);
    expect(readFileSync(path.join(dir, logs[0]!), "utf8")).toBe("defaults:so.legend.spark.examples.kitchensink\n");
    expect(app.log).toEqual([
      "open", "clearState", "launch locale=- log=app-1.log", "quit", "close", "clearState", "launch locale=- log=app-2.log", "quit", "close",
      "launch locale=- log=app-3.log", "quit", "close", "app close",
    ]);
  });

  test("arguments follow the driver's own and env is passed through, per launch", async () => {
    const { result, app } = await run('- launchApp: { arguments: ["--spark-safe-mode", "-AppleLanguages", "(fr)"], env: { KS_MODE: "a b" } }\n- launchApp');
    expect(result.status).toBe("passed");
    expect(app.log.filter(line => line.startsWith("launch"))).toEqual(['launch locale=- args=--spark-safe-mode -AppleLanguages (fr) env={"KS_MODE":"a b"} log=app-1.log', "launch locale=- log=app-2.log"]);
  });

  test("openFile is delivered after openUrl, once the app runs", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "e2e-driver-file-")), file = path.join(dir, "notes.md");
    writeFileSync(file, "# Notes");
    const { result, app } = await run(`- launchApp: { openUrl: "spark-ks://a/b", openFile: "${file}" }\n- launchApp: { openFile: "${file}", stopApp: false }`);
    expect(result.status).toBe("passed");
    expect(app.log).toEqual(["open", "launch locale=- log=app-1.log", "navigate spark-ks://a/b", `openFile ${file}`, `openFile ${file}`, "quit", "close", "app close"]);
  });

  test("id selectors query waitFor in-process without waiting, and the runner polls", async () => {
    const { result, app } = await run("- launchApp\n- assertVisible: { id: root }\n- assertNotVisible: { id: gone }\n- extendedWaitUntil: { visible: { id: root } }", new FakeApp({ root: 3 }));
    expect(result.status).toBe("passed");
    expect(app.log.filter(line => line.startsWith("waitFor"))).toEqual(["waitFor root 0", "waitFor root 0", "waitFor root 0", "waitFor gone 0", "waitFor root 0"]);
  });

  test("a missing testID is not-found after the command's timeout", async () => {
    const { result } = await run("- launchApp\n- assertVisible: { id: missing, timeout: 300ms }");
    expect(result.failure).toMatchObject({ kind: "not-found", message: 'no element matches {"id":"missing"} (waited 300ms on driver)' });
  });

  test("setAppAppearance maps to the driver; takeScreenshot captures the main window into the flow's output", async () => {
    const { result, app } = await run("- launchApp\n- setAppAppearance: dark\n- takeScreenshot: shot");
    expect(result.status).toBe("passed");
    expect(app.log.slice(2, 4)).toEqual(["setAppAppearance dark undefined", "capture main capture-1"]);
    expect(result.artifacts).toEqual([{ kind: "screenshot", path: expect.stringMatching(/output\/shot\.png$/), backend: "driver" }]);
    expect(readFileSync(result.artifacts[0]!.path, "utf8")).toBe("png capture-1");
  });

  test("screenshot() reports the captured window in points from its top-left, the space waitFor frames use", async () => {
    const app = new FakeApp({ root: 1 }), backend = new DriverBackend(app), dir = mkdtempSync(path.join(tmpdir(), "e2e-driver-"));
    await backend.start({ flow: { header: { appId: "so.legend.spark.examples.kitchensink" } } as never, matrix: {}, platform: "macos", dir });
    await backend.commands.launchApp!({}, {} as never);
    expect(await backend.screenshot(path.join(dir, "a.png"))).toEqual({ frame: { x: 0, y: 0, width: 1000, height: 700 }, scale: 2 });
    expect(await backend.query({ id: "root" }, {})).toEqual([{ key: "spark.main#root", window: "spark.main", id: "root", frame: FRAME }]);
    await backend.stop();
  });

  test("a failure collects the app logs and a capture of the main window", async () => {
    const { result } = await run("- launchApp\n- assertVisible: { id: missing, timeout: 100ms }");
    expect(result.failure!.artifacts.map(artifact => [artifact.kind, path.basename(artifact.path), artifact.backend])).toEqual([
      ["logs", "app-1.log", "driver"], ["screenshot", "driver-main.png", "driver"],
    ]);
    expect(existsSync(result.failure!.artifacts[1]!.path)).toBe(true);
  });
});

describe("unsupported and invalid", () => {
  test.each([
    ["- tapOn: { id: save }", "tapOn needs a black-box backend (active: driver (driver))"],
    ["- inputText: hello", "inputText needs a black-box backend (active: driver (driver))"],
    ["- killApp", "killApp is not supported by backend driver"],
    ["- assertStartup: { coldMs: { max: 900 } }", "assertStartup is not supported by backend driver"],
    ["- assertVisible: Save", "backend driver cannot select by text"],
    ["- assertVisible: { id: row, within: { id: list } }", "backend driver cannot select within an element"],
    ["- launchApp: { appId: com.example.other, from: dock }", "launchApp appId, from is not supported by backend driver"],
  ])("%s fails as unsupported", async (command, message) => {
    const views = { list: 1, row: 1 };
    const { result } = await run(`- launchApp\n${command}`, new FakeApp(views));
    expect(result.failure).toMatchObject({ kind: "unsupported", message });
  });

  test.each([
    ['- launchApp: { arguments: ["-RCT_jsLocation", "example.com:80"] }', "", "launchApp -RCT_jsLocation is reserved by backend driver"],
    ['- launchApp: { env: { SPARK_BUNDLE_URL: "http://example.com", SPARK_TEST_DRIVER_DIR: /tmp } }', "", "launchApp SPARK_BUNDLE_URL, SPARK_TEST_DRIVER_DIR are reserved by backend driver"],
    ['- launchApp: { arguments: ["-AppleLanguages", "(fr)"] }', "matrix:\n  locale: [ar]\n", "launchApp -AppleLanguages is reserved by backend driver"],
    ["- launchApp: { openFile: notes.md }", "", "launchApp openFile notes.md is not an absolute path to an existing file"],
    ["- launchApp: { openFile: /nonexistent/notes.md }", "", "launchApp openFile /nonexistent/notes.md is not an absolute path to an existing file"],
    ["- launchApp\n- launchApp: { stopApp: false, clearState: true, env: { A: b } }", "", "launchApp clearState, env need a new launch, but stopApp: false keeps the running app"],
  ])("%s is invalid before anything launches", async (commands, header, message) => {
    const { result, app } = await run(commands, new FakeApp(), header);
    expect(result.failure).toMatchObject({ kind: "invalid", message });
    expect(app.log.filter(line => line.startsWith("launch") || line === "clearState")).toEqual(commands.startsWith("- launchApp\n") ? ["launch locale=- log=app-1.log"] : []);
  });

  test("a matrix dimension the driver does not apply is unsupported", async () => {
    const { result } = await run("- launchApp", new FakeApp(), "matrix:\n  reduceMotion: [true]\n");
    expect(result.failure).toMatchObject({ kind: "unsupported", message: "no active backend applies matrix dimension reduceMotion (active: driver)" });
  });

  test("driver commands before launchApp are invalid; after the app exits they are errors", async () => {
    expect((await run("- setAppAppearance: dark")).result.failure).toMatchObject({ kind: "invalid", message: "the app is not running; start the flow with launchApp" });
    const app = new FakeApp();
    const launched = app.launch.bind(app);
    app.launch = async options => { const driver = await launched(options); driver.running = false; return driver; };
    expect((await run("- launchApp\n- takeScreenshot: x", app)).result.failure).toMatchObject({ kind: "error", message: expect.stringMatching(/^the app exited; see .*app-1\.log$/) });
  });

  test("a flow for another app is invalid, and the app is closed although the backend never started", async () => {
    const { result, app } = await run("- launchApp", new FakeApp({}, "com.example.other"));
    expect(result.failure).toMatchObject({ kind: "invalid", message: "the flow is for so.legend.spark.examples.kitchensink, but /Apps/KitchenSink.app is com.example.other" });
    expect(app.log).toEqual(["open", "app close"]);
  });

  test("other driver failures surface as errors", async () => {
    const app = new FakeApp();
    const launched = app.launch.bind(app);
    app.launch = async options => {
      const driver = await launched(options);
      driver.capture = async () => { throw new DriverError("E_NOT_SETTLED", "The UI kept mounting changes until the timeout"); };
      return driver;
    };
    expect((await run("- launchApp\n- takeScreenshot: x", app)).result.failure).toMatchObject({ kind: "error", message: "E_NOT_SETTLED: The UI kept mounting changes until the timeout" });
  });
});
