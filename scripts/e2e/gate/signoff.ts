// `bun run gate:signoff`: the manual sign-off session (docs/e2e-flows.md#manual-sign-offs). It turns the last gate run's
// manual flow runs into a checklist session, opens the release build on its sign-off screen (infra/sign-off), and, once the
// person at the terminal confirms them, merges their decisions into the sign-off file. It is a local tool, not a
// cryptographic one: what keeps agents from signing off is that it needs a terminal and a typed confirmation.
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stringify } from "yaml";
import { checkSignoffs, FlowFormatError, formatDiagnostic, type Signoff } from "../format/parser.ts";
import { signOffProblem, type SignOffProblem } from "../../../examples/kitchen-sink/sign-off-rule.ts";
import type { SignoffDecisions, SignoffItem, SignoffSession } from "../format/signoff.ts";
import { plural, type GateEnv, type GateReport } from "./gate.ts";
import { plan, reportFiles, UsageError, type GatePlan } from "./plan.ts";

export type Signer = { name: string; email: string; machine: string };
export type SignoffEnv = Pick<GateEnv, "host" | "source" | "stdout" | "stderr"> & {
  /** The person signing: git user.name and user.email, and the host name and model. */
  signer(): Signer;
  /** A person is at a terminal: stdin and stdout are TTYs. Without one, gate:signoff records nothing. */
  interactive: boolean;
  /** Asks the person at the terminal; resolves with the line they typed. */
  ask(question: string): Promise<string>;
  /** Opens the app with `--ks-signoff <session>` and resolves when it quits. */
  launch(app: string, session: string): Promise<void>;
};

const USAGE = "usage: bun run gate:signoff [--list] [--scoped]";
const DECISIONS = "decisions.json";
const slug = (id: string) => id.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "");

/** Reads the sign-off file, or none when it does not exist yet. Throws when it is invalid: it is never overwritten then. */
function readSignoffs(file: string): Signoff[] {
  if (!existsSync(file)) return [];
  const checked = checkSignoffs(readFileSync(file, "utf8"), path.relative(process.cwd(), file));
  if (!checked.value) throw new FlowFormatError(checked.diagnostics);
  return checked.value.signoffs;
}

/** Why the last gate report cannot be signed off on this machine now, or undefined. */
function staleness(report: GateReport, gatePlan: GatePlan, source: { commit: string; dirty: boolean }): string | undefined {
  const rerun = "Run bun run gate again first";
  if (report.target !== gatePlan.target!.id) return `the last gate run was for ${report.target ?? "no target"}, not ${gatePlan.target!.id}. ${rerun}`;
  if (report.dirty || source.dirty) return "sign-offs certify a commit: commit or remove uncommitted changes, then run bun run gate";
  if (report.commit !== source.commit) return `the last gate run tested commit ${report.commit.slice(0, 12)}; HEAD is ${source.commit.slice(0, 12)}. ${rerun}`;
  const hashes = new Map(gatePlan.flows.map(flow => [flow.path, flow.hash]));
  const changed = report.flows.find(entry => entry.manual && entry.flowHash !== hashes.get(entry.path));
  if (changed) return `${changed.path} changed since the last gate run. ${rerun}`;
}

/**
 * The checklist session for the gate report's manual runs, in `dir`. Screenshots the runner captured are copied next to
 * it (the next gate run deletes its run directory), so evidence outlives the run. Decisions an interrupted session left
 * unconfirmed in its decisions file are kept when they still belong to this session and their screenshots are unchanged,
 * so the checklist shows them again and the person confirms them this time; `dropped` says why the others were not.
 */
export function writeSession(report: GateReport, gatePlan: GatePlan, signer: Pick<SignoffSession, "by" | "machine">, existing: Signoff[], dir: string): { session: SignoffSession; kept: Signoff[]; dropped: string[] } {
  mkdirSync(path.join(dir, "evidence"), { recursive: true });
  const planned = new Map(gatePlan.flows.map(flow => [flow.path, flow]));
  const changed = new Set<string>();
  const items = report.flows.filter(entry => entry.manual).map((entry): SignoffItem => {
    const flow = planned.get(entry.path);
    const steps = (entry.manualSteps ?? []).map((step, index) => {
      if (!step.screenshot) return step;
      const source = path.join(gatePlan.repo, step.screenshot), copy = path.join("evidence", `${slug(entry.id)}-${index + 1}.png`), target = path.join(dir, copy);
      if (!existsSync(source)) throw new Error(`${step.screenshot} from the last gate run is gone. Run bun run gate again`);
      if (existsSync(target) && !readFileSync(target).equals(readFileSync(source))) changed.add(copy);
      copyFileSync(source, target);
      return { ...step, screenshot: copy };
    });
    const kind = entry.manual === true ? "manual" : "partial";
    const reason = !steps.length ? (entry.failure ? `The automated steps failed: ${entry.failure}` : `The last gate run reached no manual step (${entry.status})`)
      : kind === "partial" && entry.status !== "passed" ? `The automated steps ${entry.status === "failed" ? `failed: ${entry.failure}` : `did not run (${entry.status})`}` : undefined;
    const flowHash = entry.flowHash!;
    const signoff = existing.find(candidate => candidate.flow === entry.id && candidate.target === report.target && candidate.commit === report.commit && candidate.flowHash === flowHash);
    return { flow: entry.id, name: flow?.name ?? entry.path, ...(flow?.intent ? { intent: flow.intent } : {}), kind, flowHash, ready: !reason, ...(reason ? { reason } : {}), steps, ...(signoff ? { signoff } : {}) };
  });
  const session: SignoffSession = { version: 1, target: report.target!, commit: report.commit, ...signer, decisions: DECISIONS, items };
  writeFileSync(path.join(dir, "session.json"), `${JSON.stringify(session, null, 2)}\n`);

  const decisionsFile = path.join(dir, DECISIONS), kept: Signoff[] = [], dropped: string[] = [];
  if (!existsSync(decisionsFile)) return { session, kept, dropped };
  let earlier: Signoff[] = [];
  try { earlier = (JSON.parse(readFileSync(decisionsFile, "utf8")) as SignoffDecisions).signoffs ?? []; } catch (error) { dropped.push(`${DECISIONS} is unreadable: ${(error as Error).message}`); }
  for (const signoff of earlier) {
    const problem = decisionProblem(session, dir, signoff)
      ?? (signoff.evidence?.some(file => changed.has(path.normalize(file))) ? `the screenshot the decision for ${signoff.flow} names changed in a later gate run` : undefined);
    if (problem) dropped.push(problem);
    else kept.push(signoff);
  }
  if (kept.length) writeFileSync(decisionsFile, `${JSON.stringify({ version: 1, signoffs: kept } satisfies SignoffDecisions, null, 2)}\n`);
  else rmSync(decisionsFile);
  return { session, kept, dropped };
}

const PROBLEMS: Record<SignOffProblem, string> = {
  "not-ready": "this run cannot be signed off",
  "fail-needs-note": "a failed sign-off needs a note",
  "evidence-needs-note": "a pass without a screenshot for every step needs a note",
};

/**
 * Why a decision cannot be merged, or undefined. The decisions file is only as trustworthy as the checklist that wrote it,
 * so the rules are checked again here: a decision must belong to the session (its ready runs, target, commit, flow content
 * and signer), follow signOffProblem, and name evidence inside the session's evidence/ folder (no `..` or symlink out of it).
 */
function decisionProblem(session: SignoffSession, dir: string, signoff: Signoff): string | undefined {
  const item = session.items.find(candidate => candidate.ready && candidate.flow === signoff.flow);
  if (!item) return `the decisions name ${signoff.flow}, which this session cannot sign off`;
  const expected = { target: session.target, commit: session.commit, flowHash: item.flowHash, by: session.by, machine: session.machine };
  const foreign = (Object.keys(expected) as Array<keyof typeof expected>).find(key => signoff[key] !== expected[key]);
  if (foreign) return `the decision for ${signoff.flow} has ${foreign} ${JSON.stringify(signoff[foreign])}; the session's is ${JSON.stringify(expected[foreign])}`;
  const problem = signOffProblem(item, signoff.verdict, signoff.note);
  if (problem) return `the decision for ${signoff.flow} is a ${signoff.verdict} without a note: ${PROBLEMS[problem]}`;
  const evidenceDir = realpathSync(path.join(dir, "evidence"));
  for (const file of signoff.evidence ?? []) {
    let real: string;
    try { real = realpathSync(path.resolve(dir, file)); } catch { return `the decision for ${signoff.flow} names evidence ${file}, which does not exist`; }
    if (path.dirname(real) !== evidenceDir) return `the decision for ${signoff.flow} names evidence ${file}, which is not in the session's evidence/ folder`;
  }
}

/**
 * Merges the checklist's decisions into the sign-off file after checking each with decisionProblem: each replaces any
 * earlier sign-off of its run on this target. Evidence becomes repository-relative.
 */
export function mergeDecisions(session: SignoffSession, dir: string, repo: string, existing: Signoff[], decisions: SignoffDecisions): Signoff[] {
  const made = decisions.signoffs.map(signoff => {
    const problem = decisionProblem(session, dir, signoff);
    if (problem) throw new Error(problem);
    return { ...signoff, ...(signoff.evidence ? { evidence: signoff.evidence.map(file => path.relative(repo, path.resolve(dir, file))) } : {}) };
  });
  if (new Set(made.map(signoff => signoff.flow)).size !== made.length) throw new Error("the decisions sign off a run twice");
  const replaced = new Set(made.map(signoff => signoff.flow));
  return [...existing.filter(signoff => signoff.target !== session.target || !replaced.has(signoff.flow)), ...made];
}

/** Writes the sign-off file after validating it against its schema, so the gate can always read what this wrote. */
export function writeSignoffs(file: string, signoffs: Signoff[]) {
  const text = `# Written by bun run gate:signoff; see docs/e2e-flows.md#manual-sign-offs.\n${stringify({ signoffs })}`;
  const checked = checkSignoffs(text, path.relative(process.cwd(), file));
  if (!checked.value) throw new FlowFormatError(checked.diagnostics);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function describe(session: SignoffSession, kept: Signoff[], stdout: (line: string) => void) {
  stdout(`Sign-off session for ${session.target} at commit ${session.commit.slice(0, 12)}, as ${session.by} on ${session.machine}:`);
  for (const item of session.items) {
    const decided = kept.find(signoff => signoff.flow === item.flow);
    stdout(`  ${decided ? `decided ${decided.verdict}, not confirmed yet` : item.signoff ? `signed ${item.signoff.verdict}` : item.ready ? "pending" : "not ready"}: ${item.flow} (${item.kind === "manual" ? "manual" : "run + sign-off"})${item.reason ? `: ${item.reason}` : ""}`);
    for (const step of item.steps) stdout(`    ${step.location}: ${step.instruction} Expect: ${step.expect}${step.screenshot ? ` [${step.screenshot}: ${step.capture}]` : " [no screenshot: a pass needs a note]"}${step.signoff === "optional" ? " (optional)" : ""}`);
  }
}

/**
 * `bun run gate:signoff [--list] [--scoped]`: 0 when the decisions were merged (or listed), 1 when it cannot sign off, 2 on
 * a usage error. `--scoped` signs off the last `gate --flow` run instead of the last full run.
 */
export async function signoffCommand(args: string[], root: string, env: SignoffEnv): Promise<number> {
  const list = args.includes("--list"), scoped = args.includes("--scoped"), unknown = args.filter(arg => arg !== "--list" && arg !== "--scoped");
  if (unknown.length) { env.stderr(`unknown argument ${unknown[0]}\n${USAGE}`); return 2; }
  const fail = (message: string) => { env.stderr(`gate:signoff: ${message}`); return 1; };
  // Fail closed before anything is written: a sign-off is a person's statement, so it needs a person at a terminal.
  if (!list && !env.interactive) return fail("a sign-off is a person's statement: run it yourself at a terminal. Agents never sign off; bun run gate:signoff --list shows what awaits a person");
  let gatePlan: GatePlan, signer: Signer;
  try { gatePlan = plan(root, env.host()); } catch (error) {
    if (error instanceof UsageError) { env.stderr(`${error.message}\n${USAGE}`); return 2; }
    if (error instanceof FlowFormatError) { env.stderr(`gate.yaml is invalid:\n${error.message}`); return 1; }
    throw error;
  }
  try { signer = env.signer(); } catch (error) { return fail((error as Error).message); }
  const planProblem = gatePlan.problems.find(problem => problem.check === "target" || problem.check === "signoffs");
  if (!gatePlan.target || planProblem) return fail(planProblem?.message ?? "this machine is not a gate target");
  // reportFiles puts a scoped run's report under scoped/; any scope selects it.
  const reportFile = reportFiles({ ...gatePlan, scope: scoped ? [] : undefined }).json;
  if (!existsSync(reportFile)) return fail(`no gate report at ${path.relative(process.cwd(), reportFile)}. Run bun run gate${scoped ? " --flow <flow>" : ""} first`);
  const report: GateReport = JSON.parse(readFileSync(reportFile, "utf8"));
  const stale = staleness(report, gatePlan, env.source());
  if (stale) return fail(stale);
  const signoffsFile = path.join(gatePlan.repo, gatePlan.manifest.signoffs);
  let existing: Signoff[];
  try { existing = readSignoffs(signoffsFile); } catch (error) { return fail(`${gatePlan.manifest.signoffs} is invalid; fix it first:\n${(error as Error).message}`); }

  const dir = path.join(path.dirname(signoffsFile), "manual", report.commit.slice(0, 12));
  const by = `${signer.name} <${signer.email}>`;
  let written: ReturnType<typeof writeSession>;
  try { written = writeSession(report, gatePlan, { by, machine: signer.machine }, existing, dir); } catch (error) { return fail((error as Error).message); }
  const { session, kept, dropped } = written;
  if (!session.items.length) { env.stdout(`No manual flow runs for ${session.target}: nothing to sign off.`); return 0; }
  describe(session, kept, env.stdout);
  for (const problem of dropped) env.stderr(`gate:signoff: dropped an unconfirmed decision of an earlier session: ${problem}`);
  if (list) return 0;

  if (!gatePlan.artifact || !existsSync(gatePlan.artifact)) return fail(`the release build ${gatePlan.artifact ? path.relative(gatePlan.repo, gatePlan.artifact) : "for this target"} does not exist`);
  env.stdout(`Opening the sign-off checklist in ${path.relative(process.cwd(), gatePlan.artifact)}. Sign off each run, then quit the app.`);
  try { await env.launch(gatePlan.artifact, path.join(dir, "session.json")); } catch (error) { return fail((error as Error).message); }
  const decisionsFile = path.join(dir, DECISIONS);
  if (!existsSync(decisionsFile)) return fail("the checklist recorded no sign-offs: nothing to write");
  try {
    const decisions: SignoffDecisions = JSON.parse(readFileSync(decisionsFile, "utf8"));
    if (!decisions.signoffs?.length) return fail("the checklist recorded no sign-offs: nothing to write");
    const merged = mergeDecisions(session, dir, gatePlan.repo, existing, decisions);
    for (const signoff of decisions.signoffs) env.stdout(`${signoff.verdict === "pass" ? "PASS" : "FAIL"} ${signoff.flow}${signoff.note ? `: ${signoff.note}` : ""}`);
    const typed = await env.ask(`Sign ${plural(decisions.signoffs.length, "decision")} as ${by} on ${signer.machine}? Type your name (${signer.name}) to confirm: `);
    if (typed.trim() !== signer.name) return fail(`not confirmed (expected ${JSON.stringify(signer.name)}): nothing was written to ${gatePlan.manifest.signoffs}`);
    writeSignoffs(signoffsFile, merged);
    env.stdout(`Wrote ${plural(decisions.signoffs.length, "sign-off")} to ${gatePlan.manifest.signoffs}. Run bun run gate${scoped ? " --flow <flow>" : ""} to apply them.`);
  } catch (error) { return fail(`the checklist's decisions in ${path.relative(process.cwd(), decisionsFile)} were not merged: ${(error as Error).message}`); }
  return 0;
}
