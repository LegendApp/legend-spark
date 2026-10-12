import { expect, test } from "vitest";
import { runOk } from "./subprocess.ts";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
/** Compiles the real dialog modules into a harness (with tests/dialog-native-prelude.h stubs) and runs it. */
async function runHarness(harness: string, args: string[] = []) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-dialog-native-"));
  try {
    const source = ["packages/file-dialog/ios/RNFileDialog.mm", "packages/message-dialog/macos/RNDesktopMessageDialog.mm"].map(file => readFileSync(path.join(root, file), "utf8").split("\n").filter(line => !line.startsWith("#import")).join("\n")).join("\n");
    const input = path.join(directory, "test.mm"), output = path.join(directory, "test");
    writeFileSync(input, readFileSync(path.join(root, "tests", harness), "utf8").replace("// ACTUAL_IMPLEMENTATION", source));
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-Wno-deprecated-declarations", "-I", path.join(root, "tests"), "-framework", "AppKit", input, "-o", output]);
    return await runOk(output, args, { timeout: 20000 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test.skipIf(process.platform !== "darwin")("native file and message dialogs resolve explicit owners before allocating UI", async () => {
  expect(await runHarness("dialog-ownership.native.mm")).toContain("Dialog ownership passed");
}, 25000);

// SPARK_DIALOG_RENDER_DIR keeps the offscreen renders (see e2e/verification/108).
test.skipIf(process.platform !== "darwin")("accessory, suppression, prompt and About configuration builds real AppKit panels without presenting them", async () => {
  const renders = process.env.SPARK_DIALOG_RENDER_DIR ?? mkdtempSync(path.join(os.tmpdir(), "spark-dialog-renders-"));
  try {
    expect(await runHarness("dialog-configuration.native.mm", [renders])).toContain("Dialog configuration passed");
    expect(readdirSync(renders).filter(file => file.endsWith(".png")).sort()).toEqual(expect.arrayContaining(["alert-suppression-dark.png", "alert-suppression-light.png", "prompt-light.png", "prompt-secure-dark.png", "save-accessory-ar-light.png", "save-accessory-light.png"]));
  } finally { if (!process.env.SPARK_DIALOG_RENDER_DIR) rmSync(renders, { recursive: true, force: true }); }
}, 40000);
