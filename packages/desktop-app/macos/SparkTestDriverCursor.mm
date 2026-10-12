#import "SparkTestDriverPrivate.h"
#import <objc/runtime.h>

// The cursor in driver mode (docs/test-driver.md#cursor). A driven app must never change the cursor of the person using
// this Mac, so +[NSCursor setHiddenUntilMouseMoves:] (which text views call on every typed key) is recorded instead of
// applied, and the driver's pointer moves end it as real moves would. The `cursor` command reports the cursor AppKit
// would show at a point: the cursor rect (-[NSView addCursorRect:cursor:]) of the innermost view there that has one,
// else the cursor its cursor update sets (-[NSCursor set] from -cursorUpdate:), else the arrow. The driver records
// them while it asks each view and applies neither.

static BOOL hiddenUntilMoved = NO;
static NSMutableArray<NSArray *> *recorded; // [rect in window coordinates, cursor] while asking for cursor rects; nil otherwise.
static BOOL updating = NO; // Asking for a cursor update: -[NSCursor set] is recorded in `updated`.
static NSCursor *updated;
static IMP addCursorRect, setCursor;

static void SparkSetHidden(id, SEL, BOOL flag) { hiddenUntilMoved = flag; }
static void SparkAddCursorRect(NSView *self, SEL selector, NSRect rect, NSCursor *cursor) {
  if (!recorded) { ((void (*)(id, SEL, NSRect, NSCursor *))addCursorRect)(self, selector, rect, cursor); return; }
  if (cursor) [recorded addObject:@[[NSValue valueWithRect:[self convertRect:rect toView:nil]], cursor]];
}
static void SparkSetCursor(NSCursor *self, SEL selector) {
  if (updating) updated = self;
  else ((void (*)(id, SEL))setCursor)(self, selector);
}

void SparkDriverCursorStart(void) {
  method_setImplementation(class_getClassMethod(NSCursor.class, @selector(setHiddenUntilMouseMoves:)), (IMP)SparkSetHidden);
  addCursorRect = method_setImplementation(class_getInstanceMethod(NSView.class, @selector(addCursorRect:cursor:)), (IMP)SparkAddCursorRect);
  setCursor = method_setImplementation(class_getInstanceMethod(NSCursor.class, @selector(set)), (IMP)SparkSetCursor);
}
void SparkDriverCursorMoved(void) { hiddenUntilMoved = NO; }

// AppKit's shared cursors by name. Some are one object under two names (macOS 15's columnResizeCursor is
// resizeLeftRightCursor); the first name wins.
static NSString *SparkCursorName(NSCursor *cursor) {
  NSMutableArray<NSArray *> *known = [@[
    @[@"arrow", NSCursor.arrowCursor], @[@"IBeam", NSCursor.IBeamCursor], @[@"IBeamVertical", NSCursor.IBeamCursorForVerticalLayout],
    @[@"pointingHand", NSCursor.pointingHandCursor], @[@"crosshair", NSCursor.crosshairCursor], @[@"openHand", NSCursor.openHandCursor],
    @[@"closedHand", NSCursor.closedHandCursor], @[@"operationNotAllowed", NSCursor.operationNotAllowedCursor], @[@"dragLink", NSCursor.dragLinkCursor],
    @[@"dragCopy", NSCursor.dragCopyCursor], @[@"contextualMenu", NSCursor.contextualMenuCursor], @[@"disappearingItem", NSCursor.disappearingItemCursor],
    @[@"resizeLeftRight", NSCursor.resizeLeftRightCursor], @[@"resizeUpDown", NSCursor.resizeUpDownCursor], @[@"resizeLeft", NSCursor.resizeLeftCursor],
    @[@"resizeRight", NSCursor.resizeRightCursor], @[@"resizeUp", NSCursor.resizeUpCursor], @[@"resizeDown", NSCursor.resizeDownCursor],
  ] mutableCopy];
  if (@available(macOS 15.0, *)) [known addObjectsFromArray:@[@[@"columnResize", NSCursor.columnResizeCursor], @[@"rowResize", NSCursor.rowResizeCursor],
    @[@"zoomIn", NSCursor.zoomInCursor], @[@"zoomOut", NSCursor.zoomOutCursor]]];
  for (NSArray *entry in known) if (entry[1] == cursor) return entry[0];
  // AppKit also makes copies of them (a text field being edited outside the key window shows a copy of the arrow).
  NSData *image = cursor.image.TIFFRepresentation;
  for (NSArray *entry in known) if (NSEqualPoints([entry[1] hotSpot], cursor.hotSpot) && [[entry[1] image].TIFFRepresentation isEqual:image]) return entry[0];
  // Any other cursor is the app's own; Spark names its custom cursors through the image's accessibility description.
  NSString *description = cursor.image.accessibilityDescription;
  return description.length ? [NSString stringWithFormat:@"custom(%@)", description] : @"custom";
}

NSDictionary *SparkDriverCursorAt(NSWindow *window, NSPoint location) {
  NSMutableArray<NSView *> *chain = [NSMutableArray new];
  for (NSView *view = [SparkDriverFrameView(window) hitTest:location]; view; view = view.superview) [chain addObject:view];
  // Cursor rects first, innermost view first. A view outside the key window (a text view's -cursorUpdate:) may answer
  // with the arrow, while the driver treats the target window as the key window.
  NSCursor *found = nil;
  recorded = [NSMutableArray new];
  for (NSView *view in chain) {
    [recorded removeAllObjects];
    [view resetCursorRects];
    for (NSArray *entry in recorded) if (NSPointInRect(location, [entry[0] rectValue])) found = entry[1];
    if (found) break;
  }
  recorded = nil;
  // Asking a view for its cursor rects replaced the ones AppKit holds; it rebuilds them.
  for (NSView *view in chain) [window invalidateCursorRectsForView:view];
  for (NSView *view in found ? @[] : chain) {
    for (NSTrackingArea *area in view.trackingAreas) {
      NSRect rect = (area.options & NSTrackingInVisibleRect) ? view.visibleRect : area.rect;
      if (!(area.options & NSTrackingCursorUpdate) || !NSPointInRect([view convertPoint:location fromView:nil], rect)) continue;
      NSEvent *update = [NSEvent enterExitEventWithType:NSEventTypeCursorUpdate location:location modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime
        windowNumber:window.windowNumber context:nil eventNumber:0 trackingNumber:(NSInteger)(__bridge void *)area userData:NULL];
      updating = YES;
      updated = nil;
      [(NSResponder *)area.owner cursorUpdate:update];
      updating = NO;
      found = updated;
      updated = nil;
      if (found) break;
    }
    if (found) break;
  }
  return @{ @"cursor": SparkCursorName(found ?: NSCursor.arrowCursor), @"hiddenUntilMoved": @(hiddenUntilMoved) };
}
