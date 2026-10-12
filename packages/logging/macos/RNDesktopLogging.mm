#import "RNDesktopLogging.h"
#import "SparkLogging.h"
#import <RNDesktopApp/SparkDesktop.h>

@implementation RNDesktopLogging {
  dispatch_queue_t _intake; // Hands calls to the log's own queue in the order JavaScript sent them.
  SparkLog *_log;
}
RCT_EXPORT_MODULE(NativeDesktopLogging)
+ (BOOL)requiresMainQueueSetup { return NO; }

- (instancetype)init
{
  if ((self = [super init])) {
    _intake = dispatch_queue_create("so.legend.spark.logging.intake", DISPATCH_QUEUE_SERIAL);
    NSString *identifier = NSBundle.mainBundle.bundleIdentifier ?: SparkContext()[@"projectId"];
    NSURL *library = [NSFileManager.defaultManager URLsForDirectory:NSLibraryDirectory inDomains:NSUserDomainMask].firstObject;
    _log = [[SparkLog alloc] initWithSubsystem:identifier directory:[library URLByAppendingPathComponent:[@"Logs" stringByAppendingPathComponent:identifier]].path];
    _log.failureHandler = ^(NSDictionary *event) {
      NSMutableDictionary *payload = [event mutableCopy];
      payload[@"type"] = @"loggingError";
      dispatch_async(dispatch_get_main_queue(), ^{ SparkEmit(payload); });
    };
  }
  return self;
}
- (dispatch_queue_t)methodQueue { return _intake; }

- (void)log:(double)time level:(NSString *)level category:(NSString *)category message:(NSString *)message fields:(NSString *)fields publicMessage:(BOOL)publicMessage
{
  [_log log:time level:level category:category message:message fields:fields publicMessage:publicMessage];
}

- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  NSDictionary *args = SparkArgs(json);
  SparkLog *log = _log;
  void (^failed)(NSError *) = ^(NSError *error) { reject(SparkLogErrorCode(error), error.localizedDescription, error); };
  [log perform:^{
    NSError *error = nil;
    if ([method isEqual:@"configure"]) {
      if ([log configure:args error:&error]) resolve(@"null");
      else failed(error);
    } else if ([method isEqual:@"flush"]) {
      if ((error = [log takeWriteError])) failed(error);
      else resolve(@"null");
    } else if ([method isEqual:@"files"]) {
      resolve(SparkJSON(log.files));
    } else if ([method isEqual:@"exportDiagnostics"]) {
      NSDictionary *result = [log exportDiagnosticsTo:args[@"path"] info:args[@"info"] error:&error];
      if (result) resolve(SparkJSON(result));
      else failed(error);
    } else SparkInvalid(reject, @"Unknown logging operation");
  }];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeDesktopLoggingSpecJSI>(params);
}
@end
