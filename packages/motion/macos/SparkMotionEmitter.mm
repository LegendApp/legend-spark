#import "SparkMotionEmitter.h"
#import <QuartzCore/QuartzCore.h>
#include <cmath>
#include "SparkMotion.hpp"

// docs/motion.md#shader-effects-and-particles. CAEmitterLayer simulates particles in the window server, so the app does
// no work per frame; the engine does not solve particle state.

static NSString *const kBurst = @"spark.particles.burst";
/** The most particles an emitter keeps alive, and kinds of particle it has (docs/motion.md#shader-effects-and-particles; particles.ts checks them too). */
static const double kParticleBudget = 1000;
static const NSUInteger kParticleCells = 8;

static BOOL SparkNumberIn(NSDictionary *object, NSString *key, double *value)
{
  id number = object[key];
  if (number == nil) return YES;
  if (![number isKindOfClass:NSNumber.class] || !std::isfinite([number doubleValue])) return NO;
  *value = [number doubleValue];
  return YES;
}
static BOOL SparkPointIn(NSDictionary *object, NSString *key, NSString *x, NSString *y, NSValue **value)
{
  id point = object[key];
  if (point == nil) return YES;
  double first = NAN, second = NAN;
  if (![point isKindOfClass:NSDictionary.class] || !SparkNumberIn(point, x, &first) || !SparkNumberIn(point, y, &second) || std::isnan(first) || std::isnan(second)) return NO;
  *value = [NSValue valueWithPoint:NSMakePoint(first, second)];
  return YES;
}

/** A white particle image, drawn once (the cell's color tints it): 32 pixels, shown at 16 points. */
static CGImageRef SparkParticleImage(NSString *shape)
{
  static NSMutableDictionary<NSString *, id> *images = [NSMutableDictionary new];
  if (id image = images[shape]) return (__bridge CGImageRef)image;
  NSImage *drawn = [NSImage imageWithSize:NSMakeSize(32, 32) flipped:NO drawingHandler:^BOOL(NSRect rect) {
    [NSColor.whiteColor setFill];
    if ([shape isEqual:@"square"]) { NSRectFill(NSInsetRect(rect, 6, 6)); return YES; }
    if ([shape isEqual:@"circle"]) { [[NSBezierPath bezierPathWithOvalInRect:NSInsetRect(rect, 4, 4)] fill]; return YES; }
    // A five-point star, or a four-point sparkle with thin rays.
    const BOOL star = [shape isEqual:@"star"];
    const int points = star ? 5 : 4;
    const double outer = 15, inner = star ? 6.5 : 3;
    NSBezierPath *path = [NSBezierPath bezierPath];
    for (int i = 0; i < points * 2; i++) {
      const double angle = M_PI / 2 + i * M_PI / points, radius = i % 2 ? inner : outer;
      const NSPoint point = NSMakePoint(16 + radius * std::cos(angle), 16 + radius * std::sin(angle));
      if (i == 0) [path moveToPoint:point]; else [path lineToPoint:point];
    }
    [path closePath];
    [path fill];
    return YES;
  }];
  CGImageRef image = [drawn CGImageForProposedRect:NULL context:nil hints:@{ NSImageHintCTM: [NSAffineTransform transform] }];
  if (image) images[shape] = (__bridge id)image;
  return image;
}

/** An SF Symbol as a white particle image, 16 points high; nil when this macOS has no symbol with that name. */
static CGImageRef SparkSymbolParticle(NSString *name)
{
  static NSMutableDictionary<NSString *, id> *images = [NSMutableDictionary new];
  if (id image = images[name]) return (__bridge CGImageRef)image;
  NSImage *symbol = [[NSImage imageWithSystemSymbolName:name accessibilityDescription:nil] imageWithSymbolConfiguration:
    [[NSImageSymbolConfiguration configurationWithPointSize:16 weight:NSFontWeightRegular] configurationByApplyingConfiguration:[NSImageSymbolConfiguration configurationWithHierarchicalColor:NSColor.whiteColor]]];
  if (!symbol) return nil;
  NSImage *white = [NSImage imageWithSize:symbol.size flipped:NO drawingHandler:^BOOL(NSRect rect) {
    [symbol drawInRect:rect];
    [NSColor.whiteColor set];
    NSRectFillUsingOperation(rect, NSCompositingOperationSourceAtop);
    return YES;
  }];
  NSRect rect = NSMakeRect(0, 0, symbol.size.width * 2, symbol.size.height * 2);
  CGImageRef image = [white CGImageForProposedRect:&rect context:nil hints:nil];
  if (image) images[name] = (__bridge id)image;
  return image;
}

@implementation SparkMotionEmitter {
  CAEmitterLayer *_layer;
  NSString *_shape;
  NSValue *_position, *_size;
  NSArray<NSDictionary *> *_cells;
  double _burstEnd;     // layer time a burst stops emitting at
  double _pausedAt;     // layer time it paused at, while paused
}

+ (SparkMotionEmitter *)emitter:(NSDictionary *)config error:(NSString **)error
{
  SparkMotionEmitter *emitter = [SparkMotionEmitter new];
  emitter->_layer = [CAEmitterLayer layer];
  emitter->_layer.birthRate = 0;
  emitter->_burstEnd = -INFINITY;
  return [emitter update:config error:error] ? emitter : nil;
}

- (CAEmitterLayer *)layer { return _layer; }

- (BOOL)update:(NSDictionary *)config error:(NSString **)error
{
  NSDictionary<NSString *, NSString *> *shapes = @{ @"point": kCAEmitterLayerPoint, @"line": kCAEmitterLayerLine, @"rectangle": kCAEmitterLayerRectangle, @"circle": kCAEmitterLayerCircle };
  NSString *shape = config[@"shape"] ?: @"point", *blend = config[@"blend"] ?: @"normal";
  NSValue *position = nil, *size = nil;
  double seed = 1;
  NSArray *cells = config[@"cells"];
  if (![config isKindOfClass:NSDictionary.class] || ![shape isKindOfClass:NSString.class] || !shapes[shape] || !([blend isEqual:@"normal"] || [blend isEqual:@"additive"]) ||
      !SparkPointIn(config, @"position", @"x", @"y", &position) || !SparkPointIn(config, @"size", @"width", @"height", &size) || !SparkNumberIn(config, @"seed", &seed) ||
      ![cells isKindOfClass:NSArray.class] || !cells.count || cells.count > kParticleCells) {
    *error = @"An emitter has a shape (point, line, rectangle, circle), an optional position { x, y }, size { width, height }, blend (normal, additive) and seed, and one to eight cells";
    return NO;
  }
  double alive = 0;
  for (NSDictionary *cell in cells) {
    double birthRate = NAN, lifetime = NAN, range = 0;
    if (![cell isKindOfClass:NSDictionary.class] || !SparkNumberIn(cell, @"birthRate", &birthRate) || !SparkNumberIn(cell, @"lifetimeMs", &lifetime) || !SparkNumberIn(cell, @"lifetimeRangeMs", &range)
        || !(birthRate >= 0 && birthRate <= 500) || !(lifetime >= 1 && lifetime <= 10000) || !(range >= 0 && range <= 10000)) {
      *error = @"A particle has a birthRate from 0 to 500, a lifetimeMs from 1 to 10000 and a lifetimeRangeMs from 0 to 10000";
      return NO;
    }
    alive += birthRate * (lifetime + range) / 1000;
    id image = [cell isKindOfClass:NSDictionary.class] ? cell[@"image"] ?: @"circle" : nil;
    const BOOL named = [image isKindOfClass:NSString.class] && [@[@"circle", @"square", @"star", @"spark"] containsObject:image];
    const BOOL symbol = [image isKindOfClass:NSDictionary.class] && [image[@"symbol"] isKindOfClass:NSString.class] && SparkSymbolParticle(image[@"symbol"]);
    NSArray *color = cell[@"color"];
    if (!named && !symbol) { *error = [NSString stringWithFormat:@"A particle's image is circle, square, star, spark or { symbol } of an SF Symbol this macOS has, not %@", image]; return NO; }
    if (color && !([color isKindOfClass:NSArray.class] && color.count == 4)) { *error = @"A particle's color is its OKLCH components"; return NO; }
  }
  if (alive > kParticleBudget) { *error = [NSString stringWithFormat:@"The emitter would keep about %.0f particles alive; at most %.0f", alive, kParticleBudget]; return NO; }
  _layer.emitterShape = shapes[shape];
  _layer.emitterMode = [shape isEqual:@"line"] ? kCAEmitterLayerOutline : kCAEmitterLayerSurface;
  _layer.renderMode = [blend isEqual:@"additive"] ? kCAEmitterLayerAdditive : kCAEmitterLayerUnordered;
  _layer.seed = (unsigned int)seed;
  _shape = shape;
  _position = position;
  _size = size;
  _cells = cells;
  _layer.emitterCells = nil;  // rebuilt by layout:, which knows the view's orientation
  return YES;
}

/** Whether the host's layer coordinates run down the screen (a flipped geometry); emission angles, spin and gravity follow. */
static BOOL SparkLayerYDown(NSView *host)
{
  const NSPoint top = NSMakePoint(0, host.isFlipped ? 0 : NSHeight(host.bounds)), below = NSMakePoint(0, host.isFlipped ? 1 : NSHeight(host.bounds) - 1);
  return [host convertPointToLayer:below].y > [host convertPointToLayer:top].y;
}

- (NSArray<CAEmitterCell *> *)cellsFor:(NSView *)host
{
  static CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceExtendedSRGB);
  const double down = SparkLayerYDown(host) ? 1 : -1;
  NSMutableArray<CAEmitterCell *> *made = [NSMutableArray new];
  for (NSDictionary *config in _cells) {
    auto number = [&](NSString *key, double fallback) { id value = config[key]; return [value isKindOfClass:NSNumber.class] ? [value doubleValue] : fallback; };
    CAEmitterCell *cell = [CAEmitterCell emitterCell];
    id image = config[@"image"] ?: @"circle";
    cell.contents = (__bridge id)([image isKindOfClass:NSString.class] ? SparkParticleImage(image) : SparkSymbolParticle(image[@"symbol"]));
    cell.contentsScale = 2;
    cell.birthRate = number(@"birthRate", 0);
    cell.lifetime = number(@"lifetimeMs", 1000) / 1000;
    cell.lifetimeRange = number(@"lifetimeRangeMs", 0) / 1000;
    cell.velocity = number(@"velocity", 0);
    cell.velocityRange = number(@"velocityRange", 0);
    // Angles are degrees on screen: 0 points right and 90 down; spin is clockwise.
    cell.emissionLongitude = down * number(@"emissionAngle", 0) * M_PI / 180;
    cell.emissionRange = number(@"emissionRange", 360) * M_PI / 360;  // Core Animation's range is a half-angle either side
    cell.spin = down * number(@"spin", 0) * M_PI / 180;
    cell.spinRange = number(@"spinRange", 0) * M_PI / 180;
    cell.scale = number(@"scale", 1);
    cell.scaleRange = number(@"scaleRange", 0);
    cell.scaleSpeed = number(@"scaleSpeed", 0);
    cell.alphaSpeed = number(@"alphaSpeed", 0);
    NSDictionary *acceleration = config[@"acceleration"];
    if ([acceleration isKindOfClass:NSDictionary.class]) {
      cell.xAcceleration = [acceleration[@"x"] doubleValue];
      cell.yAcceleration = down * [acceleration[@"y"] doubleValue];
    }
    NSArray *color = config[@"color"];
    if (color) {
      const spark::motion::Rgba rgba = spark::motion::oklchToSrgb([color[0] doubleValue], [color[1] doubleValue], [color[2] doubleValue], [color[3] doubleValue]);
      const CGFloat components[] = {rgba.red, rgba.green, rgba.blue, rgba.alpha};
      CGColorRef tint = CGColorCreate(space, components);
      cell.color = tint;
      CGColorRelease(tint);
    }
    [made addObject:cell];
  }
  return made;
}

- (void)layout:(NSView *)host
{
  CALayer *layer = host.layer;
  if (_layer.superlayer != layer) {
    _layer.zPosition = 999;  // over the view's content, under a specular sweep
    [layer addSublayer:_layer];
  }
  _layer.frame = layer.bounds;
  const NSRect bounds = host.bounds;
  const NSPoint at = _position ? _position.pointValue : NSMakePoint(NSWidth(bounds) / 2, NSHeight(bounds) / 2);
  _layer.emitterPosition = [host convertPointToLayer:NSMakePoint(NSMinX(bounds) + at.x, host.isFlipped ? NSMinY(bounds) + at.y : NSMaxY(bounds) - at.y)];
  _layer.emitterSize = _size ? NSSizeToCGSize(_size.sizeValue) : bounds.size;
  if (!_layer.emitterCells) _layer.emitterCells = [self cellsFor:host];
}

- (double)now { return [_layer convertTime:CACurrentMediaTime() fromLayer:nil]; }

- (void)start:(double)duration host:(NSView *)host
{
  [self layout:host];
  [_layer removeAnimationForKey:kBurst];
  if (duration > 0) {
    // The model stops emitting; an animation holds the birth rate at 1 for the burst, on the layer's clock.
    _layer.birthRate = 0;
    CABasicAnimation *burst = [CABasicAnimation animationWithKeyPath:@"birthRate"];
    burst.fromValue = burst.toValue = @1;
    burst.duration = duration;
    burst.beginTime = [self now];
    burst.removedOnCompletion = YES;
    [_layer addAnimation:burst forKey:kBurst];
    _burstEnd = burst.beginTime + duration;
  } else {
    _layer.birthRate = 1;
    _burstEnd = -INFINITY;
  }
}

- (void)stop
{
  [_layer removeAnimationForKey:kBurst];
  _layer.birthRate = 0;
  _burstEnd = -INFINITY;
}

- (BOOL)emitting:(NSView *)host { return _layer.birthRate > 0 || [self now] < _burstEnd; }

- (BOOL)paused { return _layer.speed == 0; }
- (void)setPaused:(BOOL)paused
{
  if (paused == self.paused) return;
  if (paused) {
    _pausedAt = [self now];
    _layer.speed = 0;
    _layer.timeOffset = _pausedAt;
  } else {
    _layer.speed = 1;
    _layer.timeOffset = 0;
    _layer.beginTime = 0;
    _layer.beginTime = [self now] - _pausedAt;  // resumes from the instant it paused at
  }
}

@end
