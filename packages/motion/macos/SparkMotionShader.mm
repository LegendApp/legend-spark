#import "SparkMotionShader.h"
#import <CoreImage/CoreImage.h>
#import <Metal/Metal.h>
#import <QuartzCore/QuartzCore.h>
#include <algorithm>
#include <atomic>
#include <mutex>
#include <cmath>
#include "SparkMotionShaders.metallib.h"
using namespace spark::motion;

// docs/motion.md#shader-effects-and-particles. Ripple and distortion are Core Image layer filters and the specular
// sweep a gradient layer: Core Animation plays their baked keyframes in the window server, with no work in the app per
// frame. A noise threshold is a per-pixel comparison that no layer property animates, so the dissolve is a Metal mask
// rendered on display frames while it animates.

/** Filter names in key paths (`filters.sparkRipple.inputRadius`). */
static NSString *const kRippleFilter = @"sparkRipple", *const kDistortionFilter = @"sparkDistortion";

#pragma mark - Metal

/** The process's Metal objects for dissolve, built once from the precompiled library and rebuilt after a device loss. */
@interface SparkMotionMetal : NSObject
@property (nonatomic, strong) id<MTLDevice> device;
@property (nonatomic, strong) id<MTLCommandQueue> queue;
@property (nonatomic, strong) id<MTLRenderPipelineState> dissolve;
@end
@implementation SparkMotionMetal @end

// Built on the main thread or on the JavaScript thread (availability checks build them too), under gMetalLock.
static std::mutex gMetalLock;
static SparkMotionMetal *gMetal;
static BOOL gMetalUnavailable;  // no device, or the library or pipeline failed: until a device is added, removed or lost
static id<NSObject> gDeviceObserver;
/** Frames committed and not yet completed: display frames are skipped rather than waiting for a drawable. */
static std::atomic<int> gFramesInFlight{0};

/** Uniforms of SparkMotionShaders.metal's dissolve functions; the layout matches SparkDissolveUniforms. */
struct SparkDissolveUniforms { float width, height, threshold, softness, cell, padding; };

/** Forgets the Metal objects (or that there were none): the next use builds them again on the default device. */
static void SparkMotionMetalReset(id<MTLDevice> _Nullable removed)
{
  std::lock_guard<std::mutex> lock(gMetalLock);
  if (!removed || gMetal.device == removed) gMetal = nil;
  gMetalUnavailable = NO;
}

static SparkMotionMetal *SparkMotionMetalShared(void)
{
  // A device added (an external GPU plugged in) or removed changes what is available: the next use builds again.
  static dispatch_once_t observing;
  dispatch_once(&observing, ^{
    id<NSObject> observer = nil;
    MTLCopyAllDevicesWithObserver(&observer, ^(id<MTLDevice> device, MTLDeviceNotificationName name) {
      SparkMotionMetalReset([name isEqual:MTLDeviceWasAddedNotification] ? nil : device);
    });
    gDeviceObserver = observer;
  });
  std::lock_guard<std::mutex> lock(gMetalLock);
  if (gMetal || gMetalUnavailable) return gMetal;
  id<MTLDevice> device = MTLCreateSystemDefaultDevice();
  NSError *error = nil;
  // The bytes are static: a destructor that does nothing keeps dispatch from copying them (the default destructor copies).
  dispatch_data_t data = dispatch_data_create(kSparkMotionShaderLibrary, sizeof(kSparkMotionShaderLibrary), nil, ^{});
  id<MTLLibrary> library = device ? [device newLibraryWithData:data error:&error] : nil;
  MTLRenderPipelineDescriptor *descriptor = [MTLRenderPipelineDescriptor new];
  descriptor.vertexFunction = [library newFunctionWithName:@"sparkDissolveVertex"];
  descriptor.fragmentFunction = [library newFunctionWithName:@"sparkDissolveFragment"];
  descriptor.colorAttachments[0].pixelFormat = MTLPixelFormatBGRA8Unorm;
  id<MTLRenderPipelineState> pipeline = descriptor.vertexFunction && descriptor.fragmentFunction ? [device newRenderPipelineStateWithDescriptor:descriptor error:&error] : nil;
  if (!pipeline) {
    gMetalUnavailable = YES;
    NSLog(@"Spark motion: dissolve is unavailable: %@", device ? error.localizedDescription ?: @"the built-in shader library has no dissolve functions" : @"no Metal device");
    return nil;
  }
  gMetal = [SparkMotionMetal new];
  gMetal.device = device;
  gMetal.queue = [device newCommandQueue];
  gMetal.dissolve = pipeline;
  return gMetal;
}

void SparkMotionShaderDeviceLost(void) { SparkMotionMetalReset(nil); }

// Any thread (MotionShader checks it while rendering, on the JavaScript thread). For dissolve it builds the library and
// pipeline it would render with, so `available` means a frame can be rendered.
BOOL SparkMotionShaderSupported(NSString *type)
{
  if ([type isEqual:@"dissolve"]) return SparkMotionMetalShared() != nil;
  return [@[@"ripple", @"distortion", @"specular"] containsObject:type];
}

/** A failed command buffer (a GPU reset or a lost device) drops the Metal objects. Captures nothing: no allocation per frame. */
static void (^const SparkMotionFrameCompleted)(id<MTLCommandBuffer>) = ^(id<MTLCommandBuffer> buffer) {
  gFramesInFlight--;
  if (buffer.status != MTLCommandBufferStatusError) return;
  NSLog(@"Spark motion: a dissolve frame failed (%@); rebuilding its Metal objects", buffer.error.localizedDescription);
  SparkMotionMetalReset(buffer.device);
};

#pragma mark - Effects

static double SparkConfigNumber(NSDictionary *config, NSString *key, double fallback, NSString **error)
{
  id value = config[key];
  if (value == nil || value == NSNull.null) return fallback;
  if (![value isKindOfClass:NSNumber.class] || !std::isfinite([value doubleValue])) { *error = [NSString stringWithFormat:@"%@ must be a finite number", key]; return fallback; }
  return [value doubleValue];
}
/** An optional `{ x, y }` in points from the view's top-left corner. */
static NSValue *SparkConfigPoint(NSDictionary *config, NSString *key, NSString **error)
{
  id value = config[key];
  if (value == nil || value == NSNull.null) return nil;
  if (![value isKindOfClass:NSDictionary.class]) { *error = [NSString stringWithFormat:@"%@ is { x, y }", key]; return nil; }
  NSString *inner = nil;
  const double x = SparkConfigNumber(value, @"x", NAN, &inner), y = SparkConfigNumber(value, @"y", NAN, &inner);
  if (inner || !std::isfinite(x) || !std::isfinite(y)) { *error = [NSString stringWithFormat:@"%@ is { x, y } in points", key]; return nil; }
  return [NSValue valueWithPoint:NSMakePoint(x, y)];
}

/** A point from the view's top-left corner (or its centre) in the view's layer coordinates, where Core Image filter inputs are. */
static CGPoint SparkLayerPoint(NSView *host, NSValue *point)
{
  const NSRect bounds = host.bounds;
  if (!point) return [host convertPointToLayer:NSMakePoint(NSMidX(bounds), NSMidY(bounds))];
  const NSPoint top = point.pointValue;
  return [host convertPointToLayer:NSMakePoint(NSMinX(bounds) + top.x, host.isFlipped ? NSMinY(bounds) + top.y : NSMaxY(bounds) - top.y)];
}

/** Adds (`filter`) or removes the named filter, keeping the layer's other filters (the blur). */
static void SparkSetFilter(NSView *host, NSString *name, CIFilter *filter)
{
  NSMutableArray *filters = [NSMutableArray new];
  for (CIFilter *existing in host.layer.filters) if (![existing.name isEqual:name]) [filters addObject:existing];
  if (filter) {
    host.layerUsesCoreImageFilters = YES;  // AppKit ignores layer filters otherwise
    filter.name = name;
    [filters addObject:filter];
  }
  host.layer.filters = filters.count ? filters : nil;
  if (!filters.count) host.layerUsesCoreImageFilters = NO;
}

@implementation SparkMotionShader {
  NSString *_type;
  Property _property;
  NSValue *_point;          // ripple origin, distortion centre
  double _width, _strength;  // ripple ring width and refraction; distortion radius (0: half the shorter side)
  double _angle, _band, _intensity;
  CGColorRef _color;         // specular
  double _cell, _softness;   // dissolve
  CAGradientLayer *_overlay;
  CAMetalLayer *_metal;
  CALayer *_hidden;          // dissolve at rest at 1: an empty mask hides everything without Metal
  MTLRenderPassDescriptor *_pass;
  double _renderedValue;
  NSUInteger _renderedFrames;
}

+ (SparkMotionShader *)shader:(NSDictionary *)config error:(NSString **)error
{
  NSDictionary<NSString *, NSNumber *> *properties = @{ @"ripple": @(RippleProgress), @"dissolve": @(DissolveProgress), @"distortion": @(Distortion), @"specular": @(SpecularProgress) };
  NSString *type = [config isKindOfClass:NSDictionary.class] ? config[@"type"] : nil;
  if (![type isKindOfClass:NSString.class] || !properties[type]) { *error = [NSString stringWithFormat:@"Unknown shader effect %@", type]; return nil; }
  if (!SparkMotionShaderSupported(type)) { *error = @"The dissolve effect needs a Metal device"; return nil; }
  SparkMotionShader *shader = [SparkMotionShader new];
  shader->_type = type;
  shader->_property = Property(properties[type].intValue);
  shader->_renderedValue = NAN;
  NSString *invalid = nil;
  if ([type isEqual:@"ripple"]) {
    shader->_point = SparkConfigPoint(config, @"origin", &invalid);
    shader->_width = SparkConfigNumber(config, @"width", 24, &invalid);
    shader->_strength = SparkConfigNumber(config, @"refraction", 1.7, &invalid);
  } else if ([type isEqual:@"distortion"]) {
    shader->_point = SparkConfigPoint(config, @"center", &invalid);
    shader->_width = SparkConfigNumber(config, @"radius", 0, &invalid);
  } else if ([type isEqual:@"specular"]) {
    shader->_angle = SparkConfigNumber(config, @"angle", 20, &invalid);
    shader->_band = SparkConfigNumber(config, @"width", 0.25, &invalid);
    shader->_intensity = SparkConfigNumber(config, @"intensity", 0.6, &invalid);
    NSArray *color = config[@"color"];
    static CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceExtendedSRGB);
    if ([color isKindOfClass:NSArray.class] && color.count == 4) {
      const Rgba rgba = oklchToSrgb([color[0] doubleValue], [color[1] doubleValue], [color[2] doubleValue], [color[3] doubleValue]);
      const CGFloat components[] = {rgba.red, rgba.green, rgba.blue, rgba.alpha};
      shader->_color = CGColorCreate(space, components);
    } else {
      const CGFloat white[] = {1, 1, 1, 1};
      shader->_color = CGColorCreate(space, white);
    }
  } else {
    shader->_cell = SparkConfigNumber(config, @"cellSize", 12, &invalid);
    shader->_softness = SparkConfigNumber(config, @"softness", 0.1, &invalid);
  }
  if (invalid) { *error = invalid; return nil; }
  return shader;
}

- (void)dealloc { if (_color) CGColorRelease(_color); }

- (NSString *)type { return _type; }
- (Property)property { return _property; }
- (BOOL)rendersFrames { return _property == DissolveProgress; }
- (double)renderedValue { return _renderedValue; }
- (NSUInteger)renderedFrames { return _renderedFrames; }

- (NSArray<NSString *> *)keyPaths
{
  switch (_property) {
    case RippleProgress: return @[@"filters.sparkRipple.inputRadius", @"filters.sparkRipple.inputRefraction"];
    case Distortion: return @[@"filters.sparkDistortion.inputScale"];
    case SpecularProgress: return @[@"locations"];
    default: return @[];
  }
}

- (BOOL)showsAtRest:(double)value { return _property == Distortion ? value != 0 : value > 0 && value < 1; }

- (BOOL)filtered:(NSView *)host
{
  NSString *name = _property == RippleProgress ? kRippleFilter : kDistortionFilter;
  for (CIFilter *filter in host.layer.filters) if ([filter.name isEqual:name]) return YES;
  return NO;
}

- (BOOL)installedOn:(NSView *)host
{
  switch (_property) {
    case RippleProgress: case Distortion: return [self filtered:host];
    case SpecularProgress: return _overlay.superlayer == host.layer;
    default: return _metal != nil;
  }
}

- (CALayer *)target:(NSUInteger)index host:(NSView *)host
{
  if (![self installedOn:host]) return nil;
  return _property == SpecularProgress ? _overlay : host.layer;
}

/** How far a ripple's ring travels: from its origin past the farthest corner. */
- (double)reach:(NSView *)host
{
  const CGPoint origin = SparkLayerPoint(host, _point);
  const CGRect bounds = host.layer.bounds;
  double reach = 0;
  for (CGPoint corner : {CGPointMake(CGRectGetMinX(bounds), CGRectGetMinY(bounds)), CGPointMake(CGRectGetMaxX(bounds), CGRectGetMinY(bounds)),
                         CGPointMake(CGRectGetMinX(bounds), CGRectGetMaxY(bounds)), CGPointMake(CGRectGetMaxX(bounds), CGRectGetMaxY(bounds))})
    reach = std::max(reach, std::hypot(corner.x - origin.x, corner.y - origin.y));
  return reach + _width;
}

- (id)sample:(NSUInteger)index value:(double)value host:(NSView *)host
{
  const double progress = std::clamp(value, 0.0, 1.0);
  switch (_property) {
    case RippleProgress:
      // The ring grows from the origin; its refraction index rises over the first eighth and falls back to 1 (none) as it spreads.
      if (index == 0) return @(progress * [self reach:host]);
      return @(1 + (_strength - 1) * (1 - progress) * std::min(1.0, progress * 8));
    case Distortion: return @(std::clamp(value, -1.0, 1.0));
    case SpecularProgress: {
      // The band's centre travels from one band width before the leading edge to one past the trailing edge.
      const double centre = -_band + progress * (1 + 2 * _band);
      return @[@(centre - _band), @(centre), @(centre + _band)];
    }
    default: return @(value);
  }
}

- (CIFilter *)makeFilter:(NSView *)host
{
  CIFilter *filter = [CIFilter filterWithName:_property == RippleProgress ? @"CITorusLensDistortion" : @"CIBumpDistortion"];
  [filter setDefaults];
  [filter setValuesForKeysWithDictionary:[self inputs:host]];
  return filter;
}

/** The filter's static inputs, which follow the view's size. */
- (NSDictionary<NSString *, id> *)inputs:(NSView *)host
{
  const CGPoint centre = SparkLayerPoint(host, _point);
  CIVector *vector = [CIVector vectorWithX:centre.x Y:centre.y];
  if (_property == RippleProgress) return @{ kCIInputCenterKey: vector, kCIInputWidthKey: @(_width) };
  return @{ kCIInputCenterKey: vector, kCIInputRadiusKey: @(_width > 0 ? _width : std::min(NSWidth(host.bounds), NSHeight(host.bounds)) / 2) };
}

- (void)install:(BOOL)active host:(NSView *)host
{
  if (active == [self installedOn:host]) return;
  switch (_property) {
    case RippleProgress:
      SparkSetFilter(host, kRippleFilter, active ? [self makeFilter:host] : nil);
      break;
    case Distortion:
      SparkSetFilter(host, kDistortionFilter, active ? [self makeFilter:host] : nil);
      break;
    case SpecularProgress:
      if (active) {
        _overlay = [CAGradientLayer layer];
        _overlay.zPosition = 1000;  // above the content's layers, whatever order AppKit keeps them in
        _overlay.masksToBounds = YES;
        CGColorRef clear = CGColorCreateCopyWithAlpha(_color, 0), lit = CGColorCreateCopyWithAlpha(_color, CGColorGetAlpha(_color) * std::clamp(_intensity, 0.0, 1.0));
        _overlay.colors = @[(__bridge id)clear, (__bridge id)lit, (__bridge id)clear];
        CGColorRelease(clear);
        CGColorRelease(lit);
        [host.layer addSublayer:_overlay];
      } else {
        [_overlay removeFromSuperlayer];
        _overlay = nil;
      }
      break;
    default:
      if (active) {
        _metal = [CAMetalLayer layer];
        _metal.pixelFormat = MTLPixelFormatBGRA8Unorm;
        _metal.opaque = NO;
        _metal.framebufferOnly = YES;
        _metal.maximumDrawableCount = 3;
        _metal.presentsWithTransaction = YES;  // a frame shows with the transaction that moves the view, so the mask never lags it
        _metal.contentsScale = 1;              // the noise is points across: a point-resolution mask, scaled up smoothly
        _metal.magnificationFilter = kCAFilterLinear;
        _pass = [MTLRenderPassDescriptor renderPassDescriptor];
        _pass.colorAttachments[0].loadAction = MTLLoadActionDontCare;  // the triangle covers every pixel
        _pass.colorAttachments[0].storeAction = MTLStoreActionStore;
      } else {
        if (host.layer.mask == _metal) host.layer.mask = nil;
        _metal = nil;
        _pass = nil;
      }
      break;
  }
}

- (void)apply:(double)value host:(NSView *)host
{
  CALayer *layer = host.layer;
  switch (_property) {
    case RippleProgress: case Distortion:
      if ([self filtered:host]) {
        // A layer's filters are set through its key paths: Core Animation does not see changes to the filter objects.
        NSString *prefix = [NSString stringWithFormat:@"filters.%@.", _property == RippleProgress ? kRippleFilter : kDistortionFilter];
        [[self inputs:host] enumerateKeysAndObjectsUsingBlock:^(NSString *key, id value, BOOL *) { [layer setValue:value forKeyPath:[prefix stringByAppendingString:key]]; }];
        NSArray<NSString *> *keyPaths = self.keyPaths;
        for (NSUInteger index = 0; index < keyPaths.count; index++) [layer setValue:[self sample:index value:value host:host] forKeyPath:keyPaths[index]];
      }
      break;
    case SpecularProgress:
      if (_overlay) {
        _overlay.frame = layer.bounds;
        _overlay.cornerRadius = layer.cornerRadius;
        // The sweep's direction: 0° runs from the left edge to the right one, 90° from the top down.
        const double radians = _angle * M_PI / 180, dx = std::cos(radians), dy = std::sin(radians), half = (std::abs(dx) + std::abs(dy)) / 2;
        const NSRect bounds = host.bounds;
        auto unit = [&](double x, double y) {
          const CGPoint point = SparkLayerPoint(host, [NSValue valueWithPoint:NSMakePoint((0.5 + x) * NSWidth(bounds), (0.5 + y) * NSHeight(bounds))]);
          return CGPointMake(point.x / MAX(1, CGRectGetWidth(layer.bounds)), point.y / MAX(1, CGRectGetHeight(layer.bounds)));
        };
        _overlay.startPoint = unit(-dx * half, -dy * half);
        _overlay.endPoint = unit(dx * half, dy * half);
        _overlay.locations = [self sample:0 value:value host:host];
      }
      break;
    default:
      if (_metal) {
        _metal.frame = layer.bounds;
        const CGSize size = CGSizeMake(MAX(1, std::ceil(CGRectGetWidth(layer.bounds))), MAX(1, std::ceil(CGRectGetHeight(layer.bounds))));
        if (!CGSizeEqualToSize(size, _metal.drawableSize)) {
          _metal.drawableSize = size;
          _renderedValue = NAN;  // the old frame was for the old size: render again
        }
        layer.mask = _metal;  // React Native clears a view's mask when it invalidates its layer
      } else if (value >= 1) {
        if (!_hidden) _hidden = [CALayer layer];
        _hidden.frame = layer.bounds;
        layer.mask = _hidden;
      } else if (layer.mask == _hidden && _hidden) {
        layer.mask = nil;
      }
      break;
  }
}

- (BOOL)render:(double)value host:(NSView *)host skipWhenBusy:(BOOL)skip
{
  if (!_metal) return YES;
  // A display frame while the GPU still has frames to show (two of the three drawables) is skipped, not waited for:
  // the next one renders the value of its own time. Virtual-clock and settling frames always render.
  if (skip && gFramesInFlight.load() >= 2) return YES;
  SparkMotionMetal *metal = SparkMotionMetalShared();
  if (!metal) return NO;
  if (_metal.device != metal.device) _metal.device = metal.device;
  id<CAMetalDrawable> drawable = [_metal nextDrawable];
  if (!drawable) return YES;  // none free within its timeout: this frame is skipped, the next one shows the value
  _pass.colorAttachments[0].texture = drawable.texture;
  const CGSize size = host.layer.bounds.size;
  const SparkDissolveUniforms uniforms{(float)size.width, (float)size.height, (float)std::clamp(value, 0.0, 1.0), (float)std::clamp(_softness, 0.01, 1.0), (float)MAX(1, _cell), 0};
  id<MTLCommandBuffer> buffer = [metal.queue commandBuffer];
  id<MTLRenderCommandEncoder> encoder = [buffer renderCommandEncoderWithDescriptor:_pass];
  [encoder setRenderPipelineState:metal.dissolve];
  [encoder setVertexBytes:&uniforms length:sizeof(uniforms) atIndex:0];
  [encoder setFragmentBytes:&uniforms length:sizeof(uniforms) atIndex:0];
  [encoder drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:3];
  [encoder endEncoding];
  [buffer addCompletedHandler:SparkMotionFrameCompleted];
  gFramesInFlight++;
  [buffer commit];
  [buffer waitUntilScheduled];  // presentsWithTransaction: present once scheduled, in this transaction
  [drawable present];
  _pass.colorAttachments[0].texture = nil;
  _renderedValue = value;
  _renderedFrames++;
  return YES;
}

- (void)removeFrom:(NSView *)host
{
  [self install:NO host:host];
  if (_hidden && host.layer.mask == _hidden) host.layer.mask = nil;
}

@end
