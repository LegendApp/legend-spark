import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function runNative(source: string) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-rich-text-"));
  try {
    const input = path.join(directory, "test.mm");
    const output = path.join(directory, "test");
    writeFileSync(input, `#import <AppKit/AppKit.h>\n#include <assert.h>\n${source}`);
    execFileSync("clang++", ["-fobjc-arc", "-fblocks", "-framework", "AppKit", input, "-o", output]);
    expect(execFileSync(output, { encoding: "utf8", timeout: 15000 })).toContain("passed");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const root = path.resolve(import.meta.dirname, "..");
test.skipIf(process.platform !== "darwin")("Markdown input keeps its assigned width after native text resizing", () => {
  const source = readFileSync(path.join(root, "node_modules/react-native-enriched-markdown/ios/input/EnrichedMarkdownTextInput.mm"), "utf8");
  const start = source.indexOf("  _scrollView.autoresizingMask =");
  const end = source.indexOf("  ENRMConfigureInputScrolling(", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const setup = source.slice(source.indexOf("\n", start) + 1, end);
  const scrolling = path.join(root, "node_modules/react-native-enriched-markdown/ios/utils/ENRMInputScrolling.h");
  runNative(`
#import "${scrolling}"
int main() { @autoreleasepool {
  [NSApplication sharedApplication];
  NSTextView *_textView = [[NSTextView alloc] initWithFrame:NSZeroRect];
  NSView *container = [NSView new];
  NSScrollView *scroll = [NSScrollView new];
  ${setup}
  for (NSNumber *enabled in @[@NO, @YES, @NO]) {
    ENRMConfigureInputScrolling(container, scroll, _textView, enabled.boolValue);
    _textView.frame = NSMakeRect(0, 0, 900, 60);
    _textView.textContainer.size = NSMakeSize(900, CGFLOAT_MAX);
    [_textView insertText:@"Markdown verification" replacementRange:NSMakeRange(0, 0)];
    [_textView sizeToFit];
    assert(_textView.frame.size.width == 900);
    assert(_textView.verticallyResizable == enabled.boolValue);
  }

  puts("Markdown native resizing passed");
} }
`);
}, 25000);
