import { expect, test } from "vitest";
import { createRequire } from "node:module";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareNativePatches } from "../packages/config-plugin/native-patches.cjs";
import { installedPackages, nativePackages, selection } from "../packages/cli/src/project.ts";
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

test.each(["dependencies", "devDependencies", "optionalDependencies"])("app-owned cameras in %s are patched with nested peers and no Spark camera dependency", (field) => {
  const { root, spark, packages } = fixture();
  try {
    const manifest = JSON.parse(readFileSync(path.join(spark, "package.json"), "utf8"));
    manifest.dependencies = { "react-native-nitro-modules": "1.0.0" };
    writeFileSync(path.join(spark, "package.json"), JSON.stringify(manifest));
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app", dependencies: { "@legendapp/spark": "1.0.0" },
      [field]: { "@legendapp/spark": "1.0.0", [names[1]]: "1.0.0" } }));
    const camera = path.join(packages, names[1], "package.json");
    writeFileSync(camera, JSON.stringify({ ...JSON.parse(readFileSync(camera, "utf8")),
      peerDependencies: { [names[0]]: "1.0.0", "react-native-nitro-modules": "1.0.0" },
      peerDependenciesMeta: { "react-native-nitro-modules": { optional: true } } }));
    const nested = path.join(packages, names[1], "node_modules");
    mkdirSync(nested);
    renameSync(path.join(packages, names[0]), path.join(nested, names[0]));
    const patched = prepareNativePatches(root);
    expect(Object.keys(patched).sort()).toEqual([...names, "react-native-nitro-modules"].sort());
    expect(nativePackages(root).map(pkg => pkg.name).sort()).toEqual([...names, "react-native-nitro-modules"].sort());
    expect(readFileSync(path.join(nested, names[0], "Native.podspec"), "utf8")).toBe("patched\n");
    const before = readFileSync(path.join(nested, names[0], "package.json"), "utf8");
    prepareNativePatches(root);
    expect(readFileSync(path.join(nested, names[0], "package.json"), "utf8")).toBe(before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test.each(["dependencies", "optionalDependencies"])("transitive cameras in %s resolve through a component library", field => {
  const { root, spark, packages } = fixture();
  try {
    const manifest = JSON.parse(readFileSync(path.join(spark, "package.json"), "utf8"));
    manifest.dependencies = { "react-native-nitro-modules": "1.0.0" };
    writeFileSync(path.join(spark, "package.json"), JSON.stringify(manifest));
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app",
      dependencies: { "@legendapp/spark": "1.0.0", "camera-component": "1.0.0" } }));
    const component = path.join(packages, "camera-component");
    mkdirSync(path.join(component, "node_modules"), { recursive: true });
    writeFileSync(path.join(component, "package.json"), JSON.stringify({ name: "camera-component", version: "1.0.0",
      exports: { "./view": "./view.js" }, [field]: { [names[1]]: "1.0.0" } }));
    const camera = path.join(packages, names[1], "package.json");
    writeFileSync(camera, JSON.stringify({ ...JSON.parse(readFileSync(camera, "utf8")),
      dependencies: { [names[0]]: "1.0.0" }, peerDependencies: { "react-native-nitro-modules": "1.0.0" } }));
    for (const name of names) renameSync(path.join(packages, name), path.join(component, "node_modules", name));
    const native = nativePackages(root);
    const installed = installedPackages(root);
    const patched = prepareNativePatches(root, installed);
    expect(Object.keys(patched).sort()).toEqual([...names, "react-native-nitro-modules"].sort());
    const before = readFileSync(path.join(component, "node_modules", names[1], "package.json"), "utf8");
    prepareNativePatches(root, installed);
    expect(readFileSync(path.join(component, "node_modules", names[1], "package.json"), "utf8")).toBe(before);
    for (const name of names) {
      expect(patched[name]!.root).toBe(realpathSync(path.join(component, "node_modules", name)));
      expect(native.find(pkg => pkg.name === name)?.root).toBe(patched[name]!.root);
      expect(native.find(pkg => pkg.name === name)?.sdk).toBe(true);
      expect(readFileSync(path.join(patched[name]!.root, "Native.podspec"), "utf8")).toBe("patched\n");
    }
    const cameraFile = path.join(component, "node_modules", names[1], "package.json");
    writeFileSync(cameraFile, JSON.stringify({ name: names[1], version: "4.2.0" }));
    expect(() => prepareNativePatches(root, installedPackages(root))).toThrow(
      `found 4.2.0 at ${realpathSync(path.dirname(cameraFile))}, required by camera-component. Add an override/resolution`,
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("camera patches are opt-in and Nitro Image does not activate VisionCamera", () => {
  const { root, spark, packages } = fixture();
  try {
    const manifest = JSON.parse(readFileSync(path.join(spark, "package.json"), "utf8"));
    manifest.dependencies = { "react-native-nitro-modules": "1.0.0" };
    writeFileSync(path.join(spark, "package.json"), JSON.stringify(manifest));
    expect(prepareNativePatches(root)).toEqual({});
    expect(readFileSync(path.join(packages, names[0], "Native.podspec"), "utf8")).toBe("upstream\n");
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app", dependencies: { "@legendapp/spark": "1.0.0", [names[0]]: "1.0.0" } }));
    expect(Object.keys(prepareNativePatches(root)).sort()).toEqual([names[0], "react-native-nitro-modules"]);
    expect(readFileSync(path.join(packages, names[0], "Native.podspec"), "utf8")).toBe("patched\n");
    expect(readFileSync(path.join(packages, names[1], "Native.podspec"), "utf8")).toBe("upstream\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test.each([false, true])("removed camera manifests retain app errors and transitive skips (direct: %s)", direct => {
  const { root, packages } = fixture();
  try {
    if (direct) writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app",
      dependencies: { "@legendapp/spark": "1.0.0", [names[1]]: "1.0.0" } }));
    installedPackages(root);
    rmSync(path.join(packages, names[1]), { recursive: true });
    if (direct) expect(() => installedPackages(root)).toThrow(`Dependency ${names[1]} is not installed yet`);
    else expect(installedPackages(root).some(pkg => pkg.name === names[1])).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("preparation skips unrelated graph failures and non-backend integration pins", () => {
  const { root, spark, packages } = fixture();
  try {
    writeFileSync(path.join(spark, "package.json"), JSON.stringify({ name: "@legendapp/spark", version: "1.0.0",
      spark: { bundledModuleRoot: "vendor" } }));
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app",
      dependencies: { "@legendapp/spark": "1.0.0", missing: "1.0.0" } }));
    expect(() => installedPackages(root)).toThrow("Dependency missing is not installed yet");
    expect(prepareNativePatches(root)).toEqual({});
    writeFileSync(path.join(spark, "patches/dependencies.json"), JSON.stringify({
      "unrelated-native": { version: "1.0.0", patch: "missing.patch" },
    }));
    expect(prepareNativePatches(root, [{ name: "unrelated-native", root: packages, json: {} }])).toEqual({});
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test.each([false, true])("optional native discovery ignores unrelated libraries (transitive: %s)", transitive => {
  const { root, spark, packages } = fixture();
  try {
    const manifest = JSON.parse(readFileSync(path.join(spark, "package.json"), "utf8"));
    manifest.dependencies = {};
    writeFileSync(path.join(spark, "package.json"), JSON.stringify(manifest));
    const optional = path.join(packages, "optional-native");
    mkdirSync(optional);
    writeFileSync(path.join(optional, "package.json"), JSON.stringify({ name: "optional-native", version: "1.0.0", codegenConfig: {} }));
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app",
      dependencies: { "@legendapp/spark": "1.0.0" }, optionalDependencies: { "optional-native": "1.0.0" } }));
    if (transitive) {
      const library = path.join(packages, "library");
      mkdirSync(library);
      writeFileSync(path.join(library, "package.json"), JSON.stringify({ name: "library", version: "1.0.0", optionalDependencies: { "optional-native": "1.0.0" } }));
      writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app",
        dependencies: { "@legendapp/spark": "1.0.0", library: "1.0.0" } }));
    }
    expect(installedPackages(root).some(pkg => pkg.name === "optional-native")).toBe(false);
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
    mkdirSync(path.join(root, "node_modules/react"), { recursive: true });
    writeFileSync(path.join(root, "node_modules/react/package.json"), JSON.stringify({ name: "react", version: "19.1.4" }));
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

test.each(["react-native-enriched-markdown", "react-native-enriched-html"])("%s patches only after app opt-in, including nested optional dependencies", name => {
  const { root, spark } = fixture();
  try {
    writeFileSync(path.join(spark, "package.json"), JSON.stringify({ name: "@legendapp/spark", version: "1.0.0",
      peerDependencies: { [name]: "1.0.0" }, peerDependenciesMeta: { [name]: { optional: true } }, spark: { bundledModuleRoot: "vendor" } }));
    const library = path.join(root, "node_modules/component");
    const backend = path.join(library, "node_modules", name);
    mkdirSync(backend, { recursive: true });
    writeFileSync(path.join(library, "package.json"), JSON.stringify({ name: "component", version: "1.0.0", optionalDependencies: { [name]: "1.0.0" } }));
    writeFileSync(path.join(backend, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
    writeFileSync(path.join(backend, "Native.podspec"), "upstream\n");
    writeFileSync(path.join(spark, "patches/dependencies.json"), JSON.stringify({ [name]: { version: "1.0.0", patch: "camera/react-native-nitro-image.patch" } }));
    expect(installedPackages(root).some(pkg => pkg.name === name)).toBe(false);
    expect(prepareNativePatches(root)).toEqual({});
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app", dependencies: { "@legendapp/spark": "1.0.0", component: "1.0.0" } }));
    const native = nativePackages(root);
    expect(native.map(pkg => pkg.name)).toContain(name);
    expect(readFileSync(path.join(backend, "Native.podspec"), "utf8")).toBe("patched\n");
    expect(selection(native, new Set()).included).toEqual([]);
    expect(selection(native, new Set([name])).included.map(pkg => pkg.name)).toEqual([name]);
    prepareNativePatches(root, installedPackages(root));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("optional pins patch only the app's own installs of the pinned version, without marking them SDK packages", () => {
  const { root, spark, packages } = fixture();
  const name = "react-native-mmkv";
  try {
    const directory = path.join(packages, name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name, version: "4.3.2" }, null, 2) + "\n");
    writeFileSync(path.join(directory, "Native.podspec"), "upstream\n");
    writeFileSync(path.join(spark, "patches/dependencies.json"), JSON.stringify({ [name]: { version: "4.3.2", integrity: "sha512-fixture", patch: `${name}.patch`, optional: true } }));
    writeFileSync(path.join(spark, "patches", `${name}.patch`), readFileSync(path.join(spark, "patches/camera", `${names[0]}.patch`)));
    prepareNativePatches(root);
    expect(readFileSync(path.join(directory, "Native.podspec"), "utf8")).toBe("upstream\n");
    const app = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ ...app, dependencies: { ...app.dependencies, [name]: "4.3.2" } }));
    expect(prepareNativePatches(root)[name]).toEqual({ root: realpathSync(directory) });
    expect(readFileSync(path.join(directory, "macos/View.swift"), "utf8")).toBe("AppKit\n");
    const receipt = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8")).spark;
    expect(receipt).toMatchObject({ dependencyPatch: { version: "4.3.2" } });
    expect(receipt.sdk).toBeUndefined();
    // Another version keeps upstream behavior instead of failing the app's native preparation.
    rmSync(directory, { recursive: true });
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name, version: "4.2.0" }, null, 2) + "\n");
    writeFileSync(path.join(directory, "Native.podspec"), "upstream\n");
    expect(prepareNativePatches(root)[name]).toBeUndefined();
    expect(readFileSync(path.join(directory, "Native.podspec"), "utf8")).toBe("upstream\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("package.json hunks apply to tab-indented manifests and still converge after the receipt rewrites them", () => {
  const { root, spark, packages } = fixture();
  const name = "tabbed";
  try {
    const directory = path.join(packages, name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name, version: "1.0.0", codegenConfig: { name: "spec" } }, null, "\t") + "\n");
    const app = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ ...app, dependencies: { ...app.dependencies, [name]: "1.0.0" } }));
    writeFileSync(path.join(spark, "patches/dependencies.json"), JSON.stringify({ [name]: { version: "1.0.0", integrity: "sha512-fixture", patch: `${name}.patch`, optional: true } }));
    writeFileSync(path.join(spark, "patches", `${name}.patch`), [
      "diff --git a/package.json b/package.json", "--- a/package.json", "+++ b/package.json", "@@ -3,5 +3,6 @@",
      '   "version": "1.0.0",', '   "codegenConfig": {', '-    "name": "spec"', '+    "name": "spec",', '+    "ios": {}', "   }", " }", "",
    ].join("\n"));
    prepareNativePatches(root);
    const first = readFileSync(path.join(directory, "package.json"), "utf8");
    expect(JSON.parse(first).codegenConfig).toEqual({ name: "spec", ios: {} });
    prepareNativePatches(root);
    expect(readFileSync(path.join(directory, "package.json"), "utf8")).toBe(first);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("optional pins patch packages whose exports map hides package.json", () => {
  const { root, spark, packages } = fixture();
  const name = "exported";
  try {
    const directory = path.join(packages, name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name, version: "1.0.0", exports: { ".": "./index.js" } }, null, 2) + "\n");
    writeFileSync(path.join(directory, "Native.podspec"), "upstream\n");
    const app = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ ...app, dependencies: { ...app.dependencies, [name]: "1.0.0" } }));
    writeFileSync(path.join(spark, "patches/dependencies.json"), JSON.stringify({ [name]: { version: "1.0.0", integrity: "sha512-fixture", patch: `${name}.patch`, optional: true } }));
    writeFileSync(path.join(spark, "patches", `${name}.patch`), ["diff --git a/Native.podspec b/Native.podspec", "--- a/Native.podspec", "+++ b/Native.podspec", "@@ -1 +1 @@", "-upstream", "+patched", ""].join("\n"));
    prepareNativePatches(root);
    expect(readFileSync(path.join(directory, "Native.podspec"), "utf8")).toBe("patched\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
