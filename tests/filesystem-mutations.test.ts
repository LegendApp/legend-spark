import { test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skipIf(process.platform !== "darwin" || process.getuid?.() === 0)("native conditional writes and removal preserve conflicts, symlinks and permission errors", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-files-test-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const native = path.join(root, "packages/file-system/macos");
    const output = path.join(directory, "test");
    execFileSync("clang++", ["-fobjc-arc", "-fblocks", "-framework", "Foundation", "-I", native,
      path.join(native, "SparkFileMutations.mm"), path.join(root, "tests/filesystem-mutations.native.mm"), "-o", output]);
    expect(execFileSync(output, [directory], { encoding: "utf8" })).toContain("Filesystem mutation tests passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
