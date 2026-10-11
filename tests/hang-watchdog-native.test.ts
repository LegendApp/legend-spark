import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { runOk } from "./subprocess";

const root = path.resolve(import.meta.dirname, "..");
const macos = path.join(root, "packages/diagnostics/macos");

// Real main-thread hangs in a test process: reports, durations, symbolicated stacks, stop and thread exit.
// Each build also runs optimized, where tail calls could otherwise drop frames from the stack.
test.skipIf(process.platform !== "darwin")("hang watchdog core: real hangs reported with duration and stack; short stalls and stopped watchdogs report nothing", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-hang-watchdog-native-"));
  try {
    for (const optimization of ["-O0", "-O2"]) {
      const binary = path.join(directory, `test${optimization}`);
      await runOk("clang++", [optimization, "-fobjc-arc", "-fblocks", "-std=c++20", "-Wall", "-Werror", "-mmacosx-version-min=14.0", "-I", macos, "-framework", "Foundation",
        path.join(root, "tests/hang-watchdog.native.mm"), path.join(macos, "SparkHangWatchdog.mm"), "-o", binary], { timeout: 120_000 });
      expect(await runOk(binary, [], { timeout: 60_000 })).toContain("Hang watchdog native tests passed");
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 400_000);
