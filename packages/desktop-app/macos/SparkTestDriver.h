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
