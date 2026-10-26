import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Release Runner builds use one fixed project folder so Xcode's build database (keyed by
 * absolute source paths) stays valid across versions and the build is incremental.
 * Each release creates a fresh project in a staging folder exactly as before, syncs it into the
 * fixed folder (only files whose bytes differ are rewritten, so unchanged sources keep their
 * mtimes), builds there, then mirrors the result into sdk-builds/<version>/SparkRunner.
 */
export const releaseRunnerRoot = (sdkBuilds: string) => path.join(sdkBuilds, "release", "SparkRunner");
export const releaseRunnerStaging = (sdkBuilds: string) => path.join(sdkBuilds, "release", "staging", "SparkRunner");

// Build state the fresh project never contains and the build must keep: Xcode's DerivedData,
// generated native project + Pods (prebuild regenerates the project but preserves Pods), products.
export const preservedBuildState = [".spark/DerivedData", "macos", ".spark/products", ".spark/prebuild-cache"];

function same(a: string, b: string) {
  const left = lstatSync(a), right = lstatSync(b);
  if (left.isSymbolicLink() || right.isSymbolicLink()) return left.isSymbolicLink() && right.isSymbolicLink() && readlinkSync(a) === readlinkSync(b);
  if (left.isFile() !== right.isFile() || left.size !== right.size || (left.mode & 0o777) !== (right.mode & 0o777)) return false;
  return readFileSync(a).equals(readFileSync(b));
}

/** Makes `destination` byte-identical to `source`, skipping (and keeping) `keep` paths relative to the roots. Returns rewritten paths. */
export function syncTree(source: string, destination: string, keep: string[] = [], relative = ""): string[] {
  const changed: string[] = [];
  mkdirSync(destination, { recursive: true });
  const wanted = new Set(existsSync(source) ? readdirSync(source) : []);
  for (const name of readdirSync(destination)) {
    const rel = path.posix.join(relative, name);
    if (wanted.has(name) || keep.includes(rel)) continue;
    // A folder holding preserved state is pruned around it, never removed wholesale.
    if (keep.some(entry => entry.startsWith(`${rel}/`)) && lstatSync(path.join(destination, name)).isDirectory()) changed.push(...syncTree(path.join(source, name), path.join(destination, name), keep, rel));
    else { rmSync(path.join(destination, name), { recursive: true, force: true }); changed.push(rel); }
  }
  for (const name of wanted) {
    const rel = path.posix.join(relative, name);
    if (keep.includes(rel)) continue;
    const from = path.join(source, name), to = path.join(destination, name);
    const stat = lstatSync(from);
    if (stat.isDirectory()) {
      if (existsSync(to) && !lstatSync(to).isDirectory()) rmSync(to, { force: true });
      changed.push(...syncTree(from, to, keep, rel));
      continue;
    }
    if (existsSync(to) || isLink(to)) {
      if (!lstatSync(to).isDirectory() && same(from, to)) continue;
      rmSync(to, { recursive: true, force: true });
    }
    if (stat.isSymbolicLink()) symlinkSync(readlinkSync(from), to);
    else copyFileSync(from, to);
    changed.push(rel);
  }
  return changed;
}

function isLink(file: string) { try { return lstatSync(file).isSymbolicLink(); } catch { return false; } }

// Files under the version folder that record the project's own absolute path.
export const pathRecords = [".spark/go-build.json", ".spark/native-selection.json", ".spark/native-preparation.json", "macos/Podfile", "macos/Podfile.lock"];

export function rewritePathRecords(root: string, from: string, to: string) {
  for (const record of pathRecords) {
    const file = path.join(root, record);
    if (existsSync(file)) writeFileSync(file, readFileSync(file, "utf8").split(from).join(to));
  }
}

/**
 * Replaces sdk-builds/<version>/SparkRunner with the fixed folder's built project (minus its
 * DerivedData), rewriting recorded absolute paths so signing, notarization and --resume read the
 * version folder exactly as when it was built in place. An earlier notarization/packaging state
 * in the version folder is kept.
 */
export function mirrorRunner(fixed: string, version: string, clone = (from: string, to: string) => spawnSync("cp", ["-c", "-R", from, to]).status === 0) {
  const incoming = `${version}.incoming`;
  rmSync(incoming, { recursive: true, force: true });
  mkdirSync(path.dirname(version), { recursive: true });
  if (!clone(fixed, incoming)) { rmSync(incoming, { recursive: true, force: true }); spawnSync("cp", ["-R", fixed, incoming]); }
  if (!existsSync(path.join(incoming, "package.json"))) throw new Error(`Copying the release Runner from ${fixed} failed.`);
  rmSync(path.join(incoming, ".spark/DerivedData"), { recursive: true, force: true });
  for (const kept of [".spark/packaging", ".spark/signing.json"]) {
    const previous = path.join(version, kept);
    if (!existsSync(previous)) continue;
    rmSync(path.join(incoming, kept), { recursive: true, force: true });
    renameSync(previous, path.join(incoming, kept));
  }
  rewritePathRecords(incoming, fixed, version);
  rmSync(version, { recursive: true, force: true });
  renameSync(incoming, version);
}
