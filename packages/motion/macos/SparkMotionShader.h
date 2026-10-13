#import <AppKit/AppKit.h>
#include "SparkMotion.hpp"

NS_ASSUME_NONNULL_BEGIN

/**
 * A MotionShader's built-in effect (docs/motion.md#shader-effects-and-particles), driven by one engine property:
 *
 * - `ripple` (`rippleProgress`): a CITorusLensDistortion ring that travels out from `origin`; layer filter, baked.
 * - `distortion` (`distortion`): a CIBumpDistortion bulge (positive) or pinch (negative); layer filter, baked.
 * - `specular` (`specularProgress`): a light band that sweeps across the view; a CAGradientLayer overlay, baked.
 * - `dissolve` (`dissolveProgress`): a noise-threshold mask that a precompiled Metal shader renders on display frames.
 *
 * Each is installed only while it shows something or animates. Main thread only.
 */
@interface SparkMotionShader : NSObject
/** The effect for `config` (`type` and its options; JavaScript validated them), or nil with `error` set. */
+ (nullable SparkMotionShader *)shader:(NSDictionary *)config error:(NSString *_Nullable *_Nonnull)error;
@property (nonatomic, readonly) NSString *type;
/** The engine property that drives it. */
@property (nonatomic, readonly) spark::motion::Property property;
/** Whether the effect renders its own frames (dissolve, with Metal) instead of Core Animation playing a bake. */
@property (nonatomic, readonly) BOOL rendersFrames;
/** The key paths the coordinator bakes the effect channel onto (none for dissolve). */
@property (nonatomic, readonly) NSArray<NSString *> *keyPaths;
/** The layer that the `index`th key path animates; nil while the effect is not installed. */
- (nullable CALayer *)target:(NSUInteger)index host:(NSView *)host;
/** The `index`th key path's value for the effect at `value`. */
- (id)sample:(NSUInteger)index value:(double)value host:(NSView *)host;
/** Whether the effect needs its filter, overlay or Metal mask at rest at `value` (a ripple or sweep in progress, a distortion). */
- (BOOL)showsAtRest:(double)value;
/** Whether the filter, overlay or Metal mask is on `host` now. */
- (BOOL)installedOn:(NSView *)host;
/** Installs the effect on the host while `active` (it shows something or animates), else removes it. */
- (void)install:(BOOL)active host:(NSView *)host;
/** Shows the model `value`: the filter's inputs, the overlay's band; the dissolve mask's rest states (all shown, all hidden). */
- (void)apply:(double)value host:(NSView *)host;
/**
 * Dissolve: renders the mask at `value` now (the coordinator calls it on display frames while it animates, and on the
 * virtual clock when the clock moves). With `skip`, a display frame is skipped while the GPU has two frames in flight,
 * so the main thread does not wait for a drawable. Returns NO when no Metal device can render it.
 */
- (BOOL)render:(double)value host:(NSView *)host skipWhenBusy:(BOOL)skip;
/** The value of the last frame rendered (dissolve), NaN before the first. */
@property (nonatomic, readonly) double renderedValue;
/** Frames rendered since the effect was created (dissolve). */
@property (nonatomic, readonly) NSUInteger renderedFrames;
/** Removes whatever the effect installed on `host`: its type changed, or the view unmounts. */
- (void)removeFrom:(NSView *)host;
@end

/**
 * Whether this Mac can show an effect: `ripple`, `distortion` and `specular` always; `dissolve` when a Metal device builds
 * its pipeline (built here, on any thread). A device added, removed or lost makes it check again.
 */
BOOL SparkMotionShaderSupported(NSString *type);
/** Treats the Metal device as lost, as its removal or a failed command buffer does: the next frame rebuilds every Metal object. */
void SparkMotionShaderDeviceLost(void);

NS_ASSUME_NONNULL_END
