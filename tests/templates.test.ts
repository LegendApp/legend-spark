import { expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { readConfig } from "@legendapp/spark/config";
const { initializeTemplate } = createRequire(import.meta.url)("../packages/cli/src/init-template.cjs");
const templates = path.resolve(import.meta.dirname, "../packages/cli/templates");
for (const folder of ["blank-typescript", "windows", "universal"]) {
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
        macos: { bundleIdentifier: "org.example.upstream" },
        windows: { projectGuid: "upstream-generated-guid", packageGuid: "upstream-package-guid", namespace: "org.example.upstream" },
      } }));
      initializeTemplate(root);
      const initialized = JSON.parse(readFileSync(path.join(root, "desktop.config.json"), "utf8"));
      expect(initialized.name).toBe("UpstreamName");
      expect(initialized.projectId).toBe("upstream-generated-guid");
      expect(initialized.platforms).toEqual(config.platforms);
      if (config.macos) expect(initialized.macos.bundleIdentifier).toBe("org.example.upstream");
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
    expect(pkg.dependencies["expo-desktop"]).toBe("1.0.0");
    expect(pkg.dependencies["expo-desktop-template-bare-minimum"]).toBe("54.81.1");
    expect(pkg.dependencies["expo-desktop-prebuild-config"]).toBe("1.1.0");
    expect(pkg.dependencies["expo-desktop-config-plugins"]).toBe("1.2.0");
    expect(pkg.dependencies["expo-desktop-metro-config"]).toBe("54.81.0");
    expect(pkg.overrides["expo-desktop-modules-core"]).toBe("54.0.14");
    expect(pkg.overrides["expo-desktop-stubs"]).toBe("54.0.14");
    expect(pkg.dependencies.expo).toBe("58.0.7");
    // expo-desktop-template-bare-minimum 54.81.1 depends on expo ~54; without this a nested SDK 54 expo conflicts natively.
    expect(pkg.overrides.expo).toBe("58.0.7");
    // expo-desktop-template-bare-minimum 54.81.1 depends on expo-status-bar ~3.0.9 (SDK 54).
    expect(pkg.overrides["expo-status-bar"]).toBe("58.0.3");
    expect(pkg.overrides["@expo/cli"]).toBe("58.1.6");
    expect(pkg.dependencies["react-native"]).toBe("0.88.0-rc.4");
    expect(pkg.overrides["react-native-macos"]).toBe("0.88.0-rc.4");
    expect(pkg.overrides["react-native-windows"]).toBe("0.81.35");
    expect(pkg.scripts.postinstall).toBe("node node_modules/@legendapp/spark/init-template.cjs");
  }
});
