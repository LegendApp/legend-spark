#import <AppKit/AppKit.h>
#import <signal.h>
#import <sys/wait.h>
#import <fcntl.h>
#import <unistd.h>
static pid_t forkJob, newborn;
static int forkMarker;
// Fork after enumeration, just before the first hard kill: only a rescan can see the child.
static int KillWithFork(pid_t pid, int signal) {
  if (pid == forkJob && signal == SIGKILL) {
    forkJob = 0;
    if (kill(pid, SIGUSR1) != 0) { perror("request fork"); exit(1); }
    for (int attempt = 0; attempt < 100; attempt++) {
      if (pread(forkMarker, &newborn, sizeof(newborn), 0) == sizeof(newborn)) break;
      usleep(10000);
    }
    if (newborn <= 0) { fprintf(stderr, "FAIL background job did not fork during cleanup\n"); exit(1); }
  }
  return kill(pid, signal);
}
#define kill KillWithFork
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
#undef kill
static void ForkOnSignal(int signal) {
  pid_t child = fork();
  if (child == 0) { for (;;) pause(); }
  if (child > 0) pwrite(forkMarker, &child, sizeof(child), 0);
}
static void RunForkJob(const char *marker, BOOL ignoreTerm) {
  forkMarker = open(marker, O_WRONLY);
  if (forkMarker < 0) { perror("open fork marker"); exit(1); }
  signal(SIGHUP, SIG_IGN);
  if (ignoreTerm) signal(SIGTERM, SIG_IGN);
  pid_t child = fork();
  if (child == 0) {
    setpgid(0, 0);
    signal(SIGTERM, SIG_IGN);
    signal(SIGUSR1, ForkOnSignal);
    printf("job %d.\n", getpid()); fflush(stdout);
    for (;;) pause();
  }
  while (waitpid(child, NULL, 0) < 0 && errno == EINTR) {}
  exit(0);
}
static RNDesktopProcesses *module;
static int stage = 0;
static NSMutableData *streamed;
static BOOL resized, interrupted, reopened;
static pid_t job;
static char markerPath[] = "/tmp/spark-process-fork-XXXXXX";
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
  } else if (stage == 10 || stage == 11) {
    // Ctrl+V quotes the final newline; it does not complete a canonical input line.
    NSData *input = [@"partial\x16\n" dataUsingEncoding:NSUTF8StringEncoding];
    if (stage == 11) input = [@"partial\x16" dataUsingEncoding:NSUTF8StringEncoding];
    Call(@"spawn", @{ @"id": key, @"executable": @"/bin/cat", @"bytes": input, @"pty": @{ @"cols": @80, @"rows": @24 }, @"captureLimitBytes": @4096 }, ^(id value) {
      if (stage == 11) Call(@"write", @{ @"id": key, @"bytes": [@"\n" dataUsingEncoding:NSUTF8StringEncoding] }, ^(id value) { Call(@"closeInput", @{ @"id": key }, nil); });
      else Call(@"closeInput", @{ @"id": key }, nil);
    });
  } else if (stage == 12 || stage == 13) {
    // Exercise root-exit cleanup and escalation with a fork inside the kill sweep.
    streamed = [NSMutableData new]; job = 0; newborn = 0;
    strcpy(markerPath, "/tmp/spark-process-fork-XXXXXX");
    forkMarker = mkstemp(markerPath);
    Check(forkMarker >= 0, @"create fork marker");
    Call(@"spawn", @{ @"id": key, @"executable": NSProcessInfo.processInfo.arguments[0], @"args": @[@"--fork-job", [NSString stringWithUTF8String:markerPath], stage == 13 ? @"ignore-term" : @"exit-on-term"], @"pty": @{ @"cols": @80, @"rows": @24 }, @"captureLimitBytes": @4096, @"streamOutput": @YES }, nil);
  } else { puts("Process native checks passed"); exit(0); }
}
int main(int argc, char **argv) { @autoreleasepool {
  if (argc > 1 && strcmp(argv[1], "--fork-job") == 0) RunForkJob(argv[2], strcmp(argv[3], "ignore-term") == 0);
  module = [RNDesktopProcesses new];
  module.binaryEvent = ^(NSDictionary *event, dispatch_block_t delivered) {
    if (delivered) delivered();
    if ([event[@"type"] isEqual:@"processOutput"]) {
      [streamed appendData:event[@"bytes"]];
      NSString *key = [NSString stringWithFormat:@"native-%d", stage];
      if (stage == 6 && !resized && Streamed(@"40 120")) { resized = YES; Call(@"resize", @{ @"id": key, @"cols": @200, @"rows": @50 }, nil); }
      if (stage == 6 && !interrupted && Streamed(@"50 200")) { interrupted = YES; Call(@"write", @{ @"id": key, @"bytes": [NSData dataWithBytes:"\x03" length:1] }, nil); }
      if (stage == 8 && !reopened && Streamed(@"ready")) { reopened = YES; Call(@"closeInput", @{ @"id": key }, ^(id value) { Call(@"resize", @{ @"id": key, @"cols": @100, @"rows": @30 }, nil); }); }
      if ((stage == 12 || stage == 13) && !job && Streamed(@".")) {
        NSString *text = [[NSString alloc] initWithData:streamed encoding:NSUTF8StringEncoding];
        job = [[text substringFromIndex:NSMaxRange([text rangeOfString:@"job "])] intValue];
        forkJob = job;
        if (stage == 12) kill(module.processes[key].pid, SIGTERM);
        else Call(@"terminate", @{ @"id": key }, nil);
      }
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
    else if (stage == 7 || stage == 10 || stage == 11) Check([result[@"exitCode"] intValue] == 0 && [[[NSString alloc] initWithData:result[@"stdout"] encoding:NSUTF8StringEncoding] containsString:@"partial"], [NSString stringWithFormat:@"pty EOF after partial line: %@", result]);
    else if (stage == 8) Check([result[@"exitCode"] intValue] == 4, [NSString stringWithFormat:@"pty resize after closeInput: %@", result]);
    else if (stage == 9 || stage == 12 || stage == 13) {
      // The orphaned job is reaped asynchronously after SIGKILL.
      for (int attempt = 0; attempt < 100 && kill(job, 0) == 0; attempt++) usleep(10000);
      BOOL alive = kill(job, 0) == 0; if (alive) kill(job, SIGKILL);
      Check(job > 0 && !alive, [NSString stringWithFormat:@"pty background job %d outlived termination", job]);
      if (stage == 12 || stage == 13) {
        for (int attempt = 0; attempt < 100 && kill(newborn, 0) == 0; attempt++) usleep(10000);
        BOOL childAlive = kill(newborn, 0) == 0; if (childAlive) kill(newborn, SIGKILL);
        close(forkMarker); unlink(markerPath);
        Check(newborn > 0 && !childAlive, [NSString stringWithFormat:@"pty child %d forked during cleanup outlived termination", newborn]);
        Check([result[@"terminationSignal"] intValue] == (stage == 12 ? SIGTERM : SIGKILL), @"root-exit cleanup and escalation");
      }
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
