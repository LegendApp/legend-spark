# macOS / Windows public API parity audit

Audited 2026-09-16 against `a54e984`. This is a source-contract audit, not native
acceptance. No Windows build or runtime passes are implied. Scope: public desktop
exports, `/ui`, audio, and the bundled external-library integration boundaries.
Production distribution remains a separate workstream.

The feature checklist is too coarse to establish parity. Most modules have native
handlers on both platforms, but several options, results, and events differ.
The findings below are concrete source differences; proposed fixes are not yet
implemented. Runtime/lifecycle correctness still requires the shared acceptance
suite on both platforms.

## Confirmed gaps, in implementation priority order

### 1. Application lifecycle, visibility, and launch context

- `onAppEvent` accepts `activate` and `deactivate`. macOS emits both; Windows
  emits window `focus`/`blur` instead, which the app-event filter excludes.
  Add app activation transitions without falsely reporting app deactivation when
  switching between two windows of the same app.
- `hide()` hides the entire application on macOS but only the main window on
  Windows. Secondary windows can remain visible. Define application-wide hide
  and activation/restoration behavior, preserving which windows were already hidden.
- `getAppContext().launchArguments` contains process arguments on macOS and an
  unconditional empty array on Windows. Populate it from the actual launch;
  distinguish initial arguments from later forwarded activations.
- macOS emits `reopen`; Windows needs an explicit equivalent/unsupported contract
  for shell and second-instance activation rather than assuming identical OS events.

Evidence: [shared API](../packages/desktop-app/src/api.ts),
[macOS events](../packages/desktop-host/AppDelegate.mm),
[macOS calls](../packages/desktop-app/macos/RNDesktopApp.mm),
[macOS context](../packages/desktop-app/macos/SparkDesktop.mm),
[Windows application host](../packages/desktop-host/windows/application.inc)
(`WindowProc`, `SparkDesktopApp::call`).

Acceptance: two visible windows plus one intentionally hidden window; switch
focus within/outside the app; hide/activate; launch with arguments; forward a
second launch. Assert callbacks and visibility, not just resolved promises.

### 2. Window operations and lifecycle events

- Reopening an existing secondary-window ID shows it on macOS; Windows rejects
  it. Choose one contract, preferably reuse/show to match existing macOS behavior.
- macOS `showWindow` deminiaturizes; Windows uses `AppWindow.Show()` without the
  explicit restoration used elsewhere in the Windows host. Treat minimized-window
  restoration as an unresolved behavior requiring an explicit implementation/test.
- macOS emits `opened`, `screenChanged`, `enterFullscreen`, and `leaveFullscreen`.
  The Windows host has no corresponding emissions. It does emit focus, blur,
  move, resize, beforeClose, and closed. Add the missing lifecycle notifications.
- Defaults differ: secondary windows default to 640×480 and the project name on
  macOS, versus 800×600 and `Window` on Windows. Centralize shared defaults.
- Close-guard behavior differs: Windows uses request IDs and a 30-second native
  timeout; the macOS secondary-window delegate emits no request ID or equivalent
  timeout. Specify a shared pending/stale-response policy, including reload.
- Missing/invalid-parent errors differ (`E_NOT_FOUND`, `E_BUSY`, generic invalid
  argument). Define portable error codes for callers that recover from failures.

Evidence: [shared window API](../packages/desktop-windows/src/api.ts),
[macOS window manager](../packages/desktop-windows/macos/RNDesktopWindows.mm),
[Windows host](../packages/desktop-host/windows/application.inc).

Acceptance: duplicate open, minimized show, fullscreen round trip, movement
between displays, delayed/rejected close handlers, and missing parents. Verify
event order/count and errors on both platforms. Source absence proves missing
emissions; OS-dependent restoration behavior still needs execution.

### 3. File-dialog options are silently ignored on Windows

The public open options include `directoryURL`, `prompt`, `message`, and
`canChooseFiles`. macOS consumes them; the Windows picker does not. Save's
`directory` is also ignored. When `canChooseDirectories` is true Windows always
uses folder mode, so the macOS mixed file/folder selection contract is not met.

Implement initial directories and the confirmation label. Define an explicit
policy for explanatory text and mixed file/folder selection. If an option cannot
be honored, reject it clearly or expose a documented platform limitation; do not
silently change the request. Test extension filters separately from macOS type
identifiers: Windows currently constructs `*.${type}` literally.

`revealInFinder` rejects on Windows. Its name is macOS-specific, so this is not a
promise of Explorer support, but a portable reveal operation would fill a useful
framework gap. Preserve the existing export as an alias if adding one.

Evidence: [public options](../packages/file-dialog/src/index.ts),
[macOS picker](../packages/file-dialog/ios/RNFileDialog.mm),
[Windows picker](../packages/file-dialog/windows/SparkFileDialog/SparkFileDialog.h).

Acceptance: non-default starting directories, custom confirmation text, file-only,
folder-only and mixed requests, cancellation, filters, and Explorer reveal if added.

### 4. Portable window options are rejected alongside AppKit-specific options

The Windows runtime allowlist only accepts title, dimensions/constraints,
resizable, minimizable, and alwaysOnTop. It rejects `closable`, `appearance`,
`backgroundColor`, and `restoreFrame`, as well as transparency/shadow/titlebar
options. The comment classifying everything else as AppKit-only is inaccurate.
Windows has main-window startup frame restoration, but that does not implement
the secondary-window `restoreFrame` API.

Start with closability, per-window appearance/background, and secondary-window
frame persistence. Separately design supported Windows titlebar/transparency
behavior. `trafficLights` and named AppKit materials are intentional platform
differences and should stay explicitly scoped.

Evidence: [public style](../packages/window-options/index.d.ts),
[Windows validation](../packages/desktop-windows/src/windows-options.ts),
[native Windows allowlist](../packages/desktop-host/windows/application.inc),
[macOS style/persistence](../packages/desktop-app/macos/SparkWindow.mm).

Acceptance: apply each option at creation and update; reopen persisted windows;
confirm disabled close behavior, theme overrides, and default/system appearance.

### 5. Nested native-menu targeting silently disappears

`targetPath` accepts an array. macOS traverses nested menus. The Windows composer
only accepts a one-element path; longer paths produce no candidates and the
contribution is skipped. Some macOS system-menu paths naturally have no Windows
equivalent, but silently accepting every path hides unsupported requests.

Specify the portable targeting subset. Implement deeper targeting where a real
menu hierarchy exists, and diagnose unsupported/missing targets. Do not invent
AppKit system menus on Windows merely to match their names.

Evidence: [public menu types](../packages/native-menu/src/api.ts),
[Windows composer](../packages/native-menu/src/windows-menus.ts),
[macOS traversal](../packages/native-menu/ios/RNNativeMenu.mm).

Acceptance: one-level and nested targets, nonexistent paths, patches, removal
restoring the previous contribution, shortcuts, payloads, and owner routing.

## External libraries: integration versus API support

| Area | Source state | Next useful work |
| --- | --- | --- |
| Nitro | Windows host/build/dispatcher/DLL integration around upstream C++; native behavior not yet verified | Add a separate C++ HybridObject consumer fixture testing sync calls, buffers, async callbacks, and reload. This validates exports and registration; it does not make Swift/Kotlin libraries portable. |
| SQLite | `openDatabase` delegates to OP-SQLite and returns its full `DB` type; Windows integration uses bundled SQLite | Document and test the supported DB method set. Optional SQLCipher/libSQL/Turso/vector configurations are not enabled by this Windows recipe; they are not established macOS-parity requirements. |
| WebView | Direct re-export of upstream `WebView` and `WebViewProps`; Windows uses upstream Fabric WebView2 plus patches | Inventory the Windows-supported props/events used by our examples and publish that subset. A broad upstream type export does not prove every prop works on every platform. Validate navigation vetoes, errors, messaging, injection, and teardown. |
| Secondary runtimes | Independent Windows Hermes hosts exist; shared-main-module mode explicitly rejects | Defer `useMainNativeModules`, `prewarmBusinessRuntime`, and worker-to-main routing until a concrete app requires them. Do not claim macOS behavioral validation merely because upstream Apple code exposes them. |

Evidence: [Windows library packaging](../scripts/prepare-windows-libraries.ts),
[Nitro adapter](../patches/windows/nitro/windows/SparkNitro),
[SQLite wrapper](../packages/sqlite/src/index.ts),
[WebView exports](../packages/webview/src/index.ts),
[WebView patches](../patches/windows/webview.patch),
[Windows runtimes](../packages/desktop-host/windows/runtimes.inc).

## Coverage and intentional differences

This pass compared shared method dispatch for audio, clipboard, filesystem,
global shortcuts, notifications, processes, secure storage, system, and tray.
Those groups have corresponding handlers; that is source coverage, not proof of
equivalent options, timing, errors, or cleanup. Notifications deliberately drain
responses through the Windows app host instead of the notification module.
Settings uses the filesystem backend. Links and focused shortcuts have shared JS
contracts and platform handlers. UI shares Button/TextInput/Select props, with
Windows failure placeholders; drag/drop likewise reports initialization failure.
Placeholders never count as feature acceptance.

Known differences to document rather than indiscriminately port:

- Window/display geometry is macOS points with a bottom-left origin versus Windows
  virtual-screen pixels with a top-left origin. It is documented on `setWindowFrame`
  but should also be prominent on `Frame`/`Display`; normalization would be an API
  design change, not a small missing method.
- Tray `symbol` is an SF Symbol; Windows uses the executable icon and maps title
  to a tooltip. A portable custom-image API is a possible enhancement, not an
  already-promised cross-platform symbol contract.
- Dock menus become Jump List tasks; Windows omits disabled tasks and decorates
  checked titles. Notification permissions and cold-dismiss behavior differ by OS.
- Credential Manager has a 2560-byte value limit. SecureStore authentication and
  service overrides are rejected by the shared adapter, including macOS.
- UI currently exposes uncontrolled text inputs and a Select on both desktops.
  Controlled-input convenience, menu/segmented APIs, and additional controls are
  new API work, not Windows parity defects.
- Login startup is implemented for macOS release apps but always unavailable on
  Windows. Track it with Windows standalone packaging/signing/updates, which are
  deferred here. It is not implemented on Windows merely because both development
  modes reject it.
- Camera remains a separate prototype and is not a public package/export in this
  desktop API inventory. This audit does not claim cross-platform camera support.

## Recommended next implementation batch

1. Application events/context/visibility and window lifecycle semantics.
2. File-dialog option handling and explicit unsupported-option behavior.
3. Portable window options, starting with closability and appearance.
4. Menu-target diagnostics, then supported nested targeting.
5. Nitro consumer fixture and an explicit external-library support matrix.

Add contract assertions beside each change, then leave Windows native acceptance
pending until it runs there. Do not spend this batch on shared-runtime modes or
arbitrary third-party library ports. See [Windows acceptance](windows-issues.md)
and [platform tests](platform-testing.md) for execution and report collection.

## Implementation follow-up

- Group 1: Windows now emits application activation transitions, reports initial
  process arguments, emits second-instance/reopen events for forwarded launches,
  and hides/restores the app's visible windows as a group. Previously hidden
  windows stay hidden. Windows native acceptance remains pending.
- Group 2: Windows reuses secondary IDs, restores minimized windows, aligns defaults,
  and emits opened/fullscreen/display transitions. macOS close guards now carry
  request IDs and expire after 30 seconds; stale responses cannot close a newer
  request. Missing parents use E_NOT_FOUND. Native event ordering awaits acceptance.
- Group 3: Windows consumes initial directories, prompt and message; mixed
  file/folder selection explicitly rejects with E_UNSUPPORTED_OPTION. Folder-only
  requests must set canChooseFiles:false. Added revealInFileManager on both
  desktops, with Explorer selection on Windows and the legacy alias retained.
- Group 4: Windows accepts closable, restoreFrame, appearance and backgroundColor.
  Appearance controls native titlebar and spark UI islands per window; React
  styles and arbitrary third-party platform-color tokens are not rewritten.
  AppKit materials, custom titlebar/transparency/shadow options remain unsupported.
  frame persistence is opt-in and per window ID. Closability governs OS close
  controls; explicit closeWindow still runs the normal close guard, as on macOS.
- Group 5: Windows diagnoses missing targets and rejects nested targetPath with
  E_MENU_TARGET_UNSUPPORTED before changing published menus. One-level targeting,
  original action/payload preservation, and owner restoration remain supported.
  The public contribution model is flat; adding a cross-platform submenu API is
  separate feature design rather than pretending AppKit system submenus exist.
