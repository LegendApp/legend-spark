# Upgrading Spark apps

These notes ship with `@legendapp/spark`. The new package carries the cumulative
history; do not use a moving main-branch document to decide an installed API.

1. Save the old `.spark/version`. If absent, record the installed
   `node_modules/@legendapp/spark/package.json` version. Keep a source-control
   checkpoint of app source/config and the manager lockfile.
2. Run the app's installed `spark upgrade --dry-run` (see SKILL.md for manager
   commands). It selects the current channel, reports pins and install command,
   then evaluates **every** pending migration in semantic-version order without
   writing app files. Read the planned paths and manual steps. Source/config
   conflicts are manual steps, never permission to overwrite customized files.
3. Run `spark upgrade`. Migrations update install inputs before the manager runs;
   the receipt advances only after successful installation and finalization.
   An error can leave partial edits: fix the cause and retry. Do not manually
   advance the receipt to suppress a failure.
4. From the newly installed package read SKILL.md and **all** sections below with
   `old < version <= new`. For an unrecorded/unknown old version, inspect all
   applicable history and the app's actual code. Version ordering includes
   intermediate `-next.N` previews. Do not stop at the destination release.
5. Complete `.spark/upgrade-notes.md`, which links each outstanding step here.
   The receipt tracks applied migrations, not completion of these app decisions.
   Check off completed entries; retain unresolved notes across retries/upgrades.
   Search app source for removed APIs, including namespace/dynamic imports, app
   config functions and custom native modules. Codemods preserve local binding
   names; review call semantics even if a path or imported symbol was changed.
6. Run `spark upgrade --dry-run` again and `spark doctor`, then the app's typecheck
   and tests. Rebuild custom runtimes (`spark build --dev`) for native changes and
   exercise affected desktop flows. Commit source/config and the lockfile.

## 0.0.1-next.2

Baseline preview for this history. Dependency archives now travel with the app
under `spark-packages/`; keep those verified inputs available to clones and CI.
Do not replace patched native package archives with upstream registry versions.

## 0.0.1-next.3

Breaking: yes. This release consolidated public contracts and upgraded Expo
Desktop from beta releases to 1.0.0. Upgrade handles target dependency pins,
unambiguous JSON window changes, `/message-dialog` → `/dialogs`, and
`/expo-metro` → `/metro`. The remaining contract decisions are manual.

### Configuration and windows

In `desktop.config.json`, or `app.json` under `expo.extra.spark.window`, replace
flat dimensions and restoration flags. Min/max dimensions become `minSize` and
`maxSize`; both width and height are required. Incomplete pairs or simultaneous
old/new values require review. Values describe outer-frame logical units.

Before:
```json
{ "window": { "width": 1000, "height": 700, "restoreFrame": true, "material": "sidebar", "trafficLights": false } }
```
After:
```json
{ "window": { "size": { "width": 1000, "height": 700 }, "restoreBounds": true, "macos": { "backgroundMaterial": "sidebar", "titleBar": { "trafficLights": false } } } }
```

`openWindow` now requires a registered component and nested size/position.
`setWindowFrame` became `setWindowBounds`; positions identify their display.
`WindowInfo.frame` became `bounds`. Do not rename a function without adapting
arguments. Replace global `onWindowEvent` with per-window typed subscriptions.

Before:
```ts
import { openWindow, setWindowFrame } from "@legendapp/spark/windows";
await openWindow({ id: "editor", width: 900, height: 600 });
await setWindowFrame("editor", { x: 10, y: 20, width: 900, height: 600 });
```
After (register the `Editor` component with React Native AppRegistry first):
```ts
import { openWindow, getDisplays, setWindowBounds, addWindowListener } from "@legendapp/spark/windows";
const display = (await getDisplays()).find(d => d.primary)!;
await openWindow({ id: "editor", component: "Editor", size: { width: 900, height: 600 } });
await setWindowBounds("editor", { displayId: display.id, x: 10, y: 20, width: 900, height: 600 });
const subscription = await addWindowListener("editor", "boundsChanged", event => saveBounds(event.bounds));
// When the owner stops observing:
await subscription.remove();
```

Removed `/windows-controls`, `/windows-managed` and `/windows-react` prototype
surfaces were consolidated into `/windows` and `/windows/macos`. Rework native
chrome and React registrations using their current types; preserve component
and window identity, and retry failed asynchronous cleanup.

### Dialogs and file IO

Open/save dialogs now return discriminated cancellation results. Options use
`selection`, `multiple`, `defaultPath`, `filters` with extension lists, and an
optional `windowId`. Convert directory URLs to absolute paths deliberately.

Before:
```ts
const paths = await openFileDialog({ canChooseFiles: true, allowsMultipleSelection: true, allowedFileTypes: ["txt"] });
if (paths) await load(paths[0]);
```
After:
```ts
const result = await openFileDialog({ selection: "files", multiple: true, filters: [{ name: "Text", extensions: ["txt"] }] });
if (!result.canceled) await load(result.paths[0]);
// saveFileDialog likewise returns { canceled: true } or { canceled: false, path }.
```

Message dialogs live in `/dialogs` and use stable button IDs; update result
handling from numeric positions to the current result's button ID. File helpers
left `/dialogs`: use `/files` `readText`, `writeText`, `writeTextIfUnchanged`, and
`revealInFileManager`. Conditional writes return `{ written }`; reveal now
returns void and rejects failures. File copy/move use an `overwrite` option
(default false); make the app's overwrite decision explicit. Validate path and
IO option keys against the installed types.

Before:
```ts
import { readTextFile, writeTextFileIfUnchanged } from "@legendapp/spark/dialogs";
const previous = await readTextFile(path);
if (await writeTextFileIfUnchanged(path, previous, next)) markSaved();
```
After:
```ts
import { readText, writeTextIfUnchanged } from "@legendapp/spark/files";
const previous = await readText(path);
if ((await writeTextIfUnchanged(path, previous, next)).written) markSaved();
```

### Other contract changes to review

The API consistency work also affects these app-owned decisions. Compare every
used export with the installed declarations; these are not safe text renames.

- App/window quit and close guards are awaited registrations with owned cleanup;
  return a boolean decision. A rejected quit decision cancels. Events are typed;
  application identity comes from `getAppContext`, not an event snapshot.
- Menus and context menus share typed items, stable IDs and explicit owners;
  hooks have imperative lifecycle counterparts. Commands/keyboard bindings have
  separate `/shortcuts/commands` and `/shortcuts/keyboard` entry points.
- Global shortcuts have an options parameter and owned registration/removal.
  Tray, launcher, system and media registrations bind to the owning instance.
- Settings storage is explicit; observable settings have readiness/persistence
  lifecycles. Settings windows own their page selection. Do not assume an
  immediate read means persisted data has loaded.
- Links distinguish URL events from `/app/documents` document requests/history.
  Process APIs have explicit process targets, byte IO and termination semantics.
- Audio readiness/commands/disposal, media session ownership, authentication
  results and retryable session cleanup changed. Notifications separate content,
  scheduling and removal; update events discriminate by state. SQLite query and
  transaction contracts belong to Spark; large out-of-range integers can be text.
- Clipboard and secure storage use one Expo-shaped surface. WebView owns its
  props/events/refs through Spark. Controlled UI values, explicit pane composition
  and generic drag/drop contracts changed; remove assumptions about old callbacks.
- Internal transport exports are private. Use the installed public entry paths
  and types instead of importing implementation packages or relying on `export *`.

### Metro and custom native modules

`/universal` was removed. Split `nativeConfig` and `metroConfig` imports:

Before:
```js
// react-native.config.js
module.exports = require("@legendapp/spark/universal").nativeConfig(__dirname);
// metro.config.js
module.exports = require("@legendapp/spark/universal").metroConfig(__dirname);
```
After:
```js
// react-native.config.js
module.exports = require("@legendapp/spark/native").nativeConfig(__dirname);
// metro.config.js
module.exports = require("@legendapp/spark/metro").metroConfig(__dirname);
```

Existing Expo integrations keep `getDefaultConfig` + `withSparkMetro` composition,
now from `/metro`. Preserve custom transforms/resolvers. Package-manager scripts
continue to invoke `spark`; keep the installed SDK's template pins rather than
independently upgrading React/Expo.

Spark's standard AppDelegate owns React bootstrap and event dispatch. Move custom
pre-JavaScript native startup work to a linked package implementing
`SparkStartupPlugin` in `RNDesktopApp/SparkLifecycle.h`, configured under
`macos.lifecycle.plugins` and retained by native `include`. Do not subclass or
replace the delegate to override quit/reopen or file dispatch. Configure initial
window policy under `macos.lifecycle.mainWindow`:

```json
{ "macos": { "lifecycle": { "mainWindow": { "hidden": true, "closeBehavior": "hide", "reopenBehavior": "visibleWindows" }, "plugins": ["EditorStartupPlugin"] } }, "include": ["editor-native"] }
```

Register native quit decisions with `SparkRegisterQuitHandler`, reply exactly once
on the main thread, and remove with `SparkRemoveQuitHandler`. Rebuild and validate
custom runtimes after moving native startup work; preserve application data and
existing frame autosave identity. See the installed native headers and the
[native host guide](https://github.com/LegendApp/legend-spark/blob/main/docs/host-migration.md)
for fuller lifecycle semantics.

## 0.0.1-next.4

Breaking: no. Target pins and verified native archives update together. Doctor
now treats ranges as drift for the tested framework baseline. Required overrides
use `overrides` (npm/Bun), `resolutions` (Yarn), or `pnpm.overrides`. Keep the
app's manager and lockfile; workspace/catalog pins must be changed at their owner.

Before:
```json
{ "dependencies": { "react": "^19.1.0", "expo": "^54.0.0" } }
```
After (for this release):
```json
{ "dependencies": { "react": "19.1.4", "react-native": "0.81.6", "expo": "54.0.37" } }
```

Camera and enriched Markdown native dependency patches are applied by the SDK.
Use public `/camera` and `/markdown` imports; stop manually patching their bundled
dependencies. Existing custom runtimes must rebuild to include changed native
code. Native production builds fail when app source imports an excluded module:
check `spark analyze` and native-only `include` requirements rather than weakening
the selection. SidebarSplitView gained a native content-list column and swipe
actions; review customized pane composition if affected. Windows notification
actions and Nitro initialization changed; validate custom Windows native modules.

AI pointer files now refer to this installed skill. Upgrade preserves user text
and reports malformed markers. Pointer refresh alone does not migrate application
call semantics; complete every earlier section in the upgrade interval.
