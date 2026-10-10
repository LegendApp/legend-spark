import { expect, test } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, linkSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { patchKeyboardSource, installKeyboardEventsPatch } = require("../packages/config-plugin/keyboard-events.cjs");
const pkg = path.dirname(require.resolve("react-native-macos/package.json"));
const files = ["React/Views/RCTViewKeyboardEvent.m", "React/Views/RCTView.m"];
// Restore the two original snippets so this also tests clean installs after a local prebuild.
function pristine(file: string) {
  return readFileSync(path.join(pkg, file), "utf8")
    .replace("// Untagged native subviews cannot emit React events. Ignore dead keys too.\n  if (reactTag == nil || !event.charactersIgnoringModifiers.length)", '// Ignore "dead keys" (key press that waits for another key to make a character)\n  if (!event.charactersIgnoringModifiers.length)')
    .replace("  // Do not consume JS delivery when a native subview has no React target/dispatcher.\n  if (keyboardEvent != nil && _eventDispatcher != nil && !alreadyEmitted)", "  if (!alreadyEmitted)");
}
test("keyboard patch applies to clean source, is idempotent and rejects changed upstream code", () => {
  for (const file of files) {
    const original = pristine(file), patched = patchKeyboardSource(file, original);
    expect(patched).not.toBe(original);
    expect(patchKeyboardSource(file, patched)).toBe(patched);
    expect(() => patchKeyboardSource(file, original.replaceAll("if (", "if("))).toThrow("source changed");
  }
});
test("keyboard patch validates all sources before writes and preserves package cache hardlinks", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-keyboard-"));
  try {
    const dependency = path.join(root, "node_modules/react-native-macos");
    mkdirSync(path.join(dependency, "React/Views"), { recursive: true });
    const manifest = path.join(dependency, "package.json");
    writeFileSync(manifest, JSON.stringify({ name: "react-native-macos", version: "0.88.0-rc.4" }));
    for (const [index, file] of files.entries()) {
      const cache = path.join(root, `cache-${index}`);
      writeFileSync(cache, pristine(file)); linkSync(cache, path.join(dependency, file));
    }
    // The second invalid target must leave the first untouched.
    writeFileSync(path.join(dependency, files[1]!), "changed upstream");
    expect(() => installKeyboardEventsPatch(root)).toThrow("source changed");
    expect(readFileSync(path.join(dependency, files[0]!), "utf8")).toBe(pristine(files[0]!));
    writeFileSync(path.join(dependency, files[1]!), pristine(files[1]!));
    installKeyboardEventsPatch(root);
    for (const [index, file] of files.entries()) {
      const installed = path.join(dependency, file);
      expect(readFileSync(path.join(root, `cache-${index}`), "utf8")).toBe(pristine(file));
      expect(readFileSync(installed, "utf8")).toBe(patchKeyboardSource(file, pristine(file)));
      const inode = statSync(installed).ino; installKeyboardEventsPatch(root);
      expect(statSync(installed).ino).toBe(inode);
    }
    writeFileSync(manifest, JSON.stringify({ name: "react-native-macos", version: "0.82.0" }));
    expect(() => installKeyboardEventsPatch(root)).toThrow("requires react-native-macos@0.88.0-rc.4");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
