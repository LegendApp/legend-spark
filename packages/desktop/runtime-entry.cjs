// Spark's application bootstrap. Managed entries require it first, in every JavaScript runtime.
// The worker registry: withDesktop substitutes the app's generated registry for this stub.
require("@legendapp/spark-cli/dist/runtime-entry.cjs");
// Development builds only. Metro inlines __DEV__ and removes these branches, and the network inspector, the profiler and
// the Developer menu with them, from release bundles (tests/developer-menu-release.test.ts).
// The network inspector observes every runtime's requests on macOS (docs/devtools.md#network-inspector), and the profiler
// records every runtime (docs/devtools.md#profiling); Metro inlines Platform.OS, so other platforms' bundles leave them out too.
if (__DEV__ && require("react-native").Platform.OS === "macos") {
  require("@legendapp/spark-desktop-app/src/network-inspector/install").installNetworkInspector();
  require("@legendapp/spark-desktop-app/src/profiler/install").installProfiler();
}
// Isolated runtimes have no menu bar of their own.
if (__DEV__ && !globalThis.__THREADED_RUNTIME_ENV__) {
  // Registered first, so the menu's Open DevTools item starts enabled (docs/devtools.md).
  require("@legendapp/spark-desktop-app/src/devtools-opener").installDevToolsOpener();
  require("@legendapp/spark-native-menu/src/developer-menu").installDeveloperMenu();
}
