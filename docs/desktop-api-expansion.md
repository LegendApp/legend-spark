# Desktop configuration and additional APIs

macOS 14+ (Apple Silicon) supported; Windows preview, not yet verified

APIs are independently imported from
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
    "size": { "width": 1100, "height": 750 },
    "minSize": { "width": 600, "height": 400 },
    "titleBarStyle": "overlay",
    "restoreBounds": true
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

Runtime windows and initial configuration share `size`, `minSize`, `maxSize`,
`restoreBounds`, appearance, and common behavior flags. Dimensions describe outer
frames in logical units. Native host transport is private. Initial configuration
adds `macos.backgroundMaterial` for the content background and
`macos.titleBar.trafficLights`; runtime AppKit chrome has its own typed options.
See [the window contract](api-window-contract.md) for the complete runtime model.

```ts
import { openWindow, setWindowOptions } from "@legendapp/spark/windows";
await openWindow({ id: "settings", component: "Settings", kind: "window",
  parentId: "main", modal: true, title: "Settings", size: { width: 600, height: 450 } });
await setWindowOptions("main", { titleBarStyle: "overlay" });
```

A parent may have only one attached modal sheet. Closing a secondary window stops
its React surface. `maximizeWindow`, `unmaximizeWindow` and `centerWindow` are also
available. Window events are `boundsChanged`, `focusChanged`, `visibilityChanged`,
`fullscreenChanged`, and `closed`. Display-list changes are system events. React content
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

## Dialogs and clipboard

```ts
import { showMessage, confirm } from "@legendapp/spark/dialogs";
const result = await showMessage({ title: "Save changes?", windowId: "main",
  buttons: [{ id: "cancel", label: "Cancel" }, { id: "save", label: "Save" }],
  defaultButtonId: "save", cancelButtonId: "cancel",
  checkbox: { label: "Remember my choice" } });
// result: { buttonId: "cancel" | "save" | null, checked: boolean }
```

The native result uses the selected button ID; a host dismissal returns `buttonId: null`. `checked` is present only when `checkbox` was supplied.

Omit windowId for an application-modal dialog. Kinds are info/warning/error.
Concurrent message dialogs reject E_BUSY. `confirm(message, { title, confirmLabel, cancelLabel })` resolves true only for the confirm button; its labels default to English "Continue" and "Cancel", so localized apps pass their own.

### "Don't ask again"

The checkbox is AppKit's alert suppression button on macOS and the task dialog verification checkbox on Windows. Spark returns its state and stores nothing; persistence is the caller's choice. Record it only after a confirmed choice, so Cancel never suppresses, and give users a way to reset it:

```ts
const settings = createSettingsStore({ storage });
async function emptyTrash() {
  if (await settings.get("emptyTrash.suppressed") === true) return deleteTrash();
  const { buttonId, checked } = await showMessage({ title: "Empty the Trash?", kind: "warning",
    buttons: [{ id: "cancel", label: "Cancel" }, { id: "empty", label: "Empty Trash" }],
    defaultButtonId: "empty", cancelButtonId: "cancel", checkbox: { label: "Don't ask again" } });
  if (buttonId !== "empty") return;
  if (checked) await settings.set("emptyTrash.suppressed", true);
  await deleteTrash();
}
```

### Text prompts

```ts
const name = await showPrompt({ title: "Rename document", defaultValue: "Untitled", placeholder: "Name",
  confirmLabel: "Rename", cancelLabel: "Cancel" });
if (!name.canceled) rename(name.value); // value may be ""
```

A prompt is a message dialog with one text field (`secure: true` uses NSSecureTextField). The default value is selected when it opens; Return confirms and Escape cancels. Cancel, Escape and dismissal all resolve `{ canceled: true }`, distinct from confirming an empty value. Labels default to English "OK" and "Cancel". macOS only.

### Accessory controls

Open and save panels accept `accessory`: 1–8 checkboxes and labeled pop-ups shown below the file browser. Values return with an accepted result, keyed by control ID; each ID is also the control's accessibility identifier. The controls are data, not React views: panels run in a modal session where React content would not render or receive events reliably, and data keeps the result typed.

```ts
const result = await saveFileDialog({ defaultName: "Notes", accessory: [
  { type: "popup", id: "format", label: "Format:", options: [{ value: "md", label: "Markdown" }, { value: "txt", label: "Plain text" }] },
  { type: "checkbox", id: "metadata", label: "Include metadata", checked: true },
] });
// { canceled: false, path, accessory: { format: "md", metadata: true } }
```

Accessory values have no guaranteed key enumeration order. To process them in display order, iterate the supplied controls and look up each value by ID.

Labels are shown as given (include a colon if the locale uses one). A pop-up selects its first option unless `value` names another. The format value does not change the file name's extension; the app applies it. macOS only; Windows rejects `accessory` with E_UNSUPPORTED_OPTION.

### About panel

Spark owns one native macOS About panel. Repeated calls update and reuse it, including after it is closed; module cleanup closes and releases it during JavaScript reloads.

`showAboutPanel(options?)` brings the Spark-owned panel to the front. `name`, `version` ("Version …"), `build` (in parentheses), `credits` (plain text), `copyright` and `iconPath` (an absolute image path) override the bundle's values; omitted fields keep them. It is not modal and resolves once shown. A missing icon file rejects E_NOT_FOUND and an unreadable one E_INVALID_DATA. The menu `about` role opens AppKit's separate standard panel with the bundle's values; use an action item that calls `showAboutPanel` to show Spark's panel with overrides.

### Availability

`getFileDialogAvailability(feature?)` and `getMessageDialogAvailability(feature?)` report the base dialogs without an argument, and `"accessory"`, `"checkbox"`, `"prompt"` or `"aboutPanel"` separately:

| Feature | macOS | Windows |
|---|---|---|
| Open/save panels, message dialogs | available | available |
| `checkbox` | available | available |
| `accessory` | available | unsupported-platform; `accessory` rejects E_UNSUPPORTED_OPTION |
| `prompt`, `aboutPanel` | available | unsupported-platform; calls reject E_UNSUPPORTED_PLATFORM |

Windows implementations (IFileDialogCustomize controls, a prompt window, an About window) are tracked in [#247](https://github.com/LegendApp/legend-spark/issues/247).

Clipboard adds readClipboard, writeClipboard, getClipboardFormats and
clearClipboard. Rich content supports text, html, rtf, image ({ format: "png", bytes: Uint8Array }) and files
(absolute paths). Multiple rich representations may be written together; a file
list is written separately. Invalid image data is rejected before clearing the
clipboard. Reading returns supported formats; this is not a lossless backup API
for arbitrary proprietary pasteboard types.
`getClipboardFormats()` returns raw format identifiers supplied by macOS or Windows, not Spark-normalized names. Text helpers retain Expo's `plainText` and `html` format values.

## System integration

`system` exports getSystemInfo, onSystemEvent, getLoginItemStatus,
setLaunchAtLogin, setAppBadge, createDockMenu, createTaskbarMenu, requestAttention and preventSleep.

```ts
const blocker = await preventSleep({ reason: "Exporting video", kind: "display" });
try { await exportVideo(); } finally { await blocker.remove(); }
```

Sleep blockers support display/system idle sleep, not forced sleep. Events include
sleep/wake, lock/unlock, powerChanged, appearanceChanged and displaysChanged.
Treat these events as invalidations: call `getSystemInfo()` to read current values after a relevant event.
Login changes require a standalone distribution runtime. macOS may require user
approval; getLoginItemStatus reports requiresApproval. Nothing enables startup
or requests permissions automatically. Dock menus have one owner; remove the
returned handle before replacing a menu. Event subscriptions and native resources
must be disposed; native module invalidation also releases resources on reload.
Dock menus allow nested actions, checkboxes and separators. Taskbar menus are flat and allow actions and checkboxes; disabled task entries are omitted by Windows. Both reject unsupported shortcut, icon, target, placement, hidden, role and slider fields. Platform availability is still checked when creating a menu.

## WebView and SQLite

WebView uses exactly react-native-webview 16.0.0 (the upstream `next` release with
macOS Fabric recycling fixes). The component takes React Native's view props plus
Spark's own source, message, script-injection and navigation callbacks; upstream's
platform-specific props stay private and an unsupported one rejects.
No framework native methods are exposed to web pages automatically. Define an
explicit navigation policy and expose only intended operations in any message
handler. It uses WebKit on macOS, not Chromium.

SQLite uses @op-engineering/op-sqlite 18.2.1 with plain SQLite behind a Spark-owned
query/transaction contract. openDatabase requires a simple .sqlite filename and
places it in the current project's data directory:

```ts
import { openDatabase } from "@legendapp/spark/sqlite";
const db = await openDatabase("notes.sqlite");
try {
  await db.run("CREATE TABLE IF NOT EXISTS notes (body TEXT)");
  await db.run("INSERT INTO notes VALUES (?)", ["Hello"]);
  const rows = await db.getAll("SELECT body FROM notes");
  await db.transaction(async tx => { await tx.run("DELETE FROM notes"); });
} finally { await db.close(); }
```

Backends deliver SQLite INTEGER values as JavaScript numbers, so a value outside
2^53−1 cannot be represented exactly no matter what the wrapper does. The default
`integers: "number"` mode rejects such a read instead of returning a silently wrong
number. `openDatabase(name, { integers: "text" })` returns out-of-range integers as
decimal strings so a stored large row stays readable; use `CAST(column AS TEXT)` when
you need every digit. Binding an out-of-range number as a parameter always rejects.

The wrapper does not enable SQLCipher, remote sync or optional SQLite extensions.
Direct third-party imports use the upstream behavior; database isolation applies
through openDatabase.

## Exercising the APIs

The kitchen sink includes interactive controls for each area. `bun run
test:expansion` runs native window/process/shortcut/system/SQLite checks and a
mounted WebView round-trip in custom and Spark Runner runtimes. A test-only custom-build
driver also checks mounted drag targeting/event delivery and confirmation sheets;
this driver is removed before the prebuilt build. `bun run test` includes
config, transport, validation, ownership, helper packaging and codegen checks.
Interactive gestures, OS registration approval and native dialog UI require an
unlocked desktop and are recorded separately from automated API checks.
