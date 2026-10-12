#import "SparkMotionMaterial.h"

#define SPARK_SDK_26 (__MAC_OS_X_VERSION_MAX_ALLOWED >= 260000)

static NSDictionary<NSString *, NSNumber *> *SparkMotionMaterials(void)
{
  static NSDictionary<NSString *, NSNumber *> *materials = @{
    @"titlebar": @(NSVisualEffectMaterialTitlebar), @"selection": @(NSVisualEffectMaterialSelection), @"menu": @(NSVisualEffectMaterialMenu),
    @"popover": @(NSVisualEffectMaterialPopover), @"sidebar": @(NSVisualEffectMaterialSidebar), @"headerView": @(NSVisualEffectMaterialHeaderView),
    @"sheet": @(NSVisualEffectMaterialSheet), @"windowBackground": @(NSVisualEffectMaterialWindowBackground), @"hudWindow": @(NSVisualEffectMaterialHUDWindow),
    @"fullScreenUI": @(NSVisualEffectMaterialFullScreenUI), @"toolTip": @(NSVisualEffectMaterialToolTip), @"contentBackground": @(NSVisualEffectMaterialContentBackground),
    @"underWindowBackground": @(NSVisualEffectMaterialUnderWindowBackground), @"underPageBackground": @(NSVisualEffectMaterialUnderPageBackground),
  };
  return materials;
}
static BOOL SparkMotionGlass(NSString *name) { return [name isEqual:@"glass"] || [name isEqual:@"clearGlass"]; }

BOOL SparkMotionMaterialSupported(NSString *name)
{
  if (!SparkMotionGlass(name)) return SparkMotionMaterials()[name] != nil;
#if SPARK_SDK_26
  if (@available(macOS 26.0, *)) return YES;
#endif
  return NO;
}

/** A plain layer-backed view; the stack's views never take clicks. */
@interface SparkMotionTintView : NSView
@end
@implementation SparkMotionTintView
- (NSView *)hitTest:(NSPoint)point { return nil; }
@end

@implementation SparkMotionMaterialStack {
  SparkMotionTintView *_materials;
  SparkMotionTintView *_tint;
}

- (instancetype)initWithFrame:(NSRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    self.wantsLayer = YES;
    self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    _materials = [[SparkMotionTintView alloc] initWithFrame:self.bounds];
    _tint = [[SparkMotionTintView alloc] initWithFrame:self.bounds];
    for (NSView *view in @[_materials, _tint]) {
      view.wantsLayer = YES;
      view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
      [self addSubview:view];
    }
  }
  return self;
}

- (NSView *)hitTest:(NSPoint)point { return nil; }

+ (NSView *)materialView:(NSDictionary *)config error:(NSString **)error
{
  NSString *name = config[@"material"];
  if (![name isKindOfClass:NSString.class] || (!SparkMotionGlass(name) && !SparkMotionMaterials()[name])) { *error = [NSString stringWithFormat:@"Unknown material %@", name]; return nil; }
  if (!SparkMotionMaterialSupported(name)) { *error = [NSString stringWithFormat:@"The %@ material needs macOS 26 and an app built with the macOS 26 SDK", name]; return nil; }
#if SPARK_SDK_26
  if (SparkMotionGlass(name)) {
    if (@available(macOS 26.0, *)) {
      NSGlassEffectView *glass = [[NSGlassEffectView alloc] initWithFrame:NSZeroRect];
      glass.style = [name isEqual:@"clearGlass"] ? NSGlassEffectViewStyleClear : NSGlassEffectViewStyleRegular;
      glass.wantsLayer = YES;
      return glass;
    }
  }
#endif
  NSDictionary<NSString *, NSNumber *> *blending = @{ @"behindWindow": @(NSVisualEffectBlendingModeBehindWindow), @"withinWindow": @(NSVisualEffectBlendingModeWithinWindow) };
  NSDictionary<NSString *, NSNumber *> *states = @{ @"followsWindowActiveState": @(NSVisualEffectStateFollowsWindowActiveState), @"active": @(NSVisualEffectStateActive), @"inactive": @(NSVisualEffectStateInactive) };
  NSNumber *mode = blending[config[@"blendingMode"] ?: @"behindWindow"], *state = states[config[@"state"] ?: @"followsWindowActiveState"];
  id emphasized = config[@"emphasized"] ?: @NO;
  if (!mode || !state || ![emphasized isKindOfClass:NSNumber.class]) { *error = @"blendingMode is behindWindow or withinWindow, state is followsWindowActiveState, active or inactive, emphasized is a boolean"; return nil; }
  NSVisualEffectView *view = [[NSVisualEffectView alloc] initWithFrame:NSZeroRect];
  view.material = (NSVisualEffectMaterial)SparkMotionMaterials()[name].integerValue;
  view.blendingMode = (NSVisualEffectBlendingMode)mode.integerValue;
  view.state = (NSVisualEffectState)state.integerValue;
  view.emphasized = [emphasized boolValue];
  view.wantsLayer = YES;
  return view;
}

- (NSArray<NSView *> *)materials { return _materials.subviews; }

- (void)push:(NSView *)material replace:(BOOL)replace
{
  if (replace) for (NSView *view in self.materials) [view removeFromSuperview];
  material.frame = _materials.bounds;
  material.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [_materials addSubview:material];
  while (self.materials.count > kSparkMotionMaterialLimit) [self.materials.firstObject removeFromSuperview];
}

- (CALayer *)materialsLayer { return _materials.layer; }
- (CALayer *)incomingLayer { return self.materials.lastObject.layer; }
- (CALayer *)tintLayer { return _tint.layer; }
- (NSUInteger)materialCount { return self.materials.count; }

- (void)setTintColor:(CGColorRef)color { _tint.layer.backgroundColor = color; }

- (void)freezeIncomingAt:(float)opacity
{
  CALayer *layer = self.incomingLayer;
  [layer removeAnimationForKey:@"spark.motion.opacity"];  // the coordinator's crossfade keys (SparkMotionCoordinator.mm)
  [layer removeAnimationForKey:@"spark.motion.opacity.loop"];
  layer.opacity = opacity;
}

- (void)dropCovered
{
  NSArray<NSView *> *materials = self.materials;
  for (NSUInteger index = 0; index + 1 < materials.count; index++) [materials[index] removeFromSuperview];
}

- (void)setCornerRadius:(CGFloat)radius
{
#if SPARK_SDK_26
  if (@available(macOS 26.0, *))
    for (NSView *view in self.materials) if ([view isKindOfClass:NSGlassEffectView.class]) ((NSGlassEffectView *)view).cornerRadius = radius;
#endif
}

@end
