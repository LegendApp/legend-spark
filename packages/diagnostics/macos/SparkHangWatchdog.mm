#import "SparkHangWatchdog.h"
#import <dlfcn.h>
#import <mach-o/loader.h>
#import <mach/mach.h>
#import <pthread.h>
#import <stdatomic.h>
#import <time.h>

static const size_t kMaxFrames = 128;
#if defined(__arm64__)
// The user address space is 47 bits; higher bits of a saved return address carry its pointer-authentication code.
static const uintptr_t kAddressMask = 0x00007FFFFFFFFFFFULL;
#else
static const uintptr_t kAddressMask = UINTPTR_MAX;
#endif

static BOOL ReadMemory(uintptr_t address, void *buffer, size_t size) {
  vm_size_t read = 0;
  return vm_read_overwrite(mach_task_self(), address, size, (vm_address_t)buffer, &read) == KERN_SUCCESS && read == size;
}

// Runs while `thread` is suspended, so it only makes Mach calls and fills the caller's buffer:
// anything that allocates or takes a lock could wait forever on the suspended thread.
static size_t Backtrace(thread_t thread, uintptr_t *frames, size_t capacity) {
  uintptr_t pc, fp, lr = 0;
#if defined(__arm64__)
  arm_thread_state64_t state;
  mach_msg_type_number_t count = ARM_THREAD_STATE64_COUNT;
  if (thread_get_state(thread, ARM_THREAD_STATE64, (thread_state_t)&state, &count) != KERN_SUCCESS) return 0;
  pc = arm_thread_state64_get_pc(state); fp = arm_thread_state64_get_fp(state); lr = arm_thread_state64_get_lr(state) & kAddressMask;
#elif defined(__x86_64__)
  x86_thread_state64_t state;
  mach_msg_type_number_t count = x86_THREAD_STATE64_COUNT;
  if (thread_get_state(thread, x86_THREAD_STATE64, (thread_state_t)&state, &count) != KERN_SUCCESS) return 0;
  pc = state.__rip; fp = state.__rbp;
#else
#error Unsupported architecture
#endif
  size_t n = 0;
  frames[n++] = pc & kAddressMask;
  while (n < capacity && fp && !(fp % sizeof(uintptr_t))) {
    uintptr_t record[2]; // { caller's frame pointer, return address }
    if (!ReadMemory(fp, record, sizeof record)) break;
    uintptr_t returnAddress = record[1] & kAddressMask;
    // A leaf function (a system call stub, for one) pushes no frame: its caller is only in the link register.
    if (lr && n == 1 && lr != returnAddress) frames[n++] = lr;
    if (!returnAddress || n == capacity) break;
    frames[n++] = returnAddress;
    if (record[0] <= fp) break; // Frames move toward the stack base; anything else is corrupt.
    fp = record[0];
  }
  return n;
}

// Image initializers run on the main thread, so this is the main thread's port whoever starts a watchdog.
static thread_t MainThread;
__attribute__((constructor)) static void RecordMainThread(void) { MainThread = pthread_mach_thread_np(pthread_self()); }

static NSString *Hex(uintptr_t value) { return [NSString stringWithFormat:@"0x%lx", (unsigned long)value]; }

static NSString *ImageUUID(const struct mach_header_64 *header) {
  if (header->magic != MH_MAGIC_64) return nil;
  const struct load_command *command = (const struct load_command *)(header + 1);
  for (uint32_t index = 0; index < header->ncmds; index++) {
    if (command->cmd == LC_UUID) return [[NSUUID alloc] initWithUUIDBytes:((const struct uuid_command *)command)->uuid].UUIDString;
    command = (const struct load_command *)((const char *)command + command->cmdsize);
  }
  return nil;
}

// Image, offset and UUID locate each frame for offline symbolication (atos -l <imageAddress>);
// symbol is the nearest dynamic symbol dladdr knows, which a stripped binary may lack.
static NSArray<NSDictionary *> *Symbolicate(const uintptr_t *frames, size_t count) {
  NSMutableArray *stack = [NSMutableArray arrayWithCapacity:count];
  NSMutableDictionary<NSNumber *, NSString *> *uuids = [NSMutableDictionary new];
  for (size_t index = 0; index < count; index++) {
    uintptr_t address = frames[index];
    NSMutableDictionary *frame = [NSMutableDictionary dictionaryWithObject:Hex(address) forKey:@"address"];
    Dl_info info;
    // A return address follows its call; the call itself is what belongs to the calling function.
    if (dladdr((const void *)(index ? address - 1 : address), &info) && info.dli_fbase) {
      uintptr_t base = (uintptr_t)info.dli_fbase;
      if (info.dli_fname) frame[@"image"] = @(info.dli_fname);
      frame[@"imageAddress"] = Hex(base);
      frame[@"imageOffset"] = @(address - base);
      NSNumber *key = @(base);
      if (!uuids[key]) uuids[key] = ImageUUID((const struct mach_header_64 *)info.dli_fbase) ?: @"";
      if (uuids[key].length) frame[@"imageUUID"] = uuids[key];
      if (info.dli_sname && info.dli_saddr) {
        frame[@"symbol"] = @(info.dli_sname);
        frame[@"symbolOffset"] = @(address - (uintptr_t)info.dli_saddr);
      }
    }
    [stack addObject:frame];
  }
  return stack;
}

@implementation SparkHangWatchdog {
  NSUInteger _thresholdMs;
  SparkHangHandler _handler;
  dispatch_semaphore_t _wake;
  atomic_bool _stopped;
}

- (instancetype)initWithThreshold:(NSUInteger)thresholdMs handler:(SparkHangHandler)handler {
  if (!(self = [super init])) return nil;
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
    uint64_t sent = clock_gettime_nsec_np(CLOCK_UPTIME_RAW), startedAt = clock_gettime_nsec_np(CLOCK_REALTIME);
    dispatch_async(dispatch_get_main_queue(), ^{ dispatch_semaphore_signal(answered); });
    if (dispatch_semaphore_wait(answered, dispatch_time(DISPATCH_TIME_NOW, threshold))) {
      uintptr_t frames[kMaxFrames];
      size_t count = 0;
      if (thread_suspend(MainThread) == KERN_SUCCESS) {
        count = Backtrace(MainThread, frames, kMaxFrames);
        thread_resume(MainThread);
      }
      NSArray *stack = Symbolicate(frames, count);
      while (dispatch_semaphore_wait(answered, dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC)))
        if (atomic_load(&_stopped)) return;
      NSDictionary *report = @{
        @"durationMs": @((double)(clock_gettime_nsec_np(CLOCK_UPTIME_RAW) - sent) / NSEC_PER_MSEC),
        @"thresholdMs": @(_thresholdMs),
        @"startedAt": @((double)startedAt / NSEC_PER_MSEC),
        @"stack": stack,
      };
      dispatch_async(dispatch_get_main_queue(), ^{ if (!atomic_load(&self->_stopped)) self->_handler(report); });
    }
    // Ping again after half the threshold: any hang longer than 1.5 x the threshold is caught.
    dispatch_semaphore_wait(_wake, dispatch_time(DISPATCH_TIME_NOW, threshold / 2));
  }
}
@end

// Kept out of tail position so the simulated hang names itself in the reported stack.
__attribute__((disable_tail_calls)) void SparkSimulateHang(NSUInteger milliseconds) { usleep((useconds_t)milliseconds * 1000); }
