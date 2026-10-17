import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { runOk } from "./subprocess.ts";

// Compiles the real SparkProfilerDevTools.mm as a development build (RCT_DEV 1, React Native's RCTDefines.h replaced) and
// runs tests/profiler-devtools.native.mm, which stands in for React Native's inspector connection.
test.skipIf(process.platform !== "darwin")("React Native DevTools' recordings are followed per page, and cannot start or stop sampling while Spark records", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-profiler-devtools-test-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    mkdirSync(path.join(directory, "include/React"), { recursive: true });
    writeFileSync(path.join(directory, "include/React/RCTDefines.h"), "#define RCT_DEV 1\n");
    const output = path.join(directory, "test");
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-Wall", "-Werror", "-framework", "Foundation", "-I", path.join(directory, "include"), "-I", path.join(root, "packages/desktop-app/macos"),
      path.join(root, "packages/desktop-app/macos/SparkProfilerDevTools.mm"), path.join(root, "tests/profiler-devtools.native.mm"), "-o", output], { timeout: 120_000 });
    expect(await runOk(output, [], { timeout: 30_000 })).toContain("Profiler DevTools tests passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 150_000);
