import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import type { SdkSurface } from "../scripts/api-surface.ts";
import { checkBudgets, checkFlow, checkGate, checkSignoffs, formatDiagnostic } from "../scripts/e2e/format/parser.ts";
import { gateCommand, parseGateArgs, runGate, type GateEnv, type GateReport } from "../scripts/e2e/gate/gate.ts";
import { flowHash } from "../scripts/e2e/gate/manual.ts";
import { plan, type Host } from "../scripts/e2e/gate/plan.ts";
import { mergeDecisions, signoffCommand, type SignoffEnv } from "../scripts/e2e/gate/signoff.ts";
import { signOffProblem } from "../examples/kitchen-sink/sign-off-rule.ts";
import type { Signoff, SignoffDecisions, SignoffSession } from "../scripts/e2e/format/signoff.ts";
import type { Backend, CommandHandler } from "../scripts/e2e/runner/backend.ts";
import { BACKENDS, NO_BACKENDS } from "../scripts/e2e/runner/run.ts";
import { element, MemoryBackend, VirtualClock, WINDOW } from "./e2e-runner-backend.ts";

// The Kitchen Sink checklist service (screens/infra/sign-off.ts) runs against these: the app's launch arguments, and files on disk.
const app = vi.hoisted(() => ({ args: [] as string[], quitGuards: [] as Array<() => boolean | Promise<boolean>> }));
vi.mock("@legendapp/spark/app", () => ({
  getAppContext: async () => ({ launchArguments: app.args }),
  beforeQuit: async (handler: () => boolean | Promise<boolean>) => { app.quitGuards.push(handler); return { remove: async () => {} }; },
}));
vi.mock("@legendapp/spark/files", async () => {
  const fs = await import("node:fs");
  return { readText: async (file: string) => fs.readFileSync(file, "utf8"), writeText: async (file: string, text: string) => fs.writeFileSync(file, text), exists: async (file: string) => fs.existsSync(file) };
});

const FIXTURE = "tests/fixtures/e2e-gate";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
/** SHA-256 of the fixture's manual flow: its sign-off in signoffs/release.yaml names it. */
const IME = sha256(readFileSync(`${FIXTURE}/e2e/flows/app/ime.yaml`, "utf8"));
const AT_IME = `commit 0123456789ab, flow ${IME.slice(0, 12)}`;
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
        name: "driver", kind: "driver", screenshot: async file => { writeFileSync(file, "png"); return { frame: WINDOW.frame, scale: 2 }; },
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
  return runGate(plan(path.join(dir, "e2e"), gateEnv.host(), { target }), gateEnv);
}
async function scopedGate(dir: string, flows: string[], options: Parameters<typeof env>[0] = {}): Promise<GateReport> {
  const { env: gateEnv } = env(options);
  return runGate(plan(path.join(dir, "e2e"), gateEnv.host(), { only: flows }), gateEnv);
}
const reasons = (report: GateReport) => report.reasons.map(reason => `${reason.check}: ${reason.message}`);

describe("release gate", () => {
  test("drives the exact release artifact with its own state, never an isolated copy", async () => {
    const dir = repo(), factories: unknown[] = [];
    const { env: gateEnv } = env();
    const driver = gateEnv.backends.driver!;
    await runGate(plan(path.join(dir, "e2e"), gateEnv.host()), { ...gateEnv, backends: { ...gateEnv.backends, driver: options => { factories.push(options); return driver(options); } } });
    expect(factories).toEqual([{ app: path.join(dir, "build/macos-arm64/KitchenSink.app"), state: "exact" }]);
  });

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

  test("with no backends registered, the gate fails instead of passing vacuously", async () => {
    const dir = repo();
    const { env: gateEnv, out } = env({ backends: {} });
    expect(await gateCommand([], path.join(dir, "e2e"), gateEnv)).toBe(1);
    const report: GateReport = JSON.parse(readFileSync(path.join(dir, "reports/gate/report.json"), "utf8"));
    expect(report.verdict).toBe("FAIL");
    expect(reasons(report)).toEqual([`backend: ${NO_BACKENDS}`, "budgets: 1 budget for air-m1 not checked: no flows ran"]);
    expect(report.flows.filter(flow => !flow.manual).map(flow => flow.status)).toEqual(["not-run", "not-run", "not-run"]);
    expect(out.join("\n")).toContain(`[backend] ${NO_BACKENDS}`);
  });

  test("with the production backend table, the driver backend runs every flow: a flow it cannot drive fails, never skips", async () => {
    const dir = repo();
    const report = await gate(dir, { backends: BACKENDS });
    expect(Object.keys(BACKENDS)).toEqual(["driver"]);
    expect(report.backends).toEqual(["driver"]);
    expect(reasons(report).filter(reason => reason.startsWith("backend:"))).toEqual([]);
    // The fixture's build is an empty directory, so the driver cannot launch it.
    expect(report.flows.filter(flow => !flow.manual).map(flow => [flow.status, flow.failure])).toEqual(Array(3).fill(["failed", expect.stringMatching(/KitchenSink\.app is not a macOS app bundle \[error\]$/)]));
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
    expect(reasons(report)).toEqual([`signoffs: flows/app/ime: no sign-off for macos-15/arm64 at ${AT_IME}; run bun run gate:signoff`]);
  });

  test("budget machines must match the targets", async () => {
    const dir = repo();
    edit(dir, "e2e/gate.yaml", "machine: air-m1", "machine: air-m2");
    expect(reasons(await gate(dir, { host: { os: "macos-15", arch: "arm64" } }))).toEqual([
      "manifest: target macos-14/arm64@air-m2 names machine air-m2, which budgets.yaml does not define",
      "manifest: budgets.yaml has baselines for air-m1, but no gate target runs on it, so they would never be checked",
      `signoffs: flows/app/ime: no sign-off for macos-15/arm64 at ${AT_IME}; run bun run gate:signoff`,
    ]);
  });

  test("manual flows need a passing sign-off for this target, commit and flow content; stale ones fail", async () => {
    const signoff = (fields: string) => ({ "signoffs/release.yaml": `signoffs:\n  - { flow: flows/app/ime, target: macos-14/arm64@air-m1, by: QA <qa@example.com>, machine: qa-mac, at: "2026-10-10T12:00:00Z", ${fields} }\n` });
    const cases: Array<[Record<string, string>, string]> = [
      [signoff(`commit: ${"f".repeat(40)}, flowHash: ${IME}, verdict: pass`), `signoffs: flows/app/ime: stale sign-off: it is for commit ffffffffffff, flow ${IME.slice(0, 12)}, not this ${AT_IME}; run bun run gate:signoff`],
      [signoff(`commit: ${COMMIT}, flowHash: ${"e".repeat(64)}, verdict: pass`), `signoffs: flows/app/ime: stale sign-off: it is for commit 0123456789ab, flow eeeeeeeeeeee, not this ${AT_IME} (the flow changed since); run bun run gate:signoff`],
      [signoff(`commit: ${COMMIT}, flowHash: ${IME}, verdict: fail, note: candidates cover the caret`), "signoffs: flows/app/ime: signed off as failed by QA <qa@example.com> on qa-mac (2026-10-10T12:00:00Z): candidates cover the caret"],
      [signoff(`commit: ${COMMIT}, flowHash: ${IME}, verdict: pass, evidence: [signoffs/ime.png]`), "signoffs: flows/app/ime: evidence signoffs/ime.png does not exist"],
      [{ "signoffs/release.yaml": `signoffs:\n${[1, 2].map(n => `  - { flow: flows/app/ime, target: macos-14/arm64@air-m1, commit: ${COMMIT}, flowHash: ${IME}, verdict: pass, by: QA ${n}, machine: qa-mac, at: "2026-10-10T12:00:00Z" }\n`).join("")}` }, `signoffs: flows/app/ime: 2 sign-offs for macos-14/arm64@air-m1 at ${AT_IME}; keep one`],
      [{ "signoffs/release.yaml": "signoffs:\n  - { flow: flows/app/ime }\n" }, "signoffs: signoffs/release.yaml is invalid:"],
    ];
    for (const [edits, message] of cases) {
      const report = await gate(repo(edits));
      expect(reasons(report).join("\n")).toContain(message);
      expect(report.flows[0]!.status).toBe(message.includes("signed off as failed") ? "failed" : "unsigned");
    }
    const missing = repo();
    edit(missing, "e2e/gate.yaml", "signoffs/release.yaml", "signoffs/none.yaml");
    const report = await gate(missing);
    expect(reasons(report)).toEqual(["signoffs: signoffs/none.yaml does not exist; 1 manual flow run need a sign-off (run bun run gate:signoff): flows/app/ime"]);
    expect(report.flows[0]).toMatchObject({ status: "unsigned", flowHash: IME, manualSteps: [{ instruction: 'Type "nihongo" with the Japanese Romaji input source.', evidence: "none", signoff: "required", location: expect.stringMatching(/ime\.yaml:7:3$/) }] });
  });

  test("editing a signed-off manual flow makes its sign-off stale, so the gate fails until it is signed off again", async () => {
    const dir = repo();
    expect((await gate(dir)).verdict).toBe("PASS");
    edit(dir, "e2e/flows/app/ime.yaml", "overlaps no text.", "overlaps no text or caret.");
    const edited = sha256(readFileSync(path.join(dir, "e2e/flows/app/ime.yaml"), "utf8"));
    const report = await gate(dir);
    expect(reasons(report)).toEqual([`signoffs: flows/app/ime: stale sign-off: it is for commit 0123456789ab, flow ${IME.slice(0, 12)}, not this commit 0123456789ab, flow ${edited.slice(0, 12)} (the flow changed since); run bun run gate:signoff`]);
    expect(report.flows[0]).toMatchObject({ status: "unsigned", flowHash: edited });
    expect(report.flows[0]!.signoff).toBeUndefined();
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

  test("--artifact tests another copy of the release build, such as the installed app from bun run harness", async () => {
    const dir = repo({}, { build: false });
    const installed = path.join(mkdtempSync(path.join(tmpdir(), "e2e-gate-installed-")), "Applications/KitchenSink.app");
    mkdirSync(installed, { recursive: true });
    const plan = env();
    expect(await gateCommand(["--dry-run", "--artifact", installed], path.join(dir, "e2e"), plan.env)).toBe(0);
    expect(plan.out.join("\n")).toContain(`Build: ${installed} (signature will be verified)`);
    const signed: string[] = [];
    const { env: gateEnv } = env({ verifySignature: artifact => { signed.push(artifact); return undefined; } });
    expect(await gateCommand([`--artifact=${installed}`], path.join(dir, "e2e"), gateEnv)).toBe(0);
    const report: GateReport = JSON.parse(readFileSync(path.join(dir, "reports/gate/report.json"), "utf8"));
    expect([report.verdict, report.build, signed]).toEqual(["PASS", { artifact: installed, exists: true, signature: "verified" }, [installed]]);
  });

  test("usage errors exit 2", async () => {
    for (const [args, message] of [[["--target"], "--target needs a value"], [["--artifact"], "--artifact needs a value"], [["--frobnicate"], "unknown argument --frobnicate"], [["--target", "macos-99/arm64"], "--target macos-99/arm64 is not in gate.yaml"]] as const) {
      const { env: gateEnv, err } = env();
      expect(await gateCommand([...args], path.join(repo(), "e2e"), gateEnv)).toBe(2);
      expect(err.join("\n")).toContain(message);
    }
  });
});

describe("--flow and --agent", () => {
  const OTHER = { "e2e/flows/other/broken.yaml": "appId: so.legend.kitchensink\nname: Broken\nintent: Lints badly.\nchecks: [OTH-NONE-01]\n---\n- sleep: 1s\n" };
  const scoped = (dir: string) => JSON.parse(readFileSync(path.join(dir, "reports/gate/scoped/report.json"), "utf8")) as GateReport;

  test("arguments: repeatable --flow resolved from the working directory, --agent, --dry-run, inline values; usage errors", () => {
    expect(parseGateArgs(["--flow", "e2e/flows/a.yaml", "--flow=e2e/flows/b", "--agent", "--target=macos-15/arm64", "--artifact", "Applications/KitchenSink.app", "--dry-run"])).toEqual({
      target: "macos-15/arm64", flows: [path.resolve("e2e/flows/a.yaml"), path.resolve("e2e/flows/b")], artifact: path.resolve("Applications/KitchenSink.app"), agent: true, dryRun: true,
    });
    expect(parseGateArgs([])).toEqual({ target: undefined, flows: [], artifact: undefined, agent: false, dryRun: false });
    for (const [args, message] of [[["--flow"], "--flow needs a value"], [["--flow", "--agent"], "--flow needs a value"], [["--agent=yes"], "unknown argument --agent=yes"], [["x.yaml"], "unknown argument x.yaml"]] as const) {
      expect(() => parseGateArgs([...args])).toThrow(message);
    }
  });

  test("one flow runs alone with the gate's checks and writes a scoped report next to the gate's", async () => {
    const dir = repo(OTHER);
    const { env: gateEnv, out } = env({ source: () => ({ commit: COMMIT, dirty: true }) });
    expect(await gateCommand(["--flow", path.join(dir, "e2e/flows/app/theme.yaml")], path.join(dir, "e2e"), gateEnv)).toBe(0);
    const report = scoped(dir);
    expect(report).toMatchObject({ verdict: "PASS", scope: ["flows/app/theme.yaml"], reasons: [], budgets: [], run: "reports/gate/scoped/run", build: { signature: "verified" } });
    // Uncommitted changes are a warning: a scoped run certifies no commit. Other areas' lint and coverage problems are not its own.
    expect(report.warnings).toEqual(["the working tree has uncommitted changes; a --flow run certifies no commit"]);
    expect(report.flows.map(flow => [flow.id, flow.status])).toEqual([["flows/app/theme[appearance=light]", "passed"], ["flows/app/theme[appearance=dark]", "passed"]]);
    expect(existsSync(path.join(dir, "reports/gate/report.json"))).toBe(false);
    expect(out.at(-1)).toMatch(/^warning: the working tree has uncommitted changes; a --flow run certifies no commit\nGate PASS on macos-14\/arm64@air-m1 for flows\/app\/theme\.yaml \(--flow\): 0 reasons\. Report: .*reports\/gate\/scoped\/index\.html$/);
  });

  test("a scoped run fails for everything the gate would fail its flows for", async () => {
    const theme = (dir: string) => [path.join(dir, "e2e/flows/app/theme.yaml")];
    const lintBroken = repo();
    edit(lintBroken, "e2e/flows/app/theme.yaml", "- tapOn: { id: theme-toggle }", "- tapOn: { id: theme-toggle }\n- sleep: 1s");
    expect(reasons(await scopedGate(lintBroken, theme(lintBroken)))).toContainEqual(expect.stringMatching(/^lint: bun run e2e:lint found 1 problem:\n.*theme\.yaml:9:3: .*\[no-sleep\]$/));
    const uncovered = repo();
    edit(uncovered, "e2e/checks/app.yaml", "  APP-IME-01:", "  APP-ORPHAN-01:\n    title: Nothing verifies this\n  APP-IME-01:");
    expect(reasons(await scopedGate(uncovered, theme(uncovered)))).toEqual([expect.stringMatching(/^coverage: bun run e2e:coverage found 1 problem in app:\n.*APP-ORPHAN-01 is not listed in any flow's checks \[no-flow\]$/)]);
    const failing = repo();
    expect(reasons(await scopedGate(failing, theme(failing), { elements: [element("catalog", { id: "catalog" })] }))).toEqual([
      expect.stringMatching(/^flows: flows\/app\/theme\[appearance=light\]: .*\[not-found\]$/), expect.stringMatching(/^flows: flows\/app\/theme\[appearance=dark\]: .*\[not-found\]$/),
    ]);
    const unbuilt = repo({}, { build: false });
    expect(reasons(await scopedGate(unbuilt, theme(unbuilt)))).toContain("build: the release build build/macos-arm64/KitchenSink.app does not exist");
    const launch = repo();
    expect(reasons(await scopedGate(launch, [path.join(launch, "e2e/flows/app/launch.yaml")], { coldMs: 800 }))).toEqual(["budgets: flows/app/launch: startup.coldMs 800 is above its budget 770 (baseline 700 +10%)"]);
    // An area runs every gate flow under it, manual sign-offs included.
    const area = repo();
    edit(area, "e2e/gate.yaml", "signoffs/release.yaml", "signoffs/none.yaml");
    const report = await scopedGate(area, [path.join(area, "e2e/flows/app")]);
    expect(report.flows.map(flow => flow.id)).toEqual(["flows/app/ime", "flows/app/launch", "flows/app/theme[appearance=light]", "flows/app/theme[appearance=dark]"]);
    expect(report.excluded).toEqual([{ path: "flows/app/taskbar.yaml", reason: "platforms: windows" }]);
    expect(reasons(report)).toEqual(["signoffs: signoffs/none.yaml does not exist; 1 manual flow run need a sign-off (run bun run gate:signoff): flows/app/ime"]);
  });

  test("--agent prints only JSON lines: flow events with the bundle path, then the verdict summary", async () => {
    const dir = repo();
    const { env: gateEnv, out } = env({ elements: [element("catalog", { id: "catalog" })] });
    expect(await gateCommand(["--flow", path.join(dir, "e2e/flows/app/theme.yaml"), "--agent"], path.join(dir, "e2e"), gateEnv)).toBe(1);
    const events = out.map(line => JSON.parse(line));
    expect(events.map(event => event.event)).toEqual(["flow-start", "flow-end", "flow-start", "flow-end", "gate-end"]);
    expect(events[1]).toMatchObject({ id: "flows/app/theme[appearance=light]", status: "failed", intent: "The theme toggle works in light and dark appearance.", failure: { command: "tapOn", kind: "not-found" } });
    const summary = events.at(-1);
    expect(summary).toMatchObject({
      verdict: "FAIL", target: "macos-14/arm64@air-m1", scope: ["flows/app/theme.yaml"], warnings: [],
      report: { json: path.join(dir, "reports/gate/scoped/report.json"), html: path.join(dir, "reports/gate/scoped/index.html") }, run: path.join(dir, "reports/gate/scoped/run"),
    });
    expect(summary.reasons.map((reason: { check: string }) => reason.check)).toEqual(["flows", "flows"]);
    const bundle = path.join(dir, "reports/gate/scoped/run/flows/app/theme/appearance-light/failure/bundle.json");
    expect(summary.flows[0]).toEqual({ id: "flows/app/theme[appearance=light]", status: "failed", blocking: true, failure: expect.stringContaining("[not-found]"), bundle });
    expect(events[1].bundle).toBe(bundle);
    expect(JSON.parse(readFileSync(bundle, "utf8"))).toMatchObject({ flow: { intent: "The theme toggle works in light and dark appearance.", matrix: { appearance: "light" } }, failure: { selector: { id: "theme-toggle" } }, run: { host: AIR } });
    expect(scoped(dir).flows[0]!.bundle).toBe("reports/gate/scoped/run/flows/app/theme/appearance-light/failure/bundle.json");
  });

  test("--flow must name gate flows; --dry-run shows the scope", async () => {
    const dir = repo({ "e2e/subflows/s.yaml": "- tapOn: X\n", "elsewhere/flow.yaml": "appId: x\nname: x\n---\n- launchApp\n" });
    const cases: Array<[string, string]> = [
      ["e2e/flows/app/nope.yaml", "--flow "], ["e2e/subflows/s.yaml", "not a flow (subflow)"], ["e2e/checks/app.yaml", "not a flow (registry)"],
      ["elsewhere/flow.yaml", "not a gate flow (gate.yaml includes flows/**"], ["e2e/subflows", "no flows there"],
    ];
    for (const [file, message] of cases) {
      const { env: gateEnv, err } = env();
      expect(await gateCommand(["--flow", path.join(dir, file)], path.join(dir, "e2e"), gateEnv)).toBe(2);
      expect(err.join("\n")).toContain(message);
    }
    const { env: gateEnv, out } = env();
    expect(await gateCommand(["--dry-run", "--flow", path.join(dir, "e2e/flows/app/launch.yaml")], path.join(dir, "e2e"), gateEnv)).toBe(0);
    expect(out.join("\n")).toContain("Scope (--flow): flows/app/launch.yaml\nTarget:");
    expect(out.join("\n")).toContain("  report: reports/gate/scoped/report.json, reports/gate/scoped/index.html\nFlows for macos-14/arm64@air-m1: 1\n  run            blocking      flows/app/launch.yaml");
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
    expect(checkSignoffs(`signoffs:\n  - { flow: flows/a, target: macos-15/arm64, commit: abc, flowHash: abc, verdict: ok, by: QA, machine: qa-mac, at: yesterday }\n`).diagnostics.map(diagnostic => diagnostic.message)).toEqual([
      'signoffs.commit: "abc" is not a full 40-character commit SHA',
      'signoffs.flowHash: "abc" is not a 64-character SHA-256 of the flow file (the gate report\'s flowHash)',
      'signoffs.verdict: must be one of "pass", "fail"',
      'signoffs.at: "yesterday" is not an ISO 8601 timestamp, such as 2026-10-10T12:00:00Z',
    ]);
    const entry = `flow: flows/a, target: macos-15/arm64, commit: ${COMMIT}, flowHash: ${IME}, by: QA, machine: qa-mac, at: "2026-10-10T12:00:00Z"`;
    expect(checkSignoffs(`signoffs:\n  - { ${entry}, verdict: fail }\n`).diagnostics.map(diagnostic => diagnostic.message)).toEqual(['signoffs: missing required key "note"']);
    expect(checkSignoffs(`signoffs:\n  - { ${entry}, verdict: pass }\n`).diagnostics).toEqual([]);
    expect(checkSignoffs(`signoffs:\n  - { flow: flows/a, target: macos-15/arm64, commit: ${COMMIT}, verdict: pass, by: QA, at: "2026-10-10T12:00:00Z" }\n`).diagnostics.map(diagnostic => diagnostic.message)).toEqual([
      'signoffs: missing required key "flowHash"', 'signoffs: missing required key "machine"',
    ]);
    expect(checkBudgets("machines:\n  air: { name: Air, model: 'MacBookAir10,1', memoryGB: 8 }\nbudgets:\n  - { metric: startup.coldMs, better: lower, tolerance: 10%, baselines: { pro: 1, air: soon } }\n").diagnostics.map(formatDiagnostic)).toEqual([
      'budgets.yaml:4:88: budgets.baselines.air: must be one of "not-measured" [schema]',
    ]);
    expect(checkBudgets("machines:\n  air: { name: Air, model: 'MacBookAir10,1', memoryGB: 8 }\nbudgets:\n  - { metric: startup.coldMs, better: lower, tolerance: 10%, baselines: { pro: 1 } }\n").diagnostics.map(formatDiagnostic)).toEqual([
      'budgets.yaml:4:75: startup.coldMs: baseline for unknown machine "pro" (machines: air) [schema]',
    ]);
  });
});

/** A partial flow: launch and check the catalog, then a person looks at a screenshot, then the automated steps go on. */
const MENU = {
  "e2e/flows/app/menu.yaml": "appId: so.legend.kitchensink\nname: Menu marks are legible\nintent: A person checks the menu marks in a screenshot.\nchecks: [APP-THEME-01]\nmanual: partial\n---\n"
    + "- launchApp\n- assertVisible: { id: catalog }\n- takeScreenshot: menu-open\n- manualStep: { instruction: Look at the open menu., expect: Mixed shows a dash., screenshot: menu-open }\n- tapOn: { id: theme-toggle }\n",
};
const MENU_HASH = sha256(MENU["e2e/flows/app/menu.yaml"]);
const SIGNER = { name: "Jane Doe", email: "jane@example.com", machine: "qa-air (MacBookAir10,1)" };
const BY = "Jane Doe <jane@example.com>";
/** Points the fixture's sign-off of flows/app/ime at the flow's current content, as a fresh sign-off would. */
const resign = (dir: string) => {
  const file = path.join(dir, "e2e/flows/app/ime.yaml");
  edit(dir, "signoffs/release.yaml", IME, flowHash(checkFlow(readFileSync(file, "utf8"), file).value!, file));
};

describe("manual sign-offs in the gate", () => {
  test("a partial run's automated steps run, its manual step is captured in-process, and it then needs a sign-off", async () => {
    const dir = repo(MENU);
    const report = await gate(dir);
    expect(reasons(report)).toEqual([`signoffs: flows/app/menu: no sign-off for macos-14/arm64@air-m1 at commit 0123456789ab, flow ${MENU_HASH.slice(0, 12)}; run bun run gate:signoff`]);
    const menu = report.flows.find(flow => flow.id === "flows/app/menu")!;
    expect(menu).toMatchObject({
      status: "passed", manual: "partial", flowHash: MENU_HASH,
      manualSteps: [{
        instruction: "Look at the open menu.", expect: "Mixed shows a dash.", evidence: "screenshot", signoff: "required", location: expect.stringMatching(/menu\.yaml:10:3$/),
        screenshot: "reports/gate/run/flows/app/menu/run/output/menu-open.png", capture: "menu-open (the main window)",
      }],
    });
    expect(existsSync(path.join(dir, menu.manualSteps![0]!.screenshot!))).toBe(true);
    expect(report.flows.find(flow => flow.id === "flows/app/launch")!.flowHash).toBeUndefined();
  });

  test("a partial run that fails before its manual step reports the failure, not a missing sign-off", async () => {
    const report = await gate(repo(MENU), { elements: [element("toggle", { id: "theme-toggle" })] });
    expect(reasons(report).filter(reason => reason.includes("flows/app/menu"))).toEqual([expect.stringMatching(/^flows: flows\/app\/menu: .*menu\.yaml:8:3: assertVisible: no element matches \{"id":"catalog"\}/)]);
    expect(reasons(report).filter(reason => reason.startsWith("signoffs:"))).toEqual([]);
    expect(report.flows.find(flow => flow.id === "flows/app/menu")!.manualSteps).toEqual([]);
  });

  test("manual: true steps are planned through runFlow files and when; a run that reaches no required step fails and is not-run", async () => {
    const steps = "- runFlow: subflows/ime.yaml\n- manualStep: { instruction: Only on Windows., expect: Nothing here., when: { platform: windows } }\n";
    const dir = repo({ "e2e/subflows/ime.yaml": "- manualStep: { instruction: Type nihongo., expect: Candidates under the caret. }\n" });
    edit(dir, "e2e/flows/app/ime.yaml", /---\n[\s\S]*$/, `---\n${steps}`);
    resign(dir);
    const report = await gate(dir);
    expect(report.verdict).toBe("PASS");
    expect(report.flows[0]!.manualSteps).toEqual([{ instruction: "Type nihongo.", expect: "Candidates under the caret.", evidence: "none", signoff: "required", location: expect.stringMatching(/subflows\/ime\.yaml:1:3$/) }]);
    const windowsOnly = repo();
    edit(windowsOnly, "e2e/flows/app/ime.yaml", "    signoff: required", "    signoff: required\n    when: { platform: windows }");
    const skipped = await gate(windowsOnly);
    expect(reasons(skipped)).toEqual(["signoffs: flows/app/ime: manual: true, but it reaches no manualStep with signoff: required, so nothing verifies it"]);
    expect(skipped.flows[0]!.status).toBe("not-run");
  });

  test("the flow hash covers the runFlow files a manual flow reaches: editing one makes its sign-off stale", async () => {
    const dir = repo({ "e2e/subflows/ime.yaml": "- manualStep: { instruction: Type nihongo., expect: Candidates under the caret. }\n" });
    edit(dir, "e2e/flows/app/ime.yaml", /---\n/, "---\n- runFlow: subflows/ime.yaml\n");
    resign(dir);
    const signed = await gate(dir);
    expect([signed.verdict, reasons(signed)]).toEqual(["PASS", []]);
    const before = signed.flows[0]!.flowHash!;
    expect(before).not.toBe(sha256(readFileSync(path.join(dir, "e2e/flows/app/ime.yaml"), "utf8")));
    edit(dir, "e2e/subflows/ime.yaml", "Candidates under the caret.", "Candidates sit under the caret.");
    const stale = await gate(dir);
    const after = stale.flows[0]!.flowHash!;
    expect(after).not.toBe(before);
    expect(reasons(stale)).toEqual([`signoffs: flows/app/ime: stale sign-off: it is for commit 0123456789ab, flow ${before.slice(0, 12)}, not this commit 0123456789ab, flow ${after.slice(0, 12)} (the flow changed since); run bun run gate:signoff`]);
  });

  test("a manual: partial run that passed without reaching a required step fails the gate", async () => {
    const dir = repo({ "e2e/flows/app/menu.yaml": MENU["e2e/flows/app/menu.yaml"].replace("screenshot: menu-open }", "screenshot: menu-open, when: { platform: windows } }") });
    const report = await gate(dir);
    expect(report.flows.find(flow => flow.id === "flows/app/menu")).toMatchObject({ status: "passed", manualSteps: [] });
    expect(reasons(report)).toEqual(["signoffs: flows/app/menu: manual: partial, but the run reached no manualStep with signoff: required, so no person verified it"]);
  });

  test("a scoped run (gate --flow --agent) of an unsigned manual flow fails closed", async () => {
    const dir = repo();
    edit(dir, "e2e/gate.yaml", "signoffs/release.yaml", "signoffs/none.yaml");
    const { env: gateEnv, out } = env();
    expect(await gateCommand(["--flow", path.join(dir, "e2e/flows/app/ime.yaml"), "--agent"], path.join(dir, "e2e"), gateEnv)).toBe(1);
    const end = JSON.parse(out.at(-1)!);
    expect(end).toMatchObject({ event: "gate-end", verdict: "FAIL", reasons: [{ check: "signoffs", message: "signoffs/none.yaml does not exist; 1 manual flow run need a sign-off (run bun run gate:signoff): flows/app/ime" }] });
    expect(end.flows).toEqual([expect.objectContaining({ id: "flows/app/ime", status: "unsigned" })]);
  });
});

/**
 * `bun run gate:signoff` against a fixture repository. `launch` stands in for opening the app and `answer` for what the
 * person types at the confirmation prompt: the test doubles for the human.
 */
function signoff(dir: string, options: { launch?: SignoffEnv["launch"]; answer?: string; interactive?: boolean; source?: { commit: string; dirty: boolean } } = {}) {
  const { launch = async () => {}, answer = SIGNER.name, interactive = true, source = { commit: COMMIT, dirty: false } } = options;
  const out: string[] = [], err: string[] = [], asked: string[] = [];
  const env: SignoffEnv = {
    host: () => AIR, source: () => source, stdout: line => out.push(line), stderr: line => err.push(line), signer: () => SIGNER, interactive,
    ask: async question => { asked.push(question); return answer; }, launch,
  };
  return { run: (args: string[] = []) => signoffCommand(args, path.join(dir, "e2e"), env), out, err, asked };
}
/** The Kitchen Sink checklist service, freshly loaded as a launch with `--ks-signoff <session>` would load it. */
async function checklist(session: string) {
  app.args = ["KitchenSink", "--ks-signoff", session];
  vi.resetModules();
  const service = await import("../examples/kitchen-sink/screens/infra/sign-off.ts");
  await service.loadSignOff();
  return service;
}
const SESSION_DIR = "signoffs/manual/0123456789ab";

describe("gate:signoff", () => {
  test("it refuses without a person at a terminal, before writing anything; --list works without one", async () => {
    const dir = repo(MENU);
    await gateCommand([], path.join(dir, "e2e"), env().env);
    const agent = signoff(dir, { interactive: false, launch: async () => { throw new Error("never opens the app"); } });
    expect(await agent.run()).toBe(1);
    expect(agent.err).toEqual(["gate:signoff: a sign-off is a person's statement: run it yourself at a terminal. Agents never sign off; bun run gate:signoff --list shows what awaits a person"]);
    expect(existsSync(path.join(dir, SESSION_DIR))).toBe(false);
    const listed = signoff(dir, { interactive: false });
    expect(await listed.run(["--list"])).toBe(0);
    expect(listed.asked).toEqual([]);
  });

  test("it refuses a gate report for another commit, a changed flow, uncommitted changes, or no report", async () => {
    const dir = repo(MENU);
    const none = signoff(dir);
    expect(await none.run()).toBe(1);
    expect(none.err.join("\n")).toMatch(/^gate:signoff: no gate report at .*reports\/gate\/report\.json\. Run bun run gate first$/);
    const scopedNone = signoff(dir);
    expect(await scopedNone.run(["--scoped"])).toBe(1);
    expect(scopedNone.err.join("\n")).toMatch(/^gate:signoff: no gate report at .*reports\/gate\/scoped\/report\.json\. Run bun run gate --flow <flow> first$/);
    expect(await gateCommand([], path.join(dir, "e2e"), env().env)).toBe(1);
    const head = signoff(dir, { source: { commit: "f".repeat(40), dirty: false } });
    expect(await head.run()).toBe(1);
    expect(head.err).toEqual(["gate:signoff: the last gate run tested commit 0123456789ab; HEAD is ffffffffffff. Run bun run gate again first"]);
    const dirty = signoff(dir, { source: { commit: COMMIT, dirty: true } });
    expect(await dirty.run()).toBe(1);
    expect(dirty.err).toEqual(["gate:signoff: sign-offs certify a commit: commit or remove uncommitted changes, then run bun run gate"]);
    edit(dir, "e2e/flows/app/menu.yaml", "Mixed shows a dash.", "Mixed shows a dash, not a check.");
    const changed = signoff(dir);
    expect(await changed.run()).toBe(1);
    expect(changed.err).toEqual(["gate:signoff: flows/app/menu.yaml changed since the last gate run. Run bun run gate again first"]);
    const usage = signoff(dir);
    expect(await usage.run(["--frobnicate"])).toBe(2);
    expect(usage.err[0]).toBe("unknown argument --frobnicate\nusage: bun run gate:signoff [--list] [--scoped]");
  });

  test("--list writes the session, with the run's screenshot copied next to it, and prints what awaits sign-off", async () => {
    const dir = repo(MENU);
    await gateCommand([], path.join(dir, "e2e"), env().env);
    const listed = signoff(dir, { launch: async () => { throw new Error("--list never opens the app"); } });
    expect(await listed.run(["--list"])).toBe(0);
    const session: SignoffSession = JSON.parse(readFileSync(path.join(dir, SESSION_DIR, "session.json"), "utf8"));
    expect(session).toMatchObject({ version: 1, target: "macos-14/arm64@air-m1", commit: COMMIT, by: BY, machine: SIGNER.machine, decisions: "decisions.json" });
    expect(session.items).toEqual([
      expect.objectContaining({ flow: "flows/app/ime", name: "IME candidate window tracks the caret", kind: "manual", flowHash: IME, ready: true, signoff: expect.objectContaining({ verdict: "pass", by: "Release Captain <captain@example.com>" }) }),
      expect.objectContaining({ flow: "flows/app/menu", kind: "partial", flowHash: MENU_HASH, ready: true, steps: [expect.objectContaining({ screenshot: "evidence/flows-app-menu-1.png" })] }),
    ]);
    expect(readFileSync(path.join(dir, SESSION_DIR, "evidence/flows-app-menu-1.png"), "utf8")).toBe("png");
    expect(listed.out).toEqual([
      `Sign-off session for macos-14/arm64@air-m1 at commit 0123456789ab, as ${BY} on qa-air (MacBookAir10,1):`,
      "  signed pass: flows/app/ime (manual)",
      expect.stringMatching(/^    .*ime\.yaml:7:3: Type "nihongo" with the Japanese Romaji input source\. Expect: The candidate window sits directly under the caret and overlaps no text\. \[no screenshot: a pass needs a note\]$/),
      "  pending: flows/app/menu (run + sign-off)",
      expect.stringMatching(/^    .*menu\.yaml:10:3: Look at the open menu\. Expect: Mixed shows a dash\. \[evidence\/flows-app-menu-1\.png: menu-open \(the main window\)\]$/),
    ]);
  });

  test("end to end: the checklist signs off each run, the person confirms, gate:signoff writes identity, time, commit and flow hash, and the gate passes; a failed sign-off fails it with the note", async () => {
    const dir = repo(MENU);
    expect(await gateCommand([], path.join(dir, "e2e"), env().env)).toBe(1);
    const sessionFile = path.join(dir, SESSION_DIR, "session.json");
    const problems: unknown[] = [];
    const signing = signoff(dir, {
      launch: async (artifact, session) => {
        expect([artifact, session]).toEqual([path.join(dir, "build/macos-arm64/KitchenSink.app"), sessionFile]);
        const service = await checklist(session);
        expect(service.getSignOffState()).toMatchObject({ status: "ready", session: { commit: COMMIT, items: [{ flow: "flows/app/ime" }, { flow: "flows/app/menu" }] } });
        problems.push(service.decide("flows/app/ime", "pass", ""), service.decide("flows/app/ime", "fail", " "));
        problems.push(service.decide("flows/app/ime", "pass", "Candidates sit under the caret."), service.decide("flows/app/menu", "pass", ""));
        await service.flushSignOff();
      },
    });
    expect(await signing.run()).toBe(0);
    expect(problems).toEqual(["evidence-needs-note", "fail-needs-note", undefined, undefined]);
    expect(signing.asked).toEqual([`Sign 2 decisions as ${BY} on qa-air (MacBookAir10,1)? Type your name (Jane Doe) to confirm: `]);
    expect(signing.out.slice(-3)).toEqual(["PASS flows/app/ime: Candidates sit under the caret.", "PASS flows/app/menu", "Wrote 2 sign-offs to signoffs/release.yaml. Run bun run gate to apply them."]);
    const written = checkSignoffs(readFileSync(path.join(dir, "signoffs/release.yaml"), "utf8")).value!.signoffs;
    expect(written).toEqual([
      { flow: "flows/app/ime", target: "macos-14/arm64@air-m1", commit: COMMIT, flowHash: IME, verdict: "pass", by: BY, machine: SIGNER.machine, at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), note: "Candidates sit under the caret." },
      { flow: "flows/app/menu", target: "macos-14/arm64@air-m1", commit: COMMIT, flowHash: MENU_HASH, verdict: "pass", by: BY, machine: SIGNER.machine, at: expect.any(String), evidence: [`${SESSION_DIR}/evidence/flows-app-menu-1.png`] },
    ]);
    const passed = await gate(dir);
    expect([passed.verdict, reasons(passed)]).toEqual(["PASS", []]);
    expect(passed.flows.find(flow => flow.id === "flows/app/ime")).toMatchObject({ status: "signed-off", signoff: { by: BY, machine: SIGNER.machine, commit: COMMIT, flowHash: IME } });

    // A relaunch in the same session shows the decisions already made; a failure needs its note and fails the gate with it.
    const failing = signoff(dir, {
      launch: async () => {
        const service = await checklist(sessionFile);
        const state = service.getSignOffState() as Extract<ReturnType<typeof service.getSignOffState>, { status: "ready" }>;
        expect(state.session.items.map(item => item.signoff?.verdict)).toEqual(["pass", "pass"]);
        expect(service.decide("flows/app/menu", "fail", "Starred sample shows no star.")).toBeUndefined();
        await service.flushSignOff();
        expect((await checklist(sessionFile)).getSignOffState()).toMatchObject({ decisions: { "flows/app/menu": { verdict: "fail" } } });
      },
    });
    expect(await failing.run()).toBe(0);
    expect(reasons(await gate(dir))).toEqual([`signoffs: flows/app/menu: signed off as failed by ${BY} on ${SIGNER.machine} (${checkSignoffs(readFileSync(path.join(dir, "signoffs/release.yaml"), "utf8")).value!.signoffs.at(-1)!.at}): Starred sample shows no star.`]);
  });

  test("without the person's typed confirmation nothing is written", async () => {
    const dir = repo(MENU);
    await gateCommand([], path.join(dir, "e2e"), env().env);
    const before = readFileSync(path.join(dir, "signoffs/release.yaml"), "utf8");
    const launch = async (_artifact: string, session: string) => {
      const service = await checklist(session);
      service.decide("flows/app/menu", "pass", "");
      await service.flushSignOff();
    };
    for (const answer of ["", "y", "Release Captain"]) {
      const declined = signoff(dir, { launch, answer });
      expect(await declined.run()).toBe(1);
      expect(declined.err).toEqual(['gate:signoff: not confirmed (expected "Jane Doe"): nothing was written to signoffs/release.yaml']);
      expect(readFileSync(path.join(dir, "signoffs/release.yaml"), "utf8")).toBe(before);
    }
  });

  test("decisions that do not belong to the session are not merged, and the sign-off file is left alone", async () => {
    const dir = repo(MENU);
    await gateCommand([], path.join(dir, "e2e"), env().env);
    const before = readFileSync(path.join(dir, "signoffs/release.yaml"), "utf8");
    const decision = { flow: "flows/app/menu", target: "macos-14/arm64@air-m1", commit: COMMIT, flowHash: "e".repeat(64), verdict: "pass", by: BY, machine: SIGNER.machine, at: "2026-10-11T10:00:00Z" };
    const forged = signoff(dir, { launch: async () => { writeFileSync(path.join(dir, SESSION_DIR, "decisions.json"), JSON.stringify({ version: 1, signoffs: [decision] })); } });
    expect(await forged.run()).toBe(1);
    expect(forged.err.at(-1)).toMatch(/decisions\.json were not merged: the decision for flows\/app\/menu has flowHash "e{64}"; the session's is "[0-9a-f]{64}"$/);
    expect(forged.asked).toEqual([]);
    expect(readFileSync(path.join(dir, "signoffs/release.yaml"), "utf8")).toBe(before);
    const impostor = signoff(dir, { launch: async () => { writeFileSync(path.join(dir, SESSION_DIR, "decisions.json"), JSON.stringify({ version: 1, signoffs: [{ ...decision, flowHash: MENU_HASH, by: "Agent <agent@example.com>" }] })); } });
    expect(await impostor.run()).toBe(1);
    expect(impostor.err.at(-1)).toMatch(/the decision for flows\/app\/menu has by "Agent <agent@example\.com>"; the session's is "Jane Doe <jane@example\.com>"$/);
    const silent = signoff(dir);
    expect(await silent.run()).toBe(1);
    expect(silent.err.at(-1)).toBe("gate:signoff: the checklist recorded no sign-offs: nothing to write");
    const session = JSON.parse(readFileSync(path.join(dir, SESSION_DIR, "session.json"), "utf8")) as SignoffSession;
    const notReady: SignoffSession = { ...session, items: session.items.map(item => ({ ...item, ready: false })) };
    const decisions: SignoffDecisions = { version: 1, signoffs: [{ ...decision, flowHash: MENU_HASH } as SignoffDecisions["signoffs"][number]] };
    expect(() => mergeDecisions(notReady, path.join(dir, SESSION_DIR), dir, [], decisions)).toThrow("the decisions name flows/app/menu, which this session cannot sign off");
  });

  test("mergeDecisions checks the note rules and keeps evidence inside the session's evidence/ folder", async () => {
    const dir = repo(MENU);
    await gateCommand([], path.join(dir, "e2e"), env().env);
    expect(await signoff(dir).run(["--list"])).toBe(0);
    const sessionDir = path.join(dir, SESSION_DIR);
    const session = JSON.parse(readFileSync(path.join(sessionDir, "session.json"), "utf8")) as SignoffSession;
    const decision = (flow: string, fields: Partial<Signoff> = {}): SignoffDecisions => ({ version: 1, signoffs: [{
      flow, target: session.target, commit: COMMIT, flowHash: session.items.find(item => item.flow === flow)!.flowHash, verdict: "pass", by: BY, machine: SIGNER.machine, at: "2026-10-11T10:00:00Z", ...fields,
    }] });
    const merge = (decisions: SignoffDecisions) => mergeDecisions(session, sessionDir, dir, [], decisions);
    // flows/app/ime is manual: true, so it has no screenshot: a pass needs a note, here as in the checklist.
    expect(() => merge(decision("flows/app/ime"))).toThrow("the decision for flows/app/ime is a pass without a note: a pass without a screenshot for every step needs a note");
    expect(() => merge(decision("flows/app/menu", { verdict: "fail" }))).toThrow("the decision for flows/app/menu is a fail without a note: a failed sign-off needs a note");
    expect(merge(decision("flows/app/ime", { note: "Under the caret." }))).toEqual([expect.objectContaining({ flow: "flows/app/ime", note: "Under the caret." })]);
    expect(merge(decision("flows/app/menu", { evidence: ["evidence/flows-app-menu-1.png"] }))[0]!.evidence).toEqual([`${SESSION_DIR}/evidence/flows-app-menu-1.png`]);
    symlinkSync(path.join(dir, "signoffs/release.yaml"), path.join(sessionDir, "evidence/escape.png"));
    for (const [file, problem] of [
      ["../../release.yaml", "which is not in the session's evidence/ folder"],
      ["evidence/../../../release.yaml", "which is not in the session's evidence/ folder"],
      ["evidence/escape.png", "which is not in the session's evidence/ folder"],
      [path.join(dir, "signoffs/release.yaml"), "which is not in the session's evidence/ folder"],
      ["evidence/missing.png", "which does not exist"],
    ]) expect(() => merge(decision("flows/app/menu", { evidence: [file!] }))).toThrow(`the decision for flows/app/menu names evidence ${file}, ${problem}`);
  });

  test("the checklist's quit guard waits until every decision is written", async () => {
    const dir = repo(MENU);
    await gateCommand([], path.join(dir, "e2e"), env().env);
    const decisionsFile = path.join(dir, SESSION_DIR, "decisions.json");
    let quitResult: boolean | undefined;
    const quitting = signoff(dir, {
      launch: async (_artifact, session) => {
        app.quitGuards.length = 0;
        const service = await checklist(session);
        expect(app.quitGuards).toHaveLength(1);
        expect(service.decide("flows/app/menu", "pass", "")).toBeUndefined();
        expect(existsSync(decisionsFile)).toBe(false);
        // Cmd-Q right after Pass: the guard approves the quit only once the decision is on disk.
        quitResult = await app.quitGuards[0]!();
        expect(existsSync(decisionsFile)).toBe(true);
      },
    });
    expect(await quitting.run()).toBe(0);
    expect(quitResult).toBe(true);
    expect(quitting.out.at(-1)).toBe("Wrote 1 sign-off to signoffs/release.yaml. Run bun run gate to apply them.");
  });

  test("--scoped signs off the last gate --flow run", async () => {
    const dir = repo(MENU);
    await gateCommand(["--flow", path.join(dir, "e2e/flows/app/menu.yaml")], path.join(dir, "e2e"), env().env);
    const listed = signoff(dir);
    expect(await listed.run(["--list", "--scoped"])).toBe(0);
    expect(listed.out.slice(1)).toEqual(["  pending: flows/app/menu (run + sign-off)", expect.stringMatching(/menu\.yaml:10:3: Look at the open menu\./)]);
  });

  test("the checklist without a session, with an unreadable one, and for a run that is not ready", async () => {
    app.args = ["KitchenSink"];
    vi.resetModules();
    const bare = await import("../examples/kitchen-sink/screens/infra/sign-off.ts");
    await bare.loadSignOff();
    expect(bare.getSignOffState()).toEqual({ status: "no-session" });
    const dir = mkdtempSync(path.join(tmpdir(), "signoff-session-"));
    writeFileSync(path.join(dir, "session.json"), JSON.stringify({ version: 2, items: [] }));
    expect((await checklist(path.join(dir, "session.json"))).getSignOffState()).toEqual({ status: "error", error: `${path.join(dir, "session.json")} is not a sign-off session from bun run gate:signoff (version 1).` });
    const fixture = await checklist(path.resolve("e2e/fixtures/signoff/session.json"));
    const state = fixture.getSignOffState() as Extract<ReturnType<typeof fixture.getSignOffState>, { status: "ready" }>;
    expect(state.session.items.map(item => [item.kind, item.ready, !!item.signoff])).toEqual([["partial", true, false], ["manual", true, false], ["partial", false, false], ["manual", true, true]]);
    expect(signOffProblem(state.session.items[2]!, "pass", "looks fine")).toBe("not-ready");
    expect(existsSync(fixture.resolvePath(state.dir, state.session.items[0]!.steps[0]!.screenshot!))).toBe(true);
    expect(fixture.resolvePath("/a/b", "../c/./d.png")).toBe("/a/c/d.png");
  });
});
