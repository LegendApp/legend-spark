import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { selection, type NativePackage } from "../packages/cli/src/project.ts";
const { runtimePlan } = require("../packages/cli/src/metro.cjs");
test("production prunes Runtimes and Nitro, retaining Nitro for other native consumers", () => {
  const pkg = (name: string, deps = {}, sdk = true): NativePackage => ({ name, sdk, root: name, requires: [], signature: name, json: { dependencies: deps } });
  const core = pkg("@react-native-runtimes/core", { "react-native-nitro-modules": "0.37.0" });
  const nitro = pkg("react-native-nitro-modules");
  expect(selection([core, nitro], new Set()).included).toEqual([]);
  expect(selection([core, nitro], new Set([core.name])).included).toEqual([core, nitro]);
  const camera = pkg("camera", { [nitro.name]: "0.37.0" }, false);
  expect(selection([core, nitro, camera], new Set()).included).toEqual([nitro, camera]);
});
test("production registry uses the discovered graph, independent of installed packages and leftover task files", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-runtimes-plan-"));
  try {
    mkdirSync(path.join(root, "src")); writeFileSync(path.join(root, "tasks.ts"), "unused task");
    writeFileSync(path.join(root, "metro.config.js"), "config");
    expect(runtimePlan(root, { SPARK_RUNTIME_DISCOVERY: "1" })).toEqual({ enabled: false, roots: [] });
    const sources = path.join(root, "sources.json");
    writeFileSync(sources, JSON.stringify({ enabled: false, roots: [] }));
    expect(runtimePlan(root, { SPARK_RUNTIME_SOURCES: sources }).enabled).toBe(false);
    writeFileSync(sources, JSON.stringify({ enabled: true, roots: ["src/used.ts"] }));
    expect(runtimePlan(root, { SPARK_RUNTIME_SOURCES: sources }).roots).toEqual(["src/used.ts"]);
    expect(runtimePlan(root, {}).roots).toEqual(["tasks.ts", "src"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("SDK refresh upgrades the original starter pair and preserves custom entries", async () => {
  const { upgradeManagedEntry } = await import("../packages/cli/src/create.ts");
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-runtimes-migration-"));
  const metro = `const { makeMetroConfig } = require("expo-desktop-metro-config");
const { gate } = require("@legendapp/spark-cli/src/metro-gate.cjs");
const config = makeMetroConfig(__dirname);
config.server = { ...config.server, enhanceMiddleware: (middleware) => gate(__dirname, middleware) };
module.exports = config;
`;
  const entry = 'import { registerRootComponent } from "expo";\nimport App from "./App";\nregisterRootComponent(App);\n';
  try {
    writeFileSync(path.join(root, "metro.config.js"), metro);
    writeFileSync(path.join(root, "index.ts"), entry + "// User customization\n");
    upgradeManagedEntry(root);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(path.join(root, "metro.config.js"), "utf8")).toBe(metro);
    expect(readFileSync(path.join(root, "index.ts"), "utf8")).toContain("User customization");
    writeFileSync(path.join(root, "index.ts"), entry);
    upgradeManagedEntry(root);
    expect(readFileSync(path.join(root, "metro.config.js"), "utf8")).toContain("withDesktop");
    expect(readFileSync(path.join(root, "index.ts"), "utf8")).toContain("__THREADED_RUNTIME_ENV__");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
