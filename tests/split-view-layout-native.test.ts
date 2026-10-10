import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skipIf(process.platform !== "darwin")("native split views preserve divider ownership and final pane metrics", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-split-view-test-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const source = readFileSync(path.join(root, "packages/ui/macos/appkit-split-view/RNSidebarSplitViewComponent.mm"), "utf8");
    const method = (name: string) => {
      const start = source.indexOf(name);
      if (start < 0) throw new Error(`Missing split-view method: ${name}`);
      return source.slice(start, source.indexOf("\n}\n", start) + 3);
    };
    const classes = source.slice(source.indexOf("@interface RNSidebarSplitViewNativeSplitView"), source.indexOf("static char RNSidebarSplitViewStartupKey;"));
    const methods = ["- (void)mountChildComponentView:", "- (void)unmountChildComponentView:", "- (void)syncReactSubview:", "- (void)splitViewDidResize", "- (void)syncReactSubviewFrames", "- (void)updateSplitItemSizing", "- (void)updateListItem", "- (CGFloat)listReserveWidth", "- (CGFloat)preferredSidebarWidthForBounds:", "- (CGFloat)preferredListWidthForBounds:", "- (void)updateSidebarCollapsed", "- (CGRect)currentLayoutBounds", "- (void)applyDividerPositionForBounds:", "- (void)layoutSplitView", "- (BOOL)applyEstimatedSplitViewLayoutForBounds:", "- (void)publishSplitViewLayoutAllowEstimatedReady:"];
    const input = path.join(directory, "test.mm"), output = path.join(directory, "test");
    const fixture = readFileSync(path.join(root, "tests/split-view-layout.native.mm"), "utf8");
    writeFileSync(input, fixture.replace("// ACTUAL_CLASSES", classes).replace("// ACTUAL_METHODS", methods.map(method).join("\n")));
    execFileSync("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-framework", "AppKit", "-framework", "QuartzCore", input, "-o", output]);
    for (const scenario of ["anchor", "metrics", "events", "clamp", "resize", "ownership", "toggle", "mount"]) {
      expect(execFileSync(output, [scenario], { encoding: "utf8", timeout: 15000 })).toContain("Native split-view probe passed");
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 30000);
