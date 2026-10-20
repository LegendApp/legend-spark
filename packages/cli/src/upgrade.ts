import { enrichedHtmlPinPolicy, installWithEnrichedHtmlPins, repairEnrichedHtmlPins } from "./enriched-html-pins.ts";
import { writePackageConfig } from "./package-manager-config.ts";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import { supportedPlatforms } from "@legendapp/spark-desktop-config/config.cjs";
import { readJson } from "./json.ts";
import { installedSparkVersion } from "./migrations.cjs";
import { upgradeDependencyPins, printDependencyPins } from "./dependency-pins.ts";
import { packageManager } from "./package-manager.ts";

function cliRoot(spark: string) {
  const pkg = readJson(path.join(spark, "package.json"));
  const req = createRequire(path.join(spark, pkg.spark?.bundledModuleRoot ?? ".", "package.json"));
  return path.dirname(req.resolve("@legendapp/spark-cli/package.json"));
}

export async function upgrade(root: string, dryRun = false) {
  const pkg = readJson(path.join(root, "package.json"));
  if ([pkg.dependencies?.["@legendapp/spark"], pkg.devDependencies?.["@legendapp/spark"]].some(spec => typeof spec === "string" && /^(catalog|workspace):/.test(spec))) throw new Error("Spark is managed by a workspace or catalog. Update its owning manifest, then run spark upgrade.");
  const current = installedSparkVersion(root);
  const tooling = createRequire(createRequire(import.meta.url).resolve("npm/package.json"));
  const pacote = tooling("pacote");
  const { prerelease, valid, lt } = tooling("semver");
  const preview = prerelease(current);
  if (!valid(current) || (preview && preview[0] !== "next")) throw new Error(`Unsupported Spark release channel: ${current}. Use a next or stable release.`);
  const channel = preview ? "next" : "latest";
  const manager = packageManager(root);
  const temporary = mkdtempSync(path.join(os.tmpdir(), "spark-upgrade-"));
  try {
    // npm's shipped registry client verifies tarball integrity independently of
    // the app's installer. Use its public registry unless explicitly configured.
    const options = { cache: path.join(temporary, "cache"), registry: process.env.npm_config_registry };
    const release = await pacote.manifest(`@legendapp/spark@${channel}`, options);
    const version = release.version;
    if (!valid(version) || lt(version, current) || (prerelease(version)?.[0] ?? "latest") !== channel) throw new Error(`The ${channel} tag does not identify a compatible Spark update (${version}).`);
    const target = path.join(temporary, "spark");
    await pacote.extract(`@legendapp/spark@${version}`, target, { ...options, integrity: release.dist.integrity });
    if (readJson(path.join(target, "package.json")).version !== version) throw new Error("Downloaded Spark version does not match the registry.");
    const cli = cliRoot(target);
    const platforms = supportedPlatforms(root);
    const template = platforms.length > 1 ? "universal" : platforms.includes("windows") ? "windows" : "blank-typescript";
    const defaults: { dependencies: Record<string, string>; overrides: Record<string, string> } = readJson(path.join(cli, "templates", template, "package.json"));
    const webPins = enrichedHtmlPinPolicy(defaults.overrides);
    const releaseTools = await import(pathToFileURL(path.join(cli, "dist/release.js")).href);
    const manifest = releaseTools.installedRelease();
    const sources: Record<string, string> = releaseTools.packageSources(undefined, manifest);
    const webPin = (name: string) => name in webPins || name === "react-dom";
    const pins = Object.fromEntries(Object.entries({ ...defaults.overrides, ...defaults.dependencies, ...sources, "@legendapp/spark": version }).filter(([name]) => !webPin(name)));
    const requiredOverrides = {
      where: manager === "pnpm" ? ["pnpm", "overrides"] : [manager === "yarn" ? "resolutions" : "overrides"],
      pins: Object.fromEntries(Object.entries({ ...defaults.overrides, ...sources }).filter(([name]) =>
        !webPin(name) && (name !== "react-native-macos" || platforms.includes("macos")) && (name !== "react-native-windows" || platforms.includes("windows")))),
    };
    const issues = [...upgradeDependencyPins(root, true, pins, requiredOverrides), ...repairEnrichedHtmlPins(root, manager, true, webPins)];
    console.log(`Spark ${current} → ${version} (${channel})${dryRun ? " — dry run" : ""}`);
    printDependencyPins(issues);
    const targetMigrations: typeof import("./migrations.cjs") = createRequire(path.join(cli, "package.json"))("./dist/migrations.cjs");
    const plan = targetMigrations.planMigrations(root, version, { fromVersion: current });
    console.log(`Install: ${manager} install`);
    targetMigrations.printMigrationPlan(plan);
    if (dryRun) {
      console.log("No app files changed.");
      return;
    }
    // Verified patched packages must be present before changing their file: pins.
    await releaseTools.materializeReleasePackages(manifest, root);
    releaseTools.verifyMaterializedReleasePackages(manifest, root);
    // Scripts and native dependency declarations must reach the installer too.
    // Keep the old receipt until installation and finalization both succeed.
    targetMigrations.applyMigrationPlan(root, plan, false);
    upgradeDependencyPins(root, false, pins, requiredOverrides);
    writePackageConfig(root, readJson(path.join(root, "package.json")), manager, root, [...Object.keys(webPins), "react-dom"]);
    await installWithEnrichedHtmlPins(root, manager, webPins);
    const req = createRequire(path.join(root, "package.json"));
    // Read fresh bytes: the running process may have cached the old manifest.
    const installed = path.dirname(req.resolve("@legendapp/spark/package.json"));
    if (readJson(path.join(installed, "package.json")).version !== version) throw new Error(`Installation did not select Spark ${version}. Fix package-manager overrides and run spark upgrade again.`);
    const updatedCLI = cliRoot(installed);
    const { initializeTemplate } = createRequire(path.join(updatedCLI, "package.json"))("./dist/init-template.cjs");
    const { recordProjectVersion, refreshPointers } = createRequire(path.join(updatedCLI, "package.json"))("./dist/migrations.cjs");
    initializeTemplate(root);
    refreshPointers(root);
    recordProjectVersion(root, version);
    console.log(`Updated Spark to ${version}.`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
