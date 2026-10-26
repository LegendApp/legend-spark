// RN macOS 0.83.0 Fabric sets a TextInput's accessibilityLabel on its accessibilityElement, the backed text input view.
// A multiline input's backed view is RCTWrappedTextView, a plain view around a scroll view, while the NSTextView inside
// it is the accessibility element, so VoiceOver announces a labelled multiline input without its label. The patch
// keeps the label on that text view.
const fs = require("node:fs");
const path = require("node:path");
const file = "Libraries/Text/TextInput/Multiline/RCTWrappedTextView.m";
// The file has CRLF line endings, so the patch is joined with the source's own.
const before = (eol) => ["#pragma mark First Responder forwarding", ""].join(eol);
const after = (eol) => [
  "#pragma mark Accessibility",
  "",
  "// [Spark] The text view is the accessibility element, so the label React Native sets here describes it.",
  "- (void)setAccessibilityLabel:(NSString *)accessibilityLabel",
  "{",
  "  _forwardingTextView.accessibilityLabel = accessibilityLabel;",
  "}",
  "",
  "- (NSString *)accessibilityLabel",
  "{",
  "  return _forwardingTextView.accessibilityLabel;",
  "}",
  "",
  "#pragma mark -",
  "#pragma mark First Responder forwarding",
  "",
].join(eol);
function patchTextInputAccessibilitySource(source) {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  if (source.includes(after(eol))) return source;
  if (source.split(before(eol)).length !== 2)
    throw new Error(`React Native macOS multiline TextInput source changed (${file}); review the TextInput accessibility patch before building.`);
  return source.replace(before(eol), after(eol));
}
function installTextInputAccessibilityPatch(root) {
  const manifest = require.resolve("react-native-macos/package.json", { paths: [root] });
  const version = JSON.parse(fs.readFileSync(manifest, "utf8")).version;
  if (version !== "0.83.0") throw new Error(`spark's TextInput accessibility patch requires react-native-macos@0.83.0; found ${version}.`);
  const target = path.join(path.dirname(manifest), file);
  const source = fs.readFileSync(target, "utf8"), patched = patchTextInputAccessibilitySource(source);
  if (source !== patched) {
    const temporary = `${target}.spark-${process.pid}.tmp`;
    fs.writeFileSync(temporary, patched);
    fs.renameSync(temporary, target); // Preserve package-manager cache hardlinks.
  }
}
module.exports = { before, after, patchTextInputAccessibilitySource, installTextInputAccessibilityPatch };
