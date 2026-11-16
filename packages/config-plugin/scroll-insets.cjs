// RN macOS disables AppKit inset adjustment unconditionally. Honor its existing
// cross-platform opt-in without changing the default, including reusable views.
const fs = require("node:fs");
const path = require("node:path");
const base = "React/Fabric/Mounting/ComponentViews/ScrollView/";
const insetEnum = `#if TARGET_OS_OSX
typedef NS_ENUM(NSInteger, RCTScrollViewInsetAdjustment) {
  RCTScrollViewInsetAdjustmentNever = 0,
  RCTScrollViewInsetAdjustmentAutomatic,
  RCTScrollViewInsetAdjustmentScrollableAxes,
  RCTScrollViewInsetAdjustmentAlways,
};
#endif

`;
const insetMethods = `#if TARGET_OS_OSX
- (void)setInsetAdjustmentBehavior:(RCTScrollViewInsetAdjustment)behavior
{
  if (_insetAdjustmentBehavior == behavior) return;
  _insetAdjustmentBehavior = behavior;
  self.automaticallyAdjustsContentInsets = behavior != RCTScrollViewInsetAdjustmentNever;
  [self setNeedsLayout:YES];
}

- (void)setContentInsets:(NSEdgeInsets)insets
{
  if (_insetAdjustmentBehavior == RCTScrollViewInsetAdjustmentScrollableAxes) {
  // Preserve NSView.safeAreaInsets: AppKit uses that geometry for native
  // scroll-edge masks. Only filter the insets applied to the document.
  // RN owns document sizing. Insets on a non-scrolling axis otherwise introduce
  // phantom scroll range instead of shrinking the document as AppKit expects.
  NSSize content = self.documentView.frame.size;
  NSSize viewport = self.bounds.size;
  // RN explicitly enables elasticity for alwaysBounceHorizontal/Vertical.
  // Such an axis remains scrollable even when its current document is short.
  if (content.width <= viewport.width && self.horizontalScrollElasticity != NSScrollElasticityAllowed) insets.left = insets.right = 0;
  if (content.height <= viewport.height && self.verticalScrollElasticity != NSScrollElasticityAllowed) insets.top = insets.bottom = 0;
  }
  [super setContentInsets:insets];
}
#endif

`;
const mapping = `#else // macOS: opt in through the existing RN prop, never by default.
  if (oldScrollViewProps.contentInsetAdjustmentBehavior != newScrollViewProps.contentInsetAdjustmentBehavior ||
      _shouldUpdateContentInsetAdjustmentBehavior) {
    const auto behavior = newScrollViewProps.contentInsetAdjustmentBehavior;
    if (behavior == ContentInsetAdjustmentBehavior::Automatic) {
      scrollView.insetAdjustmentBehavior = RCTScrollViewInsetAdjustmentAutomatic;
    } else if (behavior == ContentInsetAdjustmentBehavior::ScrollableAxes) {
      scrollView.insetAdjustmentBehavior = RCTScrollViewInsetAdjustmentScrollableAxes;
    } else if (behavior == ContentInsetAdjustmentBehavior::Always) {
      scrollView.insetAdjustmentBehavior = RCTScrollViewInsetAdjustmentAlways;
    } else {
      scrollView.insetAdjustmentBehavior = RCTScrollViewInsetAdjustmentNever;
    }
    _shouldUpdateContentInsetAdjustmentBehavior = NO;
  }
`;
const property = "@property (nonatomic, weak) id<RCTEnhancedScrollViewOverridingDelegate> overridingDelegate;";
const componentEnd = "    _shouldUpdateContentInsetAdjustmentBehavior = NO;\n  }\n#endif // [macOS]\n\n  MAP_SCROLL_VIEW_PROP(disableIntervalMomentum);";
const recycle = "  _scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;\n#endif // [macOS]\n  _shouldUpdateContentInsetAdjustmentBehavior = YES;";
const replacements = {
  [base + "RCTEnhancedScrollView.h"]: [
    ["@interface RCTEnhancedScrollView : RCTUIScrollView", insetEnum + "@interface RCTEnhancedScrollView : RCTUIScrollView"],
    [property, "#if TARGET_OS_OSX\n@property (nonatomic, assign) RCTScrollViewInsetAdjustment insetAdjustmentBehavior;\n#endif\n\n" + property],
  ],
  [base + "RCTEnhancedScrollView.mm"]: [
    ["- (void)preserveContentOffsetWithBlock:", insetMethods + "- (void)preserveContentOffsetWithBlock:"],
  ],
  [base + "RCTScrollViewComponentView.mm"]: [
    [componentEnd, componentEnd.replace("#endif // [macOS]", mapping + "#endif // [macOS]")],
    [recycle, recycle.replace("#endif // [macOS]", "#else\n  ((RCTEnhancedScrollView *)_scrollView).insetAdjustmentBehavior = RCTScrollViewInsetAdjustmentNever;\n#endif // [macOS]")],
  ],
};
function patchScrollInsetSources(sources) {
  const result = {};
  for (const [file, pairs] of Object.entries(replacements)) {
    const source = sources[file];
    if (typeof source !== "string") throw new Error(`Missing React Native macOS scroll-inset source: ${file}`);
    if (pairs.every(([, after]) => source.includes(after))) { result[file] = source; continue; }
    if (pairs.some(([before, after]) => source.includes(after) || source.split(before).length !== 2))
      throw new Error(`React Native macOS scroll-inset source changed (${file}); review before building.`);
    result[file] = pairs.reduce((value, [before, after]) => value.replace(before, after), source);
  }
  return result;
}
function installScrollInsetsPatch(root) {
  const manifest = require.resolve("react-native-macos/package.json", { paths: [root] });
  const version = JSON.parse(fs.readFileSync(manifest, "utf8")).version;
  if (version !== "0.83.0") throw new Error(`Spark scroll-inset patch requires react-native-macos@0.83.0; found ${version}.`);
  const directory = path.dirname(manifest);
  const before = Object.fromEntries(Object.keys(replacements).map(file => [file, fs.readFileSync(path.join(directory, file), "utf8")]));
  // Validate the complete set before touching any file; preserve manager cache hardlinks.
  const after = patchScrollInsetSources(before);
  for (const [file, content] of Object.entries(after)) {
    if (content === before[file]) continue;
    const target = path.join(directory, file), temporary = `${target}.spark-${process.pid}.tmp`;
    fs.writeFileSync(temporary, content); fs.renameSync(temporary, target);
  }
}
module.exports = { replacements, insetEnum, insetMethods, patchScrollInsetSources, installScrollInsetsPatch };
