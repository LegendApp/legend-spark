import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../packages/cli/src/commands.ts";
import { writeJson } from "../packages/cli/src/json.ts";
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
await run(app, ["npm", "install", "--no-audit", "--no-fund"]);
await run(app, ["npm", "exec", "--no", "--", "tsc", "--noEmit"]);
console.log("PASS: local npm tarballs → creator → npm install → tsc --noEmit");
