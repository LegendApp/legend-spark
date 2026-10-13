#import "RNSparkMotion.h"
#import "SparkMotionCoordinator.h"

static NSDictionary *SparkMotionRequest(NSString *json)
{
  id value = [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] ?: NSData.data options:0 error:nil];
  return [value isKindOfClass:NSDictionary.class] ? value : nil;
}

/** Every method runs on the main queue, where the coordinator owns Core Animation state. */
@implementation RNSparkMotion
RCT_EXPORT_MODULE(NativeSparkMotion)
+ (BOOL)requiresMainQueueSetup { return NO; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }

- (void)withRequest:(NSString *)json reject:(RCTPromiseRejectBlock)reject run:(void (^)(NSDictionary *request, SparkMotionReject failure))run
{
  SparkMotionReject failure = ^(NSString *code, NSString *message) { reject(code, message, nil); };
  NSDictionary *request = SparkMotionRequest(json);
  if (!request) { failure(@"E_INVALID_ARGUMENT", @"Motion request is not a JSON object"); return; }
  run(request, failure);
}

- (void)run:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self withRequest:json reject:reject run:^(NSDictionary *request, SparkMotionReject failure) { [SparkMotionCoordinator.shared run:request resolve:resolve reject:failure]; }];
}
- (void)stopAnimation:(NSString *)identifier resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [SparkMotionCoordinator.shared stopAnimation:identifier resolve:resolve reject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}
- (void)set:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self withRequest:json reject:reject run:^(NSDictionary *request, SparkMotionReject failure) { [SparkMotionCoordinator.shared set:request resolve:resolve reject:failure]; }];
}
- (void)stop:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self withRequest:json reject:reject run:^(NSDictionary *request, SparkMotionReject failure) { [SparkMotionCoordinator.shared stop:request resolve:resolve reject:failure]; }];
}
- (void)getState:(double)tag resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [SparkMotionCoordinator.shared state:(NSInteger)tag resolve:resolve reject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}
- (void)link:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self withRequest:json reject:reject run:^(NSDictionary *request, SparkMotionReject failure) { [SparkMotionCoordinator.shared link:request resolve:resolve reject:failure]; }];
}
- (void)unlink:(NSString *)identifier resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [SparkMotionCoordinator.shared unlink:identifier resolve:resolve reject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}
- (void)recordFrames:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self withRequest:json reject:reject run:^(NSDictionary *request, SparkMotionReject failure) { [SparkMotionCoordinator.shared recordFrames:request resolve:resolve reject:failure]; }];
}

- (void)environment:(double)tag resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [SparkMotionCoordinator.shared environment:(NSInteger)tag resolve:resolve reject:^(NSString *code, NSString *message) { reject(code, message, nil); }];
}

- (void)playSymbolEffect:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self withRequest:json reject:reject run:^(NSDictionary *request, SparkMotionReject failure) { [SparkMotionCoordinator.shared playSymbolEffect:request resolve:resolve reject:failure]; }];
}
- (void)removeSymbolEffect:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self withRequest:json reject:reject run:^(NSDictionary *request, SparkMotionReject failure) { [SparkMotionCoordinator.shared removeSymbolEffect:request resolve:resolve reject:failure]; }];
}
/** Whether an SF Symbol exists, cached per name: MotionSymbol checks it on every render, on the JavaScript thread. */
- (NSNumber *)hasSymbol:(NSString *)name
{
  static NSCache<NSString *, NSNumber *> *known = [NSCache new];  // thread-safe
  NSNumber *exists = [known objectForKey:name];
  if (!exists) {
    exists = @([NSImage imageWithSystemSymbolName:name accessibilityDescription:nil] != nil);
    [known setObject:exists forKey:name];
  }
  return exists;
}
- (NSNumber *)supportsSymbolEffect:(NSString *)name { return @(SparkSymbolEffectSupported(name)); }
- (NSNumber *)supportsMaterial:(NSString *)name { return @(SparkMotionMaterialSupported(name)); }
- (NSNumber *)supportsShaderEffect:(NSString *)name { return @(SparkMotionShaderSupported(name)); }
- (void)startParticles:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self withRequest:json reject:reject run:^(NSDictionary *request, SparkMotionReject failure) { [SparkMotionCoordinator.shared startParticles:request resolve:resolve reject:failure]; }];
}
- (void)stopParticles:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [self withRequest:json reject:reject run:^(NSDictionary *request, SparkMotionReject failure) { [SparkMotionCoordinator.shared stopParticles:request resolve:resolve reject:failure]; }];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeSparkMotionSpecJSI>(params);
}
@end
