import { packArchive } from "../packages/cli/src/pack-archive.ts";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, copyFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { readJson, writeJson } from "../packages/cli/src/project.ts";

export async function packTemplates(root: string, output: string, packages: Record<string, string>) {
  const templates: Record<string, string> = {};
  const sdk = Object.entries(packages);
  const local = Object.fromEntries(sdk.map(([name, file]) => [name, `file:./sdk/${file}`]));
  for (const [variant, folder] of Object.entries({ macos: "blank-typescript", windows: "windows", universal: "universal" })) {
    const source = path.join(root, "packages/cli/templates", folder);
    const pkg = readJson(path.join(source, "package.json"));
    // Every desktop SDK carries the pinned cross-platform Runtimes archive.
    if (pkg.dependencies["@react-native-runtimes/core"] && !local["@react-native-runtimes/core"]) continue;
    const temporary = mkdtempSync(path.join(os.tmpdir(), "spark-template-"));
    try {
      cpSync(source, temporary, { recursive: true });
      // Expo extracts templates into a new app before installing. Carry the local
      // SDK with the template so file dependencies resolve on any recipient.
      mkdirSync(path.join(temporary, "sdk"));
      for (const [, file] of sdk) copyFileSync(path.join(output, file), path.join(temporary, "sdk", file));
      for (const name of Object.keys(pkg.dependencies)) if (local[name]) pkg.dependencies[name] = local[name];
      pkg.overrides = { ...pkg.overrides, ...local };
      writeJson(path.join(temporary, "package.json"), pkg);
      const archive = path.join(temporary, "template.tgz");
      await packArchive(temporary, archive);
      const hash = createHash("sha256").update(readFileSync(archive)).digest("hex").slice(0, 12);
      const file = `${pkg.name}-${hash}.tgz`;
      copyFileSync(archive, path.join(output, file)); templates[variant] = file;
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  }
  writeJson(path.join(output, "templates.json"), templates);
}
