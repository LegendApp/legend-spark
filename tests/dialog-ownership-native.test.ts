import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
test.skipIf(process.platform !== "darwin")("native file and message dialogs resolve explicit owners before allocating UI", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-dialog-owner-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const source = ["packages/file-dialog/ios/RNFileDialog.mm", "packages/message-dialog/macos/RNDesktopMessageDialog.mm"].map(file => readFileSync(path.join(root, file), "utf8").split("\n").filter(line => !line.startsWith("#import")).join("\n")).join("\n");
    const input = path.join(directory, "test.mm"), output = path.join(directory, "test");
    writeFileSync(input, readFileSync(path.join(root, "tests/dialog-ownership.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", source));
    execFileSync("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-framework", "AppKit", input, "-o", output]);
    expect(execFileSync(output, { encoding: "utf8", timeout: 15000 })).toContain("Dialog ownership passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 25000);
