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

test.skipIf(process.platform !== "darwin")("HTML list toggles retain inline formatting and links", () => {
  const source = readFileSync(path.join(root, "node_modules/react-native-enriched-html/macos/EnrichedTextInputView.mm"), "utf8");
  const method = (name: string, next: string) => source.slice(source.indexOf(`- (${name}`), source.indexOf(`- (${next}`, source.indexOf(`- (${name}`)));
  runNative(`
static NSAttributedStringKey const ENBlock = @"ENBlock";
@interface Editor : NSObject { NSTextView *_editor; NSDictionary *_defaults; }
- (void)run;
@end
@implementation Editor
- (void)recordUndo {}
- (void)changed {}
${method("NSDictionary *)activeAttributes", "void)emitSelection")}
${method("void)changeAttributes", "void)toggleTrait")}
${method("void)toggleBlock", "void)toggleH1")}
- (void)run {
  _editor = [[NSTextView alloc] initWithFrame:NSMakeRect(0, 0, 900, 60)];
  NSFont *font = [[NSFontManager sharedFontManager] convertFont:[NSFont systemFontOfSize:16] toHaveTrait:NSBoldFontMask | NSItalicFontMask];
  _defaults = @{NSFontAttributeName: [NSFont systemFontOfSize:16]};
  [_editor.textStorage setAttributedString:[[NSAttributedString alloc] initWithString:@"linked item" attributes:@{NSFontAttributeName:font, NSLinkAttributeName:@"https://legendapp.com"}]];
  _editor.selectedRange = NSMakeRange(0, _editor.string.length);
  for (NSString *kind in @[@"ol", @"ul", @"ul"]) {
    [self toggleBlock:kind];
    NSDictionary *attributes = [_editor.textStorage attributesAtIndex:0 effectiveRange:nil];
    assert(([[NSFontManager sharedFontManager] traitsOfFont:attributes[NSFontAttributeName]] & (NSBoldFontMask | NSItalicFontMask)) == (NSBoldFontMask | NSItalicFontMask));
    assert([attributes[NSLinkAttributeName] isEqual:@"https://legendapp.com"]);
  }
}
@end
int main() { @autoreleasepool { [NSApplication sharedApplication]; [[Editor new] run]; puts("HTML list formatting passed"); } }
`);
}, 25000);
