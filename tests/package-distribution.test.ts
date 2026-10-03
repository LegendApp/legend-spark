import { VERSION } from "../packages/cli/src/project.ts";
import { spawnProcess } from "../packages/cli/src/process.ts";
import { expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
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
    writeFileSync(path.join(reactStub, "index.d.ts"), `export type ReactNode = any; export type ComponentType<P = any> = (props: P) => any; export type PropsWithChildren<P = unknown> = P & { children?: ReactNode }; export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void; export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void; export function useRef<T>(value: T): { current: T }; export function useState<T>(value: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void]; export interface Context<T> { Provider: any; __value?: T } export function createContext<T>(value: T): Context<T>; export function useContext<T>(context: Context<T>): T;`);
    mkdirSync(path.join(reactStub, "jsx-runtime"), { recursive: true });
    writeFileSync(path.join(reactStub, "jsx-runtime/index.d.ts"), `export const Fragment: any; export function jsx(...args: any[]): any; export function jsxs(...args: any[]): any;`);
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
    writeFileSync(path.join(app, "package.json"), JSON.stringify({ dependencies: { "@legendapp/spark": VERSION } }));
    writeFileSync(path.join(app, "desktop.config.json"), JSON.stringify({ name: "Packed", version: "1.0.0", projectId: "packed-test", macos: { bundleIdentifier: "org.example.packed" }, platforms: ["macos"] }));
    const req = createRequire(path.join(app, "package.json"));
    const manifest = req("@legendapp/spark/package.json");
    expect(manifest.repository).toEqual({ type: "git", url: "https://github.com/LegendApp/legend-spark.git", directory: "packages/desktop" });
    expect(manifest.homepage).toBe("https://github.com/LegendApp/legend-spark#readme");
    expect(manifest.bugs.url).toBe("https://github.com/LegendApp/legend-spark/issues");
    expect(manifest.keywords).toEqual(expect.arrayContaining(["react-native", "expo", "desktop", "macos", "windows"]));
    expect(manifest.license).toBe("MIT");
    expect(readFileSync(path.join(destination, "LICENSE"), "utf8")).toBe(readFileSync(path.join(framework, "LICENSE"), "utf8"));
    expect(readFileSync(path.join(framework, "LICENSE"), "utf8")).toContain("Copyright (c) 2026 LegendApp");
    const Module = createRequire(import.meta.url)("node:module") as any;
    const originalLoad = Module._load;
    let generatedInfo: Record<string, unknown> | undefined;
    Module._load = function (request: string, parent: unknown, isMain: boolean) {
      if (request === "expo-desktop-config-plugins") return {
        withEntitlementsPlist: (config: unknown) => config,
        withAppDelegate: (config: unknown) => config,
        withInfoPlist: (config: unknown, action: (mod: { modRequest: { projectRoot: string }; modResults: Record<string, unknown> }) => { modResults: Record<string, unknown> }) => {
          generatedInfo = action({ modRequest: { projectRoot: app }, modResults: {} }).modResults;
          return config;
        },
        withPodfile: (config: unknown) => config,
      };
      return originalLoad.call(this, request, parent, isMain);
    };
    try {
      req("@legendapp/spark/config-plugin")({ macos: { bundleIdentifier: "org.example.packed" }, extra: { spark: { projectId: "packed-test" } } });
    } finally { Module._load = originalLoad; }
    expect(generatedInfo?.SparkFrameworkVersion).toBe(manifest.version);
    const singletonPeers = ["expo", "react", "react-native", "react-dom"];
    for (const name of singletonPeers) expect(manifest.dependencies).not.toHaveProperty(name);
    expect(manifest.peerDependencies).toMatchObject({ expo: "54.0.37", react: "19.1.4", "react-native": "0.81.6", "react-dom": "19.1.4" });
    expect(manifest.peerDependenciesMeta["react-dom"]).toEqual({ optional: true });
    expect(manifest.dependencies["@react-native-runtimes/core"]).toBe("0.1.0-alpha.2");
    expect(manifest.dependencies["react-native-nitro-modules"]).toBe("0.35.7");
    expect(JSON.parse(readFileSync(path.join(destination, "vendor/node_modules/@legendapp/spark-cli/dist/release.json"), "utf8"))).toEqual(release);
    const internal = readdirSync(path.join(framework, "packages")).map(name => JSON.parse(readFileSync(path.join(framework, "packages", name, "package.json"), "utf8"))).filter(pkg => pkg.name !== "@legendapp/spark");
    const normalized = await createRequire(tooling.resolve("npm/package.json"))("pacote").manifest(path.join(root, file), { cache: path.join(root, "registry-cache") });
    expect(normalized.bundleDependencies).toBeUndefined();
    expect(normalized.bundledDependencies).toBeUndefined();
    expect(Object.keys(normalized.dependencies).some(name => name.startsWith("@legendapp/spark-"))).toBe(false);
    for (const name of singletonPeers) expect(normalized.dependencies).not.toHaveProperty(name);
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
    writeFileSync(path.join(app, "desktop.config.json"), JSON.stringify({ name: "Packed", version: "1.0.0", projectId: "packed-test", platforms: ["windows"] }));
    const windows = nativePackages(app);
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
