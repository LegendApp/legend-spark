import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { runOk } from "./subprocess.ts";

const root = path.resolve(import.meta.dirname, "..");
const macos = path.join(root, "packages/system/macos");

// SPARK_DOCK_RENDER_DIR keeps one strip per appearance of every progress state (see e2e/verification/123).
test.skipIf(process.platform !== "darwin")("Dock tile progress renders the icon, a bar of the right fraction and color, clear of the badge corner", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-dock-tile-"));
  try {
    const binary = path.join(directory, "test");
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-Wall", "-Werror", "-mmacosx-version-min=14.0", "-I", macos, "-framework", "AppKit",
      path.join(root, "tests/dock-tile.native.mm"), path.join(macos, "SparkDockTile.mm"), "-o", binary], { timeout: 60000 });
    const args = [path.join(root, "assets/branding/legend-spark.png"), ...(process.env.SPARK_DOCK_RENDER_DIR ? [process.env.SPARK_DOCK_RENDER_DIR] : [])];
    expect(await runOk(binary, args, { timeout: 30000 })).toContain("Dock tile native tests passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 120000);
