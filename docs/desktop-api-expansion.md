# Desktop configuration and additional APIs

The SDK targets macOS 14+ on Apple Silicon. APIs are independently imported from
`@legendapp/spark/<feature>`. These additions do not embed Node.

## Configuration

New projects use `desktop.config.json`:

```json
{
  "$schema": "./node_modules/@legendapp/spark-desktop-config/schema.json",
  "name": "My App",
  "projectId": "keep-the-id-assigned-by-create",
  "version": "1.0.0",
  "window": {
    "width": 1100,
    "height": 750,
    "minWidth": 600,
    "minHeight": 400,
    "titleBarStyle": "overlay",
    "restoreFrame": true
  },
  "macos": { "bundleIdentifier": "com.example.myapp" }
}
```

The CLI validates this source and generates `app.json` for Expo Desktop. Do not
edit generated `app.json`; it is ignored in new projects. Existing projects that
only have `app.json` continue to work. If both exist, desktop.config.json wins.
There is no dynamic TypeScript config support yet.

Top-level fields include `scheme`, `documentTypes`, `menuBarOnly`, `updates`,
`include`, `signing`, and `helpers`. These replace `expo.extra.spark.*` nesting.
`macos` retains platform-specific bundle metadata and entitlements. Advanced
Expo plugin overrides live under `expo`; framework identity remains authoritative.
The `updates init` command edits the canonical source.

The Spark Runner receives window options from the launching CLI. A custom app embeds the same
options in its Info.plist. Configuration applies before the main window appears.
Saved frames override the initial size, constrained by current min/max dimensions
and available screens. Window config works with prebuilt; URL registration, menu-bar-only
activation, update feeds and bundled helpers still need custom builds.

## Windows

`openWindow` and `setWindowOptions` accept the same style fields as config:

- `width`, `height`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight` (content points)
- `titleBarStyle`: `default`, `overlay`, `hidden` (full content with hidden controls), `borderless`
- `resizable`, `closable`, `minimizable`, `alwaysOnTop`, `hasShadow`, `trafficLights`
- `appearance`: `system`, `light`, `dark`
- `transparent`, `backgroundColor` (#RRGGBB or #RRGGBBAA)
- `material`: `none`, `sidebar`, `windowBackground`, `hudWindow`, `popover`
- `title`, `restoreFrame` (restoration is configured when creating a window)

```ts
import { openWindow, setWindowOptions } from "@legendapp/spark/windows";
await openWindow({ id: "settings", parentId: "main", modal: true,
  title: "Settings", width: 600, height: 450 });
await setWindowOptions("main", { titleBarStyle: "overlay" });
```

A parent may have only one attached modal sheet. Closing a secondary window stops
its React surface. `maximizeWindow`, `unmaximizeWindow` and `centerWindow` are also
available. Window events include move, resize, focus, blur, screenChanged and
fullscreen transitions. Display-list changes are system events. React content
must use transparent backgrounds where native material should show through.

## Global shortcuts

```ts
import { registerGlobalShortcut } from "@legendapp/spark/global-shortcuts";
const shortcut = await registerGlobalShortcut("Cmd+Shift+K", () => showWindow());
await shortcut.remove();
```

Independent registrations use the system hotkey facility; conflicts reject with
`E_BUSY`. Keys resolve using the keyboard layout at registration.
Re-register after changing layouts if the shortcut should follow its character.
Focused-app shortcuts remain under `shortcuts`.

## Drag and drop

```tsx
import { DragDropView } from "@legendapp/spark/drag-drop";
<DragDropView onDrop={({ files, text, urls }) => handleDrop(files, text, urls)}>
  <Text>Drop here</Text>
</DragDropView>
<DragDropView source={{ files: ["/absolute/path/report.pdf"] }}>
  <Text>Drag report to Finder</Text>
</DragDropView>
```

Sources support existing file paths, text, URLs and custom MIME strings. Drag-out defaults to copy; it does not
move/delete the original. File promises are not implemented. Source-enabled views
own their mouse gesture, so use a dedicated drag handle rather than wrapping
interactive controls. Drop events include local x/y coordinates. `disabled`,
`onDragEnter`, `onDragOver`, `onDragLeave`, and `onDragEnd({ accepted, operation })` are available. See [desktop foundations](desktop-foundations.md) for accepted types, copy/move/link negotiation, overlays, and recursive watches. Fabric
recycling resets retained drag state.

## Processes and helpers

```ts
import { spawn, runCommand } from "@legendapp/spark/processes";
const result = await runCommand({ executable: "/usr/bin/uname", args: ["-a"] });
const child = await spawn({ executable: "helper:indexer", args: ["--watch"] }, chunk => {
  // chunk.stream is stdout/stderr; chunk.base64 preserves arbitrary bytes.
});
await child.write("input\n");
await child.closeInput();
await child.terminate();
const exit = await child.exited;
```

Options include cwd, env, initial text input and timeoutMs. Arguments are passed
directly without shell interpolation. Request a shell explicitly when needed.
Exit results contain exitCode, signal, timedOut, stdout/stderr text and base64,
and outputTruncated. Buffered results are capped at 8 MiB per stream; streaming
chunks remain available. Consume streams promptly. Termination sends SIGTERM,
then SIGKILL after two seconds if necessary. This manages direct children;
it is not a terminal/PTY or a process-tree supervisor.

Declare `"helpers": { "indexer": "bin/indexer" }` in desktop.config.json. The CLI
copies project-local regular files to Contents/Helpers, marks them executable,
hashes them for build caching, and includes native executables in the existing
signing traversal. Helpers need to target the app's architecture. They do not
require Node; native Rust, Swift, C/C++ or other standalone executables work.

## Message dialogs and clipboard

```ts
import { showMessage, confirm } from "@legendapp/spark/dialogs";
const result = await showMessage({ title: "Save changes?", windowId: "main",
  buttons: ["Cancel", "Save"], defaultButton: 1, cancelButton: 0,
  checkbox: { label: "Remember my choice" } });
// result: { button: zeroBasedIndex, checked: boolean }; aborted dialog: button -1
```

Omit windowId for an application-modal dialog. Kinds are info/warning/error.
Concurrent message dialogs reject E_BUSY. Existing open/save file panels remain.

Clipboard adds readClipboard, writeClipboard, getClipboardFormats and
clearClipboard. Rich content supports text, html, rtf, image ({ format: "png", bytes: Uint8Array }) and files
(absolute paths). Multiple rich representations may be written together; a file
list is written separately. Invalid image data is rejected before clearing the
clipboard. Reading returns supported formats; this is not a lossless backup API
for arbitrary proprietary pasteboard types.

## System integration

`system` exports getSystemInfo, onSystemEvent, getLoginItemStatus,
setLaunchAtLogin, setAppBadge, createDockMenu, createTaskbarMenu, requestAttention and preventSleep.

```ts
const blocker = await preventSleep({ reason: "Exporting video", kind: "display" });
try { await exportVideo(); } finally { await blocker.remove(); }
```

Sleep blockers support display/system idle sleep, not forced sleep. Events include
sleep/wake, lock/unlock, powerChanged, appearanceChanged and displaysChanged.
Login changes require a standalone distribution runtime. macOS may require user
approval; getLoginItemStatus reports requiresApproval. Nothing enables startup
or requests permissions automatically. Dock menus have one owner; remove the
returned handle before replacing a menu. Event subscriptions and native resources
must be disposed; native module invalidation also releases resources on reload.

## WebView and SQLite

WebView uses exactly react-native-webview 16.0.0 (the upstream `next` release with
macOS Fabric recycling fixes). The framework preserves its upstream component
and prop APIs, including onMessage, injectedJavaScript and navigation callbacks.
No framework native methods are exposed to web pages automatically. Define an
explicit navigation policy and expose only intended operations in any message
handler. It uses WebKit on macOS, not Chromium.

SQLite uses @op-engineering/op-sqlite 18.2.1 with plain SQLite. openDatabase requires
a simple .sqlite filename and places it in the current project's data directory:

```ts
import { openDatabase } from "@legendapp/spark/sqlite";
const db = await openDatabase("notes.sqlite");
try {
  await db.execute("CREATE TABLE IF NOT EXISTS notes (body TEXT)");
  await db.execute("INSERT INTO notes VALUES (?)", ["Hello"]);
  const result = await db.execute("SELECT body FROM notes");
} finally { db.close(); }
```

The returned database is the upstream API (transactions, queries, etc.). This
wrapper does not enable SQLCipher, remote sync or optional SQLite extensions.
Both libraries are included in the development SDK. Production import analysis
can prune their native packages independently. Direct third-party imports use
the upstream behavior; database isolation applies through openDatabase.

## Exercising the APIs

The kitchen sink includes interactive controls for each area. `bun run
test:expansion` runs native window/process/shortcut/system/SQLite checks and a
mounted WebView round-trip in custom and Spark Runner runtimes. A test-only custom-build
driver also checks mounted drag targeting/event delivery and confirmation sheets;
this driver is removed before the prebuilt build. `npm test` includes
config, transport, validation, ownership, helper packaging and codegen checks.
Interactive gestures, OS registration approval and native dialog UI require an
unlocked desktop and are recorded separately from automated API checks.
