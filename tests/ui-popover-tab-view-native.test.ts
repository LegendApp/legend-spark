import { afterAll, beforeAll, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let directory: string, executable: string;
beforeAll(() => {
  if (process.platform !== "darwin") return;
  directory = mkdtempSync(path.join(os.tmpdir(), "spark-popover-tab-view-test-"));
  const root = path.resolve(import.meta.dirname, "..");
  const source = ["popover/RNSparkPopover.mm", "tab-view/RNSparkTabView.mm"]
    .map(name => readFileSync(path.join(root, "packages/ui/macos", name), "utf8").split("\n").filter(line => !line.startsWith("#import")).join("\n")).join("\n");
  const input = path.join(directory, "test.mm");
  executable = path.join(directory, "test");
  writeFileSync(input, readFileSync(path.join(root, "tests/ui-popover-tab-view.native.mm"), "utf8").replace("// ACTUAL_IMPLEMENTATION", source));
  execFileSync("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-mmacosx-version-min=14.0", "-framework", "AppKit", input, "-o", executable], { timeout: 60000 });
}, 90000);
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

test.skipIf(process.platform !== "darwin")("popover hosts React content, anchors, counts events and reconciles open without showing a window", () => {
  expect(execFileSync(executable, ["popover"], { encoding: "utf8", timeout: 15000 })).toContain("PASS popover");
});
// The right-to-left app is forced through the argument domain for this process only.
test.skipIf(process.platform !== "darwin").each([[[]], [["-AppleTextDirection", "YES", "-NSForceRightToLeftWritingDirection", "YES"]]])("tab view hosts tabs in React order with acknowledged selection (%j)", args => {
  const output = execFileSync(executable, ["tab-view", ...args], { encoding: "utf8", timeout: 15000 });
  expect(output).toContain(args.length ? "PASS tab-view (right-to-left app)" : "PASS tab-view");
});
test.skipIf(process.platform !== "darwin")("the popover content view renders in-process in light, dark and right to left", () => {
  expect(execFileSync(executable, ["capture", directory], { encoding: "utf8", timeout: 15000 })).toContain("PASS capture");
  for (const name of ["light", "dark", "light-ar", "dark-ar"]) expect(readFileSync(path.join(directory, `popover-content-${name}.png`)).subarray(1, 4).toString()).toBe("PNG");
});
