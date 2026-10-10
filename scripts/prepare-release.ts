import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { run } from "../packages/cli/src/commands.ts";
import { readRuntime } from "../packages/cli/src/local.ts";
import { readJson, VERSION, writeJson } from "../packages/cli/src/project.ts";
import { releaseBase, validateRelease, type ReleaseAsset, type ReleaseManifest } from "../packages/cli/src/release.ts";
import { packSpark } from "./pack-spark.ts";
import { patchedPackageNames, validatePatchedArchive, type PackageProvenance } from "./patch-inventory.ts";
import { runtimesPatchHash, runtimesRevision } from "./prepare-runtimes.ts";
import { windowsPatchHash } from "./prepare-windows-libraries.ts";

// Stage an immutable release only from a signed/notarized Runner and clean source.
const root = path.resolve(import.meta.dirname, "..");
const runners = process.argv.slice(2).map(file => path.resolve(file));
if (!runners.length || runners.some(file => !file.endsWith(".zip") || !existsSync(file))) throw new Error("Usage: bun scripts/prepare-release.ts <signed Runner.zip> [additional Runner.zip]");
if ((await run(root, ["git", "status", "--porcelain"], { capture: true })).trim()) throw new Error("Commit the release source before assembling its artifacts.");
const revision = (await run(root, ["git", "rev-parse", "HEAD"], { capture: true })).trim();
const output = path.join(root, "artifacts/releases", VERSION);
if (existsSync(output)) throw new Error(`Release staging already exists: ${output}. Preserve immutable artifacts; use a new version or move the previous staging directory.`);
const manifest: ReleaseManifest = { schema: 1, version: VERSION, revision, packages: {}, runners: {} };
const packages = path.join(root, "artifacts/packages");
const local = readJson(path.join(packages, "manifest.json"));
const provenance = readJson(path.join(packages, "provenance.json")) as Record<string, PackageProvenance>;
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
    if (runtime.sourceRevision !== revision) throw new Error("Runner was not built from this release revision. Use bun run release:runner.");
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
  const workspacePins = readJson(path.join(root, "patches/workspace/upstream.json"));
  const windowsPins = readJson(path.join(root, "patches/windows/upstream.json"));
  const expectedPatchHashes: Record<string, string> = {
    "@react-native-runtimes/core": runtimesPatchHash(root),
    "react-native-nitro-modules": windowsPatchHash("react-native-nitro-modules", windowsPins["react-native-nitro-modules"]),
    "@op-engineering/op-sqlite": windowsPatchHash("@op-engineering/op-sqlite", windowsPins["@op-engineering/op-sqlite"]),
    "react-native-webview": windowsPatchHash("react-native-webview", windowsPins["react-native-webview"]),
  };
  if (JSON.stringify(Object.keys(local).filter(name => patchedPackageNames.includes(name as typeof patchedPackageNames[number])).sort()) !== JSON.stringify([...patchedPackageNames].sort())) throw new Error("Local package manifest does not match patched release inventory");
  if (JSON.stringify(Object.keys(provenance).sort()) !== JSON.stringify([...patchedPackageNames].sort())) throw new Error("Missing or unexpected patched archive provenance records");
  for (const name of patchedPackageNames) {
    const filename = local[name];
    if (typeof filename !== "string" || path.basename(filename) !== filename) throw new Error(`Missing patched release archive: ${name}`);
    const archive = path.join(packages, filename);
    const bytes = readFileSync(archive);
    const metadata = JSON.parse(await run(root, ["tar", "-xOzf", archive, "package/package.json"], { capture: true }));
    const expectedVersion = name === "@react-native-runtimes/core" ? workspacePins[name].version : windowsPins[name].version;
    const expectedSource = name === "@react-native-runtimes/core" ? { upstreamRevision: runtimesRevision } : { upstreamIntegrity: windowsPins[name].integrity };
    validatePatchedArchive(name, filename, bytes, provenance[name], metadata, expectedPatchHashes[name]!, expectedVersion, expectedSource);
    manifest.packages[name] = asset(archive);
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
