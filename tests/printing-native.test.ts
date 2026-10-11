import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const macos = path.join(root, "packages/printing/macos");

// SPARK_PRINTING_RENDER_DIR keeps the first page of each exported PDF as PNG (see e2e/verification/111).
test.skipIf(process.platform !== "darwin")("printing core: page setup round trips, configured print operations and real headless PDF exports", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-printing-native-"));
  const renders = process.env.SPARK_PRINTING_RENDER_DIR ?? directory;
  try {
    const binary = path.join(directory, "test");
    execFileSync("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-Wall", "-Werror", "-mmacosx-version-min=14.0", "-I", macos, "-framework", "AppKit", "-framework", "PDFKit",
      path.join(root, "tests/printing.native.mm"), path.join(macos, "SparkPrinting.mm"), "-o", binary], { timeout: 60000 });
    expect(execFileSync(binary, [renders], { encoding: "utf8", timeout: 30000 })).toContain("Printing native tests passed");
    expect(readdirSync(renders).filter(file => file.endsWith(".png")).sort()).toEqual(expect.arrayContaining(["native-html-page1.png", "native-text-page1.png", "native-window-page1.png"]));
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 90000);
