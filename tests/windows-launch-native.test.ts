import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// launch.inc is standard C++, so the Win32 host's forwarding, quoting and safe-mode logic runs here too.
test.skipIf(process.platform !== "darwin")("Windows launch forwarding payloads, argument classification, quoting and safe mode", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-windows-launch-"));
  try {
    const output = path.join(directory, "test");
    execFileSync("clang++", ["-std=c++20", path.resolve(import.meta.dirname, "windows-launch.native.cpp"), "-o", output]);
    expect(execFileSync(output, { encoding: "utf8" })).toContain("Windows launch helper tests passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
