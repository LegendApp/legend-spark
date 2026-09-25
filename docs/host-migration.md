# Native lifecycle and existing macOS apps

Use Spark's standard AppDelegate. It owns React bootstrap and dispatches native
application events; apps opt into policy through APIs and configuration. There is
no source rewriting, delegate subclass generator, or competing application delegate.

## Quit

Without registered guards, quit returns immediately. JavaScript can opt in with
`beforeQuit` from `@legendapp/spark/app`; await registration before enabling edits.
Return true to allow quit, or false to cancel. A rejected promise cancels as well.

Native packages can register an asynchronous handler with
`SparkRegisterQuitHandler(identifier, handler)` from `RNDesktopApp/SparkLifecycle.h`.
Call its reply exactly once, on the main thread. Remove it with
`SparkRemoveQuitHandler(identifier)` when its owner stops observing or invalidates.
Use an identifier unique to the owning instance. JavaScript and native handlers
participate in the same coordinator: every registered handler must approve.
Removal during an attempt, refusal, or the 30-second timeout cancels that attempt.
Duplicate and stale replies are ignored. Registration itself is opt-in; linking
a package does not install a quit guard.

## Windows

Portable appearance and geometry remain in `window`. macOS startup policy lives
under `macos.lifecycle.mainWindow`:

```json
{
  "macos": {
    "bundleIdentifier": "com.example.editor",
    "lifecycle": {
      "mainWindow": {
        "hidden": true,
        "closeBehavior": "close",
        "reopenBehavior": "default"
      }
    }
  }
}
```

The default main window is visible. `hidden` retains the React runtime without
presenting a host window; it does not make the app menu-bar-only. Reopen focuses
the main window, or the last visible managed window when the host is hidden.
The `reopen` event always fires, including whether windows were visible before
handling. `reopenBehavior: "manual"` leaves all window action to the app. `"visibleWindows"` focuses an
already visible window without reopening a closed main window, letting the app
choose what to create when no windows remain.

Closing normally closes the main window. `closeBehavior: "hide"` keeps it alive
for background work, and `"request"` emits `closeRequested` with `windowId: "main"`
for an app-owned close decision. It does not register a quit guard.

`macos.lifecycle.appearance` optionally sets the application appearance to
`system`, `light`, or `dark`. Other macOS options are `autosaveName` (to preserve an existing frame preference),
`backgroundColors: { light, dark }`, `glass`, `toolbarStyle`, and
`titlebarSeparatorStyle`. The host prepares the native window before starting
React and attaches the React root without replacing restored native chrome.

## Native startup extensions

Only behavior that must run before JavaScript belongs in a startup extension.
Put the owning native package in `include` so production pruning retains it.
Configure linked Objective-C class names in `macos.lifecycle.plugins`. Each must
conform to `SparkStartupPlugin` from `RNDesktopApp/SparkLifecycle.h`:

- `prepareApplication`: initialize a document controller or precreate windows.
- `prepareMainWindow:`: install package-owned native chrome.
- `attachRootView:toWindow:installRoot:`: attach React into that chrome, or call
  `installRoot` for the normal content view. At most one plugin may own attachment.

Spark constructs and retains these objects on the main thread. Missing classes,
invalid protocols, and multiple attachment owners fail explicitly. These hooks do
not override quit, reopen, file/URL dispatch, or the React runtime. Stateful
restoration remains owned by the package that created that state.

## Files and URLs

Spark receives files and URLs through the application delegate and keeps the
existing bounded queue until JavaScript can subscribe. Use `onOpen` from
`@legendapp/spark/links` for queued delivery with event-id deduplication, or its
`getInitialURL` and `addEventListener` for Linking-compatible URL handling. Native
packages can observe `SparkDesktopEvent` and read `SparkPendingURLs()`; deduplicate
by event id when combining live and queued delivery. Do not install competing
Apple-event handlers. Recent-document menu actions should call `SparkOpenURLs`.

## Local development signing

Debug apps are ad-hoc signed by default. Apps loading same-team native plugins can
set `macOSDevelopmentIdentity` in local `.spark/settings.json` to an installed
certificate name or SHA-1 fingerprint and rebuild. This is part of the development
runtime fingerprint and does not change distribution signing.
