import { existsSync } from "node:fs";
import path from "node:path";
import { readJson, VERSION } from "./project.ts";
import { localArchive } from "./package-manager.ts";

export type ReleaseAsset = { url: string; sha256: string; size: number };
export type RunnerAsset = ReleaseAsset & { app: string; teamId: string; fingerprint: string };
export type ReleaseManifest = {
  schema: 1;
  version: string;
  revision: string;
  packages: Record<string, ReleaseAsset>;
  runners: Record<string, RunnerAsset>;
};
export const releaseBase = (version: string) => `https://github.com/LegendApp/legend-spark/releases/download/v${version}`;
export function validateRelease(value: any): ReleaseManifest {
  if (value?.schema !== 1 || value.version !== VERSION || !/^[a-f0-9]{40}$/.test(value.revision) || !value.packages || !value.runners) throw new Error("Invalid or incompatible Spark release manifest");
  for (const asset of [...Object.values(value.packages), ...Object.values(value.runners)] as ReleaseAsset[]) {
    const url = new URL(asset.url);
    if (url.href !== asset.url || !/^[A-Za-z0-9._-]+$/.test(url.pathname.split("/").at(-1) ?? "") || !asset.url.startsWith(releaseBase(VERSION) + "/") || url.search || url.hash || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.size) || asset.size <= 0) throw new Error("Invalid Spark release asset");
  }
  for (const [target, asset] of Object.entries(value.runners) as [string, RunnerAsset][]) {
    if (!["macos-arm64", "macos-x64"].includes(target) || path.basename(asset.app) !== asset.app || !asset.app.endsWith(".app") || !/^[A-Z0-9]{10}$/.test(asset.teamId) || !/^[a-f0-9]+$/.test(asset.fingerprint)) throw new Error("Invalid Runner release target");
  }
  return value;
}
export function installedRelease(): ReleaseManifest | undefined {
  const file = path.join(import.meta.dirname, "release.json");
  return existsSync(file) ? validateRelease(readJson(file)) : undefined;
}
/** Registry versions and immutable HTTPS archives survive project moves and clones. */
export function packageSources(manifest?: string, release = installedRelease()): Record<string, string> {
  let sources: Record<string, string>;
  if (manifest) {
    sources = Object.fromEntries(Object.entries(readJson(manifest)).map(([name, relative]) => {
      const file = path.resolve(path.dirname(manifest), relative as string);
      if (!existsSync(file)) throw new Error(`Missing SDK archive: ${file}`);
      return [name, localArchive(file)];
    }));
  } else {
    if (!release) throw new Error("This SDK has no published release metadata. Pack or register a local SDK first.");
    validateRelease(release);
    sources = { ...Object.fromEntries(Object.entries(release.packages).map(([name, asset]) => [name, asset.url])), "@legendapp/spark": VERSION };
  }
  return sources;
}
