import { expect, test } from "vitest";
import { composeExport, composeMetro } from "../packages/cli/src/add-desktop.ts";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
const { withSparkNative } = createRequire(import.meta.url)("../packages/cli/src/expo-native.cjs");
const { withSparkExpo } = createRequire(import.meta.url)("../packages/config-plugin/expo.cjs");

test("compose config expressions without moving imports or changing application logic", () => {
  const source = 'import type { ConfigContext } from "expo/config";\nconst suffix = "dev";\nexport default ({ config }: ConfigContext) => ({ ...config, name: suffix });\n';
  const composed = composeExport(source, "app.config.ts", "adapter", "wrap");
  expect(composed).toContain('import type { ConfigContext } from "expo/config";');
  expect(composed).toContain('export default require("adapter").wrap(({ config }: ConfigContext) => ({ ...config, name: suffix }), __dirname);');
  expect(composeExport(composed, "app.config.ts", "adapter", "wrap")).toBe(composed);
  expect(() => composeExport('export { config as default } from "./config";', "app.config.ts", "adapter", "wrap")).toThrow("Cannot safely compose");
});
test("Metro composition preserves custom settings and is idempotent", () => {
  const source = 'const { getDefaultConfig } = require("expo/metro-config");\nconst config = getDefaultConfig(__dirname);\nconfig.resolver.sourceExts.push("custom");\nmodule.exports = config;';
  const composed = composeMetro(source, "metro.config.js");
  expect(composed).toContain('require("@legendapp/spark/metro")');
  expect(composed).toContain('config.resolver.sourceExts.push("custom")');
  expect(composeMetro(composed, "metro.config.js")).toBe(composed);
  expect(() => composeMetro("module.exports = {};", "metro.config.js")).toThrow("getDefaultConfig");
});
test("Expo and native wrappers leave mobile and default Expo commands unchanged", () => {
  const previous = process.env.SPARK_PLATFORM;
  try {
    const base = { name: "Existing", platforms: ["ios", "android", "web"], extra: { retained: true } };
    const native = { dependencies: { example: { platforms: { ios: null } } }, assets: ["./fonts"] };
    for (const target of [undefined, "ios", "android", "web"]) {
      if (target) process.env.SPARK_PLATFORM = target; else delete process.env.SPARK_PLATFORM;
      expect(withSparkExpo(({ config }: any) => config, "/unused")({ config: base })).toBe(base);
      expect(withSparkNative(native, "/unused")).toBe(native);
    }
  } finally { if (previous === undefined) delete process.env.SPARK_PLATFORM; else process.env.SPARK_PLATFORM = previous; }
});


test("an adopted Expo app preserves its dynamic config in a shared development session", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-adopted-session-"));
  const previous = { platform: process.env.SPARK_PLATFORM, session: process.env.SPARK_DEV_SESSION };
  const platforms = ["ios", "android", "web", "macos", "windows"];
  try {
    writeFileSync(path.join(root, "desktop.config.json"), JSON.stringify({ extends: "expo", projectId: "existing-app", platforms, macos: { bundleIdentifier: "org.example.existing" }, expoByPlatform: { macos: { autolinking: { exclude: ["@expo/ui"] } } } }));
    process.env.SPARK_PLATFORM = "macos";
    process.env.SPARK_DEV_SESSION = "1";
    const base = { name: "Existing", version: "2.0.0", platforms: ["ios", "android", "web"], extra: { environment: "local" }, plugins: ["./custom-plugin"] };
    const config = withSparkExpo(() => base, root)({});
    expect(config.platforms).toEqual(platforms);
    expect(config.extra.environment).toBe("local");
    expect(config.extra.spark.projectId).toBe("existing-app");
    expect(config.plugins).toContain("./custom-plugin");
    expect(config.autolinking?.exclude ?? []).not.toContain("@expo/ui");
    expect(base.platforms).toEqual(["ios", "android", "web"]);
    delete process.env.SPARK_DEV_SESSION;
    expect(withSparkExpo(() => base, root)({}).platforms).toEqual(["macos"]);
  } finally {
    for (const [key, value] of [["SPARK_PLATFORM", previous.platform], ["SPARK_DEV_SESSION", previous.session]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
