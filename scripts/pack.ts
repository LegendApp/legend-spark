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
await packTemplates(root, output, manifest);
registerPackages(path.join(output, "manifest.json"));
console.log("Local SDK packages registered. Create an app with spark create MyApp.");
