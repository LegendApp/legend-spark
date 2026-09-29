import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
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
