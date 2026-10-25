import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { Failure, type Backend, type Element } from "../scripts/e2e/runner/backend.ts";
import { expandMatrix, ms, runFlows, type FlowResult, type RunOptions } from "../scripts/e2e/runner/executor.ts";
import { buildReport, html, junit } from "../scripts/e2e/runner/report.ts";
import { runCommand } from "../scripts/e2e/runner/run.ts";
import { filterElements, locate, nearby, parseSelector, type Finder } from "../scripts/e2e/runner/selectors.ts";
import { element, MemoryBackend, VirtualClock, WINDOW } from "./e2e-runner-backend.ts";

const flow = (commands: string, header = "") => `appId: so.legend.kitchensink\nname: Test flow\nintent: The test intent.\n${header}---\n${commands}`;

/** Writes files under a fresh e2e root and returns it. Flows go under flows/. */
function root(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "e2e-runner-"));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

async function run(source: string, backends: Backend[], options: Partial<RunOptions> & { files?: Record<string, string> } = {}) {
  const dir = root({ "flows/area/test.yaml": source, ...options.files });
  const clock = (backends[0] as MemoryBackend).clock;
  const results = await runFlows([path.join(dir, "flows/area/test.yaml")], { backends, runDir: path.join(dir, "run"), clock, ...options });
  return { results, result: results[0]!, dir };
}

const memory = (options: ConstructorParameters<typeof MemoryBackend>[1] = {}) => new MemoryBackend(new VirtualClock(), options);

describe("implicit waits and timeouts", () => {
  test("a command waits for its target to appear", async () => {
    const backend = memory({ elements: [element("later", { text: "Later", from: 1200 })] });
    const { result } = await run(flow("- assertVisible: Later\n- tapOn: Later"), [backend]);
    expect(result.status).toBe("passed");
    expect(backend.log).toEqual(["start", "tapOn later", "stop"]);
    expect(result.steps[0]!.durationMs).toBe(1200);
  });

  test("the default wait is 5s, and a miss reports nearby candidates and artifacts", async () => {
    const backend = memory({ elements: [element("save", { text: "Save", role: "button" }), element("cancel", { text: "Cancel" })] });
    const { result } = await run(flow("- tapOn: Sav"), [backend]);
    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({ kind: "not-found", command: "tapOn", message: 'no element matches {"text":"Sav"} (waited 5000ms on memory)', location: { line: 5, column: 3 } });
    expect(result.failure!.candidates[0]).toEqual({ window: "w1", text: "Save", role: "button", frame: { x: 0, y: 0, width: 100, height: 20 } });
    expect(result.steps[0]!.durationMs).toBe(5000);
    expect(result.failure!.artifacts.map(artifact => [artifact.kind, path.basename(artifact.path), artifact.backend])).toEqual([
      ["elements", "elements-memory.json", "memory"], ["screenshot", "memory-screenshot.png", "memory"], ["logs", "memory.log", "memory"],
    ]);
    const dump = JSON.parse(readFileSync(result.failure!.artifacts[0]!.path, "utf8"));
    expect(dump.windows).toEqual([WINDOW]);
    expect(dump.elements.map((item: Element) => item.key)).toEqual(["save", "cancel"]);
  });

  test("a command's timeout overrides the implicit wait", async () => {
    const backend = memory({ elements: [element("later", { text: "Later", from: 1200 })] });
    const { result } = await run(flow("- assertVisible: { text: Later, timeout: 1s }"), [backend]);
    expect(result.failure).toMatchObject({ kind: "not-found", message: expect.stringContaining("waited 1000ms") });
  });

  test("assertNotVisible and extendedWaitUntil wait for the state", async () => {
    const backend = memory({ elements: [element("spinner", { id: "spinner", until: 2500 }), element("done", { text: "Done", from: 7000 })] });
    const { result } = await run(flow("- assertNotVisible: { id: spinner }\n- extendedWaitUntil: { visible: Done, timeout: 10000 }\n- extendedWaitUntil: { notVisible: { id: spinner } }"), [backend]);
    expect(result.status).toBe("passed");
    expect(result.steps.map(step => step.durationMs)).toEqual([2500, 4500, 0]);
  });

  test("the flow timeout bounds the whole flow", async () => {
    const backend = memory({ elements: [element("x", { text: "X" })] });
    const { result } = await run(flow("- repeat: { while: { visible: X }, commands: [ { tapOn: X } ] }", "timeout: 1s\n"), [backend]);
    expect(result.failure).toMatchObject({ kind: "timeout", message: "the flow exceeded its 1000ms timeout" });
  });
});

describe("zero retries", () => {
  test("a failed action runs once, stops the flow, and the flow is not rerun", async () => {
    let calls = 0;
    const backend = memory({ elements: [element("go", { text: "Go" })], commands: { pressKey: async () => { calls++; throw new Error("key event rejected"); } } });
    const { results, result } = await run(flow("- pressKey: Enter\n- tapOn: Go"), [backend]);
    expect(calls).toBe(1);
    expect(results).toHaveLength(1);
    expect(result.failure).toMatchObject({ kind: "error", message: "key event rejected", command: "pressKey" });
    expect(result.steps.map(step => step.command)).toEqual(["pressKey"]);
  });

  test("eventually retries assertion failures until the timeout, never other errors", async () => {
    let checks = 0;
    const backend = memory({
      commands: {
        assertDockBadge: async (args, context) => context.eventually(async () => { checks++; if (backend.clock.now() < 300) throw new Failure("assertion", "badge is 2"); }),
        assertDockProgress: async (_args, context) => context.eventually(async () => { checks++; throw new Error("dock unavailable"); }),
      },
    });
    const { result } = await run(flow("- assertDockBadge: 3\n- assertDockProgress: 0.5"), [backend]);
    expect(checks).toBe(5);
    expect(result.failure).toMatchObject({ kind: "error", command: "assertDockProgress" });
  });
});

describe("selectors", () => {
  const items: Element[] = [
    { key: "sidebar", window: "w1", id: "sidebar", frame: { x: 0, y: 0, width: 200, height: 600 } },
    { key: "row1", parent: "sidebar", window: "w1", text: "Row 3", role: "cell", frame: { x: 0, y: 100, width: 200, height: 20 } },
    { key: "row2", window: "w1", text: "Row 3", role: "cell", frame: { x: 300, y: 50, width: 200, height: 20 } },
    { key: "user", window: "w1", text: "Username", frame: { x: 300, y: 200, width: 100, height: 20 } },
    { key: "field", window: "w1", role: "textField", frame: { x: 300, y: 230, width: 200, height: 20 } },
    { key: "far", window: "w1", role: "textField", frame: { x: 300, y: 400, width: 200, height: 20 } },
    { key: "close", window: "w2", role: "button", label: "Close", id: "close", frame: { x: 900, y: 10, width: 20, height: 20 } },
    { key: "heart", window: "w1", text: "❤️ 13", frame: { x: 10, y: 500, width: 40, height: 20 } },
    { key: "settings", window: "w1", text: "Settings…", frame: { x: 10, y: 550, width: 40, height: 20 } },
  ];
  const windows = [WINDOW, { id: "w2", title: "notes.md", key: false, main: false, frame: { x: 850, y: 0, width: 400, height: 300 } }];
  const finder: Finder = { find: async (atom, scope) => filterElements(items, atom, scope), windows: async () => windows };
  const keys = async (value: unknown) => (await locate(parseSelector(value, "macos"), finder)).matches.map(item => item.key);

  test("text, regex, id, role and label", async () => {
    expect(await keys("Row 3")).toEqual(["row2", "row1"]); // reading order: top to bottom
    expect(await keys("/❤️ \\d+/")).toEqual(["heart"]);
    expect(await keys({ id: "sidebar" })).toEqual(["sidebar"]);
    expect(await keys({ role: "button", label: "Close" })).toEqual(["close"]);
    expect(await keys({ text: "Row", role: "cell" })).toEqual([]);
  });

  test("within, index, window and relations", async () => {
    expect(await keys({ text: "Row 3", within: { id: "sidebar" } })).toEqual(["row1"]);
    expect(await keys({ text: "Row 3", index: 1 })).toEqual(["row1"]);
    expect(await keys({ role: "button", window: { title: "notes.md" } })).toEqual(["close"]);
    expect(await keys({ role: "button", window: "key" })).toEqual([]);
    expect(await keys({ below: "Username", role: "textField" })).toEqual(["field"]); // nearest wins
    expect(await keys({ below: "Username", role: "textField", index: 1 })).toEqual(["far"]);
    expect(await keys({ rightOf: { id: "sidebar" }, text: "Row 3" })).toEqual(["row2"]);
  });

  test("point is relative to its container", async () => {
    const located = await locate(parseSelector({ point: "50%,10%", within: { id: "sidebar" } }, "macos"), finder);
    expect(located).toEqual({ matches: [items[0]], point: { x: 100, y: 60 } });
    expect((await locate(parseSelector({ point: "10,20", window: { title: "notes.md" } }, "macos"), finder)).point).toEqual({ x: 860, y: 20 });
  });

  test("platform-specific text picks the running platform and fails without a variant", async () => {
    expect((await locate(parseSelector({ text: { macos: "Settings…", windows: "Options" } }, "macos"), finder)).matches.map(item => item.key)).toEqual(["settings"]);
    expect(() => parseSelector({ text: { macos: "Settings…" } }, "windows")).toThrow('text has no windows variant');
  });

  test("an inner part that is missing or ambiguous is reported as the problem", async () => {
    expect((await locate(parseSelector({ text: "Row 3", within: { id: "nope" } }, "macos"), finder)).problem).toEqual({ part: { id: "nope" }, found: [] });
    expect((await locate(parseSelector({ below: "Row 3", role: "textField" }, "macos"), finder)).problem?.found.map(item => item.key)).toEqual(["row2", "row1"]);
  });

  test("nearby candidates rank by closeness of id, label and text", () => {
    expect(nearby(parseSelector("Usernme", "macos"), items).map(item => item.text)[0]).toBe("Username");
    expect(nearby(parseSelector({ role: "textField" }, "macos"), items).map(item => item.role)).toEqual(["textField", "textField"]);
  });

  test("window-taking commands resolve one window with the same semantics", async () => {
    const windows = [WINDOW, { id: "w2", title: "notes.md", type: "document", key: false, main: false, frame: WINDOW.frame }, { id: "w3", title: "todo.md", type: "document", key: false, main: false, frame: WINDOW.frame }];
    const backend = memory({ windows, commands: { closeWindow: async (args, context) => { backend.log.push(`close ${(await context.window(args.window ?? "key")).id}`); } } });
    const { result } = await run(flow("- closeWindow\n- closeWindow: { window: { title: notes.md } }\n- closeWindow: { window: { type: document, index: 1 } }\n- closeWindow: { window: { type: document }, timeout: 300ms }"), [backend]);
    expect(backend.log.filter(entry => entry.startsWith("close"))).toEqual(["close w1", "close w2", "close w3"]);
    expect(result.failure).toMatchObject({ kind: "ambiguous", message: 'window {"type":"document"} matches "notes.md", "todo.md"' });
  });

  test("ambiguous targets fail with every match; index picks one", async () => {
    const backend = memory({ elements: [element("a", { text: "Row" }), element("b", { text: "Row", frame: { x: 0, y: 40, width: 100, height: 20 } })] });
    const { result } = await run(flow("- tapOn: { text: Row, index: 1 }\n- tapOn: Row"), [backend]);
    expect(backend.log).toContain("tapOn b");
    expect(result.failure).toMatchObject({ kind: "ambiguous", command: "tapOn", message: expect.stringContaining("matches 2 elements") });
    expect(result.failure!.matches.map(match => match.text)).toEqual(["Row", "Row"]);
  });
});

describe("conditions, matrix and variables", () => {
  test("when: platform, matrix, visible and notVisible", async () => {
    const backend = memory({ matrix: ["appearance"], elements: [element("a", { text: "A" }), element("b", { text: "B" })] });
    const { results } = await run(flow([
      "- tapOn: { text: A, when: { platform: windows } }",
      "- tapOn: { text: A, when: { matrix: { appearance: dark } } }",
      "- tapOn: { text: B, when: { visible: A, notVisible: Missing } }",
      "- tapOn: { text: B, when: { notVisible: A } }",
    ].join("\n"), "matrix: { appearance: [light, dark] }\n"), [backend]);
    expect(results.map(result => [result.id, result.status])).toEqual([["flows/area/test[appearance=light]", "passed"], ["flows/area/test[appearance=dark]", "passed"]]);
    expect(results[0]!.steps.map(step => step.status)).toEqual(["skipped", "skipped", "passed", "skipped"]);
    expect(backend.log.filter(entry => entry.startsWith("tapOn"))).toEqual(["tapOn b", "tapOn a", "tapOn b"]);
    expect(backend.sessions.map(session => session.matrix)).toEqual([{ appearance: "light" }, { appearance: "dark" }]);
  });

  test("matrix expansion is the product of the header dimensions", () => {
    expect(expandMatrix({ appearance: ["light", "dark"], reduceMotion: [false, true] })).toEqual([
      { appearance: "light", reduceMotion: false }, { appearance: "light", reduceMotion: true }, { appearance: "dark", reduceMotion: false }, { appearance: "dark", reduceMotion: true },
    ]);
    expect(expandMatrix(undefined)).toEqual([{}]);
    expect([ms("120ms"), ms("1.5s"), ms("2m"), ms(250)]).toEqual([120, 1500, 120000, 250]);
  });

  test("a matrix dimension no backend applies is an unsupported failure", async () => {
    const backend = memory();
    const { result } = await run(flow("- tapOn: A", "matrix: { locale: [en, ar] }\n"), [backend]);
    expect(result.failure).toMatchObject({ kind: "unsupported", message: "no active backend applies matrix dimension locale (active: memory)" });
    expect(backend.log).toEqual([]);
  });

  test("${VAR} comes from runner variables, header env and runFlow env", async () => {
    const seen: unknown[] = [];
    const backend = memory({ commands: { createFixture: async args => { seen.push(args.path, args.contents); } } });
    const { result, dir } = await run(flow([
      "- createFixture: { path: \"${FIXTURES}/a.txt\", contents: \"${GREETING} ${TMP}\" }",
      "- runFlow: { file: subflows/make.yaml, env: { NAME: sub } }",
      "- runFlow: { env: { GREETING: inline }, commands: [ { createFixture: { path: \"${GREETING}\" } } ] }",
    ].join("\n"), "env: { GREETING: hi, WHERE: \"${FIXTURES}\" }\n"), [backend], { files: { "subflows/make.yaml": "- createFixture: { path: \"${WHERE}/${NAME}\" }\n" } });
    expect(result.status).toBe("passed");
    const tmp = path.join(dir, "run/flows/area/test/run/tmp");
    expect(seen).toEqual([path.join(dir, "fixtures/a.txt"), `hi ${tmp}`, `${path.join(dir, "fixtures")}/sub`, undefined, "inline", undefined]);
    expect(existsSync(tmp)).toBe(true);
  });

  test("an undefined variable fails the command", async () => {
    const { result } = await run(flow("- launchApp: { openFile: \"${NOPE}/a\" }"), [memory({ commands: { launchApp: async () => {} } })]);
    expect(result.failure).toMatchObject({ kind: "invalid", command: "launchApp", message: expect.stringMatching(/^\$\{NOPE\} is not defined \(defined: FIXTURES, TMP\)$/) });
  });
});

describe("control flow", () => {
  test("runFlow resolves paths, reports the call site, and rejects cycles", async () => {
    const files = {
      "subflows/outer.yaml": "- runFlow: ./inner.yaml\n",
      "subflows/inner.yaml": "- tapOn: Missing\n",
      "subflows/loop.yaml": "- runFlow: ./loop.yaml\n",
    };
    const { result } = await run(flow("- runFlow: subflows/outer.yaml"), [memory()], { files });
    expect(result.failure).toMatchObject({ kind: "not-found", command: "tapOn", location: { file: expect.stringContaining("inner.yaml"), line: 1 } });
    expect(result.failure!.stack.map(location => [path.basename(location.file), location.line])).toEqual([["test.yaml", 5], ["outer.yaml", 1]]);
    expect(result.steps.map(step => [step.command, step.depth, step.status])).toEqual([["runFlow", 0, "failed"], ["runFlow", 1, "failed"], ["tapOn", 2, "failed"]]);
    const cycle = await run(flow("- runFlow: subflows/loop.yaml"), [memory()], { files });
    expect(cycle.result.failure).toMatchObject({ kind: "invalid", message: expect.stringContaining("runFlow cycle") });
  });

  test("runFlow reports an invalid subflow as a format failure", async () => {
    const { result } = await run(flow("- runFlow: subflows/bad.yaml"), [memory()], { files: { "subflows/bad.yaml": "- tapOnn: X\n" } });
    expect(result.failure).toMatchObject({ kind: "format", message: expect.stringContaining('did you mean "tapOn"') });
  });

  test("repeat runs times, and stops when while no longer holds", async () => {
    const backend = memory({ elements: [element("more", { text: "More", until: 250 }), element("x", { text: "X" })] });
    const { result } = await run(flow("- repeat: { times: 3, commands: [ { tapOn: X } ] }\n- repeat: { while: { visible: More }, commands: [ { tapOn: X }, { assertVisible: { text: Nope, timeout: 100, when: { platform: windows } } } ] }"), [backend]);
    expect(result.status).toBe("passed");
    expect(backend.log.filter(entry => entry === "tapOn x")).toHaveLength(3 + 2); // each tap takes 50ms; More is gone at 250ms
  });

  test("onFlowComplete runs after a failure, and nested commands run through context.run", async () => {
    const backend = memory({
      elements: [element("x", { text: "X" })],
      kind: "driver",
      commands: { measure: async (args, context) => { backend.log.push("measure start"); await context.run(args.run as never); backend.log.push("measure end"); } },
    });
    const blackBox = new MemoryBackend(backend.clock, { name: "ax", elements: [element("x", { text: "X" })] });
    const { result } = await run(flow("- measure: { name: m, run: [ { tapOn: X } ] }\n- tapOn: Missing", "onFlowComplete: [ { tapOn: X } ]\n"), [blackBox, backend]);
    expect(backend.log).toEqual(["start", "measure start", "measure end", "stop"]);
    expect(blackBox.log).toEqual(["start", "tapOn x", "tapOn x", "stop"]);
    expect(result.failure).toMatchObject({ command: "tapOn", kind: "not-found" });
  });
});

describe("dispatch", () => {
  test("a command missing from the backend's table is a typed unsupported failure", async () => {
    const { result } = await run(flow("- openWindow"), [memory()]);
    expect(result.failure).toMatchObject({ kind: "unsupported", command: "openWindow", message: "openWindow is not supported by backend memory" });
  });

  test("driver commands need a driver backend; black-box commands never run on one", async () => {
    const blackBox = memory({ commands: { takeScreenshot: async () => {} } });
    expect((await run(flow("- takeScreenshot: shot"), [blackBox])).result.failure?.message).toBe("takeScreenshot needs a driver backend (active: memory (black-box))");
    const driver = memory({ kind: "driver", name: "driver", elements: [element("x", { text: "X" })] });
    expect((await run(flow("- tapOn: X"), [driver])).result.failure?.message).toBe("tapOn needs a black-box backend (active: driver (driver))");
    expect((await run(flow("- assertVisible: X"), [driver])).result.failure?.message).toBe("assertVisible needs a black-box backend (active: driver)");
  });

  test("lifecycle commands may run on a driver backend; selectors use only its query keys", async () => {
    const driver = new MemoryBackend(new VirtualClock(), {
      kind: "driver", name: "driver", collect: false,
      commands: { launchApp: async () => { driver.log.push("launch"); }, captureMotion: async (args, context) => { driver.log.push(`motion ${(await context.resolve(args.target)).element.key}`); } },
    });
    Object.assign(driver, { elements: undefined, queryKeys: new Set(["id"]), query: async (atom: { id?: string }) => atom.id === "sheet" ? [element("sheet", { id: "sheet" })] : [] });
    const ok = await run(flow("- launchApp\n- captureMotion: { target: { id: sheet }, name: open }"), [driver]);
    expect(ok.result.status).toBe("passed");
    expect(driver.log).toEqual(["start", "launch", "motion sheet", "stop"]);
    const unsupported = await run(flow("- captureMotion: { target: Sheet, name: open }"), [driver]);
    expect(unsupported.result.failure).toMatchObject({ kind: "unsupported", message: "backend driver cannot select by text" });
  });
});

describe("restoration", () => {
  test("undos run last-in first-out on failure, before backends stop", async () => {
    const backend = memory({
      commands: { setAccentColor: async (args, context) => { context.onRestore("accent", async () => { backend.log.push("restore accent"); }); } },
    });
    const { result } = await run(flow("- setAppearance: dark\n- setAccentColor: purple\n- tapOn: Missing"), [backend]);
    expect(result.status).toBe("failed");
    expect(backend.log).toEqual(["start", "setAppearance dark", "restore accent", "restore appearance", "stop"]);
  });

  test("a failed restoration fails a passing flow, and the remaining undos still run", async () => {
    const backend = memory({
      commands: { setAccentColor: async (_args, context) => { context.onRestore("accent", async () => { throw new Error("defaults write failed"); }); } },
    });
    const { result } = await run(flow("- setAppearance: dark\n- setAccentColor: purple"), [backend]);
    expect(result.failure).toMatchObject({ kind: "restore", message: "restore accent: defaults write failed" });
    expect(backend.log).toContain("restore appearance");
  });

  test("an interrupted run still restores", async () => {
    const controller = new AbortController();
    const backend = memory({ commands: { setAccentColor: async () => { controller.abort(); } } });
    const { result } = await run(flow("- setAppearance: dark\n- setAccentColor: purple\n- setAppearance: light"), [backend], { signal: controller.signal });
    expect(result.failure).toMatchObject({ kind: "interrupted", command: "setAppearance" });
    expect(backend.log).toEqual(["start", "setAppearance dark", "restore appearance", "stop"]);
  });
});

describe("flows that do not run", () => {
  test("a flow for another platform is skipped with the reason", async () => {
    const backend = memory();
    const { result } = await run(flow("- tapOn: X", "platforms: [windows]\n"), [backend]);
    expect(result).toMatchObject({ status: "skipped", skipReason: "platforms: windows (running macos)" });
    expect(backend.log).toEqual([]);
  });

  test("an invalid flow is a format failure with every diagnostic", async () => {
    const { result } = await run("appId: x\n---\n- tapOn: X\n", [memory()]);
    expect(result.failure).toMatchObject({ kind: "format", diagnostics: [expect.stringContaining('missing required key "name"')] });
  });
});

describe("reports", () => {
  async function sample() {
    const backend = memory({
      elements: [element("ok", { text: "OK <b>" })],
      kind: "black-box",
      commands: { takeScreenshot: async () => {} },
    });
    const driver = new MemoryBackend(backend.clock, {
      name: "driver", kind: "driver", collect: false,
      commands: { takeScreenshot: async (args, context) => { const file = path.join(context.outputDir, `${args.name}.png`); writeFileSync(file, "png"); context.addArtifact({ kind: "output", path: file }); } },
    });
    const dir = root({
      "flows/a/pass.yaml": flow("- takeScreenshot: home\n- tapOn: \"OK <b>\""),
      "flows/a/fail.yaml": flow("- tapOn: Nope"),
      "flows/a/skip.yaml": flow("- tapOn: X", "platforms: [windows]\n"),
    });
    const runDir = path.join(dir, "run");
    const results = await runFlows(["pass", "fail", "skip"].map(name => path.join(dir, `flows/a/${name}.yaml`)), { backends: [backend, driver], runDir, clock: backend.clock });
    return { report: buildReport(results, { startedAt: new Date("2026-10-10T00:00:00Z"), durationMs: 5123, backends: [backend, driver], runDir, interrupted: false }), runDir };
  }

  test("JSON report: summary, results and artifact paths relative to the run directory", async () => {
    const { report } = await sample();
    expect(report).toMatchObject({ version: 1, platform: "macos", backends: [{ name: "memory", kind: "black-box" }, { name: "driver", kind: "driver" }], summary: { total: 3, passed: 1, failed: 1, skipped: 1 } });
    const [pass, fail] = report.flows as [FlowResult, FlowResult];
    expect(pass.artifacts).toEqual([{ kind: "output", path: "flows/a/pass/run/output/home.png", backend: "driver" }]);
    expect(fail.failure!.artifacts.map(artifact => artifact.path)).toEqual(["flows/a/fail/run/failure/elements-memory.json", "flows/a/fail/run/failure/memory-screenshot.png", "flows/a/fail/run/failure/memory.log", "flows/a/fail/run/failure/elements-driver.json"]);
    expect(fail).toMatchObject({ id: "flows/a/fail", name: "Test flow", intent: "The test intent.", checks: [], tags: [] });
  });

  test("JUnit: one suite per file, failures and skips", async () => {
    const xml = junit((await sample()).report);
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<testsuites name="e2e" tests="3" failures="1" skipped="1" time="5.123">/);
    expect(xml).toContain('<failure type="not-found" message="no element matches {&quot;text&quot;:&quot;Nope&quot;} (waited 5000ms on memory)">');
    expect(xml).toContain("artifact screenshot (memory): flows/a/fail/run/failure/memory-screenshot.png");
    expect(xml).toContain('<skipped message="platforms: windows (running macos)"/>');
    expect(xml.match(/<testsuite /g)).toHaveLength(3);
  });

  test("HTML: escaped, failed flows open, screenshots inline", async () => {
    const page = html((await sample()).report);
    expect(page).toContain('<details class="failed" open>');
    expect(page).toContain('<img src="flows/a/fail/run/failure/memory-screenshot.png"');
    expect(page).toContain("OK &lt;b&gt;");
    expect(page).not.toContain("OK <b>");
  });
});

describe("e2e:run", () => {
  const clock = new VirtualClock();
  const memory = (options: ConstructorParameters<typeof MemoryBackend>[1] = {}) => new MemoryBackend(clock, options);
  function io(backends: Record<string, () => Backend>) {
    const out: string[] = [], err: string[] = [];
    return { out, err, io: { backends, stdout: (line: string) => out.push(line), stderr: (line: string) => err.push(line), clock } };
  }

  test("--agent prints JSON lines with intent, failing command, candidates and absolute artifact paths, and writes reports", async () => {
    const dir = root({ "flows/a/fail.yaml": flow("- tapOn: Sav"), "flows/a/pass.yaml": flow("- tapOn: Save") });
    const report = path.join(dir, "report");
    const { out, io: options } = io({ memory: () => memory({ elements: [element("save", { text: "Save" })] }) });
    expect(await runCommand([path.join(dir, "flows"), "--agent", "--report", report, "--backend", "memory"], options)).toBe(1);
    const events = out.map(line => JSON.parse(line));
    expect(events.map(event => event.event)).toEqual(["run-start", "flow-start", "flow-end", "flow-start", "flow-end", "run-end"]);
    const failed = events[2];
    expect(failed).toMatchObject({ id: "flows/a/fail", status: "failed", intent: "The test intent.", failure: { command: "tapOn", kind: "not-found", location: expect.stringMatching(/fail\.yaml:5:3$/) } });
    expect(failed.failure.candidates).toEqual([expect.objectContaining({ text: "Save" })]);
    expect(failed.failure.artifacts.every((artifact: { path: string }) => path.isAbsolute(artifact.path) && existsSync(artifact.path))).toBe(true);
    expect(failed.steps).toBeUndefined();
    expect(events[5]).toMatchObject({ summary: { total: 2, passed: 1, failed: 1, skipped: 0 }, reports: { json: path.join(report, "report.json") } });
    for (const file of ["report.json", "junit.xml", "index.html"]) expect(existsSync(path.join(report, file))).toBe(true);
  });

  test("human output and exit code 0 when every flow passes", async () => {
    const dir = root({ "flows/a/pass.yaml": flow("- tapOn: Save") });
    const { out, io: options } = io({ memory: () => memory({ elements: [element("save", { text: "Save" })] }) });
    expect(await runCommand([path.join(dir, "flows/a/pass.yaml"), "--report", path.join(dir, "r")], options)).toBe(0);
    expect(out[0]).toBe("PASS flows/a/pass (50ms)");
    expect(out[1]).toMatch(/^1 passed, 0 failed, 0 skipped\. Report: /);
  });

  test("usage errors exit 2", async () => {
    const dir = root({ "flows/a/pass.yaml": flow("- tapOn: Save"), "subflows/s.yaml": "- tapOn: X\n" });
    const cases: Array<[string[], Record<string, () => Backend>, string]> = [
      [[dir], {}, "no backends are available yet: the macOS black-box backend lands with #50 and the in-app driver adapter with #52"],
      [[dir, "--backend", "nope"], { memory: () => memory() }, "unknown backend nope (available: memory)"],
      [[dir, "--frobnicate"], { memory: () => memory() }, "unknown option --frobnicate"],
      [[path.join(dir, "subflows/s.yaml")], { memory: () => memory() }, "not a flow"],
      [[dir, "--backend", "a,b"], { a: () => memory(), b: () => memory({ platform: "windows" }) }, "backends target different platforms: macos, windows"],
    ];
    for (const [args, backends, message] of cases) {
      const { err, io: options } = io(backends);
      expect(await runCommand(args, options)).toBe(2);
      expect(err.join("\n")).toContain(message);
    }
  });
});
