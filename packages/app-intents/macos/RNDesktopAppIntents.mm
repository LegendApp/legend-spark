#import "SparkAppIntents.h"
#import <RNDesktopAppIntentsSpec/RNDesktopAppIntentsSpec.h>
#import <React/RCTInvalidating.h>
#import <RNDesktopApp/SparkDesktop.h>
#import <RNDesktopApp/SparkTestDriver.h>

// The intents compiled into this build, read once (any thread): the config plugin lists them in Info.plist and
// generates the SparkGeneratedAppIntents class, and Xcode extracts their metadata into the bundle. `Unavailable` says
// why the system cannot run them, nil when it can.
static NSArray<NSDictionary *> *Declarations;
static NSArray<NSDictionary *> *Entities;
static NSString *Unavailable;
static void LoadCompiled(void) {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSError *malformed = nil;
    NSDictionary *info = NSBundle.mainBundle.infoDictionary;
    Declarations = info[SparkAppIntentsInfoKey] ? SparkAppIntentDeclarations(info[SparkAppIntentsInfoKey], &malformed) : @[];
    Entities = info[SparkAppEntitiesInfoKey] && !malformed ? SparkAppEntityDeclarations(info[SparkAppEntitiesInfoKey], &malformed) : @[];
    if (malformed) Unavailable = [NSString stringWithFormat:@"Info.plist %@ or %@ is malformed: %@", SparkAppIntentsInfoKey, SparkAppEntitiesInfoKey, malformed.localizedDescription];
    else if (!Declarations.count) Unavailable = @"This app declares no App Intents (macos.appIntents), or it runs in the Spark Runner, which cannot carry an app's intents";
    else if (!NSClassFromString(@"SparkGeneratedAppIntents")) Unavailable = @"This build has no generated App Intents (SparkGeneratedAppIntents); rebuild it with spark build";
    else if (![NSBundle.mainBundle URLForResource:@"Metadata" withExtension:@"appintents"]) Unavailable = @"This build has no App Intents metadata (Contents/Resources/Metadata.appintents); rebuild it with spark build";
    if (!Declarations) Declarations = @[];
    if (!Entities) Entities = @[];
  });
}

// One instance per process (main thread), shared by every runtime, the generated intents and the test driver. In
// driver mode it is simulated: the driver declares and invokes intents and donations never reach the system
// (docs/app-intents.md#testing).
static SparkAppIntents *Shared(void) {
  static SparkAppIntents *intents;
  if (!intents) {
    LoadCompiled();
    intents = [[SparkAppIntents alloc] initWithDeclarations:Declarations entities:Entities unavailable:Unavailable
      donor:(Class<SparkAppIntentDonating>)NSClassFromString(@"SparkGeneratedAppIntents") simulated:SparkTestDriverActive()];
    intents.delivery = ^(NSDictionary *request) { SparkEmit(request); };
  }
  return intents;
}
// A runtime's handler key: an intent id, or "entity/<id>".
static std::pair<NSString *, SparkAppIntentHandlerKind> Handler(NSString *key) {
  return [key hasPrefix:@"entity/"] ? std::make_pair([key substringFromIndex:7], SparkAppIntentHandlerEntity) : std::make_pair(key, SparkAppIntentHandlerIntent);
}
static NSDictionary *Error(NSError *error) { return @{ @"ok": @NO, @"error": @{ @"code": SparkAppIntentsErrorCode(error), @"message": error.localizedDescription } }; }

@implementation SparkAppIntentsBridge
+ (void)performIntent:(NSString *)identifier parameters:(NSDictionary<NSString *, id> *)parameters completion:(void (^)(NSString *, NSError *))completion
{
  dispatch_async(dispatch_get_main_queue(), ^{ [Shared() perform:identifier parameters:parameters timeout:SparkAppIntentTimeout completion:completion]; });
}
+ (void)queryEntities:(NSString *)entity query:(NSDictionary<NSString *, id> *)query completion:(void (^)(NSArray<NSDictionary<NSString *, id> *> *, NSError *))completion
{
  dispatch_async(dispatch_get_main_queue(), ^{ [Shared() query:entity query:query timeout:SparkAppIntentTimeout completion:completion]; });
}
@end

#if SPARK_TEST_DRIVER
// Reachable only through an authenticated driver session: {"command": "simulateAppIntents", "intents"?: [declaration],
// "entities"?: [{ id, title }], "invoke"?: { id, parameters?, timeoutMs? }, "query"?: { entity, kind, identifiers?, text?,
// timeoutMs? }} and {"command": "testAppIntents"}.
@interface SparkAppIntentsDriver : NSObject
@end
@implementation SparkAppIntentsDriver
+ (void)load {
  SparkTestDriverRegisterCommand(@"simulateAppIntents", ^(NSDictionary *request, SparkTestDriverReply reply) {
    SparkAppIntents *intents = Shared();
    NSError *error = nil;
    if (!intents.simulated) return reply(Error([NSError errorWithDomain:SparkAppIntentsErrorDomain code:0 userInfo:@{ @"code": @"E_UNAVAILABLE", NSLocalizedDescriptionKey: @"App Intents simulation needs the test driver" }]));
    if ((request[@"intents"] || request[@"entities"]) && ![intents simulateDeclarations:request[@"intents"] entities:request[@"entities"] error:&error]) return reply(Error(error));
    for (NSString *key in @[@"invoke", @"query"]) {
      NSDictionary *run = request[key];
      if (!run) continue;
      BOOL invoke = [key isEqual:@"invoke"];
      id timeout = [run isKindOfClass:NSDictionary.class] ? run[@"timeoutMs"] : nil;
      if (![run isKindOfClass:NSDictionary.class] || ![run[invoke ? @"id" : @"entity"] isKindOfClass:NSString.class] || (timeout && (![timeout isKindOfClass:NSNumber.class] || [timeout doubleValue] <= 0)))
        return reply(Error([NSError errorWithDomain:SparkAppIntentsErrorDomain code:0 userInfo:@{ @"code": @"E_INVALID_ARGUMENT", NSLocalizedDescriptionKey: invoke ? @"invoke is { id, parameters?, timeoutMs? }" : @"query is { entity, kind, identifiers?, text?, timeoutMs? }" }]));
      NSTimeInterval seconds = timeout ? [timeout doubleValue] / 1000 : SparkAppIntentTimeout;
      // Completes on its own; testAppIntents reports it under invocations or queries.
      if (invoke) [intents perform:run[@"id"] parameters:run[@"parameters"] ?: @{} timeout:seconds completion:^(id, NSError *) {}];
      else {
        NSMutableDictionary *query = [run mutableCopy];
        [query removeObjectsForKeys:@[@"entity", @"timeoutMs"]];
        [intents query:run[@"entity"] query:query timeout:seconds completion:^(id, NSError *) {}];
      }
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
  // This runtime's handlers (intent ids, and "entity/<id>" for entity query handlers), released when the bridge is invalidated.
  NSMutableSet<NSString *> *_handlers;
}
RCT_EXPORT_MODULE(NativeDesktopAppIntents)

- (instancetype)init { if ((self = [super init])) _handlers = [NSMutableSet set]; return self; }
- (void)invalidate
{
  NSSet *handlers = [_handlers copy];
  [_handlers removeAllObjects];
  dispatch_block_t release = ^{ for (NSString *handler in handlers) { auto [identifier, kind] = Handler(handler); [Shared() unregisterHandler:identifier kind:kind]; } };
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
  // { id } names an intent, { entity } an entity.
  BOOL entity = args[@"entity"] != nil;
  id given = entity ? args[@"entity"] : args[@"id"];
  NSString *identifier = [given isKindOfClass:NSString.class] ? given : @"";
  SparkAppIntentHandlerKind kind = entity ? SparkAppIntentHandlerEntity : SparkAppIntentHandlerIntent;
  NSString *handler = entity ? [@"entity/" stringByAppendingString:identifier] : identifier;
  void (^fail)(NSError *) = ^(NSError *failure) { reject(SparkAppIntentsErrorCode(failure), failure.localizedDescription, failure); };
  if ([method isEqual:@"declarations"]) resolve(SparkJSON(intents.available ? intents.declarations : @[]));
  else if ([method isEqual:@"register"]) {
    if (![intents registerHandler:identifier kind:kind error:&error]) return fail(error);
    [_handlers addObject:handler];
    resolve(@"null");
  } else if ([method isEqual:@"unregister"]) {
    if ([_handlers containsObject:handler]) { [_handlers removeObject:handler]; [intents unregisterHandler:identifier kind:kind]; }
    resolve(@"null");
  } else if ([method isEqual:@"answer"]) {
    NSDictionary *failed = [args[@"error"] isKindOfClass:NSDictionary.class] ? args[@"error"] : nil;
    NSError *failure = failed ? [NSError errorWithDomain:SparkAppIntentsErrorDomain code:0 userInfo:@{ @"code": failed[@"code"] ?: @"E_NATIVE", NSLocalizedDescriptionKey: failed[@"message"] ?: @"The handler failed" }] : nil;
    id result = args[@"entities"] ?: args[@"text"];
    if (![intents answer:args[@"requestId"] result:result == NSNull.null ? nil : result failure:failure error:&error]) return fail(error);
    resolve(@"null");
  } else if ([method isEqual:@"donate"]) [intents donate:identifier parameters:args[@"parameters"] completion:^(NSError *failure) { if (failure) fail(failure); else resolve(@"null"); }];
  else SparkInvalid(reject, @"Unknown App Intents operation");
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeDesktopAppIntentsSpecJSI>(params);
}
@end
