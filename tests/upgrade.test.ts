import { parse } from "yaml";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { upgrade } from "../packages/cli/src/upgrade.ts";
import { writeJson } from "../packages/cli/src/json.ts";
import { packageManager } from "../packages/cli/src/package-manager.ts";
import { run } from "../packages/cli/src/commands.ts";

vi.mock("../packages/cli/src/commands.ts", () => ({ run: vi.fn() }));
vi.mock("../packages/cli/src/package-manager.ts", async original => ({ ...await original<object>(), packageManager: vi.fn() }));

const pacote: { manifest(spec: string, options: object): Promise<any>; extract(spec: string, destination: string, options: object): Promise<void> } = createRequire(createRequire(import.meta.url).resolve("npm/package.json"))("pacote");
const framework = path.resolve(import.meta.dirname, "..");
const bytes = Buffer.from("verified patched package");
let root: string;
let target: string;
let current: string;
let next: string;
const read = (file: string) => JSON.parse(readFileSync(path.join(root, file), "utf8"));

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "spark-upgrade-test-"));
  current = "0.0.1-next.3";
  next = "0.0.1-next.5";
  writeJson(path.join(root, "package.json"), {
    name: "consumer", scripts: { dev: "spark dev" }, dependencies: { "@legendapp/spark": current, react: "^19.2.0", "react-native": "0.81.6", expo: "54.0.37" },
    overrides: { "@legendapp/spark": current, react: "$react", "@expo/cli": "old", "@react-native-runtimes/core": "file:./spark-packages/old.tgz" }, custom: true,
  });
  writeJson(path.join(root, "desktop.config.json"), { projectId: "upgrade-test", platforms: ["macos"] });
  writeJson(path.join(root, "node_modules/@legendapp/spark/package.json"), { version: current });
  mkdirSync(path.join(root, ".spark"));
  writeFileSync(path.join(root, ".spark/version"), current + "\n");
  writeFileSync(path.join(root, "AGENTS.md"), "Team instructions\n");
  vi.mocked(packageManager).mockReturnValue("npm");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(pacote, "manifest").mockImplementation(async () => ({ version: next, dist: { integrity: "sha512-fixture" } }));
  vi.spyOn(pacote, "extract").mockImplementation(async (_spec: string, destination: string) => {
    target = destination;
    writeJson(path.join(target, "package.json"), { version: next, spark: { bundledModuleRoot: "vendor" } });
    const cli = path.join(target, "vendor/node_modules/@legendapp/spark-cli");
    writeJson(path.join(cli, "package.json"), { name: "@legendapp/spark-cli", version: next, type: "module" });
    cpSync(path.join(framework, "packages/cli/dist"), path.join(cli, "dist"), { recursive: true });
    appendFileSync(path.join(cli, "dist/migrations.cjs"), `\nmodule.exports.migrations.push({ version: ${JSON.stringify(next)}, automatic: false, apply(context) {
      context.writeFile('.spark/target-migration', 'installed release');
      context.editJson('package.json', pkg => { pkg.scripts.check = 'tsc --noEmit'; });
      context.manualStep('Review the target-only native module change.');
    } });\n`);
    symlinkSync(path.join(framework, "node_modules"), path.join(cli, "node_modules"));
    const defaults = JSON.parse(readFileSync(path.join(framework, "packages/cli/templates/blank-typescript/package.json"), "utf8"));
    defaults.dependencies.react = "19.2.0";
    defaults.overrides.react = "19.2.0";
    defaults.overrides["@expo/cli"] = "54.0.99";
    defaults.overrides.dompurify = "3.4.19";
    for (const template of ["blank-typescript", "windows", "universal"]) writeJson(path.join(cli, "templates", template, "package.json"), defaults);
    writeJson(path.join(cli, "dist/release.json"), { schema: 1, version: next, revision: "a".repeat(40), runners: {}, packages: {
      "@react-native-runtimes/core": { url: `https://github.com/LegendApp/legend-spark/releases/download/v${next}/core.tgz`, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") },
    } });
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes)));
  vi.mocked(run).mockImplementation(async () => {
    // The install sees target pins, verified archives and migrated scripts.
    expect(read("package.json").dependencies["@legendapp/spark"]).toBe(next);
    expect(read("package.json").dependencies.react).toBe("19.2.0");
    expect(read("package.json").overrides["@expo/cli"]).toBe("54.0.99");
    expect(read("package.json").scripts.check).toBe("tsc --noEmit");
    const archive = read("package.json").overrides["@react-native-runtimes/core"].slice("file:./".length);
    expect(readFileSync(path.join(root, archive))).toEqual(bytes);
    expect(readFileSync(path.join(root, ".spark/version"), "utf8")).toBe(current + "\n");
    cpSync(target, path.join(root, "node_modules/@legendapp/spark"), { recursive: true });
    return "";
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); rmSync(root, { recursive: true, force: true }); });

test.each(["npm", "pnpm", "yarn", "bun"] as const)("upgrade migrates install inputs and finalizes after %s succeeds", async manager => {
  vi.mocked(packageManager).mockReturnValue(manager);
  await upgrade(root);
  expect(pacote.manifest).toHaveBeenCalledWith("@legendapp/spark@next", expect.any(Object));
  expect(pacote.extract).toHaveBeenCalledWith(`@legendapp/spark@${next}`, expect.any(String), expect.objectContaining({ integrity: "sha512-fixture" }));
  expect(run).toHaveBeenCalledExactlyOnceWith(root, [manager, "install"]);
  expect(read("package.json").overrides.react).toBe("$react");
  expect(read("package.json").overrides["@legendapp/spark"]).toBe(next);
  expect(read("package.json").custom).toBe(true);
  expect(readFileSync(path.join(root, "AGENTS.md"), "utf8")).toMatch(/^Team instructions\n/);
  expect(readFileSync(path.join(root, "CLAUDE.md"), "utf8")).toContain("node_modules/@legendapp/spark/skills/spark/SKILL.md");
  expect(readFileSync(path.join(root, ".spark/version"), "utf8")).toBe(next + "\n");
  expect(readFileSync(path.join(root, ".spark/target-migration"), "utf8")).toBe("installed release");
  expect(readFileSync(path.join(root, ".spark/upgrade-notes.md"), "utf8")).toContain(`../node_modules/@legendapp/spark/skills/spark/UPGRADING.md#${next.replaceAll('.', '')}`);
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Review the target-only native module change."));
  const pkg = read("package.json");
  const overrides = manager === "pnpm" ? parse(readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8")).overrides : manager === "yarn" ? pkg.resolutions : pkg.overrides;
  expect(overrides["@react-native-runtimes/core"]).toMatch(/^file:\.\/spark-packages\//);
  expect(overrides["@expo/cli"]).toBe("54.0.99");
});

test("dry-run previews target pins and leaves app files, install and migrations untouched", async () => {
  const before = readFileSync(path.join(root, "package.json"));
  await upgrade(root, true);
  expect(readFileSync(path.join(root, "package.json"))).toEqual(before);
  expect(readFileSync(path.join(root, "AGENTS.md"), "utf8")).toBe("Team instructions\n");
  expect(readFileSync(path.join(root, ".spark/version"), "utf8")).toBe(current + "\n");
  expect(existsSync(path.join(root, "CLAUDE.md"))).toBe(false);
  expect(existsSync(path.join(root, "spark-packages"))).toBe(false);
  expect(run).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining("19.2.0"));
  expect(console.log).toHaveBeenCalledWith("  Create .spark/target-migration");
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Manual step"));
  expect(existsSync(path.join(root, ".spark/upgrade-notes.md"))).toBe(false);
});

test("a downloaded release without its own node_modules plans migrations with dependencies from the app's installed Spark", async () => {
  const extract = vi.mocked(pacote.extract).getMockImplementation()!;
  vi.mocked(pacote.extract).mockImplementation(async (spec, destination, options) => {
    await extract(spec, destination, options);
    const cli = path.join(destination, "vendor/node_modules/@legendapp/spark-cli");
    rmSync(path.join(cli, "node_modules"));
    appendFileSync(path.join(cli, "dist/migrations.cjs"), `\nmodule.exports.migrations.push({ version: ${JSON.stringify(next)}, automatic: false, apply(context) {
      context.replaceImport('old-module', 'new-module');
    } });\n`);
  });
  for (const dependency of ["typescript", "npm"]) symlinkSync(path.join(framework, "node_modules", dependency), path.join(root, "node_modules", dependency));
  writeFileSync(path.join(root, "App.tsx"), "import { api } from 'old-module';\n");
  await upgrade(root, true);
  expect(console.log).toHaveBeenCalledWith("  Edit App.tsx");
  expect(console.log).toHaveBeenCalledWith("No app files changed.");
});

test("stable installs stay on latest", async () => {
  current = "1.0.0";
  next = "1.1.0";
  writeJson(path.join(root, "node_modules/@legendapp/spark/package.json"), { version: current });
  await upgrade(root, true);
  expect(pacote.manifest).toHaveBeenCalledWith("@legendapp/spark@latest", expect.any(Object));
});

test("upgrade uses the recorded old version and runs every intermediate migration", async () => {
  writeFileSync(path.join(root, ".spark/version"), "0.0.1-next.2\n");
  writeJson(path.join(root, "desktop.config.json"), { projectId: "upgrade-test", platforms: ["macos"], window: { width: 1000, height: 700, restoreFrame: true } });
  writeFileSync(path.join(root, "source.ts"), `import { showMessageDialog } from '@legendapp/spark/message-dialog';\n`);
  const before = readFileSync(path.join(root, "desktop.config.json"));
  await upgrade(root, true);
  expect(console.log).toHaveBeenCalledWith("Migrations: 0.0.1-next.3 → 0.0.1-next.4 → 0.0.1-next.5");
  expect(readFileSync(path.join(root, "desktop.config.json"))).toEqual(before);
  expect(existsSync(path.join(root, ".spark/upgrade-notes.md"))).toBe(false);
  const install = vi.mocked(run).getMockImplementation()!;
  // The install fixture asserts the receipt still holds the recorded old version.
  current = "0.0.1-next.2";
  vi.mocked(run).mockImplementation(install);
  await upgrade(root);
  expect(read("desktop.config.json").window).toEqual({ size: { width: 1000, height: 700 }, restoreBounds: true });
  expect(readFileSync(path.join(root, "source.ts"), "utf8")).toContain("@legendapp/spark/dialogs");
  const notes = readFileSync(path.join(root, ".spark/upgrade-notes.md"), "utf8");
  for (const version of ["0.0.1-next.3", "0.0.1-next.4", "0.0.1-next.5"]) expect(notes).toContain(`[${version}]`);
  expect(readFileSync(path.join(root, ".spark/version"), "utf8")).toBe(next + "\n");
});

test("registry and archive failures do not change the app", async () => {
  const before = readFileSync(path.join(root, "package.json"));
  vi.mocked(pacote.manifest).mockRejectedValueOnce(new Error("registry unavailable"));
  await expect(upgrade(root)).rejects.toThrow("registry unavailable");
  vi.mocked(pacote.extract).mockRejectedValueOnce(new Error("integrity mismatch"));
  await expect(upgrade(root)).rejects.toThrow("integrity mismatch");
  expect(readFileSync(path.join(root, "package.json"))).toEqual(before);
  expect(run).not.toHaveBeenCalled();
});

test("install failure keeps the previous migration stamp and is retryable", async () => {
  const install = vi.mocked(run).getMockImplementation()!;
  vi.mocked(run).mockRejectedValueOnce(new Error("install failed"));
  await expect(upgrade(root)).rejects.toThrow("install failed");
  expect(read("package.json").dependencies["@legendapp/spark"]).toBe(next);
  expect(readFileSync(path.join(root, ".spark/version"), "utf8")).toBe(current + "\n");
  expect(existsSync(path.join(root, "CLAUDE.md"))).toBe(true);
  vi.mocked(run).mockImplementation(install);
  await upgrade(root);
  expect(readFileSync(path.join(root, ".spark/version"), "utf8")).toBe(next + "\n");
});

test("an install that retains the old Spark does not advance migrations", async () => {
  vi.mocked(run).mockResolvedValueOnce("");
  await expect(upgrade(root)).rejects.toThrow("Installation did not select");
  expect(readFileSync(path.join(root, ".spark/version"), "utf8")).toBe(current + "\n");
});

test("new release overrides are added and preserve other pnpm configuration", async () => {
  vi.mocked(packageManager).mockReturnValue("pnpm");
  const pkg = read("package.json");
  pkg.pnpm = { onlyBuiltDependencies: ["custom-native"], overrides: { custom: "2.0.0" } };
  delete pkg.overrides["@react-native-runtimes/core"];
  writeJson(path.join(root, "package.json"), pkg);
  const install = vi.mocked(run).getMockImplementation()!;
  vi.mocked(run).mockImplementation(async (...args) => {
    const after = read("package.json");
    expect(after.pnpm.onlyBuiltDependencies).toEqual(["custom-native"]);
    expect(after.pnpm).not.toHaveProperty("overrides");
    const overrides = parse(readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8")).overrides;
    expect(overrides.custom).toBe("2.0.0");
    expect(overrides["@react-native-runtimes/core"]).toMatch(/^file:\.\/spark-packages\//);
    // Verify the same archive through the manager's actual override location.
    expect(readFileSync(path.join(root, overrides["@react-native-runtimes/core"].slice("file:./".length)))).toEqual(bytes);
    cpSync(target, path.join(root, "node_modules/@legendapp/spark"), { recursive: true });
    return "";
  });
  await upgrade(root);
  vi.mocked(run).mockImplementation(install);
});

test("upgrade refreshes managed pointers even when this version was already applied", async () => {
  await upgrade(root);
  current = next;
  writeFileSync(path.join(root, "AGENTS.md"), "Before\n<!-- spark:skill:start -->\nstale\n<!-- spark:skill:end -->\nAfter\n");
  await upgrade(root);
  const text = readFileSync(path.join(root, "AGENTS.md"), "utf8");
  expect(text.startsWith("Before\n")).toBe(true);
  expect(text.endsWith("\nAfter\n")).toBe(true);
  expect(text).not.toContain("stale");
  expect(text).toContain("node_modules/@legendapp/spark/skills/spark/SKILL.md");
});

test("workspace-managed Spark stops before the registry or any writes", async () => {
  const pkg = read("package.json");
  pkg.dependencies["@legendapp/spark"] = "workspace:*";
  writeJson(path.join(root, "package.json"), pkg);
  await expect(upgrade(root)).rejects.toThrow("owning manifest");
  expect(pacote.manifest).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test.each(["0.0.1-next.2", "1.0.0", "invalid"])("next rejects an invalid or older registry tag: %s", async version => {
  next = version;
  const before = readFileSync(path.join(root, "package.json"));
  await expect(upgrade(root)).rejects.toThrow("compatible Spark update");
  expect(readFileSync(path.join(root, "package.json"))).toEqual(before);
  expect(pacote.extract).not.toHaveBeenCalled();
});


test("upgrade previews the target release's newer web policy without changing the app", async () => {
  for (const [name, version, dependencies] of [
    ["react", "19.1.4", {}], ["react-native-enriched-html", "1.1.1", { dompurify: "3.4.17" }], ["dompurify", "3.4.17", {}],
  ] as const) writeJson(path.join(root, "node_modules", name, "package.json"), { name, version, dependencies });
  const before = readFileSync(path.join(root, "package.json"));
  await upgrade(root, true);
  expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/dompurify.*3\.4\.17.*3\.4\.19/));
  expect(readFileSync(path.join(root, "package.json"))).toEqual(before);
  expect(run).not.toHaveBeenCalled();
});

test("upgrade installs the target web policy and retains a newer pnpm YAML pin", async () => {
  vi.mocked(packageManager).mockReturnValue("pnpm");
  for (const [name, version, dependencies] of [
    ["react", "19.1.4", {}], ["react-native-enriched-html", "1.1.1", { dompurify: "3.4.17" }], ["dompurify", "3.4.17", {}],
  ] as const) writeJson(path.join(root, "node_modules", name, "package.json"), { name, version, dependencies });
  const pkg = read("package.json"); pkg.pnpm = { overrides: { dompurify: "3.4.17" } }; writeJson(path.join(root, "package.json"), pkg);
  writeFileSync(path.join(root, "pnpm-workspace.yaml"), "overrides:\n  dompurify: 3.4.20\n");
  const install = vi.mocked(run).getMockImplementation()!;
  vi.mocked(run).mockImplementation(async (...args) => {
    expect(read("package.json").pnpm.overrides.dompurify).toBe("3.4.20");
    expect(readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8")).toContain("dompurify: 3.4.20");
    await install(...args);
    writeJson(path.join(root, "node_modules/dompurify/package.json"), { name: "dompurify", version: "3.4.20" });
    return "";
  });
  await upgrade(root);
  expect(run).toHaveBeenCalledExactlyOnceWith(root, ["pnpm", "install"]);
});
