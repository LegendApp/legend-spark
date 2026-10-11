#import "RNSparkTextServices.h"
#import "SparkTextServices.h"
#import <React/RCTBridgeModule.h>

/** Every method runs on the main queue, where the text views live. */
@implementation RNSparkTextServices {
  BOOL _writingToolsAvailable;
}
@synthesize viewRegistry_DEPRECATED = _viewRegistry_DEPRECATED;
RCT_EXPORT_MODULE(NativeSparkTextServices)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (instancetype)init
{
  if (self = [super init]) _writingToolsAvailable = SparkWritingToolsAvailable();
  return self;
}

- (NSNumber *)isWritingToolsAvailable { return @(_writingToolsAvailable); }

/** The text view inside the mounted view `tag`, or nil after rejecting. */
- (NSTextView *)textView:(double)tag reject:(RCTPromiseRejectBlock)reject
{
  NSView *view = (NSView *)[self.viewRegistry_DEPRECATED viewForReactTag:@((NSInteger)tag)];
  if (!view) { reject(@"E_NOT_FOUND", @"The text services target is not mounted", nil); return nil; }
  NSTextView *textView = SparkTextServicesTextView(view);
  if (!textView) reject(@"E_INVALID_ARGUMENT", @"The text services target has no text view; use a multiline TextInput or selectable Text", nil);
  return textView;
}

- (void)findText:(double)tag query:(NSString *)query caseSensitive:(BOOL)caseSensitive wrap:(BOOL)wrap backwards:(BOOL)backwards resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  NSTextView *textView = [self textView:tag reject:reject];
  if (!textView) return;
  const SparkTextFindResult result = SparkTextFind(textView, query, caseSensitive, wrap, backwards);
  resolve([NSString stringWithFormat:@"{\"matchCount\":%lu,\"matchIndex\":%lu}", (unsigned long)result.matchCount, (unsigned long)result.matchIndex]);
}

- (void)showFindBar:(double)tag resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  NSTextView *textView = [self textView:tag reject:reject];
  if (!textView) return;
  if (SparkTextShowFindBar(textView)) resolve(nil);
  else reject(@"E_UNSUPPORTED_OPTION", @"The text view has no find bar; use a multiline TextInput", nil);
}

- (void)lookUp:(double)tag resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  NSTextView *textView = [self textView:tag reject:reject];
  if (!textView) return;
  if (!textView.string.length) { reject(@"E_INVALID_ARGUMENT", @"The text view has no text to look up", nil); return; }
  SparkTextLookUp(textView);
  resolve(nil);
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeSparkTextServicesSpecJSI>(params);
}
@end
