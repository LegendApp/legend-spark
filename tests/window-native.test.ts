import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
test.skipIf(process.platform !== "darwin")("native window guards settle close decisions and reject reused instances", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-window-native-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const source = readFileSync(path.join(root, "packages/desktop-windows/macos/RNDesktopWindows.mm"), "utf8").split("\n").filter(line => !line.startsWith("#import")).join("\n");
    const registry = readFileSync(path.join(root, "packages/desktop-windows/macos/window-manager/LegendWindowRegistry.mm"), "utf8").replace('#import "LegendWindowRegistry.h"', "");
    const prelude = `#import "${path.join(root, "packages/desktop-windows/macos/window-manager/LegendWindowRegistry.h")}"\n#import "${path.join(root, "packages/desktop-windows/macos/SparkWindowGeometry.h")}"\n`;
    const input = path.join(directory, "test.mm"), output = path.join(directory, "test");
    writeFileSync(input, prelude + readFileSync(path.join(root, "tests/window.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", registry + "\n" + source));
    execFileSync("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-framework", "AppKit", "-framework", "CoreGraphics", input, "-o", output]);
    expect(execFileSync(output, { encoding: "utf8", timeout: 15000 })).toContain("Window guards passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 25000);
