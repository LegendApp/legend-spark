import { afterAll, beforeAll, expect, test } from "vitest";
import { runOk } from "./subprocess.ts";
import { createRequire } from "node:module";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { file, helpers, replacements, patchTextInputAlignmentSource, installRTLTextInputAlignmentPatch } = require("../packages/config-plugin/rtl-text-input-alignment.cjs");
// Undo a local prebuild's patch so this also covers clean installs.
const pristine: string = (replacements as [string, string][]).reduce(
  (source, [before, after]) => source.replace(after, before),
  readFileSync(path.join(path.dirname(require.resolve("react-native-macos/package.json")), file), "utf8"),
);
const patched: string = patchTextInputAlignmentSource(pristine);

test("RTL TextInput alignment patch applies to clean source, is idempotent and rejects changed upstream code", () => {
  expect(patched).not.toBe(pristine);
  expect(patched).toContain("RCTSparkAlignNaturalText(");
  expect(patchTextInputAlignmentSource(patched)).toBe(patched);
  expect(() => patchTextInputAlignmentSource(pristine.replace("- (void)_setAttributedString:(NSAttributedString *)attributedString\n{", "- (void)_setAttributedString:(NSAttributedString *)text\n{"))).toThrow("source changed");
});

test("RTL TextInput alignment patch install checks the version and preserves package cache hardlinks", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-rtl-text-input-"));
  try {
    const dependency = path.join(root, "node_modules/react-native-macos"), cache = path.join(root, "cache.mm");
    const installed = path.join(dependency, file);
    mkdirSync(path.dirname(installed), { recursive: true });
    writeFileSync(path.join(dependency, "package.json"), JSON.stringify({ name: "react-native-macos", version: "0.83.0" }));
    writeFileSync(cache, pristine); linkSync(cache, installed);
    installRTLTextInputAlignmentPatch(root);
    expect(readFileSync(cache, "utf8")).toBe(pristine);
    expect(readFileSync(installed, "utf8")).toBe(patched);
    const inode = statSync(installed).ino; installRTLTextInputAlignmentPatch(root);
    expect(statSync(installed).ino).toBe(inode);
    writeFileSync(path.join(dependency, "package.json"), JSON.stringify({ name: "react-native-macos", version: "0.82.0" }));
    expect(() => installRTLTextInputAlignmentPatch(root)).toThrow("requires react-native-macos@0.83.0");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

let directory: string, executable: string;
beforeAll(async () => {
  if (process.platform !== "darwin") return;
  directory = mkdtempSync(path.join(os.tmpdir(), "spark-rtl-text-input-test-"));
  const input = path.join(directory, "RTLTextInput.mm");
  executable = path.join(directory, "test");
  writeFileSync(input, readFileSync(path.join(import.meta.dirname, "rtl-text-input-alignment.native.mm"), "utf8").replace("// ACTUAL_HELPERS", helpers));
  await runOk("clang++", ["-fobjc-arc", "-std=c++20", "-framework", "AppKit", input, "-o", executable]);
}, 30000);
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

test.skipIf(process.platform !== "darwin").each(["upstream", "rtl-natural", "ltr", "direction-change", "explicit"])("AppKit RTL TextInput alignment: %s", async scenario => {
  expect(await runOk(executable, [scenario], { timeout: 15000 })).toContain(`PASS ${scenario}`);
}, 20000);
