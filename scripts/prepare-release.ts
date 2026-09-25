import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { run } from "../packages/cli/src/commands.ts";
import { readRuntime } from "../packages/cli/src/local.ts";
import { readJson, VERSION, writeJson } from "../packages/cli/src/project.ts";
import { releaseBase, validateRelease, type ReleaseAsset, type ReleaseManifest } from "../packages/cli/src/release.ts";
import { packSpark } from "./pack-spark.ts";

// Stage an immutable release only from a signed/notarized Runner and clean source.
const root = path.resolve(import.meta.dirname, "..");
const runners = process.argv.slice(2).map(file => path.resolve(file));
if (!runners.length || runners.some(file => !file.endsWith(".zip") || !existsSync(file))) throw new Error("Usage: node scripts/prepare-release.ts <signed Runner.zip> [additional Runner.zip]");
if ((await run(root, ["git", "status", "--porcelain"], { capture: true })).trim()) throw new Error("Commit the release source before assembling its artifacts.");
const revision = (await run(root, ["git", "rev-parse", "HEAD"], { capture: true })).trim();
const output = path.join(root, "artifacts/releases", VERSION);
if (existsSync(output)) throw new Error(`Release staging already exists: ${output}. Preserve immutable artifacts; use a new version or move the previous staging directory.`);
const manifest: ReleaseManifest = { schema: 1, version: VERSION, revision, packages: {}, runners: {} };
const packages = path.join(root, "artifacts/packages");
const local = readJson(path.join(packages, "manifest.json"));
const stage = `${output}.staging-${process.pid}`;
mkdirSync(stage, { recursive: true });
function asset(file: string, name = path.basename(file)): ReleaseAsset {
  copyFileSync(file, path.join(stage, name));
  const bytes = readFileSync(file);
  return { url: `${releaseBase(VERSION)}/${name}`, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}
try {
  for (const runner of runners) {
    const unpacked = path.join(stage, "verify-runner");
    await run(root, ["ditto", "-x", "-k", runner, unpacked], { capture: true });
    const apps = readdirSync(unpacked).filter(name => name !== "__MACOSX");
    if (apps.length !== 1 || !apps[0]!.endsWith(".app")) throw new Error("Runner archive must contain exactly one app");
    const app = path.join(unpacked, apps[0]!);
    const runtime = readRuntime(app);
    if (!runtime || runtime.mode !== "go" || runtime.platform !== "macos") throw new Error("Runner version or architecture does not match this release");
    if (runtime.sourceRevision !== revision) throw new Error("Runner was not built from this release revision. Use npm run release:runner.");
    await run(root, ["codesign", "--verify", "--deep", "--strict", app], { capture: true });
    const signature = await run(root, ["codesign", "-dvvv", app], { capture: true });
    const teamId = /^TeamIdentifier=([A-Z0-9]{10})$/m.exec(signature)?.[1];
    if (!teamId || !signature.includes("Authority=Developer ID Application:") || !/flags=.*\bruntime\b/.test(signature)) throw new Error("Runner requires Developer ID and hardened runtime signing");
    await run(root, ["xcrun", "stapler", "validate", app], { capture: true });
    await run(root, ["spctl", "--assess", "--type", "execute", app], { capture: true });
    const target = `macos-${runtime.arch}`;
    if (manifest.runners[target]) throw new Error(`Duplicate Runner target: ${target}`);
    manifest.runners[target] = { ...asset(runner, `spark-runner-${target}.zip`), app: apps[0]!, teamId, fingerprint: runtime.fingerprint };
    rmSync(unpacked, { recursive: true });
  }
  for (const name of ["@react-native-runtimes/core", "react-native-nitro-modules", "@op-engineering/op-sqlite", "react-native-webview"]) {
    if (!local[name] || path.basename(local[name]) !== local[name]) throw new Error(`Missing patched release archive: ${name}`);
    manifest.packages[name] = asset(path.join(packages, local[name]));
  }
  validateRelease(manifest);
  const npm = await packSpark(root, stage, manifest);
  writeJson(path.join(stage, "runner-manifest.json"), manifest);
  const hashes = Object.fromEntries(readdirSync(stage).sort().map(name => [name, createHash("sha256").update(readFileSync(path.join(stage, name))).digest("hex")]));
  writeJson(path.join(stage, "release.json"), { version: VERSION, revision, npm, sha256: hashes });
  const { renameSync, writeFileSync } = await import("node:fs");
  writeFileSync(path.join(stage, "checksums.txt"), Object.entries(hashes).map(([name, hash]) => `${hash}  ${name}\n`).join(""));
  renameSync(stage, output);
  console.log(`Release staged: ${output}\nUpload GitHub assets before publishing ${npm} to npm under next.`);
} finally { rmSync(stage, { recursive: true, force: true }); }
