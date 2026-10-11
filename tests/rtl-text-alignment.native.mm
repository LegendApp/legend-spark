#import <AppKit/AppKit.h>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <optional>
namespace facebook::react {
// Fabric text types are stubbed; the alignment blocks below are RN macOS source.
enum class LayoutDirection { Undefined, LeftToRight, RightToLeft };
enum class TextAlignment { Natural, Left, Center, Right, Justified };
struct TextAttributes { std::optional<TextAlignment> alignment; std::optional<LayoutDirection> layoutDirection; };
}
using namespace facebook::react;

// ACTUAL_CONVERSION

// The paragraph alignment step of RCTNSTextAttributesFromTextAttributes, patched and as shipped.
static NSParagraphStyle *Patched(const TextAttributes &textAttributes)
{
  NSMutableParagraphStyle *paragraphStyle = [NSMutableParagraphStyle new];
  BOOL isParagraphStyleUsed = NO;
// ACTUAL_PATCHED
  return isParagraphStyleUsed ? paragraphStyle : nil;
}
static NSParagraphStyle *Upstream(const TextAttributes &textAttributes)
{
  NSMutableParagraphStyle *paragraphStyle = [NSMutableParagraphStyle new];
  BOOL isParagraphStyleUsed = NO;
// ACTUAL_UPSTREAM
  return isParagraphStyleUsed ? paragraphStyle : nil;
}

// Lays the text out as RCTTextLayoutManager does, in a 600pt box, and returns the line's left edge.
static CGFloat LineX(NSString *text, NSParagraphStyle *style)
{
  NSMutableDictionary *attributes = [@{NSFontAttributeName : [NSFont systemFontOfSize:14]} mutableCopy];
  if (style) attributes[NSParagraphStyleAttributeName] = style;
  NSTextStorage *storage = [[NSTextStorage alloc] initWithString:text attributes:attributes];
  NSLayoutManager *layoutManager = [NSLayoutManager new];
  NSTextContainer *container = [[NSTextContainer alloc] initWithSize:NSMakeSize(600, CGFLOAT_MAX)];
  container.lineFragmentPadding = 0;
  [layoutManager addTextContainer:container];
  [storage addLayoutManager:layoutManager];
  [layoutManager ensureLayoutForTextContainer:container];
  return [layoutManager usedRectForTextContainer:container].origin.x;
}

static int failures = 0;
enum class Edge { Left, Center, Right };
static void expectEdge(const char *what, NSString *text, NSParagraphStyle *style, Edge edge)
{
  NSMutableParagraphStyle *right = [NSMutableParagraphStyle new];
  right.alignment = NSTextAlignmentRight;
  CGFloat x = LineX(text, style), rightX = LineX(text, right);
  CGFloat expected = edge == Edge::Left ? 0 : edge == Edge::Right ? rightX : rightX / 2;
  if (std::fabs(x - expected) > 1) { std::printf("FAIL %s: line at x=%g, expected %g\n", what, x, expected); failures++; }
}

int main(int argc, const char **argv)
{
  @autoreleasepool {
    const char *scenario = argc > 1 ? argv[1] : "";
    NSString *arabic = @"نص في مربع بعرض كامل.", *english = @"Text in a full-width box.";
    const auto RTL = LayoutDirection::RightToLeft, LTR = LayoutDirection::LeftToRight;
    if (!std::strcmp(scenario, "upstream")) {
      // The bug: in an LTR-localized process, natural alignment in an RTL subtree lands at the left, even for Arabic.
      expectEdge("upstream unset in RTL", arabic, Upstream({std::nullopt, RTL}), Edge::Left);
      expectEdge("upstream auto in RTL", arabic, Upstream({TextAlignment::Natural, RTL}), Edge::Left);
    } else if (!std::strcmp(scenario, "rtl-natural")) {
      for (NSString *text in @[ arabic, english ]) {
        expectEdge("unset in RTL", text, Patched({std::nullopt, RTL}), Edge::Right);
        expectEdge("auto in RTL", text, Patched({TextAlignment::Natural, RTL}), Edge::Right);
      }
    } else if (!std::strcmp(scenario, "rtl-explicit")) {
      // As upstream and on iOS: left and right swap in RTL; center and the justified last line are unchanged.
      expectEdge("left in RTL", arabic, Patched({TextAlignment::Left, RTL}), Edge::Right);
      expectEdge("right in RTL", arabic, Patched({TextAlignment::Right, RTL}), Edge::Left);
      expectEdge("center in RTL", arabic, Patched({TextAlignment::Center, RTL}), Edge::Center);
      for (auto alignment : {TextAlignment::Left, TextAlignment::Right, TextAlignment::Center, TextAlignment::Justified}) {
        if (Patched({alignment, RTL}).alignment != Upstream({alignment, RTL}).alignment) {
          std::printf("FAIL explicit alignment %d changed in RTL\n", (int)alignment); failures++;
        }
      }
    } else if (!std::strcmp(scenario, "ltr")) {
      expectEdge("unset in LTR", english, Patched({std::nullopt, LTR}), Edge::Left);
      expectEdge("auto in LTR", arabic, Patched({TextAlignment::Natural, LTR}), Edge::Left);
      expectEdge("left in LTR", english, Patched({TextAlignment::Left, LTR}), Edge::Left);
      expectEdge("right in LTR", english, Patched({TextAlignment::Right, LTR}), Edge::Right);
    } else if (!std::strcmp(scenario, "no-direction")) {
      // Attributes without a layout direction (such as TextInput's) keep the upstream paragraph style.
      if (Patched({std::nullopt, std::nullopt}) != nil) { std::printf("FAIL unset alignment and direction used a paragraph style\n"); failures++; }
      if (Patched({TextAlignment::Natural, std::nullopt}).alignment != NSTextAlignmentNatural) { std::printf("FAIL auto without a direction was resolved\n"); failures++; }
    } else {
      std::printf("FAIL unknown scenario %s\n", scenario);
      return 2;
    }
    if (failures) return 1;
    std::printf("PASS %s\n", scenario);
  }
  return 0;
}
