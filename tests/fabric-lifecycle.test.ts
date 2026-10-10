import { expect, test } from "vitest";
import os from "node:os";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, linkSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { patchSurface, installSurfaceLifecyclePatch } = require("../packages/config-plugin/fabric-lifecycle.cjs");
const source = readFileSync(path.join(path.dirname(require.resolve("react-native-macos/package.json")), "React/Fabric/Surface/RCTFabricSurface.mm"), "utf8");
test("Fabric compatibility patch is idempotent against the installed pinned source", () => {
  const patched = patchSurface(source);
  expect(patchSurface(patched)).toBe(patched);
  expect(patched).toContain("NSUInteger _surfaceLifecycleGeneration;");
});
test("Fabric compatibility patch refuses changed upstream lifecycle code", () => {
  expect(() => patchSurface(source.replace("- (void)start\n", "- (void)changedStart\n"))).toThrow("source changed");
});

test("Fabric patch updates pristine upstream lifecycle while preserving surrounding source", () => {
  const original = readFileSync(new URL("./fixtures/fabric-surface-lifecycle.mm", import.meta.url), "utf8");
  const patched = patchSurface(original);
  expect(patched).not.toBe(original);
  expect(patchSurface(patched)).toBe(patched);
  expect(patched.startsWith("// Lifecycle excerpt")).toBe(true);
});

test("consumer patch is version-gated and does not modify a hardlinked package cache", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-fabric-patch-"));
  try {
    const pkg = path.join(root, "node_modules/react-native-macos");
    const surface = path.join(pkg, "React/Fabric/Surface/RCTFabricSurface.mm");
    mkdirSync(path.dirname(surface), { recursive: true });
    const manifest = path.join(pkg, "package.json");
    writeFileSync(manifest, JSON.stringify({ name: "react-native-macos", version: "0.88.0-rc.4" }));
    const original = readFileSync(new URL("./fixtures/fabric-surface-lifecycle.mm", import.meta.url), "utf8");
    const cache = path.join(root, "cached.mm"); writeFileSync(cache, original); linkSync(cache, surface);
    installSurfaceLifecyclePatch(root);
    expect(readFileSync(cache, "utf8")).toBe(original);
    expect(readFileSync(surface, "utf8")).toBe(patchSurface(original));
    const inode = statSync(surface).ino; installSurfaceLifecyclePatch(root);
    expect(statSync(surface).ino).toBe(inode);
    writeFileSync(manifest, JSON.stringify({ name: "react-native-macos", version: "0.82.0" }));
    expect(() => installSurfaceLifecyclePatch(root)).toThrow("requires react-native-macos@0.88.0-rc.4");
  } finally { rmSync(root, {recursive: true, force: true}); }
});
