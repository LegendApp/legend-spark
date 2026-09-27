import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
test.skipIf(process.platform !== "darwin")("AppKit outer frames round-trip through display-relative logical bounds", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-window-geometry-"));
  try {
    const header = path.resolve(import.meta.dirname, "../packages/desktop-windows/macos/SparkWindowGeometry.h");
    const input = path.join(directory, "test.mm"), output = path.join(directory, "test");
    writeFileSync(input, `#import "${header}"\n#include <cassert>\nint main() { @autoreleasepool {
      NSRect screen = NSMakeRect(-1440, 200, 1440, 900), frame = NSMakeRect(-1500, 700, 600, 300);
      NSDictionary *bounds = SparkLogicalBounds(frame, screen, @"secondary");
      assert([bounds[@"x"] doubleValue] == -60); assert([bounds[@"y"] doubleValue] == 100);
      assert([bounds[@"width"] doubleValue] == 600); assert([bounds[@"height"] doubleValue] == 300);
      assert(NSEqualRects(frame, SparkAppKitFrame(bounds, screen)));
      screen = NSMakeRect(0, -1000, 1600, 1000); frame = NSMakeRect(100, -900, 800, 600);
      bounds = SparkLogicalBounds(frame, screen, @"below"); assert([bounds[@"y"] doubleValue] == 300);
      assert(NSEqualRects(frame, SparkAppKitFrame(bounds, screen)));
      puts("Window geometry passed");
    } }`);
    execFileSync("clang++", ["-fobjc-arc", "-std=c++20", "-framework", "AppKit", "-framework", "CoreGraphics", input, "-o", output]);
    expect(execFileSync(output, { encoding: "utf8", timeout: 10000 })).toContain("Window geometry passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
