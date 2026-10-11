import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skipIf(process.platform !== "darwin")("AppKit button styles, sizes, actions and recycling", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-button-test-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const source = readFileSync(path.join(root, "packages/ui/macos/RNSparkButton.mm"), "utf8").split("\n").filter(line => !line.startsWith("#import")).join("\n");
    const input = path.join(directory, "Button.mm"), output = path.join(directory, "test");
    writeFileSync(input, readFileSync(path.join(root, "tests/ui-button.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", source));
    execFileSync("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-framework", "AppKit", input, "-o", output]);
    expect(execFileSync(output, { encoding: "utf8", timeout: 60000 })).toContain("Native button styles and sizes passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 90000);
