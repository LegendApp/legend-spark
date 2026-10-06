import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { installedPackages } from "../packages/cli/src/project.ts";

// Apply the same native adapters regardless of the selected package manager.
// Apply the checked-in SDK deltas after install, with no network or native tools.
// Atomic replacement avoids changing hardlinked package-manager cache files.
export function installWorkspaceAdapters(root: string) {
  const require = createRequire(import.meta.url);
  const { parsePatch, applyPatch, reversePatch } = require("diff");
  const config = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const installed = new Map(installedPackages(root).map(pkg => [pkg.name, pkg]));
  const pins = JSON.parse(readFileSync(path.join(root, "patches/workspace/upstream.json"), "utf8"));
  for (const [key, file] of Object.entries(config.sparkWorkspacePatches ?? {}) as [string, string][]) {
    const split = key.lastIndexOf("@"), name = key.slice(0, split), version = key.slice(split + 1);
    const pkg = installed.get(name);
    if (!pkg || pkg.json.version !== version) throw new Error(`Workspace adapter needs ${name}@${version}`);
    const pin = pins[name];
    if (!pin || pin.version !== version) throw new Error(`Workspace adapter has no matching upstream pin: ${name}@${version}`);
    const patchBytes = readFileSync(path.join(root, file));
    const patches = parsePatch(patchBytes.toString("utf8"));
    const directory = pkg.root;
    for (const patch of patches) {
      const relative = patch.newFileName.replace(/^b\//, "");
      const target = path.resolve(directory, relative);
      if (!target.startsWith(directory + path.sep) || patch.newFileName === "/dev/null") throw new Error(`Invalid workspace patch target: ${relative}`);
      let current = existsSync(target) ? readFileSync(target, "utf8") : "";
      if (relative === "package.json" && current) {
        const manifest = JSON.parse(current);
        if (manifest.spark && Object.hasOwn(manifest.spark, "workspacePatch")) {
          // The receipt is added after patching; exclude it from hunk matching.
          delete manifest.spark.workspacePatch;
          if (!Object.keys(manifest.spark).length) delete manifest.spark;
          current = JSON.stringify(manifest, null, 2) + "\n";
        }
      }
      // Re-running install is harmless. Changed patch inputs must still match
      // either the upstream file or the exact patch's already-applied context.
      if (applyPatch(current, reversePatch(patch)) !== false) continue;
      const next = applyPatch(current, patch);
      if (next === false) throw new Error(`Cannot apply ${file} to ${relative}. Reinstall dependencies with your package manager before retrying.`);
      mkdirSync(path.dirname(target), { recursive: true });
      const temporary = `${target}.spark-${process.pid}.tmp`;
      writeFileSync(temporary, next);
      renameSync(temporary, target);
    }
    // Receipt is written only after every hunk was verified as already applied
    // or applied successfully above. A changed recipe won't match this stamp.
    const manifestFile = path.join(directory, "package.json");
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
    manifest.spark ??= {};
    manifest.spark.workspacePatch = {
      schema: 1,
      version,
      patchHash: createHash("sha256").update(patchBytes).digest("hex"),
      upstreamIntegrity: pin.integrity,
      upstreamRevision: pin.revision ?? manifest.spark.upstreamRevision,
    };
    const temporary = `${manifestFile}.spark-${process.pid}.tmp`;
    const serialized = JSON.stringify(manifest, null, 2) + "\n";
    if (readFileSync(manifestFile, "utf8") !== serialized) {
      writeFileSync(temporary, serialized);
      renameSync(temporary, manifestFile);
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) installWorkspaceAdapters(path.resolve(import.meta.dirname, ".."));
