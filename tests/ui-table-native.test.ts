import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skipIf(process.platform !== "darwin")("AppKit table shows columns, a header and virtualized rows, and reports selection and double-clicks", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-table-test-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const source = ["RNSparkLayoutDirection.h", "table/RNSparkTable.mm"].map(name => readFileSync(path.join(root, "packages/ui/macos", name), "utf8")
      .split("\n").filter(line => !line.startsWith("#import")).join("\n")).join("\n");
    const input = path.join(directory, "Table.mm"), executable = path.join(directory, "test");
    writeFileSync(input, readFileSync(path.join(root, "tests/ui-table.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", source));
    execFileSync("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-framework", "AppKit", input, "-o", executable]);
    expect(execFileSync(executable, [], { encoding: "utf8", timeout: 45000 })).toContain("PASS table");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 60000);
