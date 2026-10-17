// The release gate's plan: which target this run certifies, which flows it runs and which budgets apply (docs/e2e-flows.md#release-gate).
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { collect } from "../files.ts";
import {
  checkBudgets, checkFlow, checkGate, checkRegistry, formatDiagnostic, FlowFormatError,
  type Budget, type Budgets, type CheckRegistry, type GateManifest, type GateTarget, type Machine,
} from "../format/parser.ts";
import type { Audit } from "../format/primitives.ts";
import type { ManualStep } from "../format/signoff.ts";
import type { Platform } from "../runner/backend.ts";
import { expandMatrix } from "../runner/executor.ts";
import { flowHash, plannedManualSteps } from "./manual.ts";

/** Why the gate fails. The verdict is PASS only when there are none. */
export type GateCheck = "manifest" | "target" | "source" | "lint" | "coverage" | "build" | "audit" | "backend" | "flows" | "time-budget" | "budgets" | "signoffs";
export type Reason = { check: GateCheck; message: string };
/** The machine the gate runs on. `model` and `memoryGB` identify a reference machine (macOS only). */
export type Host = { os: string; arch: "arm64" | "x64"; model?: string; memoryGB?: number };

export type PlannedFlow = {
  /** Relative to e2e/, such as flows/menus/availability.yaml. */
  path: string;
  file: string;
  /** Run IDs, one per matrix combination, as the runner reports them. */
  ids: string[];
  blocking: boolean;
  /** `true`: signed off by a person, not run. `partial`: run, and signed off. */
  manual: boolean | "partial";
  /** `sandbox`: runs against the App Sandbox variant (`build.<platform>.sandbox`), not the artifact. */
  variant?: "sandbox";
  /** A direct flow's run against the App Sandbox variant (`build.<platform>.sandboxFlows`): its IDs are the direct ones under `sandbox/`. */
  sandboxRun?: true;
  name?: string;
  intent?: string;
  /** Manual flows: SHA-256 of the flow file and the runFlow files it reaches (their sign-offs name it); unset when one cannot be read. */
  hash?: string;
  /** `manual: true`: the manualSteps each run ID would reach, in `ids` order. A `partial` flow's come from its run. */
  manualSteps?: ManualStep[][];
};
export type PlannedBudget = Budget & { baseline: number | "not-measured" };
/** A check registered with `audit:`, which that gate audit step verifies against the artifact. */
export type PlannedAudit = { check: string; audit: Audit; title: string; blocking: boolean };
export type GatePlan = {
  manifest: GateManifest;
  /** The e2e/ directory and the repository root (its parent). */
  root: string;
  repo: string;
  host: Host;
  target?: GateTarget & { id: string; platform: Platform };
  machine?: Machine & { id: string };
  artifact?: string;
  /** The App Sandbox variant `variant: sandbox` flows test (`build.<platform>.sandbox`), absolute. */
  sandbox?: string;
  flows: PlannedFlow[];
  excluded: Array<{ path: string; reason: string }>;
  /** Budgets with a baseline for this target's machine. */
  budgets: PlannedBudget[];
  /** The audit checks for this target's platform. A scoped run has none: it judges only its flows. */
  audits: PlannedAudit[];
  /** The build's debug symbols folder (`build.<platform>.symbols`), absolute. */
  symbols?: string;
  /** The `spark package` output (`build.<platform>.package`): its distribution ZIP or the folder holding it, absolute. */
  package?: string;
  problems: Reason[];
  /** `--flow`: the selected gate flows, relative to e2e/. Undefined for the whole gate. */
  scope?: string[];
};

export class UsageError extends Error {}

export const targetId = (target: GateTarget) => `${target.os}/${target.arch}${target.machine ? `@${target.machine}` : ""}`;
export const platformOf = (os: string): Platform => os.startsWith("windows") ? "windows" : "macos";
const describeHost = (host: Host) => `${host.os}/${host.arch}${host.model ? `, ${host.model} with ${host.memoryGB} GB` : ""}`;
const describeMachine = (machine: Machine) => `${machine.name} (${machine.model}, ${machine.memoryGB} GB)`;
const isMachine = (host: Host, machine: Machine | undefined) => !!machine && host.model === machine.model && host.memoryGB === machine.memoryGB;
/** `file` relative to the repository, or absolute when it is outside it (an installed copy, for example). */
export const repoPath = (repo: string, file: string) => path.relative(repo, file).startsWith("..") ? file : path.relative(repo, file);
export const matchesAny = (file: string, globs: string[]) => globs.some(glob => path.matchesGlob(file, glob));

/** Reads e2e/gate.yaml. Throws FlowFormatError when it does not validate: without it there is nothing to plan. */
export function readManifest(root: string): GateManifest {
  const file = path.join(root, "gate.yaml");
  if (!existsSync(file)) throw new UsageError(`no gate manifest at ${file}`);
  const checked = checkGate(readFileSync(file, "utf8"), path.relative(process.cwd(), file));
  if (!checked.value) throw new FlowFormatError(checked.diagnostics);
  return checked.value;
}

function readBudgets(root: string, manifest: GateManifest, problems: Reason[]): Budgets | undefined {
  const file = path.join(root, manifest.budgets);
  if (!existsSync(file)) { problems.push({ check: "budgets", message: `the budgets file ${manifest.budgets} does not exist` }); return undefined; }
  const checked = checkBudgets(readFileSync(file, "utf8"), path.relative(process.cwd(), file));
  if (!checked.value) problems.push({ check: "budgets", message: `${manifest.budgets} is invalid:\n${checked.diagnostics.map(formatDiagnostic).join("\n")}` });
  return checked.value;
}

/** Every machine a target names exists, and every machine with baselines has a target, so no budget goes unchecked. */
function crossCheck(manifest: GateManifest, budgets: Budgets, problems: Reason[]) {
  for (const target of manifest.targets) {
    if (target.machine && !(target.machine in budgets.machines)) problems.push({ check: "manifest", message: `target ${targetId(target)} names machine ${target.machine}, which ${manifest.budgets} does not define` });
  }
  for (const machine of new Set(budgets.budgets.flatMap(budget => Object.keys(budget.baselines)))) {
    if (!manifest.targets.some(target => target.machine === machine)) problems.push({ check: "manifest", message: `${manifest.budgets} has baselines for ${machine}, but no gate target runs on it, so they would never be checked` });
  }
}

function resolveTarget(manifest: GateManifest, budgets: Budgets | undefined, host: Host, override: string | undefined, problems: Reason[]): GateTarget | undefined {
  const machineOf = (target: GateTarget) => target.machine ? budgets?.machines[target.machine] : undefined;
  const fits = (target: GateTarget) => target.os === host.os && target.arch === host.arch && (!target.machine || isMachine(host, machineOf(target)));
  if (override !== undefined) {
    const target = manifest.targets.find(candidate => targetId(candidate) === override);
    if (!target) throw new UsageError(`--target ${override} is not in gate.yaml (targets: ${manifest.targets.map(targetId).join(", ")})`);
    if (!fits(target)) {
      const needs = target.machine ? `${target.os}/${target.arch} on ${machineOf(target) ? describeMachine(machineOf(target)!) : target.machine}` : `${target.os}/${target.arch}`;
      problems.push({ check: "target", message: `--target ${override} needs ${needs}; this machine is ${describeHost(host)}. The gate certifies only the machine it runs on; use --dry-run to plan another target` });
    }
    return target;
  }
  const candidates = manifest.targets.filter(fits);
  const target = candidates.find(candidate => candidate.machine) ?? candidates[0];
  if (!target) problems.push({ check: "target", message: `this machine (${describeHost(host)}) is not a gate target (targets: ${manifest.targets.map(targetId).join(", ")})` });
  return target;
}

/** Every valid check in the registries. */
function registeredChecks(root: string, manifest: GateManifest): Array<[string, CheckRegistry["checks"][string]]> {
  const dir = path.join(root, manifest.coverage.checks);
  if (!existsSync(dir)) return [];
  return collect(dir).filter(([, kind]) => kind === "registry").flatMap(([file]) => Object.entries(checkRegistry(readFileSync(file, "utf8"), file).value?.checks ?? {}));
}

/** The gate flows (manifest `include`) under e2e/, for every target. */
export function gateFlows(root: string, manifest: GateManifest): Array<{ path: string; file: string }> {
  return collect(root).filter(([file, kind]) => kind === "flow" && matchesAny(path.relative(root, file), manifest.include))
    .map(([file]) => ({ path: path.relative(root, file), file }));
}

/** The gate flows at or under each `--flow` path (absolute). Anything else is a usage error: a run never widens or narrows silently. */
function select(root: string, manifest: GateManifest, all: Array<{ path: string; file: string }>, paths: string[]): string[] {
  const chosen = new Set<string>();
  for (const target of paths) {
    const shown = path.relative(process.cwd(), target) || ".";
    if (!existsSync(target)) throw new UsageError(`--flow ${shown}: not found`);
    const found = collect(target);
    if (!statSync(target).isDirectory() && found[0]![1] !== "flow") throw new UsageError(`--flow ${shown}: not a flow (${found[0]![1]})`);
    const flows = found.filter(([, kind]) => kind === "flow").map(([file]) => file);
    if (!flows.length) throw new UsageError(`--flow ${shown}: no flows there`);
    for (const file of flows) {
      const match = all.find(flow => flow.file === file);
      if (!match) throw new UsageError(`--flow ${path.relative(process.cwd(), file)}: not a gate flow (gate.yaml includes ${manifest.include.join(", ")} under ${path.relative(process.cwd(), root) || "."})`);
      chosen.add(match.path);
    }
  }
  return all.map(flow => flow.path).filter(flow => chosen.has(flow));
}

export type PlanOptions = {
  /** Another target than this machine's (`--target`). */
  target?: string;
  /** Absolute paths (`--flow`): scope the run to the gate flows at or under them. */
  only?: string[];
  /** Replaces the manifest's build path, such as an installed copy of the release (`--artifact`, `bun run harness`). */
  artifact?: string;
  /** Replaces the manifest's package path: the `spark package` ZIP or its folder (`--package`, `bun run harness --artifact`). */
  package?: string;
};

/** Plans the gate for this machine, or `options.target`. */
export function plan(root: string, host: Host, { target: override, only, artifact, package: packaged }: PlanOptions = {}): GatePlan {
  root = path.resolve(root);
  const manifest = readManifest(root), repo = path.dirname(root), problems: Reason[] = [];
  const budgets = readBudgets(root, manifest, problems);
  if (budgets) crossCheck(manifest, budgets, problems);
  const resolved = resolveTarget(manifest, budgets, host, override, problems);
  const target = resolved && { ...resolved, id: targetId(resolved), platform: platformOf(resolved.os) };
  const machine = target?.machine && budgets?.machines[target.machine] ? { id: target.machine, ...budgets.machines[target.machine]! } : undefined;

  const build = target && manifest.build[target.platform];
  if (target && !build) problems.push({ check: "build", message: `gate.yaml has no ${target.platform} build to test` });
  const tested = build && path.resolve(repo, artifact ?? build.artifact.replaceAll("${ARCH}", target!.arch));
  const symbols = build?.symbols && path.resolve(repo, build.symbols.replaceAll("${ARCH}", target!.arch));
  const distribution = (packaged ?? build?.package) && path.resolve(repo, (packaged ?? build!.package!).replaceAll("${ARCH}", target!.arch));
  const sandbox = build?.sandbox && path.resolve(repo, build.sandbox.replaceAll("${ARCH}", target!.arch));
  const sandboxFlows = build?.sandboxFlows ?? [];

  const all = gateFlows(root, manifest), scope = only && select(root, manifest, all, only);
  if (sandboxFlows.length && !sandbox) problems.push({ check: "manifest", message: `build.${target!.platform}.sandboxFlows lists flows to run against the App Sandbox variant, but there is no build.${target!.platform}.sandbox` });
  for (const glob of sandboxFlows) if (!all.some(flow => path.matchesGlob(flow.path, glob))) problems.push({ check: "manifest", message: `build.${target!.platform}.sandboxFlows: ${glob} matches no gate flow` });
  const registered = registeredChecks(root, manifest);
  // Blocking: a blocking tag, or a check registered `blocking: true`; otherwise the manifest default.
  const blocking = new Set(registered.filter(([, check]) => check.blocking).map(([id]) => id)), flows: PlannedFlow[] = [], excluded: GatePlan["excluded"] = [];
  for (const { path: relative, file } of target ? all.filter(flow => !scope || scope.includes(flow.path)) : []) {
    const id = relative.replace(/\.ya?ml$/, "");
    const parsed = checkFlow(readFileSync(file, "utf8"), path.relative(process.cwd(), file)).value, header = parsed?.header;
    // An invalid flow still runs, so the runner reports it as a `format` failure; lint reports it too.
    if (!header) { flows.push({ path: relative, file, ids: [id], blocking: true, manual: false }); continue; }
    if (header.platforms && !header.platforms.includes(target!.platform)) { excluded.push({ path: relative, reason: `platforms: ${header.platforms.join(", ")}` }); continue; }
    if (header.variant === "sandbox" && !sandbox) problems.push({ check: "build", message: `${relative} tests the App Sandbox variant, but gate.yaml has no build.${target!.platform}.sandbox` });
    const matrices = expandMatrix(header.matrix), suffixes = matrices.map(matrix => Object.entries(matrix).map(([dimension, value]) => `${dimension}=${value}`).join(","));
    let manualSteps: ManualStep[][] | undefined, hash: string | undefined;
    try {
      if (header.manual) hash = flowHash(parsed!, file);
      if (header.manual === true) manualSteps = matrices.map(matrix => plannedManualSteps(parsed!, file, matrix, target!.platform));
    } catch (error) {
      problems.push({ check: "signoffs", message: `${relative}: ${(error as Error).message}` });
    }
    const flow: PlannedFlow = {
      path: relative, file, ids: suffixes.map(suffix => suffix ? `${id}[${suffix}]` : id),
      blocking: manifest.blocking.default || (header.tags ?? []).some(tag => manifest.blocking.tags.includes(tag)) || (header.checks ?? []).some(check => blocking.has(check)),
      manual: header.manual ?? false, ...(header.variant === "sandbox" ? { variant: "sandbox" as const } : {}), ...(hash ? { hash } : {}), name: header.name, intent: header.intent, ...(manualSteps ? { manualSteps } : {}),
    };
    flows.push(flow);
    if (!matchesAny(relative, sandboxFlows)) continue;
    // A sandbox run repeats what the flow checks against the direct build; one that cannot is a manifest mistake, never skipped.
    const unfit = header.variant === "sandbox" ? "it already tests the App Sandbox variant" : header.manual ? "it is signed off by a person (manual), and a sign-off names the direct build"
      : header.build === "dev" ? "it tests the dev build" : undefined;
    if (unfit) problems.push({ check: "manifest", message: `build.${target!.platform}.sandboxFlows lists ${relative}, but ${unfit}` });
    else flows.push({ ...flow, ids: flow.ids.map(run => `sandbox/${run}`), variant: "sandbox", sandboxRun: true });
  }
  const planned = machine ? (budgets?.budgets ?? []).flatMap(budget => machine.id in budget.baselines ? [{ ...budget, baseline: budget.baselines[machine.id]! }] : []) : [];
  const audits = target && !scope ? registered.flatMap(([id, check]) => check.audit && (!check.platforms || check.platforms.includes(target.platform))
    ? [{ check: id, audit: check.audit, title: check.title, blocking: !!check.blocking || manifest.blocking.default }] : []) : [];
  return { manifest, root, repo, host, target, machine, artifact: tested, ...(sandbox ? { sandbox } : {}), ...(symbols ? { symbols } : {}), ...(distribution ? { package: distribution } : {}), flows, excluded, budgets: planned, audits, problems, ...(scope ? { scope } : {}) };
}

/** Where a run writes its reports: the manifest's paths, or `scoped/` next to them for a `--flow` run, so it never replaces a full gate report. */
export function reportFiles(plan: GatePlan) {
  const json = path.join(plan.repo, plan.manifest.report.json), html = path.join(plan.repo, plan.manifest.report.html);
  const scoped = (file: string) => plan.scope ? path.join(path.dirname(file), "scoped", path.basename(file)) : file;
  return { json: scoped(json), html: scoped(html), run: path.join(path.dirname(scoped(json)), "run") };
}
