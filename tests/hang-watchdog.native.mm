// Drives the real SparkHangWatchdog (packages/diagnostics/macos) against this process's main thread:
// real hangs are reported once the main thread recovers, with durations and a symbolicated stack;
// short stalls are not; stop ends reporting and the watchdog thread.
#import <Foundation/Foundation.h>
#import "SparkHangWatchdog.h"
#import <stdatomic.h>

static int failures = 0;
#define CHECK(...) do { if (!(__VA_ARGS__)) { fprintf(stderr, "FAILED line %d: %s\n", __LINE__, #__VA_ARGS__); failures++; } } while (0)

// Keeps a visible frame between main and the hang in the stack.
extern "C" __attribute__((noinline)) void SparkTestBlockMainThread(NSUInteger milliseconds) {
  SparkSimulateHang(milliseconds);
  __asm__ volatile("");
}

// A hang in a function that is not a leaf, spinning without calls after its last one: its link register
// still holds that call's return address, which points back into itself and is not its caller.
static atomic_bool spinning;
extern "C" __attribute__((noinline)) void SparkTestCalled(void) { __asm__ volatile(""); }
extern "C" __attribute__((noinline)) void SparkTestSpinAfterCall(void) {
  SparkTestCalled();
  while (atomic_load_explicit(&spinning, memory_order_relaxed)) {}
}

// Lets the main queue run (watchdog pings and report delivery) for `seconds`, or until `until` holds.
static void Spin(NSTimeInterval seconds, BOOL (^until)(void)) {
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:seconds];
  while ((!until || !until()) && deadline.timeIntervalSinceNow > 0)
    [NSRunLoop.mainRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
}

[[maybe_unused]] static BOOL HasSymbol(NSArray *stack, NSString *symbol) {
  for (NSDictionary *frame in stack) if ([frame[@"symbol"] isEqual:symbol]) return YES;
  return NO;
}

#ifdef SPARK_HANG_WATCHDOG_TEST_SIGNAL_DELAY_MS
// Built with every answer reaching the watchdog thread long after the threshold (it wakes late):
// pings the main thread answered in time are not hangs, and a real hang is still reported once.
int main(void) {
  @autoreleasepool {
    NSMutableArray<NSDictionary *> *reports = [NSMutableArray new];
    SparkHangWatchdog *watchdog = [[SparkHangWatchdog alloc] initWithThreshold:100 handler:^(NSDictionary *report) { [reports addObject:report]; }];
    Spin(1.5, nil);
    CHECK(reports.count == 0);
    SparkTestBlockMainThread(600);
    Spin(5, ^{ return (BOOL)(reports.count > 0); });
    Spin(1, nil);
    CHECK(reports.count == 1);
    CHECK([reports.firstObject[@"durationMs"] doubleValue] >= 100);
    [watchdog stop];
  }
  if (failures) { fprintf(stderr, "%d hang watchdog check(s) failed\n", failures); return 1; }
  printf("Hang watchdog late-wake tests passed\n");
  return 0;
}
#else
int main(void) {
  @autoreleasepool {
    NSMutableArray<NSDictionary *> *reports = [NSMutableArray new];
    __weak SparkHangWatchdog *released = nil;
    @autoreleasepool {
      SparkHangWatchdog *watchdog = [[SparkHangWatchdog alloc] initWithThreshold:100 handler:^(NSDictionary *report) {
        CHECK(NSThread.isMainThread);
        [reports addObject:report];
      }];
      released = watchdog;

      // A responsive main thread, and a stall shorter than the threshold, report nothing.
      Spin(0.4, nil);
      SparkTestBlockMainThread(30);
      Spin(0.3, nil);
      CHECK(reports.count == 0);

      double before = NSDate.date.timeIntervalSince1970 * 1000;
      SparkTestBlockMainThread(600);
      double after = NSDate.date.timeIntervalSince1970 * 1000;
      Spin(5, ^{ return (BOOL)(reports.count > 0); });
      CHECK(reports.count == 1);
      NSDictionary *report = reports.firstObject;
      double duration = [report[@"durationMs"] doubleValue], startedAt = [report[@"startedAt"] doubleValue];
      // Bounds that hold however late a loaded machine runs either thread: the unanswered ping went out
      // during the hang (50 ms of slack for one sent just before it) and at least a threshold before it
      // ended; the main thread answered once the hang was over, when it next ran its queue. 20 ms allows
      // for comparing the wall clock with the watchdog's uptime clock.
      CHECK(startedAt >= before - 50 && startedAt <= after - 100);
      CHECK(startedAt + duration >= after - 20 && startedAt + duration <= after + 1000);
      CHECK(duration >= 100);
      CHECK([report[@"thresholdMs"] isEqual:@100]);
      NSArray<NSDictionary *> *stack = report[@"stack"];
      CHECK(stack.count >= 4);
      for (NSDictionary *frame in stack) {
        CHECK([frame[@"address"] hasPrefix:@"0x"]);
        if (!frame[@"image"]) continue;
        CHECK([frame[@"imageAddress"] hasPrefix:@"0x"] && [frame[@"imageOffset"] unsignedLongLongValue] > 0);
        CHECK([frame[@"imageUUID"] length] == 36);
      }
      // Innermost first: the sleep system call in libsystem_kernel, then the frames that led to it.
      CHECK([stack.firstObject[@"image"] hasSuffix:@"/libsystem_kernel.dylib"]);
      CHECK(HasSymbol(stack, @"usleep"));
      CHECK(HasSymbol(stack, @"SparkSimulateHang"));
      CHECK(HasSymbol(stack, @"SparkTestBlockMainThread"));
      CHECK(HasSymbol(stack, @"main"));
      for (NSDictionary *frame in stack) fprintf(stdout, "  %s %s+%s %s\n", [frame[@"address"] UTF8String], [[frame[@"image"] lastPathComponent] UTF8String], [[frame[@"imageOffset"] description] UTF8String], [frame[@"symbol"] UTF8String] ?: "?");

      // A frame from a stale link register is left out: the spinning function appears once, called from main.
      // 1.5 s, so a watchdog thread that a loaded CI machine runs late still samples the spin.
      atomic_store(&spinning, true);
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 1500 * NSEC_PER_MSEC), dispatch_get_global_queue(QOS_CLASS_USER_INTERACTIVE, 0), ^{ atomic_store(&spinning, false); });
      SparkTestSpinAfterCall();
      Spin(5, ^{ return (BOOL)(reports.count > 1); });
      CHECK(reports.count == 2);
      NSArray<NSDictionary *> *spinStack = reports.lastObject[@"stack"];
      CHECK(spinStack.count >= 2 && [spinStack[0][@"symbol"] isEqual:@"SparkTestSpinAfterCall"] && [spinStack[1][@"symbol"] isEqual:@"main"]);
      [reports removeLastObject];

      // Back-to-back hangs are reported separately.
      SparkTestBlockMainThread(500);
      Spin(0.5, nil);
      SparkTestBlockMainThread(500);
      Spin(5, ^{ return (BOOL)(reports.count == 3); });
      CHECK(reports.count == 3);

      // After stop nothing is reported, even for a hang already under way.
      [watchdog stop];
      SparkTestBlockMainThread(400);
      Spin(0.5, nil);
      CHECK(reports.count == 3);
    }
    // The thread exits and releases the watchdog.
    Spin(1, ^{ return (BOOL)(released == nil); });
    CHECK(released == nil);

    // Two watchdogs with their own thresholds: the hang passes one and not the other.
    NSMutableArray *fast = [NSMutableArray new], *slow = [NSMutableArray new];
    SparkHangWatchdog *a = [[SparkHangWatchdog alloc] initWithThreshold:100 handler:^(NSDictionary *report) { [fast addObject:report]; }];
    SparkHangWatchdog *b = [[SparkHangWatchdog alloc] initWithThreshold:2000 handler:^(NSDictionary *report) { [slow addObject:report]; }];
    Spin(0.2, nil);
    SparkTestBlockMainThread(400);
    Spin(5, ^{ return (BOOL)(fast.count > 0); });
    CHECK(fast.count == 1 && slow.count == 0);
    [a stop]; [b stop];
  }
  if (failures) { fprintf(stderr, "%d hang watchdog check(s) failed\n", failures); return 1; }
  printf("Hang watchdog native tests passed\n");
  return 0;
}
#endif
