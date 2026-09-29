import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
test.skipIf(process.platform !== "darwin")("initial AppKit window options size the outer frame and retain its top edge", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-initial-window-"));
  try {
    const source = readFileSync("packages/desktop-app/macos/SparkWindow.mm", "utf8").replace('#import "SparkDesktop.h"', `#import <AppKit/AppKit.h>
NSDictionary *SparkContext(void) { return @{}; }
NSDictionary *SparkArgs(NSString *json) { return @{}; }
NSString *SparkNamespace(void) { return @"test"; }`);
    const input = path.join(directory, "test.mm"), output = path.join(directory, "test");
    writeFileSync(input, source + `
#include <cassert>
@interface FrameWindow : NSObject
@property NSRect frame;
@property NSSize minSize;
@property NSSize maxSize;
@property NSWindowStyleMask styleMask;
@property BOOL titlebarAppearsTransparent;
@property NSWindowTitleVisibility titleVisibility;
@property NSInteger level;
@property BOOL hasShadow;
@property (getter=isOpaque) BOOL opaque;
@property NSAppearance *appearance;
@property NSColor *backgroundColor;
@property NSView *contentView;
@property NSString *title;
@end
@implementation FrameWindow
- (NSButton *)standardWindowButton:(NSWindowButton)button { return nil; }
- (void)setFrame:(NSRect)frame display:(BOOL)display { self.frame = frame; }
@end
int main() { @autoreleasepool {
  FrameWindow *window = [FrameWindow new]; window.frame = NSMakeRect(40, 100, 1000, 700);
  SparkApplyWindowOptions((NSWindow *)window, @{ @"width": @900, @"height": @600, @"minWidth": @400, @"maxHeight": @650 });
  assert(window.frame.size.width == 900); assert(window.frame.size.height == 600);
  assert(window.frame.origin.y == 200); assert(window.minSize.width == 400);
  assert(window.maxSize.height == 650);
  SparkApplyWindowOptions((NSWindow *)window, @{ @"width": @200, @"height": @900 });
  assert(window.frame.size.width == 400); assert(window.frame.size.height == 650);
  puts("Initial outer frame passed");
} }
`);
    execFileSync("clang++", ["-fobjc-arc", "-std=c++20", "-framework", "AppKit", "-framework", "QuartzCore", input, "-o", output]);
    expect(execFileSync(output, { encoding: "utf8", timeout: 10000 })).toContain("Initial outer frame passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
