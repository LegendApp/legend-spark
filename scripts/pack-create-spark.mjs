import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { packArchive } from "../packages/cli/src/pack-archive.ts";
import { validateRelease } from "../packages/cli/src/release.ts";

export async function packCreateSpark(root, output, release) {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "create-spark-package-"));
  try {
    const source = path.join(root, "packages/create-spark");
    const manifest = JSON.parse(readFileSync(path.join(source, "package.json"), "utf8"));
    const cli = JSON.parse(readFileSync(path.join(root, "packages/cli/package.json"), "utf8"));
    if (manifest.version !== cli.version) throw new Error("Create Spark and CLI versions must match");
    // Bundle the shared create implementation, with only installer tooling external.
    // This avoids installing the SDK's React/Expo peers just to create an app.
    const result = await Bun.build({
      entrypoints: [path.join(source, "src/index.ts")], outdir: path.join(temporary, "dist"),
      target: "node", external: Object.keys(manifest.dependencies),
    });
    if (!result.success) throw new Error(result.logs.join("\n"));
    cpSync(path.join(root, "packages/cli/src/npm-bin"), path.join(temporary, "dist/npm-bin"), { recursive: true });
    cpSync(path.join(root, "packages/cli/templates"), path.join(temporary, "templates"), { recursive: true });
    cpSync(path.join(root, "LICENSE"), path.join(temporary, "LICENSE"));
    writeFileSync(path.join(temporary, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
    if (release) writeFileSync(path.join(temporary, "dist/release.json"), JSON.stringify(validateRelease(release), null, 2) + "\n");
    const archive = path.join(temporary, "create-spark.tgz");
    await packArchive(temporary, archive);
    const hash = createHash("sha256").update(readFileSync(archive)).digest("hex").slice(0, 12);
    const file = `legendapp-create-spark-${manifest.version}-${hash}.tgz`;
    mkdirSync(output, { recursive: true });
    cpSync(archive, path.join(output, file));
    return file;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
