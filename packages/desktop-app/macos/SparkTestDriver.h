#import <AppKit/AppKit.h>

// In-app test driver for the release gate (docs/test-driver.md). Inert unless the
// gate runner launches the app with SPARK_TEST_DRIVER_DIR naming a private run
// directory that holds a one-time token. Main-thread confined.

// Call first in applicationWillFinishLaunching:. Returns YES in driver mode, where
// the app never activates and its windows are rendered without being shown.
FOUNDATION_EXPORT BOOL SparkTestDriverStart(void);
FOUNDATION_EXPORT BOOL SparkTestDriverActive(void);
// The host reports each mounted UI transaction; captures wait until mounts settle.
FOUNDATION_EXPORT void SparkTestDriverDidMount(void);
// YES once the runner's session has ended: that termination is teardown, not a user quit,
// so the host terminates without running the app's quit guards.
FOUNDATION_EXPORT BOOL SparkTestDriverEnding(void);

// Driver commands owned by optional modules, which the driver itself cannot link (for
// example motion's virtual clock: setClock, advanceClock). Handlers run on the main thread
// and must call `reply` exactly once with {"ok": true, ...} or
// {"ok": false, "error": {"code", "message"}}. Built-in commands cannot be replaced.
typedef void (^SparkTestDriverReply)(NSDictionary *reply);
typedef void (^SparkTestDriverHandler)(NSDictionary *request, SparkTestDriverReply reply);
FOUNDATION_EXPORT void SparkTestDriverRegisterCommand(NSString *name, SparkTestDriverHandler handler);

// Hooks for optional modules (main thread). The first visible view with this accessibility identifier (React
// Native testID) in any window, or nil.
FOUNDATION_EXPORT NSView *SparkTestDriverFindView(NSString *testID);
// `observer` runs before the driver delivers input or a deep link or file (tap, hover, drag, scroll, pressKey,
// typeText, navigate, openFile), so a module can tell what that input caused (motion's waitForMotion).
FOUNDATION_EXPORT void SparkTestDriverObserveInput(dispatch_block_t observer);
// `wrapper` runs around every in-process render of `capture` and must call `render` exactly once, synchronously.
// Motion uses it to render the presented frame of running animations rather than their final values.
typedef void (^SparkTestDriverRenderWrapper)(dispatch_block_t render);
FOUNDATION_EXPORT void SparkTestDriverWrapRender(SparkTestDriverRenderWrapper wrapper);
