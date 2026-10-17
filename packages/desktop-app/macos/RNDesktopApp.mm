#import "RNDesktopApp.h"
#import "SparkDesktop.h"
#import "SparkDevTools.h"
#import "SparkProfiler.h"
#import "SparkLocalization.h"
@implementation RNDesktopApp { NSMutableSet<NSString *> *_guardIds; BOOL _observing; }
- (instancetype)init { if ((self = [super init])) _guardIds = [NSMutableSet new]; return self; }
RCT_EXPORT_MODULE(NativeDesktopApp)
@synthesize callInvoker = _callInvoker;
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (NSArray<NSString *> *)supportedEvents { return @[@"desktop"]; }
// The test driver's `listeners` leak counter asks the JavaScript only while it observes desktop events.
- (void)startObserving {
#if SPARK_TEST_DRIVER
  if (!_observing) SparkSetDesktopObserved(_observing = YES);
#endif
  [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(event:) name:SparkDesktopEvent object:nil];
}
- (void)stopObserving {
#if SPARK_TEST_DRIVER
  if (_observing) SparkSetDesktopObserved(_observing = NO);
#endif
  [NSNotificationCenter.defaultCenter removeObserver:self];
}
- (void)event:(NSNotification *)note { [self sendEventWithName:@"desktop" body:note.userInfo]; }
- (void)invalidate { [self stopObserving]; dispatch_async(dispatch_get_main_queue(), ^{ for (NSString *identifier in self->_guardIds) SparkSetQuitGuard(identifier, NO); [self->_guardIds removeAllObjects]; }); [super invalidate]; }
#if RCT_DEV
static SparkProfilerCompletion SparkProfilerSettle(RCTPromiseResolveBlock resolve, RCTPromiseRejectBlock reject) {
  return ^(NSString *json, NSString *code, NSString *message) { if (code) reject(code, message, nil); else resolve(json); };
}
#endif
- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
#if RCT_DEV
  // The profile's files are megabytes: parsed and written on the profiler's queue, never on the main thread.
  if ([method isEqual:@"writeProfile"]) { SparkProfilerWrite(json, SparkProfilerSettle(resolve, reject)); return; }
#endif
  dispatch_async(dispatch_get_main_queue(), ^{
    NSDictionary *args = SparkArgs(json);
    if ([method isEqual:@"context"]) { NSMutableDictionary *context = [SparkContext() mutableCopy]; context[@"launch"] = SparkLaunchState(); context[@"sandboxed"] = @(SparkSandboxed()); resolve(SparkJSON(context)); }
    else if ([method isEqual:@"initialURL"]) resolve(SparkJSON(SparkInitialURL()));
    else if ([method isEqual:@"pendingURLs"]) resolve(SparkJSON(SparkPendingURLs()));
    else if ([method isEqual:@"quit"]) {
      SparkObserveQuitDecision(^(BOOL allow) { resolve(SparkJSON(allow ? @{ @"quitRequested": @YES } : @{ @"quitRequested": @NO, @"reason": @"vetoed" })); });
      // AppKit can enter a modal run loop while awaiting the JS decision. Do
      // not hold the main GCD queue that must deliver that decision.
      [NSRunLoop.mainRunLoop performBlock:^{ [NSApp terminate:nil]; }]; }
    else if ([method isEqual:@"relaunch"]) {
      NSArray *process = NSProcessInfo.processInfo.arguments;
      NSArray *arguments = args[@"arguments"] ?: [process subarrayWithRange:NSMakeRange(1, process.count - 1)];
      if (![arguments isKindOfClass:NSArray.class] || [arguments indexOfObjectPassingTest:^BOOL(id item, NSUInteger index, BOOL *stop) { return ![item isKindOfClass:NSString.class]; }] != NSNotFound) { SparkInvalid(reject, @"Expected relaunch arguments"); return; }
      SparkRelaunch(arguments, ^(NSDictionary *result, NSError *error) { if (error) SparkReject(reject, error); else resolve(SparkJSON(result)); });
    }
    else if ([method isEqual:@"quitGuard"]) {
      NSString *identifier = args[@"id"];
      if (![identifier isKindOfClass:NSString.class] || !identifier.length) { SparkInvalid(reject, @"Expected quit guard ID"); return; }
      BOOL enabled = [args[@"enabled"] boolValue];
      if (enabled) [self->_guardIds addObject:identifier]; else [self->_guardIds removeObject:identifier];
      SparkSetQuitGuard(identifier, enabled); resolve(@"null");
    }
    else if ([method isEqual:@"replyQuit"]) { SparkReplyQuit(args[@"id"], [args[@"allow"] boolValue], [args[@"requestId"] unsignedIntegerValue]); resolve(@"null"); }
    else if ([method isEqual:@"languages"]) resolve(SparkJSON(SparkAppLanguages()));
    else if ([method isEqual:@"setLanguage"]) {
      id language = args[@"language"];
      if (language == NSNull.null) language = nil;
      if ((language && ![language isKindOfClass:NSString.class]) || !SparkSetAppLanguage(language)) { SparkInvalid(reject, @"The app does not list this language in its localizations"); return; }
      resolve(@"null");
    }
    else if ([method isEqual:@"strings"]) {
      NSArray *keys = args[@"keys"]; NSMutableDictionary *strings = [NSMutableDictionary new];
      if (![keys isKindOfClass:NSArray.class] || [keys indexOfObjectPassingTest:^BOOL(id key, NSUInteger index, BOOL *stop) { return ![key isKindOfClass:NSString.class]; }] != NSNotFound) { SparkInvalid(reject, @"Expected string keys"); return; }
      @try { for (id key in keys) strings[key] = SparkLocalizedString(key); }
      @catch (NSException *exception) { SparkInvalid(reject, exception.reason); return; }
      resolve(SparkJSON(strings));
    }
#if SPARK_TEST_DRIVER
    else if ([method isEqual:@"replyDriverState"]) { SparkReplyDriverState(args); resolve(@"null"); }
#endif
    else if ([method isEqual:@"hide"]) { [NSApp hide:nil]; resolve(@"null"); }
    else if ([method isEqual:@"activate"]) { [NSApp activateIgnoringOtherApps:YES]; resolve(@"null"); }
#if RCT_DEV
    else if ([method isEqual:@"openDevTools"]) {
      id runtime = args[@"runtime"];
      if (runtime && (![runtime isKindOfClass:NSString.class] || ![runtime length])) { SparkInvalid(reject, @"Expected an isolated runtime name"); return; }
      SparkOpenDevTools(runtime, ^(NSString *code, NSString *message) { if (code) reject(code, message, nil); else resolve(@"null"); });
    }
    else if ([method isEqual:@"startProfiling"]) {
      id rate = args[@"samplesPerSecond"];
      if (![rate isKindOfClass:NSNumber.class] || [rate doubleValue] < 1 || [rate doubleValue] > 10000) { SparkInvalid(reject, @"Expected samplesPerSecond from 1 to 10000"); return; }
      SparkProfilerStart([rate doubleValue], SparkProfilerSettle(resolve, reject));
    }
    else if ([method isEqual:@"stopProfiling"]) {
      id directory = args[@"directory"];
      if (directory && ![directory isKindOfClass:NSString.class]) { SparkInvalid(reject, @"Expected a directory path"); return; }
      SparkProfilerStop(directory, SparkProfilerSettle(resolve, reject));
    }
    else if ([method isEqual:@"isProfiling"]) resolve(SparkProfilerRecording() ? @"true" : @"false");
#endif
    else SparkInvalid(reject, @"Unknown app operation");
  });
}
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeDesktopAppSpecJSI>(params);
}
@end
