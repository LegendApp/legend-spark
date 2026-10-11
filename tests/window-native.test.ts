import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
// The harness writes restoreBounds and frame autosave defaults under its executable's name, and removes them.
const executable = "spark-window-native-test";
test.skipIf(process.platform !== "darwin")("native window guards settle close decisions; window options apply at open and on update", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-window-native-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const source = readFileSync(path.join(root, "packages/desktop-windows/macos/RNDesktopWindows.mm"), "utf8").split("\n").filter(line => !line.startsWith("#import")).join("\n");
    const registry = readFileSync(path.join(root, "packages/desktop-windows/macos/window-manager/LegendWindowRegistry.mm"), "utf8").replace('#import "LegendWindowRegistry.h"', "");
    const prelude = `#import "${path.join(root, "packages/desktop-windows/macos/window-manager/LegendWindowRegistry.h")}"\n#import "${path.join(root, "packages/desktop-windows/macos/SparkWindowGeometry.h")}"\n`;
    const input = path.join(directory, "test.mm"), output = path.join(directory, executable);
    writeFileSync(input, prelude + readFileSync(path.join(root, "tests/window.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", registry + "\n" + source));
    execFileSync("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-framework", "AppKit", "-framework", "CoreGraphics", input, "-o", output]);
    const result = execFileSync(output, { encoding: "utf8", timeout: 15000 });
    expect(result).toContain("Window guards passed");
    expect(result).toContain("Window options passed (left-to-right)");
    // Right-to-left title bars mirror the traffic lights; positions are measured from the leading edge.
    expect(execFileSync(output, ["-AppleTextDirection", "YES", "-NSForceRightToLeftWritingDirection", "YES"], { encoding: "utf8", timeout: 15000 })).toContain("Window options passed (right-to-left)");
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(path.join(os.homedir(), "Library/Preferences", `${executable}.plist`), { force: true });
  }
}, 25000);
