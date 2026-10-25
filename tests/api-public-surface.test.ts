import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { readSdkSurface } from "../scripts/api-surface.ts";

// The umbrella package re-exports feature packages with `export *`, and the
// feature packages expose their whole `src/` tree to Metro platform dispatch,
// so entry shims cannot hide a leaked internal. This snapshot freezes every
// public symbol name per entry point: a new or removed public export fails
// until the snapshot is deliberately regenerated with `SPI=1`.
const snapshotPath = "docs/api-public-surface.json";
// Type-checking the SDK surface takes 0.9-4.6 s across 58 macos-latest CI runs (p95 4.2 s), close to the
// 5 s default. 20 s is over 4x the slowest run seen.
const surfaceTimeoutMs = 20_000;

test("the public export surface matches the reviewed snapshot", () => {
  const exports = JSON.parse(readFileSync("packages/desktop/package.json", "utf8")).exports as Record<string, string>;
  const surface = Object.fromEntries(Object.entries(readSdkSurface()).filter(([entry]) => exports[entry]!.endsWith(".ts")).map(([entry, { values, types }]) => [entry, [...values, ...types].sort()]));
  if (process.env.SPI) { writeFileSync(snapshotPath, JSON.stringify(surface, null, 2) + "\n"); }
  expect(existsSync(snapshotPath), `${snapshotPath} is missing. Regenerate it with SPI=1 after reviewing the surface.`).toBe(true);
  expect(surface).toEqual(JSON.parse(readFileSync(snapshotPath, "utf8")));
}, surfaceTimeoutMs);

test("internal transports stay out of the public window surface", () => {
  const exports = JSON.parse(readFileSync("packages/desktop/package.json", "utf8")).exports as Record<string, string>;
  const surface = JSON.parse(readFileSync(snapshotPath, "utf8")) as Record<string, string[]>;
  const forbidden = ["windowCall", "windowCommand", "subscribeToWindowInstance", "nativeWindowOptions", "getNativeDisplays"];
  for (const entry of Object.keys(exports)) {
    if (!surface[entry]) continue;
    for (const name of forbidden) expect(surface[entry], `${entry} must not export ${name}`).not.toContain(name);
  }
});
