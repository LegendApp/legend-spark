import { test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skipIf(process.platform !== "darwin")("native quit coordination preserves opt-in and all-handler approval", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-quit-test-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const native = path.join(root, "packages/desktop-app/macos");
    const output = path.join(directory, "test");
    execFileSync("clang++", ["-fobjc-arc", "-fblocks", "-framework", "AppKit", "-I", native,
      path.join(native, "SparkQuitCoordinator.mm"), path.join(root, "tests/quit-coordinator.native.mm"), "-o", output]);
    expect(execFileSync(output, { encoding: "utf8" })).toContain("Quit lifecycle tests passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
