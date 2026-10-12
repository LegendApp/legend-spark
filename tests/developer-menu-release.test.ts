import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, test } from "vitest";

// Release builds must contain no Developer menu: not a runtime flag, but code that is never compiled in.
const require = createRequire(import.meta.url);
const { parseSync, transformFromAstSync } = require("@babel/core");
const { inlinePlugin, constantFoldingPlugin } = require("metro-transform-plugins");
const collectDependencies = require("metro/private/ModuleGraph/worker/collectDependencies").default;
const BOOTSTRAP = "packages/desktop/runtime-entry.cjs";
const DEVELOPER_MENU = "@legendapp/spark-native-menu/src/developer-menu";
const DEVTOOLS_OPENER = "@legendapp/spark-desktop-app/src/devtools-opener";
const NETWORK_INSPECTOR = "@legendapp/spark-desktop-app/src/network-inspector/install";

/** The module's dependencies as Metro's transform worker collects them: inline __DEV__ (and fold constants when not dev) first. */
function dependencies(file: string, dev: boolean): string[] {
  const options = { ast: true, babelrc: false, code: false, configFile: false, filename: file, sourceMaps: false };
  let ast = parseSync(readFileSync(file, "utf8"), { babelrc: false, configFile: false, filename: file, sourceType: "unambiguous" });
  ast = transformFromAstSync(ast, "", { ...options, plugins: [[inlinePlugin, { dev, inlinePlatform: true, isWrapped: false, platform: "macos" }]], cloneInputAst: true }).ast;
  if (!dev) ast = transformFromAstSync(ast, "", { ...options, plugins: [constantFoldingPlugin], cloneInputAst: false }).ast;
  return collectDependencies(ast, { asyncRequireModulePath: "asyncRequire", dynamicRequires: "reject", inlineableCalls: [], keepRequireNames: dev, allowOptionalDependencies: false, unstable_allowRequireContext: false })
    .dependencies.map((dependency: { name: string }) => dependency.name);
}

test("Metro drops the Developer menu and the network inspector from the release bundle at compile time", () => {
  expect(dependencies(BOOTSTRAP, true)).toEqual(["@legendapp/spark-cli/dist/runtime-entry.cjs", NETWORK_INSPECTOR, DEVTOOLS_OPENER, DEVELOPER_MENU]);
  expect(dependencies(BOOTSTRAP, false)).toEqual(["@legendapp/spark-cli/dist/runtime-entry.cjs"]);
});

test("only the __DEV__ branch of the bootstrap reaches the Developer menu modules", () => {
  // Modules that exist only for the menu. developer-menu-state.ts stays: it is the public state, and holds no menu code.
  const devOnly = /(?:native-menu\/src\/developer-menu(?:-messages)?|contracts\/developer-tools|src\/devtools-opener)["']/;
  const sources = (directory: string): string[] => readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(tsx?|cjs|js)$/.test(entry.name) && !entry.parentPath.includes("node_modules"))
    .map(entry => path.join(entry.parentPath, entry.name));
  const local = /from "\.\/developer-menu(?:-messages)?"/;
  const importers = [...sources("packages"), ...sources("examples/kitchen-sink")]
    .filter(file => devOnly.test(readFileSync(file, "utf8")) || (file.startsWith("packages/native-menu/") && local.test(readFileSync(file, "utf8"))));
  expect(importers.sort()).toEqual(["packages/desktop-app/src/devtools-opener.ts", BOOTSTRAP, "packages/native-menu/src/developer-menu.ts"]);
});

test("only the __DEV__ branch of the bootstrap reaches the network inspector", () => {
  // network-inspector.ts is the public, release-safe surface; the inspector itself is network-inspector/.
  const sources = readdirSync("packages", { recursive: true, withFileTypes: true }).concat(readdirSync("examples/kitchen-sink", { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile() && /\.(tsx?|cjs|js)$/.test(entry.name) && !entry.parentPath.includes("node_modules"))
    .map(entry => path.join(entry.parentPath, entry.name));
  const importers = sources.filter(file => !file.includes("src/network-inspector/") && /network-inspector\/\w+["']/.test(readFileSync(file, "utf8")));
  expect(importers).toEqual([BOOTSTRAP]);
});

test("the native Developer menu compiles only when RCT_DEV", () => {
  // Every line that names the Developer menu sits inside `#if RCT_DEV`.
  const outsideDev = (file: string) => {
    const stack: boolean[] = [], lines: string[] = [];
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const directive = line.trim();
      if (/^#if/.test(directive)) { stack.push(directive === "#if RCT_DEV"); continue; }
      // The other branch of `#if RCT_DEV` is the release build.
      if (/^#el/.test(directive)) { stack.pop(); stack.push(false); continue; }
      if (/^#endif/.test(directive)) { stack.pop(); continue; }
      if (!stack.includes(true) && /SparkDeveloper|_sparkDev|NativeDeveloperMenu|RCTDevSettings|RCTPerfMonitor|developer/.test(line) && !/^#import "SparkDeveloperMenu\.h"$/.test(directive) && !/^\s*\/\//.test(line)) lines.push(line.trim());
    }
    return lines;
  };
  expect(outsideDev("packages/native-menu/ios/SparkDeveloperMenu.mm")).toEqual([]);
  expect(outsideDev("packages/native-menu/ios/SparkDeveloperMenu.h")).toEqual([]);
  expect(outsideDev("packages/native-menu/ios/RNNativeMenu.mm")).toEqual([]);
  expect(readFileSync("packages/native-menu/ios/SparkDeveloperMenu.mm", "utf8")).toMatch(/^#import "SparkDeveloperMenu\.h"\n#if RCT_DEV\n[\s\S]*\n#endif\n$/);
});
