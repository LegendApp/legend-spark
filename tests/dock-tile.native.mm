// Renders the real Dock tile progress view (packages/system/macos/SparkDockTile.mm) offscreen at each
// progress state and checks its pixels. Nothing reaches the Dock: the process has no bundle and a
// prohibited activation policy, so it has no Dock icon and NSApp.dockTile only holds the view. Usage: test <icon.png> [render directory].
#import "SparkDockTile.h"

static int failures = 0;
#define CHECK(...) do { if (!(__VA_ARGS__)) { fprintf(stderr, "FAILED line %d: %s\n", __LINE__, #__VA_ARGS__); failures++; } } while (0)
static const CGFloat Scale = 2;

static NSBitmapImageRep *Canvas(NSSize size) {
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:(NSInteger)(size.width * Scale) pixelsHigh:(NSInteger)(size.height * Scale) bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSCalibratedRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
  rep = [rep bitmapImageRepByRetaggingWithColorSpace:NSColorSpace.sRGBColorSpace];
  rep.size = size;
  return rep;
}
static NSBitmapImageRep *Render(NSView *view) {
  NSBitmapImageRep *rep = Canvas(view.bounds.size);
  [view cacheDisplayInRect:view.bounds toBitmapImageRep:rep];
  return rep;
}
static NSBitmapImageRep *IconOnly(NSSize size) {
  NSBitmapImageRep *rep = Canvas(size);
  [NSGraphicsContext saveGraphicsState];
  NSGraphicsContext.currentContext = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
  [NSApp.applicationIconImage drawInRect:NSMakeRect(0, 0, size.width, size.height) fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:1];
  [NSGraphicsContext restoreGraphicsState];
  return rep;
}
// RGBA bytes at pixel x, y from the top left.
static const unsigned char *Pixel(NSBitmapImageRep *rep, NSInteger x, NSInteger y) { return rep.bitmapData + y * rep.bytesPerRow + x * 4; }
static double Distance(const unsigned char *pixel, NSColor *color) {
  NSColor *rgb = [color colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
  return fmax(fabs(pixel[0] / 255.0 - rgb.redComponent), fmax(fabs(pixel[1] / 255.0 - rgb.greenComponent), fabs(pixel[2] / 255.0 - rgb.blueComponent)));
}
static double Lightness(const unsigned char *pixel) { return (pixel[0] + pixel[1] + pixel[2]) / 765.0; }
// The top half holds the badge corner: it must be the icon exactly, whatever the progress state.
static BOOL TopHalfIsIcon(NSBitmapImageRep *rep, NSBitmapImageRep *icon) {
  for (NSInteger y = 0; y < rep.pixelsHigh / 2; y++) if (memcmp(Pixel(rep, 0, y), Pixel(icon, 0, y), rep.pixelsWide * 4)) return NO;
  return YES;
}
// The track's middle row, in pixels: [first, last) inside its outline.
struct Row { NSInteger y, first, last; };
static Row TrackRow(SparkDockProgressView *view) {
  NSRect track = view.trackRect;
  NSInteger line = (NSInteger)ceil(MAX(1, NSHeight(view.bounds) / 128) * Scale) + 1;
  return { (NSInteger)((NSHeight(view.bounds) - NSMidY(track)) * Scale), (NSInteger)(NSMinX(track) * Scale) + line, (NSInteger)(NSMaxX(track) * Scale) - line };
}
// Pixels of the fill color along the track's middle row, as a fraction of the row, and where they are.
static double FillFraction(NSBitmapImageRep *rep, SparkDockProgressView *view, BOOL *leading, BOOL *trailing) {
  Row row = TrackRow(view); NSColor *fill = view.fillColor; NSInteger count = 0;
  for (NSInteger x = row.first; x < row.last; x++) if (Distance(Pixel(rep, x, row.y), fill) < 0.1) count++;
  if (leading) *leading = Distance(Pixel(rep, row.first + 2, row.y), fill) < 0.1;
  if (trailing) *trailing = Distance(Pixel(rep, row.last - 3, row.y), fill) < 0.1;
  return (double)count / (row.last - row.first);
}
static BOOL Near(double a, double b, double tolerance) { return fabs(a - b) <= tolerance; }

int main(int argc, char **argv) { @autoreleasepool {
  if (argc < 2) { fprintf(stderr, "usage: test <icon.png> [render directory]\n"); return 2; }
  [NSApplication sharedApplication];
  // Never a Dock icon (an unbundled process has none by default; this makes it explicit), so nothing reaches the Dock.
  [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
  NSString *output = argc > 2 ? @(argv[2]) : nil;
  NSImage *icon = [[NSImage alloc] initWithContentsOfFile:@(argv[1])];
  CHECK(icon != nil);
  NSApp.applicationIconImage = icon;
  NSDockTile *tile = NSApp.dockTile;
  tile.badgeLabel = @"3";

  // Cleared progress leaves the tile alone; the first progress installs one view, later updates reuse
  // it, and clearing restores the view AppKit installed for the custom icon.
  NSView *original = tile.contentView;
  CHECK([original isKindOfClass:NSImageView.class]);
  SparkSetDockProgress(tile, nil);
  CHECK(tile.contentView == original);
  SparkSetDockProgress(tile, @{ @"state": @"normal", @"value": @0.35 });
  SparkDockProgressView *view = (SparkDockProgressView *)tile.contentView;
  CHECK([view isKindOfClass:SparkDockProgressView.class]);
  CHECK(NSEqualSizes(view.bounds.size, tile.size) && tile.size.width > 0);
  SparkSetDockProgress(tile, @{ @"state": @"indeterminate" });
  CHECK(tile.contentView == view && [view.state isEqual:@"indeterminate"]);
  CHECK([tile.badgeLabel isEqual:@"3"]); // Progress never touches the badge; the Dock draws it over the view.
  NSRect track = view.trackRect, bounds = view.bounds;
  CHECK(NSMaxY(track) < NSMidY(bounds) && NSMinX(track) > 0 && NSMaxX(track) < NSWidth(bounds)); // Clear of the top-right badge corner.

  NSBitmapImageRep *reference = IconOnly(bounds.size);
  NSArray *states = @[@[@"normal", @0.0], @[@"normal", @0.35], @[@"normal", @1.0], @[@"indeterminate", @0.0], @[@"paused", @0.6], @[@"error", @0.8]];
  NSMutableDictionary<NSString *, NSMutableArray *> *strips = [NSMutableDictionary new];
  NSMutableDictionary<NSString *, NSNumber *> *trackLightness = [NSMutableDictionary new];
  for (NSString *name in @[NSAppearanceNameAqua, NSAppearanceNameDarkAqua]) {
    view.appearance = [NSAppearance appearanceNamed:name];
    view.userInterfaceLayoutDirection = NSUserInterfaceLayoutDirectionLeftToRight;
    NSMutableArray *strip = strips[name] = [NSMutableArray new];
    SparkSetDockProgress(tile, nil);
    [strip addObject:reference]; // Cleared: the plain tile, the icon as the Dock draws it.
    for (NSArray *state in states) {
      SparkSetDockProgress(tile, @{ @"state": state[0], @"value": state[1] });
      view = (SparkDockProgressView *)tile.contentView;
      view.appearance = [NSAppearance appearanceNamed:name];
      NSBitmapImageRep *rep = Render(view);
      [strip addObject:rep];
      CHECK(TopHalfIsIcon(rep, reference));
      double value = [state[1] doubleValue]; BOOL leading = NO, trailing = NO;
      double fraction = FillFraction(rep, view, &leading, &trailing);
      if ([state[0] isEqual:@"indeterminate"]) {
        // Stripes: the fill alternates with lighter bands along the whole bar.
        Row row = TrackRow(view); NSInteger changes = 0; BOOL previous = NO;
        for (NSInteger x = row.first; x < row.last; x++) { BOOL fill = Distance(Pixel(rep, x, row.y), view.fillColor) < 0.1; if (x > row.first && fill != previous) changes++; previous = fill; }
        CHECK(changes >= 4 && fraction > 0.3 && fraction < 0.8);
      } else {
        CHECK(Near(fraction, value, 0.02));
        CHECK(leading == (value > 0.05) && trailing == (value > 0.95));
      }
      if (value == 0 && [state[0] isEqual:@"normal"]) { Row row = TrackRow(view); trackLightness[name] = @(Lightness(Pixel(rep, (row.first + row.last) / 2, row.y))); }
    }
  }
  // An empty track is light on a light Dock and dark on a dark Dock.
  CHECK(trackLightness[NSAppearanceNameAqua].doubleValue > 0.85 && trackLightness[NSAppearanceNameDarkAqua].doubleValue < 0.25);
  // Paused and error take the system yellow and red, not the accent color.
  view.appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
  view.state = @"paused"; NSColor *paused = view.fillColor; view.state = @"error"; NSColor *error = view.fillColor;
  CHECK(paused.redComponent > 0.8 && paused.greenComponent > 0.6 && paused.blueComponent < 0.3);
  CHECK(error.redComponent > 0.8 && error.greenComponent < 0.4 && error.blueComponent < 0.4);

  // Right to left, progress fills from the right edge.
  SparkSetDockProgress(tile, @{ @"state": @"normal", @"value": @0.35 });
  view = (SparkDockProgressView *)tile.contentView;
  view.appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
  view.userInterfaceLayoutDirection = NSUserInterfaceLayoutDirectionRightToLeft;
  NSBitmapImageRep *rtl = Render(view);
  BOOL leading = NO, trailing = NO;
  CHECK(Near(FillFraction(rtl, view, &leading, &trailing), 0.35, 0.02) && !leading && trailing);
  [strips[NSAppearanceNameAqua] addObject:rtl];

  SparkSetDockProgress(tile, nil);
  CHECK(tile.contentView == original && [tile.badgeLabel isEqual:@"3"]);

  if (output) {
    // One strip per appearance, tiles on a Dock-like background: cleared, 0%, 35%, 100%, indeterminate, paused 60%, error 80% (and RTL 35% in light).
    for (NSString *name in strips) {
      NSArray<NSBitmapImageRep *> *tiles = strips[name];
      CGFloat gap = 16; NSSize size = NSMakeSize(gap + tiles.count * (bounds.size.width + gap), bounds.size.height + gap * 2);
      NSBitmapImageRep *strip = Canvas(size);
      [NSGraphicsContext saveGraphicsState];
      NSGraphicsContext.currentContext = [NSGraphicsContext graphicsContextWithBitmapImageRep:strip];
      [[NSColor colorWithWhite:[name isEqual:NSAppearanceNameAqua] ? 0.9 : 0.18 alpha:1] setFill];
      NSRectFill(NSMakeRect(0, 0, size.width, size.height));
      [tiles enumerateObjectsUsingBlock:^(NSBitmapImageRep *rep, NSUInteger index, BOOL *stop) {
        [rep drawInRect:NSMakeRect(gap + index * (bounds.size.width + gap), gap, bounds.size.width, bounds.size.height) fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:1 respectFlipped:NO hints:nil];
      }];
      [NSGraphicsContext restoreGraphicsState];
      NSString *file = [output stringByAppendingPathComponent:[NSString stringWithFormat:@"dock-tile-progress-%@.png", [name isEqual:NSAppearanceNameAqua] ? @"light" : @"dark"]];
      CHECK([[strip representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:file atomically:YES]);
    }
  }
  if (failures) { fprintf(stderr, "%d Dock tile checks failed\n", failures); return 1; }
  puts("Dock tile native tests passed");
  return 0;
} }
