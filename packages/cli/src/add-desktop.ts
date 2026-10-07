import { installedRelease, materializeReleasePackages, packageSources, verifyMaterializedReleasePackages } from "./release.ts";
import { packageManager, managerCommand, localArchive } from "./package-manager.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { run } from "./commands.ts";
import { readJson, writeJson } from "./project.ts";

export const integrationMarker = "// spark: existing Expo project";

/** Wrap an existing export without reprinting or moving the application's code. */
export function composeExport(source: string, file: string, module: string, fn: string, root = true) {
  if (source.includes(integrationMarker)) return source;
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const exported = parsed.statements.find(ts.isExportAssignment);
  const wrap = (expression: string) => `require(${JSON.stringify(module)}).${fn}(${expression}${root ? ", __dirname" : ""})`;
  if (exported && !exported.isExportEquals) {
    const expression = exported.expression;
    return source.slice(0, expression.getStart(parsed)) + wrap(expression.getText(parsed)) + source.slice(expression.end) + `\n${integrationMarker}\n`;
  }
  let commonJS = false;
  function visit(node: ts.Node) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.left.getText(parsed) === "module.exports") commonJS = true;
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  if (!commonJS) throw new Error(`Cannot safely compose ${file}: use module.exports or an export default expression. No files were changed.`);
  return `${source}\n${integrationMarker}\nmodule.exports = ${wrap("module.exports")};\n`;
}

export function composeMetro(source: string, file: string) {
  if (source.includes(integrationMarker)) return source;
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const replacements: { start: number; end: number }[] = [];
  function visit(node: ts.Node) {
    if (ts.isStringLiteral(node) && ["expo/metro-config", "@expo/metro-config"].includes(node.text)) replacements.push({ start: node.getStart(parsed), end: node.end });
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  if (!replacements.length) throw new Error(`Cannot safely compose ${file}: use Expo's getDefaultConfig before adding desktop support. No files were changed.`);
  for (const { start, end } of replacements.sort((a, b) => b.start - a.start)) source = source.slice(0, start) + '"@legendapp/spark/metro"' + source.slice(end);
  return composeExport(source, file, "@legendapp/spark/metro", "withSparkMetro", false);
}

export async function addDesktop(root: string, manifestFile: string | undefined) {
  const pkgFile = path.join(root, "package.json");
  if (!existsSync(pkgFile)) throw new Error("Run add desktop in an installed Expo app, or pass --project.");
  const pkg = readJson(pkgFile);
  if (pkg.type === "module") throw new Error("ES module package configurations need explicit composition; automatic add desktop currently supports Expo's CommonJS project layout. No files were changed.");
  const manager = packageManager(root);
  const release = manifestFile ? undefined : installedRelease();
  const req = createRequire(pkgFile);
  const installed = (name: string) => readJson(req.resolve(`${name}/package.json`)).version;
  // Never upgrade the mobile baseline as a side effect of adding desktop.
  for (const [name, version] of Object.entries({ expo: "54.0.37", "react-native": "0.81.6", react: "19.1.4" })) {
    let actual: string;
    try { actual = installed(name); } catch { throw new Error(`Install the app's dependencies first; ${name} is missing.`); }
    if (actual !== version) throw new Error(`The tested Expo Desktop beta needs ${name}@${version}; this app has ${actual}. Align the app's baseline separately, then retry. No files were changed.`);
  }
  const desktopFile = path.join(root, "desktop.config.json");
  if (existsSync(desktopFile)) {
    if (readJson(desktopFile).extends !== "expo") throw new Error("This app already uses spark-owned configuration; add desktop is for existing Expo projects.");
    if (release) {
      const sources = packageSources(undefined, release);
      const replacement = new Map(Object.entries(release.packages).map(([name, asset]) => [asset.url, sources[name]!]));
      const portableSources = new Set(replacement.values());
      let changed = false, needsVerify = false;
      function secureDependencies(value: unknown): unknown {
        if (typeof value === "string") {
          const portable = replacement.get(value);
          if (portable) { changed = true; needsVerify = true; return portable; }
          if (portableSources.has(value)) needsVerify = true;
          return value;
        }
        if (Array.isArray(value)) return value.map(secureDependencies);
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secureDependencies(item)]));
        return value;
      }
      for (const field of ["dependencies", "devDependencies", "optionalDependencies", "overrides", "resolutions", "pnpm"]) if (pkg[field]) pkg[field] = secureDependencies(pkg[field]);
      if (needsVerify) {
        await materializeReleasePackages(release, root);
        verifyMaterializedReleasePackages(release, root);
        if (changed) writeJson(pkgFile, pkg);
        const ignoreFile = path.join(root, ".gitignore");
        const ignore = existsSync(ignoreFile) ? readFileSync(ignoreFile, "utf8") : "";
        if (!ignore.includes("!/spark-packages/**")) writeFileSync(ignoreFile, `${ignore}${ignore.endsWith("\n") || !ignore ? "" : "\n"}\n# Spark verified release package inputs\n!/spark-packages/\n!/spark-packages/**\n`);
      }
    }
    await run(root, managerCommand(manager, ["install"]));
    console.log("Desktop integration already exists; dependencies installed. Existing configuration preserved.");
    return;
  }
  for (const file of ["macos", "windows"]) if (existsSync(path.join(root, file))) throw new Error(`Existing ${file} project needs explicit host composition before adopting spark. No files were changed.`);
  const expoRequire = createRequire(req.resolve("expo/package.json"));
  const { getConfig } = expoRequire("@expo/config");
  const base = getConfig(root, { skipPlugins: true }).exp;
  if (base.newArchEnabled === false) throw new Error("spark's desktop host requires the New Architecture. Align that setting before adding desktop.");
  const files = new Map<string, string>();
  const configNames = ["app.config.ts", "app.config.js"].filter(file => existsSync(path.join(root, file)));
  if (configNames.length > 1) throw new Error("Keep one dynamic Expo configuration file before adding desktop.");
  const configFile = configNames[0] ?? "app.config.js";
  const configSource = configNames.length ? readFileSync(path.join(root, configFile), "utf8") : "module.exports = ({ config }) => config;\n";
  files.set(configFile, composeExport(configSource, configFile, "@legendapp/spark/expo-config", "withSparkExpo"));
  for (const file of ["metro.config.ts", "metro.config.mjs", "metro.config.cjs", "react-native.config.ts", "react-native.config.cjs"]) {
    if (existsSync(path.join(root, file))) throw new Error(`Compose ${file} explicitly; automatic integration currently supports metro.config.js and react-native.config.js. No files were changed.`);
  }
  const metro = "metro.config.js";
  files.set(metro, composeMetro(existsSync(path.join(root, metro)) ? readFileSync(path.join(root, metro), "utf8") : 'const { getDefaultConfig } = require("expo/metro-config");\nmodule.exports = getDefaultConfig(__dirname);\n', metro));
  const native = "react-native.config.js";
  files.set(native, composeExport(existsSync(path.join(root, native)) ? readFileSync(path.join(root, native), "utf8") : "module.exports = {};\n", native, "@legendapp/spark/native", "withSparkNative"));

  const template = path.resolve(import.meta.dirname, "../templates/universal");
  const defaults = readJson(path.join(template, "package.json"));
  const archives = packageSources(manifestFile, release);
  const local = ["@legendapp/spark"];
  const dependencies: Record<string, string> = {};
  for (const name of local) {
    if (!archives[name]) throw new Error(`SDK is missing ${name}; run spark sdk pack first.`);
    dependencies[name] = archives[name]!;
  }
  for (const [name, version] of Object.entries(defaults.dependencies)) {
    if (name.startsWith("expo-desktop") || ["react-native-macos", "react-native-windows", "@react-native-community/cli"].includes(name)) dependencies[name] = version as string;
  }
  pkg.dependencies ??= {};
  for (const [name, version] of Object.entries(dependencies)) {
    const previous = pkg.dependencies[name] ?? pkg.devDependencies?.[name];
    if (previous && previous !== version) throw new Error(`Existing ${name} dependency conflicts with the tested desktop version. Resolve it explicitly before retrying. No files were changed.`);
    if (!previous) pkg.dependencies[name] = version;
  }
  // Resolve local transitive SDK packages without replacing any mobile pins.
  const vendor = ["@react-native-runtimes/core", "react-native-nitro-modules", "@op-engineering/op-sqlite", "react-native-webview"];
  const overrides: Record<string, string> = { ...Object.fromEntries(local.map(name => [name, dependencies[name]!])), "@expo/cli": "54.0.27",
    "react-native-macos": defaults.overrides["react-native-macos"], "react-native-windows": defaults.overrides["react-native-windows"] };
  for (const name of vendor) {
    if (archives[name]) {
      overrides[name] = archives[name]!;
    }
  }
  const overrideField = manager === "yarn" ? "resolutions" : "overrides";
  const owner = manager === "pnpm" ? (pkg.pnpm ??= {}) : pkg;
  for (const [name, version] of Object.entries(overrides)) if (owner[overrideField]?.[name] && owner[overrideField][name] !== version) throw new Error(`Existing ${name} override conflicts with the local SDK. No files were changed.`);
  owner[overrideField] = { ...owner[overrideField], ...overrides };
  pkg.scripts ??= {};
  for (const platform of ["macos", "windows"]) {
    const name = pkg.scripts[platform] ? `spark:${platform}` : platform;
    const command = `spark dev --platform ${platform}`;
    if (pkg.scripts[name] && pkg.scripts[name] !== command) throw new Error(`Script ${name} already exists; resolve the script conflict before adding desktop.`);
    pkg.scripts[name] = command;
  }
  files.set("package.json", JSON.stringify(pkg, null, 2) + "\n");
  const config = readJson(path.join(template, "desktop.config.json"));
  const { name, version, expo, ...desktop } = config;
  const projectId = crypto.randomUUID();
  desktop.extends = "expo";
  desktop.projectId = projectId;
  desktop.platforms = [...new Set([...(base.platforms ?? ["ios", "android", "web"]), "macos", "windows"])];
  desktop.macos = { bundleIdentifier: base.macos?.bundleIdentifier ?? base.ios?.bundleIdentifier ?? `app.spark.id${projectId.replaceAll("-", "")}` };
  files.set("desktop.config.json", JSON.stringify(desktop, null, 2) + "\n");
  const ignoreFile = path.join(root, ".gitignore");
  const ignore = existsSync(ignoreFile) ? readFileSync(ignoreFile, "utf8") : "";
  files.set(".gitignore", `${ignore}${ignore.endsWith("\n") || !ignore ? "" : "\n"}\n# spark generated desktop state\n/.spark/\n/macos/\n/windows/\n${release ? "\n# Spark verified release package inputs\n!/spark-packages/\n!/spark-packages/**\n" : ""}`);
  // All conflicts are checked before the first write. The integration is kept
  // reviewable/retryable if the package manager fails; never regenerate mobile.
  if (release) await materializeReleasePackages(release, root);
  for (const [file, content] of files) writeFileSync(path.join(root, file), content);
  if (release) verifyMaterializedReleasePackages(release, root);
  await run(root, managerCommand(manager, ["install"]));
  console.log(`Added desktop support to ${root}. Existing entry point and mobile/web scripts are unchanged.\nRun spark build --dev --platform macos, then spark dev --platform macos. Windows native builds run on Windows.`);
}
