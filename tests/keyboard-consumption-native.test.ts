import { expect, test } from "vitest";
import { runOk } from "./subprocess.ts";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skipIf(process.platform !== "darwin")("native keyboard consumption matches configured rules without waiting for JavaScript", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-keyboard-test-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const source = readFileSync(path.join(root, "packages/desktop-shortcuts/macos/keyboard-manager/RNKeyboardManager.mm"), "utf8")
      .split("\n").filter(line => !line.startsWith("#import")).join("\n");
    expect(source).not.toMatch(/sleepForTimeInterval|eventResponses|eventResponseQueue|respondToKeyEvent|NSUUID/);
    const input = path.join(directory, "test.mm"), output = path.join(directory, "test");
    writeFileSync(input, readFileSync(path.join(root, "tests/keyboard-consumption.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", source));
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-framework", "AppKit", input, "-o", output]);
    expect(await runOk(output, [], { timeout: 15000 })).toContain("Keyboard consumption passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 25000);
