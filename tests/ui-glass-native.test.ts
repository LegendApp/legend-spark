import { afterAll, beforeAll, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let directory: string, executable: string;
beforeAll(() => {
  if (process.platform !== "darwin") return;
  directory = mkdtempSync(path.join(os.tmpdir(), "spark-glass-test-"));
  const root = path.resolve(import.meta.dirname, "..");
  // The harness picks the OS path per scenario, so both hierarchies run on any macOS 26+ host.
  const source = readFileSync(path.join(root, "packages/ui/macos/glass-effect-view/RNGlassEffectView.mm"), "utf8")
    .split("\n").filter(line => !line.startsWith("#import")).join("\n")
    .replaceAll("@available(macOS 26.0, *)", "SparkGlassAvailable");
  const input = path.join(directory, "Glass.mm");
  executable = path.join(directory, "test");
  writeFileSync(input, readFileSync(path.join(root, "tests/ui-glass.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", source));
  execFileSync("clang++", ["-fobjc-arc", "-std=c++20", "-framework", "AppKit", input, "-o", executable]);
}, 30000);
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

test.skipIf(process.platform !== "darwin").each(["glass", "fallback"])("GlassView hosts React children top-down: %s", scenario => {
  expect(execFileSync(executable, [scenario], { encoding: "utf8", timeout: 15000 })).toContain(`PASS ${scenario}`);
});
