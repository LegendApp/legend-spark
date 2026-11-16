import { expect, test } from "vitest";
import { createRequire } from "node:module";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { file, patchWindowDimensionsSource, unpatchWindowDimensionsSource, installWindowDimensionsPatch } = require("../packages/config-plugin/window-dimensions.cjs");
// Undo a local prebuild's patch so this also covers clean installs.
const pristine: string = unpatchWindowDimensionsSource(readFileSync(path.join(path.dirname(require.resolve("react-native-macos/package.json")), file), "utf8"));
const patched: string = patchWindowDimensionsSource(pristine);

test("window dimensions patch applies to clean source, is idempotent and rejects changed upstream code", () => {
  expect(pristine).not.toContain("RCTDimensionsWindow");
  expect(patched).toContain("NSWindow *mainWindow = RCTDimensionsWindow();");
  expect(patched).toContain("contentRectForFrameRect:mainWindow.frame");
  expect(patched).toContain("NSWindowDidResizeNotification");
  expect(patched).toContain("NSWindowDidChangeScreenNotification");
  expect(patchWindowDimensionsSource(patched)).toBe(patched);
  expect(() => patchWindowDimensionsSource(pristine.replace("NSWindow *mainWindow = RCTKeyWindow();", "NSWindow *mainWindow = nil;"))).toThrow("source changed");
});

test("window dimensions patch install checks the version and preserves package cache hardlinks", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-window-dimensions-"));
  try {
    const dependency = path.join(root, "node_modules/react-native-macos"), cache = path.join(root, "cache.mm");
    const installed = path.join(dependency, file);
    mkdirSync(path.dirname(installed), { recursive: true });
    writeFileSync(path.join(dependency, "package.json"), JSON.stringify({ name: "react-native-macos", version: "0.83.0" }));
    writeFileSync(cache, pristine); linkSync(cache, installed);
    installWindowDimensionsPatch(root);
    expect(readFileSync(cache, "utf8")).toBe(pristine);
    expect(readFileSync(installed, "utf8")).toBe(patched);
    const inode = statSync(installed).ino; installWindowDimensionsPatch(root);
    expect(statSync(installed).ino).toBe(inode);
    writeFileSync(path.join(dependency, "package.json"), JSON.stringify({ name: "react-native-macos", version: "0.82.0" }));
    expect(() => installWindowDimensionsPatch(root)).toThrow("requires react-native-macos@0.83.0");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
