import { expect, test, vi } from "vitest";
import { applyOverrides } from "../packages/cli/src/package-manager.ts";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { readConfig } from "@legendapp/spark/config";
import { prepareGoProfile } from "../packages/cli/src/go-profile.ts";
import { run } from "../packages/cli/src/commands.ts";
vi.mock("../packages/cli/src/commands.ts", () => ({ run: vi.fn() }));
const { initializeTemplate } = createRequire(import.meta.url)("../packages/cli/src/init-template.cjs");
const templates = path.resolve(import.meta.dirname, "../packages/cli/templates");
const { pointer, claudePointer } = createRequire(import.meta.url)("../packages/cli/src/migrations.cjs");
for (const folder of ["blank-typescript", "windows", "universal"]) {
  test(`${folder} pins optional backends without installing them`, () => {
    const pkg = JSON.parse(readFileSync(path.join(templates, folder, "package.json"), "utf8"));
    for (const name of ["react-native-enriched-markdown", "react-native-enriched-html", "react-native-webview", "@op-engineering/op-sqlite"]) {
      expect(pkg.dependencies).not.toHaveProperty(name);
      expect(pkg.overrides[name]).toBeTypeOf("string");
    }
  });
  test(`${folder} ships thin AI pointers to the installed skill`, () => {
    for (const file of ["AGENTS.md", "CLAUDE.md"]) expect(readFileSync(path.join(templates, folder, file), "utf8")).toBe(pointer + "\n");
    expect(readFileSync(path.join(templates, folder, ".claude/skills/spark/SKILL.md"), "utf8")).toBe(claudePointer);
  });
  test(`${folder} initializes upstream identity once and preserves edits`, () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "spark-template-test-"));
    const previous = process.env.SPARK_PLATFORM;
    delete process.env.SPARK_PLATFORM;
    try {
      const config = JSON.parse(readFileSync(path.join(templates, folder, "desktop.config.json"), "utf8"));
      writeFileSync(path.join(root, "desktop.config.json"), JSON.stringify(config));
      writeFileSync(path.join(root, "app.json"), JSON.stringify({ expo: {
        name: "UpstreamName", platforms: ["ios", "android", "macos", "windows"],
        ios: { bundleIdentifier: "org.example.upstream" }, android: { package: "org.example.upstream" },
        macos: { bundleIdentifier: "org.example.upstream", version: "0.0.1", buildNumber: "7" },
        windows: { projectGuid: "upstream-generated-guid", packageGuid: "upstream-package-guid", namespace: "org.example.upstream" },
      } }));
      initializeTemplate(root);
      const initialized = JSON.parse(readFileSync(path.join(root, "desktop.config.json"), "utf8"));
      expect(initialized.name).toBe("UpstreamName");
      expect(initialized.projectId).toBe("upstream-generated-guid");
      expect(initialized.platforms).toEqual(config.platforms);
      if (config.macos) expect(initialized.macos.bundleIdentifier).toBe("org.example.upstream");
      if (config.macos) expect(readConfig(root).expo.macos).toMatchObject({ version: config.version, buildNumber: "7" });
      expect(readConfig(root).expo.windows?.packageGuid).toBe("upstream-package-guid");
      initialized.name = "User renamed app";
      writeFileSync(path.join(root, "desktop.config.json"), JSON.stringify(initialized));
      const before = readFileSync(path.join(root, "desktop.config.json"), "utf8");
      initializeTemplate(root);
      expect(readFileSync(path.join(root, "desktop.config.json"), "utf8")).toBe(before);
    } finally {
      if (previous !== undefined) process.env.SPARK_PLATFORM = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });
}
test("all templates retain the tested desktop matrix", () => {
  for (const folder of ["blank-typescript", "windows", "universal"]) {
    const pkg = JSON.parse(readFileSync(path.join(templates, folder, "package.json"), "utf8"));
    expect(pkg.dependencies["expo-desktop"]).toBe("1.0.6");
    expect(pkg.dependencies["expo-desktop-template-bare-minimum"]).toBe("55.83.10");
    expect(pkg.dependencies["expo-desktop-prebuild-config"]).toBe("1.1.3");
    expect(pkg.dependencies["expo-desktop-config-plugins"]).toBe("1.3.2");
    expect(pkg.dependencies["expo-desktop-metro-config"]).toBe("55.83.3");
    expect(pkg.overrides["expo-desktop-modules-core"]).toBe("55.0.2");
    expect(pkg.overrides["expo-desktop-stubs"]).toBe("55.0.2");
    const { expo } = JSON.parse(readFileSync(path.join(templates, folder, "app.json"), "utf8"));
    expect(expo.macos).toMatchObject({ version: expo.version, buildNumber: "1" });
    expect(pkg.dependencies.expo).toBe("55.0.32");
    const yarn = structuredClone(pkg);
    applyOverrides(yarn, {}, "yarn");
    expect(yarn.resolutions.expo).toBe(pkg.dependencies.expo);
    expect(pkg.overrides["@expo/cli"]).toBe("55.0.37");
    expect(pkg.dependencies["react-native"]).toBe("0.83.10");
    expect(pkg.overrides["react-native-macos"]).toBe("0.83.0");
    expect(pkg.overrides["react-native-windows"]).toBe("0.83.2");
    expect(pkg.scripts.postinstall).toBe("node node_modules/@legendapp/spark/init-template.cjs");
    for (const name of ["@legendapp/spark", "react-native-enriched-markdown", "fsevents"]) {
      expect(pkg.allowScripts[name]).toBe(true);
      expect(pkg.trustedDependencies).toContain(name);
      expect(pkg.pnpm.onlyBuiltDependencies).toContain(name);
    }
  }
});

test("Runner profile trusts enriched-markdown postinstall before installing with Bun", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-runner-install-"));
  try {
    writeFileSync(path.join(root, "package.json"), readFileSync(path.join(templates, "blank-typescript/package.json")));
    const manifest = path.join(root, "manifest.json");
    writeFileSync(manifest, JSON.stringify({ "@legendapp/spark": "spark.tgz" }));
    vi.mocked(run).mockImplementationOnce(async (_root, command) => {
      const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
      expect(command).toEqual(["bun", "install"]);
      expect(pkg.trustedDependencies).toContain("react-native-enriched-markdown");
      expect(pkg["enriched-markdown"]?.enableCodeHighlight).not.toBe(false);
      expect(pkg["enriched-markdown"]?.enableMath).not.toBe(false);
      return "";
    });
    await prepareGoProfile(root, manifest, "macos", "bun");
    expect(run).toHaveBeenCalledTimes(1);
  } finally { vi.clearAllMocks(); rmSync(root, { recursive: true, force: true }); }
});
