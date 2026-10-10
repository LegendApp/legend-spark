import { managerCommand, packageManager } from "../packages/cli/src/package-manager.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
import { run } from "../packages/cli/src/commands.ts";
import { addDesktop } from "../packages/cli/src/add-desktop.ts";
import { readJson, sourceMapSources, writeJson } from "../packages/cli/src/project.ts";
import { nodeCommand } from "../packages/cli/src/windows.ts";

const framework = path.resolve(import.meta.dirname, "..");
const root = path.resolve(process.argv[2] ?? `/tmp/ExistingExpo${Date.now()}`);
if (existsSync(root)) throw new Error("Choose a fresh fixture directory");
mkdirSync(path.join(root, "src"), { recursive: true });
writeJson(path.join(root, "package.json"), { name: "existing-expo", version: "1.0.0", private: true, main: "src/bootstrap.ts", packageManager: `npm@${(await run(framework, ["npm", "--version"], { capture: true })).trim()}`,
  scripts: { start: "expo start", ios: "expo run:ios", android: "expo run:android", web: "expo start --web", macos: "echo existing script" },
  dependencies: { expo: "58.0.7", react: "19.3.0", "react-native": "0.88.0-rc.4", "react-dom": "19.3.0", "react-native-web": "0.21.4" },
  devDependencies: { typescript: "5.9.3", "@types/react": "19.3.0" },
});
writeJson(path.join(root, "app.json"), { expo: { name: "ExistingApp", slug: "existing-app", version: "1.2.3", platforms: ["ios", "android", "web"], ios: { bundleIdentifier: "org.example.existing" }, android: { package: "org.example.existing" }, extra: { original: true } } });
writeFileSync(path.join(root, "app.config.ts"), 'import type { ConfigContext } from "expo/config";\nexport default ({ config }: ConfigContext) => ({ ...config, extra: { ...config.extra, environment: process.env.APP_ENV ?? "local" }, plugins: ["./plugin.cjs"] });\n');
writeFileSync(path.join(root, "plugin.cjs"), 'module.exports = config => { config.extra.pluginRetained = true; return config; };\n');
writeFileSync(path.join(root, "metro.config.js"), 'const { getDefaultConfig } = require("expo/metro-config");\nconst config = getDefaultConfig(__dirname);\nconfig.resolver.sourceExts.push("custom");\nconfig.resolver.resolveRequest = (context, name, platform) => context.resolveRequest(context, name === "app-label" ? require("node:path").join(__dirname, "src/label") : name, platform);\nmodule.exports = config;\n');
writeFileSync(path.join(root, "react-native.config.js"), 'module.exports = { assets: ["./fonts"], dependencies: { "not-installed": { platforms: { ios: null } } } };\n');
writeFileSync(path.join(root, "src/bootstrap.ts"), 'import { registerRootComponent } from "expo";\nimport App from "./App";\nregisterRootComponent(App);\n');
writeFileSync(path.join(root, "src/label.ts"), 'export default "Existing Expo app on desktop";\n');
writeFileSync(path.join(root, "src/App.tsx"), 'import { Text, View } from "react-native";\nimport label from "app-label";\nexport default function App() { return <View><Text>{label}</Text></View>; }\n');
writeFileSync(path.join(root, "src/types.d.ts"), 'declare module "app-label" { const label: string; export default label; }\n');
writeJson(path.join(root, "tsconfig.json"), { extends: "expo/tsconfig.base", compilerOptions: { strict: true } });
const originalPkg = readJson(path.join(root, "package.json"));
const unchanged = ["app.json", "plugin.cjs", "src/bootstrap.ts", "src/App.tsx", "src/label.ts", "tsconfig.json"];
const before = unchanged.map(file => readFileSync(path.join(root, file), "utf8"));
await run(root, managerCommand(packageManager(root), ["install"]));
await run(root, nodeCommand(root, "expo", "expo", ["export:embed", "--entry-file", originalPkg.main, "--platform", "ios", "--dev", "true", "--max-workers", "2", "--bundle-output", path.join(root, "baseline.js")]), { capture: true });
const packageBeforeGeneration = readFileSync(path.join(root, "package.json"), "utf8");
try {
  await run(root, nodeCommand(root, "expo", "expo", ["prebuild", "--platform", "ios", "--no-install"]), { capture: true, env: { CI: "1" } });
} finally { writeFileSync(path.join(root, "package.json"), packageBeforeGeneration); }
function nativeHash(dir: string): string {
  const hash = createHash("sha256");
  function visit(folder: string) {
    for (const item of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(folder, item.name);
      if (item.isDirectory()) visit(file); else if (item.isFile()) hash.update(path.relative(dir, file)).update(readFileSync(file));
    }
  }
  visit(dir); return hash.digest("hex");
}
const iosBefore = nativeHash(path.join(root, "ios"));
const config = async (platform?: string) => JSON.parse(await run(root, nodeCommand(root, "expo", "expo", ["config", "--json"]), { capture: true, env: { SPARK_PLATFORM: platform ?? "", APP_ENV: "integration" } }));
const mobileBefore = await config();
await run(framework, [process.execPath, "scripts/pack.ts"]);
const manifest = path.join(framework, "artifacts/packages/manifest.json");
const customMetro = readFileSync(path.join(root, "metro.config.js"), "utf8");
writeFileSync(path.join(root, "metro.config.js"), "module.exports = {};\n");
await assert.rejects(addDesktop(root, manifest), /Cannot safely compose/);
assert.equal(existsSync(path.join(root, "desktop.config.json")), false);
assert.deepEqual(readJson(path.join(root, "package.json")), originalPkg);
writeFileSync(path.join(root, "metro.config.js"), customMetro);
await addDesktop(root, manifest);
const pkg = readJson(path.join(root, "package.json"));
assert.equal(pkg.main, originalPkg.main);
for (const [name, command] of Object.entries(originalPkg.scripts)) assert.equal(pkg.scripts[name], command);
assert.equal(pkg.scripts["spark:macos"], "spark dev --platform macos");
assert.deepEqual(await config(), mobileBefore);
for (const platform of ["ios", "android", "web"]) assert.deepEqual(await config(platform), mobileBefore);
for (const platform of ["macos", "windows"]) {
  const value = await config(platform);
  assert.deepEqual(value.platforms, [platform]);
  assert.equal(value.extra.environment, "integration");
  assert.equal(value.extra.pluginRetained, true);
  assert.equal(value.extra.spark.projectId, readJson(path.join(root, "desktop.config.json")).projectId);
  await run(root, ["node", "-e", `const assert = require('node:assert/strict'); const config = require('./metro.config'); const rewritten = config.server.rewriteRequestUrl('/index${platform === "windows" ? ".windows" : ""}.bundle?platform=${platform}&dev=true'); assert.ok(rewritten.startsWith('/src/bootstrap.bundle?'), rewritten); assert.ok(config.resolver.sourceExts.includes('custom'));`], { capture: true, env: { SPARK_PLATFORM: platform } });
}
await run(root, ["node", "-e", `const assert = require('node:assert/strict'); const { readConfig } = require('@legendapp/spark/config'); const a = readConfig(${JSON.stringify(root)}, 'macos'); const b = readConfig(${JSON.stringify(realpathSync(root))}, 'macos'); assert.deepEqual(a, b); assert.equal(a.expo._internal, undefined);`], { capture: true });
const managed = ["package.json", "app.config.ts", "metro.config.js", "react-native.config.js", "desktop.config.json", ".gitignore"];
const integrated = managed.map(file => readFileSync(path.join(root, file), "utf8"));
await addDesktop(root, manifest);
assert.deepEqual(managed.map(file => readFileSync(path.join(root, file), "utf8")), integrated);
assert.deepEqual(unchanged.map(file => readFileSync(path.join(root, file), "utf8")), before);
await run(root, ["node", "node_modules/typescript/bin/tsc", "--noEmit"], { capture: true });
console.log("PASS existing Expo config, plugins, source entry, custom Metro, scripts, and repeated integration");
const output = path.join(root, ".spark/adoption-checks"); mkdirSync(output, { recursive: true });
for (const platform of ["ios", "android", "web", "macos", "windows"]) {
  const map = path.join(output, `${platform}.map`);
  await run(root, nodeCommand(root, "expo", "expo", ["export:embed", "--entry-file", pkg.main, "--platform", platform, "--dev", "true", "--max-workers", "2", "--bundle-output", path.join(output, `${platform}.js`), "--sourcemap-output", map]), { capture: true, env: { SPARK_PLATFORM: platform, CI: "1" } });
  const sources = sourceMapSources(readJson(map));
  assert.ok(sources.some(file => file.endsWith("src/bootstrap.ts")));
  assert.ok(sources.some(file => file.endsWith("src/label.ts")));
  console.log(`PASS ${platform}: original entry and custom Metro resolver`);
}
await run(root, [process.execPath, "node_modules/@legendapp/spark/bin/spark.cjs", "prebuild", "--platform", "windows"], { capture: true, env: { CI: "1" } });
assert.equal(nativeHash(path.join(root, "ios")), iosBefore);
assert.deepEqual(unchanged.map(file => readFileSync(path.join(root, file), "utf8")), before);
assert.deepEqual(managed.map(file => readFileSync(path.join(root, file), "utf8")), integrated);
console.log("PASS Windows generation preserves existing iOS project and shared app files");
console.log(`Existing Expo fixture: ${root}`);

// Also cover the common static-config app using Expo's default AppEntry.
const simple = `${root}Static`;
if (existsSync(simple)) throw new Error("Choose a fresh static fixture directory");
mkdirSync(simple);
const { main: _main, ...simplePkg } = originalPkg;
writeJson(path.join(simple, "package.json"), simplePkg);
writeJson(path.join(simple, "app.json"), { expo: { name: "StaticApp", slug: "static-app", ios: { bundleIdentifier: "org.example.static" } } });
writeFileSync(path.join(simple, "App.tsx"), 'import { Text } from "react-native";\nexport default function App() { return <Text>Static Expo app</Text>; }\n');
const simpleConfig = readFileSync(path.join(simple, "app.json"), "utf8");
await run(simple, managerCommand(packageManager(simple), ["install"]));
await addDesktop(simple, manifest);
assert.equal(readFileSync(path.join(simple, "app.json"), "utf8"), simpleConfig);
assert.equal(readJson(path.join(simple, "package.json")).main, undefined);
await run(simple, ["node", "-e", "const assert = require('node:assert/strict'); const c = require('./metro.config'); assert.ok(c.server.rewriteRequestUrl('/index.bundle?platform=macos&dev=true').includes('/node_modules/expo/AppEntry.bundle?'));"], { capture: true, env: { SPARK_PLATFORM: "macos" } });
await run(simple, nodeCommand(simple, "expo", "expo", ["export:embed", "--entry-file", "node_modules/expo/AppEntry.js", "--platform", "macos", "--dev", "true", "--max-workers", "2", "--bundle-output", path.join(simple, ".spark/static.js")]), { capture: true, env: { SPARK_PLATFORM: "macos", CI: "1" } });
console.log("PASS static app.json and default Expo entry without rewriting main or application source");
