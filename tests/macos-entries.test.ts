import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

test("every iOS source has an explicit macOS counterpart", () => {
  // Expo SDK 55 falls back to iOS before native/generic files on macOS.
  const iosFiles = readdirSync("packages", { recursive: true })
    .filter(file => /\.ios\.[cm]?[jt]sx?$/.test(file));
  expect(iosFiles.length).toBeGreaterThan(0);
  const missing = iosFiles.filter(file => !existsSync(path.join("packages", file.replace(".ios.", ".macos."))));
  expect(missing, "Add a macOS re-export of the intended desktop/generic implementation").toEqual([]);
});
