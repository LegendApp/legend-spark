// `bun run gate`: the release gate (docs/e2e-flows.md#release-gate).
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import type { SdkSurface } from "../../api-surface.ts";
import { areaOf, checkCoverage } from "../coverage.ts";
import { collect } from "../files.ts";
import { checkFile } from "../format/lint.ts";
import { checkSignoffs, FlowFormatError, formatDiagnostic, type Signoff } from "../format/parser.ts";
import type { ManualStep } from "../format/signoff.ts";
import type { BackendFactory } from "../runner/backend.ts";
import { ms, realClock, type Clock, type FlowResult } from "../runner/executor.ts";
import { failureText } from "../runner/report.ts";
import { NO_BACKENDS, printer, runSuite } from "../runner/run.ts";
import { at } from "./manual.ts";
import { gateFlows, matchesAny, plan, repoPath, reportFiles, UsageError, type GatePlan, type Host, type PlannedBudget, type Reason } from "./plan.ts";
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
/** `bundle`: the failure bundle of a failed run, relative to the repository root. */
export type GateFlowEntry = {
  id: string; path: string; blocking: boolean; manual: boolean | "partial"; status: FlowStatus; durationMs?: number; failure?: string; bundle?: string;
  /** Manual flows: the steps a person signs off. Screenshot paths are relative to the repository root. */
  manualSteps?: ManualStep[];
  /** Manual flows: SHA-256 of the flow file. A sign-off for other content is stale. */
  flowHash?: string;
  signoff?: Signoff;
};
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
  /** `--flow`: the gate flows this run was scoped to, relative to e2e/. */
  scope?: string[];
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

export const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** Every e2e file; a scoped run skips the flows outside its scope. */
function lint(plan: GatePlan, reasons: Reason[]) {
  const files = collect(plan.root).filter(([file, kind]) => !plan.scope || kind !== "flow" || plan.scope.includes(path.relative(plan.root, file)));
  const diagnostics = files.flatMap(([file, kind]) => checkFile("lint", kind, readFileSync(file, "utf8"), path.relative(process.cwd(), file)));
  if (diagnostics.length) reasons.push({ check: "lint", message: `bun run e2e:lint found ${plural(diagnostics.length, "problem")}:\n${diagnostics.map(formatDiagnostic).join("\n")}` });
}

/**
 * Coverage over the registries and every gate flow (all targets), with the manifest's surface kinds required.
 * A scoped run keeps the problems in its flows' areas and does not require the whole surface.
 */
function coverage(plan: GatePlan, env: GateEnv, reasons: Reason[]): GateReport["coverage"] {
  const { checks, exports, availability } = plan.manifest.coverage;
  const dir = path.join(plan.root, checks);
  const registries = existsSync(dir) ? collect(dir).filter(([, kind]) => kind === "registry") : [];
  const flows = gateFlows(plan.root, plan.manifest).map(({ file }) => [file, "flow"] as const);
  const report = checkCoverage([...registries, ...flows].map(([file, kind]) => ({ file: path.relative(process.cwd(), file), kind, source: readFileSync(file, "utf8") })), env.surface());
  const required = report.surface.filter(item => item.kind === "availability" ? availability : exports);
  const uncovered = required.filter(item => !item.coveredBy.length);
  const areas = plan.scope && new Set(plan.scope.map(flow => areaOf(flow, "flow")));
  const problems = areas ? report.problems.filter(problem => areas.has(problem.area)) : report.problems;
  if (problems.length) reasons.push({ check: "coverage", message: `bun run e2e:coverage found ${plural(problems.length, "problem")}${areas ? ` in ${[...areas].join(", ")}` : ""}:\n${problems.map(formatDiagnostic).join("\n")}` });
  if (uncovered.length && !areas) reasons.push({ check: "coverage", message: `${uncovered.length} of ${required.length} required SDK surface items have no check a gate flow verifies (bun run e2e:coverage lists them)` });
  return { required: required.length, covered: required.length - uncovered.length, problems: problems.length };
}

/**
 * One entry per planned run ID. A blocking failure, skip or missing result fails the gate; the runner never retries.
 * `manual: true` runs list their planned steps; `partial` runs list the steps the runner reached.
 */
function judgeFlows(plan: GatePlan, results: FlowResult[] | undefined, runDir: string | undefined, reasons: Reason[], warnings: string[]): GateFlowEntry[] {
  const entries: GateFlowEntry[] = [];
  for (const flow of plan.flows) for (const [index, id] of flow.ids.entries()) {
    const entry: GateFlowEntry = { id, path: flow.path, blocking: flow.blocking, manual: flow.manual, status: "not-run", ...(flow.manual ? { flowHash: flow.hash } : {}) };
    entries.push(entry);
    if (flow.manual === true) {
      entry.manualSteps = flow.manualSteps?.[index] ?? [];
      if (flow.manualSteps && !entry.manualSteps.some(step => step.signoff === "required")) reasons.push({ check: "signoffs", message: `${id}: manual: true, but it reaches no manualStep with signoff: required, so nothing verifies it` });
    }
    if (flow.manual === true || !results) continue;
    const result = results.find(candidate => candidate.id === id);
    if (!result) { reasons.push({ check: "flows", message: `${id}: the runner reported no result` }); continue; }
    Object.assign(entry, { status: result.status, durationMs: result.durationMs }, result.bundle ? { bundle: path.relative(plan.repo, path.join(runDir!, result.bundle)) } : {});
    if (flow.manual === "partial") entry.manualSteps = result.manual.map(step => ({
      instruction: step.instruction, expect: step.expect, evidence: step.evidence, signoff: step.signoff, location: at(step.location),
      ...(step.screenshot ? { screenshot: path.relative(plan.repo, path.resolve(runDir!, step.screenshot)) } : {}),
    }));
    const problem = result.status === "skipped" ? `skipped by the runner (${result.skipReason})` : result.failure ? failureText(result.failure).split("\n")[0] : undefined;
    if (!problem) continue;
    entry.failure = problem;
    if (flow.blocking) reasons.push({ check: "flows", message: `${id}: ${problem}` });
    else warnings.push(`non-blocking flow ${id}: ${problem}`);
  }
  return entries;
}

const percent = (value: string) => Number(value.slice(0, -1)) / 100;

/** The budgets this run answers for: all of them, or in a scoped run those its flows record or name in `flows`. */
function budgetsFor(plan: GatePlan, results: FlowResult[] | undefined): PlannedBudget[] {
  if (!plan.scope) return plan.budgets;
  return plan.budgets.filter(budget => (budget.flows && plan.scope!.some(flow => matchesAny(flow, budget.flows!))) || results?.some(result => result.metrics[budget.metric]?.length));
}

/** Each budget against every result that recorded its metric. A blocking budget fails closed: no baseline or no measurement is a failure. */
function judgeBudgets(plan: GatePlan, results: FlowResult[], reasons: Reason[], warnings: string[]): BudgetEntry[] {
  const machine = plan.machine!.id, entries: BudgetEntry[] = [];
  const pathOf = new Map(plan.flows.flatMap(flow => flow.ids.map(id => [id, flow.path])));
  const fail = (budget: PlannedBudget, message: string) => budget.blocking === false ? warnings.push(`non-blocking budget ${message}`) : reasons.push({ check: "budgets", message });
  for (const budget of budgetsFor(plan, results)) {
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

/**
 * A manual run with a `signoff: required` step needs one passing sign-off for this target, commit and flow content. A run
 * with only optional steps may have one. A failed sign-off fails the gate either way. Fails closed: a missing or invalid
 * file, a stale sign-off (another commit or flow content) or a duplicate is a reason, never a pass.
 */
function judgeSignoffs(plan: GatePlan, commit: string, entries: GateFlowEntry[], reasons: Reason[]) {
  const manual = entries.filter(entry => entry.manual && entry.manualSteps);
  const required = (entry: GateFlowEntry) => entry.manualSteps!.some(step => step.signoff === "required");
  const unsigned = (entry: GateFlowEntry) => { if (entry.manual === true) entry.status = "unsigned"; };
  const needed = manual.filter(required);
  if (!manual.length) return;
  const file = path.join(plan.repo, plan.manifest.signoffs), hint = "run bun run gate:signoff";
  if (!existsSync(file)) {
    if (needed.length) reasons.push({ check: "signoffs", message: `${plan.manifest.signoffs} does not exist; ${plural(needed.length, "manual flow run")} need a sign-off (${hint}): ${needed.map(entry => entry.id).join(", ")}` });
    needed.forEach(unsigned);
    return;
  }
  const checked = checkSignoffs(readFileSync(file, "utf8"), path.relative(process.cwd(), file));
  if (!checked.value) { reasons.push({ check: "signoffs", message: `${plan.manifest.signoffs} is invalid:\n${checked.diagnostics.map(formatDiagnostic).join("\n")}` }); needed.forEach(unsigned); return; }
  const short = (hash: string) => hash.slice(0, 12);
  for (const entry of manual) {
    const here = `commit ${short(commit)}, flow ${short(entry.flowHash!)}`;
    const signed = checked.value.signoffs.filter(signoff => signoff.flow === entry.id && signoff.target === plan.target!.id);
    const current = signed.filter(signoff => signoff.commit === commit && signoff.flowHash === entry.flowHash), [only] = current;
    const stale = signed.find(signoff => signoff.commit !== commit || signoff.flowHash !== entry.flowHash);
    const problem = current.length > 1 ? `${current.length} sign-offs for ${plan.target!.id} at ${here}; keep one`
      : only?.verdict === "fail" ? `signed off as failed by ${only.by} on ${only.machine} (${only.at}): ${only.note}`
      : only ? only.evidence?.filter(evidence => !existsSync(path.join(plan.repo, evidence))).map(evidence => `evidence ${evidence} does not exist`).join("; ") || undefined
      : !required(entry) ? undefined
      : stale ? `stale sign-off: it is for commit ${short(stale.commit)}, flow ${short(stale.flowHash)}, not this ${here}${stale.flowHash !== entry.flowHash ? " (the flow changed since)" : ""}; ${hint}`
      : `no sign-off for ${plan.target!.id} at ${here}; ${hint}`;
    if (current.length === 1) entry.signoff = only;
    if (entry.manual === true) entry.status = problem || !only ? "unsigned" : "signed-off";
    if (problem) reasons.push({ check: "signoffs", message: `${entry.id}: ${problem}` });
  }
}

/**
 * Runs every gate check and returns the report. It never passes vacuously: no target, backend, build or flow is a failure.
 * `agent` prints flow events as JSON lines (see runner/run.ts) and no progress text.
 */
export async function runGate(plan: GatePlan, env: GateEnv, { agent = false } = {}): Promise<GateReport> {
  const clock = env.clock ?? realClock, began = clock.now(), startedAt = new Date();
  const timeBudgetMs = ms(plan.manifest.timeBudget);
  const reasons: Reason[] = [...plan.problems], warnings: string[] = [];
  const { target, manifest } = plan;
  const relative = (file: string) => repoPath(plan.repo, file);

  const say = agent ? () => {} : env.stdout;
  const { commit, dirty } = env.source();
  // A scoped run certifies nothing, so it can check work in progress; everything it judges about its flows is unchanged.
  if (dirty && plan.scope) warnings.push("the working tree has uncommitted changes; a --flow run certifies no commit");
  else if (dirty) reasons.push({ check: "source", message: "the working tree has uncommitted changes; the gate certifies a commit" });
  say("lint e2e/…");
  lint(plan, reasons);
  say("coverage…");
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
  const backends = target ? names.map(name => env.backends[name]!({ app: plan.artifact, state: "exact" })).filter(backend => backend.platform === target.platform) : [];
  if (target && !names.length) reasons.push({ check: "backend", message: NO_BACKENDS });
  else if (target && !backends.length) reasons.push({ check: "backend", message: `no ${target.platform} backend is registered (registered: ${names.join(", ")})` });
  const automated = plan.flows.filter(flow => flow.manual !== true);
  if (target && !plan.flows.length) reasons.push({ check: "flows", message: `no gate flows apply to ${target.id} (${plan.scope ? `--flow: ${plan.scope.join(", ")}` : `include: ${manifest.include.join(", ")}`})` });

  let results: FlowResult[] | undefined, runDir: string | undefined;
  // A --target this machine cannot be (other OS, arch or hardware) is planned, never run.
  if (target && !plan.problems.some(problem => problem.check === "target") && backends.length && exists && automated.length) {
    runDir = reportFiles(plan).run;
    rmSync(runDir, { recursive: true, force: true });
    say(`running ${plural(automated.length, "flow")} on ${target.id} with ${backends.map(backend => backend.name).join(", ")}…`);
    ({ report: { flows: results } } = await runSuite(automated.map(flow => flow.file), {
      backends, runDir, app: plan.artifact, clock, signal: env.signal, deadline: began + timeBudgetMs, host: plan.host, onEvent: printer(env, agent),
    }));
  } else if (automated.length) say("flows not run: see the reasons below");
  const flows = judgeFlows(plan, results, runDir, reasons, warnings);
  judgeSignoffs(plan, commit, flows, reasons);

  const budgets = plan.machine && results ? judgeBudgets(plan, results, reasons, warnings) : [];
  const unchecked = plan.machine && !results ? budgetsFor(plan, undefined) : [];
  if (unchecked.length) reasons.push({ check: "budgets", message: `${plural(unchecked.length, "budget")} for ${plan.machine!.id} not checked: no flows ran` });

  const durationMs = Math.round(clock.now() - began);
  if (durationMs > timeBudgetMs) reasons.push({ check: "time-budget", message: `the gate took ${durationMs}ms; its time budget is ${timeBudgetMs}ms (${manifest.timeBudget})` });
  if (env.signal?.aborted) reasons.push({ check: "flows", message: "the gate was interrupted" });

  return {
    version: 1, verdict: reasons.length ? "FAIL" : "PASS", suite: manifest.suite, appId: manifest.appId, startedAt: startedAt.toISOString(), durationMs, timeBudgetMs,
    host: plan.host, target: target?.id, machine: plan.machine?.id, commit, dirty, ...(plan.scope ? { scope: plan.scope } : {}),
    build: { artifact: plan.artifact && relative(plan.artifact), exists, signature }, backends: backends.map(backend => backend.name),
    reasons, warnings,
    coverage: coverageSummary, flows, excluded: plan.excluded, budgets, run: runDir && relative(runDir),
  };
}

const USAGE = "usage: bun run gate [--target <os>/<arch>[@machine]] [--flow <flow|dir>]… [--artifact <app>] [--agent] [--dry-run]";

/** `bun run gate` arguments. Throws UsageError. `--flow` and `--artifact` paths are resolved from the working directory. */
export function parseGateArgs(args: string[]) {
  const options = { target: undefined as string | undefined, flows: [] as string[], artifact: undefined as string | undefined, agent: false, dryRun: false };
  for (let index = 0; index < args.length; index++) {
    const [flag, inline] = args[index]!.split(/=(.*)/s, 2) as [string, string | undefined];
    if ((flag === "--dry-run" || flag === "--agent") && inline === undefined) { options[flag === "--agent" ? "agent" : "dryRun"] = true; continue; }
    if (flag !== "--target" && flag !== "--flow" && flag !== "--artifact") throw new UsageError(`unknown argument ${args[index]}`);
    const value = inline ?? args[index + 1];
    if (!value || value.startsWith("--")) throw new UsageError(`${flag} needs a value`);
    if (inline === undefined) index++;
    if (flag === "--flow") options.flows.push(path.resolve(value));
    else if (flag === "--artifact") options.artifact = path.resolve(value);
    else options.target = value;
  }
  return options;
}

/** The agent summary: one JSON line with the verdict, every reason and each run's status, failure and absolute bundle path. */
export function agentSummary(report: GateReport, files: { json: string; html: string }, repo: string): string {
  const absolute = (file: string) => path.join(repo, file);
  return JSON.stringify({
    event: "gate-end", verdict: report.verdict, target: report.target, ...(report.scope ? { scope: report.scope } : {}), reasons: report.reasons, warnings: report.warnings,
    flows: report.flows.map(({ id, status, blocking, failure, bundle }) => ({ id, status, blocking, ...(failure ? { failure } : {}), ...(bundle ? { bundle: absolute(bundle) } : {}) })),
    report: files, ...(report.run ? { run: absolute(report.run) } : {}),
  });
}

/** `bun run gate`: exit 0 on PASS, 1 on FAIL (or an invalid manifest), 2 on a usage error. `root` is the e2e/ directory. */
export async function gateCommand(args: string[], root: string, env: GateEnv): Promise<number> {
  let options: ReturnType<typeof parseGateArgs>, gatePlan: GatePlan;
  try {
    options = parseGateArgs(args);
    gatePlan = plan(root, env.host(), { target: options.target, only: options.flows.length ? options.flows : undefined, artifact: options.artifact });
  } catch (error) {
    if (error instanceof UsageError) { env.stderr(`${error.message}\n${USAGE}`); return 2; }
    if (error instanceof FlowFormatError) { env.stderr(`gate.yaml is invalid:\n${error.message}`); return 1; }
    throw error;
  }
  if (options.dryRun) {
    const platform = gatePlan.target?.platform;
    env.stdout(planText(gatePlan, Object.entries(env.backends).filter(([, factory]) => factory({ app: gatePlan.artifact }).platform === platform).map(([name]) => name)));
    return 0;
  }
  const report = await runGate(gatePlan, env, { agent: options.agent });
  const { run: _run, ...files } = reportFiles(gatePlan);
  writeGateReport(report, files, gatePlan.repo);
  env.stdout(options.agent ? agentSummary(report, files, gatePlan.repo) : verdictText(report, files));
  return report.verdict === "PASS" ? 0 : 1;
}
