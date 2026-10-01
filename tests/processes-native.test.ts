import { test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
test.skipIf(process.platform !== "darwin")("actual macOS process implementation preserves bytes, capture limits, exit and termination", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-process-native-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    let source = readFileSync(path.join(root, "packages/processes/macos/RNDesktopProcesses.mm"), "utf8");
    source = source.replace('#import "RNDesktopProcesses.h"', '').replace('#import <RNDesktopApp/SparkDesktop.h>', '').replace('#import <RNDesktopApp/SparkBinaryJSI.h>', '').replace(/- \(std::shared_ptr<facebook::react::TurboModule>\)getTurboModule:.*\n/, '');
    const fixture = readFileSync(path.join(root, "tests/processes.native.mm"), "utf8");
    const [bridge, checks] = fixture.split("// IMPLEMENTATION HERE");
    writeFileSync(path.join(directory, "main.mm"), bridge + source + checks);
    const binary = path.join(directory, "test");
    execFileSync("clang++", ["-std=c++20", "-fobjc-arc", "-fblocks", "-framework", "AppKit", path.join(directory, "main.mm"), "-o", binary]);
    expect(execFileSync(binary, { encoding: "utf8", timeout: 15000 })).toContain("Process native checks passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
