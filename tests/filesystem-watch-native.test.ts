import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { runOk } from "./subprocess";

test.skipIf(process.platform !== "darwin")("recursive native watches survive missing roots, creation and replacement and stop on removal", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-watch-"));
  try {
    const source = readFileSync("packages/file-system/macos/RNDesktopFileSystem.mm", "utf8")
      .replace(/^#import .*$/gm, line => /RNDesktopFileSystem.h|SparkBinaryJSI.h|SparkDesktop.h/.test(line) ? "" : line)
      .replace("RCT_EXPORT_MODULE(NativeDesktopFileSystem)", "")
      .replace(/- \(std::shared_ptr[\s\S]*$/, "@end\n");
    const input = path.join(directory, "watch.mm"), binary = path.join(directory, "watch");
    writeFileSync(input, readFileSync("tests/filesystem-watch-prelude.h", "utf8") + source + readFileSync("tests/filesystem-watch.native.mm", "utf8"));
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-framework", "AppKit", "-framework", "CoreServices", "-I", "packages/file-system/macos", "-I", "packages/desktop-app/macos", input, "packages/file-system/macos/SparkFileMutations.mm", "-o", binary], { timeout: 30000 });
    expect(await runOk(binary, [directory], { timeout: 30000 })).toContain("Recursive watches passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 60000);
