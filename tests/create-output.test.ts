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

vi.mock("../packages/cli/src/expo-node.ts", () => ({ checkExpoDesktopNode: vi.fn() }));
vi.mock("../packages/cli/src/process.ts", () => ({ nodeCommand: () => ["node", "expo-desktop"], spawnProcess: vi.fn() }));
vi.mock("../packages/cli/src/pack-archive.ts", () => ({ packArchive: vi.fn() }));
vi.mock("../packages/cli/src/release.ts", () => ({ installedRelease: () => undefined, packageSources: (manifest: string) => ({ "@react-native-runtimes/core": "file:" + manifest.replace(/packages\.json$/, "core.tgz"), "@legendapp/spark": "file:" + manifest.replace(/packages\.json$/, "spark.tgz") }) }));
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
