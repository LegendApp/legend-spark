# Plugins

`@legendapp/spark/plugins` is the v1 plugin scaffold: an application ships plugins in its own bundle, declares them to
a host with the capabilities it grants each one, and loads each into its own isolated JavaScript runtime
([Runtimes](runtimes.md)). A loaded plugin registers commands, panels, file types and menu items; the application
decides where they appear.

v1 is deliberately small. There is no marketplace, no installation, no downloading, no loading code from a path or a
string, and no plugin-to-plugin API. Those belong to a later ecosystem release.

## Writing a plugin

```ts
// tasks.ts (or any file under src/), so the Runtimes compiler bundles it as a worker task
import { runtimeFunction } from "@react-native-runtimes/core";
import { definePlugin, type PluginManifest } from "@legendapp/spark/plugins";

export const wordCountManifest: PluginManifest = {
  id: "com.example.word-count", name: "Word count", version: "1.0.0", apiVersion: 1,
  capabilities: ["commands", "menuItems"],
};

export const wordCount = runtimeFunction(definePlugin(wordCountManifest, {
  activate: () => ({
    commands: [{ id: "com.example.word-count.count", title: "Count words" }],
    menuItems: [{ id: "com.example.word-count.menu", title: "Count Words", command: "com.example.word-count.count" }],
  }),
  commands: {
    "com.example.word-count.count": args => ({ words: String((args as { text: string }).text).split(/\s+/).filter(Boolean).length }),
  },
}));
```

Everything in `definePlugin`'s implementation runs only in the plugin's runtime. Its module state lives in that heap.
Arguments and results are JSON. A throw from `activate`, a command or `deactivate` reaches the host as a `PluginError`
with its `phase`, and the plugin stays loaded after a command throws.

## Hosting plugins

```ts
import * as Runtimes from "@react-native-runtimes/core";
import { createPluginHost } from "@legendapp/spark/plugins";
import { wordCount, wordCountManifest } from "./tasks";

const plugins = createPluginHost({
  runtimes: Runtimes,
  plugins: [{ manifest: wordCountManifest, entry: wordCount, grant: ["commands", "menuItems"] }],
});
await plugins.load("com.example.word-count");
const result = await plugins.execute("com.example.word-count", "com.example.word-count.count", { text: "one two" });
await plugins.unload("com.example.word-count");
```

The application passes the Runtimes module, so Spark never imports Runtimes itself and an app without plugins keeps it
out of production. `list()`/`get()` report each plugin's `state` (`unloaded`, `loading`, `loaded`, `unloading`,
`failed`), its granted capabilities, its runtime name, what it registered and the last failure. `subscribe` and the
observing hook `usePlugins(host)` follow changes; the hook never loads or unloads anything. `remove()` unloads every
plugin and closes the host.

| Contribution | Needs capability | What the host does |
| --- | --- | --- |
| `commands` `{ id, title }` | `commands` | `execute(pluginId, command, args)` runs the plugin's handler in its runtime |
| `panels` `{ id, title, component }` | `panels` | Records the threaded component name; render it with `ThreadedReactSurface` and the plugin's `runtimeName` |
| `fileTypes` `{ id, name, extensions, command }` | `fileTypes` | `findFileHandlers(path)` returns loaded plugins whose extensions match; run the file type's `command` with `{ path }` |
| `menuItems` `{ id, title, command }` | `menuItems` | Records the item; publish it with `@legendapp/spark/menus` and run its `command` when chosen |

The host does not create OS file associations (those are build-time `Info.plist` declarations) or native menus by
itself. The Kitchen Sink shows the composition: it publishes loaded plugins' menu items as a Plugins menu with
`createMenu` and removes it with the last one.

## Checks

The host checks each step before any plugin code runs, and rejects with a `SparkError`; nothing falls back:

- **Declaration** (`createPluginHost`): every manifest is validated (`E_INVALID_DATA`): a lowercase reverse-DNS `id`,
  a `name`, a semantic `version`, a positive integer `apiVersion`, distinct known `capabilities`, and no unknown fields.
  The `entry` must be a bundled `runtimeFunction(...)` export (`E_INVALID_ARGUMENT`); strings, URLs, paths and plain
  functions are refused. Duplicate IDs reject `E_ALREADY_EXISTS`.
- **Compatibility** (`load`): a manifest whose `apiVersion` is not `PLUGIN_API_VERSION` (1) rejects
  `E_UNSUPPORTED_OPTION`. No adapter runs a plugin written for another version.
- **Grants** (`load`): a plugin requesting a capability the application did not grant rejects `E_PERMISSION_DENIED`
  before its runtime starts.
- **Contributions** (after `activate`): registering a kind the manifest did not request, or an ID outside the plugin's
  `<id>.` namespace, is a sandbox violation (`E_PERMISSION_DENIED`); malformed items, duplicates, more than 100 of a
  kind, and menu items or file types naming a command the plugin did not register reject `E_INVALID_DATA`. The plugin
  is marked `failed`, registers nothing and its runtime is destroyed.
- **Calls**: each activation, command and deactivation is bounded by `timeoutMs` (default 10 s). A timeout, a runtime
  failure or a malformed answer marks the plugin `failed`, withdraws its contributions and destroys its runtime. Other
  plugins keep running. Unloading withdraws contributions first, rejects pending calls `E_CLOSED`, runs `deactivate`,
  then destroys the runtime; loading again starts a fresh heap.

## Limits of v1

- **Trust.** Plugins are code the application developer bundles and declares. The capability model governs what a
  plugin registers with the host. It is not a native sandbox: a plugin runtime has the same native modules as any
  Runtimes worker, so it could call filesystem or other native APIs directly ([#391](https://github.com/LegendApp/legend-spark/issues/391)).
  Do not treat v1 as a boundary for untrusted third-party code.
- **Discovery** is the application's declaration list. There is no directory scan or install step.
- **Panels** name a threaded component bundled with the app; any bundled threaded component name is accepted.

## Platforms

`getPluginAvailability()` reports `{ available: true }` on macOS when the Runtimes native module is present
(`missing-module` otherwise). Windows reports `unsupported-platform` and `load` rejects `E_UNSUPPORTED_PLATFORM` until
plugin isolation is verified on its Runtimes backend ([#390](https://github.com/LegendApp/legend-spark/issues/390)). Other
platforms report `unsupported-platform`: Spark does not target them, and on web upstream Runtimes runs worker functions
on the main heap, which is not isolation.

The Kitchen Sink screen is Future-facing capabilities > Plugins (`spark-ks://future-facing-capabilities/plugins`).
