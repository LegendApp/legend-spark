#import <Foundation/Foundation.h>
// RCT_DEV comes from React Native; tests/profiler-devtools-native.test.ts compiles this with a stand-in.
#import <React/RCTDefines.h>

// React Native DevTools' recordings, which share Hermes's one sampling profiler with Spark's (docs/devtools.md#with-react-native-devtools).
// Every CDP request reaches the app over React Native's inspector connection to the development server
// (RCTCxxInspectorWebSocketAdapter); this watches the requests that start and stop sampling (Profiler.start/stop, the
// JavaScript profiler, and Tracing.start/end, the Performance panel) per debugged page. While Spark records, it answers
// them itself with a CDP error, so DevTools neither restarts nor stops Spark's sampling. Development builds only.
#if RCT_DEV
NS_ASSUME_NONNULL_BEGIN
// Main thread. What DevTools is recording ("the JavaScript profiler (Profiler.start)", "a Performance panel trace
// (Tracing.start)", or both), or nil when it records nothing.
FOUNDATION_EXPORT NSString *_Nullable SparkProfilerDevToolsRecording(void);
// Main thread. One message the inspector connection received from the development server; `sparkRecording` is whether
// Spark's profiler records. Returns whether to pass it on. A start or stop that would touch Spark's recording gets
// `reply` (a CDP error to the same request, wrapped for the development server) instead. `orphaned` is set when a
// page's session ended (`connect` again or `disconnect`) while it recorded and no other page records: its sampling is
// still on, which nothing would turn off.
FOUNDATION_EXPORT BOOL SparkProfilerInspectorReceived(NSString *message, BOOL sparkRecording, NSString *_Nullable *_Nonnull reply, BOOL *orphaned);
// Main thread. The inspector connection closed or failed: every page's session ended. Returns whether that orphaned a
// DevTools recording, as SparkProfilerInspectorReceived does.
FOUNDATION_EXPORT BOOL SparkProfilerInspectorClosed(BOOL sparkRecording);
// Routes `adapter`'s (React Native's RCTCxxInspectorWebSocketAdapter) received messages and closes through the two
// functions above, sending replies over its socket, and calls `orphaned` when a recording was orphaned. Returns why it
// cannot (no such class, or one without the socket delegate methods), or nil.
FOUNDATION_EXPORT NSString *_Nullable SparkProfilerWatchInspector(Class _Nullable adapter, BOOL (^recording)(void), void (^orphaned)(void));
NS_ASSUME_NONNULL_END
#endif
