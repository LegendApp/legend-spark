import { packArchive } from "../packages/cli/src/pack-archive.ts";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import path from "node:path";
import { run } from "../packages/cli/src/commands.ts";
import { digest, readJson, writeJson } from "../packages/cli/src/project.ts";

export const runtimesRevision = "58710c25c6e505dcc1292ee54d855408a6f7a42d";
export function runtimesPatchHash(root: string) {
  const patches = ["react-native-runtimes-macos.patch", "react-native-runtimes-integration.patch"];
  const surface = path.join(root, "patches/windows/runtimes/NativeThreadedRuntimeSurface.windows.tsx");
  return digest(readFileSync(surface, "utf8") + readFileSync(import.meta.filename, "utf8") + runtimesRevision + patches.map(file => readFileSync(path.join(root, "patches", file), "utf8")).join(""));
}
// Distribute the patched, pinned source in the SDK archive manifest. Consumers
// install an ordinary tarball; they need neither git nor a patch-package hook.
export async function packRuntimes(root: string, output: string) {
  const cache = path.join(root, ".spark/vendor/runtimes");
  const source = path.join(cache, "source");
  mkdirSync(cache, { recursive: true });
  if (!existsSync(source)) await run(root, ["git", "clone", "https://github.com/margelo/react-native-runtimes.git", source], { capture: true });
  const patches = ["react-native-runtimes-macos.patch", "react-native-runtimes-integration.patch"];
  const surface = path.join(root, "patches/windows/runtimes/NativeThreadedRuntimeSurface.windows.tsx");
  const hash = runtimesPatchHash(root);
  const stage = path.join(cache, "stage");
  rmSync(stage, { recursive: true, force: true }); mkdirSync(stage);
  const archive = path.join(cache, "source.tar");
  await run(source, ["git", "archive", "--format=tar", "--output", archive, runtimesRevision, "packages/core"], { capture: true });
  await run(stage, ["tar", "-xf", archive], { capture: true });
  // Apply unified diffs in JS: Windows developers do not need Unix patch.
  const { parsePatch, applyPatch } = createRequire(import.meta.url)("diff");
  for (const patch of patches) for (const file of parsePatch(readFileSync(path.join(root, "patches", patch), "utf8"))) {
    const target = path.join(stage, file.newFileName.replace(/^b\//, ""));
    const next = applyPatch(readFileSync(target, "utf8"), file);
    if (next === false) throw new Error(`Could not apply ${patch} to ${target}`);
    writeFileSync(target, next);
  }
  const core = path.join(stage, "packages/core");
  const pkg = readJson(path.join(core, "package.json"));
  // Native backend is compiled into spark's host; retain the upstream API.
  const api = path.join(core, "src/ThreadedRuntime.tsx");
  writeFileSync(api, readFileSync(api, "utf8").replaceAll("['android', 'ios', 'macos']", "['android', 'ios', 'macos', 'windows']")
    .replace('function getRuntimeFunctionsNitro() {', 'function getRuntimeFunctionsNitro() {\n  if (Platform.OS === "windows") return null; // RNW uses the upstream native-call transport.'));
  cpSync(surface, path.join(core, "src/NativeThreadedRuntimeSurface.windows.tsx"));
  mkdirSync(path.join(core, "windows"));
  writeFileSync(path.join(core, "windows/README.md"), "Windows native implementation lives in @legendapp/spark-desktop-host/windows/runtimes.inc.\n");
  writeFileSync(path.join(core, "react-native.config.js"), "module.exports = { dependency: { platforms: { windows: null } } };\n");
  pkg.files = [...new Set([...(pkg.files ?? []), "windows", "react-native.config.js"])];
  pkg.main = pkg.types = "src/index.ts";
  pkg.spark = { sdk: true, upstreamRevision: runtimesRevision, patchHash: hash };
  // The Metro scanner's Babel dependencies must be declared, not accidentally hoisted.
  pkg.dependencies = { ...pkg.dependencies, "@babel/parser": "7.28.5", "@babel/traverse": "7.28.5", "react-native-nitro-modules": "0.35.7" };
  writeJson(path.join(core, "package.json"), pkg);
  const file = `runtimes-${hash.slice(0, 12)}.tgz`;
  await packArchive(core, path.join(output, file));
  return { [pkg.name]: file };
}
