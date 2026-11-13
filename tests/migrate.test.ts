import { afterEach, expect, test, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import * as commands from "../packages/cli/src/commands.ts";
import { migrate } from "../packages/cli/src/migrate.ts";
import { migrations } from "../packages/cli/src/migrations.cjs";
import { spawnProcess } from "../packages/cli/src/process.ts";
import { ensureProjectVersion } from "../packages/cli/src/project-version.ts";

const version = JSON.parse(readFileSync("packages/cli/package.json", "utf8")).version;
const defaults = JSON.parse(readFileSync("packages/cli/templates/blank-typescript/package.json", "utf8"));
const roots: string[] = [];
function json(root: string, file: string, value: object) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), JSON.stringify(value));
}
function app(inherited = false) {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "spark-migrate-cli-"));
  roots.push(workspace);
  const root = inherited ? path.join(workspace, "shell/.legend/spark/debug-host") : workspace;
  json(root, "package.json", { name: "generated-consumer", private: true, dependencies: inherited ? {} : { ...defaults.dependencies, "@legendapp/spark": version } });
  json(root, "desktop.config.json", { projectId: "migration-test", platforms: ["macos"] });
  if (inherited) json(workspace, "package.json", { dependencies: { ...defaults.dependencies, "@legendapp/spark": version } });
  for (const [name, installed] of Object.entries({ ...defaults.dependencies, "@legendapp/spark": version })) {
    json(workspace, `node_modules/${name}/package.json`, { name, version: installed, exports: { "./package.json": "./package.json" } });
  }
  writeFileSync(path.join(root, "bun.lock"), "keep lockfile\n");
  writeFileSync(path.join(root, "AGENTS.md"), "Keep team rules.\n");
  return { workspace, root };
}
function snapshot(root: string): Record<string, string> {
  return Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true }).filter(file => file.isFile()).map(file => {
    const name = path.relative(root, path.join(file.parentPath, file.name));
    return [name, readFileSync(path.join(root, name), "utf8")];
  }));
}
async function cli(root: string, ...args: string[]) {
  const child = spawnProcess([process.execPath, path.resolve("packages/cli/src/index.ts"), "migrate", "--project", root, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, npm_config_registry: "http://127.0.0.1:1" } });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { code, output: out + err };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test.each([false, true])("installed-version preview and apply preserve dependencies (inherited: %s)", async inherited => {
  const { root, workspace } = app(inherited);
  const before = snapshot(workspace);
  expect(() => ensureProjectVersion(root)).toThrow("pending migrations");
  const preview = await cli(root, "--dry-run");
  expect(preview.code).toBe(0);
  expect(preview.output).toContain("0.0.1-next.3 → 0.0.1-next.4 → 0.0.2 → 0.0.3");
  expect(preview.output).toContain("Manual step (0.0.3)");
  expect(snapshot(workspace)).toEqual(before);
  const applied = await cli(root);
  expect(applied.code).toBe(0);
  expect(readFileSync(path.join(root, ".spark/version"), "utf8")).toBe(version + "\n");
  expect(readFileSync(path.join(root, "AGENTS.md"), "utf8")).toContain("Keep team rules.");
  expect(readFileSync(path.join(root, ".spark/upgrade-notes.md"), "utf8")).toContain("0.0.3");
  for (const name of ["package.json", "bun.lock"]) expect(readFileSync(path.join(root, name), "utf8")).toBe(before[path.relative(workspace, path.join(root, name))]);
  ensureProjectVersion(root);
  const after = snapshot(workspace);
  const time = statSync(path.join(root, ".spark/version")).mtimeMs;
  expect((await cli(root)).code).toBe(0);
  expect(snapshot(workspace)).toEqual(after);
  expect(statSync(path.join(root, ".spark/version")).mtimeMs).toBe(time);
});

test("init stamps only a generated baseline and supports a write-free preview", async () => {
  const { root } = app(true);
  const before = snapshot(root);
  const preview = await cli(root, "--init", "--dry-run");
  expect(preview.code).toBe(0);
  expect(preview.output).toContain("(none pending)");
  expect(snapshot(root)).toEqual(before);
  expect((await cli(root, "--init")).code).toBe(0);
  expect(existsSync(path.join(root, ".spark/upgrade-notes.md"))).toBe(false);
  ensureProjectVersion(root);
  mkdirSync(path.join(root, ".spark"), { recursive: true });
  writeFileSync(path.join(root, ".spark/version"), "0.0.1-next.2\n");
  expect((await cli(root, "--init")).code).toBe(1);
  expect(readFileSync(path.join(root, ".spark/version"), "utf8")).toBe("0.0.1-next.2\n");
});

test.each(["", "broken", "0.0.3\n0.0.2", "999.0.0"])("refuses malformed receipts and downgrades without writes: %j", async receipt => {
  const { root } = app();
  mkdirSync(path.join(root, ".spark"));
  writeFileSync(path.join(root, ".spark/version"), receipt);
  const before = snapshot(root);
  for (const args of [[], ["--dry-run"], ["--init"]]) expect((await cli(root, ...args)).code).toBe(1);
  expect(snapshot(root)).toEqual(before);
});

test("required installs and configuration edits refuse before any changes", async () => {
  const { root } = app();
  json(root, "node_modules/react/package.json", { name: "react", version: "18.0.0", exports: { "./package.json": "./package.json" } });
  let before = snapshot(root);
  const preview = await cli(root, "--dry-run");
  expect(preview.code).toBe(0);
  expect(preview.output).toContain("react");
  expect(preview.output).toContain("install");
  expect(snapshot(root)).toEqual(before);
  const blocked = await cli(root);
  expect(blocked.code).toBe(1);
  expect(blocked.output).toContain("spark upgrade");
  expect(snapshot(root)).toEqual(before);
  json(root, "node_modules/react/package.json", { name: "react", version: defaults.dependencies.react, exports: { "./package.json": "./package.json" } });
  for (const window of [{ width: 900, height: 600 }, { width: 900 }]) {
    json(root, "desktop.config.json", { projectId: "test", platforms: ["macos"], window });
    before = snapshot(root);
    const result = await cli(root);
    expect(result.code).toBe(1);
    expect(result.output).toContain("configuration");
    expect(snapshot(root)).toEqual(before);
  }
});

test("preview and apply never request registry metadata, downloads, or installation", () => {
  const { root } = app();
  const req = createRequire(import.meta.url);
  const pacote = createRequire(req.resolve("npm/package.json"))("pacote");
  const install = vi.spyOn(commands, "run").mockRejectedValue(new Error("install forbidden"));
  const manifest = vi.spyOn(pacote, "manifest").mockImplementation(() => { throw new Error("registry forbidden"); });
  const extract = vi.spyOn(pacote, "extract").mockImplementation(() => { throw new Error("download forbidden"); });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network forbidden"); }));
  vi.spyOn(console, "log").mockImplementation(() => {});
  migrate(root, { dryRun: true });
  migrate(root);
  expect(install).not.toHaveBeenCalled();
  expect(manifest).not.toHaveBeenCalled();
  expect(extract).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

test("a failed partial apply keeps the old receipt and can retry", () => {
  const { root } = app();
  mkdirSync(path.join(root, ".spark"));
  writeFileSync(path.join(root, ".spark/version"), "0.0.2\n");
  const fs = createRequire(import.meta.url)("node:fs") as typeof import("node:fs");
  const rename = fs.renameSync;
  const failure = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
    if (to === path.join(root, ".spark/upgrade-notes.md")) throw new Error("write failed");
    return rename(from, to);
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  expect(() => migrate(root)).toThrow("write failed");
  expect(readFileSync(path.join(root, "AGENTS.md"), "utf8")).toContain("spark:skill:start");
  expect(readFileSync(path.join(root, ".spark/version"), "utf8")).toBe("0.0.2\n");
  failure.mockRestore();
  migrate(root);
  expect(readFileSync(path.join(root, ".spark/version"), "utf8")).toBe(version + "\n");
});

test("planning failures and install-input migrations refuse before any writes", () => {
  const { root } = app();
  const before = snapshot(root);
  const step: import("../packages/cli/src/migrations.cjs").Migration = { version, automatic: false, apply(context: import("../packages/cli/src/migration-helpers.cjs").MigrationContext) {
    context.writeFile("partially-planned.txt", "must not write");
    throw new Error("planning failed");
  } };
  migrations.push(step);
  vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    expect(() => migrate(root)).toThrow("planning failed");
    expect(snapshot(root)).toEqual(before);
    step.apply = context => context.editJson("package.json", pkg => { pkg.scripts = { install: "needs install" }; });
    expect(() => migrate(root)).toThrow("require an install or configuration changes");
    expect(snapshot(root)).toEqual(before);
  } finally { migrations.pop(); }
});

test("optional backends inherited from the workspace need no consumer install", async () => {
  const { root, workspace } = app(true);
  json(workspace, "package.json", { dependencies: { ...defaults.dependencies, "@legendapp/spark": version, "react-native-enriched-markdown": "1.1.1" } });
  json(workspace, "node_modules/react-native-enriched-markdown/package.json", { name: "react-native-enriched-markdown", version: "1.1.1" });
  writeFileSync(path.join(root, "App.ts"), "import { Markdown } from '@legendapp/spark/markdown';\n");
  expect((await cli(root)).code).toBe(0);
});

test("uninitialized configuration and a mismatched installed CLI refuse without writes", async () => {
  const { root } = app();
  json(root, "desktop.config.json", { platforms: ["macos"] });
  let before = snapshot(root);
  const blocked = await cli(root);
  expect(blocked.code).toBe(1);
  expect(blocked.output).toContain("configuration is uninitialized");
  expect(snapshot(root)).toEqual(before);
  json(root, "node_modules/@legendapp/spark/package.json", { version: "999.0.0" });
  before = snapshot(root);
  expect((await cli(root)).output).toContain("app's installed CLI");
  expect(snapshot(root)).toEqual(before);
});

test("stale dependency pins require an explicit owning-manifest update", async () => {
  const { root, workspace } = app(true);
  const pkg = JSON.parse(readFileSync(path.join(workspace, "package.json"), "utf8"));
  pkg.dependencies.react = "18.0.0";
  json(workspace, "package.json", pkg);
  const before = snapshot(workspace);
  const result = await cli(root);
  expect(result.code).toBe(1);
  expect(result.output).toContain("pin react to 19.2.0 in its owning manifest");
  expect(snapshot(workspace)).toEqual(before);
});

test("Windows migrations refuse a missing native dependency before recording success", async () => {
  const { root } = app();
  json(root, "desktop.config.json", { projectId: "windows", platforms: ["windows"] });
  const before = snapshot(root);
  const result = await cli(root);
  expect(result.code).toBe(1);
  expect(result.output).toContain("Install react-native-windows@0.83.2");
  expect(snapshot(root)).toEqual(before);
  json(root, "node_modules/react-native-windows/package.json", { version: "0.83.2" });
  expect((await cli(root)).code).toBe(0);
});

test("a symlinked receipt cannot redirect migration writes outside the project", async () => {
  const { root, workspace } = app(true);
  const external = path.join(workspace, "external-receipt");
  writeFileSync(external, version + "\n");
  mkdirSync(path.join(root, ".spark"));
  symlinkSync(external, path.join(root, ".spark/version"));
  const before = snapshot(workspace);
  expect((await cli(root)).output).toContain("Migration path is a symlink");
  expect(snapshot(workspace)).toEqual(before);
});
