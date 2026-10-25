// RN macOS 0.81.7 Fabric mirrors ScrollView content in RTL: it flips the content container with a
// layer transform, but the scroll view flip that cancels it on iOS is iOS-only. AppKit ignores layer
// transforms when it scrolls NSClipView and routes events, so macOS flips nothing (Yoga already
// places RTL content), reports offsets unconverted, and anchors RTL content to its right end.
const fs = require("node:fs");
const path = require("node:path");
const file = "React/Fabric/Mounting/ComponentViews/ScrollView/RCTScrollViewComponentView.mm";
const replacements = [
  [
    `- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics
           oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  if (layoutMetrics.layoutDirection != oldLayoutMetrics.layoutDirection) {
    CGAffineTransform transform = (layoutMetrics.layoutDirection == LayoutDirection::LeftToRight)
        ? CGAffineTransformIdentity
        : CGAffineTransformMakeScale(-1, 1);

    _containerView.transform = transform;
#if !TARGET_OS_OSX // [macOS]
    _scrollView.transform = transform;
#endif // [macOS]
  }
}
`,
    `#if TARGET_OS_OSX // [macOS
// iOS mirrors both the scroll view and its content in RTL, so offset 0 shows the content's right end.
// AppKit scrolls NSClipView by bounds origin and routes clicks, wheel deltas and scroller drags
// without layer transforms, so macOS flips nothing: Yoga already places RTL content. Instead the
// visible region keeps its distance from the content's right end, as the mirrored iOS offset does,
// and a scroll view that becomes RTL starts there (the RTL leading edge).
static void RCTPreserveRTLRightEdge(RCTUIScrollView *scrollView, BOOL wasRTL, BOOL isRTL, void (^block)(void))
{
  CGFloat viewport = scrollView.frame.size.width;
  CGFloat fromRight =
      wasRTL && viewport > 0 ? fmax(scrollView.contentSize.width - viewport - scrollView.contentOffset.x, 0) : 0;
  block();
  if (!isRTL) {
    return;
  }
  CGFloat x = fmax(scrollView.contentSize.width - scrollView.frame.size.width - fromRight, 0);
  if (x != scrollView.contentOffset.x) {
    scrollView.contentOffset = CGPointMake(x, scrollView.contentOffset.y);
  }
}
#endif // macOS]

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics
           oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
#if !TARGET_OS_OSX // [macOS]
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  if (layoutMetrics.layoutDirection != oldLayoutMetrics.layoutDirection) {
    CGAffineTransform transform = (layoutMetrics.layoutDirection == LayoutDirection::LeftToRight)
        ? CGAffineTransformIdentity
        : CGAffineTransformMakeScale(-1, 1);

    _containerView.transform = transform;
    _scrollView.transform = transform;
  }
#else // [macOS
  RCTPreserveRTLRightEdge(
      _scrollView,
      _layoutMetrics.layoutDirection == LayoutDirection::RightToLeft,
      layoutMetrics.layoutDirection == LayoutDirection::RightToLeft,
      ^{
        [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
      });
#endif // macOS]
}
`,
  ],
  [
    `  _containerView.frame = CGRect{RCTCGPointFromPoint(data.contentBoundingRect.origin), contentSize};

  [self _preserveContentOffsetIfNeededWithBlock:^{
    self->_scrollView.contentSize = contentSize;
  }];
`,
    `#if !TARGET_OS_OSX // [macOS]
  _containerView.frame = CGRect{RCTCGPointFromPoint(data.contentBoundingRect.origin), contentSize};

  [self _preserveContentOffsetIfNeededWithBlock:^{
    self->_scrollView.contentSize = contentSize;
  }];
#else // [macOS
  // contentSize reads the container (document view) frame, so measure before resizing it.
  CGRect containerFrame = CGRect{RCTCGPointFromPoint(data.contentBoundingRect.origin), contentSize};
  BOOL isRTL = _layoutMetrics.layoutDirection == LayoutDirection::RightToLeft;
  RCTPreserveRTLRightEdge(_scrollView, isRTL, isRTL, ^{
    self->_containerView.frame = containerFrame;
    [self _preserveContentOffsetIfNeededWithBlock:^{
      self->_scrollView.contentSize = contentSize;
    }];
  });
#endif // macOS]
`,
  ],
  [
    `  if (_layoutMetrics.layoutDirection == LayoutDirection::RightToLeft) {
    metrics.contentOffset.x = metrics.contentSize.width - metrics.containerSize.width - metrics.contentOffset.x;
  }
`,
    `#if !TARGET_OS_OSX // [macOS] The unmirrored macOS offset already counts from the left edge.
  if (_layoutMetrics.layoutDirection == LayoutDirection::RightToLeft) {
    metrics.contentOffset.x = metrics.contentSize.width - metrics.containerSize.width - metrics.contentOffset.x;
  }
#endif // [macOS]
`,
  ],
  [
    `  if (_layoutMetrics.layoutDirection == LayoutDirection::RightToLeft) {
    // Adjusting offset.x in right to left layout direction.
    offset.x = self.contentSize.width - _scrollView.frame.size.width - offset.x;
  }
`,
    `#if !TARGET_OS_OSX // [macOS] The unmirrored macOS offset already counts from the left edge.
  if (_layoutMetrics.layoutDirection == LayoutDirection::RightToLeft) {
    // Adjusting offset.x in right to left layout direction.
    offset.x = self.contentSize.width - _scrollView.frame.size.width - offset.x;
  }
#endif // [macOS]
`,
  ],
];
function patchScrollViewSource(source) {
  if (replacements.every(([, after]) => source.includes(after))) return source;
  if (replacements.some(([before, after]) => source.split(before).length !== 2 || source.includes(after)))
    throw new Error(`React Native macOS ScrollView source changed (${file}); review the RTL scroll patch before building.`);
  return replacements.reduce((patched, [before, after]) => patched.replace(before, after), source);
}
function installRTLScrollViewPatch(root) {
  const manifest = require.resolve("react-native-macos/package.json", { paths: [root] });
  const version = JSON.parse(fs.readFileSync(manifest, "utf8")).version;
  if (version !== "0.81.7") throw new Error(`spark's RTL scroll patch requires react-native-macos@0.81.7; found ${version}.`);
  const target = path.join(path.dirname(manifest), file);
  const before = fs.readFileSync(target, "utf8"), after = patchScrollViewSource(before);
  if (before !== after) {
    const temporary = `${target}.spark-${process.pid}.tmp`;
    fs.writeFileSync(temporary, after);
    fs.renameSync(temporary, target); // Preserve package-manager cache hardlinks.
  }
}
module.exports = { replacements, patchScrollViewSource, installRTLScrollViewPatch };
