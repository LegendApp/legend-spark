import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareConfig, readConfig, statePath, toExpo, expoConfig, developmentConfig } from "@legendapp/spark-desktop-config/config.cjs";
import { selectionIndex } from "../packages/ui/src/select.ts";

const shared = {
  name: "Settings", projectId: "universal-settings", version: "1.0.0",
  platforms: ["ios", "android", "web", "macos", "windows"],
  macos: { bundleIdentifier: "com.example.settings" },
  expo: { ios: { bundleIdentifier: "com.example.mobile", infoPlist: { Existing: true } }, android: { package: "com.example.mobile" }, extra: { application: "preserved" } },
  expoByPlatform: { ios: { ios: { infoPlist: { IOSOnly: true } } }, macos: { autolinking: { exclude: ["@expo/ui"] } } },
};
test("macOS materializes all URL associations before backend base mods", () => {
  const input = { ...shared, scheme: ["demo", "demo-auth", "demo"] };
  const mac = toExpo(input, "macos").expo;
  expect(mac.macos?.infoPlist?.CFBundleURLTypes).toEqual([
    { CFBundleURLName: "universal-settings", CFBundleURLSchemes: ["demo", "demo-auth"] },
  ]);
  expect(mac.scheme).toEqual(input.scheme);
  expect(toExpo(input, "ios").expo.macos?.infoPlist?.CFBundleURLTypes).toBeUndefined();
});
test("target configuration composes overrides without mutating shared input", () => {
  const before = JSON.stringify(shared);
  const ios = toExpo(shared, "ios").expo, mac = toExpo(shared, "macos").expo;
  expect(ios.ios?.infoPlist).toEqual({ Existing: true, IOSOnly: true });
  expect(mac.ios?.infoPlist).toEqual({ Existing: true });
  expect(ios.plugins).not.toContain("@legendapp/spark/config-plugin");
  expect(mac.plugins).toContain("@legendapp/spark/config-plugin");
  expect(ios.extra.application).toBe("preserved");
  expect(mac.extra.spark.supportedPlatforms).toEqual(shared.platforms);
  expect(JSON.stringify(shared)).toBe(before);
  expect(() => toExpo({ ...shared, platforms: ["macos"] }, "windows")).toThrow("not supported");
});
test("switching targets preserves source, config, generated native projects, and other targets' metadata", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-universal-"));
  const previous = process.env.SPARK_PLATFORM;
  const preserved = ["desktop.config.json", "package.json", "App.tsx", "app.json", ...shared.platforms.filter(p => p !== "web").map(p => `${p}/native-project.txt`)];
  try {
    for (const file of preserved) { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), file === "desktop.config.json" ? JSON.stringify(shared) : `preserve ${file}`); }
    const before = preserved.map(file => readFileSync(path.join(root, file), "utf8"));
    for (const target of [...shared.platforms, "macos", "ios"]) {
      process.env.SPARK_PLATFORM = target;
      expect(prepareConfig(root).expo.platforms).toEqual([target]);
      expect(readConfig(root).expo.extra?.spark?.projectId).toBe(shared.projectId);
      const file = statePath(root, "dev-build.json");
      expect(file).toBe(path.join(root, ".spark/platforms", target, "dev-build.json"));
      mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, target);
    }
    expect(preserved.map(file => readFileSync(path.join(root, file), "utf8"))).toEqual(before);
    for (const target of shared.platforms) expect(readFileSync(statePath(root, "dev-build.json", target), "utf8")).toBe(target);
  } finally {
    if (previous === undefined) delete process.env.SPARK_PLATFORM; else process.env.SPARK_PLATFORM = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
test("Select keeps semantic values independent of backend indices", () => {
  const options = [{ label: "Light", value: "light" }, { label: "Dark", value: "dark" }];
  expect(selectionIndex(options, "dark")).toBe(1);
  expect(selectionIndex([...options].reverse(), "dark")).toBe(0);
  expect(() => selectionIndex(options, "system")).toThrow("match");
  expect(() => selectionIndex([options[0]!, options[0]!], "light")).toThrow("unique");
});

test("desktop Metro selects native package exports while preserving application conditions", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-metro-conditions-"));
  const previous = process.env.SPARK_PLATFORM;
  try {
    process.env.SPARK_PLATFORM = "windows";
    writeFileSync(path.join(root, "desktop.config.json"), JSON.stringify(shared));
    const { withDesktop } = require("../packages/cli/src/metro.cjs");
    const conditions = { web: ["browser"], macos: ["custom"], windows: ["react-native", "custom"] };
    const config = { projectRoot: root, server: { unstable_serverRoot: path.dirname(root) }, resolver: { unstable_conditionsByPlatform: conditions } };
    const result = withDesktop(config, { runtimes: false });
    expect(result.resolver.unstable_conditionsByPlatform).toEqual({
      web: ["browser"], macos: ["custom", "react-native"], windows: ["react-native", "custom"],
    });
    expect(conditions.macos).toEqual(["custom"]);
    expect(result.server.unstable_serverRoot).toBe(path.dirname(root));
  } finally {
    if (previous === undefined) delete process.env.SPARK_PLATFORM; else process.env.SPARK_PLATFORM = previous;
    rmSync(root, { recursive: true, force: true });
  }
});


test("one development config exposes all platforms without desktop native exclusions", () => {
  const before = JSON.stringify(shared);
  for (const target of shared.platforms) {
    const config = developmentConfig(shared, target);
    expect(config.platforms).toEqual(shared.platforms);
    expect(config.autolinking?.exclude ?? []).not.toContain("@expo/ui");
    expect(config.extra.application).toBe("preserved");
    expect(config.ios?.infoPlist).toEqual({ Existing: true });
  }
  expect(JSON.stringify(shared)).toBe(before);
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-session-config-"));
  const previous = { target: process.env.SPARK_PLATFORM, session: process.env.SPARK_DEV_SESSION };
  try {
    process.env.SPARK_PLATFORM = "macos";
    process.env.SPARK_DEV_SESSION = "1";
    writeFileSync(path.join(root, "desktop.config.json"), JSON.stringify(shared));
    mkdirSync(path.join(root, ".spark/platforms/macos"), { recursive: true });
    writeFileSync(statePath(root, "native-selection.json"), JSON.stringify({ excluded: ["mobile-only-module"] }));
    expect(expoConfig(root).platforms).toEqual(shared.platforms);
    expect(expoConfig(root).autolinking).toBeUndefined();
    // The supervisor's native compatibility reader keeps its target semantics.
    expect(readConfig(root).expo.platforms).toEqual(["macos"]);
    expect(readConfig(root).expo.autolinking?.exclude).toContain("@expo/ui");
    delete process.env.SPARK_DEV_SESSION;
    expect(expoConfig(root).platforms).toEqual(["macos"]);
    expect(expoConfig(root).autolinking?.exclude).toEqual(["@expo/ui", "mobile-only-module"]);
  } finally {
    for (const [key, value] of [["SPARK_PLATFORM", previous.target], ["SPARK_DEV_SESSION", previous.session]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
