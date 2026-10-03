# Windows implementation and acceptance

Updated 2026-09-15. Windows is an integrated framework target. The development
feature groups now have source implementations. **Native compilation and runtime
acceptance are still unverified on both Windows x64 and ARM64.** Generation,
JavaScript bundling, and unit tests never count as native acceptance.

The [public API parity audit](desktop-parity-audit.md) identifies source-level
gaps beneath the feature checklist: app/window lifecycle, launch arguments,
file-dialog options, portable window options, and nested menu targeting. These
need implementation or explicit contract decisions as well as native testing.

## Confirmed Nitro integration blocker and proposed boundary (2026-10-03)

The current adapter calls `ReactContext.JSRuntime()` in
`patches/windows/nitro/windows/SparkNitro/SparkNitro.h`. Pinned RNW 0.81.35's
`Microsoft.ReactNative/IReactContext.cpp` fail-fasts for that call under
`DEBUG && USE_FABRIC`; its `IReactContext.idl` also marks the runtime property
experimental and deprecated for the new architecture.

The narrow supported path in the pinned source is RNW's JSI initializer form:
keep `REACT_INIT(Initialize)`, but declare the method with both
`ReactContext const&` and `facebook::jsi::Runtime&`, then install Nitro directly
from that runtime argument. `Microsoft.ReactNative.Cxx/NativeModules.h` recognizes
two-argument init methods as JSI initializers and registers them with
`AddJsiInitializer`; the runtime is supplied by the initializer boundary. Do not
fetch `context.JSRuntime()` or `context.Handle().JSRuntime()` inside that method.
The latter is the same deprecated `IReactContext.JSRuntime` property and is not a
safe workaround. Keep the existing context call-invoker dispatcher for later
Nitro callbacks.

This is a source-grounded proposal, not a compiled fix. Validate Debug Fabric
startup on Windows x64 and ARM64, verify Nitro HybridObject creation and calls,
exercise callback dispatch/reload, and confirm native buffer ownership before
closing the blocker. No Windows compiler or runtime acceptance was available
for this investigation.

## What remains

1. Run native compilation and the shared acceptance suite on Windows; fix any
   compiler, ABI, OS interaction, or lifecycle failures it exposes.
2. Complete the manual OS checks below on x64 and ARM64, including Parallels,
   mixed-DPI displays, application reload, and another project using the prebuilt
   executable. Keep failed and unexecuted cases visible in exported reports.
3. Standalone production builds, installation/signing, and updates are still
   unimplemented. They were deferred from this internal development scope.

A source implementation is not a claim of complete behavioral parity. The
platform differences and upstream limits below remain part of the API contract.

## Implemented source and required Windows checks

| Area | Windows implementation | Native acceptance still required |
| --- | --- | --- |
| UI and theme | WinUI Button, TextBox, ComboBox in RNW ContentIslands; light/dark/system override | Mouse/keyboard, accessibility, semantic selection, high contrast, theme changes without losing focus/text, and initialization-failure placeholders |
| Files and settings | Scoped directories, text/base64 I/O, atomic writes, metadata, copy/move/remove, recursive directory watch invalidation; persistent settings | Shared lifecycle assertions, restart persistence, permissions, UNC paths, symlinks, cross-volume moves, watcher disposal, nested edits and root replacement |
| Dialogs/context menus | Win32 TaskDialog and popup menus; buttons, checkbox, cancellation, ownership, IDs and state | Keyboard default/cancel, busy rejection, parent modality, mixed-DPI placement, reload while open |
| Drag/drop | Fabric drag source/target, text/files/URLs/custom MIME strings, hover and copy/move/link negotiation, geometry-based hit testing, lifecycle events | Enter/leave/drop coordinates, scrolling/clipping, child controls, cancellation, reload and external drags |
| Recent files/associations | Project history; development-only shell recent files and per-user file/protocol registration | Explorer activation both warm/cold, history persistence/isolation, changed declarations, and conflict rejection |
| Tray/global shortcuts | Shell notification icon with nested menus; RegisterHotKey and conflict detection | Actions, update/remove, other-app focus, reload cleanup, Explorer restart recovery |
| Notifications | Project-scoped toast identity, classic COM activation, scheduling/history/cancellation, response queue | Permission disabled/enabled, visible delivery, live click/dismiss, delayed delivery after exit, cold click into the correct project |
| Windows/menus | Shared React windows, owned/modal windows, close/quit guards, nonactivating overlays, borderless/transparency/shadow options, constraints/fullscreen, menu placement/targeting/payload/accelerators | Modality and owner destruction, focus, close guards, layout/DPI, menu restoration, accelerators and callbacks |
| Processes | CreateProcessW, explicit inherited handles, stdin/stdout/stderr, Job Object cleanup, timeout/termination | PowerShell contract checks, binary output, large streams, descendants, failed spawn, reload during execution |
| System/audio | Info, power/session/theme events, sleep prevention, attention, taskbar badge/Jump List; MediaPlayer and transport controls | Lifecycle and task actions, OS lock/sleep/wake/theme events, playback/seek/end/error/disposal, volume/metadata, independent media-session commands and replacement |
| Browser authentication | Loopback callback listener, registered-URI transport, OS random/SHA-256, timeout/cancellation | Compile shared C++ receiver, system-browser round trip, wrong state/port conflicts, native disposal and URI activation; see [authentication](auth-session.md) |
| Clipboard/storage/links | Text/HTML/RTF/PNG/files; scoped Credential Manager; URI handling and launch queue | Rich-format round trips, malformed content, credential lifecycle, cold/warm activation |
| Nitro | Pinned upstream C++ core, RNW JSI installation, dispatcher, exported C++ registry | Native buffers, HybridObject identity/boxing, async callbacks and reload, a consumer native module |
| SQLite | Pinned OP-SQLite C++/JS plus bundled SQLite; Windows build/lifecycle/path glue | Parameters, blobs, sync/async calls, transactions, persistence, reload, and concurrent worker/main databases |
| WebView | Pinned upstream Fabric WebView2, with startup/navigation/messaging/error fixes | HTML and URL loads, injection/messages, errors, unmount input recovery, resize/clipping and missing WebView2 runtime |
| Secondary runtimes | Real RNW hosts and Hermes heaps using Margelo's native-call transport; native threaded surfaces | Identity/isolation/timers/errors, create/destroy/recreate, native filesystem, reload with work pending, threaded surface input/teardown |
| Development connection | Expo CLI/Metro with a local Windows relay for HTTPS and dev/minify flags | HTTP/HTTPS, certificate trust, source maps, refresh/WebSocket disconnect/reconnect |

The new overlay, recursive-watch and custom-drag contracts and focused acceptance
steps are documented in [desktop foundations](desktop-foundations.md). Windows
composition transparency, nonactivation and drag operation negotiation require
native verification; macOS probe results do not establish Windows acceptance.

## Run and report

```powershell
npm install
npm run test:platform -- --platform windows --timeout 600
npm run test:windows:features -- --project C:\dev\SparkWindowsFeatures
npm run test:windows -- --project C:\dev\SparkWindowsVerification
```

Use a fresh directory for each explicit `--project`. Run in an interactive desktop
session. The shared platform screen runs API checks and provides native interaction
checks for dialogs, menus, tray, shortcuts, notifications, drag/drop, modal windows,
system/taskbar APIs and WebView. Choose **Finish run** afterward. `--api-only`
leaves interactive cases untested. Reports live in `.spark/test-results`;
`npm run test:report` summarizes them. See [platform-testing.md](platform-testing.md).
Clipboard checks temporarily replace content; use a disposable test session.

`test:windows:features` additionally uses UI Automation for controls and tests
concurrent launch forwarding, abandoned-owner recovery, appearance and restart
persistence. A shared project mutex prevents simultaneous clients writing the same
project state. A forwarding timeout reports failure rather than starting a second
owner. The platform runner's prepare-only mode is available on macOS, including
`SPARK_WINDOWS_ARCH=arm64`, and never marks native checks passed.

## Platform differences and limits

- Windows controls render labeled, noninteractive placeholders if their native
  backend cannot initialize. Drag targets and threaded surfaces also expose
  initialization failure. Placeholders preserve layout/labels and never fabricate
  callbacks. Operational failures reject; invalid input remains an error.
- Credential Manager limits a credential blob to 2560 bytes. Rich clipboard data
  is separate from the common text-only restoration performed by the test runner.
  Image-only clipboard writes must preserve the binary PNG payload even when the
  accompanying JSON metadata is empty. Native clipboard round-trip verification
  remains a Windows acceptance requirement.
- OS dialogs, title bars, tray and Jump Lists use Windows styling. AppKit materials,
  titlebar effects, SF Symbols and window-specific macOS styles are not portable;
  unsupported window options still reject. Windows tray items use the executable
  icon/tooltip. Disabled Jump List tasks are omitted, checked tasks use a checkmark
  in the title. Login startup remains unavailable in development, as on macOS.
- Association registration changes only this project's per-user entries; it does
  not change the default file application or overwrite another app's protocol.
  Custom document UTIs need explicit `extensions`. Shell registration points to
  the cached executable; refresh registration after moving/rebuilding it.
- Toast registration creates a project-specific Start menu shortcut and COM
  activation entry. Windows permission is controlled in Settings; requestPermission
  reports that setting. Unpackaged scheduling uses the Community Toolkit's silent,
  immediately removed first-toast identity registration workaround. Windows does
  not launch a closed app on dismissal: dismiss events are available for immediate
  notifications while their module remains alive. Clicks preserve notification ID
  and data through a bounded, deduplicated host response queue. Cold development
  activation needs Metro and the project's saved connection settings. Live toast
  dismissal and timeout retire their native event subscription; a late dismissal
  from a replaced toast cannot retire or report against its replacement. Verify
  dismissal, timeout, and same-ID replacement on Windows before release.
- The SDK packages integrity-checked Nitro 0.35.7, OP-SQLite 18.2.1 and WebView
  16.0.0 with their Windows glue. Consumers do not manually patch node_modules.
  SQLite uses its bundled engine; optional SQLCipher/libSQL/Turso/vector builds are
  not enabled. WebView delegates to upstream's Windows prop coverage; WKWebView-only
  options are not implied. WebView2 must be installed on the testing machine.
- Nitro's C++ DLL exports and include tree support C++ HybridObjects; installing a
  library that only ships Swift/Kotlin does not create a Windows implementation.
  Such libraries still need their own Windows native project and registration.
- Workers use the existing `@react-native-runtimes/core` API and Metro discovery.
  They have separate heaps and reuse registered native package providers. Keep
  UI/window/menu ownership in the main runtime, as in the macOS guidance.
  Shared main-native-module mode (`useMainNativeModules` / `prewarmBusinessRuntime`)
  and routing worker functions back to the main heap are not implemented; unsupported
  requests reject. These optional upstream runtime modes remain integration work. Calls
  fail on destruction/load failure or after 120 seconds, rather than hanging.
  The current macOS guide does not claim validated threaded UI; Windows threaded
  surfaces likewise require explicit visual, input and lifecycle acceptance.
- The pinned RNW 0.81.35 geometry adapter exposes hit testing/client bounds for
  drag/drop without changing existing interface IDs. It fails explicitly if the
  pinned source changes. Native geometry, clipping and scrolling need Windows
  checks. Expo Desktop beta still owns project generation.
- Jump List entries can outlive a crashed process until replaced. HTTPS uses the
  configured trusted CA (`SSL_CRT_FILE` when needed), never disabled verification.
  The relay lives with the CLI session, so cold development launches require it.

For machine setup use [windows-slice.md](windows-slice.md). For moving a built
client/SDK use [sdk-distribution.md](sdk-distribution.md). Record actual Windows
failures here with reproduction steps and evidence before closing acceptance work.

## App-supplied helper bundles (2026-09-16)

The CLI now selects target-specific helper directories and the Windows process
module resolves their entry metadata. Native x64/ARM64 validation is pending: run
the [sidecar probe](sidecars.md#example-and-verification), verify adjacent DLL and
asset loading, and verify Job Object cleanup on root exit, cancellation, runtime
reload, normal quit, and abrupt host termination. Windows distribution signing
and packaging remain separate gaps. The macOS probe does not establish Windows
acceptance.

## Streaming files and Recycle Bin (2026-09-17)

Source implementations now provide bounded positional file handles, pull-based
binary iteration, streaming writes, runtime handle cleanup, and an STA
`IFileOperation` recycle operation with a veto against permanent-delete fallback.
Run Kitchen Sink's **Test streaming files and Trash** on x64 and ARM64. Verify
recovery in Explorer and refusal on a non-recyclable volume, plus denied access,
EOF, early iterator exit, cancellation, and reload cleanup. These additions passed
native macOS checks; Windows build/runtime acceptance remains pending.
