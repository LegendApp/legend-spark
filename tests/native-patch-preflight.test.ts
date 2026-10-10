import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { installWorkspaceAdapters } from "../scripts/install-workspace-adapters.ts";
import { assertRuntimesRevision, nativePatchRequirements } from "../scripts/native-patch-requirements.ts";
import { runtimesRevision } from "../scripts/prepare-runtimes.ts";
import { assertNativePatchPreflight, validatePackedNativePatches, validateWorkspaceNativePatches } from "../packages/cli/src/native-patch-preflight.ts";
import { VERSION } from "../packages/cli/src/project.ts";
import { build } from "../packages/cli/src/build.ts";

const requiredNames = ["@react-native-runtimes/core", "react-native-nitro-modules", "@op-engineering/op-sqlite", "react-native-webview"];
const fixtureRequirements = {
  schema: 1 as const,
  frameworkVersion: VERSION,
  packages: Object.fromEntries(requiredNames.map(name => [name, {
    version: "1.0.0", patchHash: "a".repeat(64), upstreamIntegrity: "sha512-upstream",
  }])) as Record<string, { version: string; patchHash: string; upstreamIntegrity: string }>,
};
function packedFixtures(names = requiredNames) {
  return names.map(name => ({ name, json: { name, version: "1.0.0", spark: {
    sdk: true, patchHash: "a".repeat(64), upstreamIntegrity: "sha512-upstream",
  } } })) as any;
}

test("packed SDK records the exact patch recipes used by its public native packages", () => {
  const requirements = nativePatchRequirements(path.resolve(import.meta.dirname, ".."), VERSION);
  expect(requirements.schema).toBe(1);
  expect(requirements.frameworkVersion).toBe(VERSION);
  expect(requirements.packages["@react-native-runtimes/core"].upstreamRevision).toBe(runtimesRevision);
  expect(() => assertRuntimesRevision("different-revision")).toThrow("does not match the revision used by the native patch builder");
  expect(Object.keys(requirements.packages).sort()).toEqual([...requiredNames].sort());
  for (const record of Object.values(requirements.packages)) expect(record.patchHash).toMatch(/^[a-f0-9]{64}$/);
});

test("native preflight accepts a valid packed aggregate SDK and resolves provenance outside the filtered native set", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-native-packed-valid-"));
  try {
    const requirements = nativePatchRequirements(path.resolve(import.meta.dirname, ".."), VERSION);
    const names = [...requiredNames, "@legendapp/spark"];
    const dependencies = Object.fromEntries(names.map(name => [name, name === "@legendapp/spark" ? VERSION : requirements.packages[name as keyof typeof requirements.packages].version]));
    for (const name of names) {
      const directory = path.join(root, "node_modules", ...name.split("/"));
      mkdirSync(directory, { recursive: true });
      const record = requirements.packages[name as keyof typeof requirements.packages];
      const spark = name === "@legendapp/spark" ? { nativePatchRequirements: requirements } : {
        sdk: true,
        patchHash: record.patchHash,
        upstreamIntegrity: "upstreamIntegrity" in record ? record.upstreamIntegrity : undefined,
        upstreamRevision: "upstreamRevision" in record ? record.upstreamRevision : undefined,
      };
      writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name, version: dependencies[name], spark }));
    }
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app", dependencies }));
    expect(() => assertNativePatchPreflight(root)).not.toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("packed preflight accepts matching patches and rejects absent, wrong-version, and stale stamps", () => {
  expect(validatePackedNativePatches(packedFixtures(), fixtureRequirements)).toEqual([]);
  expect(validatePackedNativePatches(packedFixtures(), undefined).join(" ")).toContain("spark add desktop");
  const wrongVersion = packedFixtures(); wrongVersion[0].json.version = "2.0.0";
  expect(validatePackedNativePatches(wrongVersion, fixtureRequirements).join(" ")).toContain("matching patched");
  const stale = packedFixtures(); stale[1].json.spark.patchHash = "b".repeat(64);
  expect(validatePackedNativePatches(stale, fixtureRequirements).join(" ")).toContain("matching patched");
});

test("workspace adapter stamps only after every patch hunk is applied and verifies idempotently", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-native-patch-") );
  try {
    const packageName = "@react-native-runtimes/core", version = "1.0.0", packageRoot = path.join(root, "node_modules", "@react-native-runtimes", "core");
    const patchRelative = "patches/workspace/fixture-native@1.0.0.patch", patchFile = path.join(root, patchRelative);
    mkdirSync(packageRoot, { recursive: true }); mkdirSync(path.dirname(patchFile), { recursive: true });
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "spark-workspace", dependencies: { [packageName]: version }, sparkWorkspacePatches: { [`${packageName}@${version}`]: patchRelative } }));
    writeFileSync(path.join(root, "patches/workspace/upstream.json"), JSON.stringify({ [packageName]: { version, integrity: "sha512-upstream" } }));
    writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ name: packageName, version }));
    writeFileSync(path.join(packageRoot, "first.js"), "export const first = 1;\n");
    writeFileSync(path.join(packageRoot, "second.js"), "export const second = 1;\n");
    const patch = [
      "diff --git a/first.js b/first.js", "--- a/first.js", "+++ b/first.js", "@@ -1 +1,2 @@", " export const first = 1;", "+export const patched = true;",
      "diff --git a/second.js b/second.js", "--- a/second.js", "+++ b/second.js", "@@ -1 +1,2 @@", " export const second = 1;", "+export const patched = true;", "",
    ].join("\n");
    writeFileSync(patchFile, patch);

    installWorkspaceAdapters(root);
    const patched = readFileSync(path.join(packageRoot, "package.json"), "utf8");
    const manifest = JSON.parse(patched), patchHash = createHash("sha256").update(patch).digest("hex");
    expect(manifest.spark.workspacePatch).toEqual({ schema: 1, version, patchHash, upstreamIntegrity: "sha512-upstream" });
    expect(readFileSync(path.join(packageRoot, "second.js"), "utf8")).toContain("patched");
    installWorkspaceAdapters(root);
    expect(readFileSync(path.join(packageRoot, "package.json"), "utf8")).toBe(patched);

    const packages = [{ name: packageName, root: packageRoot, json: JSON.parse(patched) }] as any;
    const validReceiptErrors = validateWorkspaceNativePatches(root, packages);
    expect(validReceiptErrors.some(error => error.includes(packageName))).toBe(false);
    writeFileSync(patchFile, patch + "# recipe changed\n");
    expect(validateWorkspaceNativePatches(root, packages).join(" ")).toContain("matching applied workspace patch stamp");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("workspace receipt is not written when a later patch hunk fails", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-native-patch-fail-"));
  try {
    const packageName = "fixture-native", version = "1.0.0", packageRoot = path.join(root, "node_modules", packageName);
    const patchRelative = "patches/workspace/fixture-native@1.0.0.patch", patchFile = path.join(root, patchRelative);
    mkdirSync(packageRoot, { recursive: true }); mkdirSync(path.dirname(patchFile), { recursive: true });
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "spark-workspace", dependencies: { [packageName]: version }, sparkWorkspacePatches: { [`${packageName}@${version}`]: patchRelative } }));
    writeFileSync(path.join(root, "patches/workspace/upstream.json"), JSON.stringify({ [packageName]: { version, integrity: "sha512-upstream" } }));
    writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ name: packageName, version }));
    writeFileSync(path.join(packageRoot, "first.js"), "export const first = 1;\n");
    writeFileSync(path.join(packageRoot, "second.js"), "export const second = changed;\n");
    writeFileSync(patchFile, [
      "diff --git a/first.js b/first.js", "--- a/first.js", "+++ b/first.js", "@@ -1 +1,2 @@", " export const first = 1;", "+export const patched = true;",
      "diff --git a/second.js b/second.js", "--- a/second.js", "+++ b/second.js", "@@ -1 +1,2 @@", " export const second = 1;", "+export const patched = true;", "",
    ].join("\n"));

    expect(() => installWorkspaceAdapters(root)).toThrow("Cannot apply");
    expect(JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")).spark).toBeUndefined();
    expect(existsSync(path.join(packageRoot, "first.js"))).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("build rejects missing SDK provenance before creating its preparation lock", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-native-build-gate-"));
  try {
    mkdirSync(path.join(root, "node_modules/@legendapp/spark"), { recursive: true });
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app", dependencies: { "@legendapp/spark": "1.0.0" } }));
    writeFileSync(path.join(root, "node_modules/@legendapp/spark/package.json"), JSON.stringify({ name: "@legendapp/spark", version: "1.0.0" }));
    await expect(build(root, "dev")).rejects.toThrow("Native preparation stopped before changing project files");
    expect(existsSync(path.join(root, ".spark/build.lock"))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
