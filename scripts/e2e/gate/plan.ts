// The release gate's plan: which target this run certifies, which flows it runs and which budgets apply (docs/e2e-flows.md#release-gate).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { collect } from "../files.ts";
import {
  checkBudgets, checkFlow, checkGate, checkRegistry, formatDiagnostic, FlowFormatError,
  type Budget, type Budgets, type GateManifest, type GateTarget, type Machine,
} from "../format/parser.ts";
import type { Platform } from "../runner/backend.ts";
import { expandMatrix } from "../runner/executor.ts";

/** Why the gate fails. The verdict is PASS only when there are none. */
export type GateCheck = "manifest" | "target" | "source" | "lint" | "coverage" | "build" | "backend" | "flows" | "time-budget" | "budgets" | "signoffs";
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
};
export type PlannedBudget = Budget & { baseline: number | "not-measured" };
export type GatePlan = {
  manifest: GateManifest;
  /** The e2e/ directory and the repository root (its parent). */
  root: string;
  repo: string;
  host: Host;
  target?: GateTarget & { id: string; platform: Platform };
  machine?: Machine & { id: string };
  artifact?: string;
  flows: PlannedFlow[];
  excluded: Array<{ path: string; reason: string }>;
  /** Budgets with a baseline for this target's machine. */
  budgets: PlannedBudget[];
  problems: Reason[];
};

export class UsageError extends Error {}

export const targetId = (target: GateTarget) => `${target.os}/${target.arch}${target.machine ? `@${target.machine}` : ""}`;
export const platformOf = (os: string): Platform => os.startsWith("windows") ? "windows" : "macos";
const describeHost = (host: Host) => `${host.os}/${host.arch}${host.model ? `, ${host.model} with ${host.memoryGB} GB` : ""}`;
const describeMachine = (machine: Machine) => `${machine.name} (${machine.model}, ${machine.memoryGB} GB)`;
const isMachine = (host: Host, machine: Machine | undefined) => !!machine && host.model === machine.model && host.memoryGB === machine.memoryGB;
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

/** Blocking: a blocking tag, or a check registered `blocking: true`; otherwise the manifest default. */
function blockingChecks(root: string, manifest: GateManifest): Set<string> {
  const dir = path.join(root, manifest.coverage.checks);
  if (!existsSync(dir)) return new Set();
  return new Set(collect(dir).filter(([, kind]) => kind === "registry").flatMap(([file]) =>
    Object.entries(checkRegistry(readFileSync(file, "utf8"), file).value?.checks ?? {}).filter(([, check]) => check.blocking).map(([id]) => id)));
}

/** The gate flows (manifest `include`) under e2e/, for every target. */
export function gateFlows(root: string, manifest: GateManifest): Array<{ path: string; file: string }> {
  return collect(root).filter(([file, kind]) => kind === "flow" && matchesAny(path.relative(root, file), manifest.include))
    .map(([file]) => ({ path: path.relative(root, file), file }));
}

export function plan(root: string, host: Host, override?: string): GatePlan {
  root = path.resolve(root);
  const manifest = readManifest(root), repo = path.dirname(root), problems: Reason[] = [];
  const budgets = readBudgets(root, manifest, problems);
  if (budgets) crossCheck(manifest, budgets, problems);
  const resolved = resolveTarget(manifest, budgets, host, override, problems);
  const target = resolved && { ...resolved, id: targetId(resolved), platform: platformOf(resolved.os) };
  const machine = target?.machine && budgets?.machines[target.machine] ? { id: target.machine, ...budgets.machines[target.machine]! } : undefined;

  const build = target && manifest.build[target.platform];
  if (target && !build) problems.push({ check: "build", message: `gate.yaml has no ${target.platform} build to test` });
  const artifact = build && path.resolve(repo, build.artifact.replaceAll("${ARCH}", target!.arch));

  const blocking = blockingChecks(root, manifest), flows: PlannedFlow[] = [], excluded: GatePlan["excluded"] = [];
  for (const { path: relative, file } of target ? gateFlows(root, manifest) : []) {
    const id = relative.replace(/\.ya?ml$/, "");
    const header = checkFlow(readFileSync(file, "utf8"), file).value?.header;
    // An invalid flow still runs, so the runner reports it as a `format` failure; lint reports it too.
    if (!header) { flows.push({ path: relative, file, ids: [id], blocking: true, manual: false }); continue; }
    if (header.platforms && !header.platforms.includes(target!.platform)) { excluded.push({ path: relative, reason: `platforms: ${header.platforms.join(", ")}` }); continue; }
    const suffixes = expandMatrix(header.matrix).map(matrix => Object.entries(matrix).map(([dimension, value]) => `${dimension}=${value}`).join(","));
    flows.push({
      path: relative, file, ids: suffixes.map(suffix => suffix ? `${id}[${suffix}]` : id),
      blocking: manifest.blocking.default || (header.tags ?? []).some(tag => manifest.blocking.tags.includes(tag)) || (header.checks ?? []).some(check => blocking.has(check)),
      manual: header.manual ?? false,
    });
  }
  const planned = machine ? (budgets?.budgets ?? []).flatMap(budget => machine.id in budget.baselines ? [{ ...budget, baseline: budget.baselines[machine.id]! }] : []) : [];
  return { manifest, root, repo, host, target, machine, artifact, flows, excluded, budgets: planned, problems };
}
