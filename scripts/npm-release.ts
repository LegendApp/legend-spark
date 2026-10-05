import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Execute } from "./release-workflow.ts";

export function releaseNotes(changelog: string, version: string) {
  const heading = `## ${version} — preview`;
  const start = changelog.indexOf(heading);
  if (start < 0) throw new Error(`Missing changelog notes for ${version}`);
  const end = changelog.indexOf("\n## ", start + heading.length);
  return changelog.slice(start + heading.length, end < 0 ? undefined : end).trim();
}

export async function alreadyPublished(version: string, archive: string, execute: Execute) {
  const result = await execute(["npm", "view", `@legendapp/spark@${version}`, "version", "dist.integrity", "--json"], true);
  if (result.code) {
    if (/\bE404\b/.test(result.output)) return false;
    throw new Error(`Could not check npm publication: ${result.output}`);
  }
  const metadata = JSON.parse(result.output);
  const integrity = `sha512-${createHash("sha512").update(readFileSync(archive)).digest("base64")}`;
  if (metadata.version !== version || metadata["dist.integrity"] !== integrity) throw new Error(`npm ${version} contains different bytes. Never overwrite it; prepare a new version.`);
  return true;
}
