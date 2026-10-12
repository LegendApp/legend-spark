#import "SparkHangWatchdog.h"
#import "SparkStack.h"
#import <mach/mach.h>
#import <pthread.h>
#import <stdatomic.h>
#import <time.h>

// Reads the suspended thread's registers and walks its stack. Only Mach calls into the caller's buffer:
// anything that allocates or takes a lock could wait forever on the suspended thread.
static size_t Backtrace(thread_t thread, uintptr_t *frames, size_t capacity, size_t *linkFrame) {
#if defined(__arm64__)
  arm_thread_state64_t state;
  mach_msg_type_number_t count = ARM_THREAD_STATE64_COUNT;
  if (thread_get_state(thread, ARM_THREAD_STATE64, (thread_state_t)&state, &count) != KERN_SUCCESS) return 0;
  return SparkWalkStack(arm_thread_state64_get_pc(state), arm_thread_state64_get_fp(state), arm_thread_state64_get_lr(state), frames, capacity, linkFrame);
#elif defined(__x86_64__)
  x86_thread_state64_t state;
  mach_msg_type_number_t count = x86_THREAD_STATE64_COUNT;
  if (thread_get_state(thread, x86_THREAD_STATE64, (thread_state_t)&state, &count) != KERN_SUCCESS) return 0;
  return SparkWalkStack(state.__rip, state.__rbp, 0, frames, capacity, linkFrame);
#else
#error Unsupported architecture
#endif
}

#ifdef SPARK_HANG_WATCHDOG_TEST_HOOKS
// Defined by tests/hang-watchdog.native.mm, the only build with the hooks: runs on the watchdog thread
// after each ping is sent and before it waits for the answer, so a test can make the thread wake late.
extern "C" void SparkHangWatchdogTestPinged(void);
#endif

@implementation SparkHangWatchdog {
  NSUInteger _thresholdMs;
  SparkHangHandler _handler;
  thread_t _mainThread;
  dispatch_semaphore_t _wake;
  atomic_bool _stopped;
}

- (instancetype)initWithThreshold:(NSUInteger)thresholdMs handler:(SparkHangHandler)handler {
  if (!(self = [super init])) return nil;
  // The thread to watch is the one creating the watchdog, so it must be the main thread.
  if (!NSThread.isMainThread) [NSException raise:NSInternalInconsistencyException format:@"SparkHangWatchdog must be created on the main thread"];
  _mainThread = pthread_mach_thread_np(pthread_self());
  _thresholdMs = thresholdMs;
  _handler = [handler copy];
  _wake = dispatch_semaphore_create(0);
  // The thread retains the watchdog until it exits.
  NSThread *thread = [[NSThread alloc] initWithTarget:self selector:@selector(watch) object:nil];
  thread.name = @"spark.hang-watchdog";
  thread.qualityOfService = NSQualityOfServiceUserInteractive;
  [thread start];
  return self;
}

- (void)stop {
  atomic_store(&_stopped, true);
  dispatch_semaphore_signal(_wake);
}

- (void)watch {
  const int64_t threshold = (int64_t)_thresholdMs * (int64_t)NSEC_PER_MSEC;
  while (!atomic_load(&_stopped)) @autoreleasepool {
    // A fresh semaphore per ping, so a late answer to an earlier ping can never answer this one.
    dispatch_semaphore_t answered = dispatch_semaphore_create(0);
    // Set by the main queue (0 until it answers), read here while the main thread is suspended and after the signal.
    __block uint64_t answeredAt = 0;
    uint64_t sent = clock_gettime_nsec_np(CLOCK_UPTIME_RAW), startedAt = clock_gettime_nsec_np(CLOCK_REALTIME);
    dispatch_async(dispatch_get_main_queue(), ^{
      __atomic_store_n(&answeredAt, clock_gettime_nsec_np(CLOCK_UPTIME_RAW), __ATOMIC_RELEASE);
#ifdef SPARK_HANG_WATCHDOG_TEST_SIGNAL_DELAY_MS // tests/hang-watchdog.native.mm: the answer reaches the watchdog late.
      usleep(SPARK_HANG_WATCHDOG_TEST_SIGNAL_DELAY_MS * 1000);
#endif
      dispatch_semaphore_signal(answered);
    });
#ifdef SPARK_HANG_WATCHDOG_TEST_HOOKS
    SparkHangWatchdogTestPinged();
#endif
    // Sampled while the hang is under way; nil when the hang was over before this thread looked (it can run late).
    NSArray *stack = nil;
    if (dispatch_semaphore_wait(answered, dispatch_time(DISPATCH_TIME_NOW, threshold))) {
      uintptr_t frames[SparkMaxFrames];
      size_t count = 0, linkFrame = SIZE_MAX;
      bool over = false;
      if (thread_suspend(_mainThread) == KERN_SUCCESS) {
        // Answered between the timeout and the suspension: the stack would show the main thread after the hang.
        over = __atomic_load_n(&answeredAt, __ATOMIC_ACQUIRE) != 0;
        if (!over) count = Backtrace(_mainThread, frames, SparkMaxFrames, &linkFrame);
        thread_resume(_mainThread);
      }
      if (!over) stack = SparkSymbolicate(frames, count, linkFrame);
      while (dispatch_semaphore_wait(answered, dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC)))
        if (atomic_load(&_stopped)) return;
    }
    // The round trip alone decides, however late the answer reached this thread or this thread woke:
    // a ping answered within the threshold is not a hang, and one answered later is, once.
    uint64_t roundTrip = __atomic_load_n(&answeredAt, __ATOMIC_ACQUIRE) - sent;
    if (roundTrip >= (uint64_t)threshold) {
      NSDictionary *report = @{
        @"durationMs": @((double)roundTrip / NSEC_PER_MSEC),
        @"thresholdMs": @(_thresholdMs),
        @"startedAt": @((double)startedAt / NSEC_PER_MSEC),
        @"stack": stack ?: @[],
        @"endedBeforeSampling": @(stack == nil),
      };
      dispatch_async(dispatch_get_main_queue(), ^{ if (!atomic_load(&self->_stopped)) self->_handler(report); });
    }
    // Ping again after half the threshold: a hang longer than 1.5 x the threshold is normally caught
    // (the watchdog thread itself can be scheduled late on a loaded machine).
    dispatch_semaphore_wait(_wake, dispatch_time(DISPATCH_TIME_NOW, threshold / 2));
  }
}
@end

// Kept out of tail position so the simulated hang names itself in the reported stack.
__attribute__((disable_tail_calls)) BOOL SparkSimulateHang(NSUInteger milliseconds) {
#if SPARK_TEST_DRIVER
  usleep((useconds_t)milliseconds * 1000);
  return YES;
#else
  return NO;
#endif
}
