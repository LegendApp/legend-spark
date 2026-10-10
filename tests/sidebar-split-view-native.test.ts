import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skipIf(process.platform !== "darwin")("native split views preserve collapse ownership, dragged widths, and recycled state", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-split-view-test-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const source = readFileSync(path.join(root, "packages/ui/macos/appkit-split-view/RNSidebarSplitViewComponent.mm"), "utf8")
      .split("\n").filter(line => !line.startsWith("#import")).join("\n");
    const input = path.join(directory, "test.mm"), output = path.join(directory, "test");
    writeFileSync(input, readFileSync(path.join(root, "tests/sidebar-split-view.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", source));
    execFileSync("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-framework", "AppKit", "-framework", "QuartzCore", "-framework", "CoreImage", input, "-o", output]);
    expect(execFileSync(output, { encoding: "utf8", timeout: 15000 })).toContain("Full source AppKit component probe passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 25000);
