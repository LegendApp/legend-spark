#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Crash capture for the app's own process, stored locally. Free of React Native, so
// tests/crash-reporting.native.mm drives it directly. Design: docs/crash-reporting.md.
//
// Signal handlers (SIGABRT, SIGBUS, SIGFPE, SIGILL, SIGSEGV, SIGSYS, SIGTRAP) write a minimal text record
// with no allocation, lock or Objective-C, then restore the handler that was there before and let the
// signal take its course, so the previous handler, the system crash reporter and a debugger still see it.
// The record is symbolicated into a JSON report by a later process (normally the next launch).

/** ~/Library/Logs/<bundle identifier, or the process name>/Crashes: where the app keeps its reports. */
FOUNDATION_EXPORT NSString *SparkDefaultCrashDirectory(void);

/** The user's consent, kept in the app's defaults. Off unless the app turned it on. */
FOUNDATION_EXPORT BOOL SparkCrashConsent(void);
FOUNDATION_EXPORT void SparkSetCrashConsent(BOOL enabled);

/**
 * Installs the signal handlers and the uncaught-exception handler once per process; later calls do
 * nothing (the first directory stays). Gives the calling thread an alternate signal stack, so a stack
 * overflow on it is recorded too. Call it on the main thread.
 */
FOUNDATION_EXPORT void SparkInstallCrashHandlers(NSString *directory);
/** Whether installed handlers record. Off: they only pass the signal on. JavaScript errors follow it too. */
FOUNDATION_EXPORT BOOL SparkCrashRecording(void);
FOUNDATION_EXPORT void SparkSetCrashRecording(BOOL recording);

/**
 * Turns records of processes that have exited into JSON reports, symbolicated with this process's
 * symbol tables, then returns every report in `directory`, newest first.
 */
FOUNDATION_EXPORT NSArray<NSDictionary *> *_Nullable SparkCrashReports(NSString *directory, NSError **error);
/** Deletes the reports with these ids, or every report and unprocessed record when `ids` is nil. Unknown ids are ignored. */
FOUNDATION_EXPORT BOOL SparkDeleteCrashReports(NSString *directory, NSArray<NSString *> *_Nullable ids, NSError **error);
/**
 * Writes a JavaScript error as a report: `error` is { source, fatal, name, message, stack? }. Synchronous,
 * so a fatal error is on disk before the default handler ends the process. Returns the report's id.
 */
FOUNDATION_EXPORT NSString *_Nullable SparkRecordJavaScriptCrash(NSString *directory, NSDictionary *error, NSError **outError);
/**
 * Starts this app's executable as a helper process that installs the handlers into `directory` and
 * crashes in the given way ("badAccess", "abort", "uncaughtException", "trap" or "stackOverflow"); its handler exits
 * after writing the record, so the system crash reporter does not see it. Waits up to 30 s, then returns
 * the helper's report. Only with SPARK_TEST_DRIVER (Debug, or macos.testDriverInRelease); otherwise E_UNAVAILABLE.
 */
FOUNDATION_EXPORT NSDictionary *_Nullable SparkSimulateCrash(NSString *directory, NSString *kind, NSError **error);

/** Crashes this process in the given way; returns only for an unknown kind. */
FOUNDATION_EXPORT void SparkCrashNow(const char *kind);

// Error codes for NSError userInfo[SparkCrashCodeKey]: SparkDesktopErrorCode values.
FOUNDATION_EXPORT NSString *const SparkCrashCodeKey;

NS_ASSUME_NONNULL_END
