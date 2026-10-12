import { expect, test } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runOk } from "./subprocess.ts";

test.skipIf(process.platform !== "darwin")("native table and outline mount on null oldProps, re-parse changed chunks only, reconcile acknowledged state, and mirror in RTL", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-table-test-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const source = readFileSync(path.join(root, "packages/ui/macos/table/RNSparkTable.mm"), "utf8")
      .split("\n").filter(line => !line.startsWith("#import")).join("\n");
    const input = path.join(directory, "test.mm"), output = path.join(directory, "test");
    writeFileSync(input, readFileSync(path.join(root, "tests/ui-table.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", source));
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-mmacosx-version-min=14.0", "-framework", "AppKit", input, "-o", output], { timeout: 60000 });
    expect(await runOk(output, [], { timeout: 15000 })).toContain("Native table tests passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 90000);
