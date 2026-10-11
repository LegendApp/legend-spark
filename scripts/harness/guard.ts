// The publish guard (docs/release-harness.md#the-publish-guard): a release needs a passing, non-local harness report
// for its exact source revision on every release target. `bun run release` and `bun run release:publish` call it.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { GateTarget } from "../e2e/format/parser.ts";
import { platformOf, readManifest, targetId } from "../e2e/gate/plan.ts";
import type { HarnessReport } from "./harness.ts";

/** Where `bun run harness` writes its report for a commit and target. */
export const reportDir = (repo: string, commit: string, target: string) => path.join(repo, "artifacts/harness", commit, target.replaceAll("/", "-"));

const macArm64 = (repo: string) => readManifest(path.join(repo, "e2e")).targets.filter(target => platformOf(target.os) === "macos" && target.arch === "arm64");

/** The automated release publishes macOS Apple Silicon, so it needs every macos/arm64 target in e2e/gate.yaml, reference machines included. */
export function releaseTargets(repo: string): string[] {
  return macArm64(repo).map(targetId);
}

/** Who can produce a target's report: a reference machine is physical hardware; another macOS needs a VM or a Mac running it. */
const whereToRun = (target: GateTarget, id: string, revision: string) => target.machine
  ? `run bun run harness --target ${id} --artifact <signed .dmg or .zip> for ${revision} on the reference machine ${target.machine} itself (physical hardware: Seth)`
  : `run bun run harness --target ${id} --artifact <signed .dmg or .zip> for ${revision} on a Mac running ${target.os}, or add --vm <${target.os} tart image> (no VMs run on the shared development Mac: Seth)`;

/** Every release target without a releasable report for `revision`. Empty means the release may publish. */
export function harnessProblems(repo: string, revision: string): Array<{ target: string; problem: string }> {
  return macArm64(repo).flatMap(entry => {
    const target = targetId(entry), file = path.join(reportDir(repo, revision, target), "report.json"), shown = path.relative(repo, file);
    const problem = (() => {
      if (!existsSync(file)) return `no harness report at ${shown}; ${whereToRun(entry, target, revision)}`;
      const report = JSON.parse(readFileSync(file, "utf8")) as HarnessReport;
      if (report.version !== 1 || report.target !== target || report.commit !== revision) return `${shown} is not a harness report for ${target} at ${revision}`;
      if (report.local) return `${shown} is from a --local run, which is never releasable`;
      if (report.verdict !== "PASS" || !report.releasable || report.dirty) return `the harness did not pass: ${report.reasons.map(reason => `[${reason.check}] ${reason.message.split("\n")[0]}`).join("; ") || "not releasable"}`;
      // The report's commit is only what the checkout said; the installed app must say it too.
      if (report.install?.sourceRevision !== revision) return `${shown} does not show the installed app was built from ${revision} (it records ${report.install?.sourceRevision ?? "no source revision"})`;
      return undefined;
    })();
    return problem ? [{ target, problem }] : [];
  });
}

export function requireHarnessPass(repo: string, revision: string) {
  const problems = harnessProblems(repo, revision);
  if (!problems.length) return;
  throw new Error([
    `Refusing to publish ${revision}: every release target needs a passing harness report for this build (docs/release-harness.md).`,
    `Targets without one (${problems.length} of ${releaseTargets(repo).length}): ${problems.map(({ target }) => target).join(", ")}`,
    ...problems.map(({ target, problem }) => `- ${target}: ${problem}`),
  ].join("\n"));
}
