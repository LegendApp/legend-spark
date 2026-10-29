import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { run } from "../packages/cli/src/commands.ts";
import { readJson, writeJson } from "../packages/cli/src/json.ts";
import { create } from "../packages/cli/src/create.ts";
import { prepareGoProfile } from "../packages/cli/src/go-profile.ts";
import { packSpark } from "../scripts/pack-spark.ts";
import { packCreateSpark } from "../scripts/pack-create-spark.ts";
import { packRuntimes } from "../scripts/prepare-runtimes.ts";

const framework = path.resolve(import.meta.dirname, "..");
const temporary = mkdtempSync(path.join(os.tmpdir(), "spark-create-packed-"));
console.log(`Packed creator smoke artifacts: ${temporary}`);
const archives = path.join(temporary, "archives");
const spark = await packSpark(framework, archives);
const creator = await packCreateSpark(framework, archives);
// The desktop template requires the patched Runtimes source, as a release does.
const manifest = { ...await packRuntimes(framework, archives), "@legendapp/spark": spark };
const packages = path.join(archives, "manifest.json");
writeJson(packages, manifest);
process.env.SPARK_HOME = path.join(temporary, "spark-home");
process.env.CI = "1";
await run(temporary, ["npm", "exec", "--yes", "--package", path.join(archives, creator), "--", "create-spark", "SmokeApp", "--packages", packages, "--platform", "macos", "--package-manager", "npm"]);
const app = path.join(temporary, "SmokeApp");
await run(app, ["npm", "install", "--save-exact", "react-native-enriched-markdown@1.1.1", "--no-audit", "--no-fund"]);
await run(app, ["npm", "exec", "--no", "--", "tsc", "--noEmit"]);
// Opt the Bun Runner fixture into the same backend before comparing native profiles.
const runner = path.join(temporary, "SparkRunner");
await create(runner, packages, "macos", false, undefined, "bun");
const runnerPackage = readJson(path.join(runner, "package.json"));
runnerPackage.dependencies["react-native-enriched-markdown"] = "1.1.1";
writeJson(path.join(runner, "package.json"), runnerPackage);
await prepareGoProfile(runner, packages, "macos", "bun");
for (const root of [app, runner]) {
  for (const directory of ["cpp/highlight/vendor/grammars", "cpp/highlight/vendor/tree-sitter", "ios/vendor"]) {
    assert(existsSync(path.join(root, "node_modules/react-native-enriched-markdown", directory)), `Postinstall assets missing: ${root}/${directory}`);
  }
}
// Use the distributed CLI's launch compatibility check, including its module hashes.
const { nativePackages, runtimeFor, incompatible }: typeof import("../packages/cli/src/project.ts") = await import(pathToFileURL(path.join(app, "node_modules/@legendapp/spark/vendor/node_modules/@legendapp/spark-cli/dist/project.js")).href);
const required = nativePackages(app);
assert(required.some(pkg => pkg.name === "react-native-enriched-markdown"));
assert.deepEqual(incompatible(runtimeFor(runner, nativePackages(runner), "go"), required), [], "Fresh npm app must not need a development build with the Bun Runner profile");
console.log("PASS: local npm tarballs → creator → npm install → tsc --noEmit → Bun Runner native compatibility (no native build)");
