import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skipIf(process.platform !== "darwin")("native sidebar selection changes preserve rows and acknowledge rejected selections", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-sidebar-test-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const source = readFileSync(path.join(root, "packages/ui/macos/sidebar/RNSidebar.mm"), "utf8");
    const start = source.lastIndexOf("- (void)updateProps:");
    const update = source.slice(start, source.indexOf("- (void)updateLayoutMetrics:", start));
    const input = path.join(directory, "test.mm"), output = path.join(directory, "test");
    writeFileSync(input, readFileSync(path.join(root, "tests/sidebar-updates.native.mm"), "utf8").replace("// ACTUAL_UPDATE_PROPS", update));
    execFileSync("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-framework", "AppKit", input, "-o", output]);
    expect(execFileSync(output, { encoding: "utf8", timeout: 15000 })).toContain("Sidebar selective updates passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 25000);
