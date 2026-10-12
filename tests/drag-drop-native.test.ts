import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runOk } from "./subprocess.ts";

// The shipped SparkDragSession (tests/drag-drop.native.mm): operation masks, dragging items, promised files written into a
// private temporary folder, and simulated sessions over test destinations. No real drag starts and nothing is shown.
let directory: string, executable: string;
beforeAll(async () => {
  if (process.platform !== "darwin") return;
  directory = mkdtempSync(path.join(os.tmpdir(), "spark-drag-drop-test-"));
  const native = path.resolve(import.meta.dirname, "../packages/drag-drop/macos");
  executable = path.join(directory, "drag-drop");
  await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-mmacosx-version-min=14.0", "-DSPARK_TEST_DRIVER=1", "-Werror=unguarded-availability-new", "-I", native, "-framework", "AppKit", "-framework", "UniformTypeIdentifiers",
    path.join(import.meta.dirname, "drag-drop.native.mm"), path.join(native, "SparkDragSession.mm"), "-o", executable], { timeout: 60000 });
}, 90000);
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

test.skipIf(process.platform !== "darwin").each([
  ["operations", "source masks, the modifier narrowing AppKit documents, and the destination's choice among the allowed operations"],
  ["items", "one item per representation with promised-file providers, and the default, view snapshot and image file drag images"],
  ["promised", "promised files are written on demand into the drop folder; failures, timeouts and a vanished source fail the write"],
  ["session", "enter, update, exit and drop with modifiers and ignoreModifiers, and spring loading after the springing delay"],
])("drag and drop: %s (%s)", async scenario => {
  expect(await runOk(executable, [scenario, "-com.apple.springing.delay", "0.2"], { timeout: 15000 })).toContain(`PASS ${scenario}`);
}, 20000);
