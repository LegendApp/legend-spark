import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyze, build } from "../packages/cli/src/build.ts";
import { nativePackages, readJson, writeJson } from "../packages/cli/src/project.ts";

const commands = vi.hoisted(() => ({ run: vi.fn(), sources: [] as string[] }));
vi.mock("../packages/cli/src/commands.ts", () => ({ doctor: vi.fn(), binary: (_root: string, name: string) => name, run: commands.run }));
vi.mock("../packages/cli/src/native-patch-preflight.ts", () => ({ assertNativePatchPreflight: vi.fn() }));

let root: string;
const excluded = "@legendapp/spark-system";
const configure = (include: string[] = []) => writeJson(path.join(root, "desktop.config.json"), {
  name: "Fixture", projectId: "test.fixture", version: "1.0.0", platforms: ["macos"],
  macos: { bundleIdentifier: "test.fixture" }, include,
  expo: { autolinking: { exclude: [excluded] } },
});
const module = (name: string, metadata = {}) => writeJson(path.join(root, "node_modules", name, "package.json"), {
  name, version: "1.0.0", spark: { sdk: true, nativeModules: ["Fixture"] }, ...metadata,
});
const report = () => readJson(path.join(root, ".spark/selection-report.json"));

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "spark-release-native-"));
  writeJson(path.join(root, "package.json"), { main: "index.ts", dependencies: { [excluded]: "1", feature: "1", dependency: "1" } });
  module(excluded);
  module("feature");
  module("dependency");
  configure();
  commands.sources = [];
  commands.run.mockReset();
  commands.run.mockImplementation(async (_root: string, argv: string[]) => {
    expect(argv).toContain("export:embed");
    writeFileSync(argv[argv.indexOf("--bundle-output") + 1]!, "bundle");
    writeFileSync(argv[argv.indexOf("--sourcemap-output") + 1]!, JSON.stringify({ sources: commands.sources }));
    return "";
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test.each(["release", "preview"] as const)("%s rejects excluded bundled native modules before native compilation and writes their importer", async mode => {
  mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, "src/ExportPanel.tsx"), 'import "@legendapp/spark/system";');
  commands.sources = [`node_modules/${excluded}/src/index.ts`, "src/ExportPanel.tsx"];
  await expect(build(root, mode)).rejects.toThrow("Release native-module check failed: 1 excluded native package is required.");
  expect(commands.run).toHaveBeenCalledTimes(2);
  expect(report().nativeCheck.violations).toEqual([{ name: excluded, reasons: ["used by the production bundle"], importedFrom: "src/ExportPanel.tsx" }]);
  expect(report().included).not.toContain(excluded);
});

test.each(["dependencies", "peerDependencies", "spark.requires"])("rejects excluded %s of a transitively included native package", async edge => {
  module("feature", { dependencies: { dependency: "1" } });
  module("dependency", edge === "spark.requires"
    ? { spark: { sdk: true, nativeModules: ["Fixture"], requires: [excluded] } }
    : { [edge]: { [excluded]: "1" } });
  commands.sources = ["node_modules/feature/src/index.ts"];
  await expect(analyze(root)).rejects.toThrow(`required by included dependency (${edge})`);
  expect(report().nativeCheck.violations).toEqual([{ name: excluded, reasons: [`required by included dependency (${edge})`] }]);
});

test.each(["modules/system/src/index.ts", "/modules/system/src/index.ts"])("recognizes linked native packages in source maps using %s", async source => {
  const linked = path.join(root, "modules/system");
  writeJson(path.join(linked, "package.json"), readJson(path.join(root, "node_modules", excluded, "package.json")));
  mkdirSync(path.join(linked, "src"));
  writeFileSync(path.join(linked, "src/index.ts"), "export const native = true;");
  rmSync(path.join(root, "node_modules", excluded), { recursive: true });
  symlinkSync(linked, path.join(root, "node_modules", excluded));
  commands.sources = [source];
  await expect(analyze(root)).rejects.toThrow("used by the production bundle");
  expect(report().nativeCheck.violations[0].name).toBe(excluded);
});

test("recognizes workspace packages in source maps relative to Metro's server root above the app", async () => {
  const app = path.join(root, "app");
  mkdirSync(app);
  renameSync(path.join(root, "desktop.config.json"), path.join(app, "desktop.config.json"));
  writeJson(path.join(app, "package.json"), { main: "index.ts" });
  const linked = path.join(root, "packages/system");
  mkdirSync(path.join(linked, "src"), { recursive: true });
  writeJson(path.join(linked, "package.json"), readJson(path.join(root, "node_modules", excluded, "package.json")));
  writeFileSync(path.join(linked, "src/index.ts"), "export const native = true;");
  rmSync(path.join(root, "node_modules", excluded), { recursive: true });
  symlinkSync(linked, path.join(root, "node_modules", excluded));
  commands.sources = ["/packages/system/src/index.ts"];
  await expect(analyze(app)).rejects.toThrow("used by the production bundle");
});

test("checks excluded native packages available only through the shared parent install", async () => {
  const app = path.join(root, "app");
  mkdirSync(app);
  renameSync(path.join(root, "desktop.config.json"), path.join(app, "desktop.config.json"));
  writeJson(path.join(app, "package.json"), { main: "index.ts", dependencies: { feature: "1" } });
  module(excluded, { dependencies: { dependency: "1" } });
  module("dependency", { spark: { nativeModules: ["Conservative"] } });
  expect(nativePackages(app).map(pkg => pkg.name)).toEqual(["feature"]);
  expect(nativePackages(app, { applyExcludes: false }).map(pkg => pkg.name)).toEqual([excluded, "feature"]);
  commands.sources = [`../node_modules/${excluded}/src/index.ts`];
  await expect(analyze(app)).rejects.toThrow("used by the production bundle");
  expect(readJson(path.join(app, ".spark/selection-report.json")).nativeCheck.violations[0].name).toBe(excluded);
});

test("unused excluded packages pass and optional native edges do not fail the release check", async () => {
  module(excluded, { spark: { nativeModules: ["Fixture"] } });
  module("feature", { dependencies: { [excluded]: "1" }, optionalDependencies: { [excluded]: "1" }, peerDependencies: { [excluded]: "1" }, peerDependenciesMeta: { [excluded]: { optional: true } } });
  commands.sources = ["node_modules/feature/src/index.ts"];
  expect((await analyze(root)).included.map(pkg => pkg.name)).toEqual(["feature"]);
  expect(report().nativeCheck).toEqual({ violations: [] });
});

test("an explicit native include conflicting with exclusions fails with a report", async () => {
  configure([excluded]);
  await expect(analyze(root)).rejects.toThrow("explicit native include");
  expect(report().nativeCheck.violations).toEqual([{ name: excluded, reasons: ["explicit native include"] }]);
});
