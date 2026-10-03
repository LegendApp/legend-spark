import { packArchive } from "../packages/cli/src/pack-archive.ts";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { run } from "../packages/cli/src/commands.ts";
import { readJson, writeJson } from "../packages/cli/src/project.ts";
import { hashFiles, listFiles } from "./patch-inventory.ts";

const root = path.resolve(import.meta.dirname, "..");
export function windowsPatchHash(name: string, pin: { version: string; integrity: string }, sourceRoot = root) {
  const adapter = name === "react-native-nitro-modules" ? "nitro" : name === "@op-engineering/op-sqlite" ? "sqlite" : undefined;
  const workspacePin = readJson(path.join(sourceRoot, "patches/workspace/upstream.json"))[name];
  const workspacePatch = `patches/workspace/${name.replace(/^@/, "").replaceAll("/", "-")}@${workspacePin.version}.patch`;
  const files = [workspacePatch];
  if (adapter) files.push(...listFiles(path.join(sourceRoot, `patches/windows/${adapter}`)).map(file => path.relative(sourceRoot, file)));
  if (name === "react-native-webview") files.push("patches/windows/webview.patch");
  const recipe = readFileSync(import.meta.filename, "utf8") + readFileSync(new URL("./patch-inventory.ts", import.meta.url), "utf8");
  return hashFiles(sourceRoot, files, `${name}@${pin.version}:${pin.integrity}\0${recipe}`);
}
/** Keep upstream JS/C++ intact except for the explicit Windows portability edits. */
export async function packWindowsLibraries(output: string) {
  const pins = readJson(path.join(root, "patches/windows/upstream.json")) as Record<string, { version: string; url: string; integrity: string }>;
  const result: Record<string, string> = {};
  for (const [name, pin] of Object.entries(pins)) {
    const cache = path.join(root, ".spark/vendor/windows", name.replaceAll("/", "-")); mkdirSync(cache, { recursive: true });
    const archive = path.join(cache, "upstream.tgz");
    if (!existsSync(archive)) { const response = await fetch(pin.url); if (!response.ok) throw new Error(`Download ${name}: HTTP ${response.status}`); writeFileSync(archive, new Uint8Array(await response.arrayBuffer())); }
    if (`sha512-${createHash("sha512").update(readFileSync(archive)).digest("base64")}` !== pin.integrity) throw new Error(`Integrity mismatch: ${archive}`);
    const stage = path.join(cache, "stage"); rmSync(stage, { recursive: true, force: true }); mkdirSync(stage);
    await run(stage, ["tar", "-xzf", archive, "--strip-components=1"], { capture: true });
    const pkg = readJson(path.join(stage, "package.json"));
    if (pkg.version !== pin.version) throw new Error(`Unexpected ${name} version`);
    const adapter = name === "react-native-nitro-modules" ? "nitro" : name === "@op-engineering/op-sqlite" ? "sqlite" : undefined;
    if (adapter) {
      cpSync(path.join(root, "patches/windows", adapter, "windows"), path.join(stage, "windows"), { recursive: true });
      const namespace = adapter === "nitro" ? "SparkNitro" : "SparkOPSQLite";
      const config = path.join(stage, "react-native.config.js");
      writeFileSync(config, (existsSync(config) ? readFileSync(config, "utf8") : "module.exports = {};\n") + `\nmodule.exports.dependency ??= {}; module.exports.dependency.platforms ??= {};\nmodule.exports.dependency.platforms.windows = ${JSON.stringify({ sourceDir: "windows", solutionFile: `${namespace}.sln`, projects: [{ projectFile: `${namespace}/${namespace}.vcxproj`, directDependency: true }] })};\n`);
      pkg.files = [...new Set([...(pkg.files ?? []), "windows", "react-native.config.js"])];
    }
    if (adapter === "nitro") {
      // Export the portable C++ API from its DLL, so consumers share one registry.
      const defines = path.join(stage, "cpp/utils/NitroDefines.hpp");
      writeFileSync(defines, readFileSync(defines, "utf8") + `\n#ifdef _WIN32\n#ifdef NITRO_WINDOWS_EXPORTS\n#define NITRO_WINDOWS_API __declspec(dllexport)\n#else\n#define NITRO_WINDOWS_API __declspec(dllimport)\n#endif\n#else\n#define NITRO_WINDOWS_API\n#endif\n`);
      const classes: Record<string, string[]> = {
        "core/HybridObject.hpp": ["HybridObject"], "core/ArrayBuffer.hpp": ["ArrayBuffer", "NativeArrayBuffer", "JSArrayBuffer"], "core/AnyMap.hpp": ["AnyMap"], "core/BoxedHybridObject.hpp": ["BoxedHybridObject"],
        "jsi/JSICache.hpp": ["JSICache"], "utils/CommonGlobals.hpp": ["CommonGlobals"], "utils/NitroTypeInfo.hpp": ["TypeInfo"], "utils/PropNameIDCache.hpp": ["PropNameIDCache"],
        "prototype/HybridObjectPrototype.hpp": ["HybridObjectPrototype"], "registry/HybridObjectRegistry.hpp": ["HybridObjectRegistry"], "threading/Dispatcher.hpp": ["Dispatcher"], "threading/ThreadPool.hpp": ["ThreadPool"], "platform/ThreadUtils.hpp": ["ThreadUtils"], "platform/NitroLogger.hpp": ["Logger"],
      };
      for (const [file, names] of Object.entries(classes)) {
        const target = path.join(stage, "cpp", file); let source = '#include "NitroDefines.hpp"\n' + readFileSync(target, "utf8");
        for (const symbol of names) source = source.replace(new RegExp(`class ${symbol}(?=\\s*[:{]|\\s+final)`), `class NITRO_WINDOWS_API ${symbol}`);
        writeFileSync(target, source);
      }
      const entry = path.join(stage, "cpp/entrypoint/InstallNitro.hpp"); writeFileSync(entry, '#include "NitroDefines.hpp"\n' + readFileSync(entry, "utf8").replaceAll("void install(", "NITRO_WINDOWS_API void install("));
      // Namespaced includes generated by Nitrogen resolve through this exported header tree.
      const include = path.join(stage, "windows/include/NitroModules"); mkdirSync(include, { recursive: true });
      function headers(dir: string) { for (const file of readdirSync(dir, { withFileTypes: true })) { const target = path.join(dir, file.name); if (file.isDirectory()) headers(target); else if (file.name.endsWith(".hpp")) writeFileSync(path.join(include, file.name), `#include "${path.relative(include, target).split(path.sep).join("/")}"\n`); } }
      headers(path.join(stage, "cpp"));
    }
    if (adapter === "sqlite") {
      const api = path.join(stage, "cpp/OPSqlite.cpp");
      let apiSource = readFileSync(api, "utf8").replace("location.rfind('/', 0) == 0", "std::filesystem::u8path(location).is_absolute()");
      apiSource = '#include <filesystem>\n' + apiSource;
      // RNW runs each Hermes heap on its own JS thread. These upstream globals
      // are only read on that owning thread; async DB operations capture them.
      apiSource = apiSource.replace('std::string _base_path;', 'OP_SQLITE_CONTEXT_LOCAL std::string _base_path;')
        .replace('std::string _sqlite_vec_path;', 'OP_SQLITE_CONTEXT_LOCAL std::string _sqlite_vec_path;')
        .replace('std::shared_ptr<react::CallInvoker> invoker;', 'OP_SQLITE_CONTEXT_LOCAL std::shared_ptr<react::CallInvoker> invoker;')
        .replace('std::shared_ptr<std::atomic<bool>> generation_alive;', 'OP_SQLITE_CONTEXT_LOCAL std::shared_ptr<std::atomic<bool>> generation_alive;');
      writeFileSync(api, apiSource);
      const types = path.join(stage, "cpp/OPTypes.hpp");
      writeFileSync(types, '#ifdef _WIN32\n#define OP_SQLITE_CONTEXT_LOCAL thread_local\n#else\n#define OP_SQLITE_CONTEXT_LOCAL\n#endif\n' + readFileSync(types, "utf8")
        .replace('extern std::shared_ptr<facebook::react::CallInvoker> invoker;', 'extern OP_SQLITE_CONTEXT_LOCAL std::shared_ptr<facebook::react::CallInvoker> invoker;')
        .replace('extern std::shared_ptr<std::atomic<bool>> generation_alive;', 'extern OP_SQLITE_CONTEXT_LOCAL std::shared_ptr<std::atomic<bool>> generation_alive;'));
      const header = path.join(stage, "cpp/OPSqlite.hpp");
      writeFileSync(header, readFileSync(header, "utf8").replace('#include <jsi/jsilib.h>', '#ifndef _WIN32\n#include <jsi/jsilib.h>\n#endif'));
      const bridgeHeader = path.join(stage, "cpp/OPBridge.hpp");
      writeFileSync(bridgeHeader, readFileSync(bridgeHeader, "utf8").replace('extern std::string _sqlite_vec_path;', 'extern OP_SQLITE_CONTEXT_LOCAL std::string _sqlite_vec_path;'));
      // SQLite accepts UTF-8 paths. std::filesystem/fstream on Windows need a
      // u8path conversion to avoid interpreting those paths in the ANSI codepage.
      const bridge = path.join(stage, "cpp/OPBridge.cpp"); let source = readFileSync(bridge, "utf8");
      source = source.replaceAll("std::filesystem::create_directories(location)", "std::filesystem::create_directories(std::filesystem::u8path(location))").replaceAll("std::filesystem::path fs_path(path)", "auto fs_path = std::filesystem::u8path(path)").replaceAll("remove(db_path.c_str())", "std::filesystem::remove(std::filesystem::u8path(db_path))").replaceAll("remove(path.c_str())", "std::filesystem::remove(std::filesystem::u8path(path))");
      writeFileSync(bridge, source);
      const utils = path.join(stage, "cpp/OPUtils.cpp"); source = '#include <filesystem>\n' + readFileSync(utils, "utf8"); source = source.replace("std::ifstream sqFile(path)", "std::ifstream sqFile(std::filesystem::u8path(path))").replace(/struct stat buffer;\s*return \(stat\((name|path)\.c_str\(\), &buffer\) == 0\);/g, "return std::filesystem::exists(std::filesystem::u8path($1));"); writeFileSync(utils, source);
    }
    if (name === "react-native-webview") {
      const { parsePatch, applyPatch } = createRequire(import.meta.url)("diff");
      for (const file of parsePatch(readFileSync(path.join(root, "patches/windows/webview.patch"), "utf8"))) {
        const target = path.join(stage, file.newFileName.replace(/^b\//, ""));
        const next = applyPatch(readFileSync(target, "utf8"), file);
        if (next === false) throw new Error(`Could not apply WebView Windows patch to ${target}`);
        writeFileSync(target, next);
      }
      // Match the pinned Expo Desktop/RNW toolchain; delegate the view to upstream.
      const project = path.join(stage, "windows/ReactNativeWebView/ReactNativeWebView.vcxproj");
      writeFileSync(project, readFileSync(project, "utf8").replace("<PlatformToolset>v143</PlatformToolset>", "<PlatformToolset>v145</PlatformToolset>").replace("%(AdditionalDependenices)", "%(AdditionalDependencies)"));
    }
    // Registry archives already contain built JS/types. Producer lifecycle hooks
    // must not invoke Bun or Yarn when a consumer installs our patched archive.
    for (const script of ["prepare", "prepack", "prepublish", "prepublishOnly"]) if (pkg.scripts) delete pkg.scripts[script];
    pkg.spark = { ...pkg.spark, sdk: true, windowsAdapter: true, upstreamIntegrity: pin.integrity, patchHash: windowsPatchHash(name, pin) }; writeJson(path.join(stage, "package.json"), pkg);
    const temporary = path.join(output, "windows-library.tgz");
    await packArchive(stage, temporary);
    const hash = createHash("sha256").update(readFileSync(temporary)).digest("hex").slice(0, 12);
    const file = `${name.replace(/^@/, "").replaceAll("/", "-")}-${pin.version}-${hash}.tgz`; cpSync(temporary, path.join(output, file)); rmSync(temporary); result[name] = file;
  }
  return result;
}
