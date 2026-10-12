import { expect, test } from "vitest";
import { runOk } from "./subprocess.ts";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// launch.inc is standard C++, so the Win32 host's forwarding, quoting and safe-mode logic runs here too.
test.skipIf(process.platform !== "darwin")("Windows launch forwarding payloads, argument classification, quoting and safe mode", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-windows-launch-"));
  try {
    const output = path.join(directory, "test");
    await runOk("clang++", ["-std=c++20", path.resolve(import.meta.dirname, "windows-launch.native.cpp"), "-o", output]);
    expect(await runOk(output)).toContain("Windows launch helper tests passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 25000);
