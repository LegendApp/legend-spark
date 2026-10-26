import { CommandError, releaseCommand } from "../packages/cli/src/errors.ts";
import { loadReleaseEnv } from "./release-env.ts";
import { spawnProcess } from "../packages/cli/src/process.ts";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { run } from "../packages/cli/src/commands.ts";
import { readJson, VERSION } from "../packages/cli/src/project.ts";
import { alreadyPublished, latestChannel, publishedPackages, publishAndWait, releaseNotes, waitForReleaseTags, verifyCreatorArchive, requireNpmTerminal } from "./npm-release.ts";

const root = path.resolve(import.meta.dirname, "..");
await releaseCommand(root, async () => {
  const args = process.argv.slice(2);
  if (args.some(arg => !["--latest", "--next"].includes(arg))) throw new Error("Usage: bun run release:publish [--latest | --next]");
  const latest = latestChannel(VERSION, { latest: args.includes("--latest"), next: args.includes("--next") });
  const releaseFlags = VERSION.includes("-") ? ["--prerelease", "--latest=false"] : ["--prerelease=false", "--latest"];
  loadReleaseEnv(root);
  const folder = path.join(root, "artifacts/releases", VERSION);
  const release = readJson(path.join(folder, "release.json"));
  const revision = (await run(root, ["git", "rev-parse", "HEAD"], { capture: true })).trim();
  if (release.version !== VERSION || release.revision !== revision || (await run(root, ["git", "status", "--porcelain"], { capture: true })).trim()) throw new Error("Publishing requires the clean source revision used to assemble this release.");
  for (const [name, hash] of Object.entries(release.sha256)) {
    if (path.basename(name) !== name || createHash("sha256").update(readFileSync(path.join(folder, name))).digest("hex") !== hash) throw new Error(`Release artifact changed: ${name}`);
  }
  if (!release.sha256[release.npm] || !release.sha256[release.createNpm] || !release.sha256["runner-manifest.json"]) throw new Error("Incomplete release artifact manifest");
  verifyCreatorArchive(root, VERSION, path.join(folder, release.createNpm));
  requireNpmTerminal();
  console.log("\n========== npm browser authentication ==========\nFollow the npm authentication URL printed in this terminal. Keep stdout attached to the terminal.\n===============================================\n");
  const repo = "LegendApp/legend-spark", tag = `v${VERSION}`;
  const repository = JSON.parse(await run(root, ["gh", "repo", "view", repo, "--json", "visibility"], { capture: true }));
  if (repository.visibility !== "PUBLIC") throw new Error("Runner downloads require a public distribution repository. Do not publish npm while release assets are private.");
  await run(root, ["gh", "auth", "status"], { capture: true });
  await run(root, ["npm", "whoami"], { capture: true });
  const archives = [release.npm, release.createNpm].map(file => path.join(folder, file));
  const registryCommand = async (argv: string[]) => {
    const child = spawnProcess(argv, { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout!).text(), new Response(child.stderr!).text()]);
    return { code, output: code ? out + err : out };
  };
  const published = [];
  for (const [index, name] of publishedPackages.entries()) published.push(await alreadyPublished(VERSION, archives[index]!, registryCommand, name));
  // main is pushed only after npm, so it must still fast-forward then. Once npm is
  // live, a resume continues regardless and the push below handles a moved main.
  if (published.includes(false)) {
    await run(root, ["git", "fetch", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
    try { await run(root, ["git", "merge-base", "--is-ancestor", "refs/remotes/origin/main", "HEAD"], { capture: true }); }
    catch { throw new Error("origin/main has commits this release lacks. Nothing was published; rebase the release onto origin/main and prepare it again."); }
  }
  // Nothing becomes public before npm has both packages: the release stays a draft and
  // main and the tag stay local until then. Never overwrite assets or move existing tags;
  // a retry verifies the existing release and every asset before continuing.
  let existing: any;
  try { existing = JSON.parse(await run(root, ["gh", "release", "view", tag, "--repo", repo, "--json", "isDraft,assets"], { capture: true })); }
  catch {
    const notes = path.join(folder, "release-notes.md");
    writeFileSync(notes, releaseNotes(readFileSync(path.join(root, "CHANGELOG.md"), "utf8"), VERSION) + "\n\nRequires Node 24.19.0 or newer. Runner downloads automatically on first desktop launch.\n");
    await run(root, ["gh", "release", "create", tag, "--repo", repo, "--target", "main", "--draft", ...releaseFlags, "--title", `Spark ${VERSION}`, "--notes-file", notes]);
    await run(root, ["gh", "release", "upload", tag, "--repo", repo, ...Object.keys(release.sha256).map(name => path.join(folder, name)), path.join(folder, "checksums.txt"), path.join(folder, "release.json")]);
    existing = { isDraft: true };
  }
  // Read authenticated GitHub assets while draft; verify bytes before making URLs public.
  // The tag endpoint omits drafts, so only a draft falls back to listing releases.
  let uploaded: any;
  try { uploaded = JSON.parse(await run(root, ["gh", "api", `repos/${repo}/releases/tags/${tag}`], { capture: true })); }
  catch { uploaded = JSON.parse(await run(root, ["gh", "api", `repos/${repo}/releases`, "--paginate", "--slurp"], { capture: true })).flat().find((item: any) => item.tag_name === tag); }
  if (!uploaded) throw new Error("Uploaded release could not be found");
  let assets = uploaded.assets;
  if (uploaded.draft) {
    const missing = [...Object.keys(release.sha256), "checksums.txt", "release.json"].filter(name => !assets.some((asset: any) => asset.name === name));
    if (missing.length) {
      await run(root, ["gh", "release", "upload", tag, "--repo", repo, ...missing.map(name => path.join(folder, name))]);
      assets = JSON.parse(await run(root, ["gh", "api", `repos/${repo}/releases/${uploaded.id}`], { capture: true })).assets;
    }
  }
  for (const [name, expected] of Object.entries(release.sha256)) {
    const asset = assets.find((item: any) => item.name === name);
    if (!asset || asset.digest !== `sha256:${expected}`) throw new Error(`GitHub asset is missing or has a different digest: ${name}. Preserve the release and repair the upload explicitly.`);
  }
  // npm web authentication needs the terminal; piping output disables its prompt.
  // Publish straight to the release channel: the SDK moves before the creator that pins it.
  for (const [index, name] of publishedPackages.entries()) {
    const archive = archives[index]!;
    await publishAndWait(root, { name, version: VERSION, revision, archive, published: published[index]! }, registryCommand, async () => {
      const publish = spawnProcess(["npm", "publish", archive, "--access", "public", "--tag", latest ? "latest" : "next"], { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
      const publishCode = await publish.exited;
      if (publishCode) throw new Error(`npm publish ${name} exited ${publishCode}`);
    });
    // Repairs the channel when a resumed publication found the version already published.
    const channel = latest ? "latest" : "next";
    const argv = ["npm", "view", name, "dist-tags", "--json", "--prefer-online"];
    const result = await registryCommand(argv);
    if (result.code && !/\bE404\b/.test(result.output)) throw new CommandError(argv, result.code, result.output);
    const tags = result.code ? {} : JSON.parse(result.output);
    if (tags[channel] !== VERSION) {
      const promote = spawnProcess(["npm", "dist-tag", "add", `${name}@${VERSION}`, channel], { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
      if (await promote.exited) throw new Error(`npm ${name} ${channel} tag failed; retry with the same release artifacts`);
    }
    await waitForReleaseTags(VERSION, latest, registryCommand, undefined, name);
  }
  // If main moved after npm went live, still publish the tag and release so Runner
  // downloads work, then leave main to the maintainer.
  let mainPushed = true;
  try { await run(root, ["git", "push", "--atomic", "origin", "HEAD:refs/heads/main", `refs/tags/${tag}`]); }
  catch (error) {
    // Only a main that no longer fast-forwards falls back to a tag-only push.
    await run(root, ["git", "fetch", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
    try { await run(root, ["git", "merge-base", "--is-ancestor", "refs/remotes/origin/main", "HEAD"], { capture: true }); }
    catch { mainPushed = false; }
    if (mainPushed) throw new Error(`npm has ${VERSION}, but pushing main and ${tag} failed while origin/main still fast-forwards. Fix the cause and run bun run release --resume.\n${error instanceof Error ? error.message : error}`);
    await run(root, ["git", "push", "origin", `refs/tags/${tag}`]);
  }
  const ref = JSON.parse(await run(root, ["gh", "api", `repos/${repo}/git/ref/tags/${tag}`], { capture: true }));
  let commit = ref.object;
  if (commit.type === "tag") commit = JSON.parse(await run(root, ["gh", "api", `repos/${repo}/git/tags/${commit.sha}`], { capture: true })).object;
  if (commit.type !== "commit" || commit.sha !== revision) throw new Error("Release tag does not point at the staged source revision");
  if (existing.isDraft) await run(root, ["gh", "release", "edit", tag, "--repo", repo, "--draft=false", ...releaseFlags]);
  if (!mainPushed) throw new Error(`Published ${tag}, but origin/main moved and was not updated. Rebase the release commit onto origin/main and push main: git pull --rebase origin main && git push origin HEAD:main. Then run bun run release --finish to close the release.`);
  console.log(`Published ${tag} under ${latest ? "latest" : "next"}. Native UI and clean-machine Runner acceptance remain separate evidence.`);
});
