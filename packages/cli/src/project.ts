import { nativeWindowOptions } from "@legendapp/spark-window-options";
import { macOSReleaseSettings } from "./macos-release.ts";
import { projectPlatform, architecture, type DesktopPlatform } from "./platform.ts";
import { resolveHelpers } from "./helpers.ts";
import { readConfig as readAppConfig, prepareConfig, writeUpdates, statePath, isUniversal, isExpoProject } from "@legendapp/spark-desktop-config/config.cjs";
export { readAppConfig, prepareConfig, writeUpdates, statePath, isUniversal };
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import path from "node:path";

export const VERSION = "0.0.1-next.2";
export type Package = { name: string; root: string; json: any };
export type NativePackage = Package & {
  signature: string;
  sdk: boolean;
  requires: string[];
};
export type Runtime = {
  sourceRevision?: string;
  schema: 1;
  framework: string;
  platform: DesktopPlatform;
  arch: "arm64" | "x64";
  mode: string;
  fingerprint: string;
  modules: Record<string, string>;
};
export function readJson(file: string): any {
  return JSON.parse(readFileSync(file, "utf8"));
}
export function writeJson(file: string, value: unknown) {
  const content = JSON.stringify(value, null, 2) + "\n";
  // Metro watches JSON too: rewriting unchanged session state on every runtime
  // check causes empty Fast Refresh updates even when app code has not changed.
  if (existsSync(file) && readFileSync(file, "utf8") === content) return;
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, content);
  renameSync(temporary, file);
}
export function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function stateFile(root: string, name: string) {
  return statePath(root, name);
}
export function entryFile(root: string) {
  if (isExpoProject(root)) {
    const appRequire = createRequire(path.join(root, "package.json"));
    const expoRequire = createRequire(appRequire.resolve("expo/package.json"));
    return path.relative(root, expoRequire("@expo/config/paths").resolveEntryPoint(root, { platform: projectPlatform(root) }));
  }
  return readJson(path.join(root, "package.json")).main ?? "index.ts";
}
export function installedPackages(root: string): Package[] {
  const found = new Map<string, Package>();
  const queue = [
    { root, json: readJson(path.join(root, "package.json")), app: true },
  ];
  const visited = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    const req = createRequire(path.join(current.root, current.json.spark?.bundledModuleRoot ?? ".", "package.json"));
    const bundled = current.json.spark?.bundledModules ?? current.json.bundledDependencies ?? current.json.bundleDependencies;
    const names = Object.keys({
      ...Object.fromEntries((Array.isArray(bundled) ? bundled : []).map(name => [name, true])),
      ...current.json.dependencies,
      ...(current.app ? current.json.devDependencies : {}),
      // Optional peers do not require a native module. If an application uses
      // one, its own dependency edge includes it. Resolving optional peers here
      // can accidentally pull native modules from a parent workspace.
      ...Object.fromEntries(Object.entries(current.json.peerDependencies ?? {})
        .filter(([name]) => !current.json.peerDependenciesMeta?.[name]?.optional)),
    }).sort();
    for (const name of names) {
      let file: string;
      try {
        file = req.resolve(`${name}/package.json`);
      } catch {
        // Packages with exports hiding package.json still have an owning directory.
        try {
          // Subpath-only packages (e.g. @legendapp/list/react-native) may
          // expose neither package.json nor a root entry. Inspect Node's
          // package search locations without requiring a public root export.
          const manifest = req.resolve.paths(name)?.map(base => path.join(base, name, "package.json"))
            .find(candidate => existsSync(candidate));
          if (manifest) file = manifest;
          else {
            let dir = path.dirname(req.resolve(name));
            while ((!existsSync(path.join(dir, "package.json")) || typeof readJson(path.join(dir, "package.json")).name !== "string") && dir !== path.dirname(dir))
              dir = path.dirname(dir);
            file = path.join(dir, "package.json");
          }
        } catch {
          if (
            current.app &&
            (current.json.dependencies?.[name] ||
              current.json.devDependencies?.[name])
          )
            throw new Error(
              `Dependency ${name} is not installed yet. Finish the package installation, then retry.`,
            );
          continue;
        }
      }
      const dir = realpathSync(path.dirname(file));
      if (visited.has(dir)) continue;
      visited.add(dir);
      const json = readJson(file);
      const prior = found.get(json.name);
      if (
        prior &&
        prior.json.version !== json.version &&
        (json.codegenConfig ||
          json.spark ||
          existsSync(path.join(dir, "expo-module.config.json")))
      ) {
        throw new Error(
          `Conflicting native versions for ${json.name}: ${prior.json.version} and ${json.version}`,
        );
      }
      found.set(json.name, { name: json.name, root: dir, json });
      queue.push({ root: dir, json, app: false });
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function hashFiles(root: string, entries: string[], windows = false): string {
  const hash = createHash("sha256");
  function visit(relative: string) {
    const file = path.join(root, relative);
    if (!existsSync(file)) return;
    try {
      const children = readdirSync(file, { withFileTypes: true });
      for (const child of children.sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (
          ["node_modules", "build", ".git", "Pods"].includes(child.name) || child.isSymbolicLink() ||
          (windows && (["Generated Files", "codegen", "obj", "x64", "ARM64", "Debug", "Release", ".vs", "packages", "packages.lock.json"].includes(child.name) || child.name.endsWith(".vcxproj.user") || child.name.startsWith("AutolinkedNativeModules.g.")))
        )
          continue;
        visit(path.join(relative, child.name));
      }
    } catch (error: any) {
      if (error.code !== "ENOTDIR") throw error;
      hash.update(relative.split(path.sep).join("/")).update(readFileSync(file));
    }
  }
  for (const entry of entries.sort()) visit(entry);
  return hash.digest("hex");
}
export function nativePackages(root: string): NativePackage[] {
  const installed = installedPackages(root);
  if (projectPlatform(root) === "windows") return windowsNativePackages(root, installed);
  // Host/CNG code can change the native ABI without adding a TurboModule.
  // Fold it into the mandatory app module's compatibility signature for Go.
  const adapters = installed.filter(pkg => ["@legendapp/spark-desktop-host", "@legendapp/spark-desktop-config"].includes(pkg.name))
    .map(pkg => hashFiles(pkg.root, ["package.json", "AppDelegate.mm", ...readdirSync(pkg.root).filter(name => name.endsWith(".cjs"))])).join(":");
  const excluded = ["app.json", "desktop.config.json"].some(file => existsSync(path.join(root, file)))
    ? readAppConfig(root).expo?.autolinking?.exclude ?? [] : [];
  return installed.filter(pkg => !excluded.includes(pkg.name))
    .filter(
      (pkg) =>
        pkg.json.codegenConfig ||
        pkg.json.spark?.nativeModules ||
        readdirSync(pkg.root).some(
          (name) =>
            name.endsWith(".podspec") || name === "expo-module.config.json",
        ),
    )
    .map((pkg) => ({
      ...pkg,
      sdk: pkg.json.spark?.sdk === true || ["@react-native-async-storage/async-storage", "react-native-webview", "@op-engineering/op-sqlite", "@react-native-runtimes/core", "react-native-nitro-modules"].includes(pkg.name),
      requires: pkg.json.spark?.requires ?? [],
      signature: (signature => pkg.name === "@legendapp/spark-desktop-app" ? digest(signature + adapters) : signature)(hashFiles(pkg.root, [
        "package.json",
        "ios",
        "macos",
        "apple",
        "cpp",
        "src",
        "common", "nitrogen/generated", "nitro.json",
        "expo-module.config.json",
        "react-native.config.js",
        ...readdirSync(pkg.root).filter((name) => name.endsWith(".podspec")),
      ])),
    }));
}
export function dependencyStamp(root: string) {
  return hashFiles(root, [
    "package.json",
    "bun.lock",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "app.json",
    "desktop.config.json",
    "app.config.js",
    "app.config.ts",
    "metro.config.js",
    "react-native.config.js",
  ]);
}
export function selection(
  packages: NativePackage[],
  used: Set<string>,
  include: string[] = [],
) {
  const selected = new Set([
    ...packages.filter((p) => !p.sdk).map((p) => p.name),
    ...used,
    ...include,
  ]);
  const reasons: Record<string, string> = {};
  for (const pkg of packages)
    if (selected.has(pkg.name))
      reasons[pkg.name] = include.includes(pkg.name)
        ? "explicit include"
        : pkg.sdk
          ? "reachable production import"
          : "conservative native dependency";
  let changed = true;
  while (changed) {
    changed = false;
    for (const pkg of packages.filter((p) => selected.has(p.name))) {
      const nativeDeps = [
        ...pkg.requires,
        ...Object.keys({
          ...pkg.json.dependencies,
          ...Object.fromEntries(Object.entries(pkg.json.peerDependencies ?? {}).filter(([name]) => !pkg.json.peerDependenciesMeta?.[name]?.optional)),
        }).filter((n) => packages.some((p) => p.name === n)),
      ];
      for (const name of nativeDeps) {
        if (!packages.some((p) => p.name === name))
          throw new Error(
            `${pkg.name} requires missing native package ${name}`,
          );
        if (!selected.has(name)) {
          selected.add(name);
          reasons[name] = `native dependency of ${pkg.name}`;
          changed = true;
        }
      }
    }
  }
  for (const name of include)
    if (!packages.some((p) => p.name === name))
      throw new Error(`Explicit native include is not installed: ${name}`);
  return {
    included: packages.filter((p) => selected.has(p.name)),
    excluded: packages.filter((p) => !selected.has(p.name)),
    reasons,
  };
}
export function hostSourceSignature(root: string) {
  return digest(JSON.stringify(installedPackages(root)
    .filter(pkg => ["@legendapp/spark-desktop-host", "@legendapp/spark-desktop-config"].includes(pkg.name))
    .map(pkg => [pkg.name, hashFiles(pkg.root, ["package.json", "AppDelegate.mm", "windows", ...readdirSync(pkg.root).filter(file => file.endsWith(".cjs"))])])));
}
export function localSigningIdentity(root: string, mode: string): string {
  if (mode !== "dev") return "-";
  const file = stateFile(root, "settings.json");
  const identity = existsSync(file) ? readJson(file).macOSDevelopmentIdentity : undefined;
  if (identity === undefined) return "-";
  if (typeof identity !== "string" || !identity.trim() || identity.startsWith("-"))
    throw new Error("macOSDevelopmentIdentity must name a signing certificate or its SHA-1 fingerprint");
  return identity;
}
export function runtimeFor(
  root: string,
  packages: NativePackage[],
  mode: string,
): Runtime {
  const platform = projectPlatform(root);
  const modules = Object.fromEntries(
    packages.map((p) => [p.name, p.signature]),
  );
  const pins = installedPackages(root)
    .filter((p) =>
      [
        "react",
        "react-native",
        "react-native-macos",
        "react-native-windows",
        "expo",
        "@legendapp/spark-desktop-host",
        "@legendapp/spark-desktop-config",
      ].includes(p.name),
    )
    .map((p) => [p.name, p.json.version]);
  return {
    schema: 1,
    framework: VERSION,
    platform,
    arch: architecture(platform),
    mode,
    modules,
    fingerprint: digest(
      JSON.stringify({
        arch: architecture(platform),
        // Rebuild cached hosts generated before canonical plist restoration.
        ...(platform === "macos" ? { nativeMetadataVersion: 1 } : {}),
        ...(platform === "macos" && mode === "dev" ? { developmentIdentity: localSigningIdentity(root, mode) } : {}),
        ...(platform === "macos" && mode === "release" ? { releaseSettings: macOSReleaseSettings } : {}),
        modules,
        pins,
        config: readAppConfig(root),
        helpers: resolveHelpers(root, readAppConfig(root).expo?.extra?.spark?.helpers, platform).map(helper => ({ name: helper.name, contents: hashFiles(root, helper.files), modes: helper.modes, directories: helper.directories })),
        adapter: hostSourceSignature(root),
      }),
    ),
  };
}
export function incompatible(
  runtime: Runtime,
  required: NativePackage[],
  platform: DesktopPlatform = "macos",
): string[] {
  if (
    runtime.schema !== 1 ||
    runtime.framework !== VERSION ||
    runtime.arch !== architecture(platform) ||
    runtime.platform !== platform
  )
    return ["framework runtime version/platform mismatch"];
  return required
    .filter((pkg) => runtime.modules[pkg.name] !== pkg.signature)
    .map((pkg) => pkg.name);
}

export function goConfigurationIssues(config: any): string[] {
  const expo = config.expo ?? config;
  const issues: string[] = [];
  if (expo.scheme || expo.extra?.spark?.documentTypes?.length)
    issues.push("URL schemes and document associations require a custom runtime");
  if (expo.extra?.spark?.menuBarOnly) issues.push("Menu-bar-only activation requires a custom runtime");
  if (expo.extra?.spark?.updates) issues.push("Update feed configuration requires a custom runtime");
  if (Object.keys(expo.extra?.spark?.helpers ?? {}).length) issues.push("Bundled helpers require a custom runtime");
  if (expo.extra?.spark?.customRuntime)
    issues.push("app configuration requires a custom runtime");
  if (
    (expo.plugins ?? []).some(
      (plugin: any) =>
        !["@legendapp/spark-desktop-config", "@legendapp/spark/config-plugin"].includes(Array.isArray(plugin) ? plugin[0] : plugin),
    )
  )
    issues.push("additional configuration plugins require a custom runtime");
  if (
    Object.keys(expo.macos ?? {}).some(
      (key) => !["bundleIdentifier", "infoPlist"].includes(key),
    )
  )
    issues.push("macOS native configuration requires a custom runtime");
  if (
    Object.keys(expo.macos?.infoPlist ?? {}).some(
      (key) => key !== "CFBundleName",
    )
  )
    issues.push(
      "app-specific Info.plist configuration requires a custom runtime",
    );
  return issues;
}

export function validateBuildModules(mode: string, packages: NativePackage[]) {
  if (mode === "go" && packages.some(pkg => pkg.name === "@legendapp/spark-native-greeting" || pkg.json.spark?.testOnly))
    throw new Error("Build the Spark Runner from the clean SDK starter, not a custom-module test fixture.");
  if (mode === "release" && packages.some(pkg => pkg.json.spark?.testOnly))
    throw new Error("Test-only native modules cannot be included in distribution builds.");
}

export function projectEnvironment(root: string): Record<string, string> {
  const file = path.join(root, "app.json");
  // Explicit `spark open /path/App.app` also works outside a project.
  if (!existsSync(file) && !existsSync(path.join(root, "desktop.config.json"))) return {};
  const config = readAppConfig(root).expo ?? {};
  const projectId = config.extra?.spark?.projectId ?? config.macos?.bundleIdentifier;
  if (typeof projectId !== "string" || !projectId.length || projectId.length > 200)
    throw new Error("Set extra.spark.projectId to a stable project identifier before launching the Spark Runner.");
  return {
    SPARK_WINDOW_CONFIG: JSON.stringify(nativeWindowOptions(config.extra?.spark?.window ?? {})),
    SPARK_PROJECT_ID: projectId,
    SPARK_PROJECT_NAME: typeof config.name === "string" ? config.name : path.basename(root),
    SPARK_PROJECT_VERSION: typeof config.version === "string" ? config.version : "0.0.0",
  };
}

function windowsNativePackages(root: string, installed: Package[]): NativePackage[] {
  const direct = readJson(path.join(root, "package.json")).dependencies ?? {};
  const supported = (pkg: Package) => pkg.name !== "expo-desktop-template-bare-minimum" && (existsSync(path.join(pkg.root, "windows")) ||
    ["react-native", "react-native-windows", "@legendapp/spark-desktop-host", "@legendapp/spark-desktop-app", "@legendapp/spark-desktop-windows", "@legendapp/spark-desktop-shortcuts", "@legendapp/spark-native-menu", "@legendapp/spark-updates"].includes(pkg.name));
  const explicitlyExcluded = isUniversal(root) ? readAppConfig(root).expo?.autolinking?.exclude ?? [] : [];
  for (const pkg of installed) {
    const platformAdapter = isUniversal(root) && ["src/index.windows.ts", "src/index.windows.tsx"].some(file => existsSync(path.join(pkg.root, file)));
    if (!platformAdapter && !explicitlyExcluded.includes(pkg.name) && direct[pkg.name] && pkg.name !== "expo" && !supported(pkg) && (pkg.json.codegenConfig || pkg.json.spark?.nativeModules || readdirSync(pkg.root).some(name => name.endsWith(".podspec") || name === "expo-module.config.json"))) {
      throw new Error(`${pkg.name} has no Windows implementation. Remove it from this Windows development app until it is ported.`);
    }
  }
  const adapter = installed.filter(pkg => ["@legendapp/spark-desktop-host", "@legendapp/spark-desktop-config"].includes(pkg.name))
    .map(pkg => hashFiles(pkg.root, ["package.json", "windows", ...readdirSync(pkg.root).filter(name => name.endsWith(".cjs"))], true)).join(":");
  const versions = installed.filter(pkg => ["react", "expo", "react-native", "react-native-windows"].includes(pkg.name)).map(pkg => [pkg.name, pkg.json.version]);
  return installed.filter(supported).map(pkg => ({ ...pkg,
    sdk: pkg.json.spark?.sdk === true || pkg.name === "@react-native-async-storage/async-storage", requires: pkg.json.spark?.requires ?? [],
    signature: digest(hashFiles(pkg.root, ["package.json", "windows", "src", "cpp", "common", "react-native.config.js"], true) + (pkg.name === "@legendapp/spark-desktop-host" ? adapter + JSON.stringify(versions) : "")),
  }));
}
