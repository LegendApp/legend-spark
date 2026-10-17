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
vi.mock("../packages/cli/src/release.ts", () => ({ installedRelease: () => undefined, packageSources: () => ({ "@react-native-runtimes/core": "file:./core.tgz", "@legendapp/spark": "file:./spark.tgz" }) }));
const version = JSON.parse(readFileSync("packages/cli/package.json", "utf8")).version;
const roots: string[] = [];
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test.each(["macos", "windows", "universal"])("create launcher writes %s app pointers and initializes with scripts disabled", async variant => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "spark-create-output-"));
  roots.push(temporary);
  const root = path.join(temporary, "MyApp");
  const manifest = path.join(temporary, "packages.json");
  writeJson(manifest, {});
  vi.stubEnv("SPARK_PLATFORM", undefined);
  let template: string;
  vi.mocked(packArchive).mockImplementation(async source => {
    template = source;
    expect(JSON.parse(readFileSync(path.join(source, "package.json"), "utf8")).allowScripts["file:./spark.tgz"]).toBe(true);
  });
  vi.mocked(spawnProcess).mockImplementation(() => {
    cpSync(template, root, { recursive: true });
    // Emulate Expo Desktop's identity assignment and successful install, with
    // no postinstall. Team-authored files remain after upstream creation.
    writeJson(path.join(root, "app.json"), { expo: { name: "MyApp", platforms: ["macos", "windows"], macos: { bundleIdentifier: "org.example.myapp" }, windows: { projectGuid: "generated-guid" } } });
    writeJson(path.join(root, "node_modules/@legendapp/spark/package.json"), { version });
    writeFileSync(path.join(root, "AGENTS.md"), "Keep team rules.\n");
    writeFileSync(path.join(root, "CLAUDE.md"), "Keep Claude rules.\n");
    return { exited: Promise.resolve(0) } as ReturnType<typeof spawnProcess>;
  });
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await createSpark([root, "--packages", manifest, "--package-manager", "npm", "--platform", variant === "windows" ? "windows" : "macos", ...(variant === "universal" ? ["--universal"] : [])]);
    expect(readFileSync(path.join(root, "AGENTS.md"), "utf8")).toBe(`Keep team rules.\n\n${pointer}\n`);
    expect(readFileSync(path.join(root, "CLAUDE.md"), "utf8")).toBe(`Keep Claude rules.\n\n${pointer}\n`);
    expect(readFileSync(path.join(root, ".claude/skills/spark/SKILL.md"), "utf8")).toBe(claudePointer);
    expect(readFileSync(path.join(root, ".spark/version"), "utf8")).toBe(version + "\n");
    expect(JSON.parse(readFileSync(path.join(root, "desktop.config.json"), "utf8")).projectId).toBe("generated-guid");
  } finally { log.mockRestore(); }
});
