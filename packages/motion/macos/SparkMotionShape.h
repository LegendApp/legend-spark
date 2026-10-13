#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>

NS_ASSUME_NONNULL_BEGIN

/** The most paths a shape morphs between, and the most cubic segments of each path (docs/motion.md#shapes). */
static const NSUInteger kSparkMotionShapePathLimit = 16;
static const NSUInteger kSparkMotionShapeSegmentLimit = 128;

/**
 * A MotionShape's content (docs/motion.md#shapes): a view backed by a CAShapeLayer that shows one of its paths, or a
 * morph between two adjacent ones. JavaScript sends every path as the same structure of cubic segments, so morphing
 * interpolates their points one to one: `morph` k shows path k, k + 0.5 halfway to path k + 1, and values outside
 * [0, count - 1] continue the nearest pair (a spring's overshoot). Main thread only. It takes no clicks.
 */
@interface SparkMotionShapeView : NSView
@property (nonatomic, readonly) CAShapeLayer *shapeLayer;
@property (nonatomic, readonly) NSUInteger pathCount;
/**
 * Replaces the paths and stroke style from JavaScript's validated JSON: `paths` (each `[x, y]` of a subpath's start, then
 * six numbers per cubic segment, subpath after subpath), `subpaths` (`[segments, closed]` each), `lineCap`, `lineJoin`
 * and `fillRule`. Returns NO with `error` set, keeping the current shape, when the config is malformed or exceeds the limits.
 */
- (BOOL)setConfig:(NSDictionary *)config error:(NSString *_Nullable *_Nonnull)error;
/** A new path for `morph` (the caller releases it): one allocation per call, for a baked sample or the model. */
- (CGPathRef)copyPathAt:(double)morph CF_RETURNS_RETAINED;
/** Shows `morph` on the layer's model path; it rebuilds the path only when `morph` or the paths changed. */
- (void)showMorph:(double)morph;
@end

NS_ASSUME_NONNULL_END
