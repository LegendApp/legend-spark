#import <AppKit/AppKit.h>
#import <React/RCTDefines.h>

// The running JavaScript runtimes' hosts, in development builds only: the Developer menu (SparkDeveloperMenu.mm) and the
// profiler (SparkProfiler.mm) act on them. Release builds compile none of it.
#if RCT_DEV
NS_ASSUME_NONNULL_BEGIN
// Main thread. The RCTHost of a running JavaScript runtime: the app's shared runtime (RCTAppDelegate's) for nil, else
// the isolated runtime of @react-native-runtimes' ThreadedRuntime with that name; nil when it is not running.
FOUNDATION_EXPORT id _Nullable SparkRuntimeHost(NSString *_Nullable isolated);
// Main thread. The names of the running isolated runtimes.
FOUNDATION_EXPORT NSArray<NSString *> *SparkIsolatedRuntimeNames(void);
NS_ASSUME_NONNULL_END
#endif
