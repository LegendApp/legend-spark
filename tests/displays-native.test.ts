import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { runOk } from "./subprocess.ts";

const root = path.resolve(import.meta.dirname, "..");
const macos = path.join(root, "packages/desktop-windows/macos");

test.skipIf(process.platform !== "darwin")("display details report this Mac's screens and observation follows screen, color space and simulation changes", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-displays-native-"));
  try {
    const binary = path.join(directory, "test");
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-Wall", "-Werror", "-mmacosx-version-min=14.0", "-I", macos, "-framework", "AppKit", "-framework", "CoreGraphics",
      path.join(root, "tests/displays.native.mm"), path.join(macos, "SparkDisplays.mm"), "-o", binary], { timeout: 60000 });
    expect(await runOk(binary, [], { timeout: 30000 })).toContain("Display native tests passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 90000);
