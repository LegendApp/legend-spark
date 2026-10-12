import { test, expect } from "vitest";
import { runOk } from "./subprocess.ts";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skipIf(process.platform !== "darwin")("native scanning stops between entries and preserves stats", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-scan-test-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const native = path.join(root, "packages/file-system/macos/file-scanner");
    const output = path.join(directory, "test");
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-framework", "Foundation", "-I", native,
      path.join(native, "RNFileScannerCore.mm"), path.join(root, "tests/file-scanner.native.mm"), "-o", output]);
    expect(await runOk(output, [directory])).toContain("File scanner tests passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 25000);
