import { expect, test } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, linkSync, symlinkSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { patchAutolinkingSource, installAutolinkingPatch } = require("../packages/config-plugin/autolinking.cjs");
const source = readFileSync(require.resolve("expo-modules-autolinking/build/utils.js"), "utf8");
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
