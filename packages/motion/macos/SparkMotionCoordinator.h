#import <AppKit/AppKit.h>
#import "SparkMotionEmitter.h"
#import "SparkMotionMaterial.h"
#import "SparkMotionShape.h"
#import "SparkMotionShader.h"
#include "SparkMotion.hpp"

NS_ASSUME_NONNULL_BEGIN

/**
 * A view whose own layer Spark animates. Its model values survive AppKit and Fabric layer resets: the host applies its
 * transform and SparkMotionApplyLayer for the rest.
 */
@protocol SparkMotionHost <NSObject>
@property (nonatomic, readonly) NSInteger motionTag;
@property (nonatomic, readonly) spark::motion::Values motionModel;
- (void)applyMotionModel:(const spark::motion::Values &)values;
/**
 * SparkMotionChannelBit of the background color, corner radius and shadow channels motion drives. Until motion first
 * drives one (initial, animate, setMotionValues or a scroll link), the view's style sets it (docs/motion.md#visual-effects).
 */
@property (nonatomic) uint32_t motionOwnedChannels;
/**
 * SparkMotionChannelBit of the channels React Native draws for this view's style on other layers, which motion cannot
 * drive: the background color and corner radius when it draws borders itself, the mask when it clips with a mask.
 */
@property (nonatomic, readonly) uint32_t motionStyleChannels;
/** `position` or `frame` when layout changes animate (docs/motion.md#layout-presence-and-shared-elements), else nil. */
@property (nonatomic, readonly, nullable) NSString *motionLayout;
/** Shared-element id: a host mounting with it animates from where another host with it was. */
@property (nonatomic, readonly, nullable) NSString *motionSharedId;
/** The validated transition (`spring` or `timing` JSON from JavaScript) for layout and shared-element hand-offs. */
@property (nonatomic, readonly, nullable) NSDictionary *motionTransition;
/** Right-to-left layout: `position` keeps the top-right corner instead of the top-left one. */
@property (nonatomic, readonly) BOOL motionRightToLeft;
@optional
/** A MotionMaterial's backdrop material stack (docs/motion.md#backdrop-materials); nil for other MotionViews. */
@property (nonatomic, readonly, nullable) SparkMotionMaterialStack *motionMaterial;
/** The validated crossfade transition (`spring` or `timing` JSON from JavaScript) of a MotionMaterial's material changes. */
@property (nonatomic, readonly, nullable) NSDictionary *motionCrossfade;
/** A MotionShape's shape layer view (docs/motion.md#shapes); nil for other MotionViews. */
@property (nonatomic, readonly, nullable) SparkMotionShapeView *motionShape;
/** A MotionShader's built-in effect (docs/motion.md#shader-effects-and-particles); nil for other MotionViews. */
@property (nonatomic, readonly, nullable) SparkMotionShader *motionShader;
/** A MotionEmitter's particle emitter (docs/motion.md#shader-effects-and-particles); nil for other MotionViews. */
@property (nonatomic, readonly, nullable) SparkMotionEmitter *motionEmitter;
@end

/** A MotionSymbol: an SF Symbol image view that plays symbol effects (docs/motion.md#symbol-effects). */
@protocol SparkMotionSymbolHost <NSObject>
@property (nonatomic, readonly) NSInteger motionTag;
@property (nonatomic, readonly) NSImageView *symbolImageView;
@end

typedef void (^SparkMotionResolve)(id _Nullable result);
typedef void (^SparkMotionReject)(NSString *code, NSString *message);

/**
 * Main-thread owner of spark::motion::Engine on macOS. Bakes engine channels into
 * Core Animation keyframe animations at the display's frame rate, drives the virtual clock through layer timing,
 * settles completions with one-shot timers, and runs scroll links and frame telemetry. It applies Reduce Motion,
 * Low Power Mode and window visibility, cancels a closing window's motion, and plays cues on display frames.
 */
@interface SparkMotionCoordinator : NSObject
+ (instancetype)shared;
- (void)registerHost:(NSView<SparkMotionHost> *)host initial:(const spark::motion::Values &)initial;
/** Called from the host's dealloc; its weak entry may already be gone. */
- (void)unregisterTag:(NSInteger)tag;
- (void)hostDidResize:(NSView<SparkMotionHost> *)host;
/**
 * `model` with the background color, corner radius and shadow the host's style just put on its layer, for the channels
 * motion does not own yet; the engine takes them too, so an animation starts from what the view shows.
 */
- (spark::motion::Values)styledModel:(NSView<SparkMotionHost> *)host model:(const spark::motion::Values &)model;
/**
 * Mounting-transaction hooks for hosts with a layout mode or shared id, before a transaction's first mutation and after
 * its last (a host mounted by the transaction gets only the second). `surface` and `transaction` identify it.
 */
- (void)hostWillMount:(NSView<SparkMotionHost> *)host surface:(NSInteger)surface transaction:(NSInteger)transaction;
- (void)hostDidMount:(NSView<SparkMotionHost> *)host surface:(NSInteger)surface transaction:(NSInteger)transaction;

- (void)run:(NSDictionary *)plan resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
- (void)stopAnimation:(NSString *)identifier resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
- (void)set:(NSDictionary *)request resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
- (void)stop:(NSDictionary *)request resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
- (void)state:(NSInteger)tag resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
- (void)link:(NSDictionary *)request resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
- (void)unlink:(NSString *)identifier resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
- (void)recordFrames:(NSDictionary *)request resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
/** The user's Reduce Motion setting (a driver run's simulated one). */
@property (nonatomic, readonly) BOOL reduceMotion;
/** The user's Reduce Transparency setting (a driver run's simulated one). */
@property (nonatomic, readonly) BOOL reduceTransparency;

- (void)registerSymbol:(NSView<SparkMotionSymbolHost> *)host;
- (void)unregisterSymbolTag:(NSInteger)tag;
/** Plays a symbol effect on a MotionSymbol, or its Reduce Motion alternate; resolves `{ played }`. */
- (void)playSymbolEffect:(NSDictionary *)request resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
/** Removes one effect type (`effect`) or all of them from a MotionSymbol. */
- (void)removeSymbolEffect:(NSDictionary *)request resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
/** Shows `image` with a replace content transition (`replace`, `downUp`, `upUp`, `offUp`), a cross-fade under Reduce Motion, or at once without one. */
- (void)replaceSymbol:(NSView<SparkMotionSymbolHost> *)host image:(nullable NSImage *)image transition:(nullable NSString *)transition;

/**
 * A registered MotionMaterial's material changed to `material`: it crossfades in over the one showing (the engine drives
 * `materialCrossfade` with the host's crossfade transition, or the Reduce Motion fade), which is removed once covered.
 */
- (void)host:(NSView<SparkMotionHost> *)host crossfadeTo:(NSView *)material;

/** A registered MotionShape's paths changed: its path shows the new ones at the current morph, a running morph continues on them. */
- (void)hostDidReshape:(NSView<SparkMotionHost> *)host;
/** A registered MotionShader's effect changed from `previous` (nil: it had none): it comes off the view, and the new one shows the view's values. */
- (void)host:(NSView<SparkMotionHost> *)host shaderChangedFrom:(nullable SparkMotionShader *)previous;
/** Starts a MotionEmitter's particles (`tag`, `durationMs`, `reducedMotion`), or nothing under Reduce Motion; resolves `{ played }`. */
- (void)startParticles:(NSDictionary *)request resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
/** Stops a MotionEmitter's particles (`tag`); the particles alive finish their lifetime. */
- (void)stopParticles:(NSDictionary *)request resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;

/** Reduce Motion, Reduce Transparency, Low Power Mode, and the frame rates and window visibility of `tag`'s view (0: the main display, no window). */
- (void)environment:(NSInteger)tag resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;

/** Main thread. The MotionViews animating now, by testID, else `MotionView <tag>`: the frame timeline's compositor track (SparkMotionTimeline.mm). */
- (NSArray<NSString *> *)animatingViews;

// The virtual clock and motion telemetry serve only the in-app test driver, and compile only with it
// (SPARK_TEST_DRIVER, which the podspec sets; docs/test-driver.md#builds).
#if SPARK_TEST_DRIVER
- (void)setClock:(NSString *)mode resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
- (void)advanceClock:(double)milliseconds resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
- (void)clock:(SparkMotionResolve)resolve;
/** Called with the milliseconds each time virtual time advances (advanceClock, and waitForMotion moving it to its target), so the driver can report it to window choreography. */
@property (nonatomic, copy, nullable) void (^clockAdvanced)(double milliseconds);

// Motion telemetry for the in-app test driver (docs/motion.md#motion-telemetry). Replies are dictionaries.
/** The registered MotionView that is `view` or its nearest ancestor. */
- (nullable NSView<SparkMotionHost> *)hostForView:(NSView *)view;
/**
 * The driver calls it when it starts. Records each view's latest motion (the engine's telemetry is off by default) and
 * every cue, which no longer plays (docs/motion.md#cues), stops following the real occlusion of windows the driver
 * never shows (they count as visible unless simulateWindow:visible: hides them), and pins Reduce Motion, Reduce
 * Transparency and Low Power Mode off and the frame rate at 60 Hz until simulate: changes them. Views registered after
 * it follow no change of the Mac's settings, displays or occlusion.
 */
- (void)recordTelemetry;
/** Overrides what motion reads of the system: reduceMotion, reduceTransparency and lowPowerMode (simulateSystemEvent's fields) and maximumFramesPerSecond; null restores the pinned value. */
- (void)simulate:(NSDictionary *)values;
/** Treats `window` as hidden or visible, as a change of its occlusion state would. */
- (void)simulateWindow:(NSWindow *)window visible:(BOOL)visible;
/** Marks a driver input (a click, key, deep link): waitForMotion waits for motion started or interrupted after it. */
- (void)noteInput;
/** Engine state now and the view's latest motion. */
- (void)telemetry:(NSInteger)tag resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
/**
 * Waits up to `timeout` seconds for motion of the view started or interrupted after the last input, then until it
 * reaches `until` (`progress` 0-1, `elapsedMs` from its start, or `settled`). The virtual clock is advanced exactly there.
 */
- (void)waitForMotion:(NSInteger)tag until:(NSDictionary *)until timeout:(double)timeout resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
/** Values and velocities of the view's latest motion every `intervalMs` from `fromMs` to `toMs` (engine time, default its start to its end or now). */
- (void)sample:(NSInteger)tag request:(NSDictionary *)request resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
/** Gives every view its presented values (engine state now) for the duration of `render`, so an in-process render shows the frame on screen. */
- (void)presenting:(dispatch_block_t)render;
#endif
@end

/**
 * The composed transform about the view centre, in React Native's order `translate · perspective · rotateX · rotateY ·
 * rotate · scale` (scale applies first).
 */
CATransform3D SparkMotionTransform(const spark::motion::Values &values);
/** Whether this app (its SDK) and this macOS have a symbol effect (`bounce`, `pulse`, `wiggle`, `rotate`, `breathe`, `drawOn`, `drawOff`) or the `replace` transition. */
BOOL SparkSymbolEffectSupported(NSString *name);
/** A channel's bit in motionOwnedChannels. */
inline uint32_t SparkMotionChannelBit(spark::motion::Channel channel) { return 1u << static_cast<int>(channel); }
/**
 * Applies every motion value except the transform to the host's layer: opacity, the OKLCH background color, corner
 * radius and shadow of the channels it owns, the blur filter and mask while the coordinator has them installed, a
 * MotionMaterial's intensity, tint opacity and crossfade, a MotionShape's path, stroke and colors, a MotionShader's
 * effect, and a MotionEmitter's geometry.
 * Hosts call it from applyMotionModel: and after React Native re-applies their style to the layer.
 */
void SparkMotionApplyLayer(NSView<SparkMotionHost> *host, const spark::motion::Values &values);

NS_ASSUME_NONNULL_END
