import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import type { nativePreparationInputs } from "./project.ts";
import { stateFile } from "./project.ts";

export type NativePreparation = {
  fingerprint: string;
  inputs?: ReturnType<typeof nativePreparationInputs>;
  projectFingerprint?: string;
};

export async function preserveMacOSPods(root: string, prepare: () => Promise<unknown>) {
  const native = path.join(root, "macos");
  const cache = stateFile(root, "prebuild-cache/macos");
  const entries = ["Pods", "Podfile.lock"];
  function restore() {
    for (const entry of entries) {
      const saved = path.join(cache, entry);
      const destination = path.join(native, entry);
      if (!existsSync(saved)) continue;
      if (existsSync(destination)) throw new Error(`Cannot restore CocoaPods cache: both ${saved} and ${destination} exist.`);
      mkdirSync(native, { recursive: true });
      renameSync(saved, destination);
    }
    rmSync(cache, { recursive: true, force: true });
  }
  // A terminated prebuild may leave the only copy of Pods in the cache.
  restore();
  try {
    for (const entry of entries) {
      const source = path.join(native, entry);
      if (!existsSync(source)) continue;
      mkdirSync(cache, { recursive: true });
      renameSync(source, path.join(cache, entry));
    }
    await prepare();
  } finally {
    restore();
  }
}

export function preparationChanges(previous: NativePreparation | undefined, current: NativePreparation): string[] {
  if (!previous?.inputs) return ["native preparation provenance missing"];
  const reasons: string[] = [];
  if (JSON.stringify(previous.inputs.config) !== JSON.stringify(current.inputs?.config)) {
    const updatesChanged = JSON.stringify(previous.inputs.config.expo?.extra?.spark?.updates) !== JSON.stringify(current.inputs?.config.expo?.extra?.spark?.updates);
    reasons.push(updatesChanged ? "native configuration changed (updater settings)" : "native configuration changed");
  }
  if (previous.inputs.plugin !== current.inputs?.plugin) reasons.push("native host/config plugin changed");
  const before = new Map(previous.inputs.packages.map(([name, root, contents]) => [name, { root, contents }]));
  for (const [name, root, contents] of current.inputs?.packages ?? []) {
    const prior = before.get(name);
    if (!prior) reasons.push(`${name} added`);
    else {
      if (prior.root !== root) reasons.push(`${name} location changed`);
      if (prior.contents !== contents) reasons.push(`${name} preparation sources changed`);
    }
    before.delete(name);
  }
  for (const name of before.keys()) reasons.push(`${name} removed`);
  return reasons.length ? reasons : previous.fingerprint !== current.fingerprint ? ["native preparation inputs changed"] : [];
}

export function missingNativeFrameworks(root: string): string[] {
  const pods = path.join(root, "macos/Pods");
  const support = path.join(pods, "Target Support Files");
  if (!existsSync(support)) return [support];
  const missing = new Set<string>();
  for (const target of readdirSync(support)) {
    const script = path.join(support, target, `${target}-xcframeworks.sh`);
    if (!existsSync(script)) continue;
    // CocoaPods lists only the frameworks and slices selected for this target.
    for (const match of readFileSync(script, "utf8").matchAll(/^install_xcframework "([^"]+)" "[^"]+" "[^"]+" (.+)$/gm)) {
      const framework = match[1]!.replaceAll("${PODS_ROOT}", pods).replaceAll("$(PODS_ROOT)", pods);
      if (framework.includes("$")) throw new Error(`Cannot resolve native framework input: ${framework}`);
      if (!existsSync(path.join(framework, "Info.plist"))) missing.add(path.normalize(framework));
      for (const slice of match[2]!.matchAll(/"([^"]+)"/g)) {
        if (!existsSync(path.join(framework, slice[1]!))) missing.add(path.join(framework, slice[1]!));
      }
    }
  }
  return [...missing];
}
