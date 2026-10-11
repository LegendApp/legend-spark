import { expect, test } from "vitest";
import { runOk } from "./subprocess.ts";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skipIf(process.platform !== "darwin")("AppKit button styles, sizes, actions and recycling", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-button-test-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const source = ["RNSparkLayoutDirection.h", "RNSparkButton.mm"].map(name => readFileSync(path.join(root, "packages/ui/macos", name), "utf8").split("\n").filter(line => !line.startsWith("#import")).join("\n")).join("\n");
    const input = path.join(directory, "Button.mm"), output = path.join(directory, "test");
    writeFileSync(input, readFileSync(path.join(root, "tests/ui-button.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", source));
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-framework", "AppKit", input, "-o", output]);
    expect(await runOk(output, [], { timeout: 60000 })).toContain("Native button styles and sizes passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 90000);
