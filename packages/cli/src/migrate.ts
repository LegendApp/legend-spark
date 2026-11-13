import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { supportedPlatforms } from "@legendapp/spark-desktop-config/config.cjs";
import { dependencyPinIssues, expectedDependencyPins, optionalBackendIssues, projectDependencies } from "./dependency-pins.ts";
import { applyMigrationPlan, planMigrations, printMigrationPlan } from "./migrations.cjs";
import { projectSparkVersion } from "./project-version.ts";
import { readJson } from "./json.ts";

export function migrate(root: string, { dryRun = false, init = false } = {}) {
  readJson(path.join(root, "package.json"));
  const version = projectSparkVersion(root);
  const plan = planMigrations(root, version, { fromVersion: init ? version : undefined });
  if (init && plan.previous !== version) throw new Error("spark migrate --init is only for newly generated projects without a receipt, or projects already at the installed version. Run spark migrate --dry-run to review the existing receipt's migrations.");
  console.log(`Spark ${plan.previous ?? "(unrecorded)"} → ${version}${init ? " — initialize generated project" : ""}${dryRun ? " — dry run" : ""}`);
  printMigrationPlan(plan);

  const blocked = plan.manualSteps.filter(step => step.requires).map(step => `${step.requires}: ${step.message}`);
  for (const change of plan.changes) {
    if (/(^|\/)(package\.json|(?:bun|package|npm-shrinkwrap|pnpm|yarn).*lock.*|pnpm-workspace\.yaml|\.npmrc|\.yarnrc\.yml|(?:desktop\.config|app|app\.config|metro\.config|react-native\.config)\.(?:json|[cm]?[jt]s))$/.test(change.file)) {
      blocked.push(`Install inputs or configuration would change: ${change.file}.`);
    }
  }
  const configFile = path.join(root, "desktop.config.json");
  if (existsSync(configFile) && !readJson(configFile).projectId) blocked.push("Template configuration is uninitialized. Create the project with expo-desktop create-app, then run node node_modules/@legendapp/spark/init-template.cjs.");
  if (plan.versions.includes("0.0.2")) {
    const req = createRequire(path.join(root, "package.json"));
    const platforms = supportedPlatforms(root);
    const pins = { ...expectedDependencyPins };
    if (platforms.includes("windows")) pins["react-native-windows"] = readJson(path.resolve(import.meta.dirname, "../templates/windows/package.json")).dependencies["react-native-windows"];
    for (const issue of dependencyPinIssues({ dependencies: projectDependencies(root, true) }, platforms, pins)) blocked.push(`Install inputs: pin ${issue.package} to ${issue.expected} in its owning manifest (found ${issue.found}).`);
    for (const [name, expected] of Object.entries(pins)) {
      if (name === "react-native-macos" && !platforms.includes("macos")) continue;
      let installed: string | undefined;
      try { installed = readJson(req.resolve(`${name}/package.json`)).version; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND") throw error; }
      if (installed !== expected) blocked.push(`Install ${name}@${expected}; resolved ${installed ?? "(missing)"}.`);
    }
    for (const issue of optionalBackendIssues(root, true)) blocked.push(`Install ${issue.package}@${issue.expected}: ${issue.where.join(" → ")}.`);
  }
  for (const reason of blocked) console.log(`Blocked: ${reason}`);
  if (blocked.length) {
    const guidance = "Migrations require an install or configuration changes. Resolve the listed requirements in the owning project, or run spark upgrade to update release inputs and install, then retry spark migrate.";
    if (!dryRun) throw new Error(`${guidance} No app files changed.`);
    console.log(guidance);
  } else if (!dryRun) {
    applyMigrationPlan(root, plan);
    console.log(`Migrated to installed Spark ${version}. Review .spark/upgrade-notes.md if present.`);
    return;
  }
  console.log("No app files changed.");
}
