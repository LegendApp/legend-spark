import { expect, test } from "vitest";
import { createRequire } from "node:module";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareNativePatches } from "../packages/config-plugin/native-patches.cjs";
import { nativePackages, selection } from "../packages/cli/src/project.ts";
import { installWorkspaceAdapters } from "../scripts/install-workspace-adapters.ts";

const names = ["react-native-nitro-image", "react-native-vision-camera"];
function fixture(nested = false) {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-dependency-patches-"));
  const spark = path.join(root, "node_modules/@legendapp/spark");
  const packages = path.join(nested ? spark : root, "node_modules");
  const patches = path.join(spark, "patches/camera");
  mkdirSync(patches, { recursive: true });
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app", dependencies: { "@legendapp/spark": "1.0.0" } }));
  writeFileSync(path.join(root, "app.json"), JSON.stringify({ expo: { platforms: ["macos"] } }));
  writeFileSync(path.join(spark, "package.json"), JSON.stringify({ name: "@legendapp/spark", version: "1.0.0",
    dependencies: Object.fromEntries([...names, "react-native-nitro-modules"].map(name => [name, "1.0.0"])), spark: { bundledModuleRoot: "vendor" },
  }));
  const nitro = path.join(packages, "react-native-nitro-modules");
  mkdirSync(nitro, { recursive: true });
  writeFileSync(path.join(nitro, "package.json"), JSON.stringify({ name: "react-native-nitro-modules", version: "1.0.0" }));
  writeFileSync(path.join(nitro, "Nitro.podspec"), "nitro\n");
  writeFileSync(path.join(patches, "upstream.json"), JSON.stringify(Object.fromEntries([...names, "react-native-nitro-modules"].map(name => [name, { version: "1.0.0", integrity: "sha512-fixture" }]))));
  for (const name of [...names, "react-native-nitro-modules"]) {
    const directory = path.join(packages, name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name, version: "1.0.0" }, null, 2) + "\n");
    writeFileSync(path.join(directory, "Native.podspec"), "upstream\n");
    writeFileSync(path.join(patches, `${name}.patch`), [
      "diff --git a/Native.podspec b/Native.podspec", "--- a/Native.podspec", "+++ b/Native.podspec", "@@ -1 +1 @@", "-upstream", "+patched",
      "diff --git a/macos/View.swift b/macos/View.swift", "--- /dev/null", "+++ b/macos/View.swift", "@@ -0,0 +1 @@", "+AppKit", "",
    ].join("\n"));
  }
  return { root, spark, packages };
}

test("normal preparation patches nested transitive dependencies, preserves cache hardlinks, and prunes camera when unused", () => {
  const { root, packages } = fixture(true);
  try {
    const cached = path.join(root, "cached.podspec");
    linkSync(path.join(packages, names[0], "Native.podspec"), cached);
    // Native discovery is also a preparation boundary when install hooks were disabled.
    const native = nativePackages(root);
    expect(native.map(pkg => pkg.name)).toEqual([names[0], "react-native-nitro-modules", names[1]]);
    expect(readFileSync(cached, "utf8")).toBe("upstream\n");
    const before = readFileSync(path.join(packages, names[0], "package.json"), "utf8");
    prepareNativePatches(root);
    expect(readFileSync(path.join(packages, names[0], "package.json"), "utf8")).toBe(before);
    expect(selection(native, new Set()).included).toEqual([]);
    expect(selection(native, new Set([names[1]])).included.map(pkg => pkg.name).sort()).toEqual([names[0], "react-native-nitro-modules", names[1]]);
    expect(JSON.parse(before).spark.dependencyPatch).toMatchObject({ schema: 1, version: "1.0.0", upstreamIntegrity: "sha512-fixture" });
    // A package-manager reinstall replaces sources and receipts; the next native preparation repairs them.
    writeFileSync(path.join(packages, names[0], "Native.podspec"), "upstream\n");
    rmSync(path.join(packages, names[0], "macos"), { recursive: true });
    prepareNativePatches(root);
    expect(readFileSync(path.join(packages, names[0], "macos/View.swift"), "utf8")).toBe("AppKit\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a failed later hunk leaves the package untouched; retry after interrupted patching converges", () => {
  const { root, packages } = fixture();
  const directory = path.join(packages, names[0]);
  try {
    mkdirSync(path.join(directory, "macos"));
    writeFileSync(path.join(directory, "macos/View.swift"), "conflict\n");
    expect(() => prepareNativePatches(root)).toThrow("Cannot apply");
    expect(readFileSync(path.join(directory, "Native.podspec"), "utf8")).toBe("upstream\n");
    expect(JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8")).spark).toBeUndefined();
    rmSync(path.join(directory, "macos"), { recursive: true });
    writeFileSync(path.join(directory, "Native.podspec"), "patched\n");
    prepareNativePatches(root);
    expect(readFileSync(path.join(directory, "macos/View.swift"), "utf8")).toBe("AppKit\n");
    writeFileSync(path.join(directory, "Native.podspec"), "tampered\n");
    expect(() => prepareNativePatches(root)).toThrow("Cannot apply");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("wrong and missing versions fail before native files or receipts are written", () => {
  const { root, packages } = fixture();
  const directory = path.join(packages, names[0]);
  try {
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name: names[0], version: "2.0.0" }));
    expect(() => prepareNativePatches(root)).toThrow("found 2.0.0");
    expect(existsSync(path.join(directory, "macos"))).toBe(false);
    rmSync(directory, { recursive: true });
    expect(() => prepareNativePatches(root)).toThrow("Finish installing dependencies");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("mobile native configuration discovers cameras without a direct application dependency", () => {
  const { root, packages } = fixture(true);
  const previous = process.env.SPARK_PLATFORM;
  try {
    process.env.SPARK_PLATFORM = "ios";
    const require = createRequire(import.meta.url);
    const { withSparkNative } = require("../packages/cli/src/expo-native.cjs");
    const config = withSparkNative({ dependencies: { "other-library": { root: "/other" } } }, root);
    expect(config.dependencies[names[1]].root).toBe(realpathSync(path.join(packages, names[1])));
    expect(config.dependencies["react-native-nitro-modules"].root).toBe(realpathSync(path.join(packages, "react-native-nitro-modules")));
    expect(config.dependencies["other-library"]).toEqual({ root: "/other" });
  } finally {
    if (previous === undefined) delete process.env.SPARK_PLATFORM; else process.env.SPARK_PLATFORM = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspace Nitro adapters and automatic camera patch receipts survive repeated preparation", () => {
  const { root, packages } = fixture();
  const name = "react-native-nitro-modules";
  try {
    const require = createRequire(import.meta.url);
    const { createPatch } = require("diff");
    const file = path.join(packages, name, "package.json");
    const original = readFileSync(file, "utf8");
    const patched = JSON.stringify({ ...JSON.parse(original), spark: { sdk: true, windowsAdapter: true } }, null, 2) + "\n";
    const relative = "patches/workspace/nitro.patch";
    mkdirSync(path.join(root, "patches/workspace"), { recursive: true });
    writeFileSync(path.join(root, relative), createPatch("package.json", original, patched));
    writeFileSync(path.join(root, "patches/workspace/upstream.json"), JSON.stringify({ [name]: { version: "1.0.0", integrity: "sha512-fixture" } }));
    const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    manifest.sparkWorkspacePatches = { [`${name}@1.0.0`]: relative };
    writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
    prepareNativePatches(root);
    installWorkspaceAdapters(root);
    const first = readFileSync(file, "utf8");
    installWorkspaceAdapters(root);
    expect(readFileSync(file, "utf8")).toBe(first);
    expect(JSON.parse(first).spark).toMatchObject({ windowsAdapter: true, dependencyPatch: { version: "1.0.0" }, workspacePatch: { version: "1.0.0" } });
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test.each(["react-native-enriched-markdown", "react-native-enriched-html"])("%s installs and repairs independently of camera or Nitro", (name) => {
  const { root, spark, packages } = fixture(true);
  try {
    const manifest = JSON.parse(readFileSync(path.join(spark, "package.json"), "utf8"));
    manifest.dependencies = { [name]: "1.1.1" };
    for (const camera of [...names, "react-native-nitro-modules"]) rmSync(path.join(packages, camera), { recursive: true });
    writeFileSync(path.join(spark, "package.json"), JSON.stringify(manifest));
    const directory = path.join(packages, name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name, version: "1.1.1" }, null, 2) + "\n");
    writeFileSync(path.join(directory, "Native.podspec"), "upstream\n");
    const patch = `${name}.patch`;
    writeFileSync(path.join(spark, "patches/dependencies.json"), JSON.stringify({ [name]: { version: "1.1.1", integrity: "sha512-fixture", patch } }));
    writeFileSync(path.join(spark, "patches", patch), readFileSync(path.join(spark, "patches/camera", `${names[0]}.patch`)));
    expect(prepareNativePatches(root)).toEqual({ [name]: { root: realpathSync(directory) } });
    const first = readFileSync(path.join(directory, "package.json"), "utf8");
    expect(JSON.parse(first).spark).toMatchObject({ sdk: true, requires: [], dependencyPatch: { version: "1.1.1" } });
    prepareNativePatches(root);
    expect(readFileSync(path.join(directory, "package.json"), "utf8")).toBe(first);
    const native = nativePackages(root);
    expect(selection(native, new Set([name])).included.map(pkg => pkg.name)).toEqual([name]);
    expect(selection(native, new Set()).included).toEqual([]);
    rmSync(path.join(directory, "macos"), { recursive: true });
    prepareNativePatches(root);
    expect(readFileSync(path.join(directory, "macos/View.swift"), "utf8")).toBe("AppKit\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
