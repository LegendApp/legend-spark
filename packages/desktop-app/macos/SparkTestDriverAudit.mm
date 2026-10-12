#import "SparkTestDriverPrivate.h"

// Accessibility audit facts (docs/test-driver.md#accessibility-audit). The runner judges them
// (scripts/e2e/runner/driver-audit.ts); this collects what only the process can see. For every accessibility element
// of the audited windows: its role, label, title, placeholder, value and help as NSAccessibility reports them
// in-process, whether it is editable, and whether it is inside a disabled AppKit control. For every view that draws text: the text, its declared colours (sRGB, in the view's
// effective appearance) and fonts, the opacity of the view and its ancestors, and where it is in a render of its
// window (sRGB). Text the window does not show is scrolled into view (scrollRectToVisible:, as pointer input does) and
// rendered again, so long screens are audited whole; every scroll position is restored before the reply.

@interface SparkAuditText : NSObject
@property (nonatomic, strong) NSView *view;
@property (nonatomic, strong) NSMutableDictionary *element;
// Set once scrolling cannot show the whole view (it is larger than its scroll view, or clipped): the next render
// samples what is visible of it.
@property (nonatomic) BOOL partial;
@end
@implementation SparkAuditText
@end

NSArray<NSString *> *SparkDriverAuditCommandNames(void) {
  static NSArray *names = @[@"accessibilityAudit"];
  return names;
}

static NSString *SparkAuditString(id value) {
  if ([value isKindOfClass:NSNumber.class]) return [value stringValue];
  if ([value isKindOfClass:NSAttributedString.class]) value = [value string];
  return [value isKindOfClass:NSString.class] && [value length] ? value : nil;
}
static BOOL SparkAuditBlank(NSString *text) {
  return [text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet].length == 0;
}
// The text a view draws: React Native Text (attributedText) or a non-editable text field.
static NSAttributedString *SparkAuditDrawnText(NSView *view) {
  id attributed = [view respondsToSelector:@selector(attributedText)] ? [view valueForKey:@"attributedText"] : nil;
  if ([attributed isKindOfClass:NSAttributedString.class]) return attributed;
  if ([view isKindOfClass:NSTextField.class] && !((NSTextField *)view).isEditable) return ((NSTextField *)view).attributedStringValue;
  return nil;
}
// Each distinct foreground colour of the visible runs, resolved to sRGB in the view's appearance; the smallest font
// size; whether every run is bold. A colour that does not resolve to sRGB (a pattern) is reported as unresolved.
static NSDictionary *SparkAuditTextStyle(NSView *view, NSAttributedString *text) {
  NSMutableArray *colors = [NSMutableArray new];
  __block CGFloat size = CGFLOAT_MAX;
  __block BOOL bold = YES, unresolved = NO;
  // A vibrant appearance's label colours are translucent greys that the window server blends with what is behind
  // them; an in-process render skips that blending, so text is judged in the matching non-vibrant appearance.
  NSAppearanceName name = [view.effectiveAppearance bestMatchFromAppearancesWithNames:@[NSAppearanceNameAqua, NSAppearanceNameDarkAqua]] ?: NSAppearanceNameAqua;
  [[NSAppearance appearanceNamed:name] performAsCurrentDrawingAppearance:^{
    [text enumerateAttributesInRange:NSMakeRange(0, text.length) options:0 usingBlock:^(NSDictionary *attributes, NSRange range, BOOL *) {
      if (SparkAuditBlank([text.string substringWithRange:range])) return;
      // An attributed string without a foreground colour draws black.
      id declared = attributes[NSForegroundColorAttributeName] ?: NSColor.blackColor;
      NSColor *color = [declared isKindOfClass:NSColor.class] ? [declared colorUsingColorSpace:NSColorSpace.sRGBColorSpace] : nil;
      if (color) {
        NSDictionary *rgba = @{ @"r": @(round(color.redComponent * 255)), @"g": @(round(color.greenComponent * 255)), @"b": @(round(color.blueComponent * 255)), @"a": @(color.alphaComponent) };
        if (![colors containsObject:rgba]) [colors addObject:rgba];
      } else unresolved = YES;
      // An attributed string without a font draws in 12-point Helvetica.
      NSFont *font = [attributes[NSFontAttributeName] isKindOfClass:NSFont.class] ? attributes[NSFontAttributeName] : [NSFont fontWithName:@"Helvetica" size:12];
      size = MIN(size, font.pointSize);
      bold = bold && (font.fontDescriptor.symbolicTraits & NSFontDescriptorTraitBold);
    }];
  }];
  return @{ @"colors": colors, @"unresolved": @(unresolved), @"size": @(size == CGFLOAT_MAX ? 0 : size), @"bold": @(bold) };
}

// Whether the keyboard reaches a view by itself. An AppKit control takes focus unless it refuses it (buttons only
// with full keyboard access, a system setting the audit does not depend on); any other view when it accepts first
// responder (a React Native view with `focusable`).
static BOOL SparkAuditFocusable(NSView *view) {
  return [view isKindOfClass:NSControl.class] ? !((NSControl *)view).refusesFirstResponder : view.acceptsFirstResponder;
}
// `inText`: inside a view that draws text, whose text views (a selectable React Native Text's NSTextView) draw the same text.
// `inList`: inside a table, outline or collection view, whose items the arrow keys reach; `inSourceList`: inside a
// source-list table.
static void SparkAuditCollect(NSView *view, NSString *windowID, NSMutableDictionary *parent, NSString *within, CGFloat opacity, BOOL enabled, BOOL inText, BOOL inList, BOOL inSourceList,
                              NSMutableArray *elements, NSMutableArray<SparkAuditText *> *texts) {
  if (view.isHidden) return;
  // While its window is not key (a driven window never is), AppKit draws a source list's text fields at half
  // opacity through their layer, leaving alphaValue alone; their opacity is the one a user sees in the active window.
  BOOL dimmedForInactive = inSourceList && [view isKindOfClass:NSTextField.class] && !view.window.isKeyWindow;
  opacity *= view.layer && !dimmedForInactive ? view.layer.opacity : view.alphaValue;
  NSString *testID = SparkAuditString(view.accessibilityIdentifier);
  within = testID ?: within;
  NSCell *cell = [view isKindOfClass:NSControl.class] ? ((NSControl *)view).cell : nil;
  // Only AppKit controls say reliably whether they are enabled: React Native macOS views report accessibilityEnabled
  // NO unless their accessibility traits changed, and do not map accessibilityState.disabled to it.
  enabled = enabled && (![view isKindOfClass:NSControl.class] || ((NSControl *)view).isEnabled);
  NSAttributedString *drawn = inText ? nil : SparkAuditDrawnText(view);
  BOOL draws = drawn && !SparkAuditBlank(drawn.string);
  NSMutableDictionary *element = parent;
  if (view.isAccessibilityElement || cell || draws) {
    element = [@{ @"key": [NSString stringWithFormat:@"%lu", (unsigned long)elements.count], @"window": windowID, @"frame": SparkDriverFrame(view),
      @"element": @(view.isAccessibilityElement || cell.isAccessibilityElement), @"enabled": @(enabled), @"opacity": @(opacity) } mutableCopy];
    element[@"parent"] = parent[@"key"]; element[@"id"] = testID; element[@"within"] = within;
    element[@"role"] = SparkDriverRoleName(SparkAuditString(cell.accessibilityRole) ?: view.accessibilityRole);
    element[@"label"] = SparkAuditString(view.accessibilityLabel) ?: SparkAuditString(cell.accessibilityLabel);
    element[@"title"] = SparkAuditString(view.accessibilityTitle) ?: SparkAuditString(cell.accessibilityTitle);
    element[@"placeholder"] = SparkAuditString(view.accessibilityPlaceholderValue) ?: SparkAuditString(cell.accessibilityPlaceholderValue);
    element[@"value"] = SparkAuditString(view.accessibilityValue) ?: SparkAuditString(cell.accessibilityValue);
    element[@"help"] = SparkAuditString(view.accessibilityHelp) ?: SparkAuditString(cell.accessibilityHelp);
    element[@"focusable"] = @(inList || SparkAuditFocusable(view));
    if ([view respondsToSelector:@selector(isEditable)]) element[@"editable"] = @([(id)view isEditable]);
    if (draws) {
      element[@"text"] = drawn.string;
      element[@"textStyle"] = SparkAuditTextStyle(view, drawn);
      if (opacity > 0) {
        SparkAuditText *text = [SparkAuditText new];
        text.view = view; text.element = element;
        [texts addObject:text];
      }
    }
    [elements addObject:element];
  }
  inList = inList || [view isKindOfClass:NSTableView.class] || [view isKindOfClass:NSCollectionView.class];
  inSourceList = inSourceList || ([view isKindOfClass:NSTableView.class] && ((NSTableView *)view).effectiveStyle == NSTableViewStyleSourceList);
  for (NSView *child in view.subviews) SparkAuditCollect(child, windowID, element, within, opacity, enabled, inText || draws, inList, inSourceList, elements, texts);
}

static void SparkAuditClips(NSView *view, NSMutableArray<NSClipView *> *clips) {
  if ([view isKindOfClass:NSClipView.class]) [clips addObject:(NSClipView *)view];
  for (NSView *child in view.subviews) SparkAuditClips(child, clips);
}

// The part of a view its window shows. visibleRect alone extends past the bounds of a view that does not clip (since
// macOS 14), so it is limited to the bounds.
static NSRect SparkAuditVisible(NSView *view) { return NSIntersectionRect(view.visibleRect, view.bounds); }
static BOOL SparkAuditWhole(NSView *view) {
  NSRect visible = SparkAuditVisible(view);
  return NSWidth(visible) >= NSWidth(view.bounds) - 0.5 && NSHeight(visible) >= NSHeight(view.bounds) - 0.5;
}
// What of `rect` (in `view`) a render of the frame view shows, in its pixels, rounded inward.
static NSDictionary *SparkAuditPixels(NSView *view, NSRect rect, NSView *root, CGFloat scale) {
  NSRect frame = [view convertRect:rect toView:root];
  if (!root.isFlipped) frame.origin.y = NSHeight(root.bounds) - NSMaxY(frame);
  const CGFloat x0 = ceil(NSMinX(frame) * scale), y0 = ceil(NSMinY(frame) * scale), x1 = floor(NSMaxX(frame) * scale), y1 = floor(NSMaxY(frame) * scale);
  if (x1 <= x0 || y1 <= y0) return nil;
  return @{ @"x": @(x0), @"y": @(y0), @"width": @(x1 - x0), @"height": @(y1 - y0) };
}

// Renders the window until every text in `pending` was sampled whole, or as far as scrolling shows it.
static NSString *SparkAuditRender(NSWindow *window, NSString *name, NSMutableArray<SparkAuditText *> *pending, NSMutableArray *captures) {
  NSView *root = SparkDriverFrameView(window);
  while (pending.count) {
    NSBitmapImageRep *rendered = SparkDriverRenderWindow(window);
    NSBitmapImageRep *rep = [rendered bitmapImageRepByConvertingToColorSpace:NSColorSpace.sRGBColorSpace renderingIntent:NSColorRenderingIntentDefault];
    NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    if (!png) return @"Rendering produced no image";
    NSString *file = [NSString stringWithFormat:@"%@-%lu.png", name, (unsigned long)captures.count];
    int error = SparkDriverWriteCapture(file, png);
    if (error) return [NSString stringWithFormat:@"%@: %s", file, strerror(error)];
    const CGFloat scale = rep.pixelsWide / NSWidth(root.bounds);
    NSNumber *index = @(captures.count);
    [captures addObject:@{ @"file": file, @"window": window.identifier, @"width": @(rep.pixelsWide), @"height": @(rep.pixelsHigh), @"scale": @(scale) }];
    NSMutableArray<SparkAuditText *> *rest = [NSMutableArray new];
    for (SparkAuditText *text in pending) {
      BOOL whole = SparkAuditWhole(text.view);
      if (!whole && !text.partial) { [rest addObject:text]; continue; }
      NSDictionary *sample = SparkAuditPixels(text.view, SparkAuditVisible(text.view), root, scale);
      if (!sample) continue; // Nothing of it can be shown: a user cannot see it either.
      text.element[@"capture"] = index; text.element[@"sample"] = sample; text.element[@"clipped"] = @(!whole);
    }
    [pending setArray:rest];
    if (!rest.count) break;
    SparkAuditText *next = rest.firstObject;
    [next.view scrollRectToVisible:next.view.bounds];
    [window layoutIfNeeded];
    if (!SparkAuditWhole(next.view)) next.partial = YES;
  }
  return nil;
}

void SparkDriverAudit(NSDictionary *request, SparkTestDriverReply reply) {
  NSString *scope = request[@"scope"] ?: @"window", *name = request[@"name"];
  if (![scope isEqual:@"window"] && ![scope isEqual:@"app"]) { reply(SparkDriverFailure(@"E_INVALID_ARGUMENT", @"scope is window (the main window) or app (every window with an identifier)")); return; }
  // Capture files are <name>-<n>.png.
  if (!SparkDriverCaptureName(name) || [name length] > 90) { reply(SparkDriverFailure(@"E_INVALID_ARGUMENT", @"Audit names use 1-90 of [A-Za-z0-9_-] and do not start with -")); return; }
  NSMutableArray<NSWindow *> *windows = [NSMutableArray new];
  if ([scope isEqual:@"window"]) {
    NSString *failure = nil;
    NSWindow *main = SparkDriverResolveWindow(@"main", &failure);
    if (!main) { reply(SparkDriverFailure(@"E_NO_WINDOW", failure)); return; }
    [windows addObject:main];
  } else {
    for (NSWindow *window in NSApp.windows) if (SparkAuditString(window.identifier) && window.contentView) [windows addObject:window];
  }
  SparkDriverWhenSettled(request[@"timeoutMs"], ^(BOOL settled) {
    if (!settled) { reply(SparkDriverFailure(@"E_NOT_SETTLED", @"The UI kept mounting changes until the timeout")); return; }
    NSMutableArray *elements = [NSMutableArray new], *captures = [NSMutableArray new], *audited = [NSMutableArray new];
    for (NSWindow *window in windows) {
      [window layoutIfNeeded];
      NSMutableArray<SparkAuditText *> *texts = [NSMutableArray new];
      // The app's content only: the title bar and its buttons are AppKit's, drawn in the inactive style a driven window has.
      SparkAuditCollect(window.contentView, window.identifier, nil, nil, 1, YES, NO, NO, NO, elements, texts);
      NSMutableArray<NSClipView *> *clips = [NSMutableArray new];
      SparkAuditClips(window.contentView, clips);
      NSMutableArray<NSValue *> *origins = [NSMutableArray new];
      for (NSClipView *clip in clips) [origins addObject:[NSValue valueWithPoint:clip.bounds.origin]];
      NSString *failure = SparkAuditRender(window, name, texts, captures);
      [clips enumerateObjectsUsingBlock:^(NSClipView *clip, NSUInteger index, BOOL *) {
        [clip scrollToPoint:origins[index].pointValue];
        if ([clip.superview isKindOfClass:NSScrollView.class]) [(NSScrollView *)clip.superview reflectScrolledClipView:clip];
      }];
      if (failure) { reply(SparkDriverFailure(@"E_IO", failure)); return; }
      [audited addObject:@{ @"id": window.identifier, @"title": window.title }];
    }
    reply(@{ @"ok": @YES, @"windows": audited, @"captures": captures, @"elements": elements });
  });
}
