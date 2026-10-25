import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { SdkSurface } from "../scripts/api-surface.ts";
import { checkBudgets, checkGate, checkSignoffs, formatDiagnostic } from "../scripts/e2e/format/parser.ts";
import { gateCommand, runGate, type GateEnv, type GateReport } from "../scripts/e2e/gate/gate.ts";
import { plan, type Host } from "../scripts/e2e/gate/plan.ts";
import type { Backend, CommandHandler } from "../scripts/e2e/runner/backend.ts";
import { BACKENDS, NO_BACKENDS } from "../scripts/e2e/runner/run.ts";
import { element, MemoryBackend, VirtualClock } from "./e2e-runner-backend.ts";

const FIXTURE = "tests/fixtures/e2e-gate";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const AIR: Host = { os: "macos-14", arch: "arm64", model: 'MacBookAir10,1', memoryGB: 8 };
const SURFACE: SdkSurface = { "./app": { values: ["launch", "setTheme"], types: [], flags: {} } };
const ELEMENTS = [element("catalog", { id: "catalog" }), element("toggle", { id: "theme-toggle" })];

/** A copy of the green fixture repository with the release build in place (unless `build: false`), plus files to add: path → content. */
function repo(edits: Record<string, string> = {}, { build = true } = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "e2e-gate-"));
  cpSync(FIXTURE, dir, { recursive: true });
  if (build) mkdirSync(path.join(dir, "build/macos-arm64/KitchenSink.app"), { recursive: true });
  for (const [file, content] of Object.entries(edits)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  }
  return dir;
}
const edit = (dir: string, file: string, from: string | RegExp, to: string) => writeFileSync(path.join(dir, file), readFileSync(path.join(dir, file), "utf8").replace(from, to));

/** The runner's in-memory test backends (tests/e2e-runner-backend.ts): a black-box app and a driver that records startup time. */
function env(options: { coldMs?: number | null; elements?: typeof ELEMENTS; blackBox?: Record<string, CommandHandler>; host?: Host } & Partial<Omit<GateEnv, "host">> = {}) {
  const { coldMs, elements, blackBox, host, ...rest } = options;
  const clock = new VirtualClock(), out: string[] = [], err: string[] = [];
  const launchApp: CommandHandler = async () => { await clock.sleep(100); };
  const gateEnv: GateEnv = {
    backends: {
      app: () => new MemoryBackend(clock, { name: "app", matrix: ["appearance"], elements: elements ?? ELEMENTS, commands: { launchApp, ...blackBox } }),
      driver: () => new MemoryBackend(clock, {
        name: "driver", kind: "driver",
        commands: { assertStartup: async (_args, context) => { if (coldMs !== null) context.metric("startup.coldMs", coldMs ?? 690); } },
      }),
    },
    host: () => host ?? AIR,
    source: () => ({ commit: COMMIT, dirty: false }),
    verifySignature: () => undefined,
    surface: () => SURFACE,
    stdout: line => out.push(line),
    stderr: line => err.push(line),
    clock,
    ...rest,
  };
  return { env: gateEnv, out, err };
}

async function gate(dir: string, options: Parameters<typeof env>[0] = {}, target?: string): Promise<GateReport> {
  const { env: gateEnv } = env(options);
  return runGate(plan(path.join(dir, "e2e"), gateEnv.host(), target), gateEnv);
}
const reasons = (report: GateReport) => report.reasons.map(reason => `${reason.check}: ${reason.message}`);

describe("release gate", () => {
  test("a fully green tree passes and writes one JSON + HTML report", async () => {
    const dir = repo();
    const { env: gateEnv, out } = env();
    expect(await gateCommand([], path.join(dir, "e2e"), gateEnv)).toBe(0);
    const report: GateReport = JSON.parse(readFileSync(path.join(dir, "reports/gate/report.json"), "utf8"));
    expect(report).toMatchObject({ verdict: "PASS", reasons: [], warnings: [], target: "macos-14/arm64@air-m1", machine: "air-m1", commit: COMMIT, backends: ["app", "driver"] });
    expect(report.build).toEqual({ artifact: "build/macos-arm64/KitchenSink.app", exists: true, signature: "verified" });
    expect(report.coverage).toEqual({ required: 3, covered: 3, problems: 0 });
    expect(report.flows.map(flow => [flow.id, flow.status, flow.blocking])).toEqual([
      ["flows/app/ime", "signed-off", true],
      ["flows/app/launch", "passed", true],
      ["flows/app/theme[appearance=light]", "passed", true],
      ["flows/app/theme[appearance=dark]", "passed", true],
    ]);
    expect(report.excluded).toEqual([{ path: "flows/app/taskbar.yaml", reason: "platforms: windows" }]);
    expect(report.budgets).toEqual([{ metric: "startup.coldMs", flow: "flows/app/launch", machine: "air-m1", better: "lower", baseline: 700, limit: 770, value: 690, blocking: true, status: "pass" }]);
    expect(report.run).toBe("reports/gate/run");
    expect(existsSync(path.join(dir, "reports/gate/run/report.json"))).toBe(true);
    const html = readFileSync(path.join(dir, "reports/gate/index.html"), "utf8");
    expect(html).toContain('<span class="verdict PASS">PASS</span>');
    expect(html).toContain('<a href="run/index.html">run report</a>');
    expect(out.at(-1)).toMatch(/^Gate PASS on macos-14\/arm64@air-m1: 0 reasons\. Report: /);
  });

  test("with the production backend table (empty until #50 and #226), the gate fails instead of passing vacuously", async () => {
    const dir = repo();
    const { env: gateEnv, out } = env({ backends: BACKENDS });
    expect(Object.keys(BACKENDS)).toEqual([]);
    expect(await gateCommand([], path.join(dir, "e2e"), gateEnv)).toBe(1);
    const report: GateReport = JSON.parse(readFileSync(path.join(dir, "reports/gate/report.json"), "utf8"));
    expect(report.verdict).toBe("FAIL");
    expect(reasons(report)).toEqual([`backend: ${NO_BACKENDS}`, "budgets: 1 budget for air-m1 not checked: no flows ran"]);
    expect(report.flows.filter(flow => !flow.manual).map(flow => flow.status)).toEqual(["not-run", "not-run", "not-run"]);
    expect(out.join("\n")).toContain(`[backend] ${NO_BACKENDS}`);
  });

  test("backends for another platform only are no backend", async () => {
    const clock = new VirtualClock();
    const report = await gate(repo(), { backends: { win: () => new MemoryBackend(clock, { name: "win", platform: "windows" }) } });
    expect(reasons(report)).toContain("backend: no macos backend is registered (registered: win)");
  });

  test("lint and validation problems anywhere in e2e/ fail", async () => {
    const dir = repo();
    edit(dir, "e2e/flows/app/theme.yaml", "- tapOn: { id: theme-toggle }", "- tapOn: { id: theme-toggle }\n- sleep: 1s");
    expect(reasons(await gate(dir))).toContainEqual(expect.stringMatching(/^lint: bun run e2e:lint found 1 problem:\n.*theme\.yaml:9:3: "sleep" is not a command.*\[no-sleep\]$/));
  });

  test("coverage problems and uncovered SDK surface fail", async () => {
    const dir = repo();
    edit(dir, "e2e/checks/app.yaml", "  APP-IME-01:", "  APP-ORPHAN-01:\n    title: Nothing verifies this\n  APP-IME-01:");
    const report = await gate(dir, { surface: () => ({ "./app": { values: ["launch", "setTheme", "quit"], types: [], flags: {} } }) });
    expect(reasons(report)).toEqual([
      expect.stringMatching(/^coverage: bun run e2e:coverage found 1 problem:\n.*app\.yaml:\d+:3: APP-ORPHAN-01 is not listed in any flow's checks \[no-flow\]$/),
      "coverage: 1 of 4 required SDK surface items have no check a gate flow verifies (bun run e2e:coverage lists them)",
    ]);
  });

  test("coverage.exports: false does not require exports", async () => {
    const dir = repo();
    edit(dir, "e2e/gate.yaml", "exports: true", "exports: false");
    const report = await gate(dir, { surface: () => ({ "./app": { values: ["launch", "setTheme", "quit"], types: [], flags: {} } }) });
    expect(report.verdict).toBe("PASS");
    expect(report.coverage).toEqual({ required: 0, covered: 0, problems: 0 });
  });

  test("a missing release build or a bad signature fails", async () => {
    expect(reasons(await gate(repo({}, { build: false })))).toContain("build: the release build build/macos-arm64/KitchenSink.app does not exist");
    const report = await gate(repo(), { verifySignature: () => "a sealed resource is missing or invalid" });
    expect(reasons(report)).toEqual(["build: build/macos-arm64/KitchenSink.app: code signature does not verify: a sealed resource is missing or invalid"]);
    expect(report.build.signature).toBe("failed");
  });

  test("uncommitted changes fail: the gate certifies a commit", async () => {
    expect(reasons(await gate(repo(), { source: () => ({ commit: COMMIT, dirty: true }) }))).toEqual(["source: the working tree has uncommitted changes; the gate certifies a commit"]);
  });

  test("a machine that is not a gate target fails, and --target cannot claim other hardware", async () => {
    const report = await gate(repo(), { host: { os: "macos-27", arch: "arm64", model: "Mac16,5", memoryGB: 128 } });
    expect(reasons(report)).toEqual(["target: this machine (macos-27/arm64, Mac16,5 with 128 GB) is not a gate target (targets: macos-14/arm64@air-m1, macos-15/arm64, windows-11/x64)"]);
    expect(report.flows).toEqual([]);
    const other = await gate(repo(), { host: { os: "macos-14", arch: "arm64", model: "Mac16,5", memoryGB: 128 } }, "macos-14/arm64@air-m1");
    expect(other.flows.filter(flow => !flow.manual).map(flow => flow.status)).toEqual(["not-run", "not-run", "not-run"]);
    expect(reasons(other)).toContain("target: --target macos-14/arm64@air-m1 needs macos-14/arm64 on MacBook Air (M1, 2020), 8 GB (MacBookAir10,1, 8 GB); this machine is macos-14/arm64, Mac16,5 with 128 GB. The gate certifies only the machine it runs on; use --dry-run to plan another target");
  });

  test("a failing blocking flow fails; a failing non-blocking flow is a warning", async () => {
    const elements = [element("catalog", { id: "catalog" })];
    expect(reasons(await gate(repo(), { elements }))).toEqual([
      expect.stringMatching(/^flows: flows\/app\/theme\[appearance=light\]: .*theme\.yaml:8:3: tapOn: no element matches \{"id":"theme-toggle"\} \(waited 5000ms on app\) \[not-found\]$/),
      expect.stringMatching(/^flows: flows\/app\/theme\[appearance=dark\]: .*\[not-found\]$/),
    ]);
    const dir = repo();
    edit(dir, "e2e/gate.yaml", "default: true", "default: false");
    const report = await gate(dir, { elements });
    expect(report.verdict).toBe("PASS");
    expect(report.warnings).toEqual([expect.stringMatching(/^non-blocking flow flows\/app\/theme\[appearance=light\]: /), expect.stringMatching(/^non-blocking flow flows\/app\/theme\[appearance=dark\]: /)]);
    expect(report.flows.find(flow => flow.id === "flows/app/launch")).toMatchObject({ blocking: true, status: "passed" });
  });

  test("a check registered blocking: true makes its flow blocking", async () => {
    const dir = repo();
    edit(dir, "e2e/gate.yaml", "default: true", "default: false");
    edit(dir, "e2e/checks/app.yaml", "    covers: [./app#setTheme]", "    covers: [./app#setTheme]\n    blocking: true");
    expect((await gate(dir, { elements: [element("catalog", { id: "catalog" })] })).verdict).toBe("FAIL");
  });

  test("the whole run's time budget fails the gate and stops the remaining flows", async () => {
    const dir = repo();
    edit(dir, "e2e/gate.yaml", "timeBudget: 10m", "timeBudget: 150ms");
    const report = await gate(dir);
    expect(reasons(report)).toEqual([
      expect.stringMatching(/^flows: flows\/app\/theme\[appearance=light\]: .*the run exceeded its time budget \[timeout\]$/),
      expect.stringMatching(/^flows: flows\/app\/theme\[appearance=dark\]: .*the run exceeded its time budget \[timeout\]$/),
      expect.stringMatching(/^time-budget: the gate took \d+ms; its time budget is 150ms \(150ms\)$/),
    ]);
  });

  test("retries other than 0 make the manifest invalid", async () => {
    const dir = repo();
    edit(dir, "e2e/gate.yaml", "retries: 0", "retries: 2");
    const { env: gateEnv, err } = env();
    expect(await gateCommand([], path.join(dir, "e2e"), gateEnv)).toBe(1);
    expect(err.join("\n")).toMatch(/gate\.yaml:11:10: retries: must be one of 0 \[schema\]/);
  });

  test("budgets fail closed: no baseline, no measurement, or a regression", async () => {
    const notMeasured = repo();
    edit(notMeasured, "e2e/budgets.yaml", "air-m1: 700", "air-m1: not-measured");
    expect(reasons(await gate(notMeasured))).toEqual(["budgets: startup.coldMs has no baseline for air-m1 (not-measured); measured flows/app/launch: 690. Record a baseline in budgets.yaml"]);
    expect(reasons(await gate(repo(), { coldMs: null }))).toEqual(["budgets: startup.coldMs: no gate flow recorded it on air-m1"]);
    expect(reasons(await gate(repo(), { coldMs: 800 }))).toEqual(["budgets: flows/app/launch: startup.coldMs 800 is above its budget 770 (baseline 700 +10%)"]);
    const nonBlocking = repo();
    edit(nonBlocking, "e2e/budgets.yaml", "tolerance: 10%", "tolerance: 10%\n    blocking: false");
    const report = await gate(nonBlocking, { coldMs: 800 });
    expect([report.verdict, report.warnings]).toEqual(["PASS", ["non-blocking budget flows/app/launch: startup.coldMs 800 is above its budget 770 (baseline 700 +10%)"]]);
  });

  test("budgets apply only on their machine's target", async () => {
    const report = await gate(repo(), { host: { os: "macos-15", arch: "arm64", model: 'MacBookAir10,1', memoryGB: 8 }, coldMs: 5000 });
    expect([report.verdict, report.target, report.budgets]).toEqual(["FAIL", "macos-15/arm64", []]);
    expect(reasons(report)).toEqual(["signoffs: flows/app/ime: no sign-off for macos-15/arm64 at commit 0123456789ab"]);
  });

  test("budget machines must match the targets", async () => {
    const dir = repo();
    edit(dir, "e2e/gate.yaml", "machine: air-m1", "machine: air-m2");
    expect(reasons(await gate(dir, { host: { os: "macos-15", arch: "arm64" } }))).toEqual([
      "manifest: target macos-14/arm64@air-m2 names machine air-m2, which budgets.yaml does not define",
      "manifest: budgets.yaml has baselines for air-m1, but no gate target runs on it, so they would never be checked",
      "signoffs: flows/app/ime: no sign-off for macos-15/arm64 at commit 0123456789ab",
    ]);
  });

  test("manual flows need a passing sign-off for this target and commit", async () => {
    const signoff = (fields: string) => ({ "signoffs/release.yaml": `signoffs:\n  - { flow: flows/app/ime, target: macos-14/arm64@air-m1, by: QA, at: "2026-10-10T12:00:00Z", ${fields} }\n` });
    const cases: Array<[Record<string, string>, string]> = [
      [signoff(`commit: ${"f".repeat(40)}, verdict: pass`), "signoffs: flows/app/ime: no sign-off for macos-14/arm64@air-m1 at commit 0123456789ab"],
      [signoff(`commit: ${COMMIT}, verdict: fail, note: candidates cover the caret`), "signoffs: flows/app/ime: signed off as failed by QA (2026-10-10T12:00:00Z): candidates cover the caret"],
      [signoff(`commit: ${COMMIT}, verdict: pass, evidence: [signoffs/ime.png]`), "signoffs: flows/app/ime: evidence signoffs/ime.png does not exist"],
      [{ "signoffs/release.yaml": "signoffs:\n  - { flow: flows/app/ime }\n" }, "signoffs: signoffs/release.yaml is invalid:"],
    ];
    for (const [edits, message] of cases) expect(reasons(await gate(repo(edits))).join("\n")).toContain(message);
    const missing = repo();
    edit(missing, "e2e/gate.yaml", "signoffs/release.yaml", "signoffs/none.yaml");
    const report = await gate(missing);
    expect(reasons(report)).toEqual(["signoffs: signoffs/none.yaml does not exist; 1 manual flow run need a sign-off: flows/app/ime"]);
    expect(report.flows[0]!.status).toBe("unsigned");
  });

  test("no gate flows for the target fails", async () => {
    const dir = repo();
    edit(dir, "e2e/gate.yaml", "include: [flows/**]", "include: [flows/none/**]");
    const report = await gate(dir);
    expect(reasons(report)).toContain("flows: no gate flows apply to macos-14/arm64@air-m1 (include: flows/none/**)");
  });
});

describe("gate command", () => {
  test("--dry-run prints the plan and runs nothing", async () => {
    const dir = repo({}, { build: false });
    const { env: gateEnv, out } = env();
    expect(await gateCommand(["--dry-run", "--target", "macos-14/arm64@air-m1"], path.join(dir, "e2e"), gateEnv)).toBe(0);
    expect(out.join("\n")).toBe([
      "Gate plan: release-gate (so.legend.kitchensink)",
      "Target: macos-14/arm64@air-m1 (this machine: macos-14/arm64, MacBookAir10,1, 8 GB)",
      "Build: build/macos-arm64/KitchenSink.app (signature will be verified)",
      "Backends: app, driver",
      "Checks:",
      "  lint: every file under e2e/",
      "  coverage: registries in checks/, every gate flow; required: subpaths and exports, availability flags",
      "  retries: 0; whole-run time budget: 10m",
      "  sign-offs: signoffs/release.yaml",
      "  report: reports/gate/report.json, reports/gate/index.html",
      "Flows for macos-14/arm64@air-m1: 3",
      "  manual         blocking      flows/app/ime.yaml",
      "  run            blocking      flows/app/launch.yaml",
      "  run            blocking      flows/app/theme.yaml (2 matrix runs)",
      "Not for this target: 1",
      "  flows/app/taskbar.yaml (platforms: windows)",
      "Budgets on air-m1 (MacBook Air (M1, 2020), 8 GB): 1",
      "  startup.coldMs          lower is better, tolerance 10%, baseline 700",
    ].join("\n"));
    expect(existsSync(path.join(dir, "reports"))).toBe(false);
  });

  test("--dry-run plans another target and shows why this machine cannot run it", async () => {
    const { env: gateEnv, out } = env({ host: { os: "macos-27", arch: "arm64", model: "Mac16,5", memoryGB: 128 } });
    expect(await gateCommand(["--dry-run", "--target=windows-11/x64"], path.join(repo(), "e2e"), gateEnv)).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("Flows for windows-11/x64: 4\n  manual         blocking      flows/app/ime.yaml");
    expect(text).toContain("  run            blocking      flows/app/taskbar.yaml");
    expect(text).toContain("Backends: none for windows: the gate will fail");
    expect(text).toContain("  [build] gate.yaml has no windows build to test");
    expect(text).toContain("  [target] --target windows-11/x64 needs windows-11/x64; this machine is macos-27/arm64, Mac16,5 with 128 GB.");
  });

  test("usage errors exit 2", async () => {
    for (const [args, message] of [[["--target"], "--target needs a value"], [["--frobnicate"], "unknown argument --frobnicate"], [["--target", "macos-99/arm64"], "--target macos-99/arm64 is not in gate.yaml"]] as const) {
      const { env: gateEnv, err } = env();
      expect(await gateCommand([...args], path.join(repo(), "e2e"), gateEnv)).toBe(2);
      expect(err.join("\n")).toContain(message);
    }
  });
});

describe("Kitchen Sink gate files", () => {
  test("e2e/gate.yaml and e2e/budgets.yaml validate", () => {
    expect(checkGate(readFileSync("e2e/gate.yaml", "utf8"), "e2e/gate.yaml").diagnostics.map(formatDiagnostic)).toEqual([]);
    expect(checkBudgets(readFileSync("e2e/budgets.yaml", "utf8"), "e2e/budgets.yaml").diagnostics.map(formatDiagnostic)).toEqual([]);
  });

  test("the reference-machine targets plan their budgets, which fail until measured", () => {
    const air = plan("e2e", { os: "macos-14", arch: "arm64", model: 'MacBookAir10,1', memoryGB: 8 });
    expect([air.target?.id, air.problems]).toEqual(["macos-14/arm64@macbook-air-m1-8gb", []]);
    expect(air.budgets.map(budget => [budget.metric, budget.baseline])).toEqual([
      ["startup.coldMs", "not-measured"], ["startup.firstPaintMs", "not-measured"], ["memory.mb", "not-measured"], ["frames.fps", "not-measured"],
    ]);
    expect(air.artifact).toBe(path.resolve("examples/kitchen-sink/.spark/platforms/macos/products/macos-arm64/release/KitchenSink.app"));
    const pro = plan("e2e", { os: "macos-27", arch: "arm64", model: "Mac16,1", memoryGB: 16 });
    expect([pro.target?.id, pro.budgets.map(budget => budget.metric)]).toEqual(["macos-27/arm64@macbook-pro-14-base", ["frames.fps"]]);
    const other = plan("e2e", { os: "macos-27", arch: "arm64", model: "Mac16,5", memoryGB: 128 });
    expect([other.target?.id, other.budgets]).toEqual(["macos-27/arm64", []]);
    expect(other.flows.map(flow => flow.path)).toContain("flows/menus/availability.yaml");
    expect(other.excluded).toContainEqual({ path: "flows/menus/windows-items.yaml", reason: "platforms: windows" });
  });

  test("sign-off and budgets files reject malformed entries", () => {
    expect(checkSignoffs(`signoffs:\n  - { flow: flows/a, target: macos-15/arm64, commit: abc, verdict: ok, by: QA, at: yesterday }\n`).diagnostics.map(diagnostic => diagnostic.message)).toEqual([
      'signoffs.commit: "abc" is not a full 40-character commit SHA',
      'signoffs.verdict: must be one of "pass", "fail"',
      'signoffs.at: "yesterday" is not an ISO 8601 timestamp, such as 2026-10-10T12:00:00Z',
    ]);
    expect(checkBudgets("machines:\n  air: { name: Air, model: 'MacBookAir10,1', memoryGB: 8 }\nbudgets:\n  - { metric: startup.coldMs, better: lower, tolerance: 10%, baselines: { pro: 1, air: soon } }\n").diagnostics.map(formatDiagnostic)).toEqual([
      'budgets.yaml:4:88: budgets.baselines.air: must be one of "not-measured" [schema]',
    ]);
    expect(checkBudgets("machines:\n  air: { name: Air, model: 'MacBookAir10,1', memoryGB: 8 }\nbudgets:\n  - { metric: startup.coldMs, better: lower, tolerance: 10%, baselines: { pro: 1 } }\n").diagnostics.map(formatDiagnostic)).toEqual([
      'budgets.yaml:4:75: startup.coldMs: baseline for unknown machine "pro" (machines: air) [schema]',
    ]);
  });
});
