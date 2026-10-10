import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { create } from "../packages/cli/src/create.ts";
import { run } from "../packages/cli/src/commands.ts";
import { nodeCommand } from "../packages/cli/src/windows.ts";
import { readJson, sourceMapSources, writeJson } from "../packages/cli/src/project.ts";

// Fresh packed consumer: real native generation plus the same App.tsx in all five bundles.
const framework = path.resolve(import.meta.dirname, "..");
const root = path.resolve(process.argv[2] ?? `.spark/universal-tests/Settings${Date.now()}`);
await run(framework, [process.execPath, "scripts/pack.ts"]);
await create(root, path.join(framework, "artifacts/packages/manifest.json"), "macos", true);
const shared = ["desktop.config.json", "package.json", "App.tsx", "index.ts", "metro.config.js", "react-native.config.js", "app.config.js", "global.css", "uniwind-types.d.ts"];
const originals = shared.map(file => readFileSync(path.join(root, file), "utf8"));
const output = path.join(root, ".spark/universal-checks"); mkdirSync(output, { recursive: true });
const native = ["ios", "android", "windows"];
const hashes = new Map<string, string>();
function hashProject(target: string) {
  const hash = createHash("sha256");
  function visit(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) { hash.update(path.relative(root, file)); hash.update(readFileSync(file)); }
    }
  }
  visit(path.join(root, target)); return hash.digest("hex");
}
function assertPreserved() {
  for (const [index, file] of shared.entries()) if (readFileSync(path.join(root, file), "utf8") !== originals[index]) throw new Error(`Target switching changed ${file}`);
  for (const [target, hash] of hashes) if (hashProject(target) !== hash) throw new Error(`Target switching changed the ${target} project`);
}
for (const platform of native) {
  await run(root, [process.execPath, "node_modules/@legendapp/spark/bin/spark.cjs", "prebuild", "--platform", platform], { capture: true, env: { CI: "1" } });
  assertPreserved();
  if (!existsSync(path.join(root, platform))) throw new Error(`${platform} project missing`);
  hashes.set(platform, hashProject(platform));
  console.log(`PASS ${platform} generation preserves shared files and earlier native projects`);
}
const results = [];
for (const platform of ["ios", "android", "web", "windows", "macos"]) {
  const sourceMap = path.join(output, `${platform}.map`);
  await run(root, nodeCommand(root, "expo", "expo", ["export:embed", "--entry-file", "index.ts", "--platform", platform, "--dev", "true", "--max-workers", "2", "--bundle-output", path.join(output, `${platform}.js`), "--sourcemap-output", sourceMap]), { capture: true, env: { CI: "1", SPARK_PLATFORM: platform } });
  const sources = sourceMapSources(readJson(sourceMap));
  if (!sources.some(source => source.includes(`@legendapp/spark-ui/uniwind${platform === "web" ? ".web.ts" : ".ts"}`))) throw new Error(`${platform} did not load optional UI bindings`);
  const uniwindRuntime = platform === "web" ? "dist/module/core/config/config.js" : "src/core/config/config.native.ts";
  if (!sources.some(source => source.includes(`uniwind/${uniwindRuntime}`))) throw new Error(`${platform} selected the wrong Uniwind runtime`);
  const adapter = platform === "macos" ? "index.tsx" : `index.${platform}.tsx`;
  if (!sources.some(source => source.includes(`@legendapp/spark-ui/src/${adapter}`))) throw new Error(`${platform} did not select its UI adapter`);
  if (!["macos", "windows"].includes(platform) && sources.some(source => /Spark(?:Button|TextInput|Select)NativeComponent|NativeDesktop/.test(source))) throw new Error(`${platform} loads an AppKit native binding`);
  if (["macos", "windows", "web"].includes(platform) && sources.some(source => source.includes("@expo/ui/"))) throw new Error(`${platform} loads Expo's mobile UI backend`);
  assertPreserved(); results.push({ platform, modules: sources.length });
  console.log(`PASS ${platform} shared Settings bundle and preserved projects`);
}
writeJson(path.join(output, "summary.json"), { passed: true, results, generated: native, scope: "Generation and bundles; native execution requires separate platform checks" });
console.log(`Universal report: ${output}`);
