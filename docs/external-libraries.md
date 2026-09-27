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

The `/webview` export owns its source, props, events and ref types. Its adapter currently delegates to React Native WebView; applications needing the complete upstream surface can import that package directly. Spark does not forward arbitrary backend props. The `/sqlite` adapter owns `Database`, `SqlExecutor`, row/value and mutation result types. It adds project-scoped storage, queued queries, transaction lifetime and safe numeric/blob conversion; OP-SQLite objects do not cross its public boundary. Specialized OP-SQLite features remain direct upstream integrations. Neither adapter is a template for wrapping new libraries automatically.

Applications should declare libraries they import directly as dependencies and retain the SDK's tested version overrides. The SDK prebuilt profile declares Runtimes; the minimal Windows starter does not require optional libraries. Installed native code is available in prebuilt/dev builds; production selection follows reachable imports and required native dependencies. Check each integration page for its validated platforms and limitations.

Windows also supplies an adapter for `react-native-nitro-modules` 0.35.7. It installs
the portable Nitro C++ runtime and registry through RNW JSI. A library with only
Swift/Kotlin implementations still needs a Windows implementation and native project;
Nitro support does not automatically port every Nitro library.

Windows external-library integrations are implemented in source, with native build
and runtime acceptance pending on x64 and ARM64. The platform runner covers Nitro
object identity and buffers, SQLite persistence and transactions, WebView HTML/URL
loading and messaging, and independent Hermes runtime state, errors, and destruction.
See [known Windows limits](windows-issues.md). Optional OP-SQLite SQLCipher, libSQL,
Turso, and vector builds are not enabled. WebView follows upstream Windows prop
coverage and does not promise macOS-only WebKit features.
