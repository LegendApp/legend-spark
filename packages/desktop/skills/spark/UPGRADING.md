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
Use public `/camera` (removed in 0.0.2-next.0 — import `react-native-vision-camera`
directly) and `/markdown` imports; stop manually patching their bundled dependencies.
Existing custom runtimes must rebuild to include changed native code. Native
production builds fail when app source imports an excluded module:
check `spark analyze` and native-only `include` requirements rather than weakening
the selection. SidebarSplitView gained a native content-list column and swipe
actions; review customized pane composition if affected. Windows notification
actions and Nitro initialization changed; validate custom Windows native modules.

AI pointer files now refer to this installed skill. Upgrade preserves user text
and reports malformed markers. Pointer refresh alone does not migrate application
call semantics; complete every earlier section in the upgrade interval.

## 0.0.1-next.5

Breaking: no. No app source or configuration migration is required from next.4.

Create new apps with `npm create @legendapp/spark@next MyApp`. The creator and SDK
share a version and channel. React peers now accept `^19.1.0`; generated apps keep
the tested React 19.1.4, React Native 0.81.6, and Expo 54.0.37 pins.

Read-only rich text is available alongside the existing editable components:

```tsx
import { Markdown } from '@legendapp/spark/markdown';
import { Html } from '@legendapp/spark/html';

<Markdown value="# Preview" />;
<Html value="<p>Preview</p>" />;
```

Existing `MarkdownInput` and `HtmlInput` imports continue to work. Typecheck your
app and exercise any rich text views you add; rebuild a custom runtime if its
native rich text dependencies changed since your previous SDK version.

## 0.0.1-next.6

Breaking: no. No app source or configuration migration is required from next.5.

This release republishes the creator from the release artifacts. The next.5 creator was a local
development pack and could not create new apps; create them with
`npm create @legendapp/spark@next MyApp`.

## 0.0.1-next.7

Breaking: no. No app source or configuration migration is required from next.6.

Creating apps: the creator now picks which Spark release to scaffold. Pass
`--next` for the newest preview, `--latest` for the current stable release, or
`--spark-version <version>` for an exact one. Use these with pnpm and yarn,
which ignore or reject a tag in `pnpm create` / `yarn create`, for example
`pnpm create @legendapp/spark MyApp --next`. If the creator you ran does not
match the requested Spark version, it stops and prints the exact
`npx @legendapp/create-spark@<version>` command to run instead.

Publishing: releases now refuse to publish a creator that was not built from
that release's artifacts or whose version differs from `@legendapp/spark`, so a
broken creator like next.5's cannot ship again. Existing apps are unaffected.

## 0.0.1-next.8

Breaking: no. No app source migration is required from next.7.

Creating apps: `create-spark` now works under Yarn 4 Plug'n'Play
(`yarn dlx @legendapp/create-spark MyApp --next`).

expo-desktop: Spark now pins the SDK 54 expo-desktop packages to their latest
patches (expo-desktop 1.0.6, config-plugins 1.3.2, prebuild-config 1.1.3,
metro-config 54.81.3). Fixes include relaunching while an old instance runs,
reusing a running Metro, and blank windows in iOS+macOS Debug apps. expo-desktop
now reads the macOS version and build number from `expo.macos`; Spark sets these
automatically from the app's version (and `macos.buildNumber`, else
`ios.buildNumber`, else "1"), so no app change is needed. Rebuild custom
runtimes (`spark build --dev`). Do not upgrade expo-desktop packages to SDK 55
tags.

Publishing: each release now publishes straight to its channel (stable ->
latest, preview -> next). Existing apps are unaffected.

## 0.0.1-next.9

New starters write pnpm overrides only to `pnpm-workspace.yaml`, supported by
pnpm 10, 11 and 12. pnpm 12 rejects the duplicate `pnpm.overrides` previously
left in `package.json`. For existing apps, move those overrides into the YAML
file's top-level `overrides` map, remove `pnpm.overrides` from `package.json`,
and run `pnpm install` before `pnpm run dev`. Keep local `file:` archive pins.

Starters also pin Expo to `54.0.37` throughout the dependency graph.
`expo-desktop-template-bare-minimum@54.81.6` requests `expo@~54.0.35`, which
Yarn 4 can resolve to a second Expo version alongside the starter's exact pin.
For existing Yarn apps on this SDK, add `"expo": "54.0.37"` to `resolutions`
and run `yarn install`; Spark's native preflight requires one Expo version.

## 0.0.1-next.10

Clearer wording when a new app downloads the prebuilt Spark Runner: `spark dev` (and `npm run macos`) shows `Downloading Spark Runner (20.6 MB)…` with a progress bar after Metro starts, then `Spark Runner installed, opening your app…`. The "Press d to install and open it" prompt now appears only when the session doesn't open the desktop app by itself, such as with `--no-open`. No changes are needed in existing apps.

## 0.0.1

The first stable release. It contains everything from `0.0.1-next.9`, plus
clearer wording when a new app downloads the prebuilt Spark Runner.

`spark dev` (and `npm run macos`) now downloads the Runner automatically and
shows `Downloading Spark Runner (20.6 MB)…` with a progress bar after Metro
starts, then `Spark Runner installed, opening your app…`. The old "Press d to
install and open it" prompt now appears only when the session doesn't open the
desktop app by itself, such as with `--no-open`.

No changes are needed in existing apps. Update `@legendapp/spark` to `0.0.1`
and reinstall.

## 0.0.2-next.0

Next version (provisional version number).

Breaking: yes. `@legendapp/spark/camera` was removed. Install
`react-native-vision-camera@5.2.3` and `react-native-nitro-image@0.15.2` in your
app, with `react-native-nitro-modules@0.37.0`. Import camera APIs directly from
`react-native-vision-camera`, and `NitroImage` / `Image` from
`react-native-nitro-image`. Spark still applies its version-pinned native patches
automatically when your app depends on these libraries. Rebuild custom runtimes.

The `/markdown`, `/html`, `/webview`, and `/sqlite` APIs remain available, but
Spark no longer installs their backends. Add only the libraries your app uses
to its own `dependencies`, retaining the SDK's tested overrides:

| Spark import | App dependency |
| --- | --- |
| `@legendapp/spark/markdown` | `react-native-enriched-markdown@1.1.1` |
| `@legendapp/spark/html` | `react-native-enriched-html@1.1.1` |
| `@legendapp/spark/webview` | `react-native-webview@16.0.0` |
| `@legendapp/spark/sqlite` | `@op-engineering/op-sqlite@18.2.1` |

For WebView and SQLite, keep the matching patched SDK archive override supplied
by `spark upgrade` or `spark add desktop`. Run your package manager's install,
then `spark doctor` and rebuild custom runtimes. Native discovery and patching
activate only for installed app dependencies; optional peers alone do not select
native code. Nitro Modules and Runtimes remain hard dependencies.

Universal apps targeting Windows must exclude `react-native-enriched-html` and
`react-native-enriched-markdown` in `expoByPlatform.windows.autolinking.exclude`
in `desktop.config.json`, because these backends have no Windows implementation.

The `/native` `NativeConfiguration` type now describes only Spark's emitted
`platforms` and `dependencies` overrides; use your own CLI configuration type for
extra project or dependency fields, preserved by `withSparkNative`.

New apps now get a placeholder bundle ID, `com.example.<app-name>`, instead of
`so.legend.spark.prototype.<app-name>`. Pass `--bundle-id com.yourcompany.myapp`
to `create` to choose one up front, or change `bundleIdentifier` in
`desktop.config.json` before you ship. Release builds warn while the ID still
starts with `com.example.`. Existing apps keep their ID.

`spark dev` no longer hangs on "Waiting for Watchman `watch-project`" when
Watchman stops responding. After 10 seconds it starts Metro without Watchman
for that session and suggests `watchman watch-del-all && watchman shutdown-server`
to fix it.
