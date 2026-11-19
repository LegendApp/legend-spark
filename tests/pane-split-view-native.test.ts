import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { runOk } from "./subprocess.ts";

test.skipIf(process.platform !== "darwin")("AppKit lays out, clamps, and resizes nested panes", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-pane-split-view-"));
  try {
    const source = path.resolve(import.meta.dirname, "../packages/ui/macos/appkit-split-view");
    const output = path.join(directory, "test");
    await runOk("clang++", ["-fobjc-arc", "-std=c++20", "-framework", "AppKit", "-I", source,
      path.join(source, "RNSparkPaneSplitView.mm"), path.join(import.meta.dirname, "pane-split-view.native.mm"), "-o", output]);
    expect(await runOk(output)).toContain("Native pane split view passed");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30000);
