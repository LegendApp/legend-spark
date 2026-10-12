#import "SparkProfiler.h"
#if RCT_DEV
#import <QuartzCore/QuartzCore.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTCallInvoker.h>
#import <React/RCTCallInvokerModule.h>
#import "SparkRuntimeHosts.h"
#import "SparkFrameTimeline.h"
#include <chrono>
#include <hermes/hermes.h>
#include <sstream>
#include <vector>

using facebook::react::CallInvoker;
namespace jsi = facebook::jsi;

// Every file the profiler writes starts with this (PROFILER_MARKER in src/profiler/marker.ts); the release-safety probe
// (DEVT-REL-05) fails a release build whose native code or JavaScript contains it.
static NSString *const SparkProfilerMarker = @"spark-profiler";
static const double SparkProfilerCollectSeconds = 10;

// An RCTHost (bridgeless); declared locally so this pod needs no React-RuntimeApple headers.
@protocol SparkProfiledHost <NSObject>
@property (nonatomic, readonly) RCTModuleRegistry *moduleRegistry;
@end

/** Each running runtime's JS thread, by runtime name: its NativeDesktopApp module (created if the runtime has not used it) holds its call invoker. */
static std::vector<std::pair<NSString *, std::shared_ptr<CallInvoker>>> SparkProfiledRuntimes(void) {
  std::vector<std::pair<NSString *, std::shared_ptr<CallInvoker>>> runtimes;
  NSMutableArray *names = [NSMutableArray arrayWithObject:NSNull.null];
  [names addObjectsFromArray:SparkIsolatedRuntimeNames()];
  for (id name in names) {
    id<SparkProfiledHost> host = SparkRuntimeHost(name == NSNull.null ? nil : name);
    id module = [host.moduleRegistry moduleForName:"NativeDesktopApp"];
    RCTCallInvoker *invoker = [module conformsToProtocol:@protocol(RCTCallInvokerModule)] ? [(id<RCTCallInvokerModule>)module callInvoker] : nil;
    if (invoker.callInvoker) runtimes.emplace_back(name == NSNull.null ? @"shared" : name, invoker.callInvoker);
  }
  return runtimes;
}

static facebook::hermes::IHermesRootAPI *SparkHermesRoot(void) {
  return jsi::castInterface<facebook::hermes::IHermesRootAPI>(facebook::hermes::makeHermesRootAPI());
}
// Hermes's profile timestamps are steady_clock microseconds, as React Native's performance.now() is.
static double SparkSteadyMicroseconds(void) {
  return std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

static SparkFrameTimeline *timeline;
static double startUs;

BOOL SparkProfilerRecording(void) { return timeline != nil; }

void SparkProfilerStart(double samplesPerSecond, SparkProfilerCompletion completion) {
  if (timeline) { completion(nil, @"E_BUSY", @"Profiling has already started; stop it first"); return; }
  NSString *error;
  SparkFrameTimeline *started = [SparkFrameTimeline startWithError:&error];
  if (!started) { completion(nil, @"E_UNAVAILABLE", error); return; }
  timeline = started;
  startUs = SparkSteadyMicroseconds() - (CACurrentMediaTime() - started.start) * 1e6;
  // Samples every runtime registered for profiling: React Native's Hermes runtimes are (HermesInstance).
  SparkHermesRoot()->enableSamplingProfiler(samplesPerSecond);
  completion(@{}, nil, nil);
}

/** On the runtime's JS thread: its samples, or why it has none. */
static NSDictionary *SparkCollect(jsi::Runtime &runtime) {
  auto *hermes = jsi::castInterface<facebook::hermes::IHermes>(&runtime);
  if (!hermes) return @{ @"error": @"The JavaScript runtime is not Hermes" };
  std::ostringstream stream;
  hermes->sampledTraceToStreamInDevToolsFormat(stream);
  return @{ @"profile": [NSString stringWithUTF8String:stream.str().c_str()] ?: @"" };
}

/** Why `directory` cannot take the profile (it is not an existing directory), or nil. */
static NSString *SparkProfilerDirectoryProblem(NSString *directory) {
  BOOL isDirectory = NO;
  if (!directory || ([directory isAbsolutePath] && [NSFileManager.defaultManager fileExistsAtPath:directory isDirectory:&isDirectory] && isDirectory)) return nil;
  return [NSString stringWithFormat:@"%@ is not an existing directory", directory];
}

void SparkProfilerStop(NSString *directory, SparkProfilerCompletion completion) {
  if (!timeline) { completion(nil, @"E_NOT_FOUND", @"No profiling session is recording"); return; }
  // Checked before stopping, so a mistyped folder does not lose the recording.
  if (NSString *problem = SparkProfilerDirectoryProblem(directory)) { completion(nil, @"E_NOT_FOUND", problem); return; }
  SparkHermesRoot()->disableSamplingProfiler();
  NSDictionary *frames = [timeline stop];
  timeline = nil;
  const auto live = SparkProfiledRuntimes();
  NSMutableArray<NSDictionary *> *collected = [NSMutableArray new];
  __block BOOL finished = NO;
  NSMutableDictionary *counts = [frames mutableCopy];
  [counts removeObjectForKey:@"timeline"];
  NSDictionary *result = @{ @"process": NSProcessInfo.processInfo.processName, @"frames": counts, @"timeline": frames[@"timeline"], @"runtimes": collected };
  const double start = startUs;
  void (^finish)(NSString *, NSString *) = ^(NSString *code, NSString *message) {
    if (finished) return;
    finished = YES;
    for (NSDictionary *item in collected) if (item[@"error"]) { completion(nil, @"E_UNAVAILABLE", item[@"error"]); return; }
    if (code) completion(nil, code, message); else completion(result, nil, nil);
  };
  if (live.empty()) { finish(nil, nil); return; }
  const NSUInteger expected = live.size();
  for (const auto &[name, invoker] : live) {
    invoker->invokeAsync([name, start, expected, collected, finish](jsi::Runtime &runtime) {
      NSMutableDictionary *item = [SparkCollect(runtime) mutableCopy];
      item[@"runtime"] = name;
      item[@"startUs"] = @(start);
      dispatch_async(dispatch_get_main_queue(), ^{
        [collected addObject:item];
        if (collected.count == expected) finish(nil, nil);
      });
    });
  }
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(SparkProfilerCollectSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    finish(@"E_TIMEOUT", [NSString stringWithFormat:@"%lu of %lu JavaScript runtimes did not hand over their samples within %.0f s", (unsigned long)(expected - collected.count), (unsigned long)expected, SparkProfilerCollectSeconds]);
  });
}

void SparkProfilerWrite(NSString *directory, NSArray *files, SparkProfilerCompletion completion) {
  NSFileManager *manager = NSFileManager.defaultManager;
  NSRegularExpression *names = [NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$" options:0 error:nil];
  if (![files isKindOfClass:NSArray.class] || !files.count) { completion(nil, @"E_INVALID_ARGUMENT", @"Expected files to write"); return; }
  for (NSDictionary *file in files) {
    NSString *name = [file isKindOfClass:NSDictionary.class] ? file[@"name"] : nil;
    if (![name isKindOfClass:NSString.class] || ![names firstMatchInString:name options:0 range:NSMakeRange(0, name.length)] || ![file[@"contents"] isKindOfClass:NSString.class]) {
      completion(nil, @"E_INVALID_ARGUMENT", @"Expected files as {name, contents} with plain file names"); return;
    }
  }
  if (NSString *problem = SparkProfilerDirectoryProblem(directory)) { completion(nil, @"E_NOT_FOUND", problem); return; }
  if (!directory) {
    NSString *pattern = [NSTemporaryDirectory() stringByAppendingPathComponent:[SparkProfilerMarker stringByAppendingString:@"-XXXXXX"]];
    // fileSystemRepresentation returns a new buffer on each call: read it once.
    const char *representation = pattern.fileSystemRepresentation;
    std::vector<char> path(representation, representation + strlen(representation) + 1);
    if (!mkdtemp(path.data())) { completion(nil, @"E_NATIVE", [NSString stringWithFormat:@"Could not create a temporary directory: %s", strerror(errno)]); return; }
    directory = [manager stringWithFileSystemRepresentation:path.data() length:strlen(path.data())];
  }
  NSMutableArray<NSString *> *paths = [NSMutableArray new];
  for (NSDictionary *file in files) {
    NSString *path = [directory stringByAppendingPathComponent:file[@"name"]];
    NSError *error;
    if (![[file[@"contents"] dataUsingEncoding:NSUTF8StringEncoding] writeToFile:path options:NSDataWritingWithoutOverwriting error:&error]) {
      BOOL exists = [error.domain isEqual:NSCocoaErrorDomain] && error.code == NSFileWriteFileExistsError;
      completion(nil, exists ? @"E_ALREADY_EXISTS" : @"E_NATIVE", [NSString stringWithFormat:@"Could not write %@: %@", path, error.localizedDescription]);
      return;
    }
    [paths addObject:path];
  }
  completion(@{ @"directory": directory, @"paths": paths }, nil, nil);
}
#endif
