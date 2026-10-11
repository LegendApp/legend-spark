// The publish guard (docs/release-harness.md#the-publish-guard): a release needs a passing, non-local harness report
// for its exact source revision on every release target. `bun run release` and `bun run release:publish` call it.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { platformOf, readManifest, targetId } from "../e2e/gate/plan.ts";
import type { HarnessReport } from "./harness.ts";

/** Where `bun run harness` writes its report for a commit and target. */
export const reportDir = (repo: string, commit: string, target: string) => path.join(repo, "artifacts/harness", commit, target.replaceAll("/", "-"));

/** The automated release publishes macOS Apple Silicon, so it needs every macos/arm64 target in e2e/gate.yaml, reference machines included. */
export function releaseTargets(repo: string): string[] {
  return readManifest(path.join(repo, "e2e")).targets.filter(target => platformOf(target.os) === "macos" && target.arch === "arm64").map(targetId);
}

/** Every release target without a releasable report for `revision`. Empty means the release may publish. */
export function harnessProblems(repo: string, revision: string): string[] {
  return releaseTargets(repo).flatMap(target => {
    const file = path.join(reportDir(repo, revision, target), "report.json"), shown = path.relative(repo, file);
    if (!existsSync(file)) return [`${target}: no harness report at ${shown}; run bun run harness --target ${target} --artifact <signed .dmg or .zip> for ${revision}`];
    const report = JSON.parse(readFileSync(file, "utf8")) as HarnessReport;
    if (report.version !== 1 || report.target !== target || report.commit !== revision) return [`${target}: ${shown} is not a harness report for ${target} at ${revision}`];
    if (report.local) return [`${target}: ${shown} is from a --local run, which is never releasable`];
    if (report.verdict !== "PASS" || !report.releasable || report.dirty) return [`${target}: the harness did not pass: ${report.reasons.map(reason => `[${reason.check}] ${reason.message.split("\n")[0]}`).join("; ") || "not releasable"}`];
    return [];
  });
}

export function requireHarnessPass(repo: string, revision: string) {
  const problems = harnessProblems(repo, revision);
  if (problems.length) throw new Error(`Refusing to publish ${revision}: every release target needs a passing harness report for this build (docs/release-harness.md).\n${problems.map(problem => `- ${problem}`).join("\n")}`);
}
