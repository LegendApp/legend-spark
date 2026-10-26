// RN macOS 0.83.0 Fabric applies accessibilityState only on iOS: RCTViewComponentView's accessibilityState block is
// inside #if !TARGET_OS_OSX, so a disabled Pressable with an accessibilityRole reports itself enabled to VoiceOver and a
// selected one unselected. A view whose accessibility traits never changed (no accessibilityRole) reported
// isAccessibilityEnabled NO, as a plain NSView does, enabled or not. The patch answers both from the view's current
// props, which covers the first mount, recycled views and every update: enabled unless accessibilityState.disabled or
// the not-enabled trait, selected when accessibilityState.selected.
const fs = require("node:fs");
const path = require("node:path");
const file = "React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm";
const methods = `#if TARGET_OS_OSX // [Spark] accessibilityState, which upstream applies only on iOS, read from the current props.
- (BOOL)isAccessibilityEnabled
{
  return !_props->accessibilityState.value_or(AccessibilityState{}).disabled &&
      (_props->accessibilityTraits & AccessibilityTraits::NotEnabled) == AccessibilityTraits::None;
}

- (BOOL)isAccessibilitySelected
{
  return _props->accessibilityState.value_or(AccessibilityState{}).selected;
}
#endif // [Spark]
`;
const before = `#else // [macOS
- (NSView *)accessibilityElement // macOS]
#endif // macOS]
{
  return self;
}
`;
const after = `${before}
${methods}`;
function patchAccessibilityStateSource(source) {
  if (source.includes(after)) return source;
  if (source.split(before).length !== 2)
    throw new Error(`React Native macOS View source changed (${file}); review the accessibility state patch before building.`);
  return source.replace(before, after);
}
function installAccessibilityStatePatch(root) {
  const manifest = require.resolve("react-native-macos/package.json", { paths: [root] });
  const version = JSON.parse(fs.readFileSync(manifest, "utf8")).version;
  if (version !== "0.83.0") throw new Error(`spark's accessibility state patch requires react-native-macos@0.83.0; found ${version}.`);
  const target = path.join(path.dirname(manifest), file);
  const source = fs.readFileSync(target, "utf8"), patched = patchAccessibilityStateSource(source);
  if (source !== patched) {
    const temporary = `${target}.spark-${process.pid}.tmp`;
    fs.writeFileSync(temporary, patched);
    fs.renameSync(temporary, target); // Preserve package-manager cache hardlinks.
  }
}
module.exports = { file, methods, before, after, patchAccessibilityStateSource, installAccessibilityStatePatch };
