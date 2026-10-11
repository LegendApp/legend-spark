import { expect, test, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../scripts/prepare-runtimes.ts", () => ({ packRuntimes: async () => ({}) }));
vi.mock("../scripts/prepare-windows-libraries.ts", () => ({ packWindowsLibraries: async () => ({}) }));
vi.mock("../scripts/prepare-audio.ts", () => ({ packAudio: async () => ({}) }));
vi.mock("../scripts/pack-spark.ts", () => ({ packSpark: async () => "spark.tgz" }));
vi.mock("../scripts/pack-create-spark.ts", () => ({ packCreateSpark: async () => "create-spark.tgz" }));
vi.mock("../scripts/patch-inventory.ts", () => ({ patchedPackageNames: [] }));
vi.mock("../scripts/pack-templates.ts", () => ({ packTemplates: vi.fn(async () => {}) }));
vi.mock("../packages/cli/src/local.ts", () => ({ registerPackages: vi.fn() }));
vi.mock("../packages/cli/src/commands.ts", () => ({ run: vi.fn(async () => "") }));
vi.mock("../packages/cli/src/pack-archive.ts", () => ({ packArchive: async (_source: string, file: string) => writeFileSync(file, "fixture archive") }));
vi.mock("../packages/cli/src/executable.ts", () => ({ which: vi.fn((command: string) => command) }));

import { packLocal } from "../scripts/pack.ts";
import { packTemplates } from "../scripts/pack-templates.ts";
import { refreshLocalPackages } from "../packages/cli/src/create.ts";
import { packageSources } from "../packages/cli/src/release.ts";
import { registerPackages } from "../packages/cli/src/local.ts";

test("local pack returns the creator separately from every SDK manifest consumer", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-local-pack-"));
  try {
    for (const name of ["native-greeting", "sdk-test-driver"]) {
      const directory = path.join(root, "fixtures", name);
      mkdirSync(directory, { recursive: true });
      writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name: `@spark-fixtures/${name}`, version: "1.0.0" }));
    }
    const output = path.join(root, "packages");
    const { manifest, createNpm } = await packLocal(root, output);
    expect(createNpm).toBe("create-spark.tgz");
    expect(manifest).not.toHaveProperty("@legendapp/create-spark");
    const manifestPath = path.join(output, "manifest.json");
    expect(JSON.parse(readFileSync(manifestPath, "utf8"))).toEqual(manifest);
    expect(packTemplates).toHaveBeenCalledExactlyOnceWith(root, output, manifest);
    expect(registerPackages).toHaveBeenCalledExactlyOnceWith(manifestPath);
    writeFileSync(path.join(output, manifest["@legendapp/spark"]!), "SDK fixture");
    expect(packageSources(manifestPath)).not.toHaveProperty("@legendapp/create-spark");
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { "@legendapp/spark": "old" } }));
    await refreshLocalPackages(root, manifestPath, "npm");
    const app = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    expect(app.overrides).not.toHaveProperty("@legendapp/create-spark");
    expect(app.dependencies).not.toHaveProperty("@legendapp/create-spark");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
