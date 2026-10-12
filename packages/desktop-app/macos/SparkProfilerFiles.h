#import <Foundation/Foundation.h>
// RCT_DEV comes from React Native; tests/profiler-files-native.test.ts compiles this with a stand-in.
#import <React/RCTDefines.h>

// Where the development profiler (SparkProfiler.h) writes its files. Development builds only: release builds compile
// none of it.
#if RCT_DEV
NS_ASSUME_NONNULL_BEGIN
// `json` is the JSON result on success; otherwise `code` and `message` say why. Promise blocks take it from any thread.
typedef void (^SparkProfilerCompletion)(NSString *_Nullable json, NSString *_Nullable code, NSString *_Nullable message);
// Every file the profiler writes starts with this (PROFILER_MARKER in src/profiler/marker.ts); the release-safety probe
// (DEVT-REL-05) fails a release build whose native code or JavaScript contains it.
FOUNDATION_EXPORT NSString *const SparkProfilerMarker;
// The serial background queue that encodes profiles and writes them, so multi-megabyte payloads stay off the main thread.
FOUNDATION_EXPORT dispatch_queue_t SparkProfilerQueue(void);
// Why `directory` cannot take a profile (it is not an absolute path to an existing directory), or nil. nil is the default.
FOUNDATION_EXPORT NSString *_Nullable SparkProfilerDirectoryProblem(NSString *_Nullable directory);
// Any thread. On SparkProfilerQueue, parses `args` ({directory?, files: [{name, contents}]}, names of [A-Za-z0-9._-]
// that do not start with a dot) and writes the files into `directory`, an existing directory, or into a new directory in
// the temporary directory when it is absent. It never replaces a file: if any name exists, it writes none
// (E_ALREADY_EXISTS). Completes on that queue with {directory, paths}, or E_INVALID_ARGUMENT, E_NOT_FOUND, E_NATIVE.
FOUNDATION_EXPORT void SparkProfilerWrite(NSString *args, SparkProfilerCompletion completion);
NS_ASSUME_NONNULL_END
#endif
