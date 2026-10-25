import { createRequire } from "node:module";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

const require = createRequire(import.meta.url);
const { before, after, patchTextInputAccessibilitySource, installTextInputAccessibilityPatch } = require("../packages/config-plugin/text-input-accessibility.cjs");
const relative = "Libraries/Text/TextInput/Multiline/RCTWrappedTextView.m";
// Undo a local prebuild's patch so this also covers clean installs.
const installed = readFileSync(path.join(path.dirname(require.resolve("react-native-macos/package.json")), relative), "utf8");
const pristine = installed.replace(after("\r\n"), before("\r\n"));
const patched: string = patchTextInputAccessibilitySource(pristine);

test("the TextInput accessibility patch keeps a multiline input's label on its text view, is idempotent and rejects changed upstream code", () => {
  expect(pristine).toContain("\r\n");
  expect(patched).toContain("_forwardingTextView.accessibilityLabel = accessibilityLabel;\r\n");
  expect(patchTextInputAccessibilitySource(patched)).toBe(patched);
  expect(() => patchTextInputAccessibilitySource(pristine.replace("#pragma mark First Responder forwarding", "#pragma mark Responder forwarding"))).toThrow("source changed");
});

test("the TextInput accessibility patch install checks the version and preserves package cache hardlinks", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-text-input-a11y-"));
  try {
    const dependency = path.join(root, "node_modules/react-native-macos"), cache = path.join(root, "cache.m");
    const installed = path.join(dependency, relative);
    mkdirSync(path.dirname(installed), { recursive: true });
    writeFileSync(path.join(dependency, "package.json"), JSON.stringify({ name: "react-native-macos", version: "0.81.7" }));
    writeFileSync(cache, pristine); linkSync(cache, installed);
    installTextInputAccessibilityPatch(root);
    expect(readFileSync(cache, "utf8")).toBe(pristine);
    expect(readFileSync(installed, "utf8")).toBe(patched);
    const inode = statSync(installed).ino; installTextInputAccessibilityPatch(root);
    expect(statSync(installed).ino).toBe(inode);
    writeFileSync(path.join(dependency, "package.json"), JSON.stringify({ name: "react-native-macos", version: "0.82.0" }));
    expect(() => installTextInputAccessibilityPatch(root)).toThrow("requires react-native-macos@0.81.7");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
