import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type { Execute } from "./release-workflow.ts";
import { CommandError, isNetworkError } from "../packages/cli/src/errors.ts";
import { readJson, writeJson } from "../packages/cli/src/project.ts";

const pollInterval = 15_000;
const waitForNextCheck = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
type Wait = typeof waitForNextCheck;
const archiveIntegrity = (archive: string) => `sha512-${createHash("sha512").update(readFileSync(archive)).digest("base64")}`;

export function changelogSection(changelog: string, version: string): string | undefined {
  const heading = new RegExp(`^## ${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: — preview)?$`, "m").exec(changelog);
  if (!heading) return undefined;
  const start = heading.index + heading[0].length;
  const end = changelog.indexOf("\n## ", start);
  return changelog.slice(start, end < 0 ? undefined : end).trim();
}

export function releaseNotes(changelog: string, version: string) {
  const notes = changelogSection(changelog, version);
  if (notes === undefined) throw new Error(`Missing changelog notes for ${version}`);
  return notes;
}

export const publishedPackages = ["@legendapp/spark", "@legendapp/create-spark"] as const;

// Each release moves exactly one dist-tag: latest for a stable version, next for a
// prerelease. --latest or --next overrides the default; true means latest.
export function latestChannel(version: string, options: { latest?: boolean; next?: boolean }) {
  if (options.latest && options.next) throw new Error("Choose either --latest or --next");
  return options.latest || (!options.next && !/^\d+\.\d+\.\d+-/.test(version));
}

export function requireNpmTerminal(stdin: Pick<NodeJS.ReadStream, "isTTY"> = process.stdin, stdout: Pick<NodeJS.WriteStream, "isTTY"> = process.stdout) {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error("npm publish/dist-tag requires both stdin and stdout to be TTYs for browser authentication. Run in a terminal without piping through tee; resume with bun run release --resume-from publish.");
}

export function verifyCreatorArchive(root: string, version: string, archive: string) {
  const folder = path.join(realpathSync(root), "artifacts/releases", version);
  if (path.dirname(realpathSync(archive)) !== folder) throw new Error(`Refusing to publish create-spark: archive must be under ${folder}/, not artifacts/packages or another directory.`);
  const read = (file: string) => {
    try { return JSON.parse(execFileSync("tar", ["-xOzf", archive, `package/${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024 })); }
    catch { throw new Error(`Refusing to publish create-spark: tarball lacks valid ${file}. Reassemble the release; dev packs cannot be published.`); }
  };
  const manifest = read("package.json");
  const release = read("dist/release.json");
  if (manifest?.name !== "@legendapp/create-spark" || manifest?.version !== version || release?.version !== version) throw new Error(`Refusing to publish create-spark: package version ${manifest?.version} and dist/release.json version ${release?.version} must match SDK ${version}.`);
}

export async function alreadyPublished(version: string, archive: string, execute: Execute, name = "@legendapp/spark") {
  const argv = ["npm", "view", `${name}@${version}`, "version", "dist.integrity", "--json", "--prefer-online", "--fetch-retries=0", "--fetch-timeout=15000"];
  const result = await execute(argv, true);
  if (result.code) {
    if (/\bE404\b/.test(result.output)) return false;
    throw new CommandError(argv, result.code, result.output);
  }
  const metadata = JSON.parse(result.output);
  const integrity = archiveIntegrity(archive);
  if (metadata.version !== version || metadata["dist.integrity"] !== integrity) throw new Error(`npm ${name}@${version} contains different bytes. Never overwrite it; prepare a new version.`);
  return true;
}

export async function waitForPublication(version: string, archive: string, execute: Execute, wait: Wait = waitForNextCheck, name = "@legendapp/spark") {
  let available = false;
  while (!available) {
    try { available = await alreadyPublished(version, archive, execute, name); }
    catch (error) {
      if (!isNetworkError(error)) throw error;
      console.log("Could not reach npm. Retrying the availability check in 15s.");
    }
    if (!available) {
      console.log(`Waiting for npm to make ${name}@${version} available. Checking again in 15s; Ctrl+C pauses this release.`);
      await wait(pollInterval);
    }
  }
  console.log(`npm publication verified: ${name}@${version}.`);
}

export async function publishAndWait(root: string, release: { version: string; revision: string; archive: string; published: boolean; name?: string }, execute: Execute, publish: () => Promise<void>, wait: Wait = waitForNextCheck) {
  const name = release.name ?? publishedPackages[0];
  if (name === "@legendapp/create-spark") verifyCreatorArchive(root, release.version, release.archive);
  const filename = name === publishedPackages[0] ? `${release.version}.json` : `${name.replace(/^@/, "").replaceAll("/", "-")}-${release.version}.json`;
  const receiptFile = path.join(root, ".spark/npm-publications", filename);
  const receipt = { schema: 1, name, version: release.version, revision: release.revision, integrity: archiveIntegrity(release.archive) };
  if (existsSync(receiptFile)) {
    const saved = readJson(receiptFile);
    if ((saved.name ?? publishedPackages[0]) !== name || saved.schema !== receipt.schema || saved.version !== receipt.version || saved.revision !== receipt.revision || saved.integrity !== receipt.integrity) throw new Error("npm publication inputs changed. Preserve the submitted archive and its source revision.");
  } else if (!release.published) {
    await publish();
    // A successful submission can remain invisible during npm's processing delay.
    // Record it separately from the immutable release manifest to avoid resubmitting.
    writeJson(receiptFile, receipt);
  }
  await waitForPublication(release.version, release.archive, execute, wait, name);
}

export async function waitForReleaseTags(version: string, latest: boolean, execute: Execute, wait: Wait = waitForNextCheck, name = "@legendapp/spark") {
  const argv = ["npm", "view", name, "dist-tags", "--json", "--prefer-online", "--fetch-retries=0", "--fetch-timeout=15000"];
  let verified = false;
  while (!verified) {
    const result = await execute(argv, true);
    if (result.code) {
      const error = new CommandError(argv, result.code, result.output);
      if (!isNetworkError(error) && !/\bE404\b/.test(result.output)) throw error;
    } else {
      const tags = JSON.parse(result.output);
      verified = tags[latest ? "latest" : "next"] === version;
    }
    if (!verified) {
      console.log(`Waiting for npm ${name} ${latest ? "latest" : "next"} tag to show ${version}. Checking again in 15s; Ctrl+C pauses this release.`);
      await wait(pollInterval);
    }
  }
}
