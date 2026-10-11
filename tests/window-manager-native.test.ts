import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
// The harness autosaves toolbar layouts under its executable's name, and removes them.
const executable = "spark-window-manager-native-test";
test.skipIf(process.platform !== "darwin")("AppKit window manager compiles and emits numeric, instance-owned toolbar actions; toolbar customization, display modes, overflow and sidebar item", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-window-manager-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const base = path.join(root, "packages/desktop-windows/macos/window-manager");
    const source = readFileSync(path.join(base, "RNWindowManager.mm"), "utf8").split("\n").filter(line => !line.startsWith("#import") && !line.includes("#include <cxxreact/")).join("\n");
    const registry = readFileSync(path.join(base, "LegendWindowRegistry.mm"), "utf8").replace('#import "LegendWindowRegistry.h"', "");
    const input = path.join(directory, "test.mm"), output = path.join(directory, executable);
    mkdirSync(path.join(directory, "RNDesktopApp")); writeFileSync(path.join(directory, "RNDesktopApp/SparkDesktop.h"), "");
    writeFileSync(input, `#import "${path.join(base, "LegendWindowRegistry.h")}"\n` + readFileSync(path.join(root, "tests/window-manager.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", registry + "\nstatic BOOL SparkSafeMode(void) { return NO; }\n" + source));
    execFileSync("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-I", directory, "-framework", "AppKit", "-framework", "QuartzCore", "-framework", "CoreImage", input, "-o", output]);
    const result = execFileSync(output, { encoding: "utf8", timeout: 15000 });
    expect(result).toContain("Toolbar customization, display modes, overflow and sidebar item passed");
    expect(result).toContain("Window manager controls passed");
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(path.join(os.homedir(), "Library/Preferences", `${executable}.plist`), { force: true });
  }
}, 25000);
