#pragma once
#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>

// AppKit screen frames are already logical units, with an upward-positive Y axis.
static inline NSDictionary *SparkLogicalBounds(NSRect frame, NSRect screen, NSString *displayId) {
  return @{ @"displayId": displayId, @"x": @(NSMinX(frame) - NSMinX(screen)), @"y": @(NSMaxY(screen) - NSMaxY(frame)), @"width": @(NSWidth(frame)), @"height": @(NSHeight(frame)) };
}
static inline NSRect SparkAppKitFrame(NSDictionary *bounds, NSRect screen) {
  const CGFloat height = [bounds[@"height"] doubleValue];
  return NSMakeRect(NSMinX(screen) + [bounds[@"x"] doubleValue], NSMaxY(screen) - [bounds[@"y"] doubleValue] - height, [bounds[@"width"] doubleValue], height);
}
static inline NSString *SparkScreenId(NSScreen *screen) { return [screen.deviceDescription[@"NSScreenNumber"] stringValue]; }
static inline NSScreen *SparkPrimaryScreen(void) {
  for (NSScreen *screen in NSScreen.screens) if ([screen.deviceDescription[@"NSScreenNumber"] unsignedIntValue] == CGMainDisplayID()) return screen;
  return NSScreen.screens.firstObject;
}
static inline NSScreen *SparkScreenWithId(NSString *identifier) {
  for (NSScreen *screen in NSScreen.screens) if ([SparkScreenId(screen) isEqual:identifier]) return screen;
  return nil;
}
static inline NSScreen *SparkOwningScreen(NSRect frame) {
  NSScreen *best = SparkPrimaryScreen(); CGFloat area = -1;
  for (NSScreen *screen in NSScreen.screens) {
    NSRect intersection = NSIntersectionRect(frame, screen.frame);
    CGFloat next = NSWidth(intersection) * NSHeight(intersection);
    if (next > area || (next == area && screen == SparkPrimaryScreen())) { best = screen; area = next; }
  }
  return best;
}
static inline NSDictionary *SparkBoundsForWindow(NSWindow *window) {
  NSScreen *screen = SparkOwningScreen(window.frame);
  return SparkLogicalBounds(window.frame, screen.frame, SparkScreenId(screen) ?: @"");
}
static inline NSString *SparkPersistentScreenId(NSScreen *screen) {
  CFUUIDRef uuid = CGDisplayCreateUUIDFromDisplayID([screen.deviceDescription[@"NSScreenNumber"] unsignedIntValue]);
  NSString *value = uuid ? CFBridgingRelease(CFUUIDCreateString(kCFAllocatorDefault, uuid)) : nil;
  if (uuid) CFRelease(uuid);
  return value;
}
// The pointer in Spark's coordinate vocabulary: the display containing the
// point, with display-relative logical units (top-left origin, Y downward).
static inline NSDictionary *SparkCursorPoint(void) {
  NSPoint point = NSEvent.mouseLocation;
  for (NSScreen *screen in NSScreen.screens) {
    NSRect frame = screen.frame;
    if (point.x >= NSMinX(frame) && point.x < NSMaxX(frame) && point.y >= NSMinY(frame) && point.y < NSMaxY(frame))
      return @{ @"displayId": SparkScreenId(screen) ?: @"", @"x": @(point.x - NSMinX(frame)), @"y": @(NSMaxY(frame) - point.y) };
  }
  NSScreen *primary = SparkPrimaryScreen();
  return @{ @"displayId": SparkScreenId(primary) ?: @"", @"x": @(point.x - NSMinX(primary.frame)), @"y": @(NSMaxY(primary.frame) - point.y) };
}
static inline NSArray<NSDictionary *> *SparkDisplayInfo(void) {
  NSMutableArray *result = [NSMutableArray new];
  for (NSScreen *screen in NSScreen.screens) {
    NSMutableDictionary *workArea = [SparkLogicalBounds(screen.visibleFrame, screen.frame, SparkScreenId(screen)) mutableCopy];
    [workArea removeObjectForKey:@"displayId"];
    [result addObject:@{ @"id": SparkScreenId(screen), @"persistentId": SparkPersistentScreenId(screen) ?: NSNull.null,
      @"name": screen.localizedName, @"primary": @(screen == SparkPrimaryScreen()),
      @"size": @{ @"width": @(NSWidth(screen.frame)), @"height": @(NSHeight(screen.frame)) }, @"workArea": workArea, @"scaleFactor": @(screen.backingScaleFactor) }];
  }
  return result;
}
