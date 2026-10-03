import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
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
  if (Object.keys(value.packages).some(name => !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name))) throw new Error("Invalid Spark package name");
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
/** Local SDK archives keep their manifest-relative paths; release archives become portable project-relative files. */
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
    sources = { ...Object.fromEntries(Object.entries(release.packages).map(([name, asset]) => [name, `file:./spark-packages/${packageArchiveName(name, asset)}`])), "@legendapp/spark": VERSION };
  }
  return sources;
}

function packageArchiveName(name: string, asset: ReleaseAsset) {
  return `${name.replace(/^@/, "").replaceAll("/", "-")}-${asset.sha256}.tgz`;
}

/** Download and verify release bytes before installing; relative vendored files survive moves and ordinary clones. */
export async function materializeReleasePackages(release: ReleaseManifest, projectRoot: string, fetcher: typeof fetch = fetch) {
  validateRelease(release);
  const directory = path.join(projectRoot, "spark-packages");
  mkdirSync(directory, { recursive: true });
  const pending = Object.entries(release.packages).map(([name, asset]) => ({ name, asset, file: path.join(directory, packageArchiveName(name, asset)) }));
  for (const { name, asset, file } of pending) {
    if (!existsSync(file)) continue;
    const bytes = readFileSync(file);
    if (bytes.length !== asset.size || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new Error(`Existing verified Spark package archive is corrupt: ${name}`);
  }
  for (const { name, asset, file } of pending) {
    if (existsSync(file)) continue;
    const response = await fetcher(asset.url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Download Spark package ${name}: HTTP ${response.status}`);
    const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
    const fd = openSync(temporary, "wx");
    const hash = createHash("sha256");
    let size = 0;
    let open = true;
    try {
      if (!response.body) throw new Error(`Download Spark package ${name}: response has no body`);
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > asset.size) { await reader.cancel(); throw new Error(`Spark package archive exceeds its declared size: ${name}`); }
          hash.update(value);
          let offset = 0;
          while (offset < value.byteLength) offset += writeSync(fd, value, offset, value.byteLength - offset);
        }
      } finally { reader.releaseLock(); }
      if (size !== asset.size || hash.digest("hex") !== asset.sha256) throw new Error(`Spark package archive checksum or size mismatch: ${name}`);
      closeSync(fd);
      open = false;
      renameSync(temporary, file);
    } catch (error) {
      if (open) closeSync(fd);
      rmSync(temporary, { force: true });
      throw error;
    }
  }
}

/** Recheck vendored bytes immediately before a package manager can run lifecycle scripts. */
export function verifyMaterializedReleasePackages(release: ReleaseManifest, projectRoot: string) {
  validateRelease(release);
  const directory = path.join(projectRoot, "spark-packages");
  for (const [name, asset] of Object.entries(release.packages)) {
    const file = path.join(directory, packageArchiveName(name, asset));
    if (!existsSync(file)) throw new Error(`Verified Spark package archive is missing: ${name}`);
    const bytes = readFileSync(file);
    if (bytes.length !== asset.size || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new Error(`Verified Spark package archive changed before installation: ${name}`);
  }
}
