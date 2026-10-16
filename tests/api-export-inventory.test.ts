import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";

test("all 63 original exports have a disposition and every public entry has a target", () => {
  const inventory = JSON.parse(readFileSync("docs/api-export-inventory.json", "utf8")) as { original: Record<string, string>; additions: string[] };
  const root = path.resolve("packages/desktop");
  const { exports } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { exports: Record<string, string> };
  expect(Object.keys(inventory.original)).toHaveLength(63);
  expect([...new Set([...Object.values(inventory.original), ...inventory.additions])].sort()).toEqual(Object.keys(exports).sort());
  for (const [old, replacement] of Object.entries(inventory.original)) {
    if (old !== replacement) expect(Object.keys(exports), `Superseded entry ${old}`).not.toContain(old);
  }
  for (const [entry, target] of Object.entries(exports)) {
    expect(existsSync(path.join(root, target)), entry).toBe(true);
  }
  for (const entry of ["config", "config-plugin", "expo-config", "metro", "native"]) {
    expect(existsSync(path.join(root, `${entry}.d.cts`)), entry).toBe(true);
  }
});

test("markdown public entry exports its reader, inputs, and their owned props", () => {
  const entries = ["packages/desktop/markdown.ts"];
  const program = ts.createProgram(entries, { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, types: [], skipLibCheck: true });
  const checker = program.getTypeChecker();
  for (const [index, name] of ["Markdown"].entries()) {
    const source = program.getSourceFile(entries[index])!;
    const exported = checker.getExportsOfModule(checker.getSymbolAtLocation(source)!).map(symbol => symbol.name);
    expect(exported.sort()).toEqual([name, `${name}Props`, `${name}Input`, `${name}InputProps`, `${name}InputRef`, `Editable${name}`].sort());
  }
});
