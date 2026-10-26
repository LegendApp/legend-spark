import { VERSION } from "../packages/cli/src/project.ts";
import { spawnProcess } from "../packages/cli/src/process.ts";
import { expect, test } from "vitest";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { packCreateSpark } from "../scripts/pack-create-spark.ts";
import { packSpark } from "../scripts/pack-spark.ts";
import { installedPackages, nativePackages, selection, stateFile } from "../packages/cli/src/project.ts";
import ts from "typescript";

const framework = path.resolve(import.meta.dirname, "..");
test("single Spark archive resolves public exports and preserves private native discovery and pruning", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-public-package-"));
  try {
    const release = { schema: 1 as const, version: VERSION, revision: "a".repeat(40), packages: {}, runners: {} };
    const file = await packSpark(framework, root, release);
    // macOS AppleDouble root files make Yarn Classic recurse outside the
    // extraction directory after it strips the package prefix.
    const tooling = createRequire(path.join(framework, "packages/cli/package.json"));
    const tar = createRequire(tooling.resolve("npm/package.json"))("tar");
    const entries: string[] = [];
    tar.t({ file: path.join(root, file), sync: true, onReadEntry: (entry: { path: string }) => entries.push(entry.path) });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every(name => name.startsWith("package/") && !name.split("/").some(part => part.startsWith("._")))).toBe(true);
    const app = path.join(root, "consumer");
    const destination = path.join(app, "node_modules/@legendapp/spark");
    mkdirSync(destination, { recursive: true });
    const child = spawnProcess(["tar", "-xzf", path.join(root, file), "--strip-components=1", "-C", destination], { stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(0);
    // Compile against the extracted public package, with only a minimal React Native peer stub.
    // This catches import rewrites that accidentally resolve through this producer workspace.
    const peerStub = path.join(app, "node_modules/react-native");
    mkdirSync(peerStub, { recursive: true });
    writeFileSync(path.join(peerStub, "package.json"), JSON.stringify({ name: "react-native", types: "index.d.ts" }));
    writeFileSync(path.join(peerStub, "index.d.ts"), `export interface TurboModule {} export const Platform: any; export class NativeEventEmitter { constructor(...args: any[]); addListener<T = any>(event: string, listener: (event: T) => void): { remove(): void }; } export const TurboModuleRegistry: { get<T>(name: string): T | null; getEnforcing<T>(name: string): T }; export const Linking: any; export const Appearance: any; export const AppState: any; export const DeviceEventEmitter: any; export const NativeModules: any; export const View: any; export const Text: any; export const Pressable: any; export const Image: any; export const StyleSheet: any; export type ViewProps = any; export type TextProps = any; export type ColorValue = any; export const AppRegistry: any;`);
    const reactStub = path.join(app, "node_modules/react");
    mkdirSync(reactStub, { recursive: true });
    writeFileSync(path.join(reactStub, "package.json"), JSON.stringify({ name: "react", types: "index.d.ts" }));
    writeFileSync(path.join(reactStub, "index.d.ts"), `export type ReactNode = any; export type ComponentType<P = any> = (props: P) => any; export function lazy<P>(load: () => Promise<{ default: ComponentType<P> }>): ComponentType<P>; export const Suspense: ComponentType<{ fallback: ReactNode; children?: ReactNode }>; export type PropsWithChildren<P = unknown> = P & { children?: ReactNode }; export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void; export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void; export function useRef<T>(value: T): { current: T }; export function useState<T>(value: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void]; export interface Context<T> { Provider: any; __value?: T } export function createContext<T>(value: T): Context<T>; export function useContext<T>(context: Context<T>): T;`);
    mkdirSync(path.join(reactStub, "jsx-runtime"), { recursive: true });
    writeFileSync(path.join(reactStub, "jsx-runtime/index.d.ts"), `export const Fragment: any; export function jsx(...args: any[]): any; export function jsxs(...args: any[]): any;`);
    // Public config declarations must resolve without the producer's type-only tooling.
    const expoStub = path.join(app, "node_modules/expo/config");
    mkdirSync(expoStub, { recursive: true });
    writeFileSync(path.join(expoStub, "index.d.ts"), "export interface ExpoConfig { name: string; slug: string; version?: string }\n");
    const configSource = path.join(app, "config-types.ts");
    writeFileSync(configSource, `
      import { withSparkNative, nativeConfig } from "@legendapp/spark/native";
      import type { SparkApplicationConfig } from "@legendapp/spark/config";
      const config: SparkApplicationConfig = { name: "App", version: "1.0.0", projectId: "app" };
      const result = withSparkNative({ project: { ios: { sourceDir: "ios" } }, assets: ["assets"], custom: true }, ".");
      const source: string = result.project.ios.sourceDir;
      void [config, source, nativeConfig(".").dependencies];
    `);
    const configProgram = ts.createProgram([configSource], {
      strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, types: [],
    });
    expect(ts.getPreEmitDiagnostics(configProgram).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
    const consumerSource = path.join(app, "public-types.ts");
    writeFileSync(consumerSource, `
      import type { MenuItem, MenuRootItem, AsyncRegistration } from "@legendapp/spark/menus";
      import type { MenuItem as ContextMenuItem } from "@legendapp/spark/context-menu";
      import type { MenuItem as TrayMenuItem, AsyncRegistration as TrayRegistration } from "@legendapp/spark/tray";
      import type { AsyncRegistration as AppRegistration, Subscription } from "@legendapp/spark/app";
      import type { AsyncRegistration as FileRegistration } from "@legendapp/spark/files";
      import type { MacOSToolbarItem } from "@legendapp/spark/windows/macos";
      import type { AsyncRegistration as WindowRegistration } from "@legendapp/spark/windows";
      const root: MenuRootItem = { type: "submenu", id: "root", label: "Root", items: [{ type: "role", id: "quit", role: "quit" }] };
      const tray: TrayMenuItem = { type: "submenu", id: "root", label: "Root", items: [{ type: "action", id: "open", label: "Open" }] };
      const context: ContextMenuItem = { type: "action", id: "open", label: "Open" };
      const toolbar: MacOSToolbarItem = { type: "menu", id: "volume", items: [{ type: "slider", id: "slider", label: "Volume", min: 0, max: 1, value: 0.5 }] };
      declare const registration: AsyncRegistration | TrayRegistration | AppRegistration | FileRegistration | WindowRegistration;
      declare const subscription: Subscription;
      void [root, tray, context, toolbar, registration, subscription];
      // @ts-expect-error Application menu roots must be submenus.
      const invalidRoot: MenuRootItem = { type: "action", id: "open", label: "Open" };
      // @ts-expect-error Context menus reject submenu items.
      const invalidContext: ContextMenuItem = { type: "submenu", id: "root", label: "Root", items: [] };
      // @ts-expect-error Context menus reject semantic targeting.
      const invalidContextTarget: ContextMenuItem = { type: "action", id: "open", label: "Open", target: { menu: "file" } };
      // @ts-expect-error Tray menus reject shortcuts and icons.
      const invalidTray: TrayMenuItem = { type: "action", id: "open", label: "Open", shortcut: "Cmd+O", icon: { type: "symbol", name: "folder" } };
      // @ts-expect-error Tray menu restrictions apply recursively.
      const invalidNestedTray: TrayMenuItem = { type: "submenu", id: "root", label: "Root", items: [{ type: "slider", id: "volume", label: "Volume", min: 0, max: 1, value: 0.5 }] };
      // @ts-expect-error Toolbar menus reject semantic role commands.
      const invalidToolbarRole: MacOSToolbarItem = { type: "menu", id: "file", items: [{ type: "role", id: "quit", role: "quit" }] };
      // @ts-expect-error App menu callbacks do not produce slider changes.
      const invalidAction: import("@legendapp/spark/menus").MenuAction = { type: "valueChanged", itemId: "slider", value: 0.5 };
    `);
    const consumerProgram = ts.createProgram([consumerSource], {
      strictNullChecks: true, noImplicitAny: false, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      types: [], jsx: ts.JsxEmit.ReactJSX,
    });
    const consumerDiagnostics = ts.getPreEmitDiagnostics(consumerProgram);
    expect(consumerDiagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
    writeFileSync(path.join(app, "package.json"), JSON.stringify({ dependencies: { "@legendapp/spark": VERSION, "react-native-vision-camera": "5.2.3", "react-native-nitro-image": "0.15.2", "react-native-enriched-markdown": "1.1.1", "react-native-enriched-html": "1.1.1" } }));
    writeFileSync(path.join(app, "desktop.config.json"), JSON.stringify({ name: "Packed", version: "1.0.0", projectId: "packed-test", macos: { bundleIdentifier: "org.example.packed" }, platforms: ["macos"] }));
    const req = createRequire(path.join(app, "package.json"));
    const producer = createRequire(path.join(framework, "package.json"));
    for (const name of ["react-native-vision-camera", "react-native-nitro-image", "react-native-nitro-modules", "react-native-enriched-markdown", "react-native-enriched-html", "diff"])
      cpSync(path.dirname(producer.resolve(`${name}/package.json`)), path.join(app, "node_modules", name), { recursive: true });
    const manifest = req("@legendapp/spark/package.json");
    expect(readFileSync(path.join(destination, "skills/spark/SKILL.md"))).toEqual(readFileSync(path.join(framework, "packages/desktop/skills/spark/SKILL.md")));
    expect(readFileSync(path.join(destination, "skills/spark/UPGRADING.md"))).toEqual(readFileSync(path.join(framework, "packages/desktop/skills/spark/UPGRADING.md")));
    createRequire(path.join(destination, "package.json"))("./vendor/node_modules/@legendapp/spark-desktop-config/native-patches.cjs").prepareNativePatches(app);
    for (const [name, version] of [["react-native-enriched-markdown", "1.1.1"], ["react-native-enriched-html", "1.1.1"]]) {
      expect(JSON.parse(readFileSync(path.join(app, "node_modules", name, "package.json"), "utf8")).spark.dependencyPatch.version).toBe(version);
      expect(readFileSync(path.join(destination, "patches", `${name}@${version}.patch`))).toEqual(
        readFileSync(path.join(framework, "patches", `${name}@${version}.patch`)),
      );
      expect(manifest.dependencies[name]).toBeUndefined();
      expect(manifest.peerDependencies[name]).toBe(version);
      expect(manifest.peerDependenciesMeta[name]).toEqual({ optional: true });
      expect(existsSync(path.join(destination, "vendor/node_modules", name))).toBe(false);
    }
    expect(readFileSync(path.join(destination, "patches/dependencies.json"))).toEqual(readFileSync(path.join(framework, "patches/dependencies.json")));
    expect(manifest.spark.nativePatchRequirements.schema).toBe(1);
    expect(manifest.spark.nativePatchRequirements.frameworkVersion).toBe(VERSION);
    expect(Object.keys(manifest.spark.nativePatchRequirements.packages).sort()).toEqual([
      "@op-engineering/op-sqlite", "@react-native-runtimes/core", "expo-audio", "react-native-nitro-modules", "react-native-webview",
    ]);
    for (const requirement of Object.values(manifest.spark.nativePatchRequirements.packages) as any[])
      expect(requirement.patchHash).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.repository).toEqual({ type: "git", url: "https://github.com/LegendApp/legend-spark.git", directory: "packages/desktop" });
    expect(manifest.homepage).toBe("https://github.com/LegendApp/legend-spark#readme");
    expect(manifest.bugs.url).toBe("https://github.com/LegendApp/legend-spark/issues");
    expect(manifest.keywords).toEqual(expect.arrayContaining(["react-native", "expo", "desktop", "macos", "windows"]));
    expect(manifest.license).toBe("MIT");
    expect(readFileSync(path.join(destination, "LICENSE"), "utf8")).toBe(readFileSync(path.join(framework, "LICENSE"), "utf8"));
    expect(readFileSync(path.join(framework, "LICENSE"), "utf8")).toContain("Copyright (c) 2026 LegendApp");
    const pluginStub = path.join(app, "node_modules/expo-desktop-config-plugins");
    mkdirSync(pluginStub);
    writeFileSync(path.join(pluginStub, "package.json"), JSON.stringify({ name: "expo-desktop-config-plugins", main: "index.cjs" }));
    writeFileSync(path.join(pluginStub, "index.cjs"), `
      exports.withEntitlementsPlist = exports.withAppDelegate = exports.withPodfile = exports.withXcodeProject = config => config;
      exports.generatedInfo = {};
      exports.withInfoPlist = (config, action) => {
        Object.assign(exports.generatedInfo, action({ modRequest: { projectRoot: ${JSON.stringify(app)} }, modResults: {} }).modResults);
        return config;
      };
    `);
    const configPluginsStub = path.join(app, "node_modules/@expo/config-plugins");
    mkdirSync(configPluginsStub, { recursive: true });
    writeFileSync(path.join(configPluginsStub, "package.json"), JSON.stringify({ name: "@expo/config-plugins", main: "index.cjs" }));
    writeFileSync(path.join(configPluginsStub, "index.cjs"), "exports.withMod = config => config; exports.IOSConfig = {};");
    const plugin = spawnProcess([process.execPath, "-e", `
      const { createRequire } = require("node:module");
      const req = createRequire(${JSON.stringify(path.join(app, "package.json"))});
      req("@legendapp/spark/config-plugin")({ macos: { bundleIdentifier: "org.example.packed" }, extra: { spark: { projectId: "packed-test" } } });
      console.log(JSON.stringify(req("expo-desktop-config-plugins").generatedInfo));
    `], { cwd: app, stdout: "pipe", stderr: "pipe" });
    const [pluginStatus, pluginOut, pluginErr] = await Promise.all([plugin.exited, new Response(plugin.stdout!).text(), new Response(plugin.stderr!).text()]);
    expect(pluginStatus, pluginErr).toBe(0);
    expect(JSON.parse(pluginOut).SparkFrameworkVersion).toBe(manifest.version);
    const singletonPeers = ["expo", "react", "react-native", "react-dom"];
    for (const name of singletonPeers) expect(manifest.dependencies).not.toHaveProperty(name);
    expect(manifest.peerDependencies).toMatchObject({ expo: "55.0.32", react: "^19.2.0", "react-native": "0.83.10", "react-dom": "^19.2.0" });
    expect(manifest.peerDependenciesMeta["react-dom"]).toEqual({ optional: true });
    expect(manifest.dependencies["@react-native-runtimes/core"]).toBe("0.1.0-alpha.2");
    expect(manifest.dependencies["react-native-nitro-modules"]).toBe("0.37.0");
    for (const name of ["react-native-webview", "@op-engineering/op-sqlite"]) {
      expect(manifest.dependencies).not.toHaveProperty(name);
      expect(manifest.peerDependenciesMeta[name]).toEqual({ optional: true });
    }
    for (const name of ["@react-native-community/cli-types", "@expo/config-types"]) expect(manifest.dependencies).not.toHaveProperty(name);
    expect(manifest.dependencies["react-native-vision-camera"]).toBeUndefined();
    expect(manifest.dependencies["react-native-nitro-image"]).toBeUndefined();
    expect(manifest.scripts.postinstall).toBe("node postinstall.cjs");
    expect(manifest.exports["./camera"]).toBeUndefined();
    expect(existsSync(path.join(destination, "camera.ts"))).toBe(false);
    expect(readFileSync(path.join(destination, "postinstall.cjs"), "utf8")).toContain("./vendor/node_modules/@legendapp/spark-desktop-config/native-patches.cjs");
    for (const name of ["react-native-vision-camera", "react-native-nitro-image"]) {
      expect(JSON.parse(readFileSync(path.join(app, "node_modules", name, "package.json"), "utf8")).spark.dependencyPatch.version).toBe(name === "react-native-vision-camera" ? "5.2.3" : "0.15.2");
      expect(existsSync(path.join(destination, "vendor/node_modules", name))).toBe(false);
      expect(readFileSync(path.join(destination, "patches/camera", `${name}.patch`))).toEqual(readFileSync(path.join(framework, "patches/camera", `${name}.patch`)));
    }
    expect(JSON.parse(readFileSync(path.join(destination, "vendor/node_modules/@legendapp/spark-cli/dist/release.json"), "utf8"))).toEqual(release);
    const internal = readdirSync(path.join(framework, "packages")).map(name => JSON.parse(readFileSync(path.join(framework, "packages", name, "package.json"), "utf8"))).filter(pkg => pkg.private === true);
    const normalized = await createRequire(tooling.resolve("npm/package.json"))("pacote").manifest(path.join(root, file), { cache: path.join(root, "registry-cache") });
    expect(normalized.bundleDependencies).toBeUndefined();
    expect(normalized.bundledDependencies).toBeUndefined();
    expect(Object.keys(normalized.dependencies).some(name => name.startsWith("@legendapp/spark-"))).toBe(false);
    for (const name of singletonPeers) expect(normalized.dependencies).not.toHaveProperty(name);
    expect(JSON.parse(readFileSync(path.join(destination, "vendor/node_modules/@legendapp/spark-markdown/package.json"), "utf8")).peerDependencies["react-native-enriched-markdown"]).toBe(manifest.peerDependencies["react-native-enriched-markdown"]);
    expect(manifest.spark.bundledModuleRoot).toBe("vendor");
    expect(existsSync(path.join(destination, "node_modules"))).toBe(false);
    expect(readFileSync(path.join(destination, "config.d.cts"), "utf8")).toContain("./vendor/node_modules/");
    expect(manifest.spark.bundledModules.sort()).toEqual(internal.map(pkg => pkg.name).sort());
    expect(Object.keys(manifest.dependencies).some(name => name.startsWith("@legendapp/spark-"))).toBe(false);
    for (const directory of ["native-greeting", "sdk-test-driver"]) {
      const fixture = JSON.parse(readFileSync(path.join(framework, "fixtures", directory, "package.json"), "utf8"));
      expect(Object.keys(fixture.dependencies ?? {}).some(name => name.startsWith("@legendapp/spark-"))).toBe(false);
    }
    for (const pkg of internal) {
      expect(pkg.private).toBe(true);
      expect(existsSync(path.join(destination, "vendor/node_modules", pkg.name, "package.json"))).toBe(true);
    }
    for (const subpath of Object.keys(manifest.exports)) {
      expect(realpathSync(req.resolve(`@legendapp/spark/${subpath.slice(2)}`)).startsWith(realpathSync(destination) + path.sep)).toBe(true);
    }
    for (const [entry, name] of [["markdown", "Markdown"], ["html", "Html"]]) {
      const source = path.join(destination, `${entry}.ts`);
      const program = ts.createProgram([source], { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, types: [], skipLibCheck: true });
      const checker = program.getTypeChecker();
      const exported = checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(source)!)!);
      for (const symbolName of [name, `${name}Props`, `${name}Input`, `Editable${name}`]) {
        const symbol = exported.find(symbol => symbol.name === symbolName)!;
        expect(symbol, symbolName).toBeDefined();
        const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
        expect(target.declarations?.every(declaration => declaration.getSourceFile().fileName.startsWith(destination + path.sep)), symbolName).toBe(true);
      }
    }
    expect(req("@legendapp/spark/config").readConfig).toBeTypeOf("function");
    expect(req("@legendapp/spark/metro").withDesktop).toBeTypeOf("function");
    expect(req("@legendapp/spark/native").withSparkNative).toBeTypeOf("function");
    expect(req("@legendapp/spark/init-template").initializeTemplate).toBeTypeOf("function");
    expect(req("@legendapp/spark/schema.json")).toEqual(JSON.parse(readFileSync(path.join(framework, "packages/config-plugin/schema.json"), "utf8")));
    const graph = installedPackages(app);
    expect(graph.filter(pkg => pkg.name.startsWith("@legendapp/spark-")).map(pkg => pkg.name).sort()).toEqual(internal.map(pkg => pkg.name).sort());
    const native = nativePackages(app);
    const menus = native.find(pkg => pkg.name === "@legendapp/spark-native-menu")!;
    expect(menus.root.startsWith(realpathSync(destination) + "/vendor/node_modules/")).toBe(true);
    expect(menus.json.codegenConfig).toBeDefined();
    const selected = selection(native, new Set([menus.name]));
    expect(selected.included.map(pkg => pkg.name)).toContain(menus.name);
    expect(selected.excluded.map(pkg => pkg.name)).toContain("@legendapp/spark-file-system");
    writeFileSync(path.join(app, "package.json"), JSON.stringify({ dependencies: {
      "@legendapp/spark": VERSION, "react-native-vision-camera": "5.2.3", "react-native-nitro-image": "0.15.2",
    } }));
    writeFileSync(path.join(app, "desktop.config.json"), JSON.stringify({ name: "Packed", version: "1.0.0", projectId: "packed-test", platforms: ["windows"] }));
    expect(() => nativePackages(app)).toThrow("react-native-nitro-image has no Windows implementation");
    writeFileSync(path.join(app, "package.json"), JSON.stringify({ dependencies: { "@legendapp/spark": VERSION } }));
    const windows = nativePackages(app);
    expect(windows.map(pkg => pkg.name)).not.toContain("react-native-vision-camera");
    expect(windows.map(pkg => pkg.name)).not.toContain("react-native-nitro-image");
    const selectionFile = stateFile(app, "native-selection.json");
    mkdirSync(path.dirname(selectionFile), { recursive: true });
    writeFileSync(selectionFile, JSON.stringify({ included: windows.map(pkg => ({ name: pkg.name, root: pkg.root })), excluded: [] }));
    const config = req("@legendapp/spark/native").nativeConfig(app);
    expect(config.dependencies[menus.name].root).toBe(menus.root);
    for (const template of ["blank-typescript", "windows", "universal"]) {
      const pkg = JSON.parse(readFileSync(path.join(destination, "vendor/node_modules/@legendapp/spark-cli/templates", template, "package.json"), "utf8"));
      expect(Object.keys(pkg.dependencies).filter(name => name.startsWith("@legendapp/spark"))).toEqual(["@legendapp/spark"]);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 120_000);


test("Create Spark archive is peer-free and runs without installing the framework", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-create-package-"));
  try {
    const release = { schema: 1 as const, version: VERSION, revision: "a".repeat(40), packages: {}, runners: {} };
    const file = await packCreateSpark(framework, root, release);
    const destination = path.join(root, "package");
    mkdirSync(destination);
    const tar = spawnProcess(["tar", "-xzf", path.join(root, file), "--strip-components=1", "-C", destination]);
    expect(await tar.exited).toBe(0);
    const manifest = JSON.parse(readFileSync(path.join(destination, "package.json"), "utf8"));
    expect(/\/(?:Users|home)\//.test(readFileSync(path.join(destination, manifest.bin["create-spark"]), "utf8"))).toBe(false);
    expect(existsSync(path.join(destination, "README.md"))).toBe(true);
    expect(existsSync(path.join(destination, "LICENSE"))).toBe(true);
    expect(manifest.name).toBe("@legendapp/create-spark");
    expect(manifest.version).toBe(VERSION);
    expect(manifest.private).toBeUndefined();
    expect(manifest.publishConfig).toEqual({ access: "public", tag: "next" });
    expect(manifest.bin).toEqual({ "create-spark": "dist/index.js" });
    expect(manifest.files).toEqual(["dist", "templates"]);
    expect(manifest.peerDependencies).toBeUndefined();
    expect(Object.keys(manifest.dependencies).sort()).toEqual(["cross-spawn", "expo-desktop", "npm", "yaml"]);
    for (const name of ["react", "react-dom", "react-native", "react-native-macos", "expo", "@legendapp/spark"]) {
      expect(manifest.dependencies).not.toHaveProperty(name);
      expect(manifest.optionalDependencies ?? {}).not.toHaveProperty(name);
      expect(manifest.peerDependencies ?? {}).not.toHaveProperty(name);
    }
    expect(JSON.parse(readFileSync(path.join(destination, "dist/release.json"), "utf8"))).toEqual(release);
    const tooling = createRequire(path.join(framework, "packages/cli/package.json"));
    // Supply just cross-spawn for this isolated launcher check; npm e2e installs the full tooling graph.
    cpSync(path.dirname(tooling.resolve("cross-spawn/package.json")), path.join(destination, "node_modules/cross-spawn"), { recursive: true });
    for (const name of ["path-key", "shebang-command", "shebang-regex", "which", "isexe", "yaml"]) {
      cpSync(path.dirname(tooling.resolve(`${name}/package.json`)), path.join(destination, "node_modules", name), { recursive: true });
    }
    const help = spawnProcess(["node", path.join(destination, manifest.bin["create-spark"]), "--help"], { cwd: root });
    const [out, err, code] = await Promise.all([new Response(help.stdout).text(), new Response(help.stderr).text(), help.exited]);
    expect(code, err).toBe(0);
    expect(out).toContain("npm create @legendapp/spark@next MyApp");
    for (const platform of ["ios", "android", "web"]) {
      const app = path.join(root, `App${platform}`);
      const create = spawnProcess(["node", path.join(destination, manifest.bin["create-spark"]), app, "--platform", platform], { cwd: root });
      const [stderr, status] = await Promise.all([new Response(create.stderr).text(), create.exited]);
      expect(status).toBe(1);
      expect(stderr).toContain(`Use npm create @legendapp/spark@next ${app} -- --universal for mobile/web targets`);
      expect(existsSync(app)).toBe(false);
    }
    // Expose the bundle's internals only in the extracted test copy.
    const bundle = path.join(destination, manifest.bin["create-spark"]);
    const versionBinding = readFileSync(bundle, "utf8").match(/var (\w+) = readJson\(.*package\.json.*\)\.version/)!;
    expect(versionBinding).not.toBeNull();
    appendFileSync(bundle, `\nexport { installedRelease, ${versionBinding[1]} as VERSION };\n`);
    const version = "0.0.1-next.999";
    writeFileSync(path.join(destination, "package.json"), JSON.stringify({ ...manifest, version }));
    writeFileSync(path.join(destination, "dist/release.json"), JSON.stringify({ ...release, version }));
    const probe = spawnProcess(["node", "--input-type=module", "-e", `
      process.argv = [process.execPath, "probe", "--help"];
      const { installedRelease, VERSION } = await import(${JSON.stringify(bundle)});
      console.log(JSON.stringify({ version: VERSION, release: installedRelease() }));
    `], { cwd: root });
    const [probeOut, probeErr, probeCode] = await Promise.all([new Response(probe.stdout).text(), new Response(probe.stderr).text(), probe.exited]);
    expect(probeCode, probeErr).toBe(0);
    expect(JSON.parse(probeOut.trim().split("\n").at(-1)!)).toEqual({ version, release: { ...release, version } });

    for (const variant of ["blank-typescript", "windows", "universal"]) {
      expect(existsSync(path.join(destination, "templates", variant, "README.md"))).toBe(true);
      const template = JSON.parse(readFileSync(path.join(destination, "templates", variant, "package.json"), "utf8"));
      expect(template.dependencies).toMatchObject({ "@legendapp/spark": VERSION, react: "19.2.0", "react-native": "0.83.10", expo: "55.0.32" });
      expect(template.overrides).toMatchObject({ react: "19.2.0", "react-native": "0.83.10", "react-native-macos": "0.83.0" });
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 120_000);
