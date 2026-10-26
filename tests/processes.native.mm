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
static BOOL resized, interrupted, reopened;
static pid_t job;
static BOOL Streamed(NSString *text) { return [[[NSString alloc] initWithData:streamed encoding:NSUTF8StringEncoding] containsString:text]; }
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
  } else if (stage == 6) {
    // A terminal child sees its size, gets SIGWINCH on resize and SIGINT from a written Ctrl+C.
    streamed = [NSMutableData new];
    Call(@"spawn", @{ @"id": key, @"executable": @"/bin/sh", @"args": @[@"-c", @"trap 'stty size' WINCH; trap 'exit 3' INT; test -t 0 && test -t 2 && printf stderr-merged >&2 && stty size; while :; do sleep 0.05; done"], @"pty": @{ @"cols": @120, @"rows": @40 }, @"captureLimitBytes": @4096, @"streamOutput": @YES }, nil);
  } else if (stage == 7) {
    // runCommand sends initial input and closes input at once; an unterminated line must still reach EOF.
    Call(@"spawn", @{ @"id": key, @"executable": @"/bin/cat", @"bytes": [@"partial" dataUsingEncoding:NSUTF8StringEncoding], @"pty": @{ @"cols": @80, @"rows": @24 }, @"captureLimitBytes": @4096 }, ^(id value) { Call(@"closeInput", @{ @"id": key }, nil); });
  } else if (stage == 8) {
    // Closing input leaves the terminal resizable.
    streamed = [NSMutableData new];
    Call(@"spawn", @{ @"id": key, @"executable": @"/bin/sh", @"args": @[@"-c", @"trap 'exit 4' WINCH; echo ready; while :; do sleep 0.05; done"], @"pty": @{ @"cols": @80, @"rows": @24 }, @"captureLimitBytes": @4096, @"streamOutput": @YES }, nil);
  } else if (stage == 9) {
    // A job-control background job leads its own process group and announces itself once it ignores HUP and TERM.
    streamed = [NSMutableData new];
    Call(@"spawn", @{ @"id": key, @"executable": @"/bin/sh", @"args": @[@"-c", @"set -m; sh -c 'trap \"\" HUP TERM; echo \"job $$.\"; exec sleep 30' & wait"], @"pty": @{ @"cols": @80, @"rows": @24 }, @"captureLimitBytes": @4096, @"streamOutput": @YES }, nil);
  } else { puts("Process native checks passed"); exit(0); }
}
int main() { @autoreleasepool {
  module = [RNDesktopProcesses new];
  module.binaryEvent = ^(NSDictionary *event, dispatch_block_t delivered) {
    if (delivered) delivered();
    if ([event[@"type"] isEqual:@"processOutput"]) {
      [streamed appendData:event[@"bytes"]];
      NSString *key = [NSString stringWithFormat:@"native-%d", stage];
      if (stage == 6 && !resized && Streamed(@"40 120")) { resized = YES; Call(@"resize", @{ @"id": key, @"cols": @200, @"rows": @50 }, nil); }
      if (stage == 6 && !interrupted && Streamed(@"50 200")) { interrupted = YES; Call(@"write", @{ @"id": key, @"bytes": [NSData dataWithBytes:"\x03" length:1] }, nil); }
      if (stage == 8 && !reopened && Streamed(@"ready")) { reopened = YES; Call(@"closeInput", @{ @"id": key }, ^(id value) { Call(@"resize", @{ @"id": key, @"cols": @100, @"rows": @30 }, nil); }); }
      if (stage == 9 && !job && Streamed(@".")) { NSString *text = [[NSString alloc] initWithData:streamed encoding:NSUTF8StringEncoding]; job = [[text substringFromIndex:NSMaxRange([text rangeOfString:@"job "])] intValue]; Call(@"terminate", @{ @"id": key }, nil); }
      return;
    }
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
    } else if (stage == 5) Check(![result[@"terminated"] boolValue] && [result[@"exitCode"] intValue] == 0, @"descendant cleanup");
    else if (stage == 7) Check([result[@"exitCode"] intValue] == 0 && [[[NSString alloc] initWithData:result[@"stdout"] encoding:NSUTF8StringEncoding] containsString:@"partial"], [NSString stringWithFormat:@"pty EOF after partial line: %@", result]);
    else if (stage == 8) Check([result[@"exitCode"] intValue] == 4, [NSString stringWithFormat:@"pty resize after closeInput: %@", result]);
    else if (stage == 9) {
      // The orphaned job is reaped asynchronously after SIGKILL.
      for (int attempt = 0; attempt < 100 && kill(job, 0) == 0; attempt++) usleep(10000);
      BOOL alive = kill(job, 0) == 0; if (alive) kill(job, SIGKILL);
      Check(job > 0 && !alive, [NSString stringWithFormat:@"pty background job %d outlived termination", job]);
    } else {
      Check([result[@"exitCode"] intValue] == 3, [NSString stringWithFormat:@"pty interrupt exit: %@ %@", result, [[NSString alloc] initWithData:streamed encoding:NSUTF8StringEncoding]]);
      Check([[[NSString alloc] initWithData:result[@"stdout"] encoding:NSUTF8StringEncoding] containsString:@"50 200"] && Streamed(@"stderr-merged") && [result[@"stderr"] length] == 0, @"pty output, including stderr, is captured as stdout");
    }
    Next();
  };
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ NSLog(@"FAIL process fixture timed out"); exit(1); });
  Call(@"resolveCommand", @{ @"command": @"cat" }, ^(id path) {
    Check([path isKindOfClass:NSString.class] && [path hasSuffix:@"/cat"], @"PATH command resolution"); Next();
  });
  dispatch_main();
} }
