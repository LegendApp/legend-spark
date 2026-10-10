import { afterAll, beforeAll, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let directory: string, executable: string;
beforeAll(() => {
  if (process.platform !== "darwin") return;
  directory = mkdtempSync(path.join(os.tmpdir(), "spark-swipe-test-"));
  const root = path.resolve(import.meta.dirname, "..");
  const source = readFileSync(path.join(root, "packages/ui/macos/swipe-actions/RNSwipeActions.mm"), "utf8")
    .split("\n").filter(line => !line.startsWith("#import")).join("\n");
  const input = path.join(directory, "Swipe.mm");
  executable = path.join(directory, "test");
  writeFileSync(input, readFileSync(path.join(root, "tests/ui-swipe.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", source));
  execFileSync("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-framework", "AppKit", "-framework", "QuartzCore", input, "-o", executable]);
}, 30000);
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

test.skipIf(process.platform !== "darwin").each(["normal", "cancel", "recycle", "replace", "hit", "repeat", "one-open", "rubber", "child-layout", "narrow", "clip", "button-click", "click-close", "click-routing"])("AppKit swipe lifecycle: %s", scenario => {
  expect(execFileSync(executable, [scenario], { encoding: "utf8", timeout: 15000 })).toContain(`PASS ${scenario}`);
});
