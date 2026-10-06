# Desktop SDK

The first SDK targets macOS 14+ on Apple Silicon. Import capabilities through
`@legendapp/spark/<feature>`. There is no Node runtime inside the app.
Each native capability is independently linked so production builds can remove
unused SDK pods. The small app-context pod is required by the host.

| Import | Capabilities |
| --- | --- |
| `app` | App identity, activate/hide, lifecycle events, single-instance forwarding, guarded quit |
| `windows` | Secondary React roots, props, visibility, frames, title, minimize/fullscreen, displays, guarded close, spark restoration |
| `files` | App data/cache/temp directories, UTF-8 and base64 IO, stat/list, mkdir/copy/move/remove, file/directory watching |
| `settings` | JSON get/set/remove/update with serialized per-key mutations |
| `dialogs` | Native open/save panels, Finder reveal, existing text IO helpers |
| `menus` | Application menus, checked/disabled items, shortcuts, owner-based patches and cleanup |
| `context-menu` | Native popup menus with checked, disabled and separator items |
| `shortcuts` | Focused-app or window-specific shortcuts with native key consumption |
| `clipboard` | Read/write text and query text presence |
| `links` | Open/check URLs, queued incoming URLs/files, recent documents |
| `secure-storage` | Project-scoped string values in macOS Keychain |
| `notifications` | Permission, immediate/scheduled local notifications, scoped cancellation and responses |
| `tray` | Menu-bar items, SF Symbols, dynamic nested menus and cleanup |
| `updates` | Sparkle status, signed whole-app updates and user-controlled checking |
| `global-shortcuts` | Multiple system hotkeys, conflicts and cleanup |
| `drag-drop` | Fabric drop targets and file/text/URL drag sources |
| `processes` | Child process IO, streaming, cancellation and bundled helpers |
| `system` | Dock, startup, system/power state and sleep blockers |
| `webview` | React Native WebView with macOS WebKit |
| `sqlite` | OP-SQLite databases in project-scoped storage |

See [configuration and expanded APIs](desktop-api-expansion.md) for window styles,
global shortcuts, drag/drop, processes, system integration, WebView and SQLite.

See [desktop integrations](desktop-integrations.md) for notification, tray, and update setup.

## Run the kitchen sink

From this checkout, with Bun 1.3.14, Node 24.19.0+ and a compatible registered Spark Runner:

```sh
bun install
bun run kitchen-sink
```

The command runs the checked-in workspace app in `examples/kitchen-sink`.
It opens Expo CLI/Metro and reads the example screens and Uniwind CSS directly
for Fast Refresh. It does not pack the SDK or create a second consumer.
Dev options such as `--no-open` and `--port 8082` pass through.

If no compatible runtime is available, run `bun run rebuild:macos` (or
`bun run rebuild:windows` on Windows) from `examples/kitchen-sink` with the
native toolchain installed. This builds and registers the reusable runtime.
Ordinary app edits need no native rebuild. Native source and checked host
configuration changes require a rebuilt binary, and the CLI checks compatibility
before serving desktop JavaScript.

For a copied consumer that validation scripts can modify independently, run
`bun run kitchen-sink:prepare`. It always packs/installs and exits without Metro;
its directory is `.spark/examples/KitchenSinkPackaged`. Integration runners retain
that isolated preparation behavior through `prepareKitchenSink`.

The example is in `examples/kitchen-sink`. It includes a small document editor,
secondary windows, native menu actions, a persistent counter, clipboard controls,
a demo Keychain entry, and an event log. The document close and app quit handlers
ask before discarding edits. File watches report changes instead of overwriting
an unsaved editor buffer. Demo secrets are never printed in the event log.

## App identity and storage

`spark create` assigns `projectId` in `desktop.config.json` a UUID. Legacy
`app.json` projects use `expo.extra.spark.projectId`. Keep it stable across
renames, builds and transfers of the same app. Give independently cloned apps a
new ID. Older projects fall back to `expo.macos.bundleIdentifier`.

The Spark Runner receives the project ID and display name from the CLI. Custom and distribution
apps embed the ID through CNG and ignore the Spark Runner's environment overrides. The native
host hashes it for application data directories, settings, recent documents,
window restoration, single-instance locks, and Keychain service names. Thus two
projects using the Spark Runner do not accidentally share these values. This is namespacing, not an
OS security sandbox: JS can still access explicitly supplied filesystem paths.
Keychain values use the normal macOS access policy; changing the app's signing
identity can cause a Keychain access prompt.

```ts
import { getDirectory, writeText } from "@legendapp/spark/files";
import { settings } from "@legendapp/spark/settings";
import { secureStorage } from "@legendapp/spark/secure-storage";

const data = await getDirectory("data");
await writeText(`${data}/draft.txt`, "Hello");
await settings.set("theme", "dark");
const theme = await settings.get<string>("theme");
await settings.update<number>("launches", count => (count ?? 0) + 1);
await secureStorage.set("access-token", "a-token");
const token = await secureStorage.get("access-token");
await secureStorage.remove("access-token");
```

Await writes before quitting. Settings accept JSON values and report corrupt files
instead of silently resetting them. Updates are serialized within the app's JS
runtime. They are not distributed transactions against external writers. Missing
settings/Keychain keys return `null`; an empty stored string remains `""`.

Files accept absolute local paths or `file://` URLs. Binary IO uses base64 without
requiring `Buffer`. Writes replace a file atomically. Copy/move do not overwrite an
existing destination unless `{ overwrite: true }`. Removing a nonempty directory requires `{ recursive: true }`.
Errors include `E_NOT_FOUND`, `E_PERMISSION`, `E_EXISTS`, `E_NOT_EMPTY`, and `E_IO`.
Watches are nonrecursive invalidation signals and may include sibling changes;
re-read the target and call `await subscription.remove()` when done. Watching a
file survives atomic replacement because its parent directory is observed.

## Windows and lifecycle

Every window mounts the registered `main` component from the same entry bundle.
The root receives `windowId`, `windowProps`, `projectId`, `name`, `version`,
`runtime`, and `launchArguments`. Branch or route on `windowId`; import secondary
screens through that entry so production analysis includes their dependencies.
React module-level state is shared across these roots, while each root has its own
component state. Closing a secondary window explicitly stops its React surface.
The main window stays mounted when closed so reopening it restores the app.

```ts
import { beforeQuit } from "@legendapp/spark/app";
import { openWindow, beforeWindowClose } from "@legendapp/spark/windows";

await openWindow({
  id: "preferences", title: "Preferences", width: 640, height: 480,
  props: { section: "appearance" }, restoreFrame: true,
});
const quitGuard = await beforeQuit(async () => savePendingChanges());
const closeGuard = await beforeWindowClose("preferences", () => true);
// During cleanup:
await closeGuard.remove();
await quitGuard.remove();
```

There is one quit handler and one close handler per window. Returning `false` or
throwing cancels the request. Quit requests time out after 30 seconds and cancel;
late responses are ignored. Window close handlers leave the window open while
pending. Window frames and display work areas use macOS screen points with a
bottom-left origin. Closing all windows does not automatically quit the app.

The host permits one running instance per project ID. A second launch forwards
its arguments through the `secondInstance` app event, activates the existing app,
and exits. Different projects using the Spark Runner remain independent processes.

## Menus and shortcuts

Use application menus for discoverable commands and their normal keyboard
accelerators. Use `registerShortcut` for focused-app handling, optionally scoped
to a `windowId`. These are not global system hotkeys and need no Accessibility
permission. A window-specific binding takes precedence over an app-wide binding.
Duplicate registrations in the same scope reject with `E_BUSY`.
Dispose registrations when the owning component unmounts.

```ts
import { registerShortcut } from "@legendapp/spark/shortcuts";
const shortcut = await registerShortcut("CommandOrControl+Shift+K", openPalette);
await shortcut.remove();
```

Supported modifiers include Command/Cmd/Meta, Control/Ctrl, Option/Alt, Shift,
and CommandOrControl/CmdOrCtrl (Command on macOS). Named keys include Escape,
Enter, Tab, Space, Backspace, Delete, arrows, F1–F20, and Plus.
Context-menu locations use content-view coordinates with a top-left origin.
Open/save panels return `{ canceled: true }` on cancellation; another concurrent file panel
rejects with `E_BUSY`. Menu and dialog APIs stay asynchronous to JS.

## Incoming URLs and documents

Import `subscribeToOpenRequests` from `@legendapp/spark/app/documents` and await its registration. Subscription installation happens before
reading queued launch events, and IDs deduplicate live/queued overlap. The last
100 launch events are retained for a late subscriber. The return value has a
`remove()` method. The Spark Runner can test handling through the test fixture, but registering
OS URL schemes or document types requires a custom build.

Declare existing UTIs and URL schemes in `app.json`:

```json
{
  "expo": {
    "scheme": "mydesktopapp",
    "extra": {
      "spark": {
        "projectId": "keep-the-id-created-for-your-app",
        "documentTypes": [
          { "name": "Text document", "contentTypes": ["public.plain-text"], "role": "Editor" }
        ]
      }
    }
  }
}
```

CNG creates `CFBundleURLTypes` and `CFBundleDocumentTypes`. `role` may be `Editor`
or `Viewer`. Custom UTIs can be declared through `macos.infoPlist` or a config
plugin; both correctly require a custom build. Incoming file requests provide native absolute paths (`{ type: "file", id, path }`); URL requests provide `{ type: "url", id, url }`. `noteRecentDocument` accepts an absolute path or local file URL and `getRecentDocuments` returns `{ path, name }` entries. These functions live under `/app/documents`. The Spark Runner keeps its recent-document
list scoped to the project; standalone apps additionally notify the native
`NSDocumentController`.

## Tests

```sh
bun run typecheck
bun run test
bun run test:native
# All of the above:
bun run test:all
```

The native suite needs an Apple Silicon Mac, Xcode, CocoaPods, and a logged-in
macOS GUI session, and a working XCTest service. The UI test project uses the
`xcodeproj` Ruby gem installed with CocoaPods (`ruby -e 'require "xcodeproj"'`).
It creates its own app under `.spark/native-tests`, starts
its own Metro on an available port, and owns/cleans up its app processes. Reports
and per-check progress live in that app's `.spark/test-results` directory.
A path argument selects a separate scratch directory, for example:

```sh
bun run test:native /tmp/DesktopSDKTests
```

The runner tests three prebuilt launches (A, B, A), proving file/settings/Keychain
isolation and persistence, verifies a reduced production graph, then installs a test-only native module and builds a
custom runtime. That driver exercises native key events, menu actions, real
open/save panels, incoming URL/file delegates, second-instance delivery and quit
cancellation. A separate XCTest driver waits for the successful-save case,
presses the system panel’s Save button, checks the native report, and verifies
that approving quit terminates the app. Its screenshots and results are saved
in an `.xcresult` bundle. It snapshots and restores all current clipboard formats before
clipboard mutation. The test-only module is rejected from prebuilt and distribution.
The small production-graph Debug build removes unused pods and executes
the retained APIs. This validates pruning without a release compile or signing
credentials. Signing/notarization retain the existing mocked pipeline tests;
these SDK checks do not submit anything to Apple.

The Node/Vitest suite covers public API transport, validation, disposal,
settings concurrency/failure recovery, URL delivery races, native codegen,
CNG identity/associations, native selection and runtime compatibility, CLI
behavior, and the packaging workflow. Tests exercise the macOS implementation;
this SDK does not yet claim Windows, Linux, mobile, App Store sandbox, or Intel
support.

For an agent or another accessibility driver, `SPARK_TEST_UI_DRIVER=external`
launches the same custom native checks without XCTest. That driver must wait for
the Save panel whose filename is `accepted.txt` and press Save. The runner still
requires the real native callback and successful guarded termination. This mode
is not an unattended test by itself, and does not validate the XCTest harness.
A locked Mac cannot complete either UI path.

Local and global shortcuts use the same accelerator parser. `CmdOrCtrl` selects
Command on macOS and Control on Windows. Local registrations accept
`{ windowId, repeat }`; omission is app-wide and repeat defaults to false. A
window-scoped binding takes precedence over an app-wide binding. Both APIs return
async registrations: removal stops JS callbacks immediately, concurrent removals
join, and native cleanup failure can be retried. The unused singleton numeric
`/global-shortcuts/hotkeys` API is removed; keyboard events remain the explicit
low-level physical-key API. Global registration resolves the layout at registration;
Windows suppresses repeat and macOS follows Carbon hotkey delivery.
