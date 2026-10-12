import { expect, test } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runOk } from "./subprocess.ts";
// The harness writes restoreBounds and frame autosave defaults under its executable's name, and removes them.
const executable = "spark-window-native-test";
test.skipIf(process.platform !== "darwin")("native window guards settle close decisions; window options apply at open and on update; driver mode never shows windows; tab groups regroup, publish and restore; session frames reopen exactly", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-window-native-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const source = readFileSync(path.join(root, "packages/desktop-windows/macos/RNDesktopWindows.mm"), "utf8").split("\n").filter(line => !line.startsWith("#import")).join("\n");
    const registry = readFileSync(path.join(root, "packages/desktop-windows/macos/window-manager/LegendWindowRegistry.mm"), "utf8").replace('#import "LegendWindowRegistry.h"', "");
    const prelude = `#import "${path.join(root, "packages/desktop-windows/macos/window-manager/LegendWindowRegistry.h")}"\n#import "${path.join(root, "packages/desktop-windows/macos/SparkWindowGeometry.h")}"\n#import "${path.join(root, "packages/desktop-windows/macos/SparkDisplays.h")}"\n`;
    const input = path.join(directory, "test.mm"), output = path.join(directory, executable);
    writeFileSync(input, prelude + readFileSync(path.join(root, "tests/window.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", registry + "\n" + source));
    // The harness strips the imports, SparkTestDriver.h included; it tests the driver's simulateDisplays command.
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-DSPARK_TEST_DRIVER=1", "-framework", "AppKit", "-framework", "CoreGraphics", input, path.join(root, "packages/desktop-windows/macos/SparkDisplays.mm"), "-o", output], { timeout: 60000 });
    const result = await runOk(output, [], { timeout: 60000 });
    for (const suite of ["Window guards passed", "Window options passed (left-to-right)", "Driver mode windows stayed off screen", "Window tabs passed", "Shown window tabs passed", "Window tab restoration passed", "Display observation passed", "Window session frames passed", "Special windows passed"]) expect(result).toContain(suite);
    // Right-to-left title bars mirror the traffic lights; positions are measured from the leading edge. Only the options suite depends on direction.
    expect(await runOk(output, ["options", "-AppleTextDirection", "YES", "-NSForceRightToLeftWritingDirection", "YES"], { timeout: 30000 })).toBe("Window options passed (right-to-left)\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(path.join(os.homedir(), "Library/Preferences", `${executable}.plist`), { force: true });
  }
}, 160000);
