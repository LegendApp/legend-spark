import { expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import path from "node:path";
import ts from "typescript";
import { patchWindowsSQLiteFunctions } from "../scripts/prepare-windows-libraries.ts";

const require = createRequire(import.meta.url);
const directory = path.dirname(require.resolve("@op-engineering/op-sqlite/package.json"));
for (const relative of ["src/functions.ts", "lib/module/functions.js"]) {
  test(`Windows SQLite DLL lookup propagates native failure through ${relative}`, () => {
    const installed = readFileSync(path.join(directory, relative), "utf8");
    const source = installed.includes("return NativeModules.OPSQLite.getDylibPath(bundle, name);") ? patchWindowsSQLiteFunctions(installed) : installed;
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, allowJs: true } }).outputText;
    const calls: unknown[][] = [];
    let result = "C:\\app\\extension.dll";
    const platform = { OS: "windows" };
    const exports: Record<string, any> = {};
    runInNewContext(code, {
      exports, global: { __OPSQLiteProxy: {} },
      require: (name: string) => {
        if (/^\.\/rollback(\.js)?$/.test(name)) return { rollbackAndRethrow() {} };
        if (name !== "react-native") throw new Error(`Unexpected runtime import ${name}`);
        return { Platform: platform, NativeModules: { OPSQLite: { getDylibPath: (...args: unknown[]) => { calls.push(args); return result; } } } };
      },
    });
    expect(exports.getDylibPath("", "extension")).toBe(result);
    expect(calls).toEqual([["", "extension"]]);
    result = "";
    expect(() => exports.getDylibPath("unsupported.bundle", "extension")).toThrow("empty bundle");
    platform.OS = "ios";
    expect(exports.getDylibPath("bundle", "extension")).toBe("");
  });
}
test("SQLite Windows packaging rejects changed upstream DLL lookup code", () => {
  expect(() => patchWindowsSQLiteFunctions("changed upstream")).toThrow("implementation changed");
});

test.skipIf(process.platform !== "darwin")("SQLite UTF-8 paths compile under C++20 and preserve Unicode file names", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const { tmpdir } = await import("node:os");
  const temporary = mkdtempSync(path.join(tmpdir(), "spark-sqlite-unicode-"));
  try {
    const binary = path.join(temporary, "test");
    execFileSync("clang++", ["-std=c++20", "-Werror=deprecated-declarations", "-I", path.resolve(import.meta.dirname, "../patches/windows/sqlite/cpp"), path.resolve(import.meta.dirname, "windows-sqlite.native.cpp"), "-o", binary]);
    execFileSync(binary, [temporary]);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("every header the SQLite patch includes from cpp/ ships in cpp/, so macOS builds it too", () => {
  const added = new Set<string>();
  for (const file of ["OPBridge.cpp", "OPSqlite.cpp", "OPUtils.cpp"]) {
    for (const [, header] of readFileSync(path.join(directory, "cpp", file), "utf8").matchAll(/^#include "([^"]+)"/gm)) added.add(header!);
  }
  expect(added).toContain("SparkWindowsPath.h");
  for (const header of added) expect(existsSync(path.join(directory, "cpp", header)), header).toBe(true);
});
