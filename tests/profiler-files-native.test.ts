import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { runOk } from "./subprocess.ts";

// Compiles the real SparkProfilerFiles.mm as a development build (RCT_DEV 1, React Native's RCTDefines.h replaced) and
// runs tests/profiler-files.native.mm against a temporary directory.
test.skipIf(process.platform !== "darwin")("SparkProfilerWrite writes plain file names into an existing or new temporary directory, off the main thread, never replacing a file", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-profiler-files-test-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    mkdirSync(path.join(directory, "include/React"), { recursive: true });
    writeFileSync(path.join(directory, "include/React/RCTDefines.h"), "#define RCT_DEV 1\n");
    const output = path.join(directory, "test"), profiles = path.join(directory, "profiles");
    mkdirSync(profiles);
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-Wall", "-Werror", "-framework", "Foundation", "-I", path.join(directory, "include"), "-I", path.join(root, "packages/desktop-app/macos"),
      path.join(root, "packages/desktop-app/macos/SparkProfilerFiles.mm"), path.join(root, "tests/profiler-files.native.mm"), "-o", output], { timeout: 120_000 });
    expect(await runOk(output, [profiles], { timeout: 30_000 })).toContain("Profiler files tests passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 150_000);
