import { afterAll, beforeAll, expect, test } from "vitest";
import { runOk } from "./subprocess.ts";
import { createRequire } from "node:module";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { file, methods, before, after, patchAccessibilityStateSource, installAccessibilityStatePatch } = require("../packages/config-plugin/accessibility-state.cjs");
// Undo a local prebuild's patch so this also covers clean installs.
const pristine: string = readFileSync(path.join(path.dirname(require.resolve("react-native-macos/package.json")), file), "utf8").replace(after, before);
const patched: string = patchAccessibilityStateSource(pristine);

test("accessibility state patch applies to clean source, is idempotent and rejects changed upstream code", () => {
  expect(patched).not.toBe(pristine);
  expect(patched).toContain("- (BOOL)isAccessibilityEnabled\n");
  expect(patchAccessibilityStateSource(patched)).toBe(patched);
  expect(() => patchAccessibilityStateSource(pristine.replace("- (NSView *)accessibilityElement // macOS]", "- (NSView *)accessibilityElement"))).toThrow("source changed");
});

test("accessibility state patch install checks the version and preserves package cache hardlinks", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-accessibility-state-"));
  try {
    const dependency = path.join(root, "node_modules/react-native-macos"), cache = path.join(root, "cache.mm");
    const installed = path.join(dependency, file);
    mkdirSync(path.dirname(installed), { recursive: true });
    writeFileSync(path.join(dependency, "package.json"), JSON.stringify({ name: "react-native-macos", version: "0.83.0" }));
    writeFileSync(cache, pristine); linkSync(cache, installed);
    installAccessibilityStatePatch(root);
    expect(readFileSync(cache, "utf8")).toBe(pristine);
    expect(readFileSync(installed, "utf8")).toBe(patched);
    const inode = statSync(installed).ino; installAccessibilityStatePatch(root);
    expect(statSync(installed).ino).toBe(inode);
    writeFileSync(path.join(dependency, "package.json"), JSON.stringify({ name: "react-native-macos", version: "0.82.0" }));
    expect(() => installAccessibilityStatePatch(root)).toThrow("requires react-native-macos@0.83.0");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

let directory: string, executable: string;
beforeAll(async () => {
  if (process.platform !== "darwin") return;
  directory = mkdtempSync(path.join(os.tmpdir(), "spark-accessibility-state-test-"));
  const input = path.join(directory, "AccessibilityState.mm");
  executable = path.join(directory, "test");
  writeFileSync(input, readFileSync(path.join(import.meta.dirname, "accessibility-state.native.mm"), "utf8").replace("// ACTUAL_METHODS", methods));
  await runOk("clang++", ["-fobjc-arc", "-std=c++20", "-framework", "AppKit", input, "-o", executable]);
}, 30000);
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

test.skipIf(process.platform !== "darwin").each(["plain", "disabled", "selected", "not-enabled-trait", "updates"])("AppKit accessibility state: %s", async scenario => {
  expect(await runOk(executable, [scenario], { timeout: 15000 })).toContain(`PASS ${scenario}`);
}, 20000);
