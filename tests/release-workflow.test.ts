import { test, expect, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyVersionEdits, releaseTarget, releaseWorkflow, signingProject, verifyReleaseArchive, versionEdits, type Execute } from "../scripts/release-workflow.ts";
import { alreadyPublished, changelogSection, releaseNotes } from "../scripts/npm-release.ts";
import { credentials } from "../packages/cli/src/credentials.ts";
import { loadReleaseEnv } from "../scripts/release-env.ts";

test("release targets advance published versions and retain unpublished workspace versions", () => {
  expect(releaseTarget("0.0.1-next.2", ["0.0.1-next.2", "0.0.1-next.4", "0.0.2-next.30"])).toEqual({ version: "0.0.1-next.5", previous: "v0.0.1-next.2" });
  expect(releaseTarget("0.0.1-next.5", ["0.0.1-next.4", "0.0.1-next.2", "0.0.2-next.30", "0.0.1-next.bad"])).toEqual({ version: "0.0.1-next.5", previous: "v0.0.1-next.4" });
  expect(releaseTarget("0.0.1-next.12", ["0.0.1-next.9", "0.0.1-next.10"])).toEqual({ version: "0.0.1-next.12", previous: "v0.0.1-next.10" });
  expect(() => releaseTarget("0.0.1-next.3", ["0.0.1-next.2", "0.0.1-next.4"])).toThrow("higher 0.0.1-next. version is already published");
  expect(() => releaseTarget("0.0.1-next.3", ["0.0.2-next.2", "0.0.1-next.bad"])).toThrow("No previous published 0.0.1-next. version below 0.0.1-next.3");
  expect(() => releaseTarget("0.0.1-beta.1", [])).toThrow("Expected a stable or next preview version");
});

test("stable targets use the latest published preview on their line and never advance a published stable version", () => {
  expect(releaseTarget("0.0.1", ["0.0.1-next.9", "0.0.1-next.10", "0.0.2-next.30", "0.0.1-next.bad"])).toEqual({ version: "0.0.1", previous: "v0.0.1-next.10" });
  expect(() => releaseTarget("0.0.1", ["0.0.1", "0.0.1-next.7"])).toThrow("Stable version 0.0.1 is already published");
  expect(() => releaseTarget("0.0.1", ["0.0.2-next.1"])).toThrow("No previous published 0.0.1-next. version below 0.0.1");
});

test("release environment loading works without process.loadEnvFile and preserves shell values", () => {
  const f = fixture();
  try {
    vi.stubEnv("SPARK_TEST_FROM_FILE", undefined);
    vi.stubEnv("SPARK_TEST_EXISTING", "shell");
    f.write(".env", 'SPARK_TEST_FROM_FILE="signing profile"\nSPARK_TEST_EXISTING=file\n');
    loadReleaseEnv(f.root);
    expect(process.env.SPARK_TEST_FROM_FILE).toBe("signing profile");
    expect(process.env.SPARK_TEST_EXISTING).toBe("shell");
  } finally { vi.unstubAllEnvs(); f.cleanup(); }
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
  write("bun.lock", '{"lockfileVersion":1,"workspaces":{"":{"name":"spark-workspace","devDependencies":{"@legendapp/spark":"0.0.1-next.2"}}},}\n');
  write("packages/create-spark/package.json", '{"name":"@legendapp/create-spark","version":"0.0.1-next.2"}\n');
  write("packages/desktop/package.json", '{"version":"0.0.1-next.2"}\n');
  write("packages/cli/templates/blank-typescript/package.json", '{"dependencies":{"@legendapp/spark":"0.0.1-next.2"}}\n');
  write("packages/cli/src/project.ts", 'export const VERSION = "0.0.1-next.2";\n');
  write("packages/desktop/skills/spark/UPGRADING.md", "# Upgrading Spark apps\n\n## 0.0.1-next.3\n\nReviewed upgrade notes.\n\n## 0.0.1-next.2\n\nBaseline.\n");
  write("CHANGELOG.md", "# Changelog\n\n## 0.0.1-next.2 — preview\n\nHistorical notes.\n");
  write("docs/releases.md", "Legend Spark currently identifies itself as `0.0.1-next.2`.\n");
  write("docs/release-support-matrix.json", JSON.stringify({ version: "0.0.1-next.2", entries: [] }, null, 2) + "\n");
  write("docs/release-support-matrix.md", "Package: `@legendapp/spark@0.0.1-next.2`.\n");
  git("add", "."); git("commit", "-m", "Previous release"); git("tag", "v0.0.1-next.2");
  write("feature.ts", "export const feature = true;\n"); git("add", "."); git("commit", "-m", "Fix a native lifecycle");
  git("remote", "add", "origin", "https://github.com/LegendApp/legend-spark.git"); git("update-ref", "refs/remotes/origin/main", "HEAD");
  const commands: string[][] = [];
  const tags: Record<string, string> = { next: "0.0.1-next.2", latest: "0.0.1-next.2" };
  const createTags = { ...tags };
  let failTest = false, pendingRunner = false, failPublish = false;
  const published = new Set<string>();
  const staged = () => {
    const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
    const folder = `artifacts/releases/${version}`;
    write(".spark/create-fixture/package/package.json", JSON.stringify({ name: "@legendapp/create-spark", version }));
    write(".spark/create-fixture/package/dist/release.json", JSON.stringify({ version }));
    mkdirSync(path.join(root, folder), { recursive: true });
    const packed = spawnSync("tar", ["-czf", path.join(root, folder, "create-spark.tgz"), "-C", path.join(root, ".spark/create-fixture"), "package"]);
    if (packed.status) throw new Error("Failed to pack creator fixture");
    write(`${folder}/spark.tgz`, "exact signed release archive"); write(`${folder}/runner-manifest.json`, "{}\n");
    const sha256 = Object.fromEntries(["spark.tgz", "create-spark.tgz", "runner-manifest.json"].map(name => [name, createHash("sha256").update(readFileSync(path.join(root, folder, name))).digest("hex")]));
    write(`${folder}/release.json`, JSON.stringify({ version, revision: git("rev-parse", "HEAD"), npm: "spark.tgz", createNpm: "create-spark.tgz", sha256 }));
  };
  const execute: Execute = async argv => {
    commands.push(argv);
    if (argv[0] === "git") {
      if (["fetch", "push"].includes(argv[1]!)) return { code: 0, output: "" };
      const result = spawnSync("git", argv.slice(1), { cwd: root, encoding: "utf8" });
      return { code: result.status ?? 1, output: result.status ? result.stdout + result.stderr : result.stdout };
    }
    if (argv[0] === "gh") {
      if (argv.includes("visibility")) return { code: 0, output: '{"visibility":"PUBLIC"}' };
      if (argv[1] === "api") {
        const state = JSON.parse(readFileSync(path.join(root, ".spark/release-workflow.json"), "utf8"));
        if (argv[2]!.includes("/git/ref/tags/")) return { code: 0, output: JSON.stringify({ object: { type: "commit", sha: state.revision } }) };
        const manifest = JSON.parse(readFileSync(path.join(root, `artifacts/releases/${state.version}/release.json`), "utf8"));
        return { code: 0, output: JSON.stringify({ draft: false, tag_name: `v${state.version}`, assets: Object.entries(manifest.sha256).map(([name, hash]) => ({ name, digest: `sha256:${hash}` })) }) };
      }
      return { code: 0, output: "" };
    }
    if (argv.includes("versions")) return { code: 0, output: '["0.0.1-next.2"]' };
    if (argv.includes("dist-tags")) return { code: 0, output: JSON.stringify(argv[2] === "@legendapp/create-spark" ? createTags : tags) };
    if (argv[0] === "npm" && argv[1] === "view" && argv.includes("dist.integrity")) {
      const version = argv[2]!.slice(argv[2]!.lastIndexOf("@") + 1);
      const creator = argv[2]!.startsWith("@legendapp/create-spark@");
      if (!published.has(argv[2]!)) return { code: 1, output: "npm error E404" };
      const integrity = `sha512-${createHash("sha512").update(readFileSync(path.join(root, `artifacts/releases/${version}/${creator ? "create-spark" : "spark"}.tgz`))).digest("base64")}`;
      return { code: 0, output: JSON.stringify({ version, "dist.integrity": integrity }) };
    }
    if (argv[0] === "npm" && argv[1] === "dist-tag" && argv[2] === "add") {
      const target = argv[3]!.startsWith("@legendapp/create-spark@") ? createTags : tags;
      target[argv[4]!] = argv[3]!.slice(argv[3]!.lastIndexOf("@") + 1);
    }
    if (argv[0] === "bun" && argv[2] === "test" && failTest) { failTest = false; return { code: 1, output: "Test failure" }; }
    if (argv.includes("release:runner")) {
      write(".spark/runner/.spark/go-build.json", JSON.stringify({ runtime: { sourceRevision: git("rev-parse", "HEAD") } }));
      if (pendingRunner) { pendingRunner = false; return { code: 2, output: "" }; }
      staged();
    }
    if (argv.includes("release:publish")) {
      expect(argv.filter(arg => arg === "--latest" || arg === "--next")).toHaveLength(1);
      const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
      published.add(`@legendapp/spark@${version}`).add(`@legendapp/create-spark@${version}`);
      // An interrupted publication leaves the packages published but the channel tag unconfirmed.
      if (failPublish) { failPublish = false; return { code: 1, output: "Promotion interrupted" }; }
      const channel = argv.includes("--latest") ? "latest" : "next";
      tags[channel] = createTags[channel] = version;
    }
    return { code: 0, output: "" };
  };
  const release = (resume = false, latest = false, preflight = async () => {}) => releaseWorkflow(root, { resume, latest }, execute, preflight, () => path.join(root, ".spark/runner"));
  const finish = (runner: Execute = execute, latest = false) => releaseWorkflow(root, { resume: false, latest, finish: true }, runner, async () => { throw new Error("Signing must not run"); }, () => { throw new Error("Runner must not be consulted"); });
  return { root, git, write, commands, tags, createTags, release, finish, execute, setFailures: (test: boolean, runner: boolean, publish: boolean) => { failTest = test; pendingRunner = runner; failPublish = publish; }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test.each(["promote", "workspace"])("stable release versions, resumes and publishes to latest: %s", async mode => {
  const f = fixture();
  try {
    f.write("packages/desktop/skills/spark/UPGRADING.md", "# Upgrading Spark apps\n\n## 0.0.1\n\nReviewed stable upgrade notes.\n");
    if (mode === "workspace") applyVersionEdits(f.root, versionEdits(f.root, f.git("ls-files").split("\n"), "0.0.1-next.2", "0.0.1", "Reviewed stable release notes."));
    f.git("add", "."); f.git("commit", "-m", "Prepare stable upgrade notes");
    const release = (resume: boolean) => releaseWorkflow(f.root, { resume, latest: false, stable: mode === "promote" }, f.execute, async () => {}, () => path.join(f.root, ".spark/runner"));
    f.setFailures(false, true, false);
    expect(await release(false)).toBe(2);
    const state = JSON.parse(readFileSync(path.join(f.root, ".spark/release-workflow.json"), "utf8"));
    expect(state).toMatchObject({ version: "0.0.1", latest: true });
    expect(await release(true)).toBe(0);
    expect(JSON.parse(readFileSync(path.join(f.root, "packages/create-spark/package.json"), "utf8")).version).toBe("0.0.1");
    expect(readFileSync(path.join(f.root, "CHANGELOG.md"), "utf8")).toContain("\n## 0.0.1\n");
    expect(f.commands).toContainEqual(["bun", "run", "release:publish", "--latest"]);
    for (const tags of [f.tags, f.createTags]) expect(tags).toEqual({ latest: "0.0.1", next: "0.0.1-next.2" });
  } finally { f.cleanup(); }
});

test("stable promotion refuses to resume an unfinished preview", async () => {
  const f = fixture();
  try {
    f.setFailures(false, true, false);
    expect(await f.release()).toBe(2);
    f.commands.length = 0;
    await expect(releaseWorkflow(f.root, { resume: false, latest: false, stable: true }, f.execute, async () => {}, () => "unused")).rejects.toThrow("Cannot promote an unfinished preview release");
    expect(f.commands.some(argv => argv.includes("release:publish"))).toBe(false);
  } finally { f.cleanup(); }
});

test.each(["hand-written", "generated"])("pre-bumped releases use the workspace version with %s notes", async notes => {
  const f = fixture();
  try {
    const historical = readFileSync(path.join(f.root, "CHANGELOG.md"), "utf8");
    const changelog = notes === "hand-written" ? historical.replace("# Changelog\n", "# Changelog\n\n## 0.0.1-next.3 — preview\n\nHand-written release notes.\n") : historical;
    f.write("CHANGELOG.md", changelog);
    applyVersionEdits(f.root, versionEdits(f.root, f.git("ls-files").split("\n"), "0.0.1-next.2", "0.0.1-next.3", "unused"));
    f.write("docs/release-support-matrix.json", '{"version":"0.0.1-next.3","entries":[]}\n');
    if (notes === "generated") f.write("CHANGELOG.md", changelog);
    else expect(readFileSync(path.join(f.root, "CHANGELOG.md"), "utf8")).toBe(changelog);
    // With hand-written notes, the only commit since the previous tag can be bookkeeping.
    if (notes === "hand-written") f.git("tag", "-f", "v0.0.1-next.2");
    f.git("add", "."); f.git("commit", "-m", "release: prepare 0.0.1-next.3");
    const revision = f.git("rev-parse", "HEAD");
    f.setFailures(true, true, false);
    await expect(f.release()).rejects.toThrow("Test failure");
    const stateFile = path.join(f.root, ".spark/release-workflow.json");
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    expect(state.revision).toBe(notes === "hand-written" ? revision : undefined);
    expect(await f.release(true)).toBe(2);
    if (notes === "generated") {
      // Recover the CHANGELOG-only commit if its checkpoint was lost.
      writeFileSync(stateFile, JSON.stringify(state));
    }
    expect(await f.release(true)).toBe(0);
    const result = readFileSync(path.join(f.root, "CHANGELOG.md"), "utf8");
    expect(result.match(/^## 0\.0\.1-next\.3(?: — preview)?$/gm)).toHaveLength(1);
    expect(f.git("rev-parse", "v0.0.1-next.3")).toBe(f.git("rev-parse", "HEAD"));
    const commits = f.commands.filter(args => args[0] === "git" && args[1] === "commit");
    if (notes === "hand-written") {
      expect(result).toBe(changelog);
      expect(releaseNotes(result, "0.0.1-next.3")).toBe("Hand-written release notes.");
      expect(f.git("rev-parse", "v0.0.1-next.3")).toBe(revision);
      expect(commits).toHaveLength(0);
    } else {
      expect(releaseNotes(result, "0.0.1-next.3")).toContain("- Fix a native lifecycle");
      expect(f.git("diff", "--name-only", revision, "HEAD")).toBe("CHANGELOG.md");
      expect(commits).toHaveLength(1);
      expect(f.git("log", "-1", "--format=%s")).toBe("release: prepare 0.0.1-next.3");
    }
  } finally { f.cleanup(); }
});

test.each([
  ["packages/cli/src/project.ts", 'export const VERSION = "wrong";\n', "CLI version"],
  ["docs/release-support-matrix.json", '{"version":"wrong"}', "Release support matrix version"],
  ["docs/release-support-matrix.md", "wrong", "Release support matrix documentation"],
] as const)("pre-bumped releases still validate %s", (file, content, error) => {
  const f = fixture();
  try {
    f.write(file, content);
    expect(() => versionEdits(f.root, [file], "0.0.1-next.2", "0.0.1-next.2", "")).toThrow(error);
  } finally { f.cleanup(); }
});

test("generated notes omit merges, reverts and release preparation commits", async () => {
  const f = fixture();
  try {
    f.git("checkout", "-b", "feature", "HEAD^");
    f.write("runner.ts", "export const runner = true;\n"); f.git("add", "."); f.git("commit", "-m", "Release Runner installation locks correctly");
    f.git("checkout", "main"); f.git("merge", "--no-ff", "feature", "-m", "Merge feature");
    for (const subject of ['Revert "x"', "revert: undo y", "release: prepare 0.0.1-next.2", "RELEASE(cli): prepare creator"]) f.git("commit", "--allow-empty", "-m", subject);
    expect(await f.release()).toBe(0);
    const notes = releaseNotes(readFileSync(path.join(f.root, "CHANGELOG.md"), "utf8"), "0.0.1-next.3");
    const [support, changes] = notes.split("\n\n");
    expect(support).toBe("macOS 14+ (Apple Silicon) supported; Windows preview, not yet verified");
    expect(changes!.split("\n").sort()).toEqual(["- Fix a native lifecycle", "- Release Runner installation locks correctly"]);
  } finally { f.cleanup(); }
});

test("generated notes require changes after filtering release bookkeeping", async () => {
  const f = fixture();
  try {
    f.git("reset", "--hard", "v0.0.1-next.2");
    f.git("commit", "--allow-empty", "-m", 'Revert "x"');
    f.git("commit", "--allow-empty", "-m", "release: prepare 0.0.1-next.2");
    f.git("update-ref", "refs/remotes/origin/main", "HEAD");
    await expect(f.release()).rejects.toThrow("No new committed changes since the previous release");
    expect(existsSync(path.join(f.root, ".spark/release-workflow.json"))).toBe(false);
  } finally { f.cleanup(); }
});

test("stable promotion without new commits notes the promoted preview", async () => {
  const f = fixture();
  try {
    f.git("reset", "--hard", "v0.0.1-next.2");
    f.write("packages/desktop/skills/spark/UPGRADING.md", "# Upgrading Spark apps\n\n## 0.0.1\n\nReviewed stable upgrade notes.\n");
    f.git("add", "."); f.git("commit", "-m", "release: stable upgrade notes");
    f.git("update-ref", "refs/remotes/origin/main", "HEAD");
    f.setFailures(false, true, false);
    expect(await releaseWorkflow(f.root, { resume: false, latest: false, stable: true }, f.execute, async () => {}, () => path.join(f.root, ".spark/runner"))).toBe(2);
    expect(readFileSync(path.join(f.root, "CHANGELOG.md"), "utf8")).toContain("\n## 0.0.1\n\nmacOS 14+ (Apple Silicon) supported; Windows preview, not yet verified\n\n- First stable release, promoting 0.0.1-next.2\n");
  } finally { f.cleanup(); }
});

test("failed checks, pending notarization and interrupted promotion resume one version, commit and archive", async () => {
  const f = fixture();
  try {
    f.setFailures(true, true, true);
    await expect(f.release(false, true)).rejects.toThrow("Test failure");
    expect(f.git("log", "-1", "--format=%s")).toBe("Fix a native lifecycle");
    expect(JSON.parse(readFileSync(path.join(f.root, "package.json"), "utf8")).version).toBe("0.0.1-next.3");
    expect(readFileSync(path.join(f.root, "bun.lock"), "utf8")).toContain("0.0.1-next.3");
    expect(JSON.parse(readFileSync(path.join(f.root, "docs/release-support-matrix.json"), "utf8")).version).toBe("0.0.1-next.3");
    expect(readFileSync(path.join(f.root, "docs/release-support-matrix.md"), "utf8")).toContain("Package: `@legendapp/spark@0.0.1-next.3`");
    expect(f.commands).toContainEqual(["bun", "install", "--frozen-lockfile"]);
    expect(f.commands).toContainEqual(["bun", "run", "typecheck"]);
    expect(f.commands).toContainEqual(["bun", "run", "test"]);
    expect(await f.release()).toBe(2);
    const releaseRevision = f.git("rev-parse", "HEAD");
    expect(f.git("log", "-1", "--format=%s")).toBe("release: prepare 0.0.1-next.3");
    expect(readFileSync(path.join(f.root, "packages/cli/templates/blank-typescript/package.json"), "utf8")).toContain("0.0.1-next.3");
    expect(readFileSync(path.join(f.root, "CHANGELOG.md"), "utf8")).toContain("- Fix a native lifecycle");
    expect(readFileSync(path.join(f.root, "CHANGELOG.md"), "utf8")).toContain("## 0.0.1-next.2");
    await expect(f.release(true)).rejects.toThrow("Promotion interrupted");
    expect(f.commands.filter(args => args.includes("release:runner"))[1]).toEqual(["bun", "run", "release:runner", "--resume"]);
    const verificationCount = f.commands.filter(args => args[2] === "test" || args[2] === "typecheck" || args.includes("tests/packed-consumer.integration.ts")).length;
    expect(await f.release(true, false, async () => { throw new Error("Must not ask for signing again"); })).toBe(0);
    expect(f.commands.filter(args => args[2] === "test" || args[2] === "typecheck" || args.includes("tests/packed-consumer.integration.ts"))).toHaveLength(verificationCount);
    expect(f.git("rev-parse", "HEAD")).toBe(releaseRevision);
    expect(f.git("rev-parse", "v0.0.1-next.3")).toBe(releaseRevision);
    expect(f.commands).toContainEqual(["bun", "run", "release:publish", "--latest"]);
    expect(f.commands).toContainEqual(["npm", "view", "@legendapp/create-spark", "dist-tags", "--json", "--prefer-online", "--fetch-retries=0", "--fetch-timeout=15000"]);
    expect(JSON.parse(readFileSync(path.join(f.root, "packages/create-spark/package.json"), "utf8")).version).toBe("0.0.1-next.3");
    expect(f.tags).toEqual({ next: "0.0.1-next.2", latest: "0.0.1-next.3" });
    expect(f.commands.filter(args => args.includes("release:runner"))).toHaveLength(2);
    expect(f.commands.filter(args => args[0] === "git" && args[1] === "commit")).toHaveLength(1);
    expect(f.commands.find(args => args.includes("tests/packed-consumer.integration.ts"))).toEqual([process.execPath, "tests/packed-consumer.integration.ts", "--archive", path.join(f.root, "artifacts/releases/0.0.1-next.3/spark.tgz")]);
    expect(await f.release(true)).toBe(0);
    expect(f.commands.filter(args => args.includes("release:publish"))).toHaveLength(2);
    // release:publish pushes main and the tag only after npm publication.
    expect(f.commands.some(args => args[0] === "git" && args[1] === "push")).toBe(false);
  } finally { f.cleanup(); }
});

test("finish recovers an old checkpoint using published artifacts while preserving newer source and drafts", async () => {
  const f = fixture();
  try {
    f.setFailures(false, false, true);
    await expect(f.release(false, true)).rejects.toThrow("Promotion interrupted");
    const stateFile = path.join(f.root, ".spark/release-workflow.json");
    const old = JSON.parse(readFileSync(stateFile, "utf8")); delete old.publicationReady; writeFileSync(stateFile, JSON.stringify(old));
    f.write("new-feature.ts", "new source\n"); f.git("add", "new-feature.ts"); f.git("commit", "-m", "New work");
    f.write("draft.ts", "preserve this\n");
    f.write("package.json", '{"version":"0.0.1-next.99"}\n');
    const revision = f.git("rev-parse", "HEAD");
    await expect(releaseWorkflow(f.root, { resume: false, latest: false, next: true, finish: true }, f.execute, async () => {}, () => "")).rejects.toThrow("Retry without --next");
    const before = f.commands.length;
    expect(await f.finish()).toBe(0);
    const finishing = f.commands.slice(before);
    expect(finishing.filter(args => args[0] === "git")).toEqual([["git", "remote", "get-url", "origin"]]);
    expect(finishing.some(args => args[0] === "bun" || args[1] === "publish" || args.includes("upload"))).toBe(false);
    expect(finishing).toContainEqual(["npm", "dist-tag", "add", "@legendapp/spark@0.0.1-next.3", "latest"]);
    expect(finishing).toContainEqual(["npm", "dist-tag", "add", "@legendapp/create-spark@0.0.1-next.3", "latest"]);
    expect(finishing.filter(args => args[1] === "dist-tag")).toHaveLength(2);
    expect(f.tags).toEqual({ next: "0.0.1-next.2", latest: "0.0.1-next.3" });
    expect(JSON.parse(readFileSync(stateFile, "utf8")).complete).toBe(true);
    expect(f.git("rev-parse", "HEAD")).toBe(revision);
    expect(readFileSync(path.join(f.root, "draft.ts"), "utf8")).toBe("preserve this\n");
    expect(readFileSync(path.join(f.root, "package.json"), "utf8")).toContain("next.99");
    const after = f.commands.length;
    expect(await f.finish()).toBe(0);
    expect(f.commands.slice(after).some(args => args[1] === "dist-tag")).toBe(false);
  } finally { f.cleanup(); }
});

test.each(["local archive", "remote tag", "remote asset", "draft", "npm archive", "not submitted", "creator npm archive", "creator not submitted"])("finish refuses %s problems before promoting tags", async problem => {
  const f = fixture();
  try {
    f.setFailures(false, false, true);
    await expect(f.release(false, true)).rejects.toThrow();
    if (problem === "local archive") f.write("artifacts/releases/0.0.1-next.3/spark.tgz", "tampered");
    const before = f.commands.length;
    await expect(f.finish(async (argv, capture) => {
      const result = await f.execute(argv, capture);
      if (problem === "remote tag" && argv[2]?.includes("/git/ref/tags/")) result.output = JSON.stringify({ object: { type: "commit", sha: "different" } });
      if (argv[2]?.includes("/releases/tags/")) {
        const uploaded = JSON.parse(result.output);
        if (problem === "draft") uploaded.draft = true;
        if (problem === "remote asset") uploaded.assets[0].digest = "sha256:wrong";
        result.output = JSON.stringify(uploaded);
      }
      if (argv.includes("dist.integrity")) {
        const creator = argv[2]!.startsWith("@legendapp/create-spark@");
        if (problem === "npm archive" || (creator && problem === "creator npm archive")) result.output = JSON.stringify({ version: "0.0.1-next.3", "dist.integrity": "wrong" });
        if (problem === "not submitted" || (creator && problem === "creator not submitted")) return { code: 1, output: "npm error E404" };
      }
      return result;
    })).rejects.toThrow();
    expect(f.commands.slice(before).some(args => args[1] === "dist-tag" || args[1] === "publish")).toBe(false);
    expect(JSON.parse(readFileSync(path.join(f.root, ".spark/release-workflow.json"), "utf8")).complete).not.toBe(true);
  } finally { f.cleanup(); }
});

test("finish requires a committed candidate and retains its saved channels", async () => {
  const f = fixture();
  try {
    await expect(f.finish()).rejects.toThrow("No release to finish");
    f.setFailures(true, false, false);
    await expect(f.release()).rejects.toThrow();
    await expect(f.finish()).rejects.toThrow("no committed candidate");
    f.setFailures(false, false, true);
    await expect(f.release(true)).rejects.toThrow();
    await expect(f.finish(f.execute, true)).rejects.toThrow("without --latest");
    expect(await f.finish()).toBe(0);
    expect(f.tags.latest).toBe("0.0.1-next.2");
  } finally { f.cleanup(); }
});

test("release version edits preserve a real frozen Bun workspace lockfile", () => {
  const f = fixture();
  try {
    f.write("package.json", JSON.stringify({ name: "spark-workspace", private: true, version: "0.0.1-next.2", workspaces: ["packages/*"], devDependencies: { "@legendapp/spark": "0.0.1-next.2" } }));
    f.write("packages/desktop/package.json", JSON.stringify({ name: "@legendapp/spark", version: "0.0.1-next.2" }));
    rmSync(path.join(f.root, "bun.lock"));
    const install = (...extra: string[]) => {
      const result = spawnSync("bun", ["install", "--lockfile-only", "--ignore-scripts", ...extra], { cwd: f.root, encoding: "utf8" });
      expect(result.status, result.stdout + result.stderr).toBe(0);
    };
    install();
    applyVersionEdits(f.root, versionEdits(f.root, ["package.json", "packages/desktop/package.json", "bun.lock", "packages/cli/src/project.ts"], "0.0.1-next.2", "0.0.1-next.3", ""));
    const lock = readFileSync(path.join(f.root, "bun.lock"), "utf8");
    expect(lock).toContain('"@legendapp/spark": "0.0.1-next.3"');
    install("--frozen-lockfile");
    expect(readFileSync(path.join(f.root, "bun.lock"), "utf8")).toBe(lock);
  } finally { f.cleanup(); }
});

test("automatic continuation preserves a next-only channel selection", async () => {
  const f = fixture();
  try {
    f.setFailures(false, true, false);
    expect(await f.release()).toBe(2);
    await expect(f.release(false, true)).rejects.toThrow("Retry without --latest");
    expect(await f.release()).toBe(0);
    expect(f.tags).toEqual({ next: "0.0.1-next.3", latest: "0.0.1-next.2" });
    expect(f.commands.filter(args => args[0] === "git" && args[1] === "commit")).toHaveLength(1);
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

test.each(["", " — preview"])("GitHub notes match the exact selected heading with suffix '%s'", suffix => {
  const changelog = `# Changelog\n\n## 0.0.1-next.50 — preview\n\nFuture fixes.\n\n## 0.0.1-next.5${suffix}\n\nHand-written fixes.\n\n## 0.0.1-next.4 — preview\n\nOld fixes.\n`;
  expect(releaseNotes(changelog, "0.0.1-next.5")).toBe("Hand-written fixes.");
  expect(releaseNotes(changelog, "0.0.1-next.4")).toBe("Old fixes.");
  expect(changelogSection(changelog.replace(`## 0.0.1-next.5${suffix}\n`, ""), "0.0.1-next.5")).toBeUndefined();
  expect(changelogSection(changelog.replaceAll("0.0.1-next.5", "0x0x1-nextx5"), "0.0.1-next.5")).toBeUndefined();
  expect(() => releaseNotes(changelog, "0.0.1-next.6")).toThrow("Missing changelog notes for 0.0.1-next.6");
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
    expect(await alreadyPublished(metadata.version, archive, async argv => {
      expect(argv[2]).toBe("@legendapp/create-spark@0.0.1-next.3");
      return { code: 0, output: JSON.stringify(metadata) };
    }, "@legendapp/create-spark")).toBe(true);
    expect(await alreadyPublished(metadata.version, archive, async () => ({ code: 1, output: "npm error E404" }))).toBe(false);
    await expect(alreadyPublished(metadata.version, archive, async () => ({ code: 1, output: "E401 Unauthorized" }))).rejects.toThrow("E401 Unauthorized");
    writeFileSync(archive, "different bytes");
    await expect(alreadyPublished(metadata.version, archive, async () => ({ code: 0, output: JSON.stringify(metadata) }))).rejects.toThrow("different bytes");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("missing reviewed upgrade notes stop before build or version writes", async () => {
  const f = fixture();
  try {
    f.write("packages/desktop/skills/spark/UPGRADING.md", "# Upgrading Spark apps\n\n## 0.0.1-next.2\n\nBaseline.\n");
    f.git("add", "packages/desktop/skills/spark/UPGRADING.md"); f.git("commit", "-m", "Prepare notes fixture");
    await expect(f.release()).rejects.toThrow("Missing UPGRADING.md section for 0.0.1-next.3");
    expect(JSON.parse(readFileSync(path.join(f.root, "package.json"), "utf8")).version).toBe("0.0.1-next.2");
    expect(f.commands.some(args => args[1] === "install" || args.includes("release:runner") || args.includes("release:publish"))).toBe(false);
  } finally { f.cleanup(); }
});

test("publish-only resume verifies staged artifacts and never consults signing or builds", async () => {
  const f = fixture();
  try {
    await expect(releaseWorkflow(f.root, { resume: false, latest: false, resumeFrom: "publish" }, f.execute, async () => { throw new Error("Signing must not run"); }, () => { throw new Error("Runner must not run"); })).rejects.toThrow("No committed release");
    f.setFailures(false, false, true);
    await expect(f.release()).rejects.toThrow("Promotion interrupted");
    const stateFile = path.join(f.root, ".spark/release-workflow.json");
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    // The build completed, but its publication checkpoint was lost.
    delete state.publicationReady; writeFileSync(stateFile, JSON.stringify(state));
    const before = f.commands.length;
    expect(await releaseWorkflow(f.root, { resume: false, latest: false, resumeFrom: "publish" }, f.execute, async () => { throw new Error("Signing must not run"); }, () => { throw new Error("Runner must not run"); })).toBe(0);
    const commands = f.commands.slice(before);
    expect(commands.some(args => args[1] === "install" || args.includes("release:runner") || args[1] === "push")).toBe(false);
    expect(commands.filter(args => args.includes("release:publish"))).toHaveLength(1);
    f.write(`artifacts/releases/${state.version}/create-spark.tgz`, "tampered");
    await expect(releaseWorkflow(f.root, { resume: false, latest: false, resumeFrom: "publish" }, f.execute, async () => {}, () => "")).rejects.toThrow("Release artifact changed");
  } finally { f.cleanup(); }
});
