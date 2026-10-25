import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skipIf(process.platform !== "darwin")("split view and drag view apply their props on a null-oldProps mount", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-fabric-mount-test-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const source = ["ui/macos/RNSparkLayoutDirection.h", "ui/macos/appkit-split-view/RNSidebarSplitViewComponent.mm", "drag-drop/macos/RNDesktopDragView.mm"]
      .map(name => readFileSync(path.join(root, "packages", name), "utf8").split("\n").filter(line => !line.startsWith("#import")).join("\n")).join("\n");
    const input = path.join(directory, "test.mm"), output = path.join(directory, "test");
    writeFileSync(input, readFileSync(path.join(root, "tests/fabric-mount-props.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", source));
    execFileSync("clang++", [
      "-fobjc-arc", "-fblocks", "-std=c++20", "-mmacosx-version-min=14.0",
      "-framework", "AppKit", "-framework", "QuartzCore", "-framework", "UniformTypeIdentifiers",
      input, "-o", output,
    ], { timeout: 60000 });
    expect(execFileSync(output, { encoding: "utf8", timeout: 15000 })).toContain("Fabric mount props passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 90000);
