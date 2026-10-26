// RN macOS 0.83.0 Fabric gives a TextInput no layout direction: its text attributes have none, and the iOS
// semanticContentAttribute that makes UIKit's natural alignment follow it isn't set on macOS. TextKit resolves
// NSTextAlignmentNatural from the user's language, so in an RTL layout a TextInput with natural ("auto" or unset)
// textAlign draws its text and placeholder from the left. The patch aligns them to the leading edge of the input's
// layout direction, and again when that changes, as rtl-text-alignment.cjs does for Text. An explicit textAlign is
// unchanged.
const fs = require("node:fs");
const path = require("node:path");
const file = "React/Fabric/Mounting/ComponentViews/TextInput/RCTTextInputComponentView.mm";
const helpers = `// [Spark] TextKit resolves natural alignment from the user's language, not the Yoga layout direction, so a TextInput
// whose textAlign is natural ("auto" or unset) aligns every paragraph, and the placeholder through the default
// attributes, to the leading edge of its layout direction. An explicit textAlign is unchanged.
static std::optional<NSTextAlignment> RCTSparkNaturalAlignment(const TextInputProps &props, LayoutDirection direction)
{
  if (props.textAttributes.alignment.value_or(TextAlignment::Natural) != TextAlignment::Natural ||
      direction == LayoutDirection::Undefined) {
    return std::nullopt;
  }
  return direction == LayoutDirection::RightToLeft ? NSTextAlignmentRight : NSTextAlignmentLeft;
}
static NSParagraphStyle *RCTSparkAlignedParagraphStyle(NSParagraphStyle *style, NSTextAlignment alignment)
{
  NSMutableParagraphStyle *aligned = [(style ?: NSParagraphStyle.defaultParagraphStyle) mutableCopy];
  aligned.alignment = alignment;
  return aligned;
}
static NSMutableDictionary<NSAttributedStringKey, id> *RCTSparkAlignNaturalAttributes(
    NSDictionary<NSAttributedStringKey, id> *attributes, const TextInputProps &props, LayoutDirection direction)
{
  NSMutableDictionary<NSAttributedStringKey, id> *aligned = [attributes mutableCopy];
  if (auto alignment = RCTSparkNaturalAlignment(props, direction)) {
    aligned[NSParagraphStyleAttributeName] = RCTSparkAlignedParagraphStyle(attributes[NSParagraphStyleAttributeName], *alignment);
  }
  return aligned;
}
static NSAttributedString *RCTSparkAlignNaturalText(NSAttributedString *text, const TextInputProps &props, LayoutDirection direction)
{
  auto alignment = RCTSparkNaturalAlignment(props, direction);
  if (!alignment || text.length == 0) {
    return text;
  }
  NSMutableAttributedString *aligned = [text mutableCopy];
  [text enumerateAttribute:NSParagraphStyleAttributeName
                   inRange:NSMakeRange(0, text.length)
                   options:0
                usingBlock:^(NSParagraphStyle *style, NSRange range, BOOL *stop) {
                  [aligned addAttribute:NSParagraphStyleAttributeName
                                  value:RCTSparkAlignedParagraphStyle(style, *alignment)
                                  range:range];
                }];
  return aligned;
}
`;
const replacements = [
  [`using namespace facebook::react;
`, `using namespace facebook::react;

${helpers}`],
  [`  NSMutableDictionary<NSAttributedStringKey, id> *attrs =
      RCTNSTextAttributesFromTextAttributes(props.getEffectiveTextAttributes(RCTFontSizeMultiplier()));
`, `  NSMutableDictionary<NSAttributedStringKey, id> *attrs = RCTSparkAlignNaturalAttributes( // [Spark]
      RCTNSTextAttributesFromTextAttributes(props.getEffectiveTextAttributes(RCTFontSizeMultiplier())),
      props,
      _layoutMetrics.layoutDirection);
`],
  [`        _backedTextInputView.defaultTextAttributes[RCTAttributedStringEventEmitterKey];
    _backedTextInputView.defaultTextAttributes = defaultAttributes;
`, `        _backedTextInputView.defaultTextAttributes[RCTAttributedStringEventEmitterKey];
    _backedTextInputView.defaultTextAttributes = RCTSparkAlignNaturalAttributes( // [Spark]
        defaultAttributes, newTextInputProps, _layoutMetrics.layoutDirection);
`],
  [`  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
`, `  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];

  // [Spark] Natural alignment follows the layout direction, so realign the text and placeholder when it changes.
  if (layoutMetrics.layoutDirection != oldLayoutMetrics.layoutDirection) {
    _backedTextInputView.defaultTextAttributes = RCTSparkAlignNaturalAttributes(
        _backedTextInputView.defaultTextAttributes,
        static_cast<const TextInputProps &>(*_props),
        layoutMetrics.layoutDirection);
    _comingFromJS = YES;
    [self _setAttributedString:_backedTextInputView.attributedText];
    _comingFromJS = NO;
  }
`],
  [`- (void)_setAttributedString:(NSAttributedString *)attributedString
{
`, `- (void)_setAttributedString:(NSAttributedString *)attributedString
{
  attributedString = RCTSparkAlignNaturalText( // [Spark]
      attributedString, static_cast<const TextInputProps &>(*_props), _layoutMetrics.layoutDirection);
`],
];
function patchTextInputAlignmentSource(source) {
  if (replacements.every(([, after]) => source.includes(after))) return source;
  if (replacements.some(([before, after]) => source.split(before).length !== 2 || source.includes(after)))
    throw new Error(`React Native macOS TextInput source changed (${file}); review the RTL TextInput alignment patch before building.`);
  return replacements.reduce((patched, [before, after]) => patched.replace(before, after), source);
}
function installRTLTextInputAlignmentPatch(root) {
  const manifest = require.resolve("react-native-macos/package.json", { paths: [root] });
  const version = JSON.parse(fs.readFileSync(manifest, "utf8")).version;
  if (version !== "0.83.0") throw new Error(`spark's RTL TextInput alignment patch requires react-native-macos@0.83.0; found ${version}.`);
  const target = path.join(path.dirname(manifest), file);
  const source = fs.readFileSync(target, "utf8"), patched = patchTextInputAlignmentSource(source);
  if (source !== patched) {
    const temporary = `${target}.spark-${process.pid}.tmp`;
    fs.writeFileSync(temporary, patched);
    fs.renameSync(temporary, target); // Preserve package-manager cache hardlinks.
  }
}
module.exports = { file, helpers, replacements, patchTextInputAlignmentSource, installRTLTextInputAlignmentPatch };
