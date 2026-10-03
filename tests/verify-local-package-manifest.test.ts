import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { run } from "../packages/cli/src/commands.ts";
import { VERSION } from "../packages/cli/src/project.ts";
import { nativePatchRequirements } from "../scripts/native-patch-requirements.ts";
import { patchedPackageNames } from "../scripts/patch-inventory.ts";
import { verifyLocalPackageManifest } from "../scripts/verify-local-package-manifest.ts";

const framework = path.resolve(import.meta.dirname, "..");

test("local manifest acceptance checks all archives against current provenance and recipes", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-verified-packages-"));
  try {
    const output = path.join(root, "packages");
    mkdirSync(output);
    const requirements = nativePatchRequirements(framework, VERSION);
    const manifest: Record<string, string> = {};
    const provenance: Record<string, { file: string; sha256: string; patchHash: string; version: string }> = {};
    for (const name of patchedPackageNames) {
      const expected = requirements.packages[name];
      const filename = `fixture-${name.replaceAll("/", "-")}.tgz`;
      const metadata = { name, version: expected.version, spark: { patchHash: expected.patchHash, upstreamIntegrity: "upstreamIntegrity" in expected ? expected.upstreamIntegrity : undefined, upstreamRevision: "upstreamRevision" in expected ? expected.upstreamRevision : undefined } };
      const archive = await pack(root, output, filename, metadata);
      manifest[name] = filename;
      provenance[name] = { file: filename, sha256: hash(readFileSync(archive)), patchHash: expected.patchHash, version: expected.version };
    }
    const temporarySdk = await pack(root, output, "fixture-spark.tgz", { name: "@legendapp/spark", version: VERSION, spark: { nativePatchRequirements: requirements } });
    const sdkFile = `legendapp-spark-${VERSION}-${hash(readFileSync(temporarySdk)).slice(0, 12)}.tgz`;
    const sdk = path.join(output, sdkFile);
    renameSync(temporarySdk, sdk);
    manifest["@legendapp/spark"] = sdkFile;
    writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(path.join(output, "provenance.json"), JSON.stringify(provenance));

    const verified = await verifyLocalPackageManifest(framework, path.join(output, "manifest.json"));
    expect(verified.sdkFile).toBe(sdkFile);
    expect(verified.sdkSha256).toBe(hash(readFileSync(sdk)));

    const originalSdk = readFileSync(sdk);
    const alteredSdk = Buffer.from(originalSdk);
    alteredSdk[alteredSdk.length - 1] ^= 1;
    writeFileSync(sdk, alteredSdk);
    await expect(verifyLocalPackageManifest(framework, path.join(output, "manifest.json"))).rejects.toThrow("name or content hash");
    writeFileSync(sdk, originalSdk);

    const staleSdk = await pack(root, output, "fixture-stale-spark.tgz", { name: "@legendapp/spark", version: "0.0.0", spark: { nativePatchRequirements: requirements } });
    const staleFile = `legendapp-spark-${VERSION}-${hash(readFileSync(staleSdk)).slice(0, 12)}.tgz`;
    const renamedStale = path.join(output, staleFile);
    renameSync(staleSdk, renamedStale);
    writeFileSync(path.join(output, "manifest.json"), JSON.stringify({ ...manifest, "@legendapp/spark": staleFile }));
    await expect(verifyLocalPackageManifest(framework, path.join(output, "manifest.json"))).rejects.toThrow("unexpected package identity or version");
    writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest));

    writeFileSync(path.join(output, manifest["expo-audio"]!), "modified archive");
    await expect(verifyLocalPackageManifest(framework, path.join(output, "manifest.json"))).rejects.toThrow("modified after packing: expo-audio");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

async function pack(root: string, output: string, filename: string, metadata: unknown) {
  const stage = path.join(root, filename.replaceAll(".", "-"));
  const packageDirectory = path.join(stage, "package");
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(path.join(packageDirectory, "package.json"), JSON.stringify(metadata));
  const archive = path.join(output, filename);
  await run(root, ["tar", "-czf", archive, "-C", stage, "package"], { capture: true });
  return archive;
}

function hash(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
