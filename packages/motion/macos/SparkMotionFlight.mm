#import "SparkMotionFlight.h"
#import <QuartzCore/QuartzCore.h>

@implementation SparkMotionSnapshot {
  id _image;
}
+ (instancetype)snapshotOf:(NSView *)view largest:(CGSize)largest
{
  const NSRect bounds = view.bounds;
  if (NSIsEmptyRect(bounds)) return nil;
  const CGFloat scale = view.window.backingScaleFactor ?: NSScreen.mainScreen.backingScaleFactor ?: 1;
  const NSInteger width = (NSInteger)ceil(MIN(NSWidth(bounds), MAX(1, largest.width)) * scale), height = (NSInteger)ceil(MIN(NSHeight(bounds), MAX(1, largest.height)) * scale);
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:width pixelsHigh:height bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO
    colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
  if (!rep) return nil;
  rep.size = bounds.size;  // the view's points, drawn into the capped pixels
  // cacheDisplayInRect: draws the view tree, so it also works for windows that are not on screen.
  [view cacheDisplayInRect:view.bounds toBitmapImageRep:rep];
  SparkMotionSnapshot *snapshot = [SparkMotionSnapshot new];
  snapshot->_image = (__bridge id)rep.CGImage;
  return snapshot.image ? snapshot : nil;
}
- (id)image { return _image; }
@end

@implementation SparkMotionFlightWindow {
  CALayer *_from, *_to;
}

- (instancetype)initWithFrom:(SparkMotionSnapshot *)from to:(SparkMotionSnapshot *)to
{
  if ((self = [super initWithContentRect:NSMakeRect(0, 0, 1, 1) styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:YES])) {
    self.releasedWhenClosed = NO;
    self.opaque = NO;
    self.backgroundColor = NSColor.clearColor;
    self.hasShadow = NO;
    self.ignoresMouseEvents = YES;
    self.hidesOnDeactivate = NO;
    self.excludedFromWindowsMenu = YES;
    self.restorable = NO;
    self.animationBehavior = NSWindowAnimationBehaviorNone;
    self.collectionBehavior = NSWindowCollectionBehaviorTransient | NSWindowCollectionBehaviorIgnoresCycle | NSWindowCollectionBehaviorFullScreenAuxiliary;
    NSView *content = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 1, 1)];
    content.wantsLayer = YES;
    self.contentView = content;
    _from = [self layerWith:from];
    _to = [self layerWith:to];
    _to.opacity = 0;
  }
  return self;
}

- (CALayer *)layerWith:(SparkMotionSnapshot *)snapshot
{
  CALayer *layer = [CALayer layer];
  layer.contents = snapshot.image;
  layer.contentsGravity = kCAGravityResize;
  layer.frame = self.contentView.layer.bounds;
  layer.autoresizingMask = kCALayerWidthSizable | kCALayerHeightSizable;
  [self.contentView.layer addSublayer:layer];
  return layer;
}

- (BOOL)canBecomeKeyWindow { return NO; }
- (BOOL)canBecomeMainWindow { return NO; }

- (void)place:(NSRect)frame progress:(double)progress
{
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  [self setFrame:frame display:NO];
  const float shown = (float)fmin(1, fmax(0, progress));
  _from.opacity = 1 - shown;
  _to.opacity = shown;
  [CATransaction commit];
}

- (void)showAbove:(NSArray<NSWindow *> *)windows
{
  NSWindowLevel level = NSNormalWindowLevel;
  for (NSWindow *window in windows) level = MAX(level, window.level);
  self.level = level;
  [self orderFront:nil];
}

@end
