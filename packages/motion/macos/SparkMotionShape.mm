#import "SparkMotionShape.h"
#include <algorithm>
#include <cmath>
#include <utility>
#include <vector>

static BOOL SparkShapeNumber(id value) { return [value isKindOfClass:NSNumber.class] && CFGetTypeID((__bridge CFTypeRef)value) != CFBooleanGetTypeID() && std::isfinite([value doubleValue]); }

@implementation SparkMotionShapeView {
  std::vector<double> _points;  // every path's numbers, path after path, `_stride` each
  std::vector<std::pair<NSUInteger, bool>> _subpaths;  // segments and closed
  NSUInteger _stride, _count;
  double _shown;  // the morph the model path shows; NaN when it must be rebuilt
}

+ (Class)layerClass { return CAShapeLayer.class; }
- (CALayer *)makeBackingLayer { return [CAShapeLayer layer]; }

- (instancetype)initWithFrame:(NSRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    self.wantsLayer = YES;
    self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    _shown = NAN;
  }
  return self;
}

// Paths are in points from the top-left corner, y down, like React Native layout.
- (BOOL)isFlipped { return YES; }
- (NSView *)hitTest:(NSPoint)point { return nil; }
- (CAShapeLayer *)shapeLayer { return (CAShapeLayer *)self.layer; }
- (NSUInteger)pathCount { return _count; }

- (BOOL)setConfig:(NSDictionary *)config error:(NSString **)error
{
  NSArray *paths = config[@"paths"], *subpaths = config[@"subpaths"];
  if (![paths isKindOfClass:NSArray.class] || ![subpaths isKindOfClass:NSArray.class] || paths.count == 0 || paths.count > kSparkMotionShapePathLimit || subpaths.count == 0) {
    *error = [NSString stringWithFormat:@"A shape has 1 to %lu paths of at least one subpath", (unsigned long)kSparkMotionShapePathLimit];
    return NO;
  }
  std::vector<std::pair<NSUInteger, bool>> structure;
  NSUInteger stride = 0, segments = 0;
  for (id subpath in subpaths) {
    if (![subpath isKindOfClass:NSArray.class] || [subpath count] != 2 || !SparkShapeNumber(subpath[0]) || ![subpath[1] isKindOfClass:NSNumber.class]) { *error = @"A subpath is [segments, closed]"; return NO; }
    const double count = [subpath[0] doubleValue];
    if (count < 1 || count != std::floor(count) || (segments += (NSUInteger)count) > kSparkMotionShapeSegmentLimit) {
      *error = [NSString stringWithFormat:@"A shape path has 1 to %lu cubic segments", (unsigned long)kSparkMotionShapeSegmentLimit];
      return NO;
    }
    structure.emplace_back((NSUInteger)count, [subpath[1] boolValue]);
    stride += 2 + 6 * (NSUInteger)count;
  }
  std::vector<double> points;
  points.reserve(stride * paths.count);
  for (id path in paths) {
    if (![path isKindOfClass:NSArray.class] || [path count] != stride) { *error = @"Every shape path has the subpaths' structure"; return NO; }
    for (id value in (NSArray *)path) {
      if (!SparkShapeNumber(value)) { *error = @"Shape path coordinates are finite numbers"; return NO; }
      points.push_back([value doubleValue]);
    }
  }
  NSDictionary *caps = @{ @"butt": kCALineCapButt, @"round": kCALineCapRound, @"square": kCALineCapSquare };
  NSDictionary *joins = @{ @"miter": kCALineJoinMiter, @"round": kCALineJoinRound, @"bevel": kCALineJoinBevel };
  NSDictionary *rules = @{ @"nonzero": kCAFillRuleNonZero, @"evenodd": kCAFillRuleEvenOdd };
  NSString *cap = caps[config[@"lineCap"] ?: @"butt"], *join = joins[config[@"lineJoin"] ?: @"miter"], *rule = rules[config[@"fillRule"] ?: @"nonzero"];
  if (!cap || !join || !rule) { *error = @"lineCap is butt, round or square, lineJoin miter, round or bevel, fillRule nonzero or evenodd"; return NO; }
  _points = std::move(points);
  _subpaths = std::move(structure);
  _stride = stride;
  _count = paths.count;
  _shown = NAN;
  CAShapeLayer *layer = self.shapeLayer;
  layer.lineCap = cap;
  layer.lineJoin = join;
  layer.fillRule = rule;
  return YES;
}

- (CGPathRef)copyPathAt:(double)morph
{
  CGMutablePathRef path = CGPathCreateMutable();
  if (!_count) return path;
  // Path `from` and the next one, `t` of the way: the nearest pair continues beyond the ends.
  const NSUInteger from = _count == 1 ? 0 : (NSUInteger)std::clamp(std::floor(morph), 0.0, double(_count - 2));
  const double t = _count == 1 ? 0 : morph - double(from);
  const double *a = _points.data() + from * _stride, *b = _count == 1 ? a : a + _stride;
  const auto at = [&](NSUInteger index) { return a[index] + t * (b[index] - a[index]); };
  NSUInteger index = 0;
  for (const auto &[segments, closed] : _subpaths) {
    CGPathMoveToPoint(path, NULL, at(index), at(index + 1));
    index += 2;
    for (NSUInteger segment = 0; segment < segments; segment++, index += 6)
      CGPathAddCurveToPoint(path, NULL, at(index), at(index + 1), at(index + 2), at(index + 3), at(index + 4), at(index + 5));
    if (closed) CGPathCloseSubpath(path);
  }
  return path;
}

- (void)showMorph:(double)morph
{
  if (morph == _shown) return;
  _shown = morph;
  CGPathRef path = [self copyPathAt:morph];
  self.shapeLayer.path = path;
  CGPathRelease(path);
}

@end
