import { test, expect } from "vitest";
import { runOk } from "./subprocess.ts";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skipIf(process.platform !== "darwin")("native quit coordination preserves opt-in and all-handler approval", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-quit-test-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const native = path.join(root, "packages/desktop-app/macos");
    const output = path.join(directory, "test");
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-framework", "AppKit", "-I", native,
      path.join(native, "SparkQuitCoordinator.mm"), path.join(root, "tests/quit-coordinator.native.mm"), "-o", output]);
    expect(await runOk(output)).toContain("Quit lifecycle tests passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 25000);
