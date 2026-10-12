// Spark's application bootstrap. Managed entries require it first, in every JavaScript runtime.
// The worker registry: withDesktop substitutes the app's generated registry for this stub.
require("@legendapp/spark-cli/dist/runtime-entry.cjs");
// Development builds only. Metro inlines __DEV__ and removes this branch, and the Developer menu with it,
// from release bundles (tests/developer-menu-release.test.ts). Isolated runtimes have no menu bar of their own.
if (__DEV__ && !globalThis.__THREADED_RUNTIME_ENV__) {
  // Registered first, so the menu's Open DevTools item starts enabled (docs/devtools.md).
  require("@legendapp/spark-desktop-app/src/devtools-opener").installDevToolsOpener();
  require("@legendapp/spark-native-menu/src/developer-menu").installDeveloperMenu();
}
