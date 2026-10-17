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
const PROFILER = "@legendapp/spark-desktop-app/src/profiler/install";
const REACT_DEVTOOLS = "@legendapp/spark-desktop-app/src/react-devtools/install";

/** The module's dependencies as Metro's transform worker collects them: inline __DEV__ (and fold constants when not dev) first. */
function dependencies(file: string, dev: boolean): string[] {
  const options = { ast: true, babelrc: false, code: false, configFile: false, filename: file, sourceMaps: false };
  let ast = parseSync(readFileSync(file, "utf8"), { babelrc: false, configFile: false, filename: file, sourceType: "unambiguous" });
  ast = transformFromAstSync(ast, "", { ...options, plugins: [[inlinePlugin, { dev, inlinePlatform: true, isWrapped: false, platform: "macos" }]], cloneInputAst: true }).ast;
  if (!dev) ast = transformFromAstSync(ast, "", { ...options, plugins: [constantFoldingPlugin], cloneInputAst: false }).ast;
  return collectDependencies(ast, { asyncRequireModulePath: "asyncRequire", dynamicRequires: "reject", inlineableCalls: [], keepRequireNames: dev, allowOptionalDependencies: false, unstable_allowRequireContext: false })
    .dependencies.map((dependency: { name: string }) => dependency.name);
}

test("Metro drops the Developer menu, the network inspector, the profiler and React DevTools' Select element fix from the release bundle at compile time", () => {
  expect(dependencies(BOOTSTRAP, true)).toEqual(["@legendapp/spark-cli/dist/runtime-entry.cjs", NETWORK_INSPECTOR, PROFILER, DEVTOOLS_OPENER, DEVELOPER_MENU, REACT_DEVTOOLS]);
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

test.each([["network inspector", "network-inspector"], ["profiler", "profiler"], ["React DevTools fix", "react-devtools"]])("only the __DEV__ branch of the bootstrap reaches the %s", (_, directory) => {
  // <directory>.ts is the public, release-safe surface; the tool itself is <directory>/.
  const sources = readdirSync("packages", { recursive: true, withFileTypes: true }).concat(readdirSync("examples/kitchen-sink", { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile() && /\.(tsx?|cjs|js)$/.test(entry.name) && !entry.parentPath.includes("node_modules"))
    .map(entry => path.join(entry.parentPath, entry.name));
  const importers = sources.filter(file => !file.includes(`src/${directory}/`) && new RegExp(`${directory}/\\w+["']`).test(readFileSync(file, "utf8")));
  expect(importers).toEqual([BOOTSTRAP]);
});

/** Lines outside every `#if RCT_DEV` block (comments and `allowed` imports aside) that match `names`. */
function outsideDev(file: string, names: RegExp, allowed: RegExp) {
  const stack: boolean[] = [], lines: string[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const directive = line.trim();
    if (/^#if/.test(directive)) { stack.push(directive === "#if RCT_DEV"); continue; }
    // The other branch of `#if RCT_DEV` is the release build.
    if (/^#el/.test(directive)) { stack.pop(); stack.push(false); continue; }
    if (/^#endif/.test(directive)) { stack.pop(); continue; }
    if (!stack.includes(true) && names.test(line) && !allowed.test(directive) && !/^\s*\/\//.test(line)) lines.push(line.trim());
  }
  return lines;
}

test("the native Developer menu compiles only when RCT_DEV", () => {
  // Every line that names the Developer menu sits inside `#if RCT_DEV`.
  const developer = /SparkDeveloper|_sparkDev|NativeDeveloperMenu|RCTDevSettings|RCTPerfMonitor|developer/, header = /^#import "SparkDeveloperMenu\.h"$/;
  expect(outsideDev("packages/native-menu/ios/SparkDeveloperMenu.mm", developer, header)).toEqual([]);
  expect(outsideDev("packages/native-menu/ios/SparkDeveloperMenu.h", developer, header)).toEqual([]);
  expect(outsideDev("packages/native-menu/ios/RNNativeMenu.mm", developer, header)).toEqual([]);
  expect(readFileSync("packages/native-menu/ios/SparkDeveloperMenu.mm", "utf8")).toMatch(/^#import "SparkDeveloperMenu\.h"\n#if RCT_DEV\n[\s\S]*\n#endif\n$/);
});

test("the native profiler compiles only when RCT_DEV", () => {
  // SparkProfiler.mm is all inside `#if RCT_DEV`, and so is every use of it. The frame timeline it records also serves
  // the test driver, so SparkFrameTimeline compiles with SPARK_TEST_DRIVER too; it holds no profiler code.
  const profiler = /SparkProfiler|spark-profiler|hermes|Hermes|SamplingProfiler|startProfiling|stopProfiling|writeProfile|isProfiling/, header = /^#import "SparkProfiler(Files)?\.h"$/;
  for (const name of ["SparkProfiler", "SparkProfilerFiles"])
    expect(readFileSync(`packages/desktop-app/macos/${name}.mm`, "utf8")).toMatch(new RegExp(`^#import "${name}\\.h"\\n#if RCT_DEV\\n[\\s\\S]*\\n#endif\\n$`));
  for (const file of ["packages/desktop-app/macos/SparkProfiler.h", "packages/desktop-app/macos/SparkProfilerFiles.h", "packages/desktop-app/macos/RNDesktopApp.mm", "packages/native-menu/ios/SparkDeveloperMenu.mm", "packages/desktop-app/macos/SparkFrameTimeline.mm"])
    expect(outsideDev(file, profiler, header), file).toEqual([]);
  expect(readFileSync("packages/desktop-app/macos/SparkFrameTimeline.mm", "utf8")).not.toMatch(/SparkProfiler|spark-profiler/);
});

test("native modules' network reporting compiles only when RCT_DEV", () => {
  // SparkLoadURL loads in every build; reporting to the network inspector, and its marker, sit inside `#if RCT_DEV`.
  const reporting = /SparkNetworkRequestWillStart|SparkNetworkRequestDidEnd|SparkSetNetworkReporting|reportNativeNetwork|nativeNetwork|spark-network-inspector|SparkNetworkInspectorMarker/, header = /^#import "SparkNetworkRequests\.h"$/;
  for (const file of ["packages/desktop-app/macos/SparkNetworkRequests.h", "packages/desktop-app/macos/SparkNetworkRequests.mm", "packages/desktop-app/macos/RNDesktopApp.mm", "packages/audio/macos/RNSparkAudio.mm"])
    expect(outsideDev(file, reporting, header), file).toEqual([]);
});
