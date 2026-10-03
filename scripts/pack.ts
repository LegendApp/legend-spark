import { packAudio } from "./prepare-audio.ts";
import { packArchive } from "../packages/cli/src/pack-archive.ts";
import { packSpark } from "./pack-spark.ts";
import { packWindowsLibraries } from "./prepare-windows-libraries.ts";
import { packTemplates } from "./pack-templates.ts";
import { packRuntimes } from "./prepare-runtimes.ts";
import { mkdirSync, readFileSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { registerPackages } from "../packages/cli/src/local.ts";
import { writeJson, readJson } from "../packages/cli/src/project.ts";
import { run } from "../packages/cli/src/commands.ts";
import { patchedPackageNames } from "./patch-inventory.ts";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "artifacts/packages");
mkdirSync(output, { recursive: true });
const packages = [
  "fixtures/native-greeting",
  "fixtures/sdk-test-driver",
];
const manifest: Record<string, string> = await packRuntimes(root, output);
Object.assign(manifest, await packWindowsLibraries(output), await packAudio(root, output));
manifest["@legendapp/spark"] = await packSpark(root, output);
for (const dir of packages) {
  const pkg = readJson(path.join(root, dir, "package.json"));
  const file = `${pkg.name.replace(/^@/, "").replaceAll("/", "-")}-${pkg.version}.tgz`;
  await packArchive(path.join(root, dir), path.join(output, file));
  const hash = createHash("sha256")
    .update(readFileSync(path.join(output, file)))
    .digest("hex")
    .slice(0, 12);
  const immutable = file.replace(/\.tgz$/, `-${hash}.tgz`);
  copyFileSync(path.join(output, file), path.join(output, immutable));
  manifest[pkg.name] = immutable;
}
writeJson(path.join(output, "manifest.json"), manifest);
const names = Object.keys(manifest).filter(name => patchedPackageNames.includes(name as typeof patchedPackageNames[number])).sort();
if (JSON.stringify(names) !== JSON.stringify([...patchedPackageNames].sort())) throw new Error("Local package set does not match the patched release inventory");
const provenance: Record<string, { file: string; sha256: string; patchHash: string; version: string }> = {};
for (const name of patchedPackageNames) {
  const file = manifest[name]!;
  const metadata = JSON.parse(await run(root, ["tar", "-xOzf", path.join(output, file), "package/package.json"], { capture: true }));
  if (metadata.name !== name || typeof metadata.spark?.patchHash !== "string") throw new Error(`Packed archive is missing patch provenance: ${name}`);
  provenance[name] = { file, sha256: createHash("sha256").update(readFileSync(path.join(output, file))).digest("hex"), patchHash: metadata.spark.patchHash, version: metadata.version };
}
writeJson(path.join(output, "provenance.json"), provenance);
await packTemplates(root, output, manifest);
registerPackages(path.join(output, "manifest.json"));
console.log("Local SDK packages registered. Create an app with spark create MyApp.");
