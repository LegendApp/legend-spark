#import "SparkCrashReporter.h"
#import "SparkStack.h"
#import <atomic>
#import <dlfcn.h>
#import <fcntl.h>
#import <mach-o/dyld.h>
#import <mach-o/dyld_images.h>
#import <mach/mach.h>
#import <signal.h>
#import <spawn.h>
#import <sys/wait.h>
#import <time.h>
#import <unistd.h>
#import <memory>
#import <vector>

extern char **environ;
NSString *const SparkCrashCodeKey = @"SparkCode";

static const int kSignals[] = { SIGABRT, SIGBUS, SIGFPE, SIGILL, SIGSEGV, SIGSYS, SIGTRAP };
static const size_t kMaxImages = 4096;
static const size_t kAltStackBytes = 128 * 1024;
#if SPARK_TEST_DRIVER
// A simulateCrash helper is this executable started with these variables. Builds without the test driver (consumer
// release builds) have neither the variables nor native simulated crashes (docs/diagnostics.md#checking-your-reporting).
static const char *const kSimulateKind = "SPARK_SIMULATE_CRASH", *const kSimulateDirectory = "SPARK_SIMULATE_CRASH_DIRECTORY";
#endif
static const char *const kRecordExtension = ".sparkcrash";

// Everything the signal handler reads is prepared here beforehand: it allocates nothing and takes no lock.
static struct sigaction gPrevious[NSIG];
static std::atomic<bool> gRecording{false};
static std::atomic_flag gHandling = ATOMIC_FLAG_INIT; // The first crashing thread records; others only pass the signal on.
static bool gSimulated;                               // A simulateCrash helper: exit once recorded.
static char gDirectory[PATH_MAX];                     // "<directory>/"
static char gApp[512];                                // "app <version>\t<build>\n"
static char gExceptionName[256], gExceptionReason[1024];
static std::atomic<bool> gHasException{false};
static NSUncaughtExceptionHandler *gPreviousExceptionHandler;

// Loaded images, kept by dyld callbacks so the handler never asks dyld (which takes a lock).
struct Image { std::atomic<uintptr_t> base; uintptr_t size; uint8_t uuid[16]; bool hasUUID; const char *path; };
static Image gImages[kMaxImages];
static std::atomic<size_t> gImageCount{0};

static void AddImage(const struct mach_header *header, intptr_t) {
  const struct mach_header_64 *image = (const struct mach_header_64 *)header;
  size_t index = gImageCount.load(std::memory_order_relaxed);
  if (index >= kMaxImages || image->magic != MH_MAGIC_64) return;
  Image *entry = &gImages[index];
  entry->size = 0;
  const struct load_command *command = (const struct load_command *)(image + 1);
  for (uint32_t n = 0; n < image->ncmds; n++) {
    const struct segment_command_64 *segment = (const struct segment_command_64 *)command;
    if (command->cmd == LC_SEGMENT_64 && !strncmp(segment->segname, "__TEXT", sizeof segment->segname)) entry->size = segment->vmsize;
    command = (const struct load_command *)((const char *)command + command->cmdsize);
  }
  entry->hasUUID = SparkImageUUIDBytes(image, entry->uuid);
  Dl_info info;
  entry->path = dladdr(header, &info) ? info.dli_fname : NULL;
  entry->base.store((uintptr_t)header, std::memory_order_release);
  gImageCount.store(index + 1, std::memory_order_release);
}
static void RemoveImage(const struct mach_header *header, intptr_t) {
  for (size_t index = 0, count = gImageCount.load(std::memory_order_acquire); index < count; index++)
    if (gImages[index].base.load(std::memory_order_relaxed) == (uintptr_t)header) gImages[index].base.store(0, std::memory_order_release);
}
static long ImageContaining(uintptr_t address) {
  for (size_t index = 0, count = gImageCount.load(std::memory_order_acquire); index < count; index++) {
    uintptr_t base = gImages[index].base.load(std::memory_order_acquire);
    if (base && address >= base && address - base < gImages[index].size) return (long)index;
  }
  return -1;
}

// --- Async-signal-safe output: write(2) through a buffer on the handler's stack.
struct Writer { int fd; size_t used; char buffer[2048]; };
static void Flush(Writer *writer) {
  const char *bytes = writer->buffer;
  size_t remaining = writer->used;
  while (remaining) {
    ssize_t written = write(writer->fd, bytes, remaining);
    if (written < 0 && errno == EINTR) continue;
    if (written <= 0) break;
    bytes += written;
    remaining -= (size_t)written;
  }
  writer->used = 0;
}
static void Put(Writer *writer, const char *text, size_t length) {
  while (length) {
    if (writer->used == sizeof writer->buffer) Flush(writer);
    size_t chunk = MIN(length, sizeof writer->buffer - writer->used);
    memcpy(writer->buffer + writer->used, text, chunk);
    writer->used += chunk;
    text += chunk;
    length -= chunk;
  }
}
static void PutText(Writer *writer, const char *text) { Put(writer, text, strlen(text)); }
static size_t Digits(char *out, uint64_t value, unsigned base) {
  char reversed[32];
  size_t count = 0;
  do { reversed[count++] = "0123456789abcdef"[value % base]; value /= base; } while (value);
  for (size_t index = 0; index < count; index++) out[index] = reversed[count - 1 - index];
  return count;
}
static void PutNumber(Writer *writer, uint64_t value) { char text[32]; Put(writer, text, Digits(text, value, 10)); }
static void PutHex(Writer *writer, uintptr_t value) { char text[32]; PutText(writer, "0x"); Put(writer, text, Digits(text, value, 16)); }

static void Record(int signal, siginfo_t *info, ucontext_t *context) {
  struct timespec now;
  clock_gettime(CLOCK_REALTIME, &now);
  // <directory>/<unix ms>-<pid>.sparkcrash
  char path[PATH_MAX + 64];
  size_t length = strlcpy(path, gDirectory, PATH_MAX);
  length += Digits(path + length, (uint64_t)now.tv_sec * 1000 + (uint64_t)now.tv_nsec / 1000000, 10);
  path[length++] = '-';
  length += Digits(path + length, (uint64_t)getpid(), 10);
  strlcpy(path + length, kRecordExtension, sizeof path - length);
  int fd = open(path, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  if (fd < 0) return;

  uintptr_t frames[SparkMaxFrames];
  size_t count = 0, linkFrame = SIZE_MAX;
  if (context) {
#if defined(__arm64__)
    count = SparkWalkStack(arm_thread_state64_get_pc(context->uc_mcontext->__ss), arm_thread_state64_get_fp(context->uc_mcontext->__ss),
      arm_thread_state64_get_lr(context->uc_mcontext->__ss), frames, SparkMaxFrames, &linkFrame);
#elif defined(__x86_64__)
    count = SparkWalkStack(context->uc_mcontext->__ss.__rip, context->uc_mcontext->__ss.__rbp, 0, frames, SparkMaxFrames, &linkFrame);
#endif
  }
  Writer writer = { fd, 0, {} };
  PutText(&writer, "spark-crash 1\ntime ");
  PutNumber(&writer, (uint64_t)now.tv_sec * 1000 + (uint64_t)now.tv_nsec / 1000000);
  PutText(&writer, "\nsignal ");
  PutNumber(&writer, (uint64_t)signal);
  PutText(&writer, " ");
  PutNumber(&writer, info ? (uint64_t)(uint32_t)info->si_code : 0);
  PutText(&writer, " ");
  PutHex(&writer, info ? (uintptr_t)info->si_addr : 0);
  PutText(&writer, pthread_main_np() ? "\nmain 1\n" : "\nmain 0\n");
  PutText(&writer, gApp);
  if (gSimulated) PutText(&writer, "simulated\n");
  if (gHasException.load()) {
    PutText(&writer, "exception "); PutText(&writer, gExceptionName);
    PutText(&writer, "\nreason "); PutText(&writer, gExceptionReason); PutText(&writer, "\n");
  }
  if (linkFrame != SIZE_MAX) { PutText(&writer, "link "); PutNumber(&writer, linkFrame); PutText(&writer, "\n"); }
  long images[SparkMaxFrames];
  size_t imageCount = 0;
  for (size_t index = 0; index < count; index++) {
    PutText(&writer, "frame "); PutHex(&writer, frames[index]); PutText(&writer, "\n");
    long image = ImageContaining(index ? frames[index] - 1 : frames[index]);
    bool seen = image < 0;
    for (size_t known = 0; !seen && known < imageCount; known++) seen = images[known] == image;
    if (!seen) images[imageCount++] = image;
  }
  for (size_t index = 0; index < imageCount; index++) {
    const Image *image = &gImages[images[index]];
    PutText(&writer, "image "); PutHex(&writer, image->base.load()); PutText(&writer, " "); PutHex(&writer, image->size); PutText(&writer, " ");
    // The UUID as NSUUID writes it: 8-4-4-4-12 uppercase hex digits.
    if (image->hasUUID) for (size_t byte = 0; byte < 16; byte++) {
      char hex[3] = { "0123456789ABCDEF"[image->uuid[byte] >> 4], "0123456789ABCDEF"[image->uuid[byte] & 15], '-' };
      Put(&writer, hex, byte == 3 || byte == 5 || byte == 7 || byte == 9 ? 3 : 2);
    }
    else PutText(&writer, "-");
    PutText(&writer, " "); PutText(&writer, image->path ?: "?"); PutText(&writer, "\n");
  }
  PutText(&writer, "end\n");
  Flush(&writer);
  close(fd);
}

static void HandleSignal(int signal, siginfo_t *info, void *context) {
  int savedErrno = errno;
  if (gRecording.load() && !gHandling.test_and_set()) {
    Record(signal, info, (ucontext_t *)context);
    if (gSimulated) _exit(128 + signal);
  }
  // Hand the signal to whatever handled it before: another reporter's handler, or the default action,
  // which ends the process the way the system crash reporter and a debugger expect.
  struct sigaction previous = gPrevious[signal];
  if (!(previous.sa_flags & SA_SIGINFO) && previous.sa_handler == SIG_IGN) previous.sa_handler = SIG_DFL; // An ignored fault would repeat forever.
  sigaction(signal, &previous, NULL);
  // A fault the processor raised happens again when the handler returns, at the same instruction. A signal
  // sent by abort(), raise() or kill() is sent again; it arrives once this handler returns.
  bool fault = signal != SIGABRT && signal != SIGSYS && info && info->si_code < SI_USER;
  if (!fault) raise(signal);
  errno = savedErrno;
}

// Not in a signal handler: the uncaught exception is copied for the SIGABRT record that follows it.
static void CopyLine(char *destination, size_t size, NSString *text) {
  strlcpy(destination, text.UTF8String ?: "", size);
  for (char *character = destination; *character; character++) if (*character == '\n' || *character == '\r') *character = ' ';
}
static void HandleException(NSException *exception) {
  if (gRecording.load()) {
    CopyLine(gExceptionName, sizeof gExceptionName, exception.name);
    CopyLine(gExceptionReason, sizeof gExceptionReason, exception.reason ?: @"");
    gHasException.store(true);
  }
  if (gPreviousExceptionHandler) gPreviousExceptionHandler(exception);
}

static NSString *Sanitized(id value) { return [value isKindOfClass:NSString.class] ? [[value componentsSeparatedByCharactersInSet:NSCharacterSet.newlineCharacterSet] componentsJoinedByString:@" "] : @""; }

void SparkInstallCrashHandlers(NSString *directory) {
  static std::atomic<bool> installed{false};
  if (installed.exchange(true)) return;
  [NSFileManager.defaultManager createDirectoryAtPath:directory withIntermediateDirectories:YES attributes:nil error:nil];
  strlcpy(gDirectory, [directory stringByAppendingString:@"/"].fileSystemRepresentation, sizeof gDirectory);
  NSBundle *bundle = NSBundle.mainBundle;
  NSString *app = [NSString stringWithFormat:@"app %@\t%@\n", Sanitized([bundle objectForInfoDictionaryKey:@"CFBundleShortVersionString"]), Sanitized([bundle objectForInfoDictionaryKey:@"CFBundleVersion"])];
  strlcpy(gApp, app.UTF8String, sizeof gApp);
  // dyld itself (the outermost frames of the main thread, and of +load) is not among the images the callbacks report.
  struct task_dyld_info dyld;
  mach_msg_type_number_t count = TASK_DYLD_INFO_COUNT;
  if (task_info(mach_task_self(), TASK_DYLD_INFO, (task_info_t)&dyld, &count) == KERN_SUCCESS && dyld.all_image_info_addr)
    AddImage(((const struct dyld_all_image_infos *)dyld.all_image_info_addr)->dyldImageLoadAddress, 0);
  // Called at once for every image already loaded, then for each one loaded later.
  _dyld_register_func_for_add_image(AddImage);
  _dyld_register_func_for_remove_image(RemoveImage);
  stack_t current;
  if (sigaltstack(NULL, &current) == 0 && (current.ss_flags & SS_DISABLE)) {
    stack_t stack = { .ss_sp = malloc(kAltStackBytes), .ss_size = kAltStackBytes, .ss_flags = 0 };
    if (stack.ss_sp) sigaltstack(&stack, NULL);
  }
  for (int signal : kSignals) {
    struct sigaction action = {};
    action.sa_sigaction = HandleSignal;
    action.sa_flags = SA_SIGINFO | SA_ONSTACK;
    sigemptyset(&action.sa_mask);
    sigaction(signal, &action, &gPrevious[signal]);
  }
  gPreviousExceptionHandler = NSGetUncaughtExceptionHandler();
  NSSetUncaughtExceptionHandler(HandleException);
}
BOOL SparkCrashRecording(void) { return gRecording.load(); }
void SparkSetCrashRecording(BOOL recording) { gRecording.store(recording); }

static CFStringRef const kConsentKey = CFSTR("SparkCrashReportingEnabled");
BOOL SparkCrashConsent(void) { return CFPreferencesGetAppBooleanValue(kConsentKey, kCFPreferencesCurrentApplication, NULL); }
void SparkSetCrashConsent(BOOL enabled) {
  CFPreferencesSetAppValue(kConsentKey, enabled ? kCFBooleanTrue : NULL, kCFPreferencesCurrentApplication);
  CFPreferencesAppSynchronize(kCFPreferencesCurrentApplication);
}

NSString *SparkDefaultCrashDirectory(void) {
  NSString *identifier = NSBundle.mainBundle.bundleIdentifier ?: NSProcessInfo.processInfo.processName;
  NSURL *library = [NSFileManager.defaultManager URLsForDirectory:NSLibraryDirectory inDomains:NSUserDomainMask].firstObject;
  return [library URLByAppendingPathComponent:[NSString pathWithComponents:@[@"Logs", identifier, @"Crashes"]]].path;
}

// --- Reports: everything below runs in a normal context. Records and reports are read, written and
// deleted on one serial queue, so a launch's processing and the app's requests never interleave.
static dispatch_queue_t Queue(void) {
  static dispatch_queue_t queue = dispatch_queue_create("so.legend.spark.crash-reports", DISPATCH_QUEUE_SERIAL);
  return queue;
}
static NSError *CrashError(NSString *code, NSString *message) {
  return [NSError errorWithDomain:@"so.legend.spark.crash" code:1 userInfo:@{ SparkCrashCodeKey: code, NSLocalizedDescriptionKey: message }];
}
static uint64_t NowMs(void) { return clock_gettime_nsec_np(CLOCK_REALTIME) / NSEC_PER_MSEC; }
static NSDictionary *AppInfo(void) {
  NSBundle *bundle = NSBundle.mainBundle;
  return @{ @"version": [bundle objectForInfoDictionaryKey:@"CFBundleShortVersionString"] ?: NSNull.null, @"build": [bundle objectForInfoDictionaryKey:@"CFBundleVersion"] ?: NSNull.null };
}
static NSString *SignalName(int signal) {
  switch (signal) {
    case SIGABRT: return @"SIGABRT"; case SIGBUS: return @"SIGBUS"; case SIGFPE: return @"SIGFPE"; case SIGILL: return @"SIGILL";
    case SIGSEGV: return @"SIGSEGV"; case SIGSYS: return @"SIGSYS"; case SIGTRAP: return @"SIGTRAP";
  }
  return [NSString stringWithFormat:@"%d", signal];
}
static BOOL WriteReport(NSString *directory, NSDictionary *report, NSError **error) {
  NSData *json = [NSJSONSerialization dataWithJSONObject:report options:NSJSONWritingSortedKeys | NSJSONWritingWithoutEscapingSlashes error:error];
  return json && [NSFileManager.defaultManager createDirectoryAtPath:directory withIntermediateDirectories:YES attributes:nil error:error]
    && [json writeToFile:[directory stringByAppendingPathComponent:[report[@"id"] stringByAppendingPathExtension:@"json"]] options:NSDataWritingAtomic error:error];
}
static uintptr_t ParseHex(NSString *text) { return (uintptr_t)strtoull(text.UTF8String, NULL, 16); }

// The base address of each image loaded in this process, by UUID.
static NSDictionary<NSString *, NSNumber *> *LoadedImages(void) {
  NSMutableDictionary *images = [NSMutableDictionary new];
  for (uint32_t index = 0, count = _dyld_image_count(); index < count; index++) {
    const struct mach_header_64 *header = (const struct mach_header_64 *)_dyld_get_image_header(index);
    NSString *uuid = header ? SparkImageUUID(header) : nil;
    if (uuid) images[uuid] = @((uintptr_t)header);
  }
  return images;
}

// A record as a report. Frames keep the crashed process's addresses; symbols come from the same image
// (matched by UUID) loaded in this process, so an image that is not loaded here, or was rebuilt, has none.
static NSDictionary *ReportFromRecord(NSString *text, NSString *identifier, NSDictionary<NSString *, NSNumber *> *loaded) {
  NSArray<NSString *> *lines = [text componentsSeparatedByString:@"\n"];
  if (![lines.firstObject isEqual:@"spark-crash 1"]) return nil;
  NSMutableDictionary *report = [@{ @"id": identifier, @"kind": @"native", @"simulated": @NO, @"app": @{ @"version": NSNull.null, @"build": NSNull.null } } mutableCopy];
  NSMutableArray<NSNumber *> *frames = [NSMutableArray new];
  NSMutableArray<NSArray *> *images = [NSMutableArray new]; // [base, size, uuid, path]
  NSInteger link = -1;
  for (NSString *line in lines) {
    NSRange space = [line rangeOfString:@" "];
    NSString *key = space.location == NSNotFound ? line : [line substringToIndex:space.location];
    NSString *value = space.location == NSNotFound ? @"" : [line substringFromIndex:space.location + 1];
    NSArray<NSString *> *parts = [value componentsSeparatedByString:@" "];
    if ([key isEqual:@"time"]) report[@"createdAt"] = @(value.longLongValue);
    else if ([key isEqual:@"signal"] && parts.count == 3) {
      int signal = parts[0].intValue;
      report[@"signal"] = SignalName(signal);
      report[@"signalCode"] = @(parts[1].intValue);
      if (signal == SIGSEGV || signal == SIGBUS || signal == SIGILL || signal == SIGFPE) report[@"faultAddress"] = parts[2];
    }
    else if ([key isEqual:@"main"]) report[@"mainThread"] = @([value isEqual:@"1"]);
    else if ([key isEqual:@"app"]) {
      NSArray<NSString *> *app = [value componentsSeparatedByString:@"\t"];
      if (app.count == 2) report[@"app"] = @{ @"version": app[0].length ? app[0] : NSNull.null, @"build": app[1].length ? app[1] : NSNull.null };
    }
    else if ([key isEqual:@"simulated"]) report[@"simulated"] = @YES;
    else if ([key isEqual:@"exception"]) report[@"exception"] = @{ @"name": value, @"reason": @"" };
    else if ([key isEqual:@"reason"] && report[@"exception"]) report[@"exception"] = @{ @"name": report[@"exception"][@"name"], @"reason": value };
    else if ([key isEqual:@"link"]) link = value.integerValue;
    else if ([key isEqual:@"frame"]) [frames addObject:@(ParseHex(value))];
    else if ([key isEqual:@"image"] && parts.count >= 4)
      [images addObject:@[@(ParseHex(parts[0])), @(ParseHex(parts[1])), parts[2], [[parts subarrayWithRange:NSMakeRange(3, parts.count - 3)] componentsJoinedByString:@" "]]];
  }
  if (!report[@"signal"] || !report[@"createdAt"]) return nil;
  // Where each frame is in this process, for its symbol: its image's base here plus its offset.
  uintptr_t (^live)(NSUInteger, NSArray **) = ^uintptr_t(NSUInteger index, NSArray **imageOut) {
    uintptr_t address = frames[index].unsignedLongValue, lookup = index ? address - 1 : address;
    for (NSArray *image in images) {
      uintptr_t base = [image[0] unsignedLongValue];
      if (lookup < base || lookup - base >= [image[1] unsignedLongValue]) continue;
      *imageOut = image;
      NSNumber *here = loaded[image[2]];
      return here ? here.unsignedLongValue + (address - base) : 0;
    }
    return 0;
  };
  NSMutableArray *stack = [NSMutableArray new];
  NSArray *firstImage = nil;
  uintptr_t first = frames.count ? live(0, &firstImage) : 0;
  for (NSUInteger index = 0; index < frames.count; index++) {
    NSArray *image = nil;
    uintptr_t address = frames[index].unsignedLongValue, here = live(index, &image);
    if ((NSInteger)index == link && here && first && SparkIsStaleLinkFrame(here, first)) continue;
    NSMutableDictionary *frame = [NSMutableDictionary dictionaryWithObject:SparkHex(address) forKey:@"address"];
    if (image) {
      uintptr_t base = [image[0] unsignedLongValue];
      if (![image[3] isEqual:@"?"]) frame[@"image"] = image[3];
      frame[@"imageAddress"] = SparkHex(base);
      frame[@"imageOffset"] = @(address - base);
      if (![image[2] isEqual:@"-"]) frame[@"imageUUID"] = image[2];
      if (here) SparkAddSymbol(frame, here, index > 0);
    }
    [stack addObject:frame];
  }
  report[@"stack"] = stack;
  return report;
}

// Records of processes that have exited, as reports. A record whose process still runs is being written.
static NSDictionary *ProcessRecords(NSString *directory, pid_t only) {
  NSMutableDictionary *converted = [NSMutableDictionary new];
  NSDictionary *loaded = nil;
  for (NSString *name in [NSFileManager.defaultManager contentsOfDirectoryAtPath:directory error:nil]) {
    if (![name hasSuffix:@(kRecordExtension)]) continue;
    NSString *identifier = name.stringByDeletingPathExtension, *path = [directory stringByAppendingPathComponent:name];
    pid_t pid = (pid_t)[identifier componentsSeparatedByString:@"-"].lastObject.intValue;
    if ((only && pid != only) || pid <= 0 || pid == getpid() || !(kill(pid, 0) == -1 && errno == ESRCH)) continue;
    loaded = loaded ?: LoadedImages();
    NSString *text = [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil];
    NSDictionary *report = text ? ReportFromRecord(text, identifier, loaded) : nil;
    NSError *error = nil;
    if (!report) {
      // A handler cut off before its first lines left nothing to report; keep the file for inspection.
      NSLog(@"Spark crash reporting: %@ is not a readable crash record; renamed to .unreadable", path);
      [NSFileManager.defaultManager moveItemAtPath:path toPath:[path stringByAppendingPathExtension:@"unreadable"] error:nil];
    } else if (WriteReport(directory, report, &error)) {
      [NSFileManager.defaultManager removeItemAtPath:path error:nil];
      converted[identifier] = report;
    } else NSLog(@"Spark crash reporting: could not write the report for %@: %@", path, error.localizedDescription);
  }
  return converted;
}

static NSArray<NSDictionary *> *Reports(NSString *directory, NSError **error) {
  ProcessRecords(directory, 0);
  NSMutableArray *reports = [NSMutableArray new];
  NSArray *names = [NSFileManager.defaultManager contentsOfDirectoryAtPath:directory error:nil] ?: @[];
  for (NSString *name in names) {
    if (![name.pathExtension isEqual:@"json"]) continue;
    NSData *data = [NSData dataWithContentsOfFile:[directory stringByAppendingPathComponent:name] options:0 error:error];
    if (!data) return nil;
    id report = [NSJSONSerialization JSONObjectWithData:data options:0 error:error];
    if (![report isKindOfClass:NSDictionary.class]) {
      if (error && !*error) *error = CrashError(@"E_INVALID_DATA", [NSString stringWithFormat:@"%@ is not a crash report", name]);
      return nil;
    }
    [reports addObject:report];
  }
  [reports sortUsingDescriptors:@[[NSSortDescriptor sortDescriptorWithKey:@"createdAt" ascending:NO], [NSSortDescriptor sortDescriptorWithKey:@"id" ascending:NO]]];
  return reports;
}
NSArray<NSDictionary *> *SparkCrashReports(NSString *directory, NSError **error) {
  __block NSArray *reports;
  __block NSError *failure;
  dispatch_sync(Queue(), ^{ NSError *inner = nil; reports = Reports(directory, &inner); failure = inner; });
  if (!reports && error) *error = failure;
  return reports;
}

static BOOL IsIdentifier(NSString *identifier) {
  static NSCharacterSet *invalid = [[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdefghijklmnopqrstuvwxyz-"] invertedSet];
  return identifier.length > 0 && identifier.length <= 64 && [identifier rangeOfCharacterFromSet:invalid].location == NSNotFound;
}

static BOOL Delete(NSString *directory, NSArray<NSString *> *ids, NSError **error) {
  NSFileManager *manager = NSFileManager.defaultManager;
  NSMutableArray<NSString *> *names = [NSMutableArray new];
  if (ids) for (NSString *identifier in ids) {
    if (!IsIdentifier(identifier)) { if (error) *error = CrashError(@"E_INVALID_ARGUMENT", @"Not a crash report id"); return NO; }
    [names addObject:[identifier stringByAppendingPathExtension:@"json"]];
  } else for (NSString *name in [manager contentsOfDirectoryAtPath:directory error:nil])
    if ([name.pathExtension isEqual:@"json"] || [name hasSuffix:@(kRecordExtension)] || [name hasSuffix:@".unreadable"]) [names addObject:name];
  for (NSString *name in names) {
    NSString *path = [directory stringByAppendingPathComponent:name];
    if ([manager fileExistsAtPath:path] && ![manager removeItemAtPath:path error:error]) return NO;
  }
  return YES;
}
BOOL SparkDeleteCrashReports(NSString *directory, NSArray<NSString *> *ids, NSError **error) {
  __block BOOL deleted;
  __block NSError *failure;
  dispatch_sync(Queue(), ^{ NSError *inner = nil; deleted = Delete(directory, ids, &inner); failure = inner; });
  if (!deleted && error) *error = failure;
  return deleted;
}

NSString *SparkRecordJavaScriptCrash(NSString *directory, NSDictionary *error, NSError **outError) {
  static std::atomic<unsigned> sequence{0};
  uint64_t now = NowMs();
  NSMutableDictionary *report = [error mutableCopy];
  report[@"id"] = [NSString stringWithFormat:@"%llu-%d-js%u", now, getpid(), ++sequence];
  report[@"kind"] = @"javascript";
  report[@"createdAt"] = @(now);
  report[@"app"] = AppInfo();
  return WriteReport(directory, report, outError) ? report[@"id"] : nil;
}

NSDictionary *SparkSimulateCrash(NSString *directory, NSString *kind, NSError **error) {
#if !SPARK_TEST_DRIVER
  if (error) *error = CrashError(@"E_UNAVAILABLE", @"Native simulated crashes exist only in Debug builds and builds with the test driver (macos.testDriverInRelease)");
  return nil;
#else
  NSString *executable = NSBundle.mainBundle.executablePath;
  if (!executable) { if (error) *error = CrashError(@"E_UNAVAILABLE", @"This process has no executable to start as a helper"); return nil; }
  NSMutableArray<NSString *> *environment = [NSMutableArray new];
  for (char **variable = environ; *variable; variable++)
    if (strncmp(*variable, kSimulateKind, strlen(kSimulateKind))) [environment addObject:@(*variable)];
  [environment addObject:[NSString stringWithFormat:@"%s=%@", kSimulateKind, kind]];
  [environment addObject:[NSString stringWithFormat:@"%s=%@", kSimulateDirectory, directory]];
  std::vector<char *> envp;
  for (NSString *variable in environment) envp.push_back((char *)variable.UTF8String);
  envp.push_back(NULL);
  char *argv[] = { (char *)executable.fileSystemRepresentation, NULL };

  // The helper inherits no descriptors but /dev/null, so it cannot touch this process's files or sockets.
  posix_spawn_file_actions_t actions;
  posix_spawnattr_t attributes;
  posix_spawn_file_actions_init(&actions);
  for (int fd = 0; fd <= 2; fd++) posix_spawn_file_actions_addopen(&actions, fd, "/dev/null", fd ? O_WRONLY : O_RDONLY, 0);
  posix_spawnattr_init(&attributes);
  posix_spawnattr_setflags(&attributes, POSIX_SPAWN_CLOEXEC_DEFAULT);
  pid_t pid = 0;
  int failed = posix_spawn(&pid, argv[0], &actions, &attributes, argv, envp.data());
  posix_spawn_file_actions_destroy(&actions);
  posix_spawnattr_destroy(&attributes);
  if (failed) { if (error) *error = CrashError(@"E_NATIVE", [NSString stringWithFormat:@"Could not start the crash helper: %s", strerror(failed)]); return nil; }

  // 0 waiting, 1 exited, 2 killed by the timeout.
  auto state = std::make_shared<std::atomic<int>>(0);
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC), dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
    int waiting = 0;
    if (state->compare_exchange_strong(waiting, 2)) kill(pid, SIGKILL);
  });
  // Waits for the exit without reaping, so the pid stays the helper's until the timeout can no longer kill it.
  siginfo_t exited;
  while (waitid(P_PID, (id_t)pid, &exited, WEXITED | WNOWAIT) < 0 && errno == EINTR) {}
  int waiting = 0;
  bool timedOut = !state->compare_exchange_strong(waiting, 1);
  int status = 0;
  while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {}
  if (timedOut) { if (error) *error = CrashError(@"E_TIMEOUT", @"The crash helper did not crash within 30 s"); return nil; }
  __block NSDictionary *report;
  dispatch_sync(Queue(), ^{ report = ProcessRecords(directory, pid).allValues.firstObject; });
  if (!report && error) *error = CrashError(@"E_NATIVE", [NSString stringWithFormat:@"The crash helper exited without a crash record (status %d)", status]);
  return report;
#endif
}

static volatile int *volatile gNowhere = NULL;
static volatile bool gRecurse = true;
// Each call keeps a frame of 256 bytes until the stack runs out. Named, so a report's innermost frames name it.
extern "C" __attribute__((noinline)) int SparkCrashRecurse(int depth) {
  volatile char padding[256];
  padding[0] = (char)depth;
  return gRecurse ? SparkCrashRecurse(depth + 1) + padding[0] : 0;
}
// Kept out of line and out of tail position so the crash names itself in the reported stack.
__attribute__((noinline, disable_tail_calls)) void SparkCrashNow(const char *kind) {
  if (!strcmp(kind, "badAccess")) *gNowhere = 1;
  else if (!strcmp(kind, "stackOverflow")) SparkCrashRecurse(0);
  else if (!strcmp(kind, "abort")) abort();
  else if (!strcmp(kind, "uncaughtException")) [NSException raise:@"SparkSimulatedException" format:@"A simulated uncaught exception"];
  else if (!strcmp(kind, "trap")) __builtin_trap();
}

// Installs at launch: a simulateCrash helper (SPARK_TEST_DRIVER builds) crashes before the app starts; otherwise the handlers are
// installed when the user has consented, and records left by earlier launches become reports.
@interface SparkCrashReporterLaunch : NSObject
@end
@implementation SparkCrashReporterLaunch
+ (void)load {
#if SPARK_TEST_DRIVER
  const char *kind = getenv(kSimulateKind), *directory = getenv(kSimulateDirectory);
  if (kind && directory) {
    gSimulated = true;
    SparkInstallCrashHandlers(@(directory));
    SparkSetCrashRecording(YES);
    SparkCrashNow(kind);
    _exit(70); // An unknown kind: the parent reports that no crash was recorded.
  }
#endif
  if (!SparkCrashConsent()) return;
  NSString *crashes = SparkDefaultCrashDirectory();
  SparkInstallCrashHandlers(crashes);
  SparkSetCrashRecording(YES);
  dispatch_async(Queue(), ^{ ProcessRecords(crashes, 0); });
}
@end
