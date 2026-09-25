import { existsSync } from "node:fs";
import path from "node:path";
import { run } from "../packages/cli/src/commands.ts";
import { sparkHome } from "../packages/cli/src/local.ts";
import { VERSION, readJson } from "../packages/cli/src/project.ts";
import { packageApp } from "../packages/cli/src/package.ts";

const root = path.resolve(import.meta.dirname, "..");
if (existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env"));
if (process.platform !== "darwin") throw new Error("Build the release Runner on macOS.");
if ((await run(root, ["git", "status", "--porcelain"], { capture: true })).trim()) throw new Error("Commit the release version and source before building Runner.");
const revision = (await run(root, ["git", "rev-parse", "HEAD"], { capture: true })).trim();
await run(root, [process.execPath, "scripts/pack.ts"]);
const project = path.join(sparkHome(), "sdk-builds", VERSION, "SparkRunner");
// A resumed signing run reuses its original build; a fresh invocation forces a
// native build carrying the exact source revision instead of trusting old caches.
if (!process.argv.includes("--resume")) await run(root, [process.execPath, "scripts/spark.mjs", "sdk", "build-runner", "--force"], { env: { SPARK_RELEASE_REVISION: revision } });
const built = readJson(path.join(project, ".spark/go-build.json"));
if (built.runtime.sourceRevision !== revision) throw new Error("No Runner build exists for this revision. Run without --resume first.");
const result = await packageApp(project, { runner: true });
if (result.pending) process.exitCode = 2;
else if (process.argv.includes("--no-assemble")) console.log(`Signed Runner: ${result.output}`);
else await run(root, [process.execPath, "scripts/prepare-release.ts", result.output]);
