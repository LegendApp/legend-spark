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
    writeFileSync(input, `#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#include <cassert>
#include <cmath>
#include <unordered_set>
static std::unordered_set<CGEventRef> events;
static CGEventRef TrackEvent(CGEventSourceRef source) { auto event = CGEventCreate(source); if (event) events.insert(event); return event; }
static void ReleaseEvent(CFTypeRef value) { events.erase((CGEventRef)value); CFRelease(value); }
#define CGEventCreate TrackEvent
#define CFRelease ReleaseEvent
#import "${header}"
int main() { @autoreleasepool {
      NSRect screen = NSMakeRect(-1440, 200, 1440, 900), frame = NSMakeRect(-1500, 700, 600, 300);
      NSDictionary *bounds = SparkLogicalBounds(frame, screen, @"secondary");
      assert([bounds[@"x"] doubleValue] == -60); assert([bounds[@"y"] doubleValue] == 100);
      assert([bounds[@"width"] doubleValue] == 600); assert([bounds[@"height"] doubleValue] == 300);
      assert(NSEqualRects(frame, SparkAppKitFrame(bounds, screen)));
      for (int i = 0; i < 100; ++i) {
        NSDictionary *cursor = SparkCursorPoint();
        assert(std::isfinite([cursor[@"x"] doubleValue]) && std::isfinite([cursor[@"y"] doubleValue]));
      }
      assert(events.empty());
      screen = NSMakeRect(0, -1000, 1600, 1000); frame = NSMakeRect(100, -900, 800, 600);
      bounds = SparkLogicalBounds(frame, screen, @"below"); assert([bounds[@"y"] doubleValue] == 300);
      assert(NSEqualRects(frame, SparkAppKitFrame(bounds, screen)));
      puts("Window geometry passed");
    } }`);
    execFileSync("clang++", ["-fobjc-arc", "-std=c++20", "-framework", "AppKit", "-framework", "CoreGraphics", input, "-o", output]);
    expect(execFileSync(output, { encoding: "utf8", timeout: 10000 })).toContain("Window geometry passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
