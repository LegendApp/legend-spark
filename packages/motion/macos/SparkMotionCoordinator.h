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
- (void)setClock:(NSString *)mode resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
- (void)advanceClock:(double)milliseconds resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
- (void)clock:(SparkMotionResolve)resolve;
- (void)recordFrames:(NSDictionary *)request resolve:(SparkMotionResolve)resolve reject:(SparkMotionReject)reject;
@end

/** Composed `translate · rotate · scale` about the view centre, matching React Native's transform order. */
CATransform3D SparkMotionTransform(const spark::motion::Values &values);

NS_ASSUME_NONNULL_END
