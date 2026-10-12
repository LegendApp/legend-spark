// Drives the real crash reporter (packages/diagnostics/macos/SparkCrashReporter.mm). Every crash happens in a
// child copy of this binary, never in the test process: `crash <kind> <directory> [flags]` installs the handlers
// and crashes; the parent checks how the child died and the report its record became.
// `report <directory>` prints the reports as JSON (tests/crash-reporting-native.test.ts reads it after stripping).
#import <Foundation/Foundation.h>
#import "SparkCrashReporter.h"
#import <pthread.h>
#import <signal.h>
#import <spawn.h>
#import <sys/wait.h>
#import <vector>

extern char **environ;
static int failures = 0;
#define CHECK(...) do { if (!(__VA_ARGS__)) { fprintf(stderr, "FAILED line %d: %s\n", __LINE__, #__VA_ARGS__); failures++; } } while (0)

// A visible frame between main and the crash.
extern "C" __attribute__((noinline, disable_tail_calls)) void SparkTestCrash(const char *kind) {
  SparkCrashNow(kind);
  __asm__ volatile("");
}
// Recurses until the stack runs out; the handler runs on its alternate stack.
static volatile int recursing = 1;
extern "C" __attribute__((noinline)) int SparkTestRecurse(int depth) {
  volatile char padding[256];
  padding[0] = (char)depth;
  return recursing ? SparkTestRecurse(depth + 1) + padding[0] : 0;
}
static void *CrashOnThread(void *kind) { SparkTestCrash((const char *)kind); return NULL; }

// A handler installed before Spark's: it marks that it ran, then lets the signal end the process.
static char previousMarker[PATH_MAX];
static void PreviousHandler(int signal) {
  int fd = open(previousMarker, O_WRONLY | O_CREAT | O_TRUNC, 0600);
  if (fd >= 0) { write(fd, "previous", 8); close(fd); }
  struct sigaction action = {};
  action.sa_handler = SIG_DFL;
  sigaction(signal, &action, NULL);
  if (signal == SIGABRT) raise(signal);
}

static int Child(const char *kind, NSString *directory, NSString *flags) {
  if ([flags containsString:@"previous"]) {
    snprintf(previousMarker, sizeof previousMarker, "%s/previous-handler", directory.fileSystemRepresentation);
    struct sigaction action = {};
    action.sa_handler = PreviousHandler;
    sigaction(SIGSEGV, &action, NULL);
    sigaction(SIGABRT, &action, NULL);
  }
  SparkInstallCrashHandlers(directory);
  SparkInstallCrashHandlers(@"/nonexistent"); // A second install does nothing.
  SparkSetCrashRecording(![flags containsString:@"disabled"]);
  if (!strcmp(kind, "stackOverflow")) return SparkTestRecurse(0);
  if (!strcmp(kind, "thread")) {
    pthread_t thread;
    pthread_create(&thread, NULL, CrashOnThread, (void *)"badAccess");
    pthread_join(thread, NULL);
  }
  SparkTestCrash(kind);
  return 0;
}

// Runs a child copy of this binary; returns its wait status and pid.
static int Run(NSArray<NSString *> *arguments, pid_t *pidOut) {
  std::vector<char *> argv = { (char *)NSProcessInfo.processInfo.arguments[0].fileSystemRepresentation };
  for (NSString *argument in arguments) argv.push_back((char *)argument.UTF8String);
  argv.push_back(NULL);
  // The child's own output (the runtime's uncaught exception message) is not the test's.
  posix_spawn_file_actions_t actions;
  posix_spawn_file_actions_init(&actions);
  posix_spawn_file_actions_addopen(&actions, 1, "/dev/null", O_WRONLY, 0);
  posix_spawn_file_actions_addopen(&actions, 2, "/dev/null", O_WRONLY, 0);
  pid_t pid;
  int failed = posix_spawn(&pid, argv[0], &actions, NULL, argv.data(), environ);
  posix_spawn_file_actions_destroy(&actions);
  if (failed) return -1;
  int status = 0;
  waitpid(pid, &status, 0);
  if (pidOut) *pidOut = pid;
  return status;
}

static NSDictionary *OnlyReport(NSString *directory) {
  NSError *error = nil;
  NSArray *reports = SparkCrashReports(directory, &error);
  CHECK(reports.count == 1);
  return reports.firstObject;
}
static BOOL HasSymbol(NSDictionary *report, NSString *symbol) {
  for (NSDictionary *frame in report[@"stack"]) if ([frame[@"symbol"] isEqual:symbol]) return YES;
  return NO;
}
static BOOL Located(NSDictionary *report) {
  for (NSDictionary *frame in report[@"stack"]) if (!frame[@"image"] || !frame[@"imageOffset"] || !frame[@"imageUUID"]) return NO;
  return [report[@"stack"] count] > 0;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc >= 4 && !strcmp(argv[1], "crash")) return Child(argv[2], @(argv[3]), argc > 4 ? @(argv[4]) : @"");
    if (argc == 3 && !strcmp(argv[1], "report")) {
      NSArray *reports = SparkCrashReports(@(argv[2]), nil);
      printf("%s\n", [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:reports options:0 error:nil] encoding:NSUTF8StringEncoding].UTF8String);
      return 0;
    }
    if (argc != 2) { fprintf(stderr, "usage: %s <directory>\n", argv[0]); return 2; }
    NSString *root = @(argv[1]);
    NSMutableArray<NSNumber *> *chained = [NSMutableArray new];

    // Each crash: how the child died (the default action of the original signal, so the system crash
    // reporter and a debugger see the real crash) and the report its record became.
    struct Case { const char *kind; int signal; NSString *symbol; };
    const Case cases[] = {
      { "badAccess", SIGSEGV, @"SparkCrashNow" },
      { "abort", SIGABRT, @"SparkCrashNow" },
      { "uncaughtException", SIGABRT, @"SparkCrashNow" },
#if defined(__arm64__)
      { "trap", SIGTRAP, @"SparkCrashNow" },
#else
      { "trap", SIGILL, @"SparkCrashNow" },
#endif
      { "stackOverflow", SIGSEGV, @"SparkTestRecurse" },
      { "thread", SIGSEGV, @"SparkCrashNow" },
    };
    for (const Case &test : cases) {
      NSString *directory = [root stringByAppendingPathComponent:@(test.kind)];
      pid_t pid;
      int status = Run(@[@"crash", @(test.kind), directory], &pid);
      [chained addObject:@(pid)];
      CHECK(WIFSIGNALED(status) && WTERMSIG(status) == test.signal);
      NSDictionary *report = OnlyReport(directory);
      CHECK([report[@"kind"] isEqual:@"native"]);
      CHECK([report[@"id"] hasSuffix:[NSString stringWithFormat:@"-%d", pid]]);
      CHECK([report[@"signal"] isEqual:[@[@"", @"", @"", @"", @"SIGILL", @"SIGTRAP", @"SIGABRT", @"", @"SIGFPE", @"", @"SIGBUS", @"SIGSEGV"] objectAtIndex:test.signal]]);
      CHECK([report[@"simulated"] isEqual:@NO]);
      CHECK([report[@"createdAt"] doubleValue] > NSDate.date.timeIntervalSince1970 * 1000 - 60000);
      CHECK([report[@"mainThread"] isEqual:@(strcmp(test.kind, "thread") != 0)]);
      CHECK(HasSymbol(report, test.symbol));
      CHECK(Located(report));
      if (!HasSymbol(report, test.symbol) || !Located(report)) NSLog(@"%s: %@", test.kind, report);
      if (strcmp(test.kind, "stackOverflow") && strcmp(test.kind, "thread")) CHECK(HasSymbol(report, @"SparkTestCrash") && HasSymbol(report, @"main"));
      if (test.signal == SIGSEGV && strcmp(test.kind, "stackOverflow")) CHECK([report[@"faultAddress"] isEqual:@"0x0"]);
      if (!strcmp(test.kind, "uncaughtException")) CHECK([report[@"exception"] isEqual:(@{ @"name": @"SparkSimulatedException", @"reason": @"A simulated uncaught exception" })]);
      else CHECK(report[@"exception"] == nil);
      // The record became the report.
      CHECK([[NSFileManager.defaultManager contentsOfDirectoryAtPath:directory error:nil] isEqual:@[[report[@"id"] stringByAppendingPathExtension:@"json"]]]);
    }

    // A handler that was there first still runs, after the record is written, and the process still dies of the signal.
    for (NSString *kind in @[@"badAccess", @"abort"]) {
      NSString *directory = [root stringByAppendingPathComponent:[@"previous-" stringByAppendingString:kind]];
      pid_t pid;
      int status = Run(@[@"crash", kind, directory, @"previous"], &pid);
      [chained addObject:@(pid)];
      CHECK(WIFSIGNALED(status) && WTERMSIG(status) == ([kind isEqual:@"abort"] ? SIGABRT : SIGSEGV));
      CHECK([[NSString stringWithContentsOfFile:[directory stringByAppendingPathComponent:@"previous-handler"] encoding:NSUTF8StringEncoding error:nil] isEqual:@"previous"]);
      NSArray *reports = SparkCrashReports(directory, nil);
      CHECK(reports.count == 1 && HasSymbol(reports.firstObject, @"SparkCrashNow"));
    }

    // Without consent the handlers only pass the signal on: no record.
    {
      NSString *directory = [root stringByAppendingPathComponent:@"disabled"];
      pid_t pid;
      int status = Run(@[@"crash", @"badAccess", directory, @"disabled"], &pid);
      [chained addObject:@(pid)];
      CHECK(WIFSIGNALED(status) && WTERMSIG(status) == SIGSEGV);
      CHECK([SparkCrashReports(directory, nil) count] == 0);
    }

    // simulateCrash: a helper started from this executable crashes and exits once it has recorded.
    NSMutableArray<NSString *> *simulated = [NSMutableArray new];
    {
      NSString *directory = [root stringByAppendingPathComponent:@"simulated"];
      for (NSString *kind in @[@"badAccess", @"uncaughtException", @"stackOverflow"]) {
        NSError *error = nil;
        NSDictionary *report = SparkSimulateCrash(directory, kind, &error);
        CHECK(report && !error);
        CHECK([report[@"simulated"] isEqual:@YES]);
        // A stack overflow's innermost 128 frames are all the recursion.
        CHECK(HasSymbol(report, [kind isEqual:@"stackOverflow"] ? @"SparkCrashRecurse" : @"SparkCrashNow") && Located(report));
        CHECK([report[@"signal"] isEqual:[kind isEqual:@"uncaughtException"] ? @"SIGABRT" : @"SIGSEGV"]);
        if ([kind isEqual:@"uncaughtException"]) CHECK([report[@"exception"][@"name"] isEqual:@"SparkSimulatedException"]);
        [simulated addObject:[report[@"id"] componentsSeparatedByString:@"-"].lastObject];
      }
      NSError *error = nil;
      CHECK(SparkSimulateCrash(directory, @"unknown", &error) == nil && [error.userInfo[SparkCrashCodeKey] isEqual:@"E_NATIVE"]);
      error = nil;

      // JavaScript errors are written at once; reports list newest first and delete by id or all at once.
      NSString *identifier = SparkRecordJavaScriptCrash(directory, @{ @"source": @"uncaughtError", @"fatal": @YES, @"name": @"TypeError", @"message": @"x is undefined", @"stack": @"at f (app.js:1:2)" }, &error);
      CHECK(identifier && !error);
      NSArray *reports = SparkCrashReports(directory, &error);
      CHECK(reports.count == 4);
      CHECK([reports.firstObject[@"id"] isEqual:identifier]);
      CHECK([reports.firstObject[@"kind"] isEqual:@"javascript"] && [reports.firstObject[@"message"] isEqual:@"x is undefined"] && [reports.firstObject[@"fatal"] isEqual:@YES]);
      CHECK([reports.firstObject[@"app"] isEqual:(@{ @"version": NSNull.null, @"build": NSNull.null })]);
      CHECK([reports[1][@"createdAt"] doubleValue] >= [reports[2][@"createdAt"] doubleValue]);
      CHECK(SparkDeleteCrashReports(directory, @[identifier, @"0-1"], &error));
      CHECK([SparkCrashReports(directory, nil) count] == 3);
      CHECK(!SparkDeleteCrashReports(directory, @[@"../escape"], &error) && [error.userInfo[SparkCrashCodeKey] isEqual:@"E_INVALID_ARGUMENT"]);
      CHECK(SparkDeleteCrashReports(directory, nil, &error));
      CHECK([SparkCrashReports(directory, nil) count] == 0);
    }

    // A record whose process still runs is still being written: it is left for later.
    {
      NSString *directory = [root stringByAppendingPathComponent:@"running"];
      [NSFileManager.defaultManager createDirectoryAtPath:directory withIntermediateDirectories:YES attributes:nil error:nil];
      NSString *record = [directory stringByAppendingPathComponent:[NSString stringWithFormat:@"1-%d.sparkcrash", getppid()]];
      [@"spark-crash 1\ntime 1\nsignal 11 1 0x0\n" writeToFile:record atomically:YES encoding:NSUTF8StringEncoding error:nil];
      CHECK([SparkCrashReports(directory, nil) count] == 0);
      CHECK([NSFileManager.defaultManager fileExistsAtPath:record]);
    }

    printf("chained pids: %s\n", [chained componentsJoinedByString:@" "].UTF8String);
    printf("simulated pids: %s\n", [simulated componentsJoinedByString:@" "].UTF8String);
  }
  if (failures) { fprintf(stderr, "%d crash reporting check(s) failed\n", failures); return 1; }
  printf("Crash reporting native tests passed\n");
  return 0;
}
