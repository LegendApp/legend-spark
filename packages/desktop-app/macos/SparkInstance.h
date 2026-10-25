#import <Foundation/Foundation.h>

// Per-namespace single-instance ownership and launch forwarding. Foundation and POSIX
// only, so tests/app-instance.native.mm can exercise it across real processes.
//
// `directory` holds three files named after `name`: `.lock` (held for the owner's
// lifetime; the kernel releases it on exit or crash), `.setup` (held only while an
// owner starts listening, so a launch that loses the race always finds a listening
// owner) and `.sock` (the owner's Unix-domain handoff socket).

// A forwarded launch: { arguments: [string], workingDirectory: string, files: [string], urls: [string] }.
typedef void (^SparkInstanceReceiver)(NSDictionary *launch);

// YES: this process owns `name` and `receiver` runs on the main queue for each
// forwarded launch. NO with *error nil: another process owns it. NO with *error: failure.
FOUNDATION_EXPORT BOOL SparkInstanceAcquire(NSString *directory, NSString *name, SparkInstanceReceiver receiver, NSError **error);
// Sends `launch` to the owner. YES only after the owner's receiver has run.
FOUNDATION_EXPORT BOOL SparkInstanceForward(NSString *directory, NSString *name, NSDictionary *launch, NSTimeInterval timeout, NSError **error);
// Validates a decoded launch payload.
FOUNDATION_EXPORT BOOL SparkInstanceValidLaunch(id launch);
// Reuses arguments after the executable, excluding the safe-mode launch flag.
FOUNDATION_EXPORT NSArray<NSString *> *SparkInstanceRelaunchArguments(NSArray<NSString *> *process);
// Starts this executable with `arguments` and SPARK_RELAUNCH_PARENT set to this process.
// Returns the child pid, or 0 with *error.
FOUNDATION_EXPORT pid_t SparkInstanceSpawnRelaunch(NSArray<NSString *> *arguments, NSError **error);
// Blocks until `pid` has exited (immediately when it already has).
FOUNDATION_EXPORT BOOL SparkInstanceWaitForExit(pid_t pid, NSError **error);
