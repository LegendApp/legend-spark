import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

// Orders X.Y.Z and X.Y.Z-next.N; a stable version sorts after its previews.
export function compareSparkVersions(a: string, b: string) {
  const parse = (value: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-next\.(\d+))?$/.exec(value);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? Infinity : Number(match[4])] : undefined;
  };
  const left = parse(a), right = parse(b);
  if (!left || !right) return left ? 1 : right ? -1 : 0;
  for (let index = 0; index < 4; index++) if (left[index] !== right[index]) return left[index]! < right[index]! ? -1 : 1;
  return 0;
}

// The newest version below `version` under sdk-builds that has `relative` inside its SparkRunner.
export function previousRunnerVersion(sdkBuilds: string, version: string, relative: string) {
  if (!existsSync(sdkBuilds)) return undefined;
  return readdirSync(sdkBuilds)
    .filter(name => compareSparkVersions(name, version) < 0 && existsSync(path.join(sdkBuilds, name, "SparkRunner", relative)))
    .sort(compareSparkVersions)
    .at(-1);
}

// APFS clone (copy-on-write, near-zero disk); plain recursive copy when the volume can't clone.
export function cloneTree(source: string, destination: string, clone = (from: string, to: string) => spawnSync("cp", ["-c", "-R", from, to]).status === 0) {
  mkdirSync(path.dirname(destination), { recursive: true });
  if (clone(source, destination)) return "clone" as const;
  rmSync(destination, { recursive: true, force: true });
  cpSync(source, destination, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
  return "copy" as const;
}

/**
 * Seeds an empty versioned Runner project with the previous version's DerivedData and CocoaPods
 * output. Only fills paths that don't exist yet; Xcode and `pod install` still run and rebuild
 * whatever changed. Note: Xcode's build database keys inputs by absolute path, and each version
 * lives in its own directory, so compiled objects are mostly recompiled; the gain is the reused
 * module cache, products layout and the pod install that no longer redownloads.
 */
export function seedRunnerCaches(sdkBuilds: string, version: string, arch: string, log = console.log, clone?: (from: string, to: string) => boolean) {
  const seeded: string[] = [];
  for (const relative of [`.spark/DerivedData/macos-${arch}`, "macos/Pods", "macos/Podfile.lock"]) {
    const destination = path.join(sdkBuilds, version, "SparkRunner", relative);
    if (existsSync(destination)) continue;
    // Pods are only useful with the matching lockfile; prebuild preserves both together.
    if (relative !== "macos/Podfile.lock" && relative.startsWith("macos/") && existsSync(path.join(sdkBuilds, version, "SparkRunner", "macos/Podfile.lock"))) continue;
    const previous = previousRunnerVersion(sdkBuilds, version, relative);
    if (!previous) continue;
    const how = cloneTree(path.join(sdkBuilds, previous, "SparkRunner", relative), destination, clone);
    log(`Warm Runner cache: ${how === "clone" ? "APFS-cloned" : "copied"} ${relative} from ${previous}.`);
    seeded.push(relative);
  }
  return seeded;
}
