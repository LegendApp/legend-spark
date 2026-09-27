#import "RNDesktopApp.h"
#import "SparkDesktop.h"
@implementation RNDesktopApp { NSMutableSet<NSString *> *_guardIds; }
- (instancetype)init { if ((self = [super init])) _guardIds = [NSMutableSet new]; return self; }
RCT_EXPORT_MODULE(NativeDesktopApp)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (NSArray<NSString *> *)supportedEvents { return @[@"desktop"]; }
- (void)startObserving { [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(event:) name:SparkDesktopEvent object:nil]; }
- (void)stopObserving { [NSNotificationCenter.defaultCenter removeObserver:self]; }
- (void)event:(NSNotification *)note { [self sendEventWithName:@"desktop" body:note.userInfo]; }
- (void)invalidate { [self stopObserving]; dispatch_async(dispatch_get_main_queue(), ^{ for (NSString *identifier in self->_guardIds) SparkSetQuitGuard(identifier, NO); [self->_guardIds removeAllObjects]; }); [super invalidate]; }
- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSDictionary *args = SparkArgs(json);
    if ([method isEqual:@"context"]) resolve(SparkJSON(SparkContext()));
    else if ([method isEqual:@"initialURL"]) resolve(SparkJSON(SparkInitialURL()));
    else if ([method isEqual:@"pendingURLs"]) resolve(SparkJSON(SparkPendingURLs()));
    else if ([method isEqual:@"quit"]) {
      SparkObserveQuitDecision(^(BOOL allow) { resolve(SparkJSON(allow ? @{ @"quitRequested": @YES } : @{ @"quitRequested": @NO, @"reason": @"vetoed" })); });
      // AppKit can enter a modal run loop while awaiting the JS decision. Do
      // not hold the main GCD queue that must deliver that decision.
      [NSRunLoop.mainRunLoop performBlock:^{ [NSApp terminate:nil]; }]; }
    else if ([method isEqual:@"quitGuard"]) {
      NSString *identifier = args[@"id"];
      if (![identifier isKindOfClass:NSString.class] || !identifier.length) { SparkInvalid(reject, @"Expected quit guard ID"); return; }
      BOOL enabled = [args[@"enabled"] boolValue];
      if (enabled) [self->_guardIds addObject:identifier]; else [self->_guardIds removeObject:identifier];
      SparkSetQuitGuard(identifier, enabled); resolve(@"null");
    }
    else if ([method isEqual:@"replyQuit"]) { SparkReplyQuit(args[@"id"], [args[@"allow"] boolValue], [args[@"requestId"] unsignedIntegerValue]); resolve(@"null"); }
    else if ([method isEqual:@"hide"]) { [NSApp hide:nil]; resolve(@"null"); }
    else if ([method isEqual:@"activate"]) { [NSApp activateIgnoringOtherApps:YES]; resolve(@"null"); }
    else SparkInvalid(reject, @"Unknown app operation");
  });
}
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeDesktopAppSpecJSI>(params);
}
@end
