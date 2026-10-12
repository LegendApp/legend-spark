import { expect, test } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runOk } from "./subprocess.ts";

// Builds the real panel module against stand-ins for React and RNDesktopApp. Panels and the
// sampler are recorded by categories, so nothing reaches the screen and no TCC prompt can appear.
test.skipIf(process.platform !== "darwin")("AppKit color and font panels: one session per panel, typed fonts, handover, dismissal, eyedropper, driver refusal", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-panels-test-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const source = readFileSync(path.join(root, "packages/ui/macos/SparkColor.h"), "utf8") + readFileSync(path.join(root, "packages/ui/macos/RNSparkPanels.mm"), "utf8")
      .split("\n").filter(line => !line.startsWith("#import") && !line.includes("getTurboModule")).join("\n");
    const input = path.join(directory, "Panels.mm"), output = path.join(directory, "test");
    writeFileSync(input, readFileSync(path.join(root, "tests/native-panels.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", source));
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-Wno-objc-protocol-method-implementation", "-framework", "AppKit", input, "-o", output], { timeout: 120000 });
    expect(await runOk(output, [], { timeout: 60000 })).toContain("Native panel tests passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 240000);
