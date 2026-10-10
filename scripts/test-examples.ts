import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { create } from "../packages/cli/src/create.ts";
import { run } from "../packages/cli/src/commands.ts";
import { nodeCommand } from "../packages/cli/src/windows.ts";
import { type Example } from "../packages/cli/src/examples.ts";
import { sourceMapSources } from "../packages/cli/src/project.ts";
const framework = path.resolve(import.meta.dirname, "..");
const parent = path.resolve(process.argv[2] ?? `.spark/example-tests/${Date.now()}`);
for (const example of ["notes-lite", "music-lite", "diff-lite"] as Example[]) {
  const root = path.join(parent, example.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()));
  await create(root, path.join(framework, "artifacts/packages/manifest.json"), "macos", true, example);
  await run(root, ["node", "node_modules/typescript/bin/tsc", "--noEmit"], { capture: true });
  const directory = path.join(root, ".spark/checks"); mkdirSync(directory, { recursive: true });
  const original = readFileSync(path.join(root, "desktop.config.json"), "utf8");
  for (const platform of ["web", "ios", "android", "macos", "windows"]) {
    await run(root, nodeCommand(root, "expo", "expo", ["export:embed", "--entry-file", "index.ts", "--platform", platform, "--dev", "true", "--max-workers", "2", "--bundle-output", path.join(directory, `${platform}.js`), "--sourcemap-output", path.join(directory, `${platform}.map`)]), { capture: true, env: { CI: "1", SPARK_PLATFORM: platform } });
    const sources = sourceMapSources(JSON.parse(readFileSync(path.join(directory, `${platform}.map`), "utf8")));
    if (["ios", "android", "web"].includes(platform) && sources.some(source => /NativeDesktop|NativeSparkAudio/.test(source))) throw new Error(`${example}/${platform} imports a desktop binding`);
    if (original !== readFileSync(path.join(root, "desktop.config.json"), "utf8")) throw new Error("Platform switching modified project configuration");
    console.log(`PASS ${example} ${platform}: ${sources.length} modules`);
  }
}
