#import <AppKit/AppKit.h>
#import <React/RCTDefines.h>

// React Native DevTools, in development builds only (docs/devtools.md). Release builds compile none of it.
#if RCT_DEV
NS_ASSUME_NONNULL_BEGIN
// The development server lists each JS runtime as its own debug target (the devtools-targets
// config-plugin patch of RCTHost): "<CFBundleName> (shared runtime)" or
// "<CFBundleName> (isolated runtime: <name>)". `runtime` nil is the shared runtime.
FOUNDATION_EXPORT NSString *SparkDevToolsTargetTitle(NSString *_Nullable runtime);
// Call once at startup with the main runtime's loaded bundle URL; its server hosts the targets.
// Installs ⌥⌘I, which opens DevTools for the shared runtime.
FOUNDATION_EXPORT void SparkInstallDevTools(NSURL *_Nullable (^bundleURL)(void));
// Main thread. Finds the runtime's target at the development server and asks the server to open
// DevTools for it. `completion` runs on the main queue once the server has the request (code nil),
// or with E_UNAVAILABLE (no development server) or E_NOT_FOUND (no such target) and a message.
// openDevTools (and so the Developer menu's Open DevTools item) calls this.
FOUNDATION_EXPORT void SparkOpenDevTools(NSString *_Nullable runtime, void (^completion)(NSString *_Nullable code, NSString *_Nullable message));
NS_ASSUME_NONNULL_END
#endif
