#import "RNSidebarSplitViewComponent.h"

#import <react/renderer/components/RNSparkUISpec/ComponentDescriptors.h>
#import <react/renderer/components/RNSparkUISpec/EventEmitters.h>
#import <react/renderer/components/RNSparkUISpec/Props.h>
#import <react/renderer/components/RNSparkUISpec/RCTComponentViewHelpers.h>

#if TARGET_OS_OSX
#import <CoreImage/CoreImage.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>
#endif

using namespace facebook::react;

#if TARGET_OS_OSX
@interface RNSidebarSplitViewTitlebarMaterialContainerView : NSView
@end

@implementation RNSidebarSplitViewTitlebarMaterialContainerView
- (nullable NSView *)hitTest:(NSPoint)point
{
  return nil;
}
@end

static NSAppearance *RNSidebarSplitViewAppearanceForName(NSString *appearanceName)
{
  if ([appearanceName isEqualToString:@"light"]) {
    return [NSAppearance appearanceNamed:NSAppearanceNameAqua];
  }

  if ([appearanceName isEqualToString:@"dark"]) {
    return [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  }

  return nil;
}

static NSColor *RNSidebarSplitViewColorFromHexString(NSString *value)
{
  if (![value isKindOfClass:NSString.class] || value.length == 0) {
    return nil;
  }

  NSString *hex = [value hasPrefix:@"#"] ? [value substringFromIndex:1] : value;
  if (hex.length != 6 && hex.length != 8) {
    return nil;
  }

  unsigned long long raw = 0;
  NSScanner *scanner = [NSScanner scannerWithString:hex];
  if (![scanner scanHexLongLong:&raw]) {
    return nil;
  }

  CGFloat red = 0;
  CGFloat green = 0;
  CGFloat blue = 0;
  CGFloat alpha = 1;
  if (hex.length == 8) {
    red = ((raw >> 24) & 0xff) / 255.0;
    green = ((raw >> 16) & 0xff) / 255.0;
    blue = ((raw >> 8) & 0xff) / 255.0;
    alpha = (raw & 0xff) / 255.0;
  } else {
    red = ((raw >> 16) & 0xff) / 255.0;
    green = ((raw >> 8) & 0xff) / 255.0;
    blue = (raw & 0xff) / 255.0;
  }

  return [NSColor colorWithSRGBRed:red green:green blue:blue alpha:alpha];
}

static CGFloat RNSidebarSplitViewClampedUnitValue(CGFloat value)
{
  return MIN(MAX(0, value), 1);
}

static NSVisualEffectMaterial RNSidebarSplitViewMaterialForName(NSString *value)
{
  if ([value isEqualToString:@"hudWindow"]) {
    return NSVisualEffectMaterialHUDWindow;
  }
  if ([value isEqualToString:@"sidebar"]) {
    return NSVisualEffectMaterialSidebar;
  }
  if ([value isEqualToString:@"windowBackground"]) {
    return NSVisualEffectMaterialWindowBackground;
  }
  if ([value isEqualToString:@"titlebar"]) {
    return NSVisualEffectMaterialTitlebar;
  }
  if ([value isEqualToString:@"glass"] || [value isEqualToString:@"headerView"]) {
    if (@available(macOS 10.14, *)) {
      return NSVisualEffectMaterialHeaderView;
    }
    return NSVisualEffectMaterialTitlebar;
  }
  return NSVisualEffectMaterialTitlebar;
}

static NSView *RNSidebarSplitViewCreateColorOverlay(NSRect frame, NSColor *color, CGFloat opacity)
{
  NSView *overlayView = [[NSView alloc] initWithFrame:frame];
  overlayView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  overlayView.wantsLayer = YES;
  overlayView.layer.backgroundColor = [color colorWithAlphaComponent:opacity].CGColor;
  return overlayView;
}

static NSView *RNSidebarSplitViewCreateMaterialContainer(NSRect frame, NSView *materialView, NSColor *overlayColor, CGFloat overlayOpacity)
{
  RNSidebarSplitViewTitlebarMaterialContainerView *containerView =
    [[RNSidebarSplitViewTitlebarMaterialContainerView alloc] initWithFrame:frame];
  containerView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  containerView.wantsLayer = YES;
  containerView.layer.backgroundColor = NSColor.clearColor.CGColor;
  containerView.layer.masksToBounds = YES;

  [containerView addSubview:materialView];
  if (overlayColor && overlayOpacity > 0) {
    [containerView addSubview:RNSidebarSplitViewCreateColorOverlay(containerView.bounds, overlayColor, overlayOpacity)];
  }

  return containerView;
}

API_AVAILABLE(macos(26.0))
static NSView *RNSidebarSplitViewCreateGlassMaterialView(NSRect frame, NSColor *overlayColor, CGFloat overlayOpacity)
{
  CGFloat overscan = 48;
  NSRect glassFrame = NSMakeRect(-overscan, 0, NSWidth(frame) + (overscan * 2), NSHeight(frame) + overscan);
  NSGlassEffectView *glassView = [[NSGlassEffectView alloc] initWithFrame:glassFrame];
  glassView.cornerRadius = 0;
  glassView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  glassView.wantsLayer = YES;
  glassView.layer.backgroundColor = NSColor.clearColor.CGColor;
  return RNSidebarSplitViewCreateMaterialContainer(frame, glassView, overlayColor, overlayOpacity);
}

static NSView *RNSidebarSplitViewCreateTitlebarMaterialView(NSString *materialName,
                                                            NSRect frame,
                                                            NSColor *overlayColor,
                                                            CGFloat overlayOpacity)
{
  if ([materialName isEqualToString:@"glass"]) {
    if (@available(macOS 26.0, *)) {
      return RNSidebarSplitViewCreateGlassMaterialView(frame, overlayColor, overlayOpacity);
    }
  }

  NSVisualEffectView *effectView = [[NSVisualEffectView alloc] initWithFrame:NSMakeRect(0, 0, NSWidth(frame), NSHeight(frame))];
  effectView.material = RNSidebarSplitViewMaterialForName(materialName);
  effectView.blendingMode = NSVisualEffectBlendingModeWithinWindow;
  effectView.state = NSVisualEffectStateFollowsWindowActiveState;
  effectView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  effectView.wantsLayer = YES;
  effectView.layer.backgroundColor = NSColor.clearColor.CGColor;
  return RNSidebarSplitViewCreateMaterialContainer(frame, effectView, overlayColor, overlayOpacity);
}

static NSView *RNSidebarSplitViewCreateBackgroundBlurView(NSRect frame, CGFloat radius)
{
  RNSidebarSplitViewTitlebarMaterialContainerView *blurView =
    [[RNSidebarSplitViewTitlebarMaterialContainerView alloc] initWithFrame:frame];
  blurView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  blurView.wantsLayer = YES;
  blurView.layerUsesCoreImageFilters = YES;
  blurView.layer.backgroundColor = NSColor.clearColor.CGColor;

  CIFilter *blurFilter = [CIFilter filterWithName:@"CIGaussianBlur"];
  [blurFilter setDefaults];
  [blurFilter setValue:@(radius) forKey:kCIInputRadiusKey];
  blurView.layer.backgroundFilters = @[blurFilter];
  return blurView;
}

static void RNSidebarSplitViewApplySoftBottomEdgeMask(NSView *view)
{
  CAGradientLayer *maskLayer = [CAGradientLayer layer];
  maskLayer.frame = view.bounds;
  maskLayer.autoresizingMask = kCALayerWidthSizable | kCALayerHeightSizable;
  maskLayer.colors = @[
    (id)NSColor.whiteColor.CGColor,
    (id)NSColor.whiteColor.CGColor,
    (id)NSColor.clearColor.CGColor,
  ];
  maskLayer.locations = @[@0, @0.7, @1];
  maskLayer.startPoint = CGPointMake(0.5, 1);
  maskLayer.endPoint = CGPointMake(0.5, 0);
  view.layer.mask = maskLayer;
}

static void RNSidebarSplitViewApplyColorOverlay(NSView *view, NSColor *color, CGFloat opacity)
{
  if (color && opacity > 0) {
    CALayer *overlayLayer = [CALayer layer];
    overlayLayer.frame = view.bounds;
    overlayLayer.autoresizingMask = kCALayerWidthSizable | kCALayerHeightSizable;
    overlayLayer.backgroundColor = [color colorWithAlphaComponent:opacity].CGColor;
    [view.layer addSublayer:overlayLayer];
  }
}

// Pane containers are transparent, so a thin divider showed the window's (white) background through it,
// which is invisible in light mode and a bright stripe in dark mode. Paint it opaquely with semantic colors
// that resolve against the drawing appearance.
@interface RNSidebarSplitViewNativeSplitView : NSSplitView
/// YES while the user drags a divider.
@property (nonatomic, readonly) BOOL trackingDivider;
@end

@implementation RNSidebarSplitViewNativeSplitView

// NSSplitView only receives mouseDown: on a divider, and tracks the whole drag inside it.
- (void)mouseDown:(NSEvent *)event
{
  _trackingDivider = YES;
  [super mouseDown:event];
  _trackingDivider = NO;
}

// While a divider drags, panes resize under a still cursor and pane edges pass beneath it. React views take
// hover from a window hit test, so claiming the hit here keeps rows from flickering hover states (and starting
// their hover animations) every frame of the drag.
- (NSView *)hitTest:(NSPoint)point
{
  if (_trackingDivider) {
    return NSPointInRect([self convertPoint:point fromView:self.superview], self.bounds) ? self : nil;
  }
  return [super hitTest:point];
}

- (NSColor *)dividerColor
{
  return NSColor.separatorColor;
}

- (void)drawDividerInRect:(NSRect)rect
{
  // AppKit hands a sidebar's divider a 0.5pt hairline rect but still reserves the full dividerThickness. The
  // other half of the gap is left to the split view's own backing, which shows as a bright column in dark mode.
  // Paint the whole gap, then the hairline.
  NSRect gap = rect;
  if (self.vertical) {
    gap.size.width = MAX(rect.size.width, self.dividerThickness);
  } else {
    gap.size.height = MAX(rect.size.height, self.dividerThickness);
  }
  [NSColor.windowBackgroundColor setFill];
  NSRectFill(gap);
  [self.dividerColor setFill];
  NSRectFillUsingOperation(rect, NSCompositingOperationSourceOver);
}
@end

// List and content panes are opaque in the window background color, as AppKit panes are. React content
// follows a native resize one commit later; until then the newly exposed strip matches the window instead
// of showing a white stripe. The sidebar container stays clear so its native material shows.
@interface RNSidebarSplitViewPaneView : NSView
@end

@implementation RNSidebarSplitViewPaneView
- (BOOL)wantsUpdateLayer
{
  return YES;
}

- (void)updateLayer
{
  self.layer.backgroundColor = NSColor.windowBackgroundColor.CGColor;
}

- (void)viewDidChangeEffectiveAppearance
{
  [super viewDidChangeEffectiveAppearance];
  self.needsDisplay = YES;
}
@end

static char RNSidebarSplitViewStartupKey;

// Startup must stay entirely in AppKit: constructing a Fabric view here would
// read React feature flags before RCTReactNativeFactory configures them.
@interface RNSidebarSplitViewStartupView : NSView
- (instancetype)initWithFrame:(NSRect)frame configuration:(NSDictionary *)configuration;
@property (nonatomic, copy) void (^installReactRoot)(void);
- (void)finish;
@end

@implementation RNSidebarSplitViewStartupView {
  NSSplitViewController *_controller;
  NSView *_sidebar;
  NSView *_content;
  NSView *_titlebarMaterial;
  CGFloat _sidebarWidth;
  CGFloat _contentMinWidth;
  BOOL _layingOut;
  CGFloat _titlebarHeight;
}

- (instancetype)initWithFrame:(NSRect)frame configuration:(NSDictionary *)configuration
{
  if (self = [super initWithFrame:frame]) {
    self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    self.appearance = RNSidebarSplitViewAppearanceForName(configuration[@"appearance"]);
    _sidebarWidth = [configuration[@"sidebarWidth"] doubleValue];
    _contentMinWidth = [configuration[@"contentMinWidth"] doubleValue];
    NSColor *background = RNSidebarSplitViewColorFromHexString(configuration[@"backgroundColor"]);
    self.wantsLayer = YES;
    self.layer.backgroundColor = background.CGColor;

    _sidebar = [NSView new];
    _content = [NSView new];
    _sidebar.wantsLayer = YES;
    _content.wantsLayer = YES;
    // AppKit supplies the sidebar material; an opaque fill hides its backdrop.
    _sidebar.layer.backgroundColor = NSColor.clearColor.CGColor;
    _content.layer.backgroundColor = background.CGColor;
    _sidebar.layer.zPosition = 10;
    NSViewController *sidebarController = [NSViewController new];
    NSViewController *contentController = [NSViewController new];
    sidebarController.view = _sidebar;
    contentController.view = _content;
    NSSplitViewItem *sidebarItem = [NSSplitViewItem sidebarWithViewController:sidebarController];
    NSSplitViewItem *contentItem = [NSSplitViewItem splitViewItemWithViewController:contentController];
    sidebarItem.minimumThickness = [configuration[@"sidebarMinWidth"] doubleValue];
    sidebarItem.preferredThicknessFraction = 0.26;
    sidebarItem.canCollapse = YES;
    sidebarItem.collapsed = [configuration[@"sidebarCollapsed"] boolValue];
    contentItem.minimumThickness = _contentMinWidth;
    contentItem.canCollapse = NO;
    sidebarItem.allowsFullHeightLayout = YES;
    contentItem.allowsFullHeightLayout = YES;

    _controller = [NSSplitViewController new];
    _controller.minimumThicknessForInlineSidebars = 0;
    _controller.splitView.vertical = YES;
    _controller.splitView.dividerStyle = NSSplitViewDividerStyleThin;
    [_controller addSplitViewItem:sidebarItem];
    [_controller addSplitViewItem:contentItem];
    _controller.view.frame = self.bounds;
    _controller.view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [self addSubview:_controller.view];

    _titlebarHeight = [configuration[@"contentTitlebarHeight"] doubleValue];
    if (_titlebarHeight > 0) {
      _titlebarMaterial = RNSidebarSplitViewCreateTitlebarMaterialView(
        @"glass", NSMakeRect(0, 0, NSWidth(frame), _titlebarHeight), background,
        [configuration[@"appearance"] isEqualToString:@"dark"] ? 0 : 0.1);
      [_content addSubview:_titlebarMaterial];
    }
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(splitViewDidMount:)
      name:@"LegendSidebarSplitViewDidMount" object:nil];
    [self layout];
  }
  return self;
}

- (void)layout
{
  [super layout];
  if (!_controller || _layingOut) {
    return;
  }
  _layingOut = YES;
  _controller.view.frame = self.bounds;
  CGFloat sidebarWidth = MIN(_sidebarWidth,
    MAX(0, NSWidth(self.bounds) - _contentMinWidth - _controller.splitView.dividerThickness));
  [_controller.splitView setPosition:sidebarWidth ofDividerAtIndex:0];
  [_controller.splitView adjustSubviews];
  [_controller.view layoutSubtreeIfNeeded];
  NSRect contentFrame = [_controller.view convertRect:_controller.view.bounds toView:_content];
  CGFloat height = MIN(_titlebarHeight, NSHeight(contentFrame));
  _titlebarMaterial.frame = NSMakeRect(NSMinX(contentFrame),
    _content.isFlipped ? NSMinY(contentFrame) : NSMaxY(contentFrame) - height,
    NSWidth(contentFrame), height);
  _layingOut = NO;
}

- (void)splitViewDidMount:(NSNotification *)notification
{
  NSView *mountedView = notification.object;
  if (self.window && mountedView.window == self.window) {
    // Leave the Fabric/AppKit layout transaction before reparenting its root.
    dispatch_async(dispatch_get_main_queue(), ^{ [self finish]; });
  }
}

- (void)finish
{
  if (!self.installReactRoot) {
    return;
  }
  NSWindow *window = self.window;
  NSResponder *firstResponder = window.firstResponder;
  void (^installRoot)(void) = self.installReactRoot;
  self.installReactRoot = nil;
  [self removeFromSuperview];
  objc_setAssociatedObject(window, &RNSidebarSplitViewStartupKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  // Removing the placeholder split clears AppKit's sidebar association. Reattach
  // the live root before the next draw so its split registers with the window.
  installRoot();
  // Installing a content view controller in a visible window can focus its first
  // key view. Preserve the previous focus, including an unfocused window, so the
  // handoff does not introduce a focus ring or steal focus from an input.
  if ([firstResponder isKindOfClass:NSView.class] && ((NSView *)firstResponder).window != window) {
    firstResponder = nil;
  }
  [window makeFirstResponder:firstResponder];
}

- (void)dealloc
{
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

@end
#endif

#if TARGET_OS_OSX
@interface RNSidebarSplitViewComponent () <RCTSidebarSplitViewViewProtocol>
@end
#else
@interface RNSidebarSplitViewComponent () <RCTSidebarSplitViewViewProtocol>
@end
#endif

@implementation RNSidebarSplitViewComponent {
#if TARGET_OS_OSX
  NSSplitViewController *_splitViewController;
  NSViewController *_sidebarViewController;
  NSViewController *_contentViewController;
  NSViewController *_listViewController;
  NSSplitViewItem *_sidebarItem;
  NSSplitViewItem *_contentItem;
  NSSplitViewItem *_listItem;
  NSView *_sidebarContainer;
  NSView *_contentContainer;
  NSView *_listContainer;
  RCTUIView<RCTComponentViewProtocol> *_sidebarReactView;
  RCTUIView<RCTComponentViewProtocol> *_contentReactView;
  RCTUIView<RCTComponentViewProtocol> *_listReactView;
  id _resizeObserver;
  id _contentFrameObserver;
  id _contentBoundsObserver;
  // React lays a pane out one commit after a native resize. Until then the content pane's React content is
  // pinned to whichever edge held still: the window edge while a divider drags, the divider while the window resizes.
  NSRect _lastContentFrame;
  BOOL _contentAnchorsRight;
  LayoutMetrics _currentLayoutMetrics;
  LayoutMetrics _sidebarReactLayoutMetrics;
  LayoutMetrics _contentReactLayoutMetrics;
  LayoutMetrics _listReactLayoutMetrics;
  CGFloat _sidebarMinWidth;
  CGFloat _sidebarWidth;
  CGFloat _contentMinWidth;
  CGFloat _listMinWidth;
  CGFloat _listWidth;
  BOOL _hasList;
  BOOL _sidebarCollapsed;
  // Preferred widths seed the dividers once; afterwards the user's drag owns them.
  BOOL _needsPreferredDividerPositions;
  // Our own layout pass resizes subviews several times; only its final state is published.
  BOOL _layingOutSplitView;
  CGFloat _lastSidebarWidth;
  CGFloat _lastContentWidth;
  CGFloat _lastListWidth;
  CGFloat _lastHeight;
  BOOL _lastLayoutReady;
  BOOL _didPublishMount;
  NSString *_appearanceName;
  CGFloat _contentTitlebarHeight;
  NSString *_contentTitlebarMaterialName;
  NSString *_contentTitlebarOverlayColorValue;
  CGFloat _contentTitlebarOverlayOpacity;
  NSView *_contentTitlebarMaterialView;
  NSString *_sidebarTitlebarOverlayColorValue;
  CGFloat _sidebarTitlebarOverlayOpacity;
  NSView *_sidebarTitlebarMaterialView;
  NSSplitViewItemAccessoryViewController *_sidebarScrollEdgeAccessory API_AVAILABLE(macos(26.0));
  NSLayoutConstraint *_sidebarScrollEdgeHeight;
#else
  UIView *_sidebarContainer;
  UIView *_contentContainer;
#endif
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _props = std::make_shared<const SidebarSplitViewProps>();

#if TARGET_OS_OSX
    _currentLayoutMetrics = EmptyLayoutMetrics;
    _sidebarReactLayoutMetrics = EmptyLayoutMetrics;
    _contentReactLayoutMetrics = EmptyLayoutMetrics;
    _listReactLayoutMetrics = EmptyLayoutMetrics;
    _sidebarMinWidth = 180;
    _sidebarWidth = 0;
    _contentMinWidth = 320;
    _listMinWidth = 240;
    _listWidth = 0;
    _hasList = NO;
    _sidebarCollapsed = NO;
    _needsPreferredDividerPositions = YES;
    _layingOutSplitView = NO;
    _lastSidebarWidth = -1;
    _lastContentWidth = -1;
    _lastListWidth = -1;
    _lastHeight = -1;
    _lastLayoutReady = NO;
    _appearanceName = @"system";
    _contentTitlebarHeight = 0;
    _contentTitlebarMaterialName = @"none";
    _contentTitlebarOverlayOpacity = 0;
    _sidebarTitlebarOverlayOpacity = 0;
    _sidebarContainer = [NSView new];
    _contentContainer = [RNSidebarSplitViewPaneView new];
    _listContainer = [RNSidebarSplitViewPaneView new];
    _sidebarContainer.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    _contentContainer.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    _listContainer.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    _sidebarContainer.wantsLayer = YES;
    _contentContainer.wantsLayer = YES;
    _listContainer.wantsLayer = YES;
    _sidebarContainer.layer.masksToBounds = NO;
    _contentContainer.layer.masksToBounds = NO;
    _listContainer.layer.masksToBounds = YES;
    _sidebarContainer.layer.zPosition = 10;
    _contentContainer.layer.zPosition = 0;
    _listContainer.layer.zPosition = 0;

    _sidebarViewController = [NSViewController new];
    _contentViewController = [NSViewController new];
    _listViewController = [NSViewController new];
    _sidebarViewController.view = _sidebarContainer;
    _contentViewController.view = _contentContainer;
    _listViewController.view = _listContainer;

    _sidebarItem = [NSSplitViewItem sidebarWithViewController:_sidebarViewController];
    _contentItem = [NSSplitViewItem splitViewItemWithViewController:_contentViewController];
    // Mail-style middle column. Inserted between sidebar and content only while a list pane is supplied.
    _listItem = [NSSplitViewItem contentListWithViewController:_listViewController];
    _sidebarItem.canCollapse = YES;
    _contentItem.canCollapse = NO;
    _listItem.canCollapse = NO;
    // Window resizes go to the content column; sidebar (260) and list keep their widths.
    _listItem.holdingPriority = NSLayoutPriorityDefaultLow + 1;
    [self updateSplitItemSizing];

    if (@available(macOS 11.0, *)) {
      _sidebarItem.allowsFullHeightLayout = YES;
      _contentItem.allowsFullHeightLayout = YES;
      _listItem.allowsFullHeightLayout = YES;
    }

    _splitViewController = [NSSplitViewController new];
    _splitViewController.splitView = [RNSidebarSplitViewNativeSplitView new];
    _splitViewController.minimumThicknessForInlineSidebars = 0;
    _splitViewController.splitView.vertical = YES;
    _splitViewController.splitView.dividerStyle = NSSplitViewDividerStyleThin;
    _splitViewController.view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [_splitViewController addSplitViewItem:_sidebarItem];
    [_splitViewController addSplitViewItem:_contentItem];
    [self applyAppearance];

    _resizeObserver = [[NSNotificationCenter defaultCenter]
      addObserverForName:NSSplitViewDidResizeSubviewsNotification
                  object:_splitViewController.splitView
                   queue:NSOperationQueue.mainQueue
              usingBlock:^(__unused NSNotification *notification) {
                if (!self->_layingOutSplitView) {
                  [self publishSplitViewLayoutAllowEstimatedReady:NO];
                }
              }];
    // React applying a new frame sets the frame, then resets the bounds offset the anchor uses, so re-pin after
    // either changes on the content root (and after its children's frames change in a commit).
    __weak RNSidebarSplitViewComponent *weakSelf = self;
    _contentFrameObserver = [[NSNotificationCenter defaultCenter]
      addObserverForName:NSViewFrameDidChangeNotification
                  object:nil
                   queue:nil
              usingBlock:^(NSNotification *notification) {
                RNSidebarSplitViewComponent *strongSelf = weakSelf;
                NSView *view = notification.object;
                if (strongSelf && strongSelf->_contentReactView &&
                    (view == strongSelf->_contentReactView || view.superview == strongSelf->_contentReactView)) {
                  [strongSelf anchorContentReactView];
                }
              }];
    _contentBoundsObserver = [[NSNotificationCenter defaultCenter]
      addObserverForName:NSViewBoundsDidChangeNotification
                  object:nil
                   queue:nil
              usingBlock:^(NSNotification *notification) {
                RNSidebarSplitViewComponent *strongSelf = weakSelf;
                if (strongSelf && notification.object == strongSelf->_contentReactView) {
                  [strongSelf anchorContentReactView];
                }
              }];

    [self addSubview:_splitViewController.view];
#else
    _sidebarContainer = [UIView new];
    _contentContainer = [UIView new];
    [self addSubview:_sidebarContainer];
    [self addSubview:_contentContainer];
#endif
  }
  return self;
}

#if TARGET_OS_OSX
- (BOOL)isFlipped
{
  return YES;
}

- (void)updateSplitItemSizing
{
  _sidebarItem.minimumThickness = MAX(120, _sidebarMinWidth);
  _sidebarItem.preferredThicknessFraction = 0.26;
  _contentItem.minimumThickness = MAX(240, _contentMinWidth);
  _listItem.minimumThickness = MAX(120, _listMinWidth);
}

- (void)updateListItem
{
  BOOL installed = [_splitViewController.splitViewItems containsObject:_listItem];
  if (_hasList && !installed) {
    [_splitViewController insertSplitViewItem:_listItem atIndex:1];
  } else if (!_hasList && installed) {
    [_splitViewController removeSplitViewItem:_listItem];
  }
}

- (CGFloat)listReserveWidth
{
  return _hasList ? _listMinWidth + _splitViewController.splitView.dividerThickness : 0;
}

- (CGFloat)preferredSidebarWidthForBounds:(CGRect)bounds
{
  CGFloat dividerThickness = _splitViewController.splitView.dividerThickness;
  CGFloat maxSidebarWidth = bounds.size.width - _contentMinWidth - dividerThickness - [self listReserveWidth];
  CGFloat preferredSidebarWidth = _sidebarWidth > 0 ? _sidebarWidth : _sidebarMinWidth;
  CGFloat sidebarWidth = MIN(MAX(_sidebarMinWidth, preferredSidebarWidth), maxSidebarWidth);
  return MAX(0, sidebarWidth);
}

- (CGFloat)preferredListWidthForBounds:(CGRect)bounds sidebarExtent:(CGFloat)sidebarExtent
{
  if (!_hasList) {
    return 0;
  }
  CGFloat dividerThickness = _splitViewController.splitView.dividerThickness;
  CGFloat maxListWidth = bounds.size.width - sidebarExtent - _contentMinWidth - dividerThickness;
  CGFloat preferredListWidth = _listWidth > 0 ? _listWidth : _listMinWidth;
  return MAX(0, MIN(MAX(_listMinWidth, preferredListWidth), maxListWidth));
}

- (void)updateSidebarCollapsed
{
  if (_sidebarItem.collapsed != _sidebarCollapsed) {
    _sidebarItem.collapsed = _sidebarCollapsed;
  }
}

- (void)applyAppearance
{
  NSAppearance *appearance = RNSidebarSplitViewAppearanceForName(_appearanceName);
  self.appearance = appearance;
  _splitViewController.view.appearance = appearance;
  _splitViewController.splitView.appearance = appearance;
  _sidebarContainer.appearance = appearance;
  _contentContainer.appearance = appearance;
  _listContainer.appearance = appearance;
  [_splitViewController.view setNeedsDisplay:YES];
  [_splitViewController.splitView setNeedsDisplay:YES];
  [_sidebarContainer setNeedsDisplay:YES];
  [_contentContainer setNeedsDisplay:YES];
}

- (void)removeContentTitlebarMaterial
{
  [_contentTitlebarMaterialView removeFromSuperview];
  _contentTitlebarMaterialView = nil;
}

- (void)removeSidebarTitlebarMaterial
{
  [_sidebarTitlebarMaterialView removeFromSuperview];
  _sidebarTitlebarMaterialView = nil;
  if (@available(macOS 26.1, *)) {
    if (_sidebarScrollEdgeAccessory) {
      NSUInteger index = [_sidebarItem.topAlignedAccessoryViewControllers indexOfObject:_sidebarScrollEdgeAccessory];
      if (index != NSNotFound) {
        [_sidebarItem removeTopAlignedAccessoryViewControllerAtIndex:index];
      }
      _sidebarScrollEdgeAccessory = nil;
      _sidebarScrollEdgeHeight = nil;
    }
  }
}

- (void)layoutSidebarTitlebarMaterialWithHeight:(CGFloat)titlebarHeight
{
  NSRect splitFrameInSidebar = [_splitViewController.view convertRect:_splitViewController.view.bounds
                                                               toView:_sidebarContainer];
  if (titlebarHeight <= 0 || NSWidth(splitFrameInSidebar) <= 0) {
    [self removeSidebarTitlebarMaterial];
    return;
  }

  if (@available(macOS 26.1, *)) {
    // AppKit already accounts for the window titlebar above the accessory.
    // Only register any additional header height, not a second full titlebar.
    CGFloat nativeTitlebarHeight = MAX(0, NSHeight(self.window.frame) - NSHeight(self.window.contentLayoutRect));
    CGFloat accessoryHeight = MAX(0, titlebarHeight - nativeTitlebarHeight);
    if (!_sidebarScrollEdgeAccessory) {
      _sidebarScrollEdgeAccessory = [NSSplitViewItemAccessoryViewController new];
      _sidebarScrollEdgeAccessory.automaticallyAppliesContentInsets = NO;
      _sidebarScrollEdgeAccessory.preferredScrollEdgeEffectStyle = NSScrollEdgeEffectStyle.softStyle;
      // Register the existing header region with NSScrollView's native edge
      // effect. React retains ownership of its existing content inset.
      NSView *accessoryView = [RNSidebarSplitViewTitlebarMaterialContainerView new];
      _sidebarScrollEdgeAccessory.view = accessoryView;
      _sidebarScrollEdgeHeight = [accessoryView.heightAnchor constraintEqualToConstant:accessoryHeight];
      _sidebarScrollEdgeHeight.active = YES;
      [_sidebarItem addTopAlignedAccessoryViewController:_sidebarScrollEdgeAccessory];
    }
    _sidebarScrollEdgeHeight.constant = accessoryHeight;
    return;
  }

  CGFloat materialHeight = MIN(titlebarHeight + 10, NSHeight(splitFrameInSidebar));
  CGFloat materialY = _sidebarContainer.isFlipped
    ? NSMinY(splitFrameInSidebar)
    : NSMaxY(splitFrameInSidebar) - materialHeight;
  NSRect materialFrame = NSMakeRect(
    NSMinX(splitFrameInSidebar),
    materialY,
    NSWidth(splitFrameInSidebar),
    materialHeight);

  if (!_sidebarTitlebarMaterialView) {
    _sidebarTitlebarMaterialView = RNSidebarSplitViewCreateBackgroundBlurView(materialFrame, 2);
    RNSidebarSplitViewApplySoftBottomEdgeMask(_sidebarTitlebarMaterialView);
    RNSidebarSplitViewApplyColorOverlay(
      _sidebarTitlebarMaterialView,
      RNSidebarSplitViewColorFromHexString(_sidebarTitlebarOverlayColorValue),
      _sidebarTitlebarOverlayOpacity);
  } else {
    _sidebarTitlebarMaterialView.frame = materialFrame;
  }

  if (_sidebarTitlebarMaterialView.superview != _sidebarContainer) {
    [_sidebarTitlebarMaterialView removeFromSuperview];
  }
  [_sidebarContainer addSubview:_sidebarTitlebarMaterialView
                     positioned:NSWindowAbove
                     relativeTo:_sidebarReactView];
}

- (void)layoutContentTitlebarMaterial
{
  if (_contentTitlebarHeight <= 0 ||
      _contentTitlebarMaterialName.length == 0 ||
      [_contentTitlebarMaterialName isEqualToString:@"none"] ||
      !_contentContainer.superview) {
    [self removeContentTitlebarMaterial];
    [self removeSidebarTitlebarMaterial];
    return;
  }

  NSRect splitFrameInContent = [_splitViewController.view convertRect:_splitViewController.view.bounds toView:_contentContainer];
  CGFloat materialHeight = MIN(_contentTitlebarHeight, NSHeight(splitFrameInContent));
  if (materialHeight <= 0 || NSWidth(splitFrameInContent) <= 0) {
    [self removeContentTitlebarMaterial];
    [self removeSidebarTitlebarMaterial];
    return;
  }

  CGFloat materialY = _contentContainer.isFlipped
    ? NSMinY(splitFrameInContent)
    : NSMaxY(splitFrameInContent) - materialHeight;
  NSRect materialFrame = NSMakeRect(NSMinX(splitFrameInContent), materialY, NSWidth(splitFrameInContent), materialHeight);

  if (!_contentTitlebarMaterialView) {
    NSColor *overlayColor = RNSidebarSplitViewColorFromHexString(_contentTitlebarOverlayColorValue);
    CGFloat overlayOpacity = RNSidebarSplitViewClampedUnitValue(_contentTitlebarOverlayOpacity);
    _contentTitlebarMaterialView = RNSidebarSplitViewCreateTitlebarMaterialView(
      _contentTitlebarMaterialName,
      materialFrame,
      overlayColor,
      overlayOpacity);
  } else {
    _contentTitlebarMaterialView.frame = materialFrame;
  }

  if (_contentTitlebarMaterialView.superview != _contentContainer) {
    [_contentTitlebarMaterialView removeFromSuperview];
    [_contentContainer addSubview:_contentTitlebarMaterialView positioned:NSWindowAbove relativeTo:_contentReactView];
  } else {
    [_contentContainer addSubview:_contentTitlebarMaterialView positioned:NSWindowAbove relativeTo:_contentReactView];
  }

  [self layoutSidebarTitlebarMaterialWithHeight:materialHeight];

  _sidebarContainer.layer.zPosition = 10;
  _contentContainer.layer.zPosition = 0;
}

- (void)syncReactSubviewFrames
{
  CGRect sidebarBounds = _sidebarContainer.bounds;
  CGRect contentBounds = _contentContainer.bounds;

  [self syncReactSubview:_sidebarReactView
             nativeBounds:sidebarBounds
    previousLayoutMetrics:&_sidebarReactLayoutMetrics];
  [self syncReactSubview:_contentReactView
             nativeBounds:contentBounds
    previousLayoutMetrics:&_contentReactLayoutMetrics];
  [self syncReactSubview:_listReactView
             nativeBounds:_hasList ? _listContainer.bounds : CGRectZero
    previousLayoutMetrics:&_listReactLayoutMetrics];
  [self anchorContentReactView];
}

/// Offsets the content pane's React root so its laid-out content meets the anchored edge. The offset is the gap
/// between React's last layout width and the pane's native width, so it returns to zero once React catches up.
- (void)anchorContentReactView
{
  NSView *root = _contentReactView;
  if (!root) {
    return;
  }
  // AppKit wraps each split item's view, so measure in our own coordinates rather than the wrapper's.
  NSRect contentFrame = [_contentContainer convertRect:_contentContainer.bounds toView:self];
  if (!NSEqualRects(contentFrame, _lastContentFrame)) {
    // A divider drag holds the window edge still; any other resize (the window's) holds the pane's left edge.
    // AppKit applies a drag's origin and width in separate steps, so the drag itself decides, not each step.
    BOOL dragging = ((RNSidebarSplitViewNativeSplitView *)_splitViewController.splitView).trackingDivider;
    if (dragging) {
      _contentAnchorsRight = YES;
    } else if (fabs(NSMinX(contentFrame) - NSMinX(_lastContentFrame)) < 0.5) {
      _contentAnchorsRight = NO;
    }
    _lastContentFrame = contentFrame;
  }
  CGFloat laidOut = 0;
  for (NSView *child in root.subviews) {
    laidOut = MAX(laidOut, NSMaxX(child.frame));
  }
  CGFloat offset = _contentAnchorsRight && laidOut > 0 ? laidOut - NSWidth(root.bounds) : 0;
  if (fabs(root.bounds.origin.x - offset) >= 0.25) {
    [root setBoundsOrigin:NSMakePoint(offset, root.bounds.origin.y)];
  }
}

- (void)syncReactSubview:(nullable RCTUIView<RCTComponentViewProtocol> *)subview
            nativeBounds:(CGRect)nativeBounds
   previousLayoutMetrics:(LayoutMetrics *)previousLayoutMetrics
{
  if (!subview) {
    return;
  }

  subview.hidden = nativeBounds.size.width <= 0 || nativeBounds.size.height <= 0;
  subview.translatesAutoresizingMaskIntoConstraints = YES;
  subview.frame = nativeBounds;
  LayoutMetrics nextLayoutMetrics = _currentLayoutMetrics;
  if (nextLayoutMetrics == EmptyLayoutMetrics) {
    nextLayoutMetrics = LayoutMetrics{};
  }
  nextLayoutMetrics.frame = facebook::react::Rect{
    facebook::react::Point{0, 0},
    facebook::react::Size{(Float)nativeBounds.size.width, (Float)nativeBounds.size.height},
  };
  nextLayoutMetrics.contentInsets = {};
  nextLayoutMetrics.borderWidth = {};
  nextLayoutMetrics.overflowInset = {};

  [subview updateLayoutMetrics:nextLayoutMetrics oldLayoutMetrics:*previousLayoutMetrics];
  [subview finalizeUpdates:RNComponentViewUpdateMaskLayoutMetrics];
  *previousLayoutMetrics = nextLayoutMetrics;
  subview.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [subview setNeedsLayout:YES];
  [subview layoutSubtreeIfNeeded];
}

- (void)emitSplitViewDidResizeWithSidebarWidth:(CGFloat)sidebarWidth
                                  contentWidth:(CGFloat)contentWidth
                                      contentX:(CGFloat)contentX
                                  sidebarHeight:(CGFloat)sidebarHeight
                                  contentHeight:(CGFloat)contentHeight
                                         height:(CGFloat)height
                                     listWidth:(CGFloat)listWidth
                                         listX:(CGFloat)listX
                                    layoutReady:(BOOL)layoutReady
{
  const auto eventEmitter = std::static_pointer_cast<const SidebarSplitViewEventEmitter>(_eventEmitter);
  if (!eventEmitter) {
    return;
  }

  if (contentWidth <= 0 || height <= 0) {
    return;
  }

  BOOL panesReady = layoutReady && _sidebarReactView && _contentReactView && (!_hasList || _listReactView);
  if (panesReady && self.window && !_didPublishMount) {
    // This also runs when an already-laid-out Fabric tree joins its window.
    // Keep it before metrics deduplication so the startup cover cannot linger.
    _didPublishMount = YES;
    [[NSNotificationCenter defaultCenter] postNotificationName:@"LegendSidebarSplitViewDidMount"
                                                        object:self];
  }
  if (fabs(sidebarWidth - _lastSidebarWidth) < 0.5 &&
      fabs(contentWidth - _lastContentWidth) < 0.5 &&
      fabs(listWidth - _lastListWidth) < 0.5 &&
      fabs(height - _lastHeight) < 0.5 &&
      panesReady == _lastLayoutReady) {
    return;
  }

  _lastSidebarWidth = sidebarWidth;
  _lastContentWidth = contentWidth;
  _lastListWidth = listWidth;
  _lastHeight = height;
  _lastLayoutReady = panesReady;

  eventEmitter->onSplitViewDidResize(SidebarSplitViewEventEmitter::OnSplitViewDidResize{
    .contentHeight = contentHeight,
    .contentWidth = contentWidth,
    .contentX = contentX,
    .height = height,
    .isLayoutReady = static_cast<bool>(panesReady),
    .isVertical = true,
    .listHeight = listWidth > 0 ? height : 0,
    .listWidth = listWidth,
    .listX = listX,
    .sidebarHeight = sidebarHeight,
    .sidebarWidth = sidebarWidth,
  });
}

- (BOOL)applyEstimatedSplitViewLayoutForBounds:(CGRect)bounds layoutReady:(BOOL)layoutReady
{
  if (bounds.size.width <= 0 || bounds.size.height <= 0) {
    return NO;
  }

  CGFloat dividerThickness = _splitViewController.splitView.dividerThickness;
  CGFloat sidebarWidth = 0;
  if (!_sidebarCollapsed) {
    sidebarWidth = [self preferredSidebarWidthForBounds:bounds];
  }
  CGFloat listX = sidebarWidth > 0 ? sidebarWidth + dividerThickness : 0;
  CGFloat listWidth = [self preferredListWidthForBounds:bounds sidebarExtent:listX];
  CGFloat contentX = listWidth > 0 ? listX + listWidth + dividerThickness : listX;
  CGFloat contentWidth = MAX(0, bounds.size.width - contentX);
  if (contentWidth <= 0) {
    contentWidth = bounds.size.width;
    contentX = 0;
    listWidth = 0;
  }

  _splitViewController.view.frame = bounds;
  _splitViewController.splitView.frame = bounds;
  _sidebarContainer.frame = CGRectMake(0, 0, sidebarWidth, bounds.size.height);
  _listContainer.frame = CGRectMake(listX, 0, listWidth, bounds.size.height);
  _contentContainer.frame = CGRectMake(contentX, 0, contentWidth, bounds.size.height);

  CGRect sidebarBounds = CGRectMake(0, 0, sidebarWidth, bounds.size.height);
  CGRect contentBounds = CGRectMake(0, 0, contentWidth, bounds.size.height);
  [self syncReactSubview:_sidebarReactView
           nativeBounds:sidebarBounds
  previousLayoutMetrics:&_sidebarReactLayoutMetrics];
  [self syncReactSubview:_contentReactView
           nativeBounds:contentBounds
  previousLayoutMetrics:&_contentReactLayoutMetrics];
  [self syncReactSubview:_listReactView
           nativeBounds:CGRectMake(0, 0, listWidth, bounds.size.height)
  previousLayoutMetrics:&_listReactLayoutMetrics];
  [self layoutContentTitlebarMaterial];
  [self emitSplitViewDidResizeWithSidebarWidth:sidebarWidth
                                  contentWidth:contentWidth
                                      contentX:contentX
                                 sidebarHeight:bounds.size.height
                                 contentHeight:bounds.size.height
                                        height:bounds.size.height
                                     listWidth:listWidth
                                         listX:listX
                                   layoutReady:layoutReady];

  return YES;
}

- (void)publishSplitViewLayoutAllowEstimatedReady:(BOOL)allowEstimatedReady
{
  CGFloat sidebarWidth = _sidebarContainer.bounds.size.width;
  CGFloat contentWidth = _contentContainer.bounds.size.width;
  CGFloat contentX = [_contentContainer convertRect:_contentContainer.bounds toView:self].origin.x;
  CGFloat sidebarHeight = _sidebarContainer.bounds.size.height;
  CGFloat contentHeight = _contentContainer.bounds.size.height;
  CGFloat listWidth = _hasList ? _listContainer.bounds.size.width : 0;
  CGFloat listX = _hasList ? [_listContainer convertRect:_listContainer.bounds toView:self].origin.x : 0;
  CGFloat height = MAX(sidebarHeight, contentHeight);
  CGRect bounds = [self currentLayoutBounds];

  if (contentWidth <= 0 || height <= 0 ||
      contentX < -0.5 ||
      contentX + contentWidth > bounds.size.width + 0.5 ||
      fabs(_contentContainer.bounds.size.height - bounds.size.height) >= 0.5 ||
      (_hasList && listWidth <= 0)) {
    [self applyEstimatedSplitViewLayoutForBounds:bounds layoutReady:allowEstimatedReady];
    return;
  }

  [self syncReactSubviewFrames];
  [self layoutContentTitlebarMaterial];
  [self emitSplitViewDidResizeWithSidebarWidth:sidebarWidth
                                  contentWidth:contentWidth
                                      contentX:contentX
                                 sidebarHeight:sidebarHeight
                                 contentHeight:contentHeight
                                        height:height
                                     listWidth:listWidth
                                         listX:listX
                                   layoutReady:YES];
}

- (CGRect)currentLayoutBounds
{
  CGRect bounds = self.bounds;
  if ((bounds.size.width <= 0 || bounds.size.height <= 0) && _currentLayoutMetrics != EmptyLayoutMetrics) {
    bounds = CGRectMake(
      0,
      0,
      _currentLayoutMetrics.frame.size.width,
      _currentLayoutMetrics.frame.size.height);
  }
  return bounds;
}

/// Seeds dividers from the preferred widths. Runs only until it succeeds once (and again when those props
/// change), so a later layout pass never snaps a divider the user dragged back to its preferred position.
- (void)applyDividerPositionForBounds:(CGRect)bounds
{
  if (!_needsPreferredDividerPositions || bounds.size.width <= 0 || _splitViewController.splitView.subviews.count < 2) {
    return;
  }
  CGFloat dividerThickness = _splitViewController.splitView.dividerThickness;
  CGFloat sidebarExtent = 0;
  if (!_sidebarCollapsed) {
    CGFloat sidebarWidth = [self preferredSidebarWidthForBounds:bounds];
    if (sidebarWidth <= 0) {
      return;
    }
    [_splitViewController.splitView setPosition:sidebarWidth ofDividerAtIndex:0];
    sidebarExtent = sidebarWidth + dividerThickness;
  }
  if (_hasList) {
    if (_splitViewController.splitView.subviews.count < 3) {
      return;
    }
    CGFloat listWidth = [self preferredListWidthForBounds:bounds sidebarExtent:sidebarExtent];
    if (listWidth <= 0) {
      return;
    }
    [_splitViewController.splitView setPosition:sidebarExtent + listWidth ofDividerAtIndex:1];
  }
  _needsPreferredDividerPositions = NO;
}

- (void)layoutSplitView
{
  if (_layingOutSplitView) {
    return;
  }
  _layingOutSplitView = YES;
  CGRect bounds = [self currentLayoutBounds];
  _splitViewController.view.frame = bounds;
  _splitViewController.splitView.frame = bounds;
  [self updateListItem];
  [self updateSidebarCollapsed];
  if (_contentContainer.bounds.size.width <= 0 ||
      _contentContainer.bounds.size.height <= 0 ||
      fabs(_contentContainer.bounds.size.height - bounds.size.height) >= 0.5) {
    [self applyEstimatedSplitViewLayoutForBounds:bounds layoutReady:NO];
  }
  [self applyDividerPositionForBounds:bounds];
  [_splitViewController.view layoutSubtreeIfNeeded];
  [self layoutContentTitlebarMaterial];
  _layingOutSplitView = NO;
  [self publishSplitViewLayoutAllowEstimatedReady:YES];
}

- (void)updateEventEmitter:(const EventEmitter::Shared &)eventEmitter
{
  [super updateEventEmitter:eventEmitter];

  dispatch_async(dispatch_get_main_queue(), ^{
    [self publishSplitViewLayoutAllowEstimatedReady:NO];
  });
}
#endif

- (void)mountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)childComponentView
                          index:(NSInteger)index
{
#if TARGET_OS_OSX
  if (index == 0) {
    [_sidebarReactView removeFromSuperview];
    _sidebarReactView = childComponentView;
    _sidebarReactLayoutMetrics = EmptyLayoutMetrics;
    childComponentView.hidden = YES;
    [_sidebarContainer addSubview:childComponentView];
    if (_sidebarContainer.bounds.size.width <= 0 || _sidebarContainer.bounds.size.height <= 0) {
      [self applyEstimatedSplitViewLayoutForBounds:[self currentLayoutBounds] layoutReady:NO];
    } else {
      [self syncReactSubview:_sidebarReactView
                 nativeBounds:_sidebarContainer.bounds
        previousLayoutMetrics:&_sidebarReactLayoutMetrics];
    }
    dispatch_async(dispatch_get_main_queue(), ^{
      [self publishSplitViewLayoutAllowEstimatedReady:NO];
    });
    return;
  }

  if (index == 1) {
    [_contentReactView removeFromSuperview];
    _contentReactView = childComponentView;
    _contentReactLayoutMetrics = EmptyLayoutMetrics;
    childComponentView.hidden = YES;
    [_contentContainer addSubview:childComponentView];
    if (_contentContainer.bounds.size.width <= 0 || _contentContainer.bounds.size.height <= 0) {
      [self applyEstimatedSplitViewLayoutForBounds:[self currentLayoutBounds] layoutReady:NO];
    } else {
      [self syncReactSubview:_contentReactView
                 nativeBounds:_contentContainer.bounds
        previousLayoutMetrics:&_contentReactLayoutMetrics];
    }
    dispatch_async(dispatch_get_main_queue(), ^{
      [self publishSplitViewLayoutAllowEstimatedReady:NO];
    });
    return;
  }

  if (index == 2) {
    [_listReactView removeFromSuperview];
    _listReactView = childComponentView;
    _listReactLayoutMetrics = EmptyLayoutMetrics;
    childComponentView.hidden = YES;
    [_listContainer addSubview:childComponentView];
    [self syncReactSubview:_listReactView
               nativeBounds:_hasList ? _listContainer.bounds : CGRectZero
      previousLayoutMetrics:&_listReactLayoutMetrics];
    dispatch_async(dispatch_get_main_queue(), ^{
      [self publishSplitViewLayoutAllowEstimatedReady:NO];
    });
    return;
  }
#else
  if (index == 0) {
    [_sidebarContainer addSubview:childComponentView];
    return;
  }

  if (index == 1 || index == 2) {
    [_contentContainer addSubview:childComponentView];
    return;
  }
#endif

  [super mountChildComponentView:childComponentView index:index];
}

- (void)unmountChildComponentView:(RCTUIView<RCTComponentViewProtocol> *)childComponentView
                            index:(NSInteger)index
{
#if TARGET_OS_OSX
  if (childComponentView == _sidebarReactView) {
    _sidebarReactView = nil;
    _sidebarReactLayoutMetrics = EmptyLayoutMetrics;
    [childComponentView removeFromSuperview];
    return;
  }

  if (childComponentView == _contentReactView) {
    _contentReactView = nil;
    _contentReactLayoutMetrics = EmptyLayoutMetrics;
    [childComponentView removeFromSuperview];
    return;
  }

  if (childComponentView == _listReactView) {
    _listReactView = nil;
    _listReactLayoutMetrics = EmptyLayoutMetrics;
    [childComponentView removeFromSuperview];
    return;
  }
#else
  if (index == 0 || index == 1 || index == 2) {
    [childComponentView removeFromSuperview];
    return;
  }
#endif

  [super unmountChildComponentView:childComponentView index:index];
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &newProps = *std::static_pointer_cast<SidebarSplitViewProps const>(props);

#if TARGET_OS_OSX
  NSString *nextAppearanceName = [NSString stringWithUTF8String:newProps.appearance.c_str()];
  if (nextAppearanceName.length == 0) {
    nextAppearanceName = @"system";
  }
  BOOL preferredWidthsChanged =
    fabs(_sidebarWidth - newProps.sidebarWidth) >= 0.5 ||
    fabs(_listWidth - newProps.listWidth) >= 0.5 ||
    _hasList != newProps.hasList ||
    _sidebarCollapsed != newProps.sidebarCollapsed;
  BOOL shouldRelayout =
    preferredWidthsChanged ||
    fabs(_sidebarMinWidth - newProps.sidebarMinWidth) >= 0.5 ||
    fabs(_contentMinWidth - newProps.contentMinWidth) >= 0.5 ||
    fabs(_listMinWidth - newProps.listMinWidth) >= 0.5 ||
    fabs(_contentTitlebarHeight - newProps.contentTitlebarHeight) >= 0.5;
  NSString *nextContentTitlebarMaterialName = [NSString stringWithUTF8String:newProps.contentTitlebarMaterial.c_str()];
  if (nextContentTitlebarMaterialName.length == 0) {
    nextContentTitlebarMaterialName = @"none";
  }
  NSString *nextContentTitlebarOverlayColorValue = [NSString stringWithUTF8String:newProps.contentTitlebarOverlayColor.c_str()];
  if (nextContentTitlebarOverlayColorValue.length == 0) {
    nextContentTitlebarOverlayColorValue = nil;
  }
  CGFloat nextContentTitlebarOverlayOpacity = RNSidebarSplitViewClampedUnitValue(newProps.contentTitlebarOverlayOpacity);
  NSString *nextSidebarTitlebarOverlayColorValue = [NSString stringWithUTF8String:newProps.sidebarTitlebarOverlayColor.c_str()];
  if (nextSidebarTitlebarOverlayColorValue.length == 0) {
    nextSidebarTitlebarOverlayColorValue = nil;
  }
  CGFloat nextSidebarTitlebarOverlayOpacity = RNSidebarSplitViewClampedUnitValue(newProps.sidebarTitlebarOverlayOpacity);
  BOOL shouldRecreateContentTitlebarMaterial =
    ![_contentTitlebarMaterialName isEqualToString:nextContentTitlebarMaterialName] ||
    !((_contentTitlebarOverlayColorValue == nextContentTitlebarOverlayColorValue) ||
      [_contentTitlebarOverlayColorValue isEqualToString:nextContentTitlebarOverlayColorValue]) ||
    fabs(_contentTitlebarOverlayOpacity - nextContentTitlebarOverlayOpacity) >= 0.001 ||
    fabs(_contentTitlebarHeight - newProps.contentTitlebarHeight) >= 0.5;
  BOOL shouldRecreateSidebarTitlebarMaterial =
    !((_sidebarTitlebarOverlayColorValue == nextSidebarTitlebarOverlayColorValue) ||
      [_sidebarTitlebarOverlayColorValue isEqualToString:nextSidebarTitlebarOverlayColorValue]) ||
    fabs(_sidebarTitlebarOverlayOpacity - nextSidebarTitlebarOverlayOpacity) >= 0.001 ||
    fabs(_contentTitlebarHeight - newProps.contentTitlebarHeight) >= 0.5;
  _sidebarMinWidth = newProps.sidebarMinWidth;
  _sidebarWidth = newProps.sidebarWidth;
  _contentMinWidth = newProps.contentMinWidth;
  _listMinWidth = newProps.listMinWidth;
  _listWidth = newProps.listWidth;
  _hasList = newProps.hasList;
  _sidebarCollapsed = newProps.sidebarCollapsed;
  if (preferredWidthsChanged) {
    _needsPreferredDividerPositions = YES;
  }
  _contentTitlebarHeight = newProps.contentTitlebarHeight;
  _contentTitlebarMaterialName = nextContentTitlebarMaterialName;
  _contentTitlebarOverlayColorValue = nextContentTitlebarOverlayColorValue;
  _contentTitlebarOverlayOpacity = nextContentTitlebarOverlayOpacity;
  _sidebarTitlebarOverlayColorValue = nextSidebarTitlebarOverlayColorValue;
  _sidebarTitlebarOverlayOpacity = nextSidebarTitlebarOverlayOpacity;
  if (shouldRecreateContentTitlebarMaterial) {
    [self removeContentTitlebarMaterial];
  }
  if (shouldRecreateSidebarTitlebarMaterial) {
    [self removeSidebarTitlebarMaterial];
  }
  if (![_appearanceName isEqualToString:nextAppearanceName]) {
    _appearanceName = nextAppearanceName;
    [self applyAppearance];
  }
  [self updateListItem];
  [self updateSidebarCollapsed];
  [self updateSplitItemSizing];
#endif

  [super updateProps:props oldProps:oldProps];

#if TARGET_OS_OSX
  if (shouldRelayout || shouldRecreateContentTitlebarMaterial || shouldRecreateSidebarTitlebarMaterial) {
    _lastSidebarWidth = -1;
    _lastContentWidth = -1;
    _lastListWidth = -1;
    _lastHeight = -1;
    _lastLayoutReady = NO;
    [self layoutSplitView];
  }
#endif
}

- (void)updateLayoutMetrics:(const LayoutMetrics &)layoutMetrics
           oldLayoutMetrics:(const LayoutMetrics &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];

#if TARGET_OS_OSX
  _currentLayoutMetrics = layoutMetrics;
  [self layoutSplitView];
#else
  CGFloat sidebarWidth = self.bounds.size.width * 0.26;
  _sidebarContainer.frame = CGRectMake(0, 0, sidebarWidth, self.bounds.size.height);
  _contentContainer.frame = CGRectMake(sidebarWidth, 0, self.bounds.size.width - sidebarWidth, self.bounds.size.height);
#endif
}

#if TARGET_OS_OSX
- (void)layout
{
  [super layout];

  [self layoutSplitView];
}

- (void)setFrameSize:(NSSize)newSize
{
  [super setFrameSize:newSize];

  [self layoutSplitView];
}

- (void)viewDidMoveToWindow
{
  [super viewDidMoveToWindow];

  if (self.window) {
    dispatch_async(dispatch_get_main_queue(), ^{
      if (self.window) {
        [self layoutSplitView];
      }
    });
  }
}
#endif

- (void)layoutSubviews
{
  [super layoutSubviews];

#if TARGET_OS_OSX
  [self layoutSplitView];
#else
  CGFloat sidebarWidth = self.bounds.size.width * 0.26;
  _sidebarContainer.frame = CGRectMake(0, 0, sidebarWidth, self.bounds.size.height);
  _contentContainer.frame = CGRectMake(sidebarWidth, 0, self.bounds.size.width - sidebarWidth, self.bounds.size.height);
#endif
}

- (void)prepareForRecycle
{
  [super prepareForRecycle];

#if TARGET_OS_OSX
  [_sidebarReactView removeFromSuperview];
  [_contentReactView removeFromSuperview];
  [_listReactView removeFromSuperview];
  _sidebarReactView = nil;
  _contentReactView = nil;
  _listReactView = nil;
  _currentLayoutMetrics = EmptyLayoutMetrics;
  _sidebarReactLayoutMetrics = EmptyLayoutMetrics;
  _contentReactLayoutMetrics = EmptyLayoutMetrics;
  _listReactLayoutMetrics = EmptyLayoutMetrics;
  _sidebarMinWidth = 180;
  _sidebarWidth = 0;
  _contentMinWidth = 320;
  _listMinWidth = 240;
  _listWidth = 0;
  _hasList = NO;
  _sidebarCollapsed = NO;
  _needsPreferredDividerPositions = YES;
  _layingOutSplitView = NO;
  _lastSidebarWidth = -1;
  _lastContentWidth = -1;
  _lastListWidth = -1;
  _lastHeight = -1;
  _lastLayoutReady = NO;
  _appearanceName = @"system";
  _didPublishMount = NO;
  _contentTitlebarHeight = 0;
  _contentTitlebarMaterialName = @"none";
  _contentTitlebarOverlayColorValue = nil;
  _contentTitlebarOverlayOpacity = 0;
  _sidebarTitlebarOverlayColorValue = nil;
  _sidebarTitlebarOverlayOpacity = 0;
  [self removeContentTitlebarMaterial];
  [self removeSidebarTitlebarMaterial];
  [self applyAppearance];
  [self updateListItem];
  [self updateSidebarCollapsed];
  [self updateSplitItemSizing];
#else
  for (UIView *subview in _sidebarContainer.subviews) {
    [subview removeFromSuperview];
  }
  for (UIView *subview in _contentContainer.subviews) {
    [subview removeFromSuperview];
  }
#endif
}

- (void)dealloc
{
#if TARGET_OS_OSX
  if (_resizeObserver) {
    [[NSNotificationCenter defaultCenter] removeObserver:_resizeObserver];
  }
  if (_contentFrameObserver) {
    [[NSNotificationCenter defaultCenter] removeObserver:_contentFrameObserver];
  }
  if (_contentBoundsObserver) {
    [[NSNotificationCenter defaultCenter] removeObserver:_contentBoundsObserver];
  }
#endif
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<SidebarSplitViewComponentDescriptor>();
}

@end

#if TARGET_OS_OSX
// Optional C entry points let the host and window manager share this lifecycle
// without requiring apps that do not use split views to link this package.
extern "C" void LegendPrepareSidebarSplitViewStartup(NSWindow *window, NSDictionary *configuration)
{
  if (![configuration isKindOfClass:NSDictionary.class] ||
      objc_getAssociatedObject(window, &RNSidebarSplitViewStartupKey)) {
    return;
  }
  RNSidebarSplitViewStartupView *view = [[RNSidebarSplitViewStartupView alloc]
    initWithFrame:window.contentView.bounds configuration:configuration];
  objc_setAssociatedObject(window, &RNSidebarSplitViewStartupKey, view, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  window.appearance = view.appearance;
  [window.contentView addSubview:view];
  [window.contentView layoutSubtreeIfNeeded];
}

extern "C" BOOL LegendAttachSidebarSplitViewStartupRoot(NSWindow *window, NSView *rootView,
                                                        void (^installRoot)(void))
{
  RNSidebarSplitViewStartupView *view = objc_getAssociatedObject(window, &RNSidebarSplitViewStartupKey);
  if (!view) {
    return NO;
  }
  view.installReactRoot = installRoot;
  // The split panes own their backgrounds. Do not carry the host's temporary
  // solid startup fill underneath AppKit's floating sidebar after the swap.
  if ([rootView respondsToSelector:@selector(setBackgroundColor:)]) {
    [(RCTUIView *)rootView setBackgroundColor:NSColor.clearColor];
  }
  rootView.layer.backgroundColor = NSColor.clearColor.CGColor;
  rootView.frame = window.contentView.bounds;
  [window.contentView addSubview:rootView positioned:NSWindowBelow relativeTo:view];
  return YES;
}

extern "C" void LegendFinishSidebarSplitViewStartup(NSWindow *window)
{
  RNSidebarSplitViewStartupView *view = objc_getAssociatedObject(window, &RNSidebarSplitViewStartupKey);
  [view finish];
}
#endif
