#import "SparkAppIntents.h"
#import <RNDesktopAppIntentsSpec/RNDesktopAppIntentsSpec.h>
#import <React/RCTInvalidating.h>
#import <RNDesktopApp/SparkDesktop.h>
#import <RNDesktopApp/SparkTestDriver.h>

// The intents compiled into this build, read once (any thread): the config plugin lists them in Info.plist and
// generates the SparkGeneratedAppIntents class, and Xcode extracts their metadata into the bundle. `Unavailable` says
// why the system cannot run them, nil when it can.
static NSArray<NSDictionary *> *Declarations;
static NSString *Unavailable;
static void LoadCompiled(void) {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSError *malformed = nil;
    id value = NSBundle.mainBundle.infoDictionary[SparkAppIntentsInfoKey];
    Declarations = value ? SparkAppIntentDeclarations(value, &malformed) : @[];
    if (malformed) Unavailable = [NSString stringWithFormat:@"Info.plist %@ is malformed: %@", SparkAppIntentsInfoKey, malformed.localizedDescription];
    else if (!Declarations.count) Unavailable = @"This app declares no App Intents (macos.appIntents), or it runs in the Spark Runner, which cannot carry an app's intents";
    else if (!NSClassFromString(@"SparkGeneratedAppIntents")) Unavailable = @"This build has no generated App Intents (SparkGeneratedAppIntents); rebuild it with spark build";
    else if (![NSBundle.mainBundle URLForResource:@"Metadata" withExtension:@"appintents"]) Unavailable = @"This build has no App Intents metadata (Contents/Resources/Metadata.appintents); rebuild it with spark build";
    if (!Declarations) Declarations = @[];
  });
}

// One instance per process (main thread), shared by every runtime, the generated intents and the test driver. In
// driver mode it is simulated: the driver declares and invokes intents and donations never reach the system
// (docs/app-intents.md#testing).
static SparkAppIntents *Shared(void) {
  static SparkAppIntents *intents;
  if (!intents) {
    LoadCompiled();
    intents = [[SparkAppIntents alloc] initWithDeclarations:Declarations unavailable:Unavailable
      donor:(Class<SparkAppIntentDonating>)NSClassFromString(@"SparkGeneratedAppIntents") simulated:SparkTestDriverActive()];
    intents.delivery = ^(NSDictionary *request) {
      NSMutableDictionary *event = [request mutableCopy];
      event[@"type"] = @"appIntentInvoked";
      SparkEmit(event);
    };
  }
  return intents;
}
static NSDictionary *Error(NSError *error) { return @{ @"ok": @NO, @"error": @{ @"code": SparkAppIntentsErrorCode(error), @"message": error.localizedDescription } }; }

@implementation SparkAppIntentsBridge
+ (void)performIntent:(NSString *)identifier parameters:(NSDictionary<NSString *, id> *)parameters completion:(void (^)(NSString *, NSError *))completion
{
  dispatch_async(dispatch_get_main_queue(), ^{ [Shared() perform:identifier parameters:parameters timeout:SparkAppIntentTimeout completion:completion]; });
}
@end

#if SPARK_TEST_DRIVER
// Reachable only through an authenticated driver session: {"command": "simulateAppIntents", "intents"?: [declaration],
// "invoke"?: { id, parameters?, timeoutMs? }} and {"command": "testAppIntents"}.
@interface SparkAppIntentsDriver : NSObject
@end
@implementation SparkAppIntentsDriver
+ (void)load {
  SparkTestDriverRegisterCommand(@"simulateAppIntents", ^(NSDictionary *request, SparkTestDriverReply reply) {
    SparkAppIntents *intents = Shared();
    NSError *error = nil;
    if (!intents.simulated) return reply(Error([NSError errorWithDomain:SparkAppIntentsErrorDomain code:0 userInfo:@{ @"code": @"E_UNAVAILABLE", NSLocalizedDescriptionKey: @"App Intents simulation needs the test driver" }]));
    if (request[@"intents"] && ![intents simulateDeclarations:request[@"intents"] error:&error]) return reply(Error(error));
    NSDictionary *invoke = request[@"invoke"];
    if (invoke) {
      id timeout = [invoke isKindOfClass:NSDictionary.class] ? invoke[@"timeoutMs"] : nil;
      if (![invoke isKindOfClass:NSDictionary.class] || ![invoke[@"id"] isKindOfClass:NSString.class] || (timeout && (![timeout isKindOfClass:NSNumber.class] || [timeout doubleValue] <= 0)))
        return reply(Error([NSError errorWithDomain:SparkAppIntentsErrorDomain code:0 userInfo:@{ @"code": @"E_INVALID_ARGUMENT", NSLocalizedDescriptionKey: @"invoke is { id, parameters?, timeoutMs? }" }]));
      // Completes on its own; testAppIntents reports it under invocations.
      [intents perform:invoke[@"id"] parameters:invoke[@"parameters"] ?: @{} timeout:timeout ? [timeout doubleValue] / 1000 : SparkAppIntentTimeout completion:^(NSString *, NSError *) {}];
    }
    reply(@{ @"ok": @YES, @"appIntents": intents.simulation });
  });
  SparkTestDriverRegisterCommand(@"testAppIntents", ^(NSDictionary *request, SparkTestDriverReply reply) {
    if (!Shared().simulated) reply(@{ @"ok": @NO, @"error": @{ @"code": @"E_UNAVAILABLE", @"message": @"App Intents simulation needs the test driver" } });
    else reply(@{ @"ok": @YES, @"appIntents": Shared().simulation });
  });
}
@end
#endif

@interface RNDesktopAppIntents : NSObject <NativeDesktopAppIntentsSpec, RCTInvalidating>
@end

@implementation RNDesktopAppIntents {
  NSMutableSet<NSString *> *_handlers; // This runtime's handlers, released when the bridge is invalidated.
}
RCT_EXPORT_MODULE(NativeDesktopAppIntents)

- (instancetype)init { if ((self = [super init])) _handlers = [NSMutableSet set]; return self; }
- (void)invalidate
{
  NSSet *handlers = [_handlers copy];
  [_handlers removeAllObjects];
  dispatch_block_t release = ^{ for (NSString *identifier in handlers) [Shared() unregisterHandler:identifier]; };
  if (NSThread.isMainThread) release(); else dispatch_async(dispatch_get_main_queue(), release);
}
+ (BOOL)requiresMainQueueSetup { return NO; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }

// Synchronous, so on the JavaScript thread: it reads only what LoadCompiled fixed once.
- (NSNumber *)isAvailable { LoadCompiled(); return @(SparkTestDriverActive() || !Unavailable); }

- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  NSDictionary *args = SparkArgs(json);
  SparkAppIntents *intents = Shared();
  NSError *error = nil;
  NSString *identifier = [args[@"id"] isKindOfClass:NSString.class] ? args[@"id"] : @"";
  void (^fail)(NSError *) = ^(NSError *failure) { reject(SparkAppIntentsErrorCode(failure), failure.localizedDescription, failure); };
  if ([method isEqual:@"declarations"]) resolve(SparkJSON(intents.available ? intents.declarations : @[]));
  else if ([method isEqual:@"register"]) {
    if (![intents registerHandler:identifier error:&error]) return fail(error);
    [_handlers addObject:identifier];
    resolve(@"null");
  } else if ([method isEqual:@"unregister"]) {
    if ([_handlers containsObject:identifier]) { [_handlers removeObject:identifier]; [intents unregisterHandler:identifier]; }
    resolve(@"null");
  } else if ([method isEqual:@"answer"]) {
    NSDictionary *failed = [args[@"error"] isKindOfClass:NSDictionary.class] ? args[@"error"] : nil;
    NSError *failure = failed ? [NSError errorWithDomain:SparkAppIntentsErrorDomain code:0 userInfo:@{ @"code": failed[@"code"] ?: @"E_NATIVE", NSLocalizedDescriptionKey: failed[@"message"] ?: @"The handler failed" }] : nil;
    if (![intents answer:args[@"requestId"] text:[args[@"text"] isKindOfClass:NSString.class] ? args[@"text"] : nil failure:failure error:&error]) return fail(error);
    resolve(@"null");
  } else if ([method isEqual:@"donate"]) [intents donate:identifier parameters:args[@"parameters"] completion:^(NSError *failure) { if (failure) fail(failure); else resolve(@"null"); }];
  else SparkInvalid(reject, @"Unknown App Intents operation");
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeDesktopAppIntentsSpecJSI>(params);
}
@end
