import { expect, test } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, linkSync, symlinkSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { patchAutolinkingSource, installAutolinkingPatch, excludeNativeModules } = require("../packages/config-plugin/autolinking.cjs");
const source = readFileSync(require.resolve("expo-modules-autolinking/build/utils.js"), "utf8");
test("Codex joins Expo Desktop's Apple autolinker while staying disabled on iOS", () => {
  const config = require.resolve("../packages/codex/react-native.config.js");
  const previous = process.env.SPARK_DESKTOP_AUTOLINK;
  try {
    delete process.env.SPARK_DESKTOP_AUTOLINK;
    delete require.cache[config];
    expect(require(config).dependency.platforms.ios).toBeNull();
    process.env.SPARK_DESKTOP_AUTOLINK = "macos";
    delete require.cache[config];
    expect(require(config).dependency.platforms.ios).toEqual({});
  } finally {
    if (previous === undefined) delete process.env.SPARK_DESKTOP_AUTOLINK;
    else process.env.SPARK_DESKTOP_AUTOLINK = previous;
    delete require.cache[config];
  }
});
test("autolinking resolves symlinked podspec files without modifying the package cache", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-autolinking-"));
  try {
    const dependency = path.join(root, "node_modules/expo-modules-autolinking");
    mkdirSync(path.join(dependency, "build"), { recursive: true });
    const manifest = path.join(dependency, "package.json");
    writeFileSync(manifest, JSON.stringify({ name: "expo-modules-autolinking", version: "3.0.27" }));
    const cache = path.join(root, "cache.js"), installed = path.join(dependency, "build/utils.js");
    writeFileSync(cache, source); linkSync(cache, installed);
    installAutolinkingPatch(root);
    expect(readFileSync(cache, "utf8")).toBe(source);
    expect(readFileSync(installed, "utf8")).toBe(patchAutolinkingSource(source));
    const inode = statSync(installed).ino;
    installAutolinkingPatch(root);
    expect(statSync(installed).ino).toBe(inode);
    const fixture = path.join(root, "library"); mkdirSync(fixture);
    writeFileSync(path.join(fixture, "b.podspec"), "");
    symlinkSync(path.join(fixture, "b.podspec"), path.join(fixture, "a.podspec"));
    symlinkSync(path.join(fixture, "missing"), path.join(fixture, "broken.podspec"));
    mkdirSync(path.join(fixture, "directory.podspec"));
    symlinkSync(path.join(fixture, "directory.podspec"), path.join(fixture, "directory-link.podspec"));
    writeFileSync(path.join(fixture, "ignore.txt"), "");
    const { listFilesSorted } = require(installed);
    expect(await listFilesSorted(fixture, (name: string) => name.endsWith(".podspec")))
      .toEqual([path.join(fixture, "a.podspec"), path.join(fixture, "b.podspec")]);
    expect(() => patchAutolinkingSource("changed upstream")).toThrow("source changed");
    writeFileSync(manifest, JSON.stringify({ name: "expo-modules-autolinking", version: "4.0.0" }));
    expect(() => installAutolinkingPatch(root)).toThrow("requires expo-modules-autolinking@3.0.27");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("the macOS Podfile passes the native selection's exclusions to Expo's React Native autolinker", async () => {
  const template = readFileSync(require.resolve("expo-desktop-template-bare-minimum/macos/Podfile"), "utf8");
  const podfile = excludeNativeModules(template, ["@legendapp/spark-codex", "react-native-nitro-modules"]);
  expect(podfile).toContain('use_native_modules!(config_command + ["--exclude","@legendapp/spark-codex","--exclude","react-native-nitro-modules"])');
  expect(excludeNativeModules(podfile, [])).toContain("use_native_modules!(config_command + [])");
  expect(() => excludeNativeModules("target 'App' do\nend\n", [])).toThrow("use_native_modules!(config_command)");
  // An app-level `ios: null` cannot unlink Codex, whose own config declares iOS for the desktop autolinker.
  const { resolveReactNativeModule } = require("expo-modules-autolinking/build/reactNativeConfig/reactNativeConfig.js");
  const codex = path.dirname(require.resolve("../packages/codex/package.json"));
  const resolution = { name: "@legendapp/spark-codex", version: "0.0.1-next.3", path: codex, originPath: codex, duplicates: null, depth: 0 };
  const disabled = { dependencies: { "@legendapp/spark-codex": { platforms: { ios: null } } } };
  const previous = process.env.SPARK_DESKTOP_AUTOLINK;
  process.env.SPARK_DESKTOP_AUTOLINK = "macos";
  try {
    expect(await resolveReactNativeModule(resolution, disabled, "ios", new Set())).not.toBeNull();
    expect(await resolveReactNativeModule(resolution, disabled, "ios", new Set(["@legendapp/spark-codex"]))).toBeNull();
  } finally {
    if (previous === undefined) delete process.env.SPARK_DESKTOP_AUTOLINK;
    else process.env.SPARK_DESKTOP_AUTOLINK = previous;
  }
});
