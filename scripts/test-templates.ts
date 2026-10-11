import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { create } from "../packages/cli/src/create.ts";
import { run } from "../packages/cli/src/commands.ts";
import { nodeCommand } from "../packages/cli/src/process.ts";
import { readJson } from "../packages/cli/src/project.ts";

const framework = path.resolve(import.meta.dirname, "..");
await run(framework, [process.execPath, "scripts/pack.ts"]);
const manifest = path.join(framework, "artifacts/packages/manifest.json");
const templates = readJson(path.join(path.dirname(manifest), "templates.json"));
const parent = mkdtempSync(path.join(os.tmpdir(), "Spark Template Checks "));
const roots = [];
for (const platform of ["macos", "windows"] as const) {
  const root = path.join(parent, platform === "macos" ? "MacSettings" : "WindowsSettings");
  await create(root, manifest, platform); roots.push(root);
  const config = readJson(path.join(root, "desktop.config.json"));
  if (config.platforms.join() !== platform) throw new Error(`Wrong ${platform} target`);
}
// Call the real upstream CLI from an installed consumer: no Spark creation path.
const consumer = roots[0]!;
const req = createRequire(path.join(consumer, "package.json"));
const sdk = req.resolve("@legendapp/spark/package.json");
const cli = path.dirname(createRequire(path.join(path.dirname(sdk), req("@legendapp/spark/package.json").spark?.bundledModuleRoot ?? ".", "package.json")).resolve("@legendapp/spark-cli/package.json"));
const direct = path.join(parent, "DirectUniversal");
await run(consumer, nodeCommand(consumer, "expo-desktop", "expo-desktop", ["create-app", direct,
  "--template", path.join(path.dirname(manifest), templates.universal), "--yes", "--no-agents-md",
  "--display-name", "Direct Universal", "--rdns", "org.example.directsettings"],
), { env: { CI: "1", npm_config_user_agent: "npm/spark-tests", PATH: `${path.join(cli, "dist/npm-bin")}${path.delimiter}${process.env.PATH}` } });
roots.push(direct);
for (const root of roots) {
  const config = readJson(path.join(root, "desktop.config.json"));
  if (!config.projectId || config.name !== path.basename(root)) throw new Error("Upstream identity was not initialized");
  if (!existsSync(path.join(root, ".gitignore")) || existsSync(path.join(root, "gitignore"))) throw new Error("Upstream ignore-file extraction failed");
  if (["macos", "windows", "ios", "android"].some(p => existsSync(path.join(root, p)))) throw new Error("Creation unexpectedly prebuilt a native project");
  if (readdirSync(root).includes("App.windows.tsx")) throw new Error("Template contains the other starter's screen");
  const configBefore = readFileSync(path.join(root, "desktop.config.json"), "utf8");
  await run(root, ["node", "node_modules/@legendapp/spark/init-template.cjs"]);
  if (readFileSync(path.join(root, "desktop.config.json"), "utf8") !== configBefore) throw new Error("Initializer overwrote configuration");
  await run(root, ["node", "node_modules/typescript/bin/tsc", "--noEmit"], { capture: true });
  console.log(`PASS ${path.basename(root)}: real Expo Desktop extraction, install, identity, and TypeScript`);
}
const config = readJson(path.join(direct, "desktop.config.json"));
if (config.macos.bundleIdentifier !== "org.example.directsettings" || config.expo.ios.bundleIdentifier !== "org.example.directsettings" || config.platforms.length !== 5) throw new Error("Direct template lost native IDs or supported targets");
console.log(`Template consumers: ${parent}`);
