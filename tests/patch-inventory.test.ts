import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, cpSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { patchedPackageNames, validatePatchedArchive, type PackageProvenance } from "../scripts/patch-inventory.ts";
import { readJson } from "../packages/cli/src/project.ts";
import { windowsPatchHash } from "../scripts/prepare-windows-libraries.ts";

const root = path.resolve(import.meta.dirname, "..");

test("workspace patch and packaged release inventories contain the same five patched dependencies", () => {
  const workspace = readJson(path.join(root, "package.json")).sparkWorkspacePatches;
  const workspaceNames = Object.keys(workspace).map(key => key.slice(0, key.lastIndexOf("@"))).sort();
  expect(workspaceNames).toEqual([...patchedPackageNames].sort());
});

test("release provenance rejects stale, missing, or modified patched archives", () => {
  const name = "expo-audio", filename = "expo-audio-1.1.1-a1b2c3.tgz", bytes = Buffer.from("archive fixture");
  const patchHash = "a".repeat(64), version = "1.1.1";
  const record: PackageProvenance = { file: filename, sha256: "", patchHash, version };
  const validRecord = { ...record, sha256: hash(bytes) };
  const source = { upstreamIntegrity: "sha512-test" };
  const metadata = { name, version, spark: { ...source, patchHash } };
  expect(() => validatePatchedArchive(name, filename, bytes, validRecord, metadata, patchHash, version, source)).not.toThrow();
  expect(() => validatePatchedArchive(name, filename, Buffer.from("changed archive"), validRecord, metadata, patchHash, version, source)).toThrow("modified");
  expect(() => validatePatchedArchive(name, filename, bytes, validRecord, metadata, "b".repeat(64), version, source)).toThrow("Stale");
  expect(() => validatePatchedArchive(name, filename, bytes, undefined, metadata, patchHash, version, source)).toThrow("provenance");
});

test("native archive recipe identity changes with workspace, Windows, and macOS patches", () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "spark-patch-recipe-"));
  try {
    const workspace = path.join(fixture, "patches/workspace"), adapter = path.join(fixture, "patches/windows/nitro/windows");
    mkdirSync(workspace, { recursive: true }); mkdirSync(adapter, { recursive: true });
    const camera = path.join(fixture, "patches/camera"); mkdirSync(camera, { recursive: true });
    const macOSPatch = path.join(camera, "react-native-nitro-modules.patch");
    writeFileSync(macOSPatch, "macOS fixture\n");
    writeFileSync(path.join(workspace, "upstream.json"), JSON.stringify({ "react-native-nitro-modules": { version: "0.37.0" } }));
    const patch = path.join(workspace, "react-native-nitro-modules@0.37.0.patch");
    writeFileSync(patch, "diff --git a/file b/file\nfirst\n");
    writeFileSync(path.join(adapter, "adapter.cpp"), "adapter fixture\n");
    cpSync(path.join(root, "patches/licenses"), path.join(fixture, "patches/licenses"), { recursive: true });
    const pin = { version: "0.37.0", integrity: "sha512-fixture" };
    const before = windowsPatchHash("react-native-nitro-modules", pin, fixture);
    writeFileSync(patch, "diff --git a/file b/file\nsecond\n");
    const afterPatch = windowsPatchHash("react-native-nitro-modules", pin, fixture);
    expect(afterPatch).not.toBe(before);
    writeFileSync(path.join(adapter, "adapter.cpp"), "changed adapter fixture\n");
    expect(windowsPatchHash("react-native-nitro-modules", pin, fixture)).not.toBe(afterPatch);
    const afterWindows = windowsPatchHash("react-native-nitro-modules", pin, fixture);
    writeFileSync(macOSPatch, "changed macOS fixture\n");
    expect(windowsPatchHash("react-native-nitro-modules", pin, fixture)).not.toBe(afterWindows);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

function hash(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
