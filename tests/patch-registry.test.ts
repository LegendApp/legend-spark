import { afterEach, expect, test, vi } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertRegistryVersions, compareVersions, ensurePatchRegistry, fetchRegistry, hash, patchSourceSHA, registryFindings, selectPatch, validateRegistry, type PatchRegistry } from "../packages/config-plugin/patch-registry.cjs";
import { prepareNativePatches } from "../packages/config-plugin/native-patches.cjs";
import { generateRegistry, validateRegistryFiles } from "../scripts/patch-registry.ts";

import { which } from "../packages/cli/src/process.ts";

const repository = path.resolve(import.meta.dirname, "..");
const directories: string[] = [];
const sha = "a".repeat(40);
const patch = "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-upstream\n+patched\n";
function json(file: string, value: unknown) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(value, null, 2) + "\n"); }
function temp() { const root = mkdtempSync(path.join(os.tmpdir(), "spark-registry-")); directories.push(root); return root; }
function fixture(version = "1.0.0", registry?: PatchRegistry) {
  const root = temp(), spark = path.join(root, "node_modules/@legendapp/spark"), library = path.join(root, "node_modules/example-lib");
  mkdirSync(path.join(spark, "vendor"), { recursive: true });
  json(path.join(root, "package.json"), { name: "test-app", packageManager: "npm@11.0.0", dependencies: { "@legendapp/spark": "0.0.4", "example-lib": version } });
  json(path.join(spark, "package.json"), { name: "@legendapp/spark", version: "0.0.4", spark: { bundledModuleRoot: "vendor" } });
  json(path.join(library, "package.json"), { name: "example-lib", version });
  writeFileSync(path.join(library, "file.txt"), "upstream\n");
  const manifest = registry ?? { schema: 1, libraries: { "example-lib": { kind: "patch", versions: [
    { version: "1.0.0", minSpark: "0.0.4", patch: "example-lib@1.0.0.patch", sha256: hash(patch), optional: true },
    { version: "2.0.0", minSpark: "0.0.4", patch: "example-lib@2.0.0.patch", sha256: hash(patch), optional: true },
  ] } } };
  json(path.join(spark, "patches/registry.json"), manifest);
  json(path.join(spark, "patches/dependencies.json"), { "example-lib": { version: "1.0.0", patch: "example-lib@1.0.0.patch", optional: true } });
  for (const lib of Object.values(manifest.libraries)) for (const entry of lib.versions) if (entry.patch) {
    mkdirSync(path.dirname(path.join(spark, "patches", entry.patch)), { recursive: true }); writeFileSync(path.join(spark, "patches", entry.patch), patch);
  }
  return { root, spark, library, registry: manifest, cache: path.join(root, "cache") };
}
const offline = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
function fetcher(registry: unknown, contents = patch) {
  return vi.fn(async (url: string) => new Response(url.endsWith("/commits/main") ? JSON.stringify({ sha }) : url.endsWith("registry.json") ? JSON.stringify(registry) : contents)) as unknown as typeof fetch;
}
afterEach(() => { delete process.env.SPARK_PATCH_REGISTRY_SOURCE; for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

test("registry is generated from dependency, camera, SDK and redirect inventories and checks every file", () => {
  const registry = JSON.parse(readFileSync(path.join(repository, "patches/registry.json"), "utf8"));
  expect(generateRegistry(repository)).toEqual(registry);
  validateRegistryFiles(repository, registry);
  expect(registry.libraries["expo-clipboard"].kind).toBe("redirect");
  expect(registry.libraries["react-native-webview"].kind).toBe("sdk");
  const root = temp();
  cpSync(path.join(repository, "patches"), path.join(root, "patches"), { recursive: true });
  writeFileSync(path.join(root, "patches/new-lib@1.0.0.patch"), patch);
  expect(() => validateRegistryFiles(root, registry)).toThrow("missing from registry");
  rmSync(path.join(root, "patches/new-lib@1.0.0.patch"));
  writeFileSync(path.join(root, "patches/react-native-mmkv@4.3.2.patch"), "modified");
  expect(() => validateRegistryFiles(root, registry)).toThrow("disagrees");
});

test.each([
  { schema: 2, libraries: {} }, { schema: 1, libraries: {}, ignored: true },
  { schema: 1, libraries: { lib: { kind: "patch", versions: [{ version: "^1.0.0", minSpark: "0.0.4" }] } } },
  { schema: 1, libraries: { lib: { kind: "patch", versions: [{ version: "1.0.0", minSpark: "0.0.4", patch: "../escape.patch", sha256: "a".repeat(64) }] } } },
  { schema: 1, libraries: { lib: { kind: "redirect", versions: [{ version: "1.0.0", minSpark: "latest" }] } } },
  { schema: 1, libraries: { lib: { kind: "redirect", versions: [{ version: "1.0.0", minSpark: "0.0.4", ignored: true }] } } },
  { schema: 1, libraries: { lib: { kind: "patch", versions: [{ version: "1.0.0", minSpark: "0.0.4", verified: false }] } } },
  { schema: 1, libraries: { lib: { kind: "redirect", versions: [{ version: "1.0.0", minSpark: "0.0.4", verified: true }] } } },
  { schema: 1, libraries: { lib: { kind: "patch", versions: [{ version: "1.0.0", minSpark: "0.0.4", verified: true, patch: "lib@1.0.0.patch", sha256: "a".repeat(64) }] } } },
])("rejects malformed registry or unsupported metadata", registry => expect(() => validateRegistry(registry)).toThrow());

function withVerified(f: ReturnType<typeof fixture>, entry: Record<string, unknown> = { version: "3.0.0", minSpark: "0.0.4", verified: true, optional: true }) {
  f.registry.libraries["example-lib"]!.versions.push(entry as PatchRegistry["libraries"][string]["versions"][number]);
  json(path.join(f.spark, "patches/registry.json"), validateRegistry(f.registry));
  return f;
}

test("a verified version is supported and applies no patch", async () => {
  const f = withVerified(fixture("3.0.0"));
  expect(registryFindings(f.root)).toEqual([]);
  await ensurePatchRegistry(f.root, { fetcher: offline, notice: vi.fn(), tty: false });
  prepareNativePatches(f.root);
  expect(readFileSync(path.join(f.library, "file.txt"), "utf8")).toBe("upstream\n");
  expect(existsSync(path.join(f.library, ".spark-base.patch"))).toBe(false);
  const receipt = JSON.parse(readFileSync(path.join(f.library, "package.json"), "utf8")).spark.dependencyPatch;
  expect(receipt.version).toBe("3.0.0");
  expect(receipt.patchHash).toBeUndefined();
});

test("prompts offer verified versions alongside patched ones", async () => {
  const f = withVerified(fixture("8.0.0")), ask = vi.fn(async (_message: string) => "");
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const install = vi.fn(async () => { json(path.join(f.library, "package.json"), { name: "example-lib", version: "3.0.0" }); });
  await ensurePatchRegistry(f.root, { fetcher: offline, notice: vi.fn(), tty: true, ask, install });
  expect(log).toHaveBeenCalledWith(expect.stringContaining("Supported versions: 3.0.0, 2.0.0, 1.0.0"));
  expect(ask.mock.calls[0]?.[0]).toContain("[3.0.0]");
  prepareNativePatches(f.root);
  expect(readFileSync(path.join(f.library, "file.txt"), "utf8")).toBe("upstream\n");
});

test("a verified recipe for a patched version removes the earlier Spark layer", async () => {
  const f = fixture();
  prepareNativePatches(f.root);
  expect(readFileSync(path.join(f.library, "file.txt"), "utf8")).toBe("patched\n");
  withVerified(f, { version: "1.0.0", minSpark: "0.0.5", verified: true, optional: true });
  const sdk = JSON.parse(readFileSync(path.join(f.spark, "package.json"), "utf8")); sdk.version = "0.0.5"; json(path.join(f.spark, "package.json"), sdk);
  prepareNativePatches(f.root);
  expect(readFileSync(path.join(f.library, "file.txt"), "utf8")).toBe("upstream\n");
  expect(existsSync(path.join(f.library, ".spark-base.patch"))).toBe(false);
});

test("selects the newest compatible revision of an exact installed version, with prerelease ordering", () => {
  const library = { kind: "redirect" as const, versions: [
    { version: "1.0.0", minSpark: "0.0.3" }, { version: "1.0.0", minSpark: "0.0.4" }, { version: "1.0.0", minSpark: "0.0.5" }, { version: "2.0.0", minSpark: "0.0.3" },
  ] };
  expect(selectPatch(library, "1.0.0", "0.0.4")?.minSpark).toBe("0.0.4");
  expect(selectPatch(library, "1.0.1", "0.0.4")).toBeUndefined();
  expect(compareVersions("1.0.0-next.10", "1.0.0-next.2")).toBeGreaterThan(0);
  expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0);
  expect(compareVersions("1.0.0-alpha-beta.1", "1.0.0-alpha-beta.2")).toBeLessThan(0);
});

test("fetches main once, pins all downloads to its SHA, and reuses a complete SHA cache", async () => {
  const f = fixture(), network = fetcher(f.registry);
  expect((await fetchRegistry(f.root, { fetcher: network, cache: f.cache }))?.sha).toBe(sha);
  expect(patchSourceSHA(f.root)).toBe(sha);
  expect(vi.mocked(network).mock.calls.slice(1).every(([url]) => String(url).includes(`/${sha}/patches/`))).toBe(true);
  const second = fixture();
  const cached = vi.fn(async (url: string) => { if (!url.endsWith("/commits/main")) throw new Error("must use cache"); return new Response(JSON.stringify({ sha })); }) as unknown as typeof fetch;
  expect((await fetchRegistry(second.root, { fetcher: cached, cache: f.cache }))?.sha).toBe(sha);
  expect(cached).toHaveBeenCalledTimes(1);
});

test("offline and failed patch downloads fall back as a whole with a one-line notice", async () => {
  for (const failedPatch of [false, true]) {
    const f = fixture(), notice = vi.fn();
    const network = failedPatch ? vi.fn(async (url: string) => {
      if (url.endsWith(".patch")) throw new Error("download interrupted");
      return new Response(url.endsWith("/commits/main") ? JSON.stringify({ sha }) : JSON.stringify(f.registry));
    }) as unknown as typeof fetch : offline;
    expect((await fetchRegistry(f.root, { fetcher: network, cache: f.cache, notice }))?.sha).toBe("bundled");
    expect(notice).toHaveBeenCalledTimes(1);
    expect(notice.mock.calls[0][0]).toContain("using bundled patches");
    expect(existsSync(f.cache)).toBe(false);
  }
});

test("reachable malformed registries and modified patches reject instead of falling back", async () => {
  const bad = fixture();
  await expect(fetchRegistry(bad.root, { fetcher: fetcher({ schema: 8 }), cache: bad.cache })).rejects.toThrow("Malformed");
  const tampered = fixture();
  await expect(fetchRegistry(tampered.root, { fetcher: fetcher(tampered.registry, "bad bytes"), cache: tampered.cache })).rejects.toThrow("hash mismatch");
  expect(existsSync(tampered.cache)).toBe(false);
});

test("read-only doctor findings use the same version policy without writing a cache or manifests", async () => {
  const f = fixture("8.0.0"), before = readFileSync(path.join(f.root, "package.json"));
  const source = await fetchRegistry(f.root, { fetcher: fetcher(f.registry), cache: f.cache, writeCache: false });
  const issues = registryFindings(f.root, source);
  expect(issues).toMatchObject([{ name: "example-lib", versions: ["2.0.0", "1.0.0"], fix: "npm install --exact example-lib@2.0.0" }]);
  expect(readFileSync(path.join(f.root, "package.json"))).toEqual(before);
  expect(existsSync(f.cache)).toBe(false);
  expect(readFileSync(path.join(f.library, "file.txt"), "utf8")).toBe("upstream\n");
});

test("non-TTY stops with an exact repair command before applying any patch", async () => {
  const f = fixture("8.0.0"), ask = vi.fn();
  await expect(ensurePatchRegistry(f.root, { fetcher: offline, notice: vi.fn(), tty: false, ask })).rejects.toThrow("npm install --exact example-lib@2.0.0");
  expect(ask).not.toHaveBeenCalled();
  expect(() => prepareNativePatches(f.root)).toThrow("npm install --exact example-lib@2.0.0");
  expect(readFileSync(path.join(f.library, "file.txt"), "utf8")).toBe("upstream\n");
});

test("TTY accepts newest compatible default, reinstalls, rechecks and prepares the selected patch", async () => {
  const f = fixture("8.0.0"), ask = vi.fn(async (_message: string) => "");
  const install = vi.fn(async () => { json(path.join(f.library, "package.json"), { name: "example-lib", version: "2.0.0" }); });
  await ensurePatchRegistry(f.root, { fetcher: offline, notice: vi.fn(), tty: true, ask, install });
  expect(ask.mock.calls[0]?.[0]).toContain("[2.0.0]");
  expect(install).toHaveBeenCalledWith(f.root, "npm");
  expect(JSON.parse(readFileSync(path.join(f.root, "package.json"), "utf8")).dependencies["example-lib"]).toBe("2.0.0");
  prepareNativePatches(f.root);
  expect(readFileSync(path.join(f.library, "file.txt"), "utf8")).toBe("patched\n");
  const receipt = readFileSync(path.join(f.library, "package.json"), "utf8");
  prepareNativePatches(f.root);
  expect(readFileSync(path.join(f.library, "package.json"), "utf8")).toBe(receipt);
});

test("declines, invalid selections and ineffective installs cannot proceed unpatched", async () => {
  for (const answer of ["n", "99.0.0", ""]) {
    const f = fixture("8.0.0");
    await expect(ensurePatchRegistry(f.root, { fetcher: offline, notice: vi.fn(), tty: true, ask: async () => answer, install: vi.fn() })).rejects.toThrow();
    expect(readFileSync(path.join(f.library, "file.txt"), "utf8")).toBe("upstream\n");
  }
});

test("a newer minSpark offers upgrade and decline retains the newest compatible revision", async () => {
  const f = fixture();
  f.registry.libraries["example-lib"]!.versions.push({ version: "1.0.0", minSpark: "0.0.5", patch: "example-lib@1.0.0-new.patch", sha256: hash(patch) });
  json(path.join(f.spark, "patches/registry.json"), f.registry);
  writeFileSync(path.join(f.spark, "patches/example-lib@1.0.0-new.patch"), patch);
  const ask = vi.fn(async (_message: string) => "n");
  await ensurePatchRegistry(f.root, { fetcher: offline, notice: vi.fn(), tty: true, ask });
  await ensurePatchRegistry(f.root, { fetcher: offline, notice: vi.fn(), tty: true, ask });
  expect(ask).toHaveBeenCalledTimes(1);
  expect(ask.mock.calls[0]?.[0]).toContain("spark upgrade");
  prepareNativePatches(f.root);
  expect(readFileSync(path.join(f.library, "file.txt"), "utf8")).toBe("patched\n");
});

test("shared node_modules repairs at the root once across app roots and honors root opt-out", async () => {
  const f = fixture("8.0.0"), apps = ["one", "two"].map(name => path.join(f.root, "apps", name));
  for (const app of apps) json(path.join(app, "package.json"), { name: path.basename(app), dependencies: { "@legendapp/spark": "0.0.4", "example-lib": "8.0.0" } });
  const ask = vi.fn(async (_message: string) => ""), install = vi.fn(async () => json(path.join(f.library, "package.json"), { name: "example-lib", version: "2.0.0" }));
  for (const app of apps) await ensurePatchRegistry(app, { fetcher: offline, notice: vi.fn(), tty: true, ask, install });
  expect(ask).toHaveBeenCalledTimes(1);
  expect(install).toHaveBeenCalledWith(f.root, "npm");
  json(path.join(f.library, "package.json"), { name: "example-lib", version: "8.0.0" });
  const pkg = JSON.parse(readFileSync(path.join(f.root, "package.json"), "utf8")); pkg.spark = { patches: { "example-lib": false } }; json(path.join(f.root, "package.json"), pkg);
  expect(() => assertRegistryVersions(apps[0]!)).not.toThrow();
  expect(() => prepareNativePatches(apps[0]!)).not.toThrow();
});

test("opt-out skips mismatched patched and redirected libraries and rejects unknown names", () => {
  const f = fixture("8.0.0");
  const pkg = JSON.parse(readFileSync(path.join(f.root, "package.json"), "utf8")); pkg.spark = { patches: { "example-lib": false } }; json(path.join(f.root, "package.json"), pkg);
  expect(registryFindings(f.root)).toEqual([]);
  prepareNativePatches(f.root);
  expect(readFileSync(path.join(f.library, "file.txt"), "utf8")).toBe("upstream\n");
  pkg.spark.patches.unknown = false; json(path.join(f.root, "package.json"), pkg);
  expect(() => registryFindings(f.root)).toThrow("Unknown");
});

test("the registry keeps the approved existing Expo integrations without expanding ownership", () => {
  const registry = JSON.parse(readFileSync(path.join(repository, "patches/registry.json"), "utf8"));
  expect(Object.keys(registry.libraries).filter(name => /^(expo-|@expo\/)/.test(name)).sort()).toEqual([
    "expo-application", "expo-audio", "expo-blur", "expo-clipboard", "expo-device", "expo-document-picker", "expo-font", "expo-glass-effect", "expo-haptics", "expo-image", "expo-image-manipulator", "expo-image-picker", "expo-keep-awake", "expo-localization", "expo-location", "expo-symbols", "expo-system-ui", "expo-web-browser",
  ]);
});

test("fetched patch selection survives a native child process through its pinned source", async () => {
  const f = fixture();
  await ensurePatchRegistry(f.root, { fetcher: fetcher(f.registry), cache: f.cache, tty: false });
  const child = await import("node:child_process");
  const module = path.join(repository, "packages/config-plugin/patch-registry.cjs");
  const result = child.spawnSync(process.execPath, ["-e", `const r=require(${JSON.stringify(module)}); process.stdout.write(r.patchSourceSHA(${JSON.stringify(f.root)}));`], { encoding: "utf8", env: process.env });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe(sha);
});

test("new recipes replace the previous Spark layer", async () => {
  const f = fixture();
  prepareNativePatches(f.root);
  const next = patch.replace("+patched", "+new recipe");
  f.registry.libraries["example-lib"]!.versions.push({ version: "1.0.0", minSpark: "0.0.5", patch: "example-lib@1.0.0-new.patch", sha256: hash(next), optional: true });
  const sdk = JSON.parse(readFileSync(path.join(f.spark, "package.json"), "utf8")); sdk.version = "0.0.5"; json(path.join(f.spark, "package.json"), sdk);
  json(path.join(f.spark, "patches/registry.json"), f.registry);
  writeFileSync(path.join(f.spark, "patches/example-lib@1.0.0-new.patch"), next);
  await ensurePatchRegistry(f.root, { fetcher: offline, notice: vi.fn(), tty: false });
  prepareNativePatches(f.root);
  expect(readFileSync(path.join(f.library, "file.txt"), "utf8")).toBe("new recipe\n");
});

test("doctor CLI reports registry fixes and tool errors without any filesystem writes", async () => {
  const f = fixture("8.0.0");
  json(path.join(f.root, "desktop.config.json"), { name: "Fixture", version: "1.0.0", projectId: "test.fixture" });
  const preload = path.join(f.root, "offline.cjs"); writeFileSync(preload, 'globalThis.fetch = async () => { throw new Error("offline fixture"); };\n');
  const { spawnSync } = await import("node:child_process");
  const child = spawnSync(which("node")!, [path.join(repository, "packages/cli/dist/index.js"), "doctor", "--project", f.root], {
    cwd: f.root, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: `--require=${preload}`, PATH: "", SPARK_HOME: path.join(f.root, "home") },
  });
  expect(child.status, child.stdout + child.stderr).toBe(1);
  expect(child.stderr).toContain("npm install --exact example-lib@2.0.0");
  expect(child.stderr).toContain("Fix:");
  expect(existsSync(path.join(f.root, ".spark"))).toBe(false);
  expect(existsSync(path.join(f.root, "home"))).toBe(false);
});

test("version errors retain their install command in the public CLI error presentation", async () => {
  const { errorPresentation } = await import("../packages/cli/src/errors.ts");
  const f = fixture("8.0.0");
  try { assertRegistryVersions(f.root); throw new Error("expected version check to stop"); }
  catch (error) { expect(errorPresentation(error).summary).toContain("npm install --exact example-lib@2.0.0"); }
});

test("multiple mismatches at one root are pinned before a single reinstall", async () => {
  const f = fixture("8.0.0");
  f.registry.libraries["second-lib"] = { kind: "redirect", versions: [{ version: "3.0.0", minSpark: "0.0.4" }] };
  json(path.join(f.spark, "patches/registry.json"), f.registry);
  const file = path.join(f.root, "package.json"), pkg = JSON.parse(readFileSync(file, "utf8")); pkg.dependencies["second-lib"] = "9.0.0"; json(file, pkg);
  const second = path.join(f.root, "node_modules/second-lib/package.json"); json(second, { name: "second-lib", version: "9.0.0" });
  const install = vi.fn(async () => {
    const pinned = JSON.parse(readFileSync(file, "utf8"));
    expect(pinned.dependencies).toMatchObject({ "example-lib": "2.0.0", "second-lib": "3.0.0" });
    json(path.join(f.library, "package.json"), { name: "example-lib", version: "2.0.0" }); json(second, { name: "second-lib", version: "3.0.0" });
  });
  await ensurePatchRegistry(f.root, { fetcher: offline, notice: vi.fn(), tty: true, ask: async () => "", install });
  expect(install).toHaveBeenCalledTimes(1);
});

test("shared-root opt-out also skips required patch version checks in native preparation", () => {
  const f = fixture("8.0.0");
  json(path.join(f.spark, "patches/dependencies.json"), { "example-lib": { version: "1.0.0", patch: "example-lib@1.0.0.patch" } });
  const file = path.join(f.root, "package.json"), pkg = JSON.parse(readFileSync(file, "utf8")); pkg.spark = { patches: { "example-lib": false } }; json(file, pkg);
  const app = path.join(f.root, "apps/one"); json(path.join(app, "package.json"), { name: "one", dependencies: { "@legendapp/spark": "0.0.4", "example-lib": "8.0.0" } });
  expect(() => prepareNativePatches(app)).not.toThrow();
});

test("an existing app's install hook checks versions even after its template was initialized", async () => {
  const f = fixture("8.0.0");
  json(path.join(f.root, "desktop.config.json"), { name: "Fixture", projectId: "already.initialized" });
  const preload = path.join(f.root, "offline.cjs"); writeFileSync(preload, 'globalThis.fetch = async () => { throw new Error("offline fixture"); };\n');
  const { spawnSync } = await import("node:child_process");
  const child = spawnSync(which("node")!, [path.join(repository, "packages/desktop/init-template.cjs")], {
    cwd: f.root, encoding: "utf8", env: { ...process.env, CI: "1", NODE_OPTIONS: `--require=${preload}`, SPARK_HOME: path.join(f.root, "home") },
  });
  expect(child.status, child.stdout + child.stderr).toBe(1);
  expect(child.stderr).toContain("npm install --exact example-lib@2.0.0");
  expect(readFileSync(path.join(f.library, "file.txt"), "utf8")).toBe("upstream\n");
});
