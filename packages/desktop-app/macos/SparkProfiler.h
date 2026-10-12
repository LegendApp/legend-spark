#import "SparkProfilerFiles.h"

// The development profiler's native half (docs/devtools.md#profiling): Hermes's sampling profiler in every JavaScript
// runtime and the frame timeline (SparkFrameTimeline.h); SparkProfilerFiles.h writes the files. Development builds only:
// release builds compile none of it.
#if RCT_DEV
NS_ASSUME_NONNULL_BEGIN
// Main thread. Whether a recording runs (the Developer menu enables Start or Stop Profiling by it).
FOUNDATION_EXPORT BOOL SparkProfilerRecording(void);
// Main thread. Starts Hermes's sampling profiler for every runtime at `samplesPerSecond` and the frame timeline, and
// emits the desktop event {type: "profiling", recording: true}. E_BUSY while recording; E_UNAVAILABLE without a display.
FOUNDATION_EXPORT void SparkProfilerStart(double samplesPerSecond, SparkProfilerCompletion completion);
// Main thread. Stops (emitting {type: "profiling", recording: false}) and collects every running runtime's samples on
// its own JS thread, through its NativeDesktopApp module's call invoker. Completes on SparkProfilerQueue with {process,
// frames (the frame counts), timeline, runtimes}: per runtime ("shared" or an isolated runtime's name) either {runtime,
// startUs (its profile clock at the start), profile (DevTools-format JSON)} or {runtime, error: {code, message}}:
// E_TIMEOUT when its JS thread did not answer within 10 s, E_UNAVAILABLE when it is not Hermes, E_INVALID_DATA when
// Hermes's profile is not UTF-8. E_NOT_FOUND when nothing records or `directory` (where the profile will be written) is
// not an existing directory, in which case it keeps recording.
FOUNDATION_EXPORT void SparkProfilerStop(NSString *_Nullable directory, SparkProfilerCompletion completion);
NS_ASSUME_NONNULL_END
#endif
