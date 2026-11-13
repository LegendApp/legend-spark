import { initializeTemplate } from "./init-template.cjs";
import { installedSparkVersion, migrateProject } from "./migrations.cjs";
import { fileURLToPath } from "node:url";
import { readJson } from "./json.ts";

const version = readJson(fileURLToPath(new URL("../package.json", import.meta.url))).version;

export function projectSparkVersion(root: string) {
  const installed = installedSparkVersion(root);
  if (installed !== version) throw new Error(`This CLI is Spark ${version}, but the app has ${installed}. Run spark upgrade using the app's installed CLI.`);
  return installed;
}

export function ensureProjectVersion(root: string) {
  migrateProject(root, projectSparkVersion(root));
  initializeTemplate(root, false);
}
