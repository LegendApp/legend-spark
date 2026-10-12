import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { runOk } from "./subprocess.ts";

// taskbar.inc is standard C++, so SparkSystem's progress mapping and overlay count logic run here too.
test.skipIf(process.platform !== "darwin")("Windows taskbar progress states, values and overlay counts", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-windows-taskbar-"));
  try {
    const binary = path.join(directory, "test");
    await runOk("clang++", ["-std=c++20", "-Wall", "-Werror", path.resolve(import.meta.dirname, "windows-taskbar.native.cpp"), "-o", binary], { timeout: 60000 });
    expect(await runOk(binary, [], { timeout: 30000 })).toContain("Windows taskbar helper tests passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 120000);
