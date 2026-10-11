import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { run } from "../packages/cli/src/commands.ts";
import { readJson, VERSION } from "../packages/cli/src/project.ts";
import { nativePatchRequirements } from "./native-patch-requirements.ts";
import { patchedPackageNames, validatePatchedArchive, type PackageProvenance } from "./patch-inventory.ts";

export async function verifyLocalPackageManifest(root: string, manifestPath: string) {
  const directory = path.dirname(manifestPath);
  const manifest = readJson(manifestPath) as Record<string, unknown>;
  const provenance = readJson(path.join(directory, "provenance.json")) as Record<string, PackageProvenance>;
  const sdkFile = manifest["@legendapp/spark"];
  if (typeof sdkFile !== "string") throw new Error("Local package manifest is missing @legendapp/spark.");

  const archivePath = (name: string, value: unknown) => {
    if (typeof value !== "string" || path.basename(value) !== value || !value.endsWith(".tgz")) throw new Error(`Invalid package archive path: ${name}`);
    const file = path.join(directory, value);
    if (!existsSync(file)) throw new Error(`Package archive is missing: ${name} (${file})`);
    return file;
  };
  for (const [name, file] of Object.entries(manifest)) archivePath(name, file);

  const sdkPath = archivePath("@legendapp/spark", sdkFile);
  const sdkSha256 = createHash("sha256").update(readFileSync(sdkPath)).digest("hex");
  if (!new RegExp(`^legendapp-spark-${VERSION.replaceAll(".", "\\.")}-([a-f0-9]{12})\\.tgz$`).test(sdkFile) || !sdkSha256.startsWith(sdkFile.slice(-16, -4))) {
    throw new Error("Local Spark archive name or content hash does not match the current SDK version.");
  }
  const sdk = JSON.parse(await run(root, ["tar", "-xOzf", sdkPath, "package/package.json"], { capture: true }));
  if (sdk.name !== "@legendapp/spark" || sdk.version !== VERSION) throw new Error("Local Spark archive has an unexpected package identity or version.");
  const requirements = nativePatchRequirements(root, VERSION);
  if (JSON.stringify(sdk.spark?.nativePatchRequirements) !== JSON.stringify(requirements)) throw new Error("Local Spark archive native patch requirements do not match the checked-in recipes.");

  for (const name of patchedPackageNames) {
    const filename = manifest[name];
    const file = archivePath(name, filename);
    const expected = requirements.packages[name];
    const record = provenance[name];
    const bytes = readFileSync(file);
    if (!record || createHash("sha256").update(bytes).digest("hex") !== record.sha256) throw new Error(`Patched archive was modified after packing: ${name}`);
    const metadata = JSON.parse(await run(root, ["tar", "-xOzf", file, "package/package.json"], { capture: true }));
    validatePatchedArchive(name, filename as string, bytes, record, metadata, expected.patchHash, expected.version, {
      upstreamIntegrity: "upstreamIntegrity" in expected ? expected.upstreamIntegrity : undefined,
      upstreamRevision: "upstreamRevision" in expected ? expected.upstreamRevision : undefined,
    });
  }

  return {
    sdkFile,
    sdkSha256,
    requirements,
  };
}
