import { parse } from "yaml";
import { afterEach, expect, test, vi } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createSpark } from "../packages/create-spark/src/create.ts";
import { writeJson } from "../packages/cli/src/json.ts";
import { spawnProcess } from "../packages/cli/src/process.ts";
import { packArchive } from "../packages/cli/src/pack-archive.ts";
import { pointer, claudePointer } from "../packages/cli/src/migrations.cjs";
import { run } from "../packages/cli/src/commands.ts";
import { pnpWriteFile } from "../packages/cli/src/create.ts";
import { packageSources } from "../packages/cli/src/release.ts";
import { spawnSync } from "node:child_process";

vi.mock("../packages/cli/src/expo-node.ts", () => ({ checkExpoDesktopNode: vi.fn() }));
vi.mock("../packages/cli/src/executable.ts", () => ({ which: vi.fn((command: string) => command) }));
vi.mock("../packages/cli/src/process.ts", () => ({ nodeCommand: (_root: string, _name: string, _bin: string, args: string[] = []) => ["node", "expo-desktop", ...args], spawnProcess: vi.fn() }));
vi.mock("../packages/cli/src/commands.ts", async importOriginal => ({ ...await importOriginal<object>(), run: vi.fn() }));
vi.mock("../packages/cli/src/pack-archive.ts", () => ({ packArchive: vi.fn() }));
vi.mock("../packages/cli/src/release.ts", () => ({ installedRelease: () => undefined, packageSources: vi.fn((manifest: string) => ({ "@react-native-runtimes/core": "file:" + manifest.replace(/packages\.json$/, "core.tgz"), "@legendapp/spark": "file:" + manifest.replace(/packages\.json$/, "spark.tgz") })) }));
const version = JSON.parse(readFileSync("packages/cli/package.json", "utf8")).version;
const roots: string[] = [];
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test.each([["macos", "npm"], ["windows", "npm"], ["universal", "npm"], ["macos", "pnpm"]])("create launcher writes %s app pointers with %s and initializes with scripts disabled", async (variant, manager) => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "spark-create-output-"));
  roots.push(temporary);
  const root = path.join(temporary, "MyApp");
  const manifest = path.join(temporary, "packages.json");
  writeJson(manifest, {});
  vi.stubEnv("SPARK_PLATFORM", undefined);
  let template: string;
  vi.mocked(packArchive).mockImplementation(async source => {
    template = source;
    expect(JSON.parse(readFileSync(path.join(source, "package.json"), "utf8")).allowScripts["file:" + path.join(temporary, "spark.tgz")]).toBe(true);
  });
  vi.mocked(spawnProcess).mockImplementation((_argv, options) => {
    cpSync(template, root, { recursive: true });
    // npm pack always excludes .npmrc, even when it is present in the template.
    rmSync(path.join(root, ".npmrc"), { force: true });
    // Emulate Expo Desktop's identity assignment and successful install, with
    // no postinstall. Team-authored files remain after upstream creation.
    writeJson(path.join(root, "app.json"), { expo: { name: "MyApp", platforms: ["macos", "windows"], macos: { bundleIdentifier: "org.example.myapp" }, windows: { projectGuid: "generated-guid" } } });
    writeJson(path.join(root, "node_modules/@legendapp/spark/package.json"), { version });
    writeFileSync(path.join(root, "AGENTS.md"), "Keep team rules.\n");
    writeFileSync(path.join(root, "CLAUDE.md"), "Keep Claude rules.\n");
    const stdout = new ReadableStream<Uint8Array>({ start(controller) {
      for (const text of ["Installing dependencies\n", "\u001b[1m✅ Your project is ", "created!\u001b[22m\n\nBefore you can run desktop platforms, generate a development build\n- node --run prebuild\n"]) controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    } });
    return { exited: Promise.resolve(0), stdout } as ReturnType<typeof spawnProcess>;
  });
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    await createSpark([root, "--packages", manifest, "--package-manager", manager, "--platform", variant === "windows" ? "windows" : "macos", ...(variant === "universal" ? ["--universal"] : [])]);
    expect(output.mock.calls.map(([value]) => value).join("")).toBe("Installing dependencies\n");
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`${manager} run`));
    if (manager === "pnpm") {
      const yaml = readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
      expect(yaml).toContain("nodeLinker: hoisted");
      expect(yaml).toContain("@react-native-runtimes/core");
      expect(yaml).toContain("allowBuilds:");
      expect(parse(yaml).allowBuilds["@legendapp/spark@file:../spark.tgz"]).toBe(true);
    }
    expect(readFileSync(path.join(root, "AGENTS.md"), "utf8")).toBe(`Keep team rules.\n\n${pointer}\n`);
    expect(readFileSync(path.join(root, "CLAUDE.md"), "utf8")).toBe(`Keep Claude rules.\n\n${pointer}\n`);
    expect(readFileSync(path.join(root, ".claude/skills/spark/SKILL.md"), "utf8")).toBe(claudePointer);
    expect(readFileSync(path.join(root, ".spark/version"), "utf8")).toBe(version + "\n");
    expect(JSON.parse(readFileSync(path.join(root, "desktop.config.json"), "utf8")).projectId).toBe("generated-guid");
  } finally { log.mockRestore(); output.mockRestore(); }
});

test("create from a published release does not allow the Spark version as a package name", async () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "spark-create-release-"));
  roots.push(temporary);
  const root = path.join(temporary, "MyApp");
  const manifest = path.join(temporary, "packages.json");
  writeJson(manifest, {});
  // A published release supplies archives as file: sources, but Spark itself as its registry version.
  vi.mocked(packageSources).mockReturnValueOnce({ "@react-native-runtimes/core": "file:./spark-packages/core.tgz", "@legendapp/spark": version });
  let template: string;
  let allowScripts: Record<string, boolean> = {};
  vi.mocked(packArchive).mockImplementation(async source => {
    template = source;
    allowScripts = JSON.parse(readFileSync(path.join(source, "package.json"), "utf8")).allowScripts;
  });
  vi.mocked(spawnProcess).mockImplementation(() => {
    cpSync(template, root, { recursive: true });
    writeJson(path.join(root, "app.json"), { expo: { name: "MyApp", macos: { bundleIdentifier: "org.example.myapp" }, windows: { projectGuid: "generated-guid" } } });
    writeJson(path.join(root, "node_modules/@legendapp/spark/package.json"), { version });
    return { exited: Promise.resolve(0), stdout: new ReadableStream({ start(controller) { controller.close(); } }) } as ReturnType<typeof spawnProcess>;
  });
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await createSpark([root, "--packages", manifest, "--package-manager", "npm", "--platform", "macos"]);
  } finally { log.mockRestore(); }
  const templateAllowScripts = JSON.parse(readFileSync("packages/cli/templates/blank-typescript/package.json", "utf8")).allowScripts;
  expect(Object.keys(allowScripts).sort()).toEqual(Object.keys(templateAllowScripts).sort());
});

test.each(["--require /tmp/dlx/.pnp.cjs --experimental-loader file:///tmp/dlx/.pnp.loader.mjs --max-old-space-size=4096", undefined])("create under Yarn PnP keeps the PnP runtime out of the app install: %s", async nodeOptions => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "spark-create-pnp-"));
  roots.push(temporary);
  const root = path.join(temporary, "MyApp");
  const manifest = path.join(temporary, "packages.json");
  writeJson(manifest, {});
  vi.stubEnv("NODE_OPTIONS", nodeOptions);
  Object.defineProperty(process.versions, "pnp", { value: "3", configurable: true });
  let template: string;
  vi.mocked(packArchive).mockImplementation(async source => { template = source; });
  vi.mocked(spawnProcess).mockImplementation((argv, options) => {
    expect(argv).toContain("--no-install");
    if (nodeOptions) expect(options!.env!.NODE_OPTIONS).toContain(".pnp.cjs");
    expect(options!.env!.NODE_OPTIONS).toContain(pnpWriteFile);
    cpSync(template, root, { recursive: true });
    writeJson(path.join(root, "app.json"), { expo: { name: "MyApp", macos: { bundleIdentifier: "org.example.myapp" }, windows: { projectGuid: "generated-guid" } } });
    writeJson(path.join(root, "node_modules/@legendapp/spark/package.json"), { version });
    return { exited: Promise.resolve(0), stdout: new ReadableStream({ start(controller) { controller.close(); } }) } as ReturnType<typeof spawnProcess>;
  });
  vi.mocked(run).mockImplementation(async () => { expect(process.env.NODE_OPTIONS?.trim()).toBe(nodeOptions ? "--max-old-space-size=4096" : ""); return ""; });
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await createSpark([root, "--packages", manifest, "--package-manager", "yarn", "--platform", "macos"]);
    expect(run).toHaveBeenCalledWith(root, ["yarn", "install"]);
    expect(readFileSync(path.join(root, "yarn.lock"), "utf8")).toBe("");
  } finally { log.mockRestore(); delete (process.versions as Record<string, string>).pnp; }
  expect(JSON.parse(readFileSync("packages/create-spark/package.json", "utf8")).preferUnplugged).toBe(true);
});

test("PnP writeFile shim accepts the async iterables Node accepts", () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "spark-pnp-write-"));
  roots.push(temporary);
  // Yarn PnP routes fs.promises.writeFile through the callback API, which rejects iterables.
  const pnp = path.join(temporary, "pnp.cjs"), file = path.join(temporary, "out.txt");
  writeFileSync(pnp, "const fs = require('node:fs'); fs.promises.writeFile = require('node:util').promisify(fs.writeFile);\n");
  const result = spawnSync(process.execPath, ["-e", `(async () => { await require("node:fs").promises.writeFile(${JSON.stringify(file)}, (async function* () { yield Buffer.from("a"); yield Buffer.from("b"); })()); })()`],
    { env: { ...process.env, NODE_OPTIONS: `--require ${pnp} ${pnpWriteFile}` }, encoding: "utf8" });
  expect(result.stderr).toBe("");
  expect(readFileSync(file, "utf8")).toBe("ab");
});
