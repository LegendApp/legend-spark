import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  VERSION,
  goConfigurationIssues,
  hashFiles,
  nativePackages,
  nativePreparationFingerprint,
  installedPackages,
  localSigningIdentity,
  projectEnvironment,
  incompatible,
  selection,
  type NativePackage,
  type Runtime,
} from "../packages/cli/src/project.ts";

test("CocoaPods preparation changes when identical native packages move", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-native-preparation-"));
  try {
    writeFileSync(path.join(root, "package.json"), "{}");
    writeFileSync(path.join(root, "app.json"), JSON.stringify({ expo: { name: "Fixture" } }));
    const packages = ["before", "after"].map(directory => {
      const location = path.join(root, directory);
      mkdirSync(location);
      writeFileSync(path.join(location, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }));
      return { name: "fixture", root: location, json: {}, sdk: false, requires: [], signature: "same" } as NativePackage;
    });
    const original = nativePreparationFingerprint(root, [packages[0]]);
    expect(nativePreparationFingerprint(root, [packages[0]])).toBe(original);
    expect(nativePreparationFingerprint(root, [packages[1]])).not.toBe(original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("local development signing is opt-in and cannot affect distribution builds", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-dev-signing-"));
  try {
    expect(localSigningIdentity(root, "dev")).toBe("-");
    mkdirSync(path.join(root, ".spark"));
    const settings = path.join(root, ".spark/settings.json");
    writeFileSync(settings, JSON.stringify({ macOSDevelopmentIdentity: "Apple Development: Example" }));
    expect(localSigningIdentity(root, "dev")).toBe("Apple Development: Example");
    for (const mode of ["release", "preview", "go"]) expect(localSigningIdentity(root, mode)).toBe("-");
    writeFileSync(settings, JSON.stringify({ macOSDevelopmentIdentity: "--invalid" }));
    expect(() => localSigningIdentity(root, "dev")).toThrow("signing certificate");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function pkg(name: string, sdk = true, requires: string[] = []): NativePackage {
  return {
    name,
    root: `/packages/${name}`,
    json: { name, version: "1.0.0" },
    sdk,
    requires,
    signature: name + "-hash",
  };
}
test("production keeps reachable SDK features and transitive native requirements", () => {
  const graph = [
    pkg("dialogs"),
    pkg("menus"),
    pkg("host"),
    pkg("documents", true, ["dialogs", "host"]),
  ];
  const result = selection(graph, new Set(["documents"]));
  expect(result.included.map((p) => p.name)).toEqual([
    "dialogs",
    "host",
    "documents",
  ]);
  expect(result.excluded.map((p) => p.name)).toEqual(["menus"]);
});
test("retained third-party native packages keep their SDK dependencies", () => {
  const dependency = pkg("custom", false);
  dependency.json.dependencies = { dialogs: "1.0.0" };
  const result = selection(
    [pkg("dialogs"), pkg("menus"), dependency],
    new Set(),
  );
  expect(result.included.map((p) => p.name)).toEqual(["dialogs", "custom"]);
});
test("explicit native-only inclusions survive pruning and missing metadata fails", () => {
  expect(selection([pkg("menus")], new Set(), ["menus"]).excluded).toHaveLength(
    0,
  );
  expect(() => selection([pkg("menus")], new Set(), ["missing"])).toThrow(
    "not installed",
  );
  expect(() =>
    selection([pkg("menus", true, ["missing"])], new Set(["menus"])),
  ).toThrow("requires missing");
});
test("a runtime superset is compatible but missing or modified native code is not", () => {
  const runtime: Runtime = {
    schema: 1,
    framework: VERSION,
    platform: "macos",
    arch: "arm64",
    mode: "go",
    fingerprint: "go",
    modules: { dialogs: "dialogs-hash", menus: "menus-hash" },
  };
  expect(incompatible(runtime, [pkg("dialogs")])).toEqual([]);
  expect(incompatible(runtime, [pkg("greeting", false)])).toEqual(["greeting"]);
  expect(
    incompatible(runtime, [{ ...pkg("dialogs"), signature: "changed" }]),
  ).toEqual(["dialogs"]);
});
test("native source content changes invalidate hashes without build-directory noise", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-hash-"));
  try {
    mkdirSync(path.join(root, "ios/build"), { recursive: true });
    writeFileSync(path.join(root, "ios/Module.mm"), "one");
    const initial = hashFiles(root, ["ios"]);
    writeFileSync(path.join(root, "ios/build/cache"), "noise");
    expect(hashFiles(root, ["ios"])).toBe(initial);
    writeFileSync(path.join(root, "ios/Module.mm"), "two");
    expect(hashFiles(root, ["ios"])).not.toBe(initial);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("Go permits ordinary identity but rejects app-specific native configuration", () => {
  expect(
    goConfigurationIssues({
      expo: {
        macos: {
          bundleIdentifier: "example.app",
          infoPlist: { CFBundleName: "App" },
        },
        plugins: ["@legendapp/spark-desktop-config"],
      },
    }),
  ).toEqual([]);
  expect(
    goConfigurationIssues({
      expo: { macos: { infoPlist: { CFBundleDocumentTypes: [] } } },
    }),
  ).toHaveLength(1);
  expect(
    goConfigurationIssues({ expo: { plugins: ["third-party-native-plugin"] } }),
  ).toHaveLength(1);
});

test("host-only and CNG-only edits invalidate the Go compatibility signature", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-host-hash-"));
  try {
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { "@legendapp/spark-desktop-app": "1", "@legendapp/spark-desktop-host": "1", "@legendapp/spark-desktop-config": "1" } }));
    for (const name of ["desktop-app", "desktop-host", "desktop-config"]) {
      const dir = path.join(root, "node_modules/@legendapp", name === "desktop" ? "spark" : `spark-${name}`); mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: name === "desktop" ? "@legendapp/spark" : `@legendapp/spark-${name}`, version: "1", ...(name === "desktop-app" ? { spark: { nativeModules: ["NativeDesktopApp"] } } : {}) }));
    }
    const initial = nativePackages(root)[0]!.signature;
    writeFileSync(path.join(root, "node_modules/@legendapp/spark-desktop-host/AppDelegate.mm"), "changed native host");
    const hostChanged = nativePackages(root)[0]!.signature; expect(hostChanged).not.toBe(initial);
    writeFileSync(path.join(root, "node_modules/@legendapp/spark-desktop-config/app.plugin.cjs"), "changed native config");
    expect(nativePackages(root)[0]!.signature).not.toBe(hostChanged);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Go launch identity is explicit, validated, and optional for opening a standalone binary", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-project-env-"));
  try {
    expect(projectEnvironment(root)).toEqual({});
    writeFileSync(path.join(root, "app.json"), JSON.stringify({ expo: { name: "Demo", version: "2.3.4", extra: { spark: { projectId: "stable-id" } } } }));
    expect(projectEnvironment(root)).toEqual({ SPARK_WINDOW_CONFIG: "{}", SPARK_PROJECT_ID: "stable-id", SPARK_PROJECT_NAME: "Demo", SPARK_PROJECT_VERSION: "2.3.4" });
    writeFileSync(path.join(root, "app.json"), JSON.stringify({ expo: { extra: { spark: { projectId: {} } } } }));
    expect(() => projectEnvironment(root)).toThrow("stable project identifier");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("optional native peers do not force unused integrations into production", () => {
  const packages = [
    { name: "host", sdk: false, requires: [], json: { peerDependencies: { webview: "*" }, peerDependenciesMeta: { webview: { optional: true } } } },
    { name: "webview", sdk: true, requires: [], json: {} },
  ] as any;
  expect(selection(packages, new Set()).included.map(pkg => pkg.name)).toEqual(["host"]);
  expect(selection(packages, new Set(["webview"])).included.map(pkg => pkg.name)).toEqual(["host", "webview"]);
  packages[0].json.dependencies = { webview: "1.0.0" };
  expect(selection(packages, new Set()).included.map(pkg => pkg.name)).toEqual(["host", "webview"]);
});

test("an optional peer in a parent workspace is not a native requirement unless the app declares it", () => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "spark-optional-parent-"));
  const root = path.join(workspace, "apps/consumer");
  const adapter = path.join(root, "node_modules/adapter");
  const optional = path.join(workspace, "node_modules/mobile-backend");
  const manifest = { name: "consumer", dependencies: { adapter: "1.0.0" } as Record<string, string> };
  try {
    mkdirSync(adapter, { recursive: true }); mkdirSync(optional, { recursive: true });
    writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
    writeFileSync(path.join(adapter, "package.json"), JSON.stringify({ name: "adapter", version: "1.0.0", peerDependencies: { "mobile-backend": "1.0.0" }, peerDependenciesMeta: { "mobile-backend": { optional: true } } }));
    writeFileSync(path.join(optional, "package.json"), JSON.stringify({ name: "mobile-backend", version: "1.0.0", codegenConfig: { name: "MobileBackend" } }));
    expect(nativePackages(root).map(pkg => pkg.name)).not.toContain("mobile-backend");
    manifest.dependencies["mobile-backend"] = "1.0.0";
    writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
    expect(nativePackages(root).map(pkg => pkg.name)).toContain("mobile-backend");
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test("single-platform native discovery respects explicit autolinking exclusions", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-native-exclusion-"));
  try {
    const module = path.join(root, "node_modules/optional-native");
    mkdirSync(module, { recursive: true });
    writeFileSync(path.join(module, "package.json"), JSON.stringify({ name: "optional-native", version: "1.0.0", codegenConfig: { name: "OptionalSpec" } }));
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "probe", dependencies: { "optional-native": "1.0.0" } }));
    const config = { expo: { name: "Probe", platforms: ["macos"], autolinking: { exclude: ["optional-native"] } } };
    writeFileSync(path.join(root, "app.json"), JSON.stringify(config));
    expect(nativePackages(root)).toEqual([]);
    config.expo.autolinking.exclude = [];
    writeFileSync(path.join(root, "app.json"), JSON.stringify(config));
    expect(nativePackages(root).map(pkg => pkg.name)).toEqual(["optional-native"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("dependency discovery accepts packages exposing only subpath entries", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-subpaths-"));
  try {
    const module = path.join(root, "node_modules/@example/list");
    mkdirSync(module, { recursive: true });
    writeFileSync(path.join(module, "package.json"), JSON.stringify({ name: "@example/list", version: "1.0.0", exports: { "./native": "./native.js" } }));
    writeFileSync(path.join(module, "native.js"), "module.exports = {};");
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "probe", dependencies: { "@example/list": "1.0.0" } }));
    expect(installedPackages(root).map(pkg => pkg.name)).toEqual(["@example/list"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("app overrides retain patched native packages reached through linked workspaces", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-native-override-"));
  try {
    const app = path.join(root, "app");
    const library = path.join(root, "library");
    for (const dir of [app, library]) mkdirSync(path.join(dir, "node_modules/native-fixture"), { recursive: true });
    const appManifest = { dependencies: { "linked-library": "file:../library" }, overrides: { "native-fixture": "file:patched.tgz" } };
    writeFileSync(path.join(app, "package.json"), JSON.stringify(appManifest));
    writeFileSync(path.join(library, "package.json"), JSON.stringify({ name: "linked-library", version: "1", dependencies: { "native-fixture": "1" } }));
    symlinkSync(library, path.join(app, "node_modules/linked-library"));
    for (const dir of [app, library]) {
      writeFileSync(path.join(dir, "node_modules/native-fixture/package.json"), JSON.stringify({ name: "native-fixture", version: "1", spark: { nativeModules: ["Fixture"] } }));
    }
    const patched = path.join(app, "node_modules/native-fixture");
    expect(installedPackages(app).find(pkg => pkg.name === "native-fixture")?.root).toBe(realpathSync(patched));
    writeFileSync(path.join(app, "package.json"), JSON.stringify({ dependencies: appManifest.dependencies }));
    expect(installedPackages(app).find(pkg => pkg.name === "native-fixture")?.root).toBe(realpathSync(path.join(library, "node_modules/native-fixture")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
