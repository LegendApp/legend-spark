import { expect, test } from "vitest";
import { createRequire } from "node:module";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { replacements, patchDevToolsTargetsSource, installDevToolsTargetsPatch } = require("../packages/config-plugin/devtools-targets.cjs") as {
  replacements: Record<string, [string, string][]>;
  patchDevToolsTargetsSource(file: string, source: string): string;
  installDevToolsTargetsPatch(root: string): void;
};
const pkg = path.dirname(require.resolve("react-native-macos/package.json"));
const files = Object.keys(replacements);
// Undo the edits so this also tests clean installs after a local prebuild patched node_modules.
const pristine = (file: string) => replacements[file]!.reduceRight((source, [before, after]) => source.replace(after, before), readFileSync(path.join(pkg, file), "utf8"));

test("the DevTools targets patch applies to clean source, is idempotent and rejects changed upstream code", () => {
  for (const file of files) {
    const original = pristine(file), patched = patchDevToolsTargetsSource(file, original);
    expect(patched).not.toBe(original);
    expect(patchDevToolsTargetsSource(file, patched)).toBe(patched);
    expect(() => patchDevToolsTargetsSource(file, original.replaceAll(";\n", "; \n"))).toThrow("source changed");
  }
});

test("each JS runtime gets its own titled debug target, listed once its runtime is named", () => {
  const host = patchDevToolsTargetsSource(files[0]!, pristine(files[0]!));
  expect(host).not.toContain('"React Native Bridgeless"');
  // Listed after the runtime delegate ran (it sets __THREADED_RUNTIME_ENV__ on isolated runtimes), on the main queue.
  expect(host).toMatch(/\[self\.runtimeDelegate host:self didInitializeRuntime:runtime\];[\s\S]*RCTHostInspectorTitle\(runtime\)[\s\S]*RCTExecuteOnMainQueue/);
  expect(host).toContain('label = "isolated runtime: " + name.getString(runtime).utf8(runtime);');
  expect(host).toContain('std::string label = "shared runtime";');
  // Spark's native lookup builds the same title (packages/desktop-app/macos/SparkDevTools.mm).
  const spark = readFileSync("packages/desktop-app/macos/SparkDevTools.mm", "utf8");
  expect(spark).toContain('[@"isolated runtime: " stringByAppendingString:runtime] : @"shared runtime"');
  expect(host).toContain('[NSString stringWithFormat:@"%@ (%s)", app, label.c_str()]');
  expect(spark).toContain('[NSString stringWithFormat:@"%@ (%@)", app,');
  expect(patchDevToolsTargetsSource(files[1]!, pristine(files[1]!))).toContain('pageDescription["title"] = page.description;');
});

test("the DevTools targets patch validates all sources before writes and preserves package cache hardlinks", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-devtools-"));
  try {
    const dependency = path.join(root, "node_modules/react-native-macos");
    const manifest = path.join(dependency, "package.json");
    mkdirSync(dependency, { recursive: true });
    writeFileSync(manifest, JSON.stringify({ name: "react-native-macos", version: "0.81.7" }));
    for (const [index, file] of files.entries()) {
      mkdirSync(path.dirname(path.join(dependency, file)), { recursive: true });
      const cache = path.join(root, `cache-${index}`);
      writeFileSync(cache, pristine(file)); linkSync(cache, path.join(dependency, file));
    }
    // The second invalid target must leave the first untouched.
    writeFileSync(path.join(dependency, files[1]!), "changed upstream");
    expect(() => installDevToolsTargetsPatch(root)).toThrow("source changed");
    expect(readFileSync(path.join(dependency, files[0]!), "utf8")).toBe(pristine(files[0]!));
    writeFileSync(path.join(dependency, files[1]!), pristine(files[1]!));
    installDevToolsTargetsPatch(root);
    for (const [index, file] of files.entries()) {
      const installed = path.join(dependency, file);
      expect(readFileSync(path.join(root, `cache-${index}`), "utf8")).toBe(pristine(file));
      expect(readFileSync(installed, "utf8")).toBe(patchDevToolsTargetsSource(file, pristine(file)));
      const inode = statSync(installed).ino; installDevToolsTargetsPatch(root);
      expect(statSync(installed).ino).toBe(inode);
    }
    writeFileSync(manifest, JSON.stringify({ name: "react-native-macos", version: "0.82.0" }));
    expect(() => installDevToolsTargetsPatch(root)).toThrow("requires react-native-macos@0.81.7");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
