import { expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { selection, type NativePackage } from "../packages/cli/src/project.ts";
const { runtimePlan, graphDiscovery } = require("../packages/cli/src/metro.cjs");
const { generateThreadedRuntimeEntry } = require("@react-native-runtimes/core/metro");
test("production prunes Runtimes and Nitro, retaining Nitro for other native consumers", () => {
  const pkg = (name: string, deps = {}, sdk = true): NativePackage => ({ name, sdk, root: name, requires: [], signature: name, json: { dependencies: deps } });
  const core = pkg("@react-native-runtimes/core", { "react-native-nitro-modules": "0.35.7" });
  const nitro = pkg("react-native-nitro-modules");
  expect(selection([core, nitro], new Set()).included).toEqual([]);
  expect(selection([core, nitro], new Set([core.name])).included).toEqual([core, nitro]);
  const camera = pkg("camera", { [nitro.name]: "0.35.7" }, false);
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
    expect(runtimePlan(root, {})).toEqual({ enabled: true, roots: [] });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("development registers what the app's Metro graphs reach, wherever it lives, and follows Fast Refresh", () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "spark-runtimes-graph-")));
  const generatedEntry = path.join(root, ".threaded-runtime/entry.js");
  const file = (name: string, source: string) => {
    const location = path.join(root, name);
    mkdirSync(path.dirname(location), { recursive: true });
    writeFileSync(location, source);
    return location;
  };
  const panel = (name: string) => `import { threadedComponent } from "@react-native-runtimes/core";\nexport const Panel = threadedComponent(${JSON.stringify(name)}, () => null);\n`;
  type Module = { dependencies: Map<string, { absolutePath: string }>; getSource: () => Buffer };
  const graph = { entryPoints: new Set([file("index.ts", "")]), transformOptions: { platform: "macos" }, dependencies: new Map<string, Module>() };
  const add = (location: string, imports: string[] = []) => {
    const module = { dependencies: new Map(imports.map(to => [to, { absolutePath: to }])), getSource: () => readFileSync(location) };
    graph.dependencies.set(location, module);
    return [location, module] as const;
  };
  const index = graph.entryPoints.values().next().value!;
  const nested = file("screens/windows/Panel.tsx", panel("nested-panel"));
  const plugin = file("node_modules/plugin/panel.js", panel("plugin-panel"));
  const unrelated = file("node_modules/other/panel.js", "export const threadedComponent = 1;\n");
  const unused = file("tasks.ts", panel("unused-task"));
  file(".threaded-runtime/entry.js", "");
  const rendered: string[][] = [];
  const discover = graphDiscovery({ root, generatedEntry, generate: (roots: string[]) => {
    rendered.push(roots);
    generateThreadedRuntimeEntry({ projectRoot: root, generatedEntry, roots });
  } });
  const empty = { added: new Map(), modified: new Map(), deleted: new Set(), reset: false };
  try {
    add(index, [nested, plugin, unrelated]);
    for (const location of [nested, plugin, unrelated]) add(location);
    discover(graph, { ...empty, added: graph.dependencies, reset: true });
    expect(rendered).toEqual([[plugin, nested].sort()]);
    const entry = () => readFileSync(generatedEntry, "utf8");
    for (const name of ["nested-panel", "plugin-panel"]) expect(entry()).toContain(`registerLazyThreadedComponent("${name}"`);
    expect(entry()).not.toContain("unused-task");
    expect(readFileSync(unused, "utf8")).toContain("unused-task");
    // A new Metro process seeded with the last roots does not rewrite an unchanged registry.
    const seeded = vi.fn();
    graphDiscovery({ root, generatedEntry, roots: rendered[0], generate: seeded })(graph, { ...empty, added: graph.dependencies, reset: true });
    expect(seeded).not.toHaveBeenCalled();

    // The worker bundle's own graph and unrelated edits do not regenerate the entry.
    discover({ ...graph, entryPoints: new Set([generatedEntry]), dependencies: new Map([add(unused)]) }, { ...empty, reset: true });
    graph.dependencies.delete(unused);
    discover(graph, { ...empty, modified: new Map([add(unrelated)]) });
    expect(rendered.length).toBe(1);

    // Fast Refresh: a new file the app imports registers; editing a registering file rescans it.
    const added = file("screens/new/Added.tsx", panel("added-panel"));
    discover(graph, { ...empty, added: new Map([add(added)]), modified: new Map([add(index, [nested, plugin, unrelated, added])]) });
    expect(entry()).toContain('registerLazyThreadedComponent("added-panel"');
    writeFileSync(added, panel("renamed-panel"));
    discover(graph, { ...empty, modified: new Map([add(added)]) });
    expect(entry()).toContain('registerLazyThreadedComponent("renamed-panel"');
    // Removing the import unregisters it.
    graph.dependencies.delete(added);
    discover(graph, { ...empty, deleted: new Set([added]), modified: new Map([add(index, [nested, plugin, unrelated])]) });
    expect(rendered.at(-1)).toEqual([plugin, nested].sort());
    expect(entry()).not.toContain("renamed-panel");
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
