import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { DriverError } from "../scripts/e2e/driver.ts";
import { runFlows } from "../scripts/e2e/runner/executor.ts";
import { DriverBackend } from "../scripts/e2e/runner/driver-backend.ts";
import { FakeApp, fakeMotion, fakeSamples, FRAME, FRAMES } from "./e2e-driver-fake.ts";
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

  test("selectors match the in-process accessibility view, one elements snapshot per poll", async () => {
    const { result, app } = await run("- launchApp\n- assertVisible: { id: root }\n- assertNotVisible: { id: gone }\n- extendedWaitUntil: { visible: { id: root } }", new FakeApp({ root: 3 }));
    expect(result.status).toBe("passed");
    expect(app.log.filter(line => line === "elements")).toHaveLength(5);
  });

  test("a missing testID is not-found after the command's timeout", async () => {
    const { result } = await run("- launchApp\n- assertVisible: { id: missing, timeout: 300ms }");
    expect(result.failure).toMatchObject({ kind: "not-found", message: 'no element matches {"id":"missing"} (waited 300ms on driver)' });
  });

  test("assertAppMenu checks the driver's menu snapshot by title path, and build: dev flows ask for the development bundle", async () => {
    const menuBar = [{ title: "Developer", enabled: true, hidden: false, state: "off" as const, items: [
      { title: "Reload", enabled: true, hidden: false, state: "off" as const },
      { separator: true as const },
      { title: "Open DevTools", enabled: false, hidden: false, state: "off" as const, toolTip: "Unavailable" },
      { title: "Show Developer Menu", enabled: true, hidden: true, state: "off" as const, shortcut: { key: "z", modifiers: (1 << 18) | (1 << 20) } },
    ] }];
    const passing = await run([
      "- launchApp", '- assertAppMenu: { path: "Developer > Reload", enabled: true }', '- assertAppMenu: { path: "Developer > Open DevTools", enabled: false, toolTip: Unavailable }',
      '- assertAppMenu: { path: "Developer > Show Developer Menu", hidden: true, shortcut: Ctrl+Cmd+Z }', '- assertAppMenu: { path: "Window > Minimize", exists: false }',
    ].join("\n"), new FakeApp({}, undefined, menuBar), "build: dev\n");
    expect(passing.result.status).toBe("passed");
    expect(passing.app.log[0]).toBe("open dev");
    const wrongState = await run('- launchApp\n- assertAppMenu: { path: "Developer > Open DevTools", enabled: true, timeout: 200ms }', new FakeApp({}, undefined, menuBar));
    expect(wrongState.result.failure).toMatchObject({ kind: "assertion", message: expect.stringContaining('expected enabled true, got false') });
    expect(wrongState.app.log[0]).toBe("open");
    const missing = await run('- launchApp\n- assertAppMenu: { path: "Developer > Inspect", timeout: 200ms }', new FakeApp({}, undefined, menuBar));
    expect(missing.result.failure).toMatchObject({ kind: "assertion", message: expect.stringContaining('"Inspect" is not in [Reload, Open DevTools, Show Developer Menu]') });
    const present = await run('- launchApp\n- assertAppMenu: { path: "Developer > Reload", exists: false, timeout: 200ms }', new FakeApp({}, undefined, menuBar));
    expect(present.result.failure).toMatchObject({ kind: "assertion", message: "menu item Developer > Reload exists" });
  });

  test("setClock and advanceClock drive the motion engine's virtual clock", async () => {
    const { result, app } = await run("- launchApp\n- setClock: virtual\n- advanceClock: 1.5s\n- advanceClock: 16\n- setClock: real");
    expect(result.status).toBe("passed");
    expect(app.log.filter(line => /Clock/.test(line))).toEqual(["setClock virtual", "advanceClock 1500", "advanceClock 16", "setClock real"]);
  });

  test("simulateSystemEvent passes the event type and the state it implies to the driver", async () => {
    const { result, app } = await run("- launchApp\n- simulateSystemEvent: sleep\n- simulateSystemEvent: { type: thermalChanged, thermal: serious }");
    expect(result.status).toBe("passed");
    expect(app.log.filter(line => line.startsWith("simulateSystemEvent"))).toEqual(['simulateSystemEvent {"type":"sleep"}', 'simulateSystemEvent {"type":"thermalChanged","thermal":"serious"}']);
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
    expect(await backend.elements()).toEqual([{ key: "root", window: "spark.main", id: "root", frame: FRAME }]);
    expect(await backend.windows()).toEqual([{ id: "spark.main", title: "Kitchen Sink", key: false, main: true, frame: { x: 0, y: 0, width: 1000, height: 700 } }]);
    await backend.stop();
  });

  test("a failure collects the element tree, the app logs and a capture of the main window", async () => {
    const { result } = await run("- launchApp\n- assertVisible: { id: missing, timeout: 100ms }");
    expect(result.failure!.artifacts.map(artifact => [artifact.kind, path.basename(artifact.path), artifact.backend])).toEqual([
      ["elements", "elements-driver.json", "driver"], ["logs", "app-1.log", "driver"], ["screenshot", "driver-main.png", "driver"],
    ]);
    expect(existsSync(result.failure!.artifacts[2]!.path)).toBe(true);
  });
});

describe("white-box input (no black-box backend active)", () => {
  // FRAME is { x: 10, y: 20, width: 100, height: 40 }: its center is 60,40 in the main window.
  test.each([
    ["- tapOn: { id: save }", 'tap save+50,20 {}'],
    ["- doubleClickOn: { id: save }", 'tap save+50,20 {"clickCount":2}'],
    ["- tripleClickOn: { id: save }", 'tap save+50,20 {"clickCount":3}'],
    ["- rightClickOn: { id: save, modifiers: [cmd, alt] }", 'tap save+50,20 {"button":"right","modifiers":["cmd","option"]}'],
    ['- tapOn: { point: "25%,50%", within: { id: save } }', 'tap save+25,20 {}'],
    ["- hoverOn: { id: save }", "hover save+50,20"],
    ["- typeText: Hé😀", "typeText Hé😀"],
    ["- pressKey: Enter", 'pressKey "\\r" '],
    ["- pressKey: Up", 'pressKey "\uf700" '],
    ["- shortcut: cmd+shift+s", 'pressKey "s" cmd+shift'],
    ["- scroll: { on: { id: list }, direction: up, amount: 600, precise: true }", 'scroll list+50,20 {"deltaY":-600,"precise":true}'],
    ["- scroll: { on: { id: list }, direction: right }", 'scroll list+50,20 {"deltaX":3,"precise":false}'],
    ["- scroll: { on: { id: list } }", 'scroll list+50,20 {"deltaY":3,"precise":false}'],
    ["- swipe: { from: { id: list }, direction: up }", 'scroll list+50,20 {"deltaX":0,"deltaY":20,"precise":true}'],
    ['- swipe: { from: { id: list }, start: "50%,10%", end: "20%,90%" }', 'scroll list+50,20 {"deltaX":30,"deltaY":-32,"precise":true}'],
    ["- dragAndDrop: { from: { id: save }, to: { id: list }, steps: 20 }", 'drag save+50,20 list+50,20 {"steps":20}'],
  ])("%s", async (command, call) => {
    const { result, app } = await run(`- launchApp\n${command}`, new FakeApp({ save: 1, list: 1 }));
    expect(result.failure).toBeUndefined();
    expect(app.log.filter(line => /^(tap|hover|typeText|pressKey|scroll|drag) /.test(line))).toEqual([call]);
  });

  test("inputText and typeText click `into` first, then type", async () => {
    const { result, app } = await run('- launchApp\n- inputText: { text: " Shared!", into: { id: field } }', new FakeApp({ field: 1 }));
    expect(result.status).toBe("passed");
    expect(app.log.filter(line => /^(tap|typeText) /.test(line))).toEqual(["tap field+50,20 {}", "typeText  Shared!"]);
  });

  test("steps the driver ran in place of a black-box backend are labelled white-box; lifecycle and driver commands are not", async () => {
    const { result } = await run("- launchApp\n- tapOn: { id: save }\n- assertVisible: { id: save }\n- setClock: virtual", new FakeApp({ save: 1 }));
    expect(result.steps.map(step => [step.command, step.whiteBox ?? false])).toEqual([["launchApp", false], ["tapOn", true], ["assertVisible", true], ["setClock", false]]);
    expect(result.whiteBox).toEqual(["assertVisible", "tapOn"]);
  });

  test("text, label, role and within select through the in-process accessibility view", async () => {
    const app = new FakeApp({ path: 1 });
    app.elements = [
      { key: "u", parent: "path", window: "spark.main", role: "button", text: "usr", frame: { x: 0, y: 0, width: 20, height: 10 } },
      { key: "b", window: "spark.main", role: "button", label: "Save", text: "Save", frame: { x: 100, y: 100, width: 40, height: 20 } },
    ];
    const { result } = await run("- launchApp\n- tapOn: { text: usr, within: { id: path } }\n- assertVisible: { role: button, label: Save }\n- tapOn: Save", app);
    expect(result.status).toBe("passed");
    // Elements without a testID are addressed by point in their window, without scrolling into view.
    expect(app.log.filter(line => line.startsWith("tap "))).toEqual(["tap 10,5@id:spark.main {}", "tap 120,110@id:spark.main {}"]);
  });

  test("assertText waits for the element's text; a mismatch is an assertion failure", async () => {
    const app = new FakeApp();
    let snapshots = 0;
    Object.defineProperty(app, "elements", { get: () => [{ key: "v", window: "spark.main", id: "value", text: ++snapshots < 3 ? "0" : "1", frame: FRAME }] });
    expect((await run("- launchApp\n- assertText: { id: value, equals: '1' }", app)).result.status).toBe("passed");
    expect(snapshots).toBe(3);
    const failed = await run("- launchApp\n- assertText: { id: value, equals: '2', timeout: 300ms }", app);
    expect(failed.result.failure).toMatchObject({ kind: "assertion", message: 'the text of {"id":"value"} is "1", not "2"' });
    expect((await run("- launchApp\n- assertText: { id: gone, equals: x, timeout: 100ms }", app)).result.failure).toMatchObject({ kind: "not-found" });
  });

  test("assertA11y checks the label, role and value NSAccessibility reports in-process", async () => {
    const app = new FakeApp();
    app.elements = [{ key: "d", window: "spark.main", id: "default", role: "button", label: "افتراضي", value: "5", frame: FRAME }];
    expect((await run('- launchApp\n- assertA11y: { id: default, label: "افتراضي", role: button, value: "5" }\n- assertA11y: { id: default, label: "/^اف/" }', app)).result.status).toBe("passed");
    expect((await run("- launchApp\n- assertA11y: { id: default, label: Default, timeout: 100ms }", app)).result.failure).toMatchObject({
      kind: "assertion", message: 'the accessibility label of {"id":"default"} is "افتراضي", not "Default"',
    });
  });

  test("an element without a testID in a window without an identifier cannot be addressed", async () => {
    const app = new FakeApp();
    app.elements = [{ key: "x", window: "", text: "X", frame: FRAME }];
    expect((await run("- launchApp\n- tapOn: X", app)).result.failure).toMatchObject({
      kind: "unsupported", message: 'backend driver cannot address the window of "x": it has no identifier',
    });
  });
});

describe("motion and frames", () => {
  const motionApp = (motion = fakeMotion(), samples = fakeSamples([0, 60, 104, 98, 100]), clock: "virtual" | "real" = "virtual") => {
    const app = new FakeApp({ box: 1, go: 1 });
    app.motions = { box: { motion, samples, clock } };
    return app;
  };
  const motionLog = (app: FakeApp) => app.log.filter(line => /^(waitForMotion|sampleMotion|motionState|startFrames|stopFrames|tap|capture)/.test(line));

  test("captureMotion waits for the motion after the last input to settle and writes its samples", async () => {
    const { result, app } = await run("- launchApp\n- captureMotion: { target: { id: box }, name: open }\n- captureMotion: { target: { id: box }, until: 200ms, name: early }", motionApp());
    expect(result.status).toBe("passed");
    expect(motionLog(app)).toEqual([
      'waitForMotion box {"settled":true} 5000', 'sampleMotion box {"toMs":1400}', 'waitForMotion box {"elapsedMs":200} 5000', 'sampleMotion box {"toMs":1200}',
    ]);
    const output = result.artifacts.find(artifact => artifact.path.endsWith("open.motion.json"))!;
    const written = JSON.parse(readFileSync(output.path, "utf8"));
    expect(written).toMatchObject({ testID: "box", clock: "virtual", motion: { startMs: 1000, endMs: 1400 }, toMs: 1400 });
    expect(written.samples.map((sample: { values: { translateX: number } }) => sample.values.translateX)).toEqual([0, 60, 104, 98, 100]);
  });

  test("assertMotion checks kind, settle time and overshoot past the final value", async () => {
    const passing = await run("- launchApp\n- assertMotion: { target: { id: box }, kind: spring, settlesWithin: 400ms, overshoot: { min: 3px, max: 4.5 } }", motionApp());
    expect(passing.result.status).toBe("passed");
    expect(motionLog(passing.app)).toEqual(['waitForMotion box {"settled":true} 5000', 'sampleMotion box {"toMs":1400}']);
    const failing = await run("- launchApp\n- assertMotion: { target: { id: box }, kind: timing, settlesWithin: 300ms, overshoot: { max: 1px } }", motionApp());
    expect(failing.result.failure).toMatchObject({
      kind: "assertion",
      message: "the motion of box after the last input: it settled 400 ms after it started, not within 300ms; it is not a timing: it moved translateX spring; it overshot 4px, more than 1px",
    });
    const redirected = await run("- launchApp\n- assertMotion: { target: { id: box }, settlesWithin: 300ms }", motionApp(fakeMotion({ latestMs: 1100 })));
    expect(redirected.result.status).toBe("passed");  // 300 ms after its last interruption
    const late = await run("- launchApp\n- assertMotion: { target: { id: box }, settlesWithin: 200ms }", motionApp(fakeMotion({ latestMs: 1100 })));
    expect(late.result.failure?.message).toBe("the motion of box after the last input: it settled 300 ms after it was last interrupted, not within 200ms");
    const crossfade = await run("- launchApp\n- assertMotion: { target: { id: box }, kind: crossfade }", motionApp(fakeMotion({ properties: ["opacity"], kinds: { opacity: "timing" } })));
    expect(crossfade.result.status).toBe("passed");
    const still = await run("- launchApp\n- assertMotion: { target: { id: box }, overshoot: { min: 1px } }", motionApp(fakeMotion(), fakeSamples([0, 5, 0])));
    expect(still.result.failure).toMatchObject({ kind: "assertion", message: "the motion of box after the last input: overshoot is measured on a translation that travels; it moved translateX spring" });
  });

  test("velocityContinuous needs an interruption that kept value and velocity", async () => {
    const handoff = (after: { value: number; velocity: number }) => fakeMotion({ interruptions: [{ timeMs: 1100, property: "translateX", before: { value: 60, velocity: 60 }, after }] });
    expect((await run("- launchApp\n- assertMotion: { target: { id: box }, velocityContinuous: true }", motionApp(handoff({ value: 60, velocity: 60.00001 })))).result.status).toBe("passed");
    expect((await run("- launchApp\n- assertMotion: { target: { id: box }, velocityContinuous: true }", motionApp(handoff({ value: 60, velocity: 0 })))).result.failure).toMatchObject({
      kind: "assertion", message: "the motion of box after the last input: an interruption changed value or velocity: translateX 60 at 60/s → 60 at 0/s",
    });
    expect((await run("- launchApp\n- assertMotion: { target: { id: box }, velocityContinuous: true }", motionApp())).result.failure).toMatchObject({
      kind: "assertion", message: "the motion of box after the last input: it was never interrupted, so velocity continuity was not exercised",
    });
    expect((await run("- launchApp\n- assertMotion: { target: { id: box }, velocityContinuous: false }", motionApp(handoff({ value: 60, velocity: 0 })))).result.status).toBe("passed");
  });

  test("kind: none checks there is no motion after the last input without waiting", async () => {
    const quiet = new FakeApp({ box: 1 });
    expect((await run("- launchApp\n- assertMotion: { target: { id: box }, kind: none }", quiet)).result.status).toBe("passed");
    expect(motionLog(quiet)).toEqual(["motionState box"]);
    expect((await run("- launchApp\n- assertMotion: { target: { id: box }, kind: none }", motionApp())).result.failure).toMatchObject({ kind: "assertion", message: "box moved after the last input (translateX spring)" });
    expect((await run("- launchApp\n- assertMotion: { target: { id: box }, kind: none, settlesWithin: 1s }", motionApp())).result.failure).toMatchObject({ kind: "invalid" });
  });

  test("assertMotion frames advances the virtual clock to each progress point and compares every capture with its golden", async () => {
    const matrix = "matrix:\n  appearance: [light]\n  locale: [en]\n";
    const { result, app } = await run("- launchApp\n- assertMotion: { target: { id: box }, frames: { at: [100, 0, 12.5], golden: slide } }", motionApp(), matrix);
    expect(motionLog(app)).toEqual([
      "motionState box",
      'waitForMotion box {"progress":0} 5000', "capture main capture-1",
      'waitForMotion box {"progress":0.125} 5000', "capture main capture-2",
      'waitForMotion box {"progress":1} 5000', "capture main capture-3",
      "capture main capture-4", // failure evidence: no golden exists for any frame
    ]);
    expect(result.goldens.map(golden => golden.id)).toEqual(["macos/light/en/slide-0", "macos/light/en/slide-12_5", "macos/light/en/slide-100"]);
    expect(result.failure?.kind).toBe("assertion");
    expect(result.failure?.message.split("\n")).toHaveLength(3);
    const real = await run("- launchApp\n- assertMotion: { target: { id: box }, frames: { at: [50], golden: slide } }", motionApp(fakeMotion(), fakeSamples([0]), "real"));
    expect(real.result.failure).toMatchObject({ kind: "invalid", message: "assertMotion frames are exact frames of the virtual clock; run setClock: virtual before the motion starts" });
  });

  test("interruptAt waits for the progress point, then runs its command", async () => {
    const { result, app } = await run("- launchApp\n- interruptAt: { target: { id: box }, progress: 0.25, with: { tapOn: { id: go } } }", motionApp());
    expect(result.status).toBe("passed");
    expect(motionLog(app)).toEqual(['waitForMotion box {"progress":0.25} 5000', 'tap go+50,20 {}']);
    expect((await run("- launchApp\n- interruptAt: { progress: 0.25, with: { tapOn: { id: go } } }", motionApp())).result.failure).toMatchObject({ kind: "unsupported" });
  });

  test("motion that never starts, and targets without a testID, fail typed", async () => {
    expect((await run("- launchApp\n- captureMotion: { target: { id: go }, name: x }", motionApp())).result.failure).toMatchObject({
      kind: "timeout", message: "captureMotion: E_TIMEOUT: No motion of the view started or was interrupted after the last driver input",
    });
    const app = motionApp();
    app.elements = [{ key: "label", window: "spark.main", text: "Box", frame: FRAME }];
    expect((await run("- launchApp\n- assertMotion: { target: Box, kind: spring }", app)).result.failure).toMatchObject({ kind: "unsupported", message: 'backend driver reads motion by testID, and "Box" matched an element without one' });
    expect((await run("- launchApp\n- captureMotion: { target: { id: box }, name: ../x }", motionApp())).result.failure).toMatchObject({ kind: "invalid" });
  });

  test("assertFrames counts frames around its command and records the gate metrics", async () => {
    const { result, app } = await run("- launchApp\n- assertFrames: { during: { tapOn: { id: go } }, fps: { min: 110 }, dropped: 0 }", motionApp());
    expect(result.status).toBe("passed");
    expect(motionLog(app)).toEqual(["startFrames", "tap go+50,20 {}", "stopFrames"]);
    expect(result.metrics).toEqual({ "frames.fps": [120], "frames.dropped": [0] });
    // `for` keeps counting after the command, sending the app nothing until then.
    const started = performance.now();
    const held = await run("- launchApp\n- assertFrames: { during: { tapOn: { id: go } }, for: 300ms, dropped: 0 }", motionApp());
    expect(held.result.status).toBe("passed");
    expect(performance.now() - started).toBeGreaterThanOrEqual(300);
    expect(motionLog(held.app)).toEqual(["startFrames", "tap go+50,20 {}", "stopFrames"]);
    const dropping = motionApp();
    dropping.frames = { ...FRAMES, droppedFrames: 3, fps: 90, maxFrameGapMs: 33.4 };
    expect((await run("- launchApp\n- assertFrames: { during: { tapOn: { id: go } }, fps: { min: 110 }, dropped: 0 }", dropping)).result.failure).toMatchObject({
      kind: "assertion", message: "90 fps is below 110; 3 frames dropped, more than 0 (61 frames over 500 ms at 120 Hz; longest gap 33.4 ms)",
    });
    const blind = motionApp();
    blind.frames = new DriverError("E_UNAVAILABLE", "The display link delivered 1 frames, so frame timing could not be measured");
    expect((await run("- launchApp\n- assertFrames: { during: { tapOn: { id: go } }, dropped: 0 }", blind)).result.failure).toMatchObject({ kind: "unsupported" });
    const broken = motionApp();
    expect((await run("- launchApp\n- assertFrames: { during: { tapOn: { id: missing } }, dropped: 0 }", broken)).result.failure?.kind).toBe("not-found");
    expect(motionLog(broken).filter(line => !line.startsWith("capture")).at(-1)).toBe("stopFrames");
  });
});

describe("unsupported and invalid", () => {
  test.each([
    ["- assertA11y: { id: save, hint: Saves }", "assertA11y hint is not supported by backend driver"],
    ["- selectMenu: File > Open", "selectMenu needs a black-box backend (active: driver (driver)); backend driver cannot run it in-process"],
    ["- hoverOn: { id: save, duration: 1s }", "hoverOn duration is not supported by backend driver"],
    ["- scroll: { on: { id: list }, momentum: true }", "scroll momentum is not supported by backend driver"],
    ["- scroll: { direction: down }", "backend driver scrolls only `on` a target"],
    ["- swipe: { direction: up }", "backend driver swipes only `from` a target"],
    ["- swipe: { from: { id: list }, direction: up, fingers: 3 }", "backend driver swipes with one or two fingers (a scroll)"],
    ["- dragAndDrop: { from: { id: save }, to: { id: list }, holdAt: 1s }", "dragAndDrop holdAt is not supported by backend driver"],
    ["- assertText: { id: save, equals: x, lineEndings: crlf }", "assertText lineEndings is not supported by backend driver"],
    ["- pressKey: MediaPlayPause", "backend driver cannot press MediaPlayPause"],
    ["- pressKey: capslock+a", "backend driver cannot press capslock+a"],
    ["- killApp", "killApp is not supported by backend driver"],
    ["- assertStartup: { coldMs: { max: 900 } }", "assertStartup is not supported by backend driver"],
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
