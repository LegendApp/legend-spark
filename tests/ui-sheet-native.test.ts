import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skipIf(process.platform !== "darwin")("AppKit sheet hosts React content on its window, follows visible and reports Escape", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-sheet-test-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const source = ["sheet/RNSparkSheet.mm"].map(name => readFileSync(path.join(root, "packages/ui/macos", name), "utf8")
      .split("\n").filter(line => !line.startsWith("#import")).join("\n")).join("\n");
    const input = path.join(directory, "Sheet.mm"), executable = path.join(directory, "test");
    writeFileSync(input, readFileSync(path.join(root, "tests/ui-sheet.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", source));
    execFileSync("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-framework", "AppKit", input, "-o", executable]);
    expect(execFileSync(executable, [], { encoding: "utf8", timeout: 45000 })).toContain("PASS sheet");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 60000);
