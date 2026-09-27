import { applyOverrides, localArchive, managerCommand, packageManager } from "../packages/cli/src/package-manager.ts";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { run, binary } from "../packages/cli/src/commands.ts";
import { readJson, writeJson } from "../packages/cli/src/project.ts";

// A packed, minimal consumer proves platform selection independently of the macOS-only kitchen sink.
const framework = path.resolve(import.meta.dirname, "..");
const root = path.resolve(process.argv[2] ?? ".spark/api-platforms");
if (existsSync(path.join(root, "package.json")) && !existsSync(path.join(root, ".spark-api-probe"))) throw new Error("Choose an empty directory for the API platform probe");
await run(framework, [process.execPath, "scripts/pack.ts"]);
const manifest = readJson(path.join(framework, "artifacts/packages/manifest.json"));
const packages = ["@legendapp/spark-clipboard", "@legendapp/spark-secure-storage", "@legendapp/spark-desktop-links", "@legendapp/spark-desktop-app", "@legendapp/spark-ui"];
const archives = { "@legendapp/spark": localArchive(path.join(framework, "artifacts/packages", manifest["@legendapp/spark"])) };
mkdirSync(root, { recursive: true }); writeFileSync(path.join(root, ".spark-api-probe"), "managed\n");
writeJson(path.join(root, "package.json"), {
  name: "spark-api-platform-probe", private: true, version: "1.0.0", main: "index.ts",
  dependencies: { ...archives, "@expo/ui": "0.2.0-beta.9", expo: "54.0.37", "expo-clipboard": "8.0.8", "expo-secure-store": "15.0.8", "expo-linking": "8.0.12", react: "19.1.4", "react-native": "0.81.6", "react-dom": "19.1.4", "react-native-web": "0.21.0" },
  overrides: { ...archives, expo: "54.0.37", "expo-constants": "18.0.14", "expo-modules-core": "3.0.30" },
});
writeJson(path.join(root, "app.json"), { expo: { name: "API Platform Probe", slug: "spark-api-probe", platforms: ["ios", "android", "web"] } });
writeFileSync(path.join(root, "metro.config.js"), 'const {getDefaultConfig} = require("expo/metro-config"); module.exports = getDefaultConfig(__dirname);\n');
writeFileSync(path.join(root, "index.ts"), 'import * as clipboard from "@legendapp/spark/clipboard";\nimport * as secureStore from "@legendapp/spark/secure-storage";\nimport * as linking from "@legendapp/spark/links";\nimport { Button } from "@legendapp/spark/ui";\n(globalThis as any).__API_PROBE__ = {clipboard, secureStore, linking, Button};\n');
const manager = packageManager(root);
const pkg = readJson(path.join(root, "package.json"));
applyOverrides(pkg, pkg.overrides, manager);
writeJson(path.join(root, "package.json"), pkg);
await run(root, managerCommand(manager, ["install"]));
const output = path.join(root, "results"); mkdirSync(output, { recursive: true });
const results = [];
for (const platform of ["ios", "android", "web"]) {
  const sourceMap = path.join(output, `${platform}.map`);
  await run(root, [binary(root, "expo"), "export:embed", "--entry-file", "index.ts", "--platform", platform, "--dev", "true", "--max-workers", "2", "--bundle-output", path.join(output, `${platform}.js`), "--sourcemap-output", sourceMap], { capture: true });
  const sources: string[] = readJson(sourceMap).sources;
  if (sources.some(source => source.includes("NativeDesktop") || (source.includes("desktop-app/src") && !source.includes("desktop-app/src/contracts/")) || source.includes("SparkButtonNativeComponent"))) throw new Error(`${platform} bundle loads desktop native modules`);
  for (const name of ["clipboard", "secure-storage", "desktop-links"]) {
    if (!sources.some(source => source.includes(`@legendapp/spark-${name}/src/index.${platform}.ts`))) throw new Error(`${platform} did not select ${name}'s platform adapter`);
  }
  if (!sources.some(source => source.includes(`@legendapp/spark-ui/src/index.${platform}.tsx`))) throw new Error(`${platform} did not select the UI adapter`);
  const expoUI = sources.filter(source => source.includes("@expo/ui/"));
  if (platform === "web" && expoUI.length) throw new Error("Web UI loaded Expo's native controls");
  if (platform !== "web" && !expoUI.some(source => source.includes(platform === "ios" ? "/swift-ui/Button/" : "/jetpack-compose/Button/"))) throw new Error(`${platform} UI did not load the Expo native button`);
  if (platform === "web" && sources.some(source => source.includes("expo-secure-store/"))) throw new Error("Web secure storage loaded an unavailable native backend");
  results.push({ platform, passed: true, modules: sources.length });
  console.log(`PASS [${platform}] packed adapters bundle without desktop native modules`);
}
// Expo Desktop intentionally uses this same Apple discovery command, with its Podfile opt-in flag.
const mobileEnv = { SPARK_DESKTOP_AUTOLINK: "" };
const config = JSON.parse(await run(root, [binary(root, "expo-modules-autolinking"), "react-native-config", "--platform", "ios", "--json"], { capture: true, env: mobileEnv }));
for (const name of packages) if (config.dependencies?.[name]?.platforms?.ios) throw new Error(`${name}'s AppKit pod leaks into mobile autolinking`);
writeJson(path.join(output, "summary.json"), { passed: true, results, mobileAutolinking: true, scope: "Bundling and autolinking only; not native mobile execution" });
console.log(`Platform adapter checks passed: ${output}`);
