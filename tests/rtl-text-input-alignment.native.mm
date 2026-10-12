#import <AppKit/AppKit.h>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <optional>
namespace facebook::react {
// Fabric types are stubbed; the helpers below are the patch's source.
enum class LayoutDirection { Undefined, LeftToRight, RightToLeft };
enum class TextAlignment { Natural, Left, Center, Right, Justified };
struct TextAttributes { std::optional<TextAlignment> alignment; };
struct TextInputProps { TextAttributes textAttributes; };
}
using namespace facebook::react;

// ACTUAL_HELPERS

static int failures = 0;
static void fail(const char *what, CGFloat x, CGFloat expected)
{
  std::printf("FAIL %s: line at x=%g, expected %g\n", what, x, expected);
  failures++;
}

// RN's upstream default attributes for a TextInput without textAlign: no paragraph style.
static NSDictionary *Upstream(std::optional<TextAlignment> alignment)
{
  NSMutableDictionary *attributes = [@{NSFontAttributeName : [NSFont systemFontOfSize:14], NSForegroundColorAttributeName : NSColor.blackColor} mutableCopy];
  if (alignment) {
    NSMutableParagraphStyle *style = [NSMutableParagraphStyle new];
    style.alignment = *alignment == TextAlignment::Left ? NSTextAlignmentLeft
        : *alignment == TextAlignment::Right ? NSTextAlignmentRight
        : *alignment == TextAlignment::Center ? NSTextAlignmentCenter
        : NSTextAlignmentNatural;
    attributes[NSParagraphStyleAttributeName] = style;
  }
  return attributes;
}

// A multiline input (RCTUITextView, an NSTextView) lays its text out, and draws its placeholder, with TextKit in a
// 600pt container. Returns the line's left edge.
static CGFloat TextViewX(NSAttributedString *text)
{
  NSTextView *view = [[NSTextView alloc] initWithFrame:NSMakeRect(0, 0, 600, 100)];
  view.textContainer.lineFragmentPadding = 0;
  [view.textStorage setAttributedString:text];
  [view.layoutManager ensureLayoutForTextContainer:view.textContainer];
  return [view.layoutManager usedRectForTextContainer:view.textContainer].origin.x;
}
// A single-line input (RCTUITextField, an NSTextField) shows its text or its placeholder. Returns the leftmost ink.
static CGFloat FieldX(NSAttributedString *text, BOOL placeholder)
{
  NSTextField *field = [[NSTextField alloc] initWithFrame:NSMakeRect(0, 0, 600, 22)];
  field.bordered = NO;
  field.drawsBackground = NO;
  if (placeholder) field.placeholderAttributedString = text;
  else field.attributedStringValue = text;
  NSBitmapImageRep *rep = [field bitmapImageRepForCachingDisplayInRect:field.bounds];
  [field cacheDisplayInRect:field.bounds toBitmapImageRep:rep];
  for (NSInteger x = 0; x < rep.pixelsWide; x++)
    for (NSInteger y = 0; y < rep.pixelsHigh; y++)
      if ([rep colorAtX:x y:y].alphaComponent > 0.3) return x * 600.0 / rep.pixelsWide;
  return -1;
}

enum class Edge { Left, Right };
static NSAttributedString *Aligned(NSString *string, NSDictionary *defaults, NSTextAlignment alignment)
{
  NSMutableDictionary *attributes = [defaults mutableCopy];
  NSMutableParagraphStyle *style = [NSMutableParagraphStyle new];
  style.alignment = alignment;
  attributes[NSParagraphStyleAttributeName] = style;
  return [[NSAttributedString alloc] initWithString:string attributes:attributes];
}
// Checks where the text and the placeholder of both input kinds land with the given default attributes and text.
static void expectEdge(const char *what, NSString *string, NSDictionary *defaults, NSAttributedString *text, Edge edge)
{
  NSAttributedString *placeholder = [[NSAttributedString alloc] initWithString:string attributes:defaults];
  NSAttributedString *reference = Aligned(string, defaults, edge == Edge::Left ? NSTextAlignmentLeft : NSTextAlignmentRight);
  struct { const char *kind; CGFloat x, expected; } checks[] = {
    {"multiline text", TextViewX(text), TextViewX(reference)},
    {"multiline placeholder", TextViewX(placeholder), TextViewX(reference)},
    {"single-line text", FieldX(text, NO), FieldX(reference, NO)},
    {"single-line placeholder", FieldX(placeholder, YES), FieldX(reference, YES)},
  };
  for (const auto &check : checks) {
    if (std::fabs(check.x - check.expected) > 1) {
      char label[160];
      std::snprintf(label, sizeof label, "%s (%s)", what, check.kind);
      fail(label, check.x, check.expected);
    }
  }
}

// Applies the patch as RCTTextInputComponentView does: default attributes, then the state's text.
static void expectInput(const char *what, NSString *string, std::optional<TextAlignment> alignment, LayoutDirection direction, Edge edge)
{
  TextInputProps props{{alignment}};
  NSDictionary *defaults = RCTSparkAlignNaturalAttributes(Upstream(alignment), props, direction);
  NSAttributedString *state = [[NSAttributedString alloc] initWithString:string attributes:Upstream(alignment)];
  expectEdge(what, string, defaults, RCTSparkAlignNaturalText(state, props, direction), edge);
}

int main(int argc, const char **argv)
{
  @autoreleasepool {
    [NSApplication sharedApplication];
    const char *scenario = argc > 1 ? argv[1] : "";
    NSString *arabic = @"نص في حقل بعرض كامل.", *english = @"Text in a full-width field.";
    const auto RTL = LayoutDirection::RightToLeft, LTR = LayoutDirection::LeftToRight;
    if (!std::strcmp(scenario, "upstream")) {
      // The bug: in an LTR-localized process, a TextInput's natural alignment lands at the left, even for Arabic.
      NSAttributedString *text = [[NSAttributedString alloc] initWithString:arabic attributes:Upstream(std::nullopt)];
      expectEdge("upstream unset", arabic, Upstream(std::nullopt), text, Edge::Left);
    } else if (!std::strcmp(scenario, "rtl-natural")) {
      for (NSString *text in @[ arabic, english ]) {
        expectInput("unset in RTL", text, std::nullopt, RTL, Edge::Right);
        expectInput("auto in RTL", text, TextAlignment::Natural, RTL, Edge::Right);
      }
      // Other paragraph attributes, such as lineHeight's, are kept.
      NSMutableParagraphStyle *style = [NSMutableParagraphStyle new];
      style.minimumLineHeight = 30;
      NSMutableDictionary *attributes = [Upstream(std::nullopt) mutableCopy];
      attributes[NSParagraphStyleAttributeName] = style;
      NSParagraphStyle *aligned = RCTSparkAlignNaturalAttributes(attributes, {}, RTL)[NSParagraphStyleAttributeName];
      if (aligned.minimumLineHeight != 30 || aligned.alignment != NSTextAlignmentRight) {
        std::printf("FAIL natural alignment dropped the paragraph style\n"); failures++;
      }
    } else if (!std::strcmp(scenario, "ltr")) {
      expectInput("unset in LTR", english, std::nullopt, LTR, Edge::Left);
      expectInput("auto in LTR", arabic, TextAlignment::Natural, LTR, Edge::Left);
    } else if (!std::strcmp(scenario, "direction-change")) {
      // On a direction change the view realigns its current, already aligned, attributes and text.
      TextInputProps props{};
      NSDictionary *defaults = RCTSparkAlignNaturalAttributes(Upstream(std::nullopt), props, RTL);
      NSAttributedString *text = RCTSparkAlignNaturalText([[NSAttributedString alloc] initWithString:arabic attributes:Upstream(std::nullopt)], props, RTL);
      expectEdge("RTL", arabic, defaults, text, Edge::Right);
      defaults = RCTSparkAlignNaturalAttributes(defaults, props, LTR);
      text = RCTSparkAlignNaturalText(text, props, LTR);
      expectEdge("RTL then LTR", arabic, defaults, text, Edge::Left);
      expectEdge("LTR then RTL", arabic, RCTSparkAlignNaturalAttributes(defaults, props, RTL), RCTSparkAlignNaturalText(text, props, RTL), Edge::Right);
    } else if (!std::strcmp(scenario, "explicit")) {
      // An explicit textAlign keeps the upstream attributes in either direction, as does an input not laid out yet.
      for (auto alignment : {TextAlignment::Left, TextAlignment::Right, TextAlignment::Center, TextAlignment::Justified}) {
        for (auto direction : {RTL, LTR}) {
          TextInputProps props{{alignment}};
          NSDictionary *attributes = Upstream(alignment);
          NSAttributedString *text = [[NSAttributedString alloc] initWithString:arabic attributes:attributes];
          if (![RCTSparkAlignNaturalAttributes(attributes, props, direction) isEqualToDictionary:attributes] ||
              RCTSparkAlignNaturalText(text, props, direction) != text) {
            std::printf("FAIL explicit alignment %d changed\n", (int)alignment); failures++;
          }
        }
      }
      expectInput("left in RTL", arabic, TextAlignment::Left, RTL, Edge::Left);
      expectInput("right in LTR", english, TextAlignment::Right, LTR, Edge::Right);
      NSAttributedString *text = [[NSAttributedString alloc] initWithString:arabic attributes:Upstream(std::nullopt)];
      if (RCTSparkAlignNaturalAttributes(Upstream(std::nullopt), {}, LayoutDirection::Undefined)[NSParagraphStyleAttributeName] != nil ||
          RCTSparkAlignNaturalText(text, {}, LayoutDirection::Undefined) != text) {
        std::printf("FAIL an input without a layout direction was aligned\n"); failures++;
      }
    } else {
      std::printf("FAIL unknown scenario %s\n", scenario);
      return 2;
    }
    if (failures) return 1;
    std::printf("PASS %s\n", scenario);
  }
  return 0;
}
