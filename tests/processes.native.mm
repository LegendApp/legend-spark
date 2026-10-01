#import <AppKit/AppKit.h>
#define RCT_EXPORT_MODULE(...)
typedef void (^RCTPromiseResolveBlock)(id);
typedef void (^RCTPromiseRejectBlock)(NSString *, NSString *, NSError *);
static void (^onEvent)(NSDictionary *);
static NSDictionary *SparkArgs(NSString *json) { return [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:NSJSONReadingFragmentsAllowed error:nil]; }
static NSString *SparkJSON(id value) { return [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingFragmentsAllowed error:nil] encoding:NSUTF8StringEncoding]; }
static void SparkEmit(NSDictionary *event) { if (onEvent) onEvent(event); }
static void SparkInvalid(RCTPromiseRejectBlock reject, NSString *message) { reject(@"E_INVALID_ARGUMENT", message, nil); }
static void SparkReject(RCTPromiseRejectBlock reject, NSError *error) { reject(@"E_NATIVE", error.localizedDescription, error); }
@interface RNDesktopProcesses : NSObject
- (void)call:(NSString *)method args:(NSString *)json resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject;
@end
// IMPLEMENTATION HERE
static RNDesktopProcesses *module;
static int stage = 0;
static NSMutableData *streamed;
static void Check(BOOL value, NSString *message) { if (!value) { NSLog(@"FAIL %@", message); exit(1); } }
static void Call(NSString *method, NSDictionary *args, void (^done)(id)) {
  NSMutableDictionary *metadata = [args mutableCopy]; NSData *bytes = metadata[@"bytes"]; [metadata removeObjectForKey:@"bytes"];
  [module binaryCall:method args:SparkJSON(metadata) bytes:bytes resolve:done ?: ^(id value) {} reject:^(NSString *code, NSString *message, NSError *error) { NSLog(@"FAIL %@ %@", code, message); exit(1); }];
}
static void Next() {
  NSString *key = [NSString stringWithFormat:@"native-%d", ++stage];
  if (stage == 1) {
    streamed = [NSMutableData new];
    Call(@"spawn", @{ @"id": key, @"executable": @"/bin/cat", @"bytes": [NSData dataWithBytes:(uint8_t[]){0,255,1} length:3], @"captureLimitBytes": @2, @"streamOutput": @YES }, ^(id value) {
      Call(@"write", @{ @"id": key, @"bytes": [NSData dataWithBytes:(uint8_t[]){2} length:1] }, ^(id value) { Call(@"closeInput", @{ @"id": key }, ^(id value) { Call(@"closeInput", @{ @"id": key }, nil); }); });
    });
  } else if (stage == 2) {
    Call(@"spawn", @{ @"id": key, @"executable": @"/bin/sh", @"args": @[@"-c", @"printf error >&2; exit 7"], @"captureLimitBytes": @100 }, nil);
  } else if (stage == 3) {
    Call(@"spawn", @{ @"id": key, @"executable": @"/bin/sleep", @"args": @[@"30"], @"timeoutMs": @30, @"captureLimitBytes": @0 }, nil);
  } else if (stage == 4) {
    Call(@"spawn", @{ @"id": key, @"executable": @"/bin/sleep", @"args": @[@"30"], @"captureLimitBytes": @0 }, ^(id value) { Call(@"terminate", @{ @"id": key }, nil); });
  } else if (stage == 5) {
    // Root exit must kill descendants holding pipe handles, or completion hangs.
    Call(@"spawn", @{ @"id": key, @"executable": @"/bin/sh", @"args": @[@"-c", @"sleep 30 & exit 0"], @"captureLimitBytes": @0 }, nil);
  } else { puts("Process native checks passed"); exit(0); }
}
int main() { @autoreleasepool {
  module = [RNDesktopProcesses new];
  module.binaryEvent = ^(NSDictionary *event, dispatch_block_t delivered) {
    if (delivered) delivered();
    if ([event[@"type"] isEqual:@"processOutput"]) { [streamed appendData:event[@"bytes"]]; return; }
    if (![event[@"type"] isEqual:@"processExit"]) return;
    NSDictionary *result = event[@"result"];
    if (stage == 1) {
      Check([result[@"stdout"] isEqual:[NSData dataWithBytes:(uint8_t[]){0,255} length:2]] && [result[@"outputTruncated"] boolValue], @"binary capture cap");
      Check([[streamed base64EncodedStringWithOptions:0] isEqual:@"AP8BAg=="], @"initial and incremental binary input ordering");
      Check(![result[@"terminated"] boolValue] && [result[@"exitCode"] intValue] == 0, @"ordinary completion");
    } else if (stage == 2) {
      Check([result[@"exitCode"] intValue] == 7 && [result[@"stderr"] isEqual:[@"error" dataUsingEncoding:NSUTF8StringEncoding]], @"nonzero status and stderr");
      Check(result[@"terminationSignal"] == NSNull.null, @"no fabricated signal");
    } else if (stage == 3 || stage == 4) {
      Check([result[@"terminated"] boolValue] && [result[@"terminationSignal"] intValue] == SIGTERM, [NSString stringWithFormat:@"termination signal at stage %d: %@", stage, result]);
      Check([result[@"timedOut"] boolValue] == (stage == 3), @"timeout distinction");
    } else Check(![result[@"terminated"] boolValue] && [result[@"exitCode"] intValue] == 0, @"descendant cleanup");
    Next();
  };
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ NSLog(@"FAIL process fixture timed out"); exit(1); });
  Call(@"resolveCommand", @{ @"command": @"cat" }, ^(id path) {
    Check([path isKindOfClass:NSString.class] && [path hasSuffix:@"/cat"], @"PATH command resolution"); Next();
  });
  dispatch_main();
} }
