import { expect, test } from "vitest";
import { runOk } from "./subprocess.ts";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
test.skipIf(process.platform !== "darwin")("driver mode global shortcuts never register with the system and simulateGlobalShortcut presses them", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-global-shortcuts-test-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const source = readFileSync(path.join(root, "packages/global-shortcuts/macos/RNDesktopGlobalShortcuts.mm"), "utf8").split("\n").filter(line => !line.startsWith("#import")).join("\n");
    const input = path.join(directory, "test.mm"), output = path.join(directory, "test");
    writeFileSync(input, readFileSync(path.join(root, "tests/global-shortcuts.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", source));
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-DSPARK_TEST_DRIVER=1", "-framework", "AppKit", "-framework", "Carbon", input, "-o", output]);
    expect(await runOk(output, [], { timeout: 15000 })).toContain("Driver global shortcuts passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 25000);
