import { expect, test, vi } from "vitest";
const { call, listeners } = vi.hoisted(() => ({ call: vi.fn(), listeners: new Set<(event: any) => void>() }));
vi.mock("react-native", () => ({ Platform: { OS: "macos" } }));
vi.mock("../packages/desktop-windows/src/NativeDesktopWindowManager", () => ({ default: { call } }));
vi.mock("@legendapp/spark-desktop-app/src/events", () => ({ onDesktopEvent: (listener: (event: any) => void) => { listeners.add(listener); return { remove: () => listeners.delete(listener) }; } }));
import { subscribeToWindowInstance } from "../packages/desktop-windows/src/transport";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
test.skipIf(process.platform !== "darwin")("AppKit window manager compiles and emits numeric, instance-owned toolbar actions", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-window-manager-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const base = path.join(root, "packages/desktop-windows/macos/window-manager");
    const source = readFileSync(path.join(base, "RNWindowManager.mm"), "utf8").split("\n").filter(line => !line.startsWith("#import") && !line.includes("#include <cxxreact/")).join("\n");
    const registry = readFileSync(path.join(base, "LegendWindowRegistry.mm"), "utf8").replace('#import "LegendWindowRegistry.h"', "");
    const windows = readFileSync(path.join(root, "packages/desktop-windows/macos/RNDesktopWindows.mm"), "utf8").split("\n").filter(line => !line.startsWith("#import")).join("\n").replaceAll("NSUserDefaults.standardUserDefaults", "testDefaults");
    const input = path.join(directory, "test.mm"), output = path.join(directory, "test");
    mkdirSync(path.join(directory, "RNDesktopApp")); writeFileSync(path.join(directory, "RNDesktopApp/SparkDesktop.h"), "");
    writeFileSync(input, `#import "${path.join(base, "LegendWindowRegistry.h")}"\n#import "${path.join(root, "packages/desktop-windows/macos/SparkWindowGeometry.h")}"\n` + readFileSync(path.join(root, "tests/window-manager.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", registry + "\n" + source.replaceAll("NSUserDefaults.standardUserDefaults", "testDefaults") + "\n" + windows));
    execFileSync("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-I", directory, "-framework", "AppKit", "-framework", "QuartzCore", "-framework", "CoreImage", input, "-o", output]);
    const result = execFileSync(output, { encoding: "utf8", timeout: 15000 });
    expect(result).toContain("Window manager controls passed");
    const { earlyChrome } = JSON.parse(result.split("\n").find(line => line.startsWith('{"earlyChrome":'))!);
    call.mockResolvedValue(JSON.stringify(earlyChrome.observed));
    const received = vi.fn();
    const registration = await subscribeToWindowInstance("main", received, ["toolbarAction", "titleBarAction"]);
    try {
      for (const event of earlyChrome.events) listeners.forEach(listener => listener(event));
      expect.soft(earlyChrome.focused).toBe(true);
      expect(received.mock.calls.map(([event]) => event.type), result).toEqual(["toolbarAction", "titleBarAction"]);
    } finally { await registration.remove(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 25000);
