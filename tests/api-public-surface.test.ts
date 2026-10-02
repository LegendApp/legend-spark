import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";

// The umbrella package re-exports feature packages with `export *`, and the
// feature packages expose their whole `src/` tree to Metro platform dispatch,
// so entry shims cannot hide a leaked internal. This snapshot freezes every
// public symbol name per entry point: a new or removed public export fails
// until the snapshot is deliberately regenerated with `SPI=1`.
const snapshotPath = "docs/api-public-surface.json";

test("the public export surface matches the reviewed snapshot", () => {
  const exports = JSON.parse(readFileSync("packages/desktop/package.json", "utf8")).exports as Record<string, string>;
  const entries = Object.entries(exports).filter(([, path]) => path.endsWith(".ts"));
  const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd()).options;
  const program = ts.createProgram(entries.map(([, path]) => resolve("packages/desktop", path)), options);
  const checker = program.getTypeChecker();
  const surface: Record<string, string[]> = {};
  for (const [entry, path] of entries.sort()) {
    const source = program.getSourceFile(resolve("packages/desktop", path))!;
    const module = checker.getSymbolAtLocation(source)!;
    surface[entry] = checker.getExportsOfModule(module).map(symbol => symbol.name).sort();
  }
  if (process.env.SPI) { writeFileSync(snapshotPath, JSON.stringify(surface, null, 2) + "\n"); }
  expect(existsSync(snapshotPath), `${snapshotPath} is missing. Regenerate it with SPI=1 after reviewing the surface.`).toBe(true);
  expect(surface).toEqual(JSON.parse(readFileSync(snapshotPath, "utf8")));
});

test("internal transports stay out of the public window surface", () => {
  const exports = JSON.parse(readFileSync("packages/desktop/package.json", "utf8")).exports as Record<string, string>;
  const surface = JSON.parse(readFileSync(snapshotPath, "utf8")) as Record<string, string[]>;
  const forbidden = ["windowCall", "windowCommand", "subscribeToWindowInstance", "nativeWindowOptions", "getNativeDisplays"];
  for (const entry of Object.keys(exports)) {
    if (!surface[entry]) continue;
    for (const name of forbidden) expect(surface[entry], `${entry} must not export ${name}`).not.toContain(name);
  }
});
