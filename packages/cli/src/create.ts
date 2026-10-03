import { installedRelease, materializeReleasePackages, packageSources, verifyMaterializedReleasePackages } from "./release.ts";
import { packageManager, managerCommand, applyOverrides, localArchive, type PackageManager } from "./package-manager.ts";
import { packArchive } from "./pack-archive.ts";
import { spawnProcess } from "./process.ts";
import { checkExpoDesktopNode } from "./expo-node.ts";
import { configureExample, type Example } from "./examples.ts";
import { hostPlatform, type AppPlatform } from "./platform.ts";
import { nodeCommand } from "./windows.ts";
import { cpSync, existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { readJson, writeJson } from "./project.ts";
import { run } from "./commands.ts";

// Resolve relative to the installed CLI so packed consumers use the same starter.
const template = path.resolve(import.meta.dirname, "../templates/blank-typescript");

export async function refreshLocalPackages(root: string, manifest: string, selectedManager?: PackageManager) {
  const pkg = readJson(path.join(root, "package.json"));
  // The template owns the tested compatibility matrix, not module inclusion.
  const pins = readJson(path.join(template, "package.json")).overrides;
  const manager = packageManager(root, selectedManager);
  const overrides = { ...pins };
  for (const [name, file] of Object.entries(readJson(manifest))) {
    const archive = localArchive(path.resolve(path.dirname(manifest), file as string));
    overrides[name] = archive;
    if (pkg.dependencies?.[name]) pkg.dependencies[name] = archive;
  }
  applyOverrides(pkg, overrides, manager);
  writeJson(path.join(root, "package.json"), pkg);
  await run(root, managerCommand(manager, ["install"]));
  upgradeManagedEntry(root);
}

export async function create(root: string, archiveManifest: string | undefined, platform: AppPlatform = hostPlatform(), universal = false, example?: Example, selectedManager?: PackageManager) {
  const manager = packageManager(process.cwd(), selectedManager);
  await checkExpoDesktopNode(path.resolve(import.meta.dirname, ".."));
  const variant = universal || example ? "universal" : platform === "macos" ? "blank-typescript" : "windows";
  const source = path.resolve(import.meta.dirname, "../templates", variant);
  const temporary = mkdtempSync(path.join(os.tmpdir(), "spark-create-"));
  const templateFile = path.join(temporary, "template.tgz");
  // Resolve archives on the recipient machine, immediately before Expo extracts
  // and installs the template. No producer-machine paths enter the SDK bundle.
  try {
    cpSync(source, temporary, { recursive: true });
    const pkg = readJson(path.join(temporary, "package.json"));
    const release = archiveManifest ? undefined : installedRelease();
    const archives = packageSources(archiveManifest, release);
    if (pkg.dependencies["@react-native-runtimes/core"] && !archives["@react-native-runtimes/core"]) throw new Error("This SDK lacks the patched Runtimes archive. Repack or install the complete SDK.");
    if (release) await materializeReleasePackages(release, temporary);
    const overrides: Record<string, string> = {};
    for (const [name, file] of Object.entries(archives)) {
      overrides[name] = file;
      if (pkg.dependencies[name]) pkg.dependencies[name] = file;
    }
    applyOverrides(pkg, overrides, manager);
    writeJson(path.join(temporary, "package.json"), pkg);

    if (manager === "yarn") writeFileSync(path.join(temporary, ".yarnrc.yml"), "nodeLinker: node-modules\n");
    if (manager === "pnpm") writeFileSync(path.join(temporary, ".npmrc"), "node-linker=hoisted\n");
    await packArchive(temporary, templateFile);
    if (release) verifyMaterializedReleasePackages(release, temporary);
    // The upstream CLI owns validation, extraction, app IDs, install, and Git setup.
    // The templates' postinstall initializes spark configuration once.
    const name = path.basename(root);
    // beta.5 misreads npm 12's record-shaped pack metadata for a local tarball.
    // Use the compatible npm executable for upstream extraction; the chosen manager installs.
    const npmBin = path.join(import.meta.dirname, "npm-bin");
    // Expo needs file: to distinguish Windows drive paths from npm package names.
    const child = spawnProcess(nodeCommand(path.resolve(import.meta.dirname, ".."), "expo-desktop", "expo-desktop", [
      "create-app", root, "--template", `file:${templateFile}`, "--yes", "--no-agents-md",
      "--display-name", name, "--rdns", `so.legend.spark.prototype.${name.toLowerCase()}`,
    ]), { cwd: process.cwd(), env: { ...process.env, PATH: `${npmBin}${path.delimiter}${process.env.PATH ?? ""}`, npm_config_user_agent: `${manager}/spark`, CI: "1", ...(manager === "yarn" ? { YARN_ENABLE_IMMUTABLE_INSTALLS: "false" } : {}) }, stdout: "inherit", stderr: "inherit" });
    if (await child.exited) throw new Error("Expo Desktop could not create the app. See its output above.");
  } finally { rmSync(temporary, { recursive: true, force: true }); }
  if (!archiveManifest) {
    const release = installedRelease();
    if (release) verifyMaterializedReleasePackages(release, root);
    const ignoreFile = path.join(root, ".gitignore");
    const ignore = existsSync(ignoreFile) ? readFileSync(ignoreFile, "utf8") : "";
    if (!ignore.includes("!/spark-packages/**")) writeFileSync(ignoreFile, `${ignore}${ignore.endsWith("\n") || !ignore ? "" : "\n"}\n# Spark verified release package inputs\n!/spark-packages/\n!/spark-packages/**\n`);
  }
  // Upstream can report success after an install failure. Require a usable CLI.
  if (!existsSync(path.join(root, "node_modules/@legendapp/spark/package.json"))) throw new Error(`Dependency installation failed. Run ${manager} install in ${root} and retry.`);
  if (example) {
    if (!archiveManifest) { const release = installedRelease(); if (release) verifyMaterializedReleasePackages(release, root); }
    await configureExample(root, example);
  }
  console.log(`Created ${root}.\n\n  cd ${JSON.stringify(root)}\n  ${manager} run ${platform}`);
}

export function upgradeManagedEntry(root: string) {
  const oldMetro = `const { makeMetroConfig } = require("expo-desktop-metro-config");
const { gate } = require("@legendapp/spark-cli/src/metro-gate.cjs");
const config = makeMetroConfig(__dirname);
config.server = { ...config.server, enhanceMiddleware: (middleware) => gate(__dirname, middleware) };
module.exports = config;
`;
  const oldEntry = 'import { registerRootComponent } from "expo";\nimport App from "./App";\nregisterRootComponent(App);\n';
  const metro = path.join(root, "metro.config.js"), entry = path.join(root, "index.ts");
  // Upgrade only the exact generated pair; customized entries remain user-owned.
  if (existsSync(metro) && existsSync(entry) && readFileSync(metro, "utf8") === oldMetro && readFileSync(entry, "utf8") === oldEntry) {
    for (const file of ["metro.config.js", "index.ts"]) cpSync(path.join(template, file), path.join(root, file));
  }
}
