import { afterEach, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import { appPatchIssues, prepareNativePatches } from "../packages/config-plugin/native-patches.cjs";
import { validateAppPatches } from "../packages/cli/src/native-patch-preflight.ts";
import { installedPackages } from "../packages/cli/src/project.ts";
import { patchLibrary, patchRoot } from "../packages/cli/src/patch.ts";

const upstream = "one\ntwo\nthree\nfour\nfive\nsix\nseven\n";
const sparkPatched = upstream.replace("one", "ONE");
const both = sparkPatched.replace("seven", "SEVEN");
const diff = (before: string, after: string, prefix = "") =>
  createTwoFilesPatch(`a/${prefix}Native.podspec`, `b/${prefix}Native.podspec`, before, after);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks(); });

function fixture(app: Record<string, unknown> = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-app-patches-"));
  roots.push(root);
  const spark = path.join(root, "node_modules/@legendapp/spark");
  mkdirSync(path.join(spark, "patches"), { recursive: true });
  writeFileSync(path.join(spark, "package.json"), JSON.stringify({ name: "@legendapp/spark", version: "1.0.0", spark: { bundledModuleRoot: "vendor" } }));
  writeFileSync(path.join(spark, "patches/dependencies.json"), JSON.stringify({ "native-lib": { version: "1.0.0", integrity: "sha512-fixture", patch: "native-lib.patch" } }));
  writeFileSync(path.join(spark, "patches/native-lib.patch"), diff(upstream, sparkPatched));
  for (const name of ["native-lib", "plain-lib"]) install(root, name);
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app",
    dependencies: { "@legendapp/spark": "1.0.0", "native-lib": "1.0.0", "plain-lib": "1.0.0" }, ...app }));
  mkdirSync(path.join(root, "patches"));
  return root;
}
function install(root: string, name: string, content = upstream) {
  const directory = path.join(root, "node_modules", name);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name, version: "1.0.0" }, null, 2) + "\n");
  writeFileSync(path.join(directory, "Native.podspec"), content);
}
const podspec = (root: string, name: string) => readFileSync(path.join(root, "node_modules", name, "Native.podspec"), "utf8");
const receipt = (root: string, name: string) => JSON.parse(readFileSync(path.join(root, "node_modules", name, "package.json"), "utf8")).spark?.dependencyPatch;

test("app patches layer on Spark's patch, record both hashes, and repair after reinstall", () => {
  const root = fixture();
  const own = diff(sparkPatched, both);
  writeFileSync(path.join(root, "patches/native-lib@1.0.0.patch"), own);
  prepareNativePatches(root);
  expect(podspec(root, "native-lib")).toBe(both);
  expect(receipt(root, "native-lib")).toMatchObject({ patchHash: hash(diff(upstream, sparkPatched)), appPatchHash: hash(own) });
  const first = readFileSync(path.join(root, "node_modules/native-lib/package.json"), "utf8");
  prepareNativePatches(root);
  expect(readFileSync(path.join(root, "node_modules/native-lib/package.json"), "utf8")).toBe(first);
  expect(podspec(root, "native-lib")).toBe(both);
  expect(validateAppPatches(root, installedPackages(root))).toEqual([]);
  // A reinstall without Spark's patch, or one with only Spark's, converges on both layers.
  for (const state of [upstream, sparkPatched]) {
    install(root, "native-lib", state);
    prepareNativePatches(root);
    expect(podspec(root, "native-lib")).toBe(both);
  }
  // The receipt must match the app's current patch.
  writeFileSync(path.join(root, "patches/native-lib@1.0.0.patch"), own + "\n");
  expect(validateAppPatches(root, installedPackages(root))).toEqual([
    "native-lib@1.0.0 does not carry patches/native-lib@1.0.0.patch. Reinstall native-lib, then retry.",
  ]);
});

test("app patches on libraries Spark doesn't patch apply alone", () => {
  const root = fixture();
  const own = diff(upstream, upstream.replace("two", "TWO"));
  writeFileSync(path.join(root, "patches/plain-lib@1.0.0.patch"), own);
  prepareNativePatches(root);
  expect(podspec(root, "plain-lib")).toBe(upstream.replace("two", "TWO"));
  expect(podspec(root, "native-lib")).toBe(sparkPatched);
  expect(JSON.parse(readFileSync(path.join(root, "node_modules/plain-lib/package.json"), "utf8")).spark)
    .toEqual({ dependencyPatch: { schema: 1, version: "1.0.0", appPatchHash: hash(own), appRoot: root } });
  prepareNativePatches(root);
  expect(podspec(root, "plain-lib")).toBe(upstream.replace("two", "TWO"));
});

test("spark.patches opt-out removes Spark's layer, keeps the app's, and warns", () => {
  const root = fixture();
  prepareNativePatches(root);
  expect(podspec(root, "native-lib")).toBe(sparkPatched);
  const app = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ ...app, spark: { patches: { "native-lib": false } } }));
  const own = diff(upstream, upstream.replace("seven", "SEVEN"));
  writeFileSync(path.join(root, "patches/native-lib@1.0.0.patch"), own);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  prepareNativePatches(root);
  expect(podspec(root, "native-lib")).toBe(upstream.replace("seven", "SEVEN"));
  expect(receipt(root, "native-lib")).toEqual({ schema: 1, version: "1.0.0", appPatchHash: hash(own), appRoot: root, upstreamIntegrity: "sha512-fixture" });
  expect(warn).toHaveBeenCalledWith("Spark's native-lib patch is disabled by spark.patches in package.json; desktop support for native-lib isn't guaranteed.");
  expect(validateAppPatches(root, installedPackages(root))).toEqual([]);
});

test("patch-package and patchedDependencies patches become the app layer only on Spark-patched libraries", () => {
  const root = fixture({ patchedDependencies: { "plain-lib@1.0.0": "patches/plain-lib@1.0.0.patch" } });
  const own = diff(upstream, upstream.replace("seven", "SEVEN"), "node_modules/native-lib/");
  writeFileSync(path.join(root, "patches/native-lib+1.0.0.patch"), own);
  writeFileSync(path.join(root, "patches/plain-lib@1.0.0.patch"), diff(upstream, upstream.replace("two", "TWO")));
  for (const part of ["001+a", "002+b"]) writeFileSync(path.join(root, `patches/other-lib+1.0.0+${part}.patch`), diff(upstream, upstream));
  // The package manager applied both patches to upstream at install.
  install(root, "native-lib", upstream.replace("seven", "SEVEN"));
  install(root, "plain-lib", upstream.replace("two", "TWO"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  prepareNativePatches(root);
  expect(podspec(root, "native-lib")).toBe(both);
  expect(receipt(root, "native-lib")).toMatchObject({ appPatchHash: hash(own) });
  expect(warn).toHaveBeenCalledWith(`Spark applies its native-lib patch first, then ${path.join("patches", "native-lib+1.0.0.patch")}.`);
  expect(podspec(root, "plain-lib")).toBe(upstream.replace("two", "TWO"));
  expect(receipt(root, "plain-lib")).toBeUndefined();
  expect(validateAppPatches(root, installedPackages(root))).toEqual([]);
});

test("an app patch for another version fails before anything is written", () => {
  const root = fixture();
  writeFileSync(path.join(root, "patches/native-lib@0.9.0.patch"), diff(sparkPatched, both));
  expect(() => prepareNativePatches(root)).toThrow(`${path.join("patches", "native-lib@0.9.0.patch")} patches native-lib@0.9.0, but 1.0.0 is installed. Redo it with spark patch native-lib.`);
  expect(podspec(root, "native-lib")).toBe(upstream);
  expect(receipt(root, "native-lib")).toBeUndefined();
});

test("an app patch that no longer fits leaves the package untouched", () => {
  const root = fixture();
  writeFileSync(path.join(root, "patches/native-lib@1.0.0.patch"), diff(upstream.replace("seven", "eight"), upstream.replace("seven", "EIGHT")));
  expect(() => prepareNativePatches(root)).toThrow(`Cannot apply ${path.join("patches", "native-lib@1.0.0.patch")} to Native.podspec on top of Spark's patch. Redo it with spark patch native-lib.`);
  expect(podspec(root, "native-lib")).toBe(upstream);
});

test("spark patch round trip saves a diff against the Spark-patched library and re-edits it", () => {
  const root = fixture();
  vi.spyOn(console, "log").mockImplementation(() => {});
  const edit = patchLibrary(root, "native-lib");
  expect(readFileSync(path.join(edit, "Native.podspec"), "utf8")).toBe(sparkPatched);
  writeFileSync(path.join(edit, "Native.podspec"), both);
  writeFileSync(path.join(edit, "Added.swift"), "AppKit\n");
  const file = patchLibrary(root, "native-lib", { done: true });
  expect(file).toBe(path.join(root, "patches/native-lib@1.0.0.patch"));
  expect(readFileSync(file, "utf8")).toContain("+SEVEN");
  expect(readFileSync(file, "utf8")).not.toContain("+ONE");
  expect(podspec(root, "native-lib")).toBe(both);
  expect(receipt(root, "native-lib")).toMatchObject({ appPatchHash: hash(readFileSync(file, "utf8")) });
  // Editing again starts from Spark's patch without the app's, and dropped changes are undone.
  const again = patchLibrary(root, "native-lib");
  expect(readFileSync(path.join(again, "Native.podspec"), "utf8")).toBe(sparkPatched);
  expect(existsSync(path.join(again, "Added.swift"))).toBe(false);
  writeFileSync(path.join(again, "Native.podspec"), sparkPatched.replace("two", "TWO"));
  patchLibrary(root, "native-lib", { done: true });
  expect(podspec(root, "native-lib")).toBe(sparkPatched.replace("two", "TWO"));
  expect(existsSync(path.join(root, "node_modules/native-lib/Added.swift"))).toBe(false);
  install(root, "native-lib");
  prepareNativePatches(root);
  expect(podspec(root, "native-lib")).toBe(sparkPatched.replace("two", "TWO"));
  expect(validateAppPatches(root, installedPackages(root))).toEqual([]);
});

test("spark patch finds libraries whose exports hide package.json", () => {
  const root = fixture();
  vi.spyOn(console, "log").mockImplementation(() => {});
  writeFileSync(path.join(root, "node_modules/plain-lib/package.json"), JSON.stringify({ name: "plain-lib", version: "1.0.0", exports: { ".": "./index.js" } }));
  const edit = patchLibrary(root, "plain-lib");
  writeFileSync(path.join(edit, "Native.podspec"), both);
  expect(patchLibrary(root, "plain-lib", { done: true })).toBe(path.join(root, "patches/plain-lib@1.0.0.patch"));
  expect(podspec(root, "plain-lib")).toBe(both);
});

test("Spark's own repository doesn't read its patches folder as app patches", () => {
  const root = fixture();
  const spark = path.join(root, "node_modules/@legendapp/spark/patches");
  for (const [from, to] of [["dependencies.json", "dependencies.json"], ["native-lib.patch", "native-lib@1.0.0.patch"]]) {
    writeFileSync(path.join(root, "patches", to), readFileSync(path.join(spark, from)));
  }
  prepareNativePatches(root);
  expect(podspec(root, "native-lib")).toBe(sparkPatched);
  expect(validateAppPatches(root, installedPackages(root))).toEqual([]);
});

test("spark patch finds the patches owner above cwd and can write the patch elsewhere", () => {
  const root = fixture();
  vi.spyOn(console, "log").mockImplementation(() => {});
  mkdirSync(path.join(root, "apps/plain/src"), { recursive: true });
  expect(patchRoot(path.join(root, "apps/plain/src"))).toBe(root);
  // A Spark app keeps its own patches even before it has a patches/ folder.
  writeFileSync(path.join(root, "apps/plain/app.json"), "{}");
  writeFileSync(path.join(root, "apps/plain/package.json"), "{}");
  expect(patchRoot(path.join(root, "apps/plain/src"))).toBe(path.join(root, "apps/plain"));
  const out = path.join(root, "shared");
  const edit = patchLibrary(root, "plain-lib", { out });
  writeFileSync(path.join(edit, "Native.podspec"), both);
  expect(patchLibrary(root, "plain-lib", { out, done: true })).toBe(path.join(out, "patches/plain-lib@1.0.0.patch"));
  expect(existsSync(path.join(root, "patches/plain-lib@1.0.0.patch"))).toBe(false);
  // The install follows the patches it reads, not ones saved elsewhere.
  expect(podspec(root, "plain-lib")).toBe(upstream);
});

test("app roots sharing an install must carry the same app patch", () => {
  const root = fixture();
  const own = diff(sparkPatched, both);
  writeFileSync(path.join(root, "patches/native-lib@1.0.0.patch"), own);
  prepareNativePatches(root);
  const other = path.join(root, "apps/other");
  mkdirSync(path.join(other, "patches"), { recursive: true });
  writeFileSync(path.join(other, "package.json"), readFileSync(path.join(root, "package.json")));
  writeFileSync(path.join(other, "patches/native-lib@1.0.0.patch"), own);
  prepareNativePatches(other);
  expect(receipt(root, "native-lib")).toMatchObject({ appPatchHash: hash(own), appRoot: root });
  for (const patch of [diff(sparkPatched, sparkPatched.replace("two", "TWO")), undefined]) {
    if (patch) writeFileSync(path.join(other, "patches/native-lib@1.0.0.patch"), patch);
    else rmSync(path.join(other, "patches/native-lib@1.0.0.patch"));
    expect(() => prepareNativePatches(other)).toThrow(`native-lib in ${realpathSync(path.join(root, "node_modules/native-lib"))} carries the app patch from ${root}, not ${other}'s. App roots that share one install need one patch set: keep the patch at the shared root and give every app the same file, or reinstall native-lib.`);
    expect(podspec(root, "native-lib")).toBe(both);
  }
});

test("editing or removing an app patch undoes the old layer without a reinstall", () => {
  const root = fixture();
  for (const [name, base] of [["native-lib", sparkPatched], ["plain-lib", upstream]]) {
    const file = path.join(root, `patches/${name}@1.0.0.patch`);
    writeFileSync(file, diff(base, base.replace("seven", "SEVEN")));
    prepareNativePatches(root);
    writeFileSync(file, diff(base, base.replace("seven", "Seven").replace("two", "TWO")));
    prepareNativePatches(root);
    expect(podspec(root, name)).toBe(base.replace("seven", "Seven").replace("two", "TWO"));
    expect(validateAppPatches(root, installedPackages(root))).toEqual([]);
    rmSync(file);
    prepareNativePatches(root);
    expect(podspec(root, name)).toBe(base);
    expect(receipt(root, name)?.appPatchHash).toBeUndefined();
    expect(validateAppPatches(root, installedPackages(root))).toEqual([]);
  }
  expect(JSON.parse(readFileSync(path.join(root, "node_modules/plain-lib/package.json"), "utf8")).spark).toBeUndefined();
});

test("doctor reports all stale and missing app patches with fixes, including package-manager declarations", () => {
  const root = fixture({ patchedDependencies: { "plain-lib@0.9.0": "custom.patch", "missing-lib@1.0.0": "missing.patch" } });
  writeFileSync(path.join(root, "patches/native-lib@0.9.0.patch"), diff(sparkPatched, both));
  for (const file of ["custom.patch", "missing.patch"]) writeFileSync(path.join(root, file), diff(upstream, both));
  const message = appPatchIssues(root).join("\n");
  expect(message).toContain(`${path.join("patches", "native-lib@0.9.0.patch")} patches native-lib@0.9.0, but 1.0.0 is installed`);
  expect(message).toContain("custom.patch patches plain-lib@0.9.0, but 1.0.0 is installed");
  expect(message).toContain("missing.patch patches missing-lib, which isn't installed");
  expect(message.match(/Fix:/g)).toHaveLength(3);
  expect(message).toContain("patchedDependencies");
  expect(message).toContain("spark patch native-lib");
  expect(podspec(root, "native-lib")).toBe(upstream);
  expect(receipt(root, "native-lib")).toBeUndefined();
});

test.each(["convention", "bun", "pnpm", "patch-package"])("doctor detects %s patches that conflict with Spark without changing the install", source => {
  const file = path.join("patches", source === "patch-package" ? "native-lib+1.0.0.patch" : "native-lib@1.0.0.patch");
  const declaration = { patchedDependencies: { "native-lib@1.0.0": file } };
  const root = fixture(source === "bun" ? declaration : source === "pnpm" ? { pnpm: declaration } : {});
  // The package manager's patch applies to upstream, but cannot follow Spark's change to the same line.
  const own = diff(upstream, upstream.replace("one", "APP"), source === "patch-package" ? "node_modules/native-lib/" : "");
  writeFileSync(path.join(root, file), own);
  install(root, "native-lib", source === "convention" ? upstream : upstream.replace("one", "APP"));
  const before = podspec(root, "native-lib");
  const issues = appPatchIssues(root);
  expect(issues).toHaveLength(1);
  expect(issues[0]).toContain(`${file} conflicts with Spark's native-lib patch at Native.podspec`);
  expect(issues[0]).toContain("Fix:");
  expect(podspec(root, "native-lib")).toBe(before);
  expect(receipt(root, "native-lib")).toBeUndefined();
});

test("doctor patch checks accept compatible layers, edited receipts, opt-outs, and scoped hoisted libraries", () => {
  const root = fixture();
  const file = path.join(root, "patches/native-lib@1.0.0.patch");
  writeFileSync(file, diff(sparkPatched, both));
  expect(appPatchIssues(root)).toEqual([]);
  expect(podspec(root, "native-lib")).toBe(upstream);
  prepareNativePatches(root);
  const manifest = readFileSync(path.join(root, "node_modules/native-lib/package.json"), "utf8");
  writeFileSync(file, diff(sparkPatched, sparkPatched.replace("seven", "Seven")));
  expect(appPatchIssues(root)).toEqual([]);
  expect(podspec(root, "native-lib")).toBe(both);
  expect(readFileSync(path.join(root, "node_modules/native-lib/package.json"), "utf8")).toBe(manifest);
  const app = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ ...app, spark: { patches: { "native-lib": false } } }));
  writeFileSync(file, diff(upstream, upstream.replace("one", "APP")));
  expect(appPatchIssues(root)).toEqual([]);
  install(root, "@scope/lib");
  writeFileSync(path.join(root, "node_modules/@scope/lib/package.json"), JSON.stringify({ name: "@scope/lib", version: "1.0.0", exports: { ".": "./index.js" } }));
  const child = path.join(root, "apps/child");
  mkdirSync(path.join(child, "patches"), { recursive: true });
  writeFileSync(path.join(child, "package.json"), "{}");
  writeFileSync(path.join(child, "patches/@scope+lib@0.9.0.patch"), diff(upstream, both));
  expect(appPatchIssues(child)[0]).toContain("@scope/lib@0.9.0, but 1.0.0 is installed");
});


test("doctor keeps stale versions visible when another declaration patches the same library", () => {
  const root = fixture({ patchedDependencies: {
    "plain-lib@0.9.0": "old.patch", "plain-lib@1.0.0": "current.patch",
  } });
  for (const file of ["old.patch", "current.patch"]) writeFileSync(path.join(root, file), diff(upstream, both));
  expect(appPatchIssues(root)).toEqual([
    expect.stringContaining("old.patch patches plain-lib@0.9.0, but 1.0.0 is installed"),
  ]);
});

test("package.json spark.patches rejects malformed values and misspelled packages before patching", () => {
  for (const patches of [null, [], "native-lib", { "native-lib": "false" }, { "native-lbi": false }]) {
    const root = fixture({ spark: { patches } });
    expect(() => prepareNativePatches(root)).toThrow(/spark.patches/);
    expect(podspec(root, "native-lib")).toBe(upstream);
    expect(receipt(root, "native-lib")).toBeUndefined();
  }
});

test("package.json spark metadata rejects unknown fields and malformed dependency lists", () => {
  for (const spark of [{ patchess: {} }, { sdk: "true" }, { requires: "native-lib" }, { nativeModuels: [] }, { entitlements: { maco: {} } }]) {
    const root = fixture({ spark });
    expect(() => prepareNativePatches(root)).toThrow(/package.json spark/);
    expect(() => installedPackages(root)).toThrow(/package.json spark/);
    expect(podspec(root, "native-lib")).toBe(upstream);
  }
  const root = fixture({ spark: { sdk: false, nativeModules: ["NativeApp"], requires: [], pod: "NativeApp", platforms: ["macos"] } });
  expect(() => installedPackages(root)).not.toThrow();
});
