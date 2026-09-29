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
test("all templates retain the tested beta matrix", () => {
  for (const folder of ["blank-typescript", "windows", "universal"]) {
    const pkg = JSON.parse(readFileSync(path.join(templates, folder, "package.json"), "utf8"));
    expect(pkg.dependencies["expo-desktop"]).toBe("1.0.0-beta.6");
    expect(pkg.dependencies["expo-desktop-template-bare-minimum"]).toBe("54.81.1-beta.6");
    expect(pkg.dependencies.expo).toBe("54.0.37");
    expect(pkg.overrides["@expo/cli"]).toBe("54.0.27");
    expect(pkg.dependencies["react-native"]).toBe("0.81.6");
    expect(pkg.scripts.postinstall).toBe("node node_modules/@legendapp/spark/init-template.cjs");
  }
});
