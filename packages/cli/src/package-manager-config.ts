import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { writeJson } from "./json.ts";
import type { PackageManager } from "./package-manager.ts";

/** pnpm 11 reads installer settings from YAML; retain package.json settings for pnpm 10. */
export function writePackageConfig(root: string, pkg: any, manager: PackageManager, installRoot = root) {
  if (manager === "pnpm") {
    const file = path.join(root, "pnpm-workspace.yaml");
    const document = parseDocument(existsSync(file) ? readFileSync(file, "utf8") : "");
    if (document.errors.length) throw new Error(`Invalid pnpm configuration: ${document.errors[0]!.message}`);
    if (!document.has("nodeLinker")) document.set("nodeLinker", "hoisted");
    for (const [name, version] of Object.entries(pkg.pnpm?.overrides ?? {})) document.setIn(["overrides", name], version);
    for (const name of [...(pkg.pnpm?.onlyBuiltDependencies ?? [])]) {
      if (!document.hasIn(["allowBuilds", name])) document.setIn(["allowBuilds", name], true);
      const source = pkg.dependencies?.[name] ?? pkg.pnpm?.overrides?.[name];
      if (typeof source === "string" && source.startsWith("file:")) {
        const key = `${name}@file:${path.relative(installRoot, path.resolve(installRoot, source.slice(5))).replaceAll("\\", "/")}`;
        if (!document.hasIn(["allowBuilds", key])) document.setIn(["allowBuilds", key], document.getIn(["allowBuilds", name]));
        if (document.getIn(["allowBuilds", key]) === true && !pkg.pnpm.onlyBuiltDependencies.includes(key)) pkg.pnpm.onlyBuiltDependencies.push(key);
      }
    }
    if (pkg.pnpm?.onlyBuiltDependencies) pkg.pnpm.onlyBuiltDependencies = pkg.pnpm.onlyBuiltDependencies.filter((name: string) => document.getIn(["allowBuilds", name]) !== false);
    writeFileSync(file, document.toString());
  }
  writeJson(path.join(root, "package.json"), pkg);
}
