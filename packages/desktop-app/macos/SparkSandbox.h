#import <Foundation/Foundation.h>

// Whether this process runs in the App Sandbox: it is signed with com.apple.security.app-sandbox (docs/app-sandbox.md).
// Read once from the process's own signature; any thread. No React, so the test driver's native tests compile it.
FOUNDATION_EXPORT BOOL SparkSandboxed(void);
