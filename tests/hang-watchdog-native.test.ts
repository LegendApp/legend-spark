import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { runOk } from "./subprocess";

const root = path.resolve(import.meta.dirname, "..");
const macos = path.join(root, "packages/diagnostics/macos");

// SPARK_TEST_DRIVER=1, as in Debug builds: without the test driver SparkSimulateHang does not block (tests/test-driver-builds.test.ts).
async function build(binary: string, flags: string[]) {
  await runOk("clang++", [...flags, "-DSPARK_TEST_DRIVER=1", "-fobjc-arc", "-fblocks", "-std=c++20", "-Wall", "-Werror", "-mmacosx-version-min=14.0", "-I", macos, "-framework", "Foundation",
    path.join(root, "tests/hang-watchdog.native.mm"), path.join(macos, "SparkHangWatchdog.mm"), path.join(macos, "SparkStack.mm"), "-o", binary], { timeout: 120_000 });
}

// Real main-thread hangs in a test process: reports, durations, symbolicated stacks, stop and thread exit.
// Each build also runs optimized, where tail calls could otherwise drop frames from the stack.
// The late-wake build delays every answer by 300 ms on its way to the watchdog thread (which then wakes late):
// pings the main thread answered within the threshold are not reported. The delayed-thread build holds the watchdog
// thread between a ping and its wait until a hang is over: the ping, answered late, is still reported once, without a stack.
test.skipIf(process.platform !== "darwin")("hang watchdog core: real hangs reported with duration and stack; short stalls, late answers and stopped watchdogs report nothing; late wakes still report", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-hang-watchdog-native-"));
  try {
    for (const optimization of ["-O0", "-O2"]) {
      const binary = path.join(directory, `test${optimization}`);
      await build(binary, [optimization]);
      expect(await runOk(binary, [], { timeout: 60_000 })).toContain("Hang watchdog native tests passed");
    }
    const lateWake = path.join(directory, "test-late-wake");
    await build(lateWake, ["-O2", "-DSPARK_HANG_WATCHDOG_TEST_SIGNAL_DELAY_MS=300"]);
    expect(await runOk(lateWake, [], { timeout: 60_000 })).toContain("Hang watchdog late-wake tests passed");
    const delayedThread = path.join(directory, "test-delayed-thread");
    await build(delayedThread, ["-O2", "-DSPARK_HANG_WATCHDOG_TEST_HOOKS"]);
    expect(await runOk(delayedThread, [], { timeout: 60_000 })).toContain("Hang watchdog delayed-thread tests passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 500_000);
