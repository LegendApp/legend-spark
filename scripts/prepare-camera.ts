import { writePackageConfig } from "../packages/cli/src/package-manager-config.ts";
import { packArchive } from "../packages/cli/src/pack-archive.ts";
import { applyOverrides, localArchive, managerCommand, packageManager } from "../packages/cli/src/package-manager.ts";
import { createHash } from "node:crypto";
import { cpSync, readFileSync } from "node:fs";
import path from "node:path";
import { run } from "../packages/cli/src/commands.ts";
import { readJson } from "../packages/cli/src/project.ts";

const framework = path.resolve(import.meta.dirname, "..");
export async function installCameraPackages(root: string) {
  const packages: Record<string, string> = {};
  const probe = path.join(framework, "examples/camera/nitro-view-probe");
  const output = path.join(framework, "artifacts/camera/packages/nitro-view-probe.tgz");
  await packArchive(probe, output);
  const hash = createHash("sha256").update(readFileSync(output)).digest("hex").slice(0, 12);
  const immutable = output.replace(".tgz", `-${hash}.tgz`); cpSync(output, immutable);
  packages["@legendapp/spark-nitro-view-probe"] = immutable;
  const pkg = readJson(path.join(root, "package.json"));
  const manager = packageManager(root);
  const dependencies = Object.fromEntries(Object.entries(packages).map(([name, archive]) => [name, localArchive(archive)]));
  pkg.dependencies = { ...pkg.dependencies, ...dependencies };
  applyOverrides(pkg, dependencies, manager);
  writePackageConfig(root, pkg, manager);
  await run(root, managerCommand(manager, ["install"]), { capture: true });
  return packages;
}
