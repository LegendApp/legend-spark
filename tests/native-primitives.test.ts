import { expect, test } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runOk } from "./subprocess.ts";

test.skipIf(process.platform !== "darwin")("AppKit primitives keep in-flight edits, reconcile acknowledged values, report JSON failures, mirror, and recycle", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-primitives-test-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const source = readFileSync(path.join(root, "packages/ui/macos/SparkColor.h"), "utf8") + ["RNSparkLayoutDirection.h", "RNSparkPrimitive.mm"].map(name => readFileSync(path.join(root, "packages/ui/macos", name), "utf8")
      .split("\n").filter(line => !line.startsWith("#import")).join("\n")).join("\n");
    const input = path.join(directory, "Primitives.mm"), output = path.join(directory, "test");
    writeFileSync(input, readFileSync(path.join(root, "tests/native-primitives.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", source));
    await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-Wno-objc-protocol-method-implementation", "-framework", "AppKit", input, "-o", output], { timeout: 120000 });
    expect(await runOk(output, [], { timeout: 60000 })).toContain("Native primitive tests passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 240000);
