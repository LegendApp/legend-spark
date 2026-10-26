// RN macOS 0.83.0 Fabric leaves natural ("auto" or unset) textAlign as NSTextAlignmentNatural. TextKit resolves that
// from the user's language, not the Yoga layout direction, so text in an RTL subtree of an LTR-localized app aligns
// left. The patch resolves natural alignment from the layout direction. "left" and "right" keep the upstream
// behavior, shared with iOS: they swap in RTL.
const fs = require("node:fs");
const path = require("node:path");
const file = "ReactCommon/react/renderer/textlayoutmanager/platform/ios/react/renderer/textlayoutmanager/RCTAttributedTextUtils.mm";
const before = `  if (textAttributes.alignment.has_value()) {
    TextAlignment textAlignment = textAttributes.alignment.value_or(TextAlignment::Natural);
    if (textAttributes.layoutDirection.value_or(LayoutDirection::LeftToRight) == LayoutDirection::RightToLeft) {
      if (textAlignment == TextAlignment::Right) {
        textAlignment = TextAlignment::Left;
      } else if (textAlignment == TextAlignment::Left) {
        textAlignment = TextAlignment::Right;
      }
    }

    paragraphStyle.alignment = RCTNSTextAlignmentFromTextAlignment(textAlignment);
    isParagraphStyleUsed = YES;
  }
`;
const after = `  // [macOS] TextKit resolves NSTextAlignmentNatural from the user's language, not the Yoga layout direction,
  // so natural ("auto" or unset) alignment is resolved here from the layout direction.
  LayoutDirection layoutDirection = textAttributes.layoutDirection.value_or(LayoutDirection::Undefined);
  if (textAttributes.alignment.has_value() || layoutDirection != LayoutDirection::Undefined) {
    TextAlignment textAlignment = textAttributes.alignment.value_or(TextAlignment::Natural);
    if (textAttributes.layoutDirection.value_or(LayoutDirection::LeftToRight) == LayoutDirection::RightToLeft) {
      if (textAlignment == TextAlignment::Right) {
        textAlignment = TextAlignment::Left;
      } else if (textAlignment == TextAlignment::Left) {
        textAlignment = TextAlignment::Right;
      }
    }
    if (textAlignment == TextAlignment::Natural && layoutDirection != LayoutDirection::Undefined) {
      textAlignment = layoutDirection == LayoutDirection::RightToLeft ? TextAlignment::Right : TextAlignment::Left;
    }

    paragraphStyle.alignment = RCTNSTextAlignmentFromTextAlignment(textAlignment);
    isParagraphStyleUsed = YES;
  }
`;
function patchTextAlignmentSource(source) {
  if (source.includes(after)) return source;
  if (source.split(before).length !== 2)
    throw new Error(`React Native macOS text attribute source changed (${file}); review the RTL text alignment patch before building.`);
  return source.replace(before, after);
}
function installRTLTextAlignmentPatch(root) {
  const manifest = require.resolve("react-native-macos/package.json", { paths: [root] });
  const version = JSON.parse(fs.readFileSync(manifest, "utf8")).version;
  if (version !== "0.83.0") throw new Error(`spark's RTL text alignment patch requires react-native-macos@0.83.0; found ${version}.`);
  const target = path.join(path.dirname(manifest), file);
  const source = fs.readFileSync(target, "utf8"), patched = patchTextAlignmentSource(source);
  if (source !== patched) {
    const temporary = `${target}.spark-${process.pid}.tmp`;
    fs.writeFileSync(temporary, patched);
    fs.renameSync(temporary, target); // Preserve package-manager cache hardlinks.
  }
}
module.exports = { before, after, patchTextAlignmentSource, installRTLTextAlignmentPatch };
