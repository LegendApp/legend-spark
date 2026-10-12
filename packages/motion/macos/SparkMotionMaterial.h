#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * A MotionMaterial's backdrop (docs/motion.md#backdrop-materials): material views (NSVisualEffectView, or
 * NSGlassEffectView for Liquid Glass) stacked for crossfades in their own container, under a tint view. The container's
 * layer opacity is `materialIntensity` (the tint keeps its own), the tint layer's `materialTintOpacity`, and the top
 * material view's layer `materialCrossfade`. At most kSparkMotionMaterialLimit material views are kept.
 * Main thread only. It takes no clicks: they reach the MotionMaterial itself.
 */
/** The most material views a stack keeps while crossfades overlap: the showing one, an interrupted one, the incoming one. */
static const NSUInteger kSparkMotionMaterialLimit = 3;

@interface SparkMotionMaterialStack : NSView
/**
 * The material view for `config` (`material`, `blendingMode`, `state`, `emphasized`; JavaScript validated them), or nil
 * with `error` set when the config is malformed or this app or macOS lacks the material.
 */
+ (nullable NSView *)materialView:(NSDictionary *)config error:(NSString *_Nullable *_Nonnull)error;
/**
 * Adds `material` on top: with `replace`, every material under it is removed at once; otherwise the oldest ones are
 * dropped beyond kSparkMotionMaterialLimit (rapid changes: the bottom one is under the partly faded ones above it).
 */
- (void)push:(NSView *)material replace:(BOOL)replace;
/** The material views' container: `materialIntensity`. */
@property (nonatomic, readonly) CALayer *materialsLayer;
/** The top material view's layer: the one a crossfade fades in. */
@property (nonatomic, readonly, nullable) CALayer *incomingLayer;
@property (nonatomic, readonly) CALayer *tintLayer;
@property (nonatomic, readonly) NSUInteger materialCount;
/** The tint color shown over the material (nil: none). */
- (void)setTintColor:(nullable CGColorRef)color;
/** The current top material stays where a crossfade left it (`opacity`, its animations removed) while another fades in over it. */
- (void)freezeIncomingAt:(float)opacity;
/** Removes every material view under the top one, once the top one covers them. */
- (void)dropCovered;
/** Liquid Glass draws its own rounded shape; it follows the view's corner radius. */
- (void)setCornerRadius:(CGFloat)radius;
@end

/** Whether this app (its SDK) and this macOS have a material: NSVisualEffectMaterial names, and `glass`, `clearGlass` (macOS 26). */
BOOL SparkMotionMaterialSupported(NSString *name);

NS_ASSUME_NONNULL_END
