import { test, expect } from "vitest";
import { runOk } from "./subprocess.ts";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skipIf(process.platform !== "darwin" || process.getuid?.() === 0)("native conditional writes and removal preserve conflicts, symlinks and permission errors", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-files-test-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const native = path.join(root, "packages/file-system/macos");
    const desktopNative = path.join(root, "packages/desktop-app/macos");
    const output = path.join(directory, "test");
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-I", native,
      "-c", path.join(native, "SparkFileMutations.mm"), "-o", path.join(directory, "production.o")]);
    await runOk("clang++", ["-DSPARK_FILE_MUTATIONS_TESTING", "-fobjc-arc", "-fblocks", "-framework", "Foundation", "-I", native, "-I", desktopNative,
      path.join(native, "SparkFileMutations.mm"), path.join(root, "tests/filesystem-mutations.native.mm"), "-o", output]);
    expect(await runOk(output, [directory])).toContain("Filesystem mutation tests passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 25000);
