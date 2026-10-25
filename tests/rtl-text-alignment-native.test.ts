import { afterAll, beforeAll, expect, test } from "vitest";
import { runOk } from "./subprocess.ts";
import { createRequire } from "node:module";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { before, after, patchTextAlignmentSource, installRTLTextAlignmentPatch } = require("../packages/config-plugin/rtl-text-alignment.cjs");
const textlayoutmanager = path.join(path.dirname(require.resolve("react-native-macos/package.json")), "ReactCommon/react/renderer/textlayoutmanager/platform/ios/react/renderer/textlayoutmanager");
// Undo a local prebuild's patch so this also covers clean installs.
const pristine = readFileSync(path.join(textlayoutmanager, "RCTAttributedTextUtils.mm"), "utf8").replace(after, before);
const patched: string = patchTextAlignmentSource(pristine);

test("RTL text alignment patch applies to clean source, is idempotent and rejects changed upstream code", () => {
  expect(patched).not.toBe(pristine);
  expect(patchTextAlignmentSource(patched)).toBe(patched);
  expect(() => patchTextAlignmentSource(pristine.replace("textAlignment = TextAlignment::Left;\n      } else", "textAlignment = TextAlignment::Left;\n      }\n      else"))).toThrow("source changed");
});

test("RTL text alignment patch install checks the version and preserves package cache hardlinks", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-rtl-text-"));
  try {
    const dependency = path.join(root, "node_modules/react-native-macos"), cache = path.join(root, "cache.mm");
    const installed = path.join(dependency, "ReactCommon/react/renderer/textlayoutmanager/platform/ios/react/renderer/textlayoutmanager/RCTAttributedTextUtils.mm");
    mkdirSync(path.dirname(installed), { recursive: true });
    writeFileSync(path.join(dependency, "package.json"), JSON.stringify({ name: "react-native-macos", version: "0.81.7" }));
    writeFileSync(cache, pristine); linkSync(cache, installed);
    installRTLTextAlignmentPatch(root);
    expect(readFileSync(cache, "utf8")).toBe(pristine);
    expect(readFileSync(installed, "utf8")).toBe(patched);
    const inode = statSync(installed).ino; installRTLTextAlignmentPatch(root);
    expect(statSync(installed).ino).toBe(inode);
    writeFileSync(path.join(dependency, "package.json"), JSON.stringify({ name: "react-native-macos", version: "0.82.0" }));
    expect(() => installRTLTextAlignmentPatch(root)).toThrow("requires react-native-macos@0.81.7");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

let directory: string, executable: string;
beforeAll(async () => {
  if (process.platform !== "darwin") return;
  directory = mkdtempSync(path.join(os.tmpdir(), "spark-rtl-text-test-"));
  const input = path.join(directory, "RTLText.mm");
  executable = path.join(directory, "test");
  const conversions = readFileSync(path.join(textlayoutmanager, "RCTTextPrimitivesConversions.h"), "utf8");
  const start = conversions.indexOf("inline static NSTextAlignment RCTNSTextAlignmentFromTextAlignment");
  const conversion = conversions.slice(start, conversions.indexOf("\n}\n", start) + 3);
  writeFileSync(input, readFileSync(path.join(import.meta.dirname, "rtl-text-alignment.native.mm"), "utf8")
    .replace("// ACTUAL_CONVERSION", conversion)
    .replace("// ACTUAL_PATCHED", after)
    .replace("// ACTUAL_UPSTREAM", before));
  await runOk("clang++", ["-fobjc-arc", "-std=c++20", "-framework", "AppKit", input, "-o", executable]);
}, 30000);
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

test.skipIf(process.platform !== "darwin").each(["upstream", "rtl-natural", "rtl-explicit", "ltr", "no-direction"])("AppKit RTL text alignment: %s", async scenario => {
  expect(await runOk(executable, [scenario], { timeout: 15000 })).toContain(`PASS ${scenario}`);
}, 20000);
