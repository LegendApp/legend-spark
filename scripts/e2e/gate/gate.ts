// `bun run gate`: the release gate (docs/e2e-flows.md#release-gate).
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import type { SdkSurface } from "../../api-surface.ts";
import { checkCoverage } from "../coverage.ts";
import { collect } from "../files.ts";
import { checkFile } from "../format/lint.ts";
import { checkSignoffs, FlowFormatError, formatDiagnostic, type Signoff } from "../format/parser.ts";
import type { BackendFactory } from "../runner/backend.ts";
import { ms, realClock, type Clock, type FlowResult } from "../runner/executor.ts";
import { failureText } from "../runner/report.ts";
import { NO_BACKENDS, printer, runSuite } from "../runner/run.ts";
import { gateFlows, matchesAny, plan, UsageError, type GatePlan, type Host, type PlannedBudget, type Reason } from "./plan.ts";
import { planText, verdictText, writeGateReport } from "./report.ts";

/** Everything the gate reads from the machine. Tests pass doubles; `host.ts` has the real one. */
export type GateEnv = {
  backends: Readonly<Record<string, BackendFactory>>;
  host(): Host;
  source(): { commit: string; dirty: boolean };
  /** Why the artifact's code signature does not verify, or undefined when it does. */
  verifySignature(artifact: string): string | undefined;
  surface(): SdkSurface;
  stdout(line: string): void;
  stderr(line: string): void;
  clock?: Clock;
  signal?: AbortSignal;
};

export type FlowStatus = "passed" | "failed" | "skipped" | "not-run" | "signed-off" | "unsigned";
export type GateFlowEntry = { id: string; path: string; blocking: boolean; manual: boolean | "partial"; status: FlowStatus; durationMs?: number; failure?: string; signoff?: Signoff };
export type BudgetEntry = {
  metric: string; flow?: string; machine: string; better: "lower" | "higher"; baseline: number | "not-measured"; limit?: number; value?: number;
  blocking: boolean; status: "pass" | "fail";
};
export type GateReport = {
  version: 1;
  verdict: "PASS" | "FAIL";
  suite: string;
  appId: string;
  startedAt: string;
  durationMs: number;
  timeBudgetMs: number;
  host: Host;
  target?: string;
  machine?: string;
  commit: string;
  dirty: boolean;
  build: { artifact?: string; exists: boolean; signature: "verified" | "failed" | "not-checked" };
  backends: string[];
  /** Every reason the verdict is FAIL. Empty means PASS. */
  reasons: Reason[];
  /** Failures that do not block: non-blocking flows and budgets. */
  warnings: string[];
  coverage?: { required: number; covered: number; problems: number };
  flows: GateFlowEntry[];
  excluded: GatePlan["excluded"];
  budgets: BudgetEntry[];
  /** The runner's report directory (report.json, junit.xml, index.html), relative to the repository root. */
  run?: string;
};

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

function lint(plan: GatePlan, reasons: Reason[]) {
  const diagnostics = collect(plan.root).flatMap(([file, kind]) => checkFile("lint", kind, readFileSync(file, "utf8"), path.relative(process.cwd(), file)));
  if (diagnostics.length) reasons.push({ check: "lint", message: `bun run e2e:lint found ${plural(diagnostics.length, "problem")}:\n${diagnostics.map(formatDiagnostic).join("\n")}` });
}

/** Coverage over the registries and every gate flow (all targets), with the manifest's surface kinds required. */
function coverage(plan: GatePlan, env: GateEnv, reasons: Reason[]): GateReport["coverage"] {
  const { checks, exports, availability } = plan.manifest.coverage;
  const dir = path.join(plan.root, checks);
  const registries = existsSync(dir) ? collect(dir).filter(([, kind]) => kind === "registry") : [];
  const flows = gateFlows(plan.root, plan.manifest).map(({ file }) => [file, "flow"] as const);
  const report = checkCoverage([...registries, ...flows].map(([file, kind]) => ({ file: path.relative(process.cwd(), file), kind, source: readFileSync(file, "utf8") })), env.surface());
  const required = report.surface.filter(item => item.kind === "availability" ? availability : exports);
  const uncovered = required.filter(item => !item.coveredBy.length);
  if (report.problems.length) reasons.push({ check: "coverage", message: `bun run e2e:coverage found ${plural(report.problems.length, "problem")}:\n${report.problems.map(formatDiagnostic).join("\n")}` });
  if (uncovered.length) reasons.push({ check: "coverage", message: `${uncovered.length} of ${required.length} required SDK surface items have no check a gate flow verifies (bun run e2e:coverage lists them)` });
  return { required: required.length, covered: required.length - uncovered.length, problems: report.problems.length };
}

/** One entry per planned run ID. A blocking failure, skip or missing result fails the gate; the runner never retries. */
function judgeFlows(plan: GatePlan, results: FlowResult[] | undefined, reasons: Reason[], warnings: string[]): GateFlowEntry[] {
  const entries: GateFlowEntry[] = [];
  for (const flow of plan.flows) for (const id of flow.ids) {
    const entry: GateFlowEntry = { id, path: flow.path, blocking: flow.blocking, manual: flow.manual, status: "not-run" };
    entries.push(entry);
    if (flow.manual === true || !results) continue;
    const result = results.find(candidate => candidate.id === id);
    if (!result) { reasons.push({ check: "flows", message: `${id}: the runner reported no result` }); continue; }
    Object.assign(entry, { status: result.status, durationMs: result.durationMs });
    const problem = result.status === "skipped" ? `skipped by the runner (${result.skipReason})` : result.failure ? failureText(result.failure).split("\n")[0] : undefined;
    if (!problem) continue;
    entry.failure = problem;
    if (flow.blocking) reasons.push({ check: "flows", message: `${id}: ${problem}` });
    else warnings.push(`non-blocking flow ${id}: ${problem}`);
  }
  return entries;
}

const percent = (value: string) => Number(value.slice(0, -1)) / 100;

/** Each budget against every result that recorded its metric. A blocking budget fails closed: no baseline or no measurement is a failure. */
function judgeBudgets(plan: GatePlan, results: FlowResult[], reasons: Reason[], warnings: string[]): BudgetEntry[] {
  const machine = plan.machine!.id, entries: BudgetEntry[] = [];
  const pathOf = new Map(plan.flows.flatMap(flow => flow.ids.map(id => [id, flow.path])));
  const fail = (budget: PlannedBudget, message: string) => budget.blocking === false ? warnings.push(`non-blocking budget ${message}`) : reasons.push({ check: "budgets", message });
  for (const budget of plan.budgets) {
    const blocking = budget.blocking !== false, base = { metric: budget.metric, machine, better: budget.better, baseline: budget.baseline, blocking };
    const measured = results.filter(result => !budget.flows || matchesAny(pathOf.get(result.id)!, budget.flows))
      .flatMap(result => (result.metrics[budget.metric] ?? []).map(value => ({ flow: result.id, value })));
    if (budget.baseline === "not-measured") {
      const values = measured.map(({ flow, value }) => `${flow}: ${value}`).join(", ");
      fail(budget, `${budget.metric} has no baseline for ${machine} (not-measured)${values ? `; measured ${values}` : ""}. Record a baseline in ${plan.manifest.budgets}`);
      entries.push({ ...base, status: "fail", ...(measured[0] ? { flow: measured[0].flow, value: measured[0].value } : {}) });
      continue;
    }
    if (!measured.length) {
      fail(budget, `${budget.metric}: no gate flow recorded it on ${machine}`);
      entries.push({ ...base, status: "fail" });
      continue;
    }
    const limit = +(budget.baseline * (budget.better === "lower" ? 1 + percent(budget.tolerance) : 1 - percent(budget.tolerance))).toFixed(6);
    for (const { flow, value } of measured) {
      const ok = budget.better === "lower" ? value <= limit : value >= limit;
      entries.push({ ...base, flow, value, limit, status: ok ? "pass" : "fail" });
      if (!ok) fail(budget, `${flow}: ${budget.metric} ${value} is ${budget.better === "lower" ? "above" : "below"} its budget ${limit} (baseline ${budget.baseline} ${budget.better === "lower" ? "+" : "-"}${budget.tolerance})`);
    }
  }
  return entries;
}

/** Manual flows need a passing sign-off for this target and commit, per run ID. */
function judgeSignoffs(plan: GatePlan, commit: string, entries: GateFlowEntry[], reasons: Reason[]) {
  const needed = entries.filter(entry => entry.manual);
  if (!needed.length) return;
  const file = path.join(plan.repo, plan.manifest.signoffs);
  if (!existsSync(file)) {
    reasons.push({ check: "signoffs", message: `${plan.manifest.signoffs} does not exist; ${plural(needed.length, "manual flow run")} need a sign-off: ${needed.map(entry => entry.id).join(", ")}` });
    for (const entry of needed) if (entry.manual === true) entry.status = "unsigned";
    return;
  }
  const checked = checkSignoffs(readFileSync(file, "utf8"), path.relative(process.cwd(), file));
  if (!checked.value) { reasons.push({ check: "signoffs", message: `${plan.manifest.signoffs} is invalid:\n${checked.diagnostics.map(formatDiagnostic).join("\n")}` }); return; }
  for (const entry of needed) {
    const matches = checked.value.signoffs.filter(signoff => signoff.flow === entry.id && signoff.target === plan.target!.id && signoff.commit === commit);
    const problem = !matches.length ? `no sign-off for ${plan.target!.id} at commit ${commit.slice(0, 12)}`
      : matches.length > 1 ? `${matches.length} sign-offs for ${plan.target!.id} at commit ${commit.slice(0, 12)}; keep one`
      : matches[0]!.verdict === "fail" ? `signed off as failed by ${matches[0]!.by} (${matches[0]!.at})${matches[0]!.note ? `: ${matches[0]!.note}` : ""}`
      : matches[0]!.evidence?.filter(evidence => !existsSync(path.join(plan.repo, evidence))).map(evidence => `evidence ${evidence} does not exist`).join("; ") || undefined;
    if (matches.length === 1) entry.signoff = matches[0];
    if (entry.manual === true) entry.status = problem ? "unsigned" : "signed-off";
    if (problem) reasons.push({ check: "signoffs", message: `${entry.id}: ${problem}` });
  }
}

/** Runs every gate check and returns the report. It never passes vacuously: no target, backend, build or flow is a failure. */
export async function runGate(plan: GatePlan, env: GateEnv): Promise<GateReport> {
  const clock = env.clock ?? realClock, began = clock.now(), startedAt = new Date();
  const timeBudgetMs = ms(plan.manifest.timeBudget);
  const reasons: Reason[] = [...plan.problems], warnings: string[] = [];
  const { target, manifest } = plan;
  const relative = (file: string) => path.relative(plan.repo, file);

  const { commit, dirty } = env.source();
  if (dirty) reasons.push({ check: "source", message: "the working tree has uncommitted changes; the gate certifies a commit" });
  env.stdout("lint e2e/…");
  lint(plan, reasons);
  env.stdout("coverage…");
  const coverageSummary = coverage(plan, env, reasons);

  const exists = !!plan.artifact && existsSync(plan.artifact);
  let signature: GateReport["build"]["signature"] = "not-checked";
  if (plan.artifact && !exists) reasons.push({ check: "build", message: `the release build ${relative(plan.artifact)} does not exist` });
  if (exists && target && manifest.build[target.platform]!.verifySignature) {
    const problem = env.verifySignature(plan.artifact!);
    signature = problem ? "failed" : "verified";
    if (problem) reasons.push({ check: "build", message: `${relative(plan.artifact!)}: code signature does not verify: ${problem}` });
  }

  const names = Object.keys(env.backends);
  const backends = target ? names.map(name => env.backends[name]!({ app: plan.artifact })).filter(backend => backend.platform === target.platform) : [];
  if (target && !names.length) reasons.push({ check: "backend", message: NO_BACKENDS });
  else if (target && !backends.length) reasons.push({ check: "backend", message: `no ${target.platform} backend is registered (registered: ${names.join(", ")})` });
  const automated = plan.flows.filter(flow => flow.manual !== true);
  if (target && !plan.flows.length) reasons.push({ check: "flows", message: `no gate flows apply to ${target.id} (include: ${manifest.include.join(", ")})` });

  let results: FlowResult[] | undefined, runDir: string | undefined;
  // A --target this machine cannot be (other OS, arch or hardware) is planned, never run.
  if (target && !plan.problems.some(problem => problem.check === "target") && backends.length && exists && automated.length) {
    runDir = path.join(path.dirname(path.join(plan.repo, manifest.report.json)), "run");
    rmSync(runDir, { recursive: true, force: true });
    env.stdout(`running ${plural(automated.length, "flow")} on ${target.id} with ${backends.map(backend => backend.name).join(", ")}…`);
    ({ report: { flows: results } } = await runSuite(automated.map(flow => flow.file), {
      backends, runDir, app: plan.artifact, clock, signal: env.signal, deadline: began + timeBudgetMs, onEvent: printer(env, false),
    }));
  } else if (automated.length) env.stdout("flows not run: see the reasons below");
  const flows = judgeFlows(plan, results, reasons, warnings);
  judgeSignoffs(plan, commit, flows, reasons);

  const budgets = plan.machine && results ? judgeBudgets(plan, results, reasons, warnings) : [];
  if (plan.machine && plan.budgets.length && !results) reasons.push({ check: "budgets", message: `${plural(plan.budgets.length, "budget")} for ${plan.machine.id} not checked: no flows ran` });

  const durationMs = Math.round(clock.now() - began);
  if (durationMs > timeBudgetMs) reasons.push({ check: "time-budget", message: `the gate took ${durationMs}ms; its time budget is ${timeBudgetMs}ms (${manifest.timeBudget})` });
  if (env.signal?.aborted) reasons.push({ check: "flows", message: "the gate was interrupted" });

  return {
    version: 1, verdict: reasons.length ? "FAIL" : "PASS", suite: manifest.suite, appId: manifest.appId, startedAt: startedAt.toISOString(), durationMs, timeBudgetMs,
    host: plan.host, target: target?.id, machine: plan.machine?.id, commit, dirty,
    build: { artifact: plan.artifact && relative(plan.artifact), exists, signature }, backends: backends.map(backend => backend.name),
    reasons, warnings,
    coverage: coverageSummary, flows, excluded: plan.excluded, budgets, run: runDir && relative(runDir),
  };
}

const USAGE = "usage: bun run gate [--target <os>/<arch>[@machine]] [--dry-run]";

/** `bun run gate`: exit 0 on PASS, 1 on FAIL (or an invalid manifest), 2 on a usage error. `root` is the e2e/ directory. */
export async function gateCommand(args: string[], root: string, env: GateEnv): Promise<number> {
  let target: string | undefined, dryRun = false;
  for (let index = 0; index < args.length; index++) {
    const [flag, inline] = args[index]!.split(/=(.*)/s, 2) as [string, string | undefined];
    if (flag === "--dry-run" && inline === undefined) { dryRun = true; continue; }
    const value = inline ?? args[index + 1];
    if (flag === "--target" && value && !value.startsWith("--")) { target = value; if (inline === undefined) index++; continue; }
    env.stderr(`${flag === "--target" ? "--target needs a value" : `unknown argument ${args[index]}`}\n${USAGE}`);
    return 2;
  }
  let gatePlan: GatePlan;
  try { gatePlan = plan(root, env.host(), target); } catch (error) {
    if (error instanceof UsageError) { env.stderr(`${error.message}\n${USAGE}`); return 2; }
    if (error instanceof FlowFormatError) { env.stderr(`gate.yaml is invalid:\n${error.message}`); return 1; }
    throw error;
  }
  if (dryRun) {
    const platform = gatePlan.target?.platform;
    env.stdout(planText(gatePlan, Object.entries(env.backends).filter(([, factory]) => factory({ app: gatePlan.artifact }).platform === platform).map(([name]) => name)));
    return 0;
  }
  const report = await runGate(gatePlan, env);
  const files = { json: path.join(gatePlan.repo, gatePlan.manifest.report.json), html: path.join(gatePlan.repo, gatePlan.manifest.report.html) };
  writeGateReport(report, files, gatePlan.repo);
  env.stdout(verdictText(report, files));
  return report.verdict === "PASS" ? 0 : 1;
}
