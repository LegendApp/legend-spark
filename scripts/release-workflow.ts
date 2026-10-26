import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeJson } from "../packages/cli/src/project.ts";
import { CommandError } from "../packages/cli/src/errors.ts";
import { alreadyPublished, changelogSection, latestChannel, publishedPackages, publishAndWait, waitForReleaseTags, verifyCreatorArchive } from "./npm-release.ts";

type Edit = { file: string; before: string; after: string };
type State = { schema: 1; version: string; baseRevision: string; revision?: string; latest: boolean; edits: Edit[]; publicationReady?: boolean; complete?: boolean };
export type Execute = (argv: string[], capture?: boolean) => Promise<{ code: number; output: string }>;
const repository = "LegendApp/legend-spark";

// Git tree of the working tree as it is now (tracked and untracked, honouring .gitignore),
// written through a throwaway index so the real index is untouched.
export function workingTreeHash(root: string) {
  const folder = mkdtempSync(path.join(os.tmpdir(), "spark-release-index-"));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: path.join(folder, "index") };
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: root, env, encoding: "utf8" });
      if (result.status) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
      return result.stdout.trim();
    };
    git("read-tree", "HEAD");
    git("add", "-A");
    return git("write-tree");
  } finally { rmSync(folder, { recursive: true, force: true }); }
}

const testPassFile = (root: string) => path.join(root, ".spark/release-tests-passed.json");

// typecheck + the full test suite verify source, not shipped bits: skip them when this exact
// tree already passed (or when explicitly asked). bun install, packing, building, signing and
// the packed-consumer check always run.
export function testSkipReason(root: string, tree: string, skipTests?: boolean) {
  if (skipTests) return "--skip-tests was passed";
  if (!existsSync(testPassFile(root))) return undefined;
  const marker = JSON.parse(readFileSync(testPassFile(root), "utf8"));
  return marker.tree === tree ? `tree ${tree.slice(0, 12)} already passed typecheck and tests at ${marker.at}` : undefined;
}

export function recordTestPass(root: string, tree: string) {
  writeJson(testPassFile(root), { tree, at: new Date().toISOString() });
}

export function signingProject(root: string) {
  const project = path.join(root, ".spark/release-signing");
  mkdirSync(project, { recursive: true });
  writeJson(path.join(project, "app.json"), { expo: { name: "Spark release signing", slug: "spark-release-signing", platforms: ["macos"] } });
  return project;
}

export function releaseTarget(current: string, published: string[]) {
  const match = /^(\d+\.\d+\.\d+)(?:-next\.(\d+))?$/.exec(current);
  if (!match) throw new Error(`Expected a stable or next preview version, received ${current}`);
  const prefix = `${match[1]}-next.`;
  const numbers = published.filter(value => value.startsWith(prefix) && /^\d+$/.test(value.slice(prefix.length))).map(value => Number(value.slice(prefix.length)));
  const latest = Math.max(...numbers);
  if (published.includes(current)) {
    if (match[2] === undefined) throw new Error(`Stable version ${current} is already published; select a new version`);
    return { version: `${prefix}${latest + 1}`, previous: `v${current}` };
  }
  if (match[2] !== undefined && latest > Number(match[2])) throw new Error(`A higher ${prefix} version is already published; cannot release ${current}`);
  if (!numbers.length) throw new Error(`No previous published ${prefix} version below ${current}`);
  return { version: current, previous: `v${prefix}${latest}` };
}

function requireUpgradeNotes(root: string, version: string) {
  const upgradeNotes = readFileSync(path.join(root, "packages/desktop/skills/spark/UPGRADING.md"), "utf8");
  if (changelogSection(upgradeNotes, version) === undefined) throw new Error(`Missing UPGRADING.md section for ${version}. Add reviewed app upgrade notes (and a migration for breaking changes) before building this release.`);
}

export function versionEdits(root: string, files: string[], current: string, version: string, notes: string): Edit[] {
  requireUpgradeNotes(root, version);
  const edits: Edit[] = [];
  for (const file of files) {
    const before = readFileSync(path.join(root, file), "utf8");
    let after = before;
    if (file.endsWith("package.json") || file === "bun.lock") after = before.replaceAll(JSON.stringify(current), JSON.stringify(version));
    else if (file === "packages/cli/src/project.ts") {
      const declaration = `export const VERSION = ${JSON.stringify(current)};`;
      if (!before.includes(declaration)) throw new Error("CLI version does not match the workspace version");
      after = before.replace(declaration, `export const VERSION = ${JSON.stringify(version)};`);
    } else if (file === "docs/release-support-matrix.json") {
      const matrix = JSON.parse(before);
      if (matrix.version !== current) throw new Error("Release support matrix version does not match the workspace version");
      matrix.version = version;
      if (version !== current) after = JSON.stringify(matrix, null, 2) + "\n";
    } else if (file === "docs/release-support-matrix.md") {
      const declaration = `Package: \`@legendapp/spark@${current}\``;
      if (!before.includes(declaration)) throw new Error("Release support matrix documentation does not match the workspace version");
      after = before.replace(declaration, `Package: \`@legendapp/spark@${version}\``);
    } else if (file === "docs/releases.md") after = before.replace(`identifies itself as \`${current}\``, `identifies itself as \`${version}\``);
    else if (file === "CHANGELOG.md") {
      if (changelogSection(before, version) !== undefined) continue;
      if (!before.startsWith("# Changelog\n")) throw new Error("Unrecognized changelog format");
      after = before.replace("# Changelog\n", `# Changelog\n\n## ${version}${version.includes("-") ? " — preview" : ""}\n\nmacOS 14+ (Apple Silicon) supported; Windows preview, not yet verified\n\n${notes.trim()}\n`);
    }
    if (after !== before) edits.push({ file, before, after });
  }
  if (version !== current && (!edits.some(edit => edit.file === "package.json") || !edits.some(edit => edit.file === "packages/cli/src/project.ts"))) throw new Error("Incomplete release version inputs");
  return edits;
}

export function applyVersionEdits(root: string, edits: Edit[]) {
  // Check every file before writing any: a retry may see a partially applied bump.
  for (const edit of edits) {
    const actual = readFileSync(path.join(root, edit.file), "utf8");
    if (actual !== edit.before && actual !== edit.after) throw new Error(`Release input changed: ${edit.file}. Preserve your edits and resolve before resuming.`);
  }
  for (const edit of edits) if (readFileSync(path.join(root, edit.file), "utf8") !== edit.after) writeFileSync(path.join(root, edit.file), edit.after);
}

export function verifyReleaseArchive(root: string, version: string, revision: string) {
  const folder = path.join(root, "artifacts/releases", version);
  const release = JSON.parse(readFileSync(path.join(folder, "release.json"), "utf8"));
  if (release.version !== version || release.revision !== revision || !release.sha256?.[release.npm] || !release.sha256[release.createNpm] || !release.sha256["runner-manifest.json"]) throw new Error("Release artifacts do not match the selected version and source");
  for (const [name, expected] of Object.entries(release.sha256)) {
    if (path.basename(name) !== name || createHash("sha256").update(readFileSync(path.join(folder, name))).digest("hex") !== expected) throw new Error(`Release artifact changed: ${name}`);
  }
  verifyCreatorArchive(root, version, path.join(folder, release.createNpm));
  return path.join(folder, release.npm);
}

async function finishRelease(root: string, state: State, execute: Execute) {
  if (!state.revision) throw new Error("This release has no committed candidate to finish. Run bun run release --resume.");
  verifyReleaseArchive(root, state.version, state.revision);
  const release = JSON.parse(readFileSync(path.join(root, "artifacts/releases", state.version, "release.json"), "utf8"));
  const run = async (argv: string[], capture = true) => {
    const result = await execute(argv, capture);
    if (result.code) throw new CommandError(argv, result.code, result.output);
    return result.output.trim();
  };
  const remote = await run(["git", "remote", "get-url", "origin"]);
  if (!/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)LegendApp\/legend-spark(?:\.git)?$/i.test(remote)) throw new Error("origin must be the public LegendApp/legend-spark repository");
  if (JSON.parse(await run(["gh", "repo", "view", repository, "--json", "visibility"])).visibility !== "PUBLIC") throw new Error("Release distribution requires the public LegendApp/legend-spark repository");
  await run(["gh", "auth", "status"]);
  await run(["npm", "whoami"]);
  const tag = `v${state.version}`;
  const ref = JSON.parse(await run(["gh", "api", `repos/${repository}/git/ref/tags/${tag}`]));
  let commit = ref.object;
  if (commit.type === "tag") commit = JSON.parse(await run(["gh", "api", `repos/${repository}/git/tags/${commit.sha}`])).object;
  if (commit.type !== "commit" || commit.sha !== state.revision) throw new Error("Release tag does not point at the staged source revision");
  const uploaded = JSON.parse(await run(["gh", "api", `repos/${repository}/releases/tags/${tag}`]));
  if (uploaded.draft || uploaded.tag_name !== tag) throw new Error("The GitHub release is not published yet. Run bun run release --resume.");
  for (const [name, expected] of Object.entries(release.sha256)) {
    const asset = uploaded.assets.find((item: any) => item.name === name);
    if (!asset || asset.digest !== `sha256:${expected}`) throw new Error(`GitHub asset is missing or has a different digest: ${name}. Preserve the release and repair the upload explicitly.`);
  }
  const channel = state.latest ? "latest" : "next";
  console.log(`Finishing ${state.version} under ${channel}; using its existing published artifacts.`);
  const folder = path.join(root, "artifacts/releases", state.version);
  const archives = [release.npm, release.createNpm].map(file => path.join(folder, file));
  for (const [index, name] of publishedPackages.entries()) {
    const archive = archives[index]!;
    const published = await alreadyPublished(state.version, archive, execute, name);
    await publishAndWait(root, { name, version: state.version, revision: state.revision, archive, published }, execute, async () => {
      throw new Error(`npm publication of ${name} is not available and no successful submission is recorded. Run bun run release --resume to continue publication.`);
    });
  }
  // Promotion uses the verified candidate rather than the checkout's newer drafts.
  verifyReleaseArchive(root, state.version, state.revision);
  for (const name of publishedPackages) {
    const tags = JSON.parse(await run(["npm", "view", name, "dist-tags", "--json", "--prefer-online"]));
    if (tags[channel] !== state.version) await run(["npm", "dist-tag", "add", `${name}@${state.version}`, channel], false);
    await waitForReleaseTags(state.version, state.latest, execute, undefined, name);
  }
  state.complete = true;
  writeJson(path.join(root, ".spark/release-workflow.json"), state);
  console.log(`Released ${state.version}. Native UI and clean-recipient Runner acceptance must still be recorded separately.`);
}

export async function releaseWorkflow(root: string, options: { resume: boolean; latest: boolean; stable?: boolean; next?: boolean; finish?: boolean; resumeFrom?: "publish"; skipTests?: boolean }, execute: Execute, preflight: () => Promise<void>, runnerProject: (version: string) => string) {
  const stateFile = path.join(root, ".spark/release-workflow.json");
  const run = async (argv: string[], capture = false) => {
    const result = await execute(argv, capture);
    if (result.code) throw new CommandError(argv, result.code, result.output);
    return result.output.trim();
  };
  const git = (...args: string[]) => run(["git", ...args], true);
  const clean = async () => { if (await git("status", "--porcelain")) throw new Error("Release requires a clean checkout. Commit or move drafts before retrying; the script never stashes them."); };
  const previous: State | undefined = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : undefined;
  if (previous && previous.schema !== 1) throw new Error("Unsupported release workflow state");
  // A resumed release keeps its saved channel; an override must not contradict it.
  const sameChannel = (saved: State) => {
    if (options.stable && saved.version.includes("-")) throw new Error("Cannot promote an unfinished preview release. Finish it before starting a stable release.");
    const flag = options.latest && !saved.latest ? "--latest" : options.next && saved.latest ? "--next" : undefined;
    if (flag) throw new Error(`Resume the original channel selection; this release was started for ${saved.latest ? "latest" : "next"}. Retry without ${flag}.`);
  };
  if (options.resumeFrom === "publish") {
    if (!previous?.revision) throw new Error("No committed release to resume from publish; preserve the workflow state and staged artifacts.");
    sameChannel(previous);
    if (await git("rev-parse", "HEAD") !== previous.revision) throw new Error("Source revision changed since this release started");
    await clean();
    verifyReleaseArchive(root, previous.version, previous.revision);
    await run(["bun", "run", "release:publish", previous.latest ? "--latest" : "--next"]);
    for (const name of publishedPackages) await waitForReleaseTags(previous.version, previous.latest, execute, undefined, name);
    previous.complete = true;
    writeJson(stateFile, previous);
  } else if (options.finish) {
    if (!previous) throw new Error("No release to finish. Run bun run release to start a candidate.");
    sameChannel(previous);
    await finishRelease(root, previous, execute);
  } else {
    const revision = await git("rev-parse", "HEAD");
    const resume = options.resume || Boolean(previous && !previous.complete);
    if (!options.resume && resume) console.log(`Continuing unfinished release ${previous!.version} with its original channels.`);
    if (options.resume && !previous) throw new Error("No release to resume");
    if (await git("branch", "--show-current") !== "main") throw new Error("Run the release from main");
    if (!resume) await clean();
    if (resume) sameChannel(previous!);
    if (!previous?.publicationReady || !resume) await preflight();
    const remote = await git("remote", "get-url", "origin");
    if (!/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)LegendApp\/legend-spark(?:\.git)?$/i.test(remote)) throw new Error("origin must be the public LegendApp/legend-spark repository");
    const visibility = JSON.parse(await run(["gh", "repo", "view", repository, "--json", "visibility"], true));
    if (visibility.visibility !== "PUBLIC") throw new Error("Release distribution requires the public LegendApp/legend-spark repository");
    await run(["gh", "auth", "status"], true);
    await run(["npm", "whoami"], true);
    await git("fetch", "origin", "main", "--tags");
    await git("merge-base", "--is-ancestor", "origin/main", "HEAD");
    let state = resume ? previous! : undefined;
    if (!state) {
      const current = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version as string;
      const versions = JSON.parse(await run(["npm", "view", "@legendapp/spark", "versions", "--json"], true));
      const { version, previous: tag } = releaseTarget(options.stable ? current.replace(/-next\.\d+$/, "") : current, Array.isArray(versions) ? versions : [versions]);
      let notes = changelogSection(readFileSync(path.join(root, "CHANGELOG.md"), "utf8"), version);
      if (notes === undefined) {
        const hasTag = await execute(["git", "rev-parse", "--verify", `refs/tags/${tag}`], true);
        if (hasTag.code) throw new Error(`Missing previous release tag ${tag}; cannot generate release notes`);
        notes = (await git("log", "--no-merges", "--format=- %s", `${tag}..HEAD`)).split("\n").filter(line => !/^- (?:Revert\b|release(?:\([^)]*\))?:)/i.test(line)).join("\n");
        if (!notes) throw new Error("No new committed changes since the previous release");
      }
      const files = (await git("ls-files", "-z")).split("\0").filter(file => file.endsWith("package.json") || ["bun.lock", "packages/cli/src/project.ts", "CHANGELOG.md", "docs/releases.md", "docs/release-support-matrix.json", "docs/release-support-matrix.md"].includes(file));
      const edits = versionEdits(root, files, current, version, notes);
      state = { schema: 1, version, baseRevision: revision, revision: edits.length ? undefined : revision, latest: latestChannel(version, options), edits };
      writeJson(stateFile, state);
    }
    console.log(`Releasing ${state.version} under ${state.latest ? "latest" : "next"}.`);
    if (state.revision) {
      if (state.revision !== revision) throw new Error("Source revision changed since this release started; preserve its artifacts and start a new candidate");
      await clean();
    } else {
      if (revision !== state.baseRevision) {
        // Recover a commit completed just before the process lost its checkpoint.
        if (await git("rev-parse", "HEAD^") !== state.baseRevision) throw new Error("Source changed while preparing the release");
        const changed = (await git("diff", "--name-only", state.baseRevision, "HEAD")).split("\n").sort();
        if (JSON.stringify(changed) !== JSON.stringify(state.edits.map(edit => edit.file).sort())) throw new Error("Unexpected changes in release commit");
        for (const edit of state.edits) if (await git("show", `HEAD:${edit.file}`) !== edit.after.trim()) throw new Error(`Unexpected release commit content: ${edit.file}`);
        await clean();
        state.revision = revision;
        writeJson(stateFile, state);
      } else {
        const changed = (await git("diff", "--name-only", "HEAD")).split("\n").filter(Boolean);
        const untracked = await git("ls-files", "--others", "--exclude-standard");
        if (untracked || changed.some(file => !state!.edits.some(edit => edit.file === file))) throw new Error("Unrelated working-tree changes appeared during release preparation");
        applyVersionEdits(root, state.edits);
      }
    }
    if (JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version !== state.version) throw new Error("Workspace version changed during release");
    if (!state.complete) {
      if (!state.publicationReady) {
        requireUpgradeNotes(root, state.version);
        await run(["bun", "install", "--frozen-lockfile"]);
        const tree = workingTreeHash(root);
        const skip = testSkipReason(root, tree, options.skipTests);
        if (skip) console.log(`Skipping typecheck and the full test suite: ${skip}.`);
        else {
          await run(["bun", "run", "typecheck"]);
          await run(["bun", "run", "test"]);
          recordTestPass(root, tree);
        }
        if (!state.revision) {
          const changed = (await git("diff", "--name-only", "HEAD")).split("\n").sort();
          if (JSON.stringify(changed) !== JSON.stringify(state.edits.map(edit => edit.file).sort()) || await git("ls-files", "--others", "--exclude-standard")) throw new Error("Verification changed release source unexpectedly");
          for (const edit of state.edits) if (readFileSync(path.join(root, edit.file), "utf8") !== edit.after) throw new Error(`Verification changed ${edit.file}`);
          await git("add", "--", ...state.edits.map(edit => edit.file));
          await git("commit", "-m", `release: prepare ${state.version}`);
          state.revision = await git("rev-parse", "HEAD");
          writeJson(stateFile, state);
        }
        await clean();
        const staged = path.join(root, "artifacts/releases", state.version, "release.json");
        if (!existsSync(staged)) {
          const built = path.join(runnerProject(state.version), ".spark/go-build.json");
          const resume = existsSync(built) && JSON.parse(readFileSync(built, "utf8")).runtime?.sourceRevision === state.revision;
          const runner = await execute(["bun", "run", "release:runner", ...(resume ? ["--resume"] : [])]);
          if (runner.code === 2) { console.log("Apple is still processing. Run bun run release --resume to continue the same release."); return 2; }
          if (runner.code) throw new Error(`Runner build/signing exited ${runner.code}`);
        }
        const archive = verifyReleaseArchive(root, state.version, state.revision!);
        await run([process.execPath, "tests/packed-consumer.integration.ts", "--archive", archive]);
        verifyReleaseArchive(root, state.version, state.revision!);
        await clean();
        if (await git("rev-parse", "HEAD") !== state.revision) throw new Error("Release source changed during artifact verification");
        const tag = `v${state.version}`;
        const existingTag = await execute(["git", "rev-parse", "--verify", `refs/tags/${tag}^{commit}`], true);
        if (!existingTag.code && existingTag.output.trim() !== state.revision) throw new Error(`${tag} already points at another source revision`);
        if (existingTag.code) await git("tag", tag, state.revision!);
        await git("push", "--atomic", "origin", "HEAD:refs/heads/main", `refs/tags/${tag}`);
        state.publicationReady = true;
        writeJson(stateFile, state);
      }
      verifyReleaseArchive(root, state.version, state.revision!);
      await run(["bun", "run", "release:publish", state.latest ? "--latest" : "--next"]);
    }
    for (const name of publishedPackages) await waitForReleaseTags(state.version, state.latest, execute, undefined, name);
    state.complete = true;
    writeJson(stateFile, state);
    console.log(`Released ${state.version}. Native UI and clean-recipient Runner acceptance must still be recorded separately.`);
  }
  return 0;
}
