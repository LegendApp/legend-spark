import { test, expect, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyVersionEdits, nextVersion, releaseWorkflow, signingProject, verifyReleaseArchive, type Execute } from "../scripts/release-workflow.ts";
import { alreadyPublished, releaseNotes } from "../scripts/npm-release.ts";
import { credentials } from "../packages/cli/src/credentials.ts";

test("next preview version exceeds local and registry versions without using another series", () => {
  expect(nextVersion("0.0.1-next.2", ["0.0.1-next.4", "0.0.2-next.30", "0.0.1-next.bad"])).toBe("0.0.1-next.5");
  expect(() => nextVersion("0.0.1", [])).toThrow("Expected a next preview");
});

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-release-workflow-"));
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  const write = (file: string, content: string) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), content); };
  git("init", "-b", "main"); git("config", "user.name", "Release test"); git("config", "user.email", "release@example.test");
  write(".gitignore", ".spark/\nartifacts/\n");
  write("package.json", '{"version":"0.0.1-next.2","dependencies":{"@legendapp/spark":"0.0.1-next.2"}}\n');
  write("package-lock.json", '{"version":"0.0.1-next.2"}\n');
  write("packages/desktop/package.json", '{"version":"0.0.1-next.2"}\n');
  write("packages/cli/templates/blank-typescript/package.json", '{"dependencies":{"@legendapp/spark":"0.0.1-next.2"}}\n');
  write("packages/cli/src/project.ts", 'export const VERSION = "0.0.1-next.2";\n');
  write("CHANGELOG.md", "# Changelog\n\n## 0.0.1-next.2 — preview\n\nHistorical notes.\n");
  write("docs/releases.md", "Legend Spark currently identifies itself as `0.0.1-next.2`.\n");
  git("add", "."); git("commit", "-m", "Previous release"); git("tag", "v0.0.1-next.2");
  write("feature.ts", "export const feature = true;\n"); git("add", "."); git("commit", "-m", "Fix a native lifecycle");
  git("remote", "add", "origin", "https://github.com/LegendApp/legend-spark.git"); git("update-ref", "refs/remotes/origin/main", "HEAD");
  const commands: string[][] = [];
  const tags: Record<string, string> = { next: "0.0.1-next.2", latest: "0.0.1-next.2" };
  let failTest = false, pendingRunner = false, failPublish = false;
  const staged = () => {
    const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
    const folder = `artifacts/releases/${version}`;
    write(`${folder}/spark.tgz`, "exact signed release archive"); write(`${folder}/runner-manifest.json`, "{}\n");
    const sha256 = Object.fromEntries(["spark.tgz", "runner-manifest.json"].map(name => [name, createHash("sha256").update(readFileSync(path.join(root, folder, name))).digest("hex")]));
    write(`${folder}/release.json`, JSON.stringify({ version, revision: git("rev-parse", "HEAD"), npm: "spark.tgz", sha256 }));
  };
  const execute: Execute = async argv => {
    commands.push(argv);
    if (argv[0] === "git") {
      if (["fetch", "push"].includes(argv[1]!)) return { code: 0, output: "" };
      const result = spawnSync("git", argv.slice(1), { cwd: root, encoding: "utf8" });
      return { code: result.status ?? 1, output: result.status ? result.stdout + result.stderr : result.stdout };
    }
    if (argv[0] === "gh") return { code: 0, output: argv.includes("visibility") ? '{"visibility":"PUBLIC"}' : "" };
    if (argv.includes("versions")) return { code: 0, output: '["0.0.1-next.2"]' };
    if (argv.includes("dist-tags")) return { code: 0, output: JSON.stringify(tags) };
    if (argv[1] === "test" && failTest) { failTest = false; return { code: 1, output: "Test failure" }; }
    if (argv.includes("release:runner")) {
      write(".spark/runner/.spark/go-build.json", JSON.stringify({ runtime: { sourceRevision: git("rev-parse", "HEAD") } }));
      if (pendingRunner) { pendingRunner = false; return { code: 2, output: "" }; }
      staged();
    }
    if (argv.includes("release:publish")) {
      tags.next = "0.0.1-next.3";
      if (failPublish) { failPublish = false; return { code: 1, output: "Promotion interrupted" }; }
      if (argv.includes("--latest")) tags.latest = tags.next;
    }
    return { code: 0, output: "" };
  };
  const release = (resume = false, latest = false, preflight = async () => {}) => releaseWorkflow(root, { resume, latest }, execute, preflight, () => path.join(root, ".spark/runner"));
  return { root, git, write, commands, tags, release, setFailures: (test: boolean, runner: boolean, publish: boolean) => { failTest = test; pendingRunner = runner; failPublish = publish; }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("failed checks, pending notarization and interrupted promotion resume one version, commit and archive", async () => {
  const f = fixture();
  try {
    f.setFailures(true, true, true);
    await expect(f.release(false, true)).rejects.toThrow("Test failure");
    expect(f.git("log", "-1", "--format=%s")).toBe("Fix a native lifecycle");
    expect(JSON.parse(readFileSync(path.join(f.root, "package.json"), "utf8")).version).toBe("0.0.1-next.3");
    await expect(f.release()).rejects.toThrow("unfinished");
    expect(await f.release(true)).toBe(2);
    const releaseRevision = f.git("rev-parse", "HEAD");
    expect(f.git("log", "-1", "--format=%s")).toBe("release: prepare 0.0.1-next.3");
    expect(readFileSync(path.join(f.root, "packages/cli/templates/blank-typescript/package.json"), "utf8")).toContain("0.0.1-next.3");
    expect(readFileSync(path.join(f.root, "CHANGELOG.md"), "utf8")).toContain("- Fix a native lifecycle");
    expect(readFileSync(path.join(f.root, "CHANGELOG.md"), "utf8")).toContain("## 0.0.1-next.2");
    await expect(f.release(true)).rejects.toThrow("Promotion interrupted");
    expect(f.commands.filter(args => args.includes("release:runner"))[1]).toEqual(["npm", "run", "release:runner", "--", "--resume"]);
    expect(await f.release(true)).toBe(0);
    expect(f.git("rev-parse", "HEAD")).toBe(releaseRevision);
    expect(f.git("rev-parse", "v0.0.1-next.3")).toBe(releaseRevision);
    expect(f.tags).toEqual({ next: "0.0.1-next.3", latest: "0.0.1-next.3" });
    expect(f.commands.filter(args => args.includes("release:runner"))).toHaveLength(2);
    expect(f.commands.filter(args => args[0] === "git" && args[1] === "commit")).toHaveLength(1);
    expect(f.commands.find(args => args.includes("tests/packed-consumer.integration.ts"))).toEqual([process.execPath, "tests/packed-consumer.integration.ts", "--archive", path.join(f.root, "artifacts/releases/0.0.1-next.3/spark.tgz")]);
    expect(await f.release(true)).toBe(0);
    expect(f.commands.filter(args => args.includes("release:publish"))).toHaveLength(2);
  } finally { f.cleanup(); }
});

test("dirty source and missing signing credentials stop before versioning or publication", async () => {
  const f = fixture();
  try {
    f.write("draft.ts", "draft\n");
    await expect(f.release()).rejects.toThrow("clean checkout");
    rmSync(path.join(f.root, "draft.ts"));
    await expect(f.release(false, false, async () => { throw new Error("No Developer ID"); })).rejects.toThrow("No Developer ID");
    expect(existsSync(path.join(f.root, ".spark/release-workflow.json"))).toBe(false);
    expect(f.commands.some(args => args.includes("release:publish"))).toBe(false);
  } finally { f.cleanup(); }
});

test("resume recovers a committed version checkpoint and refuses changed artifacts", async () => {
  const f = fixture();
  try {
    f.setFailures(false, true, false);
    expect(await f.release()).toBe(2);
    const stateFile = path.join(f.root, ".spark/release-workflow.json");
    const state = JSON.parse(readFileSync(stateFile, "utf8")); delete state.revision; writeFileSync(stateFile, JSON.stringify(state));
    expect(await f.release(true)).toBe(0);
    const completed = JSON.parse(readFileSync(stateFile, "utf8")); completed.complete = false; writeFileSync(stateFile, JSON.stringify(completed));
    f.write("artifacts/releases/0.0.1-next.3/spark.tgz", "tampered archive");
    const pushed = f.commands.filter(args => args[1] === "push").length;
    await expect(f.release(true)).rejects.toThrow("Release artifact changed");
    expect(f.commands.filter(args => args[1] === "push")).toHaveLength(pushed);
  } finally { f.cleanup(); }
});

test("partial version writes converge and unrelated edits are preserved", () => {
  const f = fixture();
  try {
    const edits = [{ file: "a.json", before: "old", after: "new" }, { file: "b.json", before: "old", after: "new" }];
    f.write("a.json", "new"); f.write("b.json", "old"); applyVersionEdits(f.root, edits); applyVersionEdits(f.root, edits);
    expect(readFileSync(path.join(f.root, "b.json"), "utf8")).toBe("new");
    f.write("a.json", "old"); f.write("b.json", "user edit");
    expect(() => applyVersionEdits(f.root, edits)).toThrow("Release input changed");
    expect(readFileSync(path.join(f.root, "a.json"), "utf8")).toBe("old");
    expect(() => verifyReleaseArchive(f.root, "missing", "revision")).toThrow();
  } finally { f.cleanup(); }
});

test("conflicting release tags stop before pushing or publishing", async () => {
  const f = fixture();
  try {
    f.setFailures(false, true, false);
    expect(await f.release()).toBe(2);
    f.git("tag", "v0.0.1-next.3", "HEAD^");
    await expect(f.release(true)).rejects.toThrow("already points at another source revision");
    expect(f.commands.some(args => args[1] === "push" || args.includes("release:publish"))).toBe(false);
  } finally { f.cleanup(); }
});

test("resume refuses new source commits and preserves unrelated drafts", async () => {
  const f = fixture();
  try {
    f.setFailures(false, true, false);
    expect(await f.release()).toBe(2);
    f.write("unrelated.ts", "draft\n");
    await expect(f.release(true)).rejects.toThrow("clean checkout");
    expect(readFileSync(path.join(f.root, "unrelated.ts"), "utf8")).toBe("draft\n");
    f.git("add", "unrelated.ts"); f.git("commit", "-m", "Another change");
    await expect(f.release(true)).rejects.toThrow("Source revision changed");
    expect(f.commands.some(args => args.includes("release:publish"))).toBe(false);
  } finally { f.cleanup(); }
});

test("GitHub notes include only the selected release", () => {
  const changelog = "# Changelog\n\n## 0.0.1-next.3 — preview\n\nNew fixes.\n\n## 0.0.1-next.2 — preview\n\nOld fixes.\n";
  expect(releaseNotes(changelog, "0.0.1-next.3")).toBe("New fixes.");
  expect(releaseNotes(changelog, "0.0.1-next.2")).toBe("Old fixes.");
  expect(() => releaseNotes(changelog, "missing")).toThrow("Missing changelog");
});

test("signing preflight supplies the app configuration required by the shared credential helper", async () => {
  const f = fixture();
  try {
    for (const name of ["SPARK_SIGNING_KEYCHAIN", "SPARK_DEVELOPER_ID_APPLICATION", "SPARK_TEAM_ID", "SPARK_NOTARY_KEYCHAIN_PROFILE"]) vi.stubEnv(name, undefined);
    const project = signingProject(f.root);
    const hash = "A".repeat(40);
    f.write(".spark/release-signing/.spark/signing.json", JSON.stringify({ hash, keychainProfile: "release-test" }));
    const result = await credentials(project, false, async (_root, argv) => {
      if (argv[0] === "security") return `1) ${hash} "Developer ID Application: Test (ABCDEFGHIJ)"`;
      expect(argv).toEqual(["xcrun", "notarytool", "history", "--keychain-profile", "release-test", "--output-format", "json"]);
      return "{}";
    });
    expect(result.hash).toBe(hash);
    expect(result.keychainProfile).toBe("release-test");
    expect(f.git("status", "--porcelain")).toBe("");
  } finally { vi.unstubAllEnvs(); f.cleanup(); }
});

test("npm retries accept exactly the published tarball and distinguish missing versions from auth failures", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-npm-release-"));
  try {
    const archive = path.join(root, "spark.tgz"); writeFileSync(archive, "release bytes");
    const metadata = { version: "0.0.1-next.3", "dist.integrity": `sha512-${createHash("sha512").update("release bytes").digest("base64")}` };
    expect(await alreadyPublished(metadata.version, archive, async () => ({ code: 0, output: JSON.stringify(metadata) }))).toBe(true);
    expect(await alreadyPublished(metadata.version, archive, async () => ({ code: 1, output: "npm error E404" }))).toBe(false);
    await expect(alreadyPublished(metadata.version, archive, async () => ({ code: 1, output: "E401 Unauthorized" }))).rejects.toThrow("Could not check");
    writeFileSync(archive, "different bytes");
    await expect(alreadyPublished(metadata.version, archive, async () => ({ code: 0, output: JSON.stringify(metadata) }))).rejects.toThrow("different bytes");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
