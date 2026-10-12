import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Execute } from "./release-workflow.ts";
import { CommandError, isNetworkError } from "../packages/cli/src/errors.ts";
import { readJson, writeJson } from "../packages/cli/src/project.ts";

const pollInterval = 15_000;
const waitForNextCheck = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
type Wait = typeof waitForNextCheck;
const archiveIntegrity = (archive: string) => `sha512-${createHash("sha512").update(readFileSync(archive)).digest("base64")}`;

export function releaseNotes(changelog: string, version: string) {
  const heading = `## ${version} — preview`;
  const start = changelog.indexOf(heading);
  if (start < 0) throw new Error(`Missing changelog notes for ${version}`);
  const end = changelog.indexOf("\n## ", start + heading.length);
  return changelog.slice(start + heading.length, end < 0 ? undefined : end).trim();
}

export const publishedPackages = ["@legendapp/spark", "@legendapp/create-spark"] as const;

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
      verified = tags.next === version && (!latest || tags.latest === version);
    }
    if (!verified) {
      console.log(`Waiting for npm ${name} ${latest ? "next and latest" : "next"} tags to show ${version}. Checking again in 15s; Ctrl+C pauses this release.`);
      await wait(pollInterval);
    }
  }
}
