import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skipIf(process.platform !== "darwin")("AppKit controls reconcile edits and preserve distinct option identities", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-controls-test-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const source = ["RNSparkTextInput.mm", "native-select/RNNativeSelect.mm", "native-select/RNNativeSegmentedControl.mm"].map(name => readFileSync(path.join(root, "packages/ui/macos", name), "utf8").split("\n").filter(line => !line.startsWith("#import")).join("\n")).join("\n");
    const input = path.join(directory, "TextInput.mm"), output = path.join(directory, "test");
    writeFileSync(input, readFileSync(path.join(root, "tests/ui-controls.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", source));
    execFileSync("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-framework", "AppKit", input, "-o", output]);
    expect(execFileSync(output, { encoding: "utf8", timeout: 15000 })).toContain("Native text control tests passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 25000);
