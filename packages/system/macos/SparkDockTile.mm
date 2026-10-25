#import "SparkDockTile.h"

// The Dock follows the system appearance, not an app's NSApp.appearance override.
static NSAppearance *SystemAppearance(void) {
  BOOL dark = [[NSUserDefaults.standardUserDefaults stringForKey:@"AppleInterfaceStyle"] isEqualToString:@"Dark"];
  return [NSAppearance appearanceNamed:dark ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
}
static NSColor *Dynamic(NSColor *light, NSColor *dark) {
  return [NSColor colorWithName:nil dynamicProvider:^NSColor *(NSAppearance *appearance) {
    return [[appearance bestMatchFromAppearancesWithNames:@[NSAppearanceNameAqua, NSAppearanceNameDarkAqua]] isEqualToString:NSAppearanceNameDarkAqua] ? dark : light;
  }];
}

@interface SparkDockProgressView ()
/// The tile's view before progress (AppKit installs an image view for a custom applicationIconImage).
@property (nonatomic, readonly, nullable) NSView *previous;
@end

@implementation SparkDockProgressView {
  __weak NSDockTile *_tile;
  NSArray<NSArray *> *_observers;
}
- (instancetype)initWithTile:(NSDockTile *)tile {
  if (!(self = [super initWithFrame:NSMakeRect(0, 0, tile.size.width, tile.size.height)])) return nil;
  _tile = tile; _previous = tile.contentView; _state = @"normal";
  self.appearance = SystemAppearance();
  __weak SparkDockProgressView *weak = self;
  void (^refresh)(NSNotification *) = ^(NSNotification *note) {
    SparkDockProgressView *view = weak;
    if (!view) return;
    view.appearance = SystemAppearance();
    [view->_tile display];
  };
  _observers = @[
    @[NSDistributedNotificationCenter.defaultCenter, [NSDistributedNotificationCenter.defaultCenter addObserverForName:@"AppleInterfaceThemeChangedNotification" object:nil queue:NSOperationQueue.mainQueue usingBlock:refresh]],
    @[NSNotificationCenter.defaultCenter, [NSNotificationCenter.defaultCenter addObserverForName:NSSystemColorsDidChangeNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:refresh]],
  ];
  return self;
}
- (void)dealloc { for (NSArray *entry in _observers) [entry[0] removeObserver:entry[1]]; }
- (NSRect)trackRect {
  NSSize size = self.bounds.size;
  // Inside the icon's body (macOS icons leave about 10% transparent margin), below its center.
  return NSMakeRect(round(size.width * 0.17), round(size.height * 0.15), round(size.width * 0.66), round(size.height * 0.1));
}
- (NSColor *)fillColor {
  __block NSColor *color;
  [self.effectiveAppearance performAsCurrentDrawingAppearance:^{
    NSColor *named = [self.state isEqualToString:@"paused"] ? NSColor.systemYellowColor : [self.state isEqualToString:@"error"] ? NSColor.systemRedColor : NSColor.controlAccentColor;
    color = [named colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
  }];
  return color;
}
- (void)drawRect:(NSRect)dirty {
  [NSApp.applicationIconImage drawInRect:self.bounds fromRect:NSZeroRect operation:NSCompositingOperationSourceOver fraction:1];
  NSRect track = self.trackRect;
  CGFloat radius = NSHeight(track) / 2, line = MAX(1, NSHeight(self.bounds) / 128);
  NSBezierPath *capsule = [NSBezierPath bezierPathWithRoundedRect:track xRadius:radius yRadius:radius];
  [Dynamic([NSColor colorWithWhite:1 alpha:0.94], [NSColor colorWithWhite:0.12 alpha:0.9]) setFill];
  [capsule fill];
  [NSGraphicsContext saveGraphicsState];
  [capsule addClip];
  [self.fillColor setFill];
  if ([self.state isEqualToString:@"indeterminate"]) {
    NSRectFill(track);
    // Static diagonal stripes: the Dock redraws a tile only when asked, so it is not animated.
    [[NSColor colorWithWhite:1 alpha:0.45] setFill];
    CGFloat height = NSHeight(track);
    for (CGFloat x = NSMinX(track) - height; x < NSMaxX(track); x += height * 2) {
      NSBezierPath *stripe = [NSBezierPath new];
      [stripe moveToPoint:NSMakePoint(x, NSMinY(track))]; [stripe lineToPoint:NSMakePoint(x + height, NSMinY(track))];
      [stripe lineToPoint:NSMakePoint(x + height * 2, NSMaxY(track))]; [stripe lineToPoint:NSMakePoint(x + height, NSMaxY(track))];
      [stripe closePath]; [stripe fill];
    }
  } else {
    CGFloat width = round(NSWidth(track) * MIN(MAX(self.value, 0), 1));
    BOOL rtl = self.userInterfaceLayoutDirection == NSUserInterfaceLayoutDirectionRightToLeft;
    NSRectFill(NSMakeRect(rtl ? NSMaxX(track) - width : NSMinX(track), NSMinY(track), width, NSHeight(track)));
  }
  [NSGraphicsContext restoreGraphicsState];
  [Dynamic([NSColor colorWithWhite:0 alpha:0.25], [NSColor colorWithWhite:1 alpha:0.3]) setStroke];
  NSBezierPath *outline = [NSBezierPath bezierPathWithRoundedRect:NSInsetRect(track, line / 2, line / 2) xRadius:radius - line / 2 yRadius:radius - line / 2];
  outline.lineWidth = line;
  [outline stroke];
}
@end

void SparkSetDockProgress(NSDockTile *tile, NSDictionary *progress) {
  SparkDockProgressView *view = [tile.contentView isKindOfClass:SparkDockProgressView.class] ? (SparkDockProgressView *)tile.contentView : nil;
  if (!progress) { if (view) { tile.contentView = view.previous; [tile display]; } return; }
  if (!view) { view = [[SparkDockProgressView alloc] initWithTile:tile]; tile.contentView = view; }
  view.state = progress[@"state"];
  view.value = [progress[@"value"] doubleValue];
  [tile display];
}

void SparkSetDockBadge(NSDockTile *tile, NSDictionary *badge) {
  NSNumber *count = badge[@"count"];
  NSString *label = count ? (count.integerValue ? [NSNumberFormatter localizedStringFromNumber:count numberStyle:NSNumberFormatterDecimalStyle] : nil) : badge[@"label"];
  tile.badgeLabel = label.length ? label : nil;
}
