#import <Foundation/Foundation.h>
#import <React/RCTDefines.h>

// The development profiler's native half (docs/devtools.md#profiling): Hermes's sampling profiler in every JavaScript
// runtime and the frame timeline (SparkFrameTimeline.h). Development builds only: release builds compile none of it.
#if RCT_DEV
NS_ASSUME_NONNULL_BEGIN
typedef void (^SparkProfilerCompletion)(NSDictionary *_Nullable result, NSString *_Nullable code, NSString *_Nullable message);
// Main thread. Whether a recording runs (the Developer menu enables Start or Stop Profiling by it).
FOUNDATION_EXPORT BOOL SparkProfilerRecording(void);
// Main thread. Starts Hermes's sampling profiler for every runtime at `samplesPerSecond` and the frame timeline.
// E_BUSY while recording; E_UNAVAILABLE without a display.
FOUNDATION_EXPORT void SparkProfilerStart(double samplesPerSecond, SparkProfilerCompletion completion);
// Main thread. Stops and collects, from every running runtime on its own JS thread (through its NativeDesktopApp
// module's call invoker): {process, frames (the frame counts), timeline, runtimes: [{runtime ("shared" or an isolated
// runtime's name), startUs (its profile clock at the start), profile (DevTools-format JSON)}]}.
// E_NOT_FOUND when nothing records or `directory` (where the profile will be written) is not an existing directory, in
// which case it keeps recording; E_TIMEOUT when a runtime's JS thread does not answer within 10 s.
FOUNDATION_EXPORT void SparkProfilerStop(NSString *_Nullable directory, SparkProfilerCompletion completion);
// Main thread. Writes `files` ([{name, contents}], names of [A-Za-z0-9._-]) into `directory`, an existing directory, or
// a new one in the temporary directory when nil, never replacing a file: {directory, paths}.
FOUNDATION_EXPORT void SparkProfilerWrite(NSString *_Nullable directory, NSArray *files, SparkProfilerCompletion completion);
NS_ASSUME_NONNULL_END
#endif
