import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const macos = path.join(root, "packages/diagnostics/macos");

// Real main-thread hangs in a test process: reports, durations, symbolicated stacks, stop and thread exit.
// Each build also runs optimized, where tail calls could otherwise drop frames from the stack.
test.skipIf(process.platform !== "darwin")("hang watchdog core: real hangs reported with duration and stack; short stalls and stopped watchdogs report nothing", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-hang-watchdog-native-"));
  try {
    for (const optimization of ["-O0", "-O2"]) {
      const binary = path.join(directory, `test${optimization}`);
      execFileSync("clang++", [optimization, "-fobjc-arc", "-fblocks", "-std=c++20", "-Wall", "-Werror", "-mmacosx-version-min=14.0", "-I", macos, "-framework", "Foundation",
        path.join(root, "tests/hang-watchdog.native.mm"), path.join(macos, "SparkHangWatchdog.mm"), "-o", binary], { timeout: 60000 });
      expect(execFileSync(binary, { encoding: "utf8", timeout: 30000 })).toContain("Hang watchdog native tests passed");
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 90000);
