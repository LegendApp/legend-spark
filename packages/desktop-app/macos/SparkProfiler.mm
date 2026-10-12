#import "SparkProfiler.h"
#if RCT_DEV
#import <QuartzCore/QuartzCore.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTCallInvoker.h>
#import <React/RCTCallInvokerModule.h>
#import "SparkDesktop.h"
#import "SparkFrameTimeline.h"
#import "SparkRuntimeHosts.h"
#include <chrono>
#include <hermes/hermes.h>
#include <sstream>
#include <vector>

using facebook::react::CallInvoker;
namespace jsi = facebook::jsi;

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
  SparkFrameTimeline *started = [SparkFrameTimeline startWithMotion:YES error:&error];
  if (!started) { completion(nil, @"E_UNAVAILABLE", error); return; }
  timeline = started;
  startUs = SparkSteadyMicroseconds() - (CACurrentMediaTime() - started.start) * 1e6;
  // Samples every runtime registered for profiling: React Native's Hermes runtimes are (HermesInstance).
  SparkHermesRoot()->enableSamplingProfiler(samplesPerSecond);
  SparkEmit(@{ @"type": @"profiling", @"recording": @YES });
  completion(@"null", nil, nil);
}

static NSDictionary *SparkRuntimeError(NSString *code, NSString *message) { return @{ @"error": @{ @"code": code, @"message": message } }; }

/** On the runtime's JS thread: its samples, or why it has none. */
static NSDictionary *SparkCollect(jsi::Runtime &runtime) {
  auto *hermes = jsi::castInterface<facebook::hermes::IHermes>(&runtime);
  if (!hermes) return SparkRuntimeError(@"E_UNAVAILABLE", @"The JavaScript runtime is not Hermes");
  std::ostringstream stream;
  hermes->sampledTraceToStreamInDevToolsFormat(stream);
  const std::string text = stream.str();
  NSString *profile = [[NSString alloc] initWithBytes:text.data() length:text.size() encoding:NSUTF8StringEncoding];
  return profile ? @{ @"profile": profile } : SparkRuntimeError(@"E_INVALID_DATA", @"Hermes's sampling profile is not valid UTF-8");
}

void SparkProfilerStop(NSString *directory, SparkProfilerCompletion completion) {
  if (!timeline) { completion(nil, @"E_NOT_FOUND", @"No profiling session is recording"); return; }
  // Checked before stopping, so a mistyped folder does not lose the recording.
  if (NSString *problem = SparkProfilerDirectoryProblem(directory)) { completion(nil, @"E_NOT_FOUND", problem); return; }
  SparkHermesRoot()->disableSamplingProfiler();
  NSDictionary *frames = [timeline stop];
  timeline = nil;
  SparkEmit(@{ @"type": @"profiling", @"recording": @NO });
  const auto live = SparkProfiledRuntimes();
  NSMutableArray<NSString *> *names = [NSMutableArray new];
  NSMutableDictionary<NSString *, NSDictionary *> *answers = [NSMutableDictionary new];
  NSMutableDictionary *counts = [frames mutableCopy];
  [counts removeObjectForKey:@"timeline"];
  __block BOOL finished = NO;
  // Main thread. Every runtime that answered keeps its samples; one that did not gets its own E_TIMEOUT entry.
  void (^finish)(void) = ^{
    if (finished) return;
    finished = YES;
    NSMutableArray *runtimes = [NSMutableArray new];
    for (NSString *name in names) {
      NSMutableDictionary *item = [(answers[name] ?: SparkRuntimeError(@"E_TIMEOUT", [NSString stringWithFormat:@"The JavaScript thread did not hand over its samples within %.0f s", SparkProfilerCollectSeconds])) mutableCopy];
      item[@"runtime"] = name;
      [runtimes addObject:item];
    }
    NSDictionary *result = @{ @"process": NSProcessInfo.processInfo.processName, @"frames": counts, @"timeline": frames[@"timeline"], @"runtimes": runtimes };
    // Each profile can be megabytes: encode off the main thread.
    dispatch_async(SparkProfilerQueue(), ^{ completion(SparkJSON(result), nil, nil); });
  };
  for (const auto &entry : live) [names addObject:entry.first];
  if (live.empty()) { finish(); return; }
  const double start = startUs;
  for (const auto &entry : live) {
    NSString *name = entry.first;
    entry.second->invokeAsync([name, start, answers, names, finish](jsi::Runtime &runtime) {
      NSMutableDictionary *item = [SparkCollect(runtime) mutableCopy];
      if (item[@"profile"]) item[@"startUs"] = @(start);
      dispatch_async(dispatch_get_main_queue(), ^{
        answers[name] = item;
        if (answers.count == names.count) finish();
      });
    });
  }
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(SparkProfilerCollectSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), finish);
}
#endif
