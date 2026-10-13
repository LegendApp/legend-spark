#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * A MotionEmitter's particles (docs/motion.md#shader-effects-and-particles): a CAEmitterLayer on the view's own layer,
 * so the window server simulates and draws them, and the view's layer timing (the virtual clock) holds them. It emits
 * only between start and stop. Main thread only.
 */
@interface SparkMotionEmitter : NSObject
/** The emitter for `config` (`shape`, `position`, `size`, `blend`, `seed`, `cells`; JavaScript validated them), or nil with `error` set. */
+ (nullable SparkMotionEmitter *)emitter:(NSDictionary *)config error:(NSString *_Nullable *_Nonnull)error;
@property (nonatomic, readonly) CAEmitterLayer *layer;
/** Takes another config's cells and geometry, keeping whether it emits. */
- (BOOL)update:(NSDictionary *)config error:(NSString *_Nullable *_Nonnull)error;
/** Puts the emitter layer on `host`'s layer and fits it to the view's bounds. */
- (void)layout:(NSView *)host;
/** Emits (for `duration` seconds of layer time, or until stopped when 0) or stops; particles alive keep their lifetime. */
- (void)start:(double)duration host:(NSView *)host;
- (void)stop;
/** Whether it emits now, on the layer's clock. */
- (BOOL)emitting:(NSView *)host;
/** Whether its last start asked to play under Reduce Motion (`reducedMotion: 'play'`): turning Reduce Motion on stops the others. */
@property (nonatomic) BOOL playsUnderReduceMotion;
/** Holds the particles where they are while the window is hidden, and resumes them from that instant. */
@property (nonatomic) BOOL paused;
@end

NS_ASSUME_NONNULL_END
