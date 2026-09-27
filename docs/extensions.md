# Adding and replacing integrations

An application can use ordinary React Native and Expo libraries directly. Add a
framework-level adapter when it gives callers a stable contract across different
platform implementations. The adapter should export only that contract; it should
not forward every feature of every backend.

## Add an existing library

1. Install the library in the application using its documented Expo/RN procedure.
   Keep this framework's pinned Expo 54 / RN 0.81 / Expo Desktop beta matrix.
2. Add any Expo config plugin under `expo.plugins`, or under
   `expoByPlatform.<platform>.plugins` when platform-specific. The framework delegates
   generation to Expo or Expo Desktop using its configured template.
3. Configure `expoByPlatform.<platform>.autolinking.exclude` for implementations that
   should not link on that target. Keep a platform implementation in JS when the
   feature belongs in shared screens. Unsupported native operations should reject
   with `E_UNAVAILABLE`; unavailable controls should show a labeled placeholder.
4. Run the selected target. A missing or changed native module requires a custom
   development build (`spark build --dev --platform macos`, or `windows`). The
   development session checks native signatures before loading JS. Do not disable
   the compatibility gate to make a library appear to work in an older Spark Runner.

See `@legendapp/spark-audio` for a real adapter with mobile Expo delegation, HTML on
web, and native desktop backends. See AsyncStorage in the examples for a library
that keeps its own import and implementation. No framework wrapper is necessary
merely to rename an external package.

Before designing a public capability, follow the [API design rules](api-design.md)
for imperative cores, optional hooks, ownership, and required contract tests.

## Write a native module

Use the existing `fixtures/native-greeting` package as the minimal TurboModule
example. Put a typed `Native<Name>.ts` spec under `src/`, give its package a
`codegenConfig`, and supply the platform's native project. A macOS implementation
has a podspec and Objective-C++ provider; a Windows implementation has an RNW
library project and `ReactPackageProvider`. The new `packages/audio` demonstrates
both using the pinned RNW Composition target.

Declare real native dependencies in `dependencies` and in `spark.requires` where
needed for desktop selection. `spark.platforms` describes implementations; it is
not proof of platform acceptance. `spark.nativeModules` names actual native
bindings. Internal curated packages set `spark.sdk`; third-party packages should
not claim that flag just to bypass a custom build. Native libraries also need to
be included in the package's `files` list so installed consumers receive source.

Platform entry files (`index.ios.ts`, `index.android.ts`, `index.windows.ts`,
`index.web.ts`, and the macOS/default entry) must not eagerly import another
platform's enforcing native binding. Shared helpers live in a separately named
file, rather than re-exporting `./index` from `index.windows` and creating a Metro
resolution cycle. Import type-only contracts without loading a backend.

## Replace an implementation

Keep the public types and observable behavior stable, replace the platform entry's
backend, and update native dependency/config selection. Check cancellation, error
codes, units, callbacks, cleanup, and data compatibility against the same consumer.
Remove the old native dependency when it is no longer used. Rebuild the prebuilt profile
if the curated native graph changed; existing clients must fail compatibility checks
rather than loading the new code against stale native bindings.

Use the standalone example that exercises the contract for acceptance. Create it
from packed SDK archives outside this checkout, typecheck it, bundle each platform,
and run the relevant native path. Model tests cannot establish native behavior.

The framework does not supply Node in Hermes. Keep filesystem/process access behind
native desktop modules and leave business logic in shared JS. For an Electron/RN
migration, reuse screens and models first, then replace Electron-specific adapters
with the public desktop modules or an application-owned native integration.
