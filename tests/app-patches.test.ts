import { afterEach, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import { prepareNativePatches } from "../packages/config-plugin/native-patches.cjs";
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
    .toEqual({ dependencyPatch: { schema: 1, version: "1.0.0", appPatchHash: hash(own) } });
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
  expect(receipt(root, "native-lib")).toEqual({ schema: 1, version: "1.0.0", appPatchHash: hash(own), upstreamIntegrity: "sha512-fixture" });
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
