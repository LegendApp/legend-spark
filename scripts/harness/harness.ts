// `bun run harness`: install the release artifact on a clean machine as a download, verify its signature, and run the
// release gate against the installed app (docs/release-harness.md).
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readRuntime } from "../../packages/cli/src/local.ts";
import { FlowFormatError } from "../e2e/format/parser.ts";
import { runGate, type GateEnv } from "../e2e/gate/gate.ts";
import { plan, repoPath, UsageError, type GatePlan, type Host } from "../e2e/gate/plan.ts";
import { reasonText, writeGateReport } from "../e2e/gate/report.ts";
import { reportDir } from "./guard.ts";
import { describeSignature, HarnessError, install, judgeSignature, must, packageDmg, QUARANTINE, verify, type HarnessReason, type Sh, type Verification } from "./install.ts";
import { vmProblem, type VmDriver } from "./vm.ts";

export type HarnessOptions = {
  target?: string;
  /** Allow an ad-hoc, unnotarized build; the report is never releasable. */
  local: boolean;
  /** The .dmg or .zip to install. Without it, `--local` packages the gate's release build as a DMG. */
  artifact?: string;
  /** A VM image to install in, through `HarnessEnv.vm`. */
  vm?: string;
  /** Inside a VM: the commit the source archive came from (it has no git checkout). */
  commit?: string;
};

/** Everything the harness uses of the machine. Tests pass doubles; `cli.ts` has the real ones. */
export type HarnessEnv = {
  repo: string;
  gate: GateEnv;
  sh: Sh;
  vm: VmDriver;
  /** The Bun executable copied into a VM guest. */
  bun: string;
  now?(): Date;
};

export type HarnessReport = {
  version: 1;
  verdict: "PASS" | "FAIL";
  /** PASS, not `--local` and a clean tree: the only report the publish guard accepts. */
  releasable: boolean;
  local: boolean;
  target?: string;
  commit: string;
  dirty: boolean;
  startedAt: string;
  durationMs: number;
  /**
   * Where the app was installed: this machine, or a VM clone (`host` is then the guest). `clean` is true only for a
   * fresh clone of a VM image; on this machine the harness runs in the current account, with its developer tools.
   */
  environment: { kind: "host" | "vm"; clean: boolean; host: Host; vm?: { driver: string; image: string } };
  artifact?: { file: string; format: "dmg" | "zip"; sha256: string; packagedFrom?: string };
  /** `sourceRevision`: the commit the installed app says it was built from (spark-runtime.json), absent when it records none. */
  install?: { app: string; quarantine: string; sourceRevision?: string; quarantineRemoved?: boolean };
  signature?: Verification & { summary: string };
  gate?: { verdict: "PASS" | "FAIL"; report: string; reasons: string[] };
  /** Every reason the verdict is FAIL. Empty means PASS. */
  reasons: HarnessReason[];
};

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/** The guest's side of `--vm`: unpack the source archive, install dependencies with the shared Bun, run the harness, and copy its reports back. */
export function guestScript(share: string, args: string[]): string {
  return [
    `share=${quote(share)}`,
    'export PATH="$share:$PATH"',
    'dir="$HOME/spark-harness"',
    'rm -rf "$dir" && mkdir -p "$dir" && tar -xzf "$share/source.tar.gz" -C "$dir" && cd "$dir" && bun install --frozen-lockfile || exit 70',
    `bun scripts/harness/cli.ts ${args.map(quote).join(" ")}`,
    "status=$?",
    'mkdir -p "$share/out" && cp -R artifacts/harness/. "$share/out/"',
    "exit $status",
  ].join("\n");
}

/** The artifact to install: `--artifact`, or under `--local` the gate's release build packaged as a DMG in the report directory. */
async function artifactFor(options: HarnessOptions, gatePlan: GatePlan, work: string, dir: string, env: HarnessEnv): Promise<{ file: string; packagedFrom?: string }> {
  if (options.artifact) {
    const file = path.resolve(options.artifact);
    if (!existsSync(file)) throw new HarnessError("artifact", `${file} does not exist`);
    return { file };
  }
  const build = gatePlan.artifact;
  if (!build || !existsSync(build)) throw new HarnessError("artifact", `the release build ${build ? repoPath(env.repo, build) : "for this target"} does not exist; build it with cd examples/kitchen-sink && bun run build`);
  const file = await packageDmg(build, work, env.sh);
  mkdirSync(dir, { recursive: true });
  copyFileSync(file, path.join(dir, path.basename(file)));
  return { file: path.join(dir, path.basename(file)), packagedFrom: repoPath(env.repo, build) };
}

/**
 * A release report certifies `commit`, so the installed app must say it was built from it: an old signed artifact
 * next to today's checkout is another build. Without a recorded revision it fails. `--local` records it only.
 */
export function judgeRevision(revision: string | undefined, commit: string, local: boolean): HarnessReason[] {
  if (local || revision === commit) return [];
  if (!revision) return [{ check: "revision", message: `the installed app records no source revision (Contents/Resources/spark-runtime.json sourceRevision), so nothing ties it to ${commit}; build the release with SPARK_RELEASE_REVISION=${commit}` }];
  return [{ check: "revision", message: `the installed app was built from ${revision}, not ${commit}: this run would certify another build` }];
}

/** Installs on this machine into a fresh temporary Applications folder, verifies, and runs the gate against the installed app. */
async function onHost(options: HarnessOptions, gatePlan: GatePlan, report: HarnessReport, dir: string, env: HarnessEnv) {
  const work = mkdtempSync(path.join(os.tmpdir(), "spark-harness-"));
  try {
    const { file, packagedFrom } = await artifactFor(options, gatePlan, work, dir, env);
    env.gate.stdout(`installing ${path.basename(file)} as a quarantined download…`);
    const installed = await install(file, work, env.sh, report.reasons, env.now?.());
    const sourceRevision = readRuntime(installed.app)?.sourceRevision;
    report.artifact = { file: repoPath(env.repo, file), format: installed.format, sha256: installed.sha256, ...(packagedFrom ? { packagedFrom } : {}) };
    report.install = { app: installed.app, quarantine: installed.quarantine, ...(sourceRevision ? { sourceRevision } : {}) };
    const verification = await verify(installed.app, env.sh);
    report.signature = { ...verification, summary: describeSignature(verification) };
    env.gate.stdout(`signature: ${report.signature.summary}; Gatekeeper ${verification.gatekeeper.accepted ? "accepts" : "rejects"} it; built from ${sourceRevision ?? "an unrecorded revision"}`);
    const problems = [...judgeSignature(verification, options.local), ...judgeRevision(sourceRevision, report.commit, options.local)];
    report.reasons.push(...problems);
    if (problems.length && !options.local) {
      report.reasons.push({ check: "gate", message: "not run: the installed app failed the release checks above" });
      return;
    }
    // macOS holds the exec of a quarantined app that Gatekeeper rejects before it starts, so the driver never
    // connects. `--local` has recorded both and is never releasable; it removes the quarantine so the gate can run.
    if (options.local && !verification.gatekeeper.accepted) {
      await must(env.sh, ["xattr", "-d", "-r", QUARANTINE, installed.app], "quarantine");
      report.install.quarantineRemoved = true;
      env.gate.stdout(`--local: removed ${QUARANTINE} from the installed copy so it can launch; Gatekeeper rejects it`);
    }
    const tested = plan(gatePlan.root, gatePlan.host, { target: options.target, artifact: installed.app });
    const files = { json: path.join(dir, "gate/report.json"), html: path.join(dir, "gate/index.html") };
    const gateReport = await runGate({ ...tested, manifest: { ...tested.manifest, report: { json: path.relative(env.repo, files.json), html: path.relative(env.repo, files.html) } } }, env.gate);
    writeGateReport(gateReport, files, env.repo);
    report.gate = { verdict: gateReport.verdict, report: "gate/report.json", reasons: gateReport.reasons.map(reasonText) };
    if (gateReport.verdict === "FAIL") report.reasons.push({ check: "gate", message: `the release gate failed (${path.relative(env.repo, files.html)}):\n${report.gate.reasons.map(reason => `  ${reason.replace(/\n/g, "\n    ")}`).join("\n")}` });
  } finally { removeWork(work, report); }
}

/** Removes a temporary folder without hiding the run's own error; a folder that stays (a mounted volume, say) is a reason. */
function removeWork(work: string, report: HarnessReport) {
  try { rmSync(work, { recursive: true, force: true }); } catch (error) {
    report.reasons.push({ check: "install", message: `could not remove ${work}: ${(error as Error).message}` });
  }
}

/** Boots a clone of `options.vm`, runs the harness inside on a git archive of the commit, and takes the guest's report. */
async function inVm(options: HarnessOptions, gatePlan: GatePlan, report: HarnessReport, dir: string, env: HarnessEnv): Promise<HarnessReport> {
  const target = gatePlan.target!, problem = vmProblem(target, gatePlan.machine);
  if (problem) throw new HarnessError("vm", problem);
  if (report.dirty) throw new HarnessError("source", "the VM installs from a git archive of HEAD; commit your changes first");
  const share = mkdtempSync(path.join(os.tmpdir(), "spark-harness-share-"));
  try {
    const { file, packagedFrom } = await artifactFor(options, gatePlan, share, dir, env);
    copyFileSync(file, path.join(share, path.basename(file)));
    const archive = await env.sh(["git", "-C", env.repo, "archive", "--format=tar.gz", "-o", path.join(share, "source.tar.gz"), report.commit]);
    if (archive.code) throw new HarnessError("vm", `git archive ${report.commit} failed: ${archive.stderr.trim()}`);
    copyFileSync(env.bun, path.join(share, "bun"));
    chmodSync(path.join(share, "bun"), 0o755);
    // Interrupting (cli.ts aborts env.gate.signal on SIGINT/SIGTERM) stops the boot or the guest's run, and the clone is still disposed.
    const signal = env.gate.signal;
    const interrupted = () => { if (signal?.aborted) throw new HarnessError("vm", "interrupted; the clone was disposed"); };
    interrupted();
    env.gate.stdout(`booting a ${env.vm.name} clone of ${options.vm}…`);
    const guest = await env.vm.boot(options.vm!, share, signal).catch((error: unknown) => { interrupted(); throw error; });
    let result;
    try {
      result = await guest.exec(["/bin/bash", "-c", guestScript(guest.share, [
        "--target", target.id, "--artifact", `${guest.share}/${path.basename(file)}`, "--commit", report.commit, ...(options.local ? ["--local"] : []),
      ])], signal);
    } finally { await guest.dispose(); }
    interrupted();
    env.gate.stdout(result.output.trimEnd());
    const out = path.join(share, "out", path.relative(path.join(env.repo, "artifacts/harness"), dir));
    if (!existsSync(path.join(out, "report.json"))) throw new HarnessError("vm", `the guest wrote no harness report (exit ${result.code}); its output is above`);
    cpSync(out, dir, { recursive: true });
    const guestReport = JSON.parse(readFileSync(path.join(dir, "report.json"), "utf8")) as HarnessReport;
    return {
      ...guestReport, startedAt: report.startedAt, environment: { kind: "vm", clean: true, host: guestReport.environment.host, vm: { driver: env.vm.name, image: options.vm! } },
      ...(guestReport.artifact ? { artifact: { ...guestReport.artifact, file: repoPath(env.repo, file), ...(packagedFrom ? { packagedFrom } : {}) } } : {}),
    };
  } finally { rmSync(share, { recursive: true, force: true }); }
}

/** Runs the harness for one target and writes `artifacts/harness/<commit>/<target>/report.json`. Throws UsageError for an unknown target. */
export async function runHarness(options: HarnessOptions, env: HarnessEnv): Promise<{ report: HarnessReport; dir: string }> {
  const began = Date.now();
  const host = env.gate.host(), { commit, dirty } = env.gate.source();
  const gatePlan = plan(path.join(env.repo, "e2e"), host, { target: options.target });
  const target = gatePlan.target;
  const dir = reportDir(env.repo, commit, target?.id ?? "no-target");
  rmSync(dir, { recursive: true, force: true });
  let report: HarnessReport = {
    version: 1, verdict: "FAIL", releasable: false, local: options.local, target: target?.id, commit, dirty,
    startedAt: (env.now?.() ?? new Date()).toISOString(), durationMs: 0, environment: { kind: "host", clean: false, host }, reasons: [],
  };
  const fit = gatePlan.problems.filter(problem => problem.check === "target");
  try {
    if (options.vm && target) report = await inVm(options, gatePlan, report, dir, env);
    else if (fit.length || !target) report.reasons.push(...fit.map(problem => ({ check: "target" as const, message: target && !vmProblem(target, gatePlan.machine) ? `${problem.message}, or bun run harness --vm <image> to install in a VM` : problem.message })));
    else if (target.platform !== "macos") report.reasons.push({ check: "install", message: `${target.id}: the harness installs macOS .dmg and .zip artifacts; Spark has no Windows release build to install yet` });
    else await onHost(options, gatePlan, report, dir, env);
  } catch (error) {
    if (!(error instanceof HarnessError)) throw error;
    report.reasons.push({ check: error.check, message: error.message });
  }
  report.verdict = report.reasons.length ? "FAIL" : "PASS";
  report.releasable = report.verdict === "PASS" && !report.local && !report.dirty;
  report.durationMs = Date.now() - began;
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return { report, dir };
}

const VALUES: Record<string, "target" | "artifact" | "vm" | "commit"> = { "--target": "target", "--artifact": "artifact", "--vm": "vm", "--commit": "commit" };
const USAGE = "usage: bun run harness [--target <os>/<arch>[@machine]] [--artifact <.dmg|.zip>] [--local] [--vm <image>]";

/** `bun run harness`: exit 0 on PASS (even `--local`, which is never releasable), 1 on FAIL, 2 on a usage error. */
export async function harnessCommand(args: string[], env: HarnessEnv): Promise<number> {
  const options: HarnessOptions = { local: false };
  const usage = (message: string) => { env.gate.stderr(`${message}\n${USAGE}`); return 2; };
  for (let index = 0; index < args.length; index++) {
    const [flag, inline] = args[index]!.split(/=(.*)/s, 2) as [string, string | undefined];
    if (flag === "--local" && inline === undefined) { options.local = true; continue; }
    const key = VALUES[flag];
    const value = inline ?? args[index + 1];
    if (!key) return usage(`unknown argument ${args[index]}`);
    if (!value || value.startsWith("--")) return usage(`${flag} needs a value`);
    options[key] = value;
    if (inline === undefined) index++;
  }
  if (!options.local && !options.artifact) return usage("a release run installs a signed artifact: pass --artifact <.dmg|.zip>, or --local to package the ad-hoc release build (never releasable)");
  if (options.vm && !options.target) return usage("--vm needs --target: the VM image must be that target's macOS");
  if (options.commit !== undefined) {
    if (options.vm) return usage("--commit is set by --vm for the guest; do not pass both");
    if (!/^[0-9a-f]{40}$/.test(options.commit)) return usage("--commit must be a full 40-character commit SHA");
    if (existsSync(path.join(env.repo, ".git"))) return usage("--commit is only for a source archive inside a VM; in a git checkout the harness reads the commit itself");
  }
  const commit = options.commit;
  const harnessEnv = commit ? { ...env, gate: { ...env.gate, source: () => ({ commit, dirty: false }) } } : env;
  let result;
  try { result = await runHarness(options, harnessEnv); } catch (error) {
    if (error instanceof UsageError) return usage(error.message);
    if (error instanceof FlowFormatError) { env.gate.stderr(`gate.yaml is invalid:\n${error.message}`); return 1; }
    throw error;
  }
  const { report, dir } = result;
  const where = report.environment.vm ? `${report.environment.vm.driver} VM ${report.environment.vm.image}` : "this machine";
  env.gate.stdout([
    ...report.reasons.map(reason => `[${reason.check}] ${reason.message}`),
    `Harness ${report.verdict} on ${report.target ?? "no target"} (${where})${report.local ? ": --local, not releasable" : report.releasable ? ": releasable" : ""}. Report: ${path.relative(process.cwd(), path.join(dir, "report.json"))}`,
  ].join("\n"));
  return report.verdict === "PASS" ? 0 : 1;
}
