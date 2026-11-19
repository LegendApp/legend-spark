import { expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runOk } from "./subprocess.ts";

test.skipIf(process.platform !== "darwin")("AppKit drag source preserves child clicks and reports actual drag sessions", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-drag-test-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const source = readFileSync(path.join(root, "packages/drag-drop/macos/RNDesktopDragView.mm"), "utf8")
      .replace(/^#import .*$/gm, "");
    const input = path.join(directory, "Drag.mm");
    const binary = path.join(directory, "test");
    writeFileSync(input, readFileSync(path.join(root, "tests/drag-drop.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", source));
    await runOk("clang++", ["-fobjc-arc", "-std=c++20", "-framework", "AppKit", "-framework", "UniformTypeIdentifiers", input, "-o", binary]);
    expect(await runOk(binary, [], { timeout: 10000 })).toContain("Drag source passed");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 20000);
