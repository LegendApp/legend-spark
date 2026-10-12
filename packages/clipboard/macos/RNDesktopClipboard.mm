#import "RNDesktopClipboard.h"
#import "SparkClipboard.h"
#import <RNDesktopApp/SparkBinaryJSI.h>
#import <RNDesktopApp/SparkDesktop.h>
#import <RNDesktopApp/SparkTestDriver.h>
#import <React/RCTInvalidating.h>

// The pasteboard the module works on: the general pasteboard, except in test driver mode, where it is a private named
// pasteboard so flows and captures never read or replace the user's clipboard (docs/clipboard.md#testing).
static NSPasteboard *testPasteboard;
static NSPasteboard *ModulePasteboard(void) { return testPasteboard ?: NSPasteboard.generalPasteboard; }

@interface RNDesktopClipboard () <SparkBinaryModule, RCTInvalidating>
@end
@implementation RNDesktopClipboard {
  SparkClipboard *_clipboard; // main thread
}
RCT_EXPORT_MODULE(NativeDesktopClipboard)
- (SparkClipboard *)clipboard {
  if (!_clipboard) _clipboard = [[SparkClipboard alloc] initWithPasteboard:ModulePasteboard() emit:^(NSDictionary *event) { SparkEmit(event); }];
  return _clipboard;
}
- (void)invalidate { dispatch_async(dispatch_get_main_queue(), ^{ [self->_clipboard invalidate]; }); }
- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject { [self perform:method args:SparkArgs(json) binary:NO resolve:resolve reject:reject]; }
- (void)binaryCall:(NSString *)method args:(NSString *)json bytes:(NSData *)bytes resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  NSMutableDictionary *args = [SparkArgs(json) mutableCopy];
  // The answer to a promised-data request, on the JavaScript thread: the main thread is waiting for it.
  if ([method isEqual:@"provide"]) {
    NSNumber *requestId = args[@"requestId"];
    SparkClipboard *clipboard = _clipboard;
    NSError *error = nil;
    if (![requestId isKindOfClass:NSNumber.class] || !clipboard) { SparkInvalid(reject, @"Expected a promised-data request"); return; }
    NSData *data = [args[@"text"] isKindOfClass:NSString.class] ? [args[@"text"] dataUsingEncoding:NSUTF8StringEncoding] : bytes;
    if ([clipboard answer:requestId.integerValue data:data error:&error]) resolve(NSNull.null);
    else reject(error.userInfo[@"code"], error.localizedDescription, nil);
    return;
  }
  if (bytes) args[@"imagePNG"] = bytes;
  [self perform:method args:args binary:YES resolve:resolve reject:reject];
}
- (void)perform:(NSString *)method args:(NSDictionary *)args binary:(BOOL)binary resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSError *error = nil;
    id value = [[self clipboard] perform:method args:args ?: @{} binary:binary error:&error];
    if (!value) { reject(error.userInfo[@"code"] ?: @"E_NATIVE", error.localizedDescription, nil); return; }
    resolve(binary ? value : SparkJSON(value));
  });
}
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<spark::binary::Module<facebook::react::NativeDesktopClipboardSpecJSI>>(params);
}
@end

#if SPARK_TEST_DRIVER
// Test driver: the module uses a private pasteboard from driver start, before any JavaScript runs. setTestClipboard
// writes it as another app would ({text?, html?, concealed?}); testClipboard reads it as another app's paste would,
// which makes the app provide promised data: {types, text, changeCount}. Neither touches the general pasteboard.
static NSDictionary *DriverFailure(NSString *message) { return @{ @"ok": @NO, @"error": @{ @"code": @"E_INVALID_ARGUMENT", @"message": message } }; }
@interface RNDesktopClipboardDriver : NSObject
@end
@implementation RNDesktopClipboardDriver
+ (void)load {
  SparkTestDriverObserveStart(^{
    testPasteboard = [NSPasteboard pasteboardWithUniqueName];
    [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationWillTerminateNotification object:nil queue:nil usingBlock:^(NSNotification *) { [testPasteboard releaseGlobally]; }];
  });
  SparkTestDriverRegisterCommand(@"setTestClipboard", ^(NSDictionary *request, SparkTestDriverReply reply) {
    if (!testPasteboard) { reply(DriverFailure(@"No test pasteboard")); return; }
    NSString *text = request[@"text"], *html = request[@"html"];
    id concealed = request[@"concealed"];
    if ((text && ![text isKindOfClass:NSString.class]) || (html && ![html isKindOfClass:NSString.class]) || (!text && !html)) { reply(DriverFailure(@"setTestClipboard expects text or html")); return; }
    if (concealed && CFGetTypeID((__bridge CFTypeRef)concealed) != CFBooleanGetTypeID()) { reply(DriverFailure(@"concealed must be a boolean")); return; }
    NSPasteboardItem *item = [NSPasteboardItem new];
    if (text) [item setString:text forType:NSPasteboardTypeString];
    if (html) [item setString:html forType:NSPasteboardTypeHTML];
    if ([concealed boolValue]) [item setData:[NSData data] forType:@"org.nspasteboard.ConcealedType"];
    [testPasteboard clearContents];
    if (![testPasteboard writeObjects:@[item]]) { reply(@{ @"ok": @NO, @"error": @{ @"code": @"E_NATIVE", @"message": @"Could not write the test pasteboard" } }); return; }
    reply(@{ @"ok": @YES, @"changeCount": @(testPasteboard.changeCount) });
  });
  SparkTestDriverRegisterCommand(@"testClipboard", ^(NSDictionary *, SparkTestDriverReply reply) {
    if (!testPasteboard) { reply(DriverFailure(@"No test pasteboard")); return; }
    reply(@{ @"ok": @YES, @"types": testPasteboard.types ?: @[], @"text": [testPasteboard stringForType:NSPasteboardTypeString] ?: NSNull.null,
      @"changeCount": @(testPasteboard.changeCount) });
  });
}
@end
#endif
