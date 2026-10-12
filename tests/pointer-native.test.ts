import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runOk } from "./subprocess.ts";

// The pointer services and the shipped RNSparkPointerView source over Fabric stubs (tests/pointer.native.mm).
let directory: string, executable: string;
beforeAll(async () => {
  if (process.platform !== "darwin") return;
  directory = mkdtempSync(path.join(os.tmpdir(), "spark-pointer-test-"));
  const native = path.resolve(import.meta.dirname, "../packages/ui/macos/pointer");
  const view = readFileSync(path.join(native, "RNSparkPointerView.mm"), "utf8").split("\n").filter(line => !line.startsWith("#import") && !line.startsWith("using namespace")).join("\n");
  const input = path.join(directory, "pointer.mm");
  executable = path.join(directory, "pointer");
  writeFileSync(input, readFileSync(path.join(import.meta.dirname, "pointer.native.mm"), "utf8").replace("// ACTUAL_POINTER_VIEW", `@interface RNSparkPointerView : RCTViewComponentView\n@end\n${view}`));
  await runOk("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-mmacosx-version-min=14.0", "-Werror=unguarded-availability-new", "-I", native, "-framework", "AppKit",
    input, path.join(native, "SparkPointer.mm"), "-o", executable], { timeout: 60000 });
}, 90000);
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

test.skipIf(process.platform !== "darwin").each([
  ["haptics", "haptic patterns and performance times reach AppKit's performer; unknown values perform nothing"],
  ["cursors", "custom cursors from SF Symbols and image files, with hot spots and load failures"],
  ["events", "gesture, pressure and back/forward NSEvents map to the reported events in view coordinates"],
  ["view", "the pointer view reports handled events through the responder chain, passes the others on, and owns its cursor"],
])("pointer: %s (%s)", async scenario => {
  expect(await runOk(executable, [scenario, directory], { timeout: 15000 })).toContain(`PASS ${scenario}`);
}, 20000);
