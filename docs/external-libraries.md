# Integrated external libraries

The framework owns public contracts for capabilities it makes work across platforms. Their implementations can be framework modules, Expo modules, or community libraries. Library-specific APIs retain upstream ownership: prefer imports from the original package and use its documentation. Native setup, version pinning, prebuilt support and production pruning do not by themselves require a new JavaScript API.

The [clipboard, secure-storage, and linking adapters](expo-api-adapters.md) implement the first small shared contracts. The larger [universal API plan](universal-api-plan.md) remains deferred. Neither direction implies reexporting every dependency.

## Public contracts and replaceable implementations

The agreed direction is one application codebase for web, mobile, and desktop, with a curated framework API. Expo provides familiar contracts where their semantics fit. Framework-owned desktop capabilities and explicit platform extensions remain useful alongside those shared contracts.

- Keep implementations behind capability-level platform adapters. Do not expose the native bridge or backend-specific objects as part of a backend-independent contract.
- Document the supported methods, options, results, errors, lifecycle, and platform limitations. Similar method names alone do not establish compatibility with a complete Expo module.
- Own the shared type contract and verify observable behavior. Narrow upstream reexports are acceptable where they satisfy that contract; they must not accidentally expand the promise when an upstream package changes.
- Keep dependencies modular and platform imports safe. Using one capability must not require every optional module or evaluate another platform's native code.
- Retain direct upstream imports for library-specific functionality, including React Native primitives, database APIs, and routing. Add a framework UI export only where it supplies a meaningful shared component contract.

Our own native implementation can supply a capability initially. As Expo or community support develops, replace it when the candidate meets the contract and improves functionality, reliability, maintenance, or dependency cost. Run the same acceptance cases against the replacement. Preserve specialized desktop behavior separately if the upstream library does not cover it. A backend swap must preserve application imports and promised behavior; otherwise it is an explicit API migration.

Eventually a library may be suitable enough that direct upstream imports become the recommendation. That requires a documented, gradual migration rather than silently removing the framework contract. Adoption or popularity alone is not a reason to replace a working backend.

## Migration paths

| Starting application | Intended path |
| --- | --- |
| Expo mobile app adding desktop | Keep supported upstream imports; adopt framework adapters for individual missing cross-platform capabilities. |
| Electron desktop app | Map native capabilities to framework APIs and adapt the UI/runtime deliberately. Do not promise Electron's process, preload, `webContents`, or general Node runtime compatibility. |
| Existing Electron desktop and React Native mobile apps | Share application logic through capability contracts incrementally. An Electron backend could support staged adoption, but none is implemented or committed to by this policy. |

The current individual capability packages remain the supported shared import locations. New umbrella names, universal starters, Router/window integration, and a broad UI catalog are deferred design work.

## External integrations

Our documentation provides a shared place to discover integrations, with attribution and the desktop-specific setup and limitations. Upstream documentation remains the reference for upstream APIs. Compatibility patches stay explicit and separate from framework behavior.

| Library | Upstream import | Desktop integration |
| --- | --- | --- |
| [Margelo Runtimes](https://github.com/margelo/react-native-runtimes) | `@react-native-runtimes/core` | Independent Hermes workers; SDK pins and macOS/Windows adapters; automatic Metro/host setup; prebuilt inclusion and production pruning. See [Runtimes](runtimes.md). |
| [React Native WebView](https://github.com/react-native-webview/react-native-webview) | `react-native-webview` | macOS WebKit and upstream Windows Fabric WebView2; pinned SDK version with explicit Windows fixes. See [WebView integration](desktop-api-expansion.md#webview-and-sqlite). |
| [OP-SQLite](https://github.com/OP-Engineering/op-sqlite) | `@op-engineering/op-sqlite` | Native SQLite; Windows RNW JSI adapter with Unicode paths and per-runtime installation state; macOS production selection. See [SQLite integration](desktop-api-expansion.md#webview-and-sqlite). |
| [VisionCamera](https://github.com/mrousavy/react-native-vision-camera) | `react-native-vision-camera` | App-owned dependency with automatic version-pinned macOS patches for VisionCamera, Nitro Image, and shared Nitro. See [Camera](camera.md). |
| [MMKV](https://github.com/mrousavy/react-native-mmkv) | `react-native-mmkv` | Install 4.3.2 in the app. Spark patches its macOS storage folder from `~/Documents/mmkv` to the app's namespaced Application Support folder; other versions build unpatched. |
| [Unistyles](https://github.com/jpudysz/react-native-unistyles) | `react-native-unistyles` | Install 3.6.0 in the app. Spark patches in an AppKit runtime: window size, backing scale, appearance (adaptive themes) and RTL; insets, status/navigation bars and the keyboard report zero. |
| [Quick Crypto](https://github.com/margelo/react-native-quick-crypto) | `react-native-quick-crypto` | Install 1.1.9 with `react-native-quick-base64` 3.0.1. Spark patches Quick Crypto's PBKDF2 `endian.h` include for macOS and adds macOS to Quick Base64's podspec. |
| [Nitro Fetch](https://github.com/margelo/react-native-nitro-fetch) | `react-native-nitro-fetch` | Install 1.9.0. Spark adds macOS to its podspec and runs its launch prefetch on `NSApplicationDidFinishLaunching`. Its peer range asks for Nitro 0.37.1; it runs on Spark's 0.37.0. |
| [Blur](https://github.com/Kureev/react-native-blur) | `@react-native-community/blur` | Install 4.4.1. Spark patches in AppKit `BlurView`/`VibrancyView` on `NSVisualEffectView` materials (`blurAmount` has no macOS equivalent) and declares the components in its codegen config so Fabric registers them. |
| [Worklets Core](https://github.com/margelo/react-native-worklets-core) | `react-native-worklets-core` | Install 1.6.3. Spark adds macOS to its podspec; the native code is platform-neutral. Its Babel plugin needs `@babel/plugin-proposal-optional-chaining`, `@babel/plugin-proposal-nullish-coalescing-operator` and `@babel/plugin-transform-template-literals` installed, as on iOS; scope it to your worklet files if the app also uses Skia without Reanimated. |
| [FastImage](https://github.com/DylanVann/react-native-fast-image) | `react-native-fast-image` | Install 10.9.9. Its native view is UIKit only, so on macOS Spark adds a JavaScript stand-in on React Native's `Image`: sources, `objectFit`, `tintColor`, placeholders while loading, load events, `reload()` and `preload`. Its own caches, thumbhash/blurhash placeholders, transitions and cache APIs are not available on macOS. |
| [Release Profiler](https://github.com/margelo/react-native-release-profiler) | `react-native-release-profiler` | Install 0.4.5. Spark adds macOS to its podspec and writes traces to the app's namespaced Caches folder instead of the shared `~/Library/Caches`. |
| [Tracking Transparency](https://github.com/mrousavy/react-native-tracking-transparency) | `react-native-tracking-transparency` | Install 0.1.2. Spark builds it on macOS 11+ with AppKit's app-activation check and lets its JavaScript call the native module on macOS. Requesting needs `NSUserTrackingUsageDescription` in `desktop.config.json`'s `macos.infoPlist`. |
| [Skia](https://github.com/Shopify/react-native-skia) | `@shopify/react-native-skia` | Supports macOS upstream (2.14.0 verified, no patch). Without Reanimated, keep other worklet Babel plugins (such as Worklets Core's) off Skia's sources: they read Skia's optional Reanimated proxy at load and the app never renders. |
| [Blurhash](https://github.com/mrousavy/react-native-blurhash) | `react-native-blurhash` | Install 2.1.3. Spark patches in an AppKit view (layer contents with `resizeMode` as contents gravity), the NSImage decoder and encoder, and the codegen component provider. |
| [Screen Corner Radius](https://github.com/mrousavy/react-native-screen-corner-radius) | `react-native-screen-corner-radius` | Install 0.2.3. Its native module is iOS only; Spark's patch makes the import report 0 instead of throwing where the module is missing. |
| [Nitro SQLite](https://github.com/margelo/react-native-nitro-sqlite) | `react-native-nitro-sqlite` | Supports macOS upstream (10.2.0 verified, no patch). Databases live in `~/Library/Application Support/<bundle id>`. Its SQLite symbols are prefixed, so it links beside Spark's OP-SQLite. |
| [App Logs](https://github.com/kirillzyusko/react-native-app-logs) | `react-native-app-logs` | Install 0.3.1. Spark adds macOS 12+ to its podspec and points macOS at its iOS bindings; it reads the app's own entries from OSLogStore. |
| [Nitro ZXing](https://github.com/margelo/react-native-vision-camera-zxing) | `react-native-nitro-zxing` | Install 0.3.0. Spark adds macOS to its podspec; it builds on Spark's patched VisionCamera 5 and Nitro Image, and scans still images (verified) and camera frames. |
| [Safe Area Context](https://github.com/AppAndFlow/react-native-safe-area-context) | `react-native-safe-area-context` | Supports macOS upstream (5.6.2, Expo SDK 55's pin, verified; no patch). Insets come from the provider view's `NSView.safeAreaInsets`: 0 in a standard window. |
| [Keep Awake](https://docs.expo.dev/versions/latest/sdk/keep-awake/) | `expo-keep-awake` | Declare 55.0.8 in the app. Upstream builds on macOS but does nothing there; Spark's patch holds a `ProcessInfo` activity that disables idle display and system sleep while activated. |
| [Screens](https://github.com/software-mansion/react-native-screens) | `react-native-screens` | Install 4.23.0. Its native containers are UIKit only; on macOS Spark points every component with a web version at that plain-view implementation, and keeps the iOS-only pod out of codegen. |
| [Reanimated](https://github.com/software-mansion/react-native-reanimated) | `react-native-reanimated`, `react-native-worklets` | Supports macOS upstream (4.2.1 and 0.7.4, Expo SDK 55's pins, verified; no patch). `babel-preset-expo` adds the worklets Babel plugin when `react-native-worklets` is installed. |
| [Gesture Handler](https://github.com/software-mansion/react-native-gesture-handler) | `react-native-gesture-handler` | Supports macOS upstream (2.30.0, Expo SDK 55's pin; no patch). Verified registration and mounting; pointer gestures were checked by hand only. |

The `/webview` export owns its source, props, events and ref types. Its adapter currently delegates to React Native WebView; applications needing the complete upstream surface can import that package directly. Spark does not forward arbitrary backend props. The `/sqlite` adapter owns `Database`, `SqlExecutor`, row/value and mutation result types. It adds project-scoped storage, queued queries, transaction lifetime and safe numeric/blob conversion; OP-SQLite objects do not cross its public boundary. Specialized OP-SQLite features remain direct upstream integrations. Neither adapter is a template for wrapping new libraries automatically.

Applications should declare libraries they import directly as dependencies and retain the SDK's tested version overrides. The SDK prebuilt profile declares Runtimes; the minimal Windows starter does not require optional libraries. Installed native code is available in prebuilt/dev builds; production selection follows reachable imports and required native dependencies. Check each integration page for its validated platforms and limitations.

Windows also supplies an adapter for `react-native-nitro-modules` 0.37.0. It installs
the portable Nitro C++ runtime and registry through RNW JSI. A library with only
Swift/Kotlin implementations still needs a Windows implementation and native project;
Nitro support does not automatically port every Nitro library.

Windows external-library integrations are implemented in source, with native build
and runtime behavior not yet verified on x64 and ARM64. The platform runner covers Nitro
object identity and buffers, SQLite persistence and transactions, WebView HTML/URL
loading and messaging, and independent Hermes runtime state, errors, and destruction.
See [known Windows limits](windows-issues.md). Optional OP-SQLite SQLCipher, libSQL,
Turso, and vector builds are not enabled. WebView follows upstream Windows prop
coverage and does not promise macOS-only WebKit features.

## Optional backend dependencies

Apps using `/markdown`, `/html`, `/webview`, or `/sqlite` must install the matching
optional peer: `react-native-enriched-markdown@1.1.1`,
`react-native-enriched-html@1.1.1`, `react-native-webview@16.0.0`, or
`@op-engineering/op-sqlite@18.2.1`. Starter overrides pin compatibility without
installing these libraries. `spark doctor` reports missing app declarations or
installations for these imports. Keep the SDK archive overrides for WebView and
SQLite; see the installed UPGRADING.md. Nitro Modules and Runtimes remain hard
core dependencies, as do utilities and tooling used at runtime. Type-only tooling
belongs in development dependencies.

Universal apps targeting Windows must exclude `react-native-enriched-html` and
`react-native-enriched-markdown` in `expoByPlatform.windows.autolinking.exclude`
in `desktop.config.json`, because these backends have no Windows implementation.

For installed Enriched Markdown and HTML backends, Spark applies their
checked-in compatibility patches automatically, using the install
and native-preparation boundaries. Direct app declarations activate config hooks;
desktop discovery also supports backends reached through app dependency edges.
Applications do not need a package-manager patch declaration. Reinstalls and disabled install scripts are
handled by native preparation. The backends remain ordinary npm dependencies;
their implementations are not extracted into the Spark archive. Production builds
can prune their native modules when unused. Upstream Markdown already supports
macOS; its patch adds fixes and extensions, including list Tab/Shift-Tab
indentation, rich HTML paste as Markdown, and trailing whitespace preservation
on paste.

Markdown math and syntax-highlighting assets retain the upstream per-application
configuration (`enriched-markdown` in the application's `package.json`). Those
features can download and compile additional assets; automatic compatibility
patching does not change that configuration.
