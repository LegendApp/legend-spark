#import <AppKit/AppKit.h>
#include "SparkMotion.hpp"

NS_ASSUME_NONNULL_BEGIN

/** A view whose own layer Spark animates. Its model values survive AppKit and Fabric layer resets. */
@protocol SparkMotionHost <NSObject>
@property (nonatomic, readonly) NSInteger motionTag;
@property (nonatomic, readonly) spark::motion::Values motionModel;
- (void)applyMotionModel:(const spark::motion::Values &)values;
@end

typedef void (^SparkMotionResolve)(id _Nullable result);
typedef void (^SparkMotionReject)(NSString *code, NSString *message);

/**
 * Main-thread owner of spark::motion::Engine on macOS. Bakes engine channels into
 * Core Animation keyframe animations, drives the virtual clock through layer timing,
 * settles completions with one-shot timers, and runs scroll links and frame telemetry.
 */
@interface SparkMotionCoordinator : NSObject
+ (instancetype)shared;
- (void)registerHost:(NSView<SparkMotionHost> *)host initial:(const spark::motion::Values &)initial;
/** Called from the host's dealloc; its weak entry may already be gone. */
- (void)unregisterTag:(NSInteger)tag;
- (void)hostDidResize:(NSView<SparkMotionHost> *)host;

- (void)run:(NSDictionary *)plan resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
- (void)stopAnimation:(NSString *)identifier resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
- (void)set:(NSDictionary *)request resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
- (void)stop:(NSDictionary *)request resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
- (void)state:(NSInteger)tag resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
- (void)link:(NSDictionary *)request resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
- (void)unlink:(NSString *)identifier resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
- (void)recordFrames:(NSDictionary *)request resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;

// The virtual clock and motion telemetry serve only the in-app test driver, and compile only with it
// (SPARK_TEST_DRIVER, which the podspec sets; docs/test-driver.md#builds).
#if SPARK_TEST_DRIVER
- (void)setClock:(NSString *)mode resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
- (void)advanceClock:(double)milliseconds resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
- (void)clock:(SparkMotionResolve)resolve;

// Motion telemetry for the in-app test driver (docs/motion.md#motion-telemetry). Replies are dictionaries.
/** The registered MotionView that is `view` or its nearest ancestor. */
- (nullable NSView<SparkMotionHost> *)hostForView:(NSView *)view;
/** Starts recording each view's latest motion (the engine's telemetry is off by default); the driver calls it when it starts. */
- (void)recordTelemetry;
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

/** Composed `translate · rotate · scale` about the view centre, matching React Native's transform order. */
CATransform3D SparkMotionTransform(const spark::motion::Values &values);

NS_ASSUME_NONNULL_END
