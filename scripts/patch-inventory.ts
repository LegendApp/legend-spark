import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export type PackageProvenance = { file: string; sha256: string; patchHash: string; version: string };

export const patchedPackageNames = [
  "@react-native-runtimes/core",
  "react-native-nitro-modules",
  "@op-engineering/op-sqlite",
  "react-native-webview",
] as const;

export function hashFiles(root: string, files: string[], identity = "") {
  const hash = createHash("sha256").update(identity);
  for (const file of [...files].sort()) hash.update(`\0${file}\0`).update(readFileSync(path.isAbsolute(file) ? file : path.join(root, file)));
  return hash.digest("hex");
}

export function listFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? listFiles(file) : statSync(file).isFile() ? [file] : [];
  }).sort();
}

export function validatePatchedArchive(name: string, filename: string, bytes: Uint8Array, record: PackageProvenance | undefined, metadata: { name?: string; version?: string; spark?: { patchHash?: string; upstreamIntegrity?: string; upstreamRevision?: string } }, expectedPatchHash: string, expectedVersion: string, expectedSource: { upstreamIntegrity?: string; upstreamRevision?: string }) {
  if (!record || path.basename(filename) !== filename || record.file !== filename) throw new Error(`Missing or invalid patched archive provenance: ${name}`);
  if (createHash("sha256").update(bytes).digest("hex") !== record.sha256) throw new Error(`Patched archive was modified after packing: ${name}`);
  if (metadata.name !== name || metadata.version !== record.version || metadata.version !== expectedVersion) throw new Error(`Unexpected patched archive identity: ${name}`);
  if (metadata.spark?.patchHash !== expectedPatchHash || record.patchHash !== expectedPatchHash) throw new Error(`Stale patched archive recipe: ${name}`);
  if (metadata.spark?.upstreamIntegrity !== expectedSource.upstreamIntegrity || metadata.spark?.upstreamRevision !== expectedSource.upstreamRevision) throw new Error(`Unexpected patched archive source: ${name}`);
}
