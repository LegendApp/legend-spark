# Commands and keyboard input

`@legendapp/spark/shortcuts/commands` owns named commands, routing, capture controls
and optional file persistence. The shortcut syntax comes from the same parser as
menus and registered shortcuts: `CmdOrCtrl+S`, `Alt+Left`, `Shift+Up`, `F5`.
Commands additionally allow unmodified character keys and the low-level macOS
keys `Home`, `End`, `PageUp`, `PageDown`, `MediaPlayPause`, `MediaNext`, and
`MediaPrevious`, with explicit `Fn`/`CapsLock` modifiers. Other shortcut surfaces
reject these extensions when unavailable. Numeric physical key-code strings,
display glyph strings, legacy storage conversion and scalar binding aliases are
removed. Physical codes remain available through `/shortcuts/keyboard`.

```ts
import { createHotkeyRouter } from '@legendapp/spark/shortcuts/commands';

const definitions = [
  { id: 'save', title: 'Save', defaultBindings: ['CmdOrCtrl+S'] },
] as const;
const router = createHotkeyRouter();
const registration = await router.register({
  definitions,
  scope: { kind: 'window', windowId: 'editor' },
  handlers: { save: () => { saveDocument(); } },
});
await registration.setEnabled(false); // Resolves when native matching is disabled.
await registration.setEnabled(true);
const suspended = await router.suspend({ kind: 'window', windowId: 'editor' });
await suspended.remove(); // Resolves when native matching resumes.
// Stops dispatch immediately; resolves after native rules and observers are removed.
await registration.remove();
```

`defaultBindings` is always an array. A supplied empty array disables a command;
omitted overrides use the definition defaults. Each registration snapshots its
configuration. Higher priority runs first; the defaults are 100 for window scope
and 0 for application scope. Equal priorities use the newest registration first.
A handler returning `false` lets dispatch continue to the next Spark handler; other
synchronous results stop that routing. Native consumption is decided from the
registered, enabled bindings before JavaScript runs. Returning `false` cannot send
the key back to AppKit. Launch async work explicitly and handle its errors. Only definitions with `repeat: true` run
on repeated keydowns. `allowExtraModifiers` opts into subset modifier matching.

Routing and native matching use the native event's window ID (the event window or
AppKit's key window). Changing windows resets pressed-key state; `setActiveWindowId`
can also reset that state when the app receives focus changes. It does not override
native event ownership. `enabled` is a boolean, and the registration's
`setEnabled(boolean)` resolves after native matching acknowledges the update.
JavaScript predicates are not an event-time native consumption mechanism.

`await router.suspend(scope?)` returns an asynchronous registration; await its
`remove()` to resume. Window suspension also blocks application handlers there.
The router shares native observers and one owner for its compiled consumption rules.
The final registration releases both. Setup, updates and cleanup reject on failure;
cleanup can be retried on the same handle. Disable/removal stops JS callbacks
immediately, and native changes take effect by acknowledgment. Already consumed
keydown events retain a paired consumed keyup even if their owner is removed.

`useRoutedHotkeys({ router, definitions, bindings, handlers, ... })` returns
`loading`, `ready` (with the registration), or `error`. It reads current handlers
and enabled state without replacing the registration for callback identity
changes, and disposes late registrations after unmount. `onError` reports setup
or update failure; `onCleanupError(error, registration)` exposes failed cleanup for retry.
`useHotkeySuspension` provides effect-owned suspension and accepts `onError` and
`onCleanupError` for asynchronous setup and cleanup failures.

`HotkeyCapture` owns observers and a native capture registration only while recording, commits one accelerator on
key release and cancels on Escape. Its `onChange` receives a named string.
`HotkeyBindingsSettingsContent` and `HotkeyBindingsSettingsPage` use the same
array contract and support one or several shortcuts per command. The parallel
scalar settings components and hook are removed. Components and imperative
functions share the commands import.

## Persistence

`createHotkeyStore({ definitions, path, maxBindingsPerCommand?, storage?,
debounceMs? })` is available from the commands module; the `/storage` forwarding
export is removed. File support loads when the factory is called. Await it before
using its `value$`, `error$`, `flush()` and `close()` resource, following
[observable settings](settings.md). Legend State owns the observable interface.
The file has one format:

```json
{ "version": 1, "bindings": { "save": ["CmdOrCtrl+S"] } }
```

Canonical serialization retains `CmdOrCtrl`, so a saved binding does not turn
into a macOS-only Command binding. Missing commands acquire defaults, removed
command IDs are discarded, and empty arrays remain empty. Invalid versions,
scalar values or malformed accelerators reject and preserve existing file bytes.
If set, `maxBindingsPerCommand` keeps the first N bindings; it must be a
nonnegative integer. Conflicts compare equivalent accelerators on the active
platform and remain visible to the application rather than silently overwriting
one command with another.

## Shortcut map

`createShortcutMap` makes command shortcuts user-editable. It reuses the command model
above: each command is a `HotkeyDefinition` with an optional `scope` of `application`
(default), `window`, `view` or `global`. The map persists user changes, reports conflicts
and switches live registrations and menu key equivalents together.

```ts
import { createShortcutMap } from '@legendapp/spark/shortcuts/commands';

const map = await createShortcutMap({
  commands: [
    { id: 'new-note', title: 'New note', defaultBindings: ['CmdOrCtrl+N'] },
    { id: 'find', title: 'Find', defaultBindings: ['CmdOrCtrl+F'], scope: 'window' },
    { id: 'capture', title: 'Quick capture', defaultBindings: ['CmdOrCtrl+Shift+Space'], scope: 'global' },
  ],
  // store defaults to the project `settings` store; key defaults to 'shortcut-map'.
});
const live = await map.register({ windowId: 'main', handlers: { 'new-note': () => createNote(), find: () => showFind() } });
await map.attachMenu(menu, shortcut => ({ items: buildMenu(shortcut) })); // shortcut('new-note') → 'CmdOrCtrl+N'
const { conflicts } = map.validate('find', 'CmdOrCtrl+S'); // Check before applying.
await map.rebind('find', ['CmdOrCtrl+Shift+F']);
await map.unbind('new-note');
await map.reset('find'); // or map.reset() for every command
const subscription = map.addListener(change => render(change.snapshot));
```

`register({ handlers, windowId? })` registers the commands that have handlers, through
`map.router` (a command router you can pass in or that the map creates). Application commands
use priority 0, window commands 100 and view commands 200 in `windowId`, so a view's commands
outrank its window's, which outrank the application's. Window and view commands require
`windowId`. Global commands register with `registerGlobalShortcut`. Handlers receive
`{ commandId, binding, scope, keyboard? }`; `keyboard` is the router context for local scopes.

`attachMenu(menu, build)` republishes the menu whenever bindings change. `build` receives
`shortcut(commandId)`, the command's first binding. Give each command's menu item the command
ID so its key equivalent is not reported as a conflict with its own command.

### Atomic rebinding

`rebind`, `unbind` and `reset` run one at a time. Each change stages every surface, persists,
then switches at one synchronous JavaScript commit:

1. Router registrations publish native rules that consume both the old and new bindings, while
   JavaScript still dispatches the old ones. New global hotkeys register with a handler that only
   runs for committed bindings.
2. Attached menus republish with the new key equivalents. Both binding sets are consumed by the
   keyboard manager before AppKit's key-equivalent pass, so neither menu state can fire.
3. The settings store writes the new overrides.
4. The commit switches dispatch. Then the router publishes only the new rules and the old global
   hotkeys are removed.

Every keydown is therefore handled by exactly one binding set: the old one until the commit,
the new one after. A key pressed between the commit and the final publication can be consumed
without firing. If a stage fails, every surface rolls back and the promise rejects; the old
bindings stay live throughout. If only the final release fails, the new bindings are live and
saved and the promise rejects with that release error. The router offers the same switch for a
single registration as `registration.setBindings(bindings)`, and `useRoutedHotkeys` uses it when
its `bindings` change instead of replacing the registration.

### Validation and reserved shortcuts

Bindings are parsed by the shared accelerator parser: local commands allow unmodified keys and
extended keys, global commands use the strict global-shortcut rules. Invalid accelerators reject
`E_INVALID_ARGUMENT` (or `E_UNSUPPORTED_OPTION` for keys a surface lacks), unknown commands
`E_NOT_FOUND`. `getReservedShortcuts(platform?)` lists the shortcuts each OS owns. `reserved`
entries reject with `E_BUSY`, including in a command's defaults. `warning` entries are accepted
and appear as conflicts with `source: 'system'`.

| Platform | Rejected (`reserved`) | Accepted with a conflict (`warning`) |
| --- | --- | --- |
| macOS | ⌘Tab, ⌘⇧Tab, ⌘⌥Esc (Force Quit), ⌘⌃Q (Lock Screen), ⌘⇧Q (Log Out) | ⌘Space (Spotlight), ⌃Space and ⌘⌃Space (input sources, Character Viewer), ⌘⇧3/4/5 (screenshots), ⌃↑ ⌃↓ ⌃← ⌃→ (Mission Control and Spaces), ⌘Q, ⌘H, ⌘⌥H, ⌘M, ⌘` (standard app commands) |
| Windows (Cmd is the Windows key) | Ctrl+Alt+Delete, Alt+Tab, Alt+Shift+Tab, Ctrl+Shift+Esc, Ctrl+Esc, Win+L, Win+D, Win+Tab, Win+R, Win+E | Alt+F4, Alt+Space, Win+arrow keys (snapping) |

Comparison uses the active platform, so `CmdOrCtrl+Tab` is rejected on macOS but allowed on
Windows.

### Conflicts and change events

A conflict is `{ commandId, scope, binding, with }`. `with` names the other party:
another command (`source: 'command'` with its scope and ID), a `registerShortcut` registration
(`source: 'shortcut'`, scope `application` or `window` with its window ID), a
`registerGlobalShortcut` registration (`source: 'global-shortcut'`), an application menu item
(`source: 'menu'` with menu and item IDs) or a system warning (`source: 'system'`). The map's
own global hotkeys and attached menu items are not reported. Conflicts are reported, never
resolved by overwriting a binding.

`getSnapshot()` returns `{ commands, conflicts }`; each command has `bindings`,
`defaultBindings`, `customized` and its own `conflicts`. The snapshot keeps its identity
until something it reports changes. `addListener` delivers `{ reason, commandIds, snapshot }`
with reason `rebind`, `unbind`, `reset`, or `external` when a registration elsewhere changes
the conflicts. Live registrations are observed only while a listener exists.
`useShortcutMap(map)` observes a caller-owned map for rendering; unmounting removes only its
subscription. `close()` removes the map's registrations and listeners.

### Persistence

The map stores only user changes, in its settings key:

```json
{ "version": 2, "overrides": { "find": ["CmdOrCtrl+Shift+F"], "new-note": [] } }
```

A missing command uses its current defaults, so changed defaults reach users who never
customized them. An empty array unbinds. Rebinding to exactly the defaults removes the
override. Overrides for commands an app no longer declares are dropped. Version 1 files
(`createHotkeyStore`'s full binding lists) migrate on load: bindings equal to the defaults are
dropped, the rest become overrides, and the version 2 file is written before the map resolves.
Other versions, malformed values, invalid accelerators and reserved bindings reject
`E_INVALID_DATA` without changing the stored bytes.

### Platform support

The map itself, persistence, validation and conflicts are platform-independent.
`getShortcutMapAvailability(scope)` reports live dispatch: application, window and view
commands need the keyboard manager (`getKeyboardAvailability`, macOS only today); global
commands need global shortcuts (macOS and Windows). On Windows, registering a local command
rejects `E_UNSUPPORTED_PLATFORM`; global commands and attached menus work. Windows keyboard
manager support is tracked in [#259](https://github.com/LegendApp/legend-spark/issues/259).

## Low-level keyboard events

`addKeyboardListener('down' | 'up', listener, { windowIds? })` under
`/shortcuts/keyboard` resolves to an `AsyncRegistration`. Events contain `windowId` (or null), a layout-derived unmodified `key`, physical
`keyCode`, modifier flags, and booleans `repeated`, `consumed`, and `captured`.
These report the native event decision; callback return values never change it. Window filtering applies equally to keydown and keyup. The last
registration removal stops the native monitor and removes bridge observers.
Failed removal can be retried. The raw native module, singleton keyboard manager
and global stop function are no longer public.

The low-level backend and command router currently require macOS. Query
`getKeyboardAvailability()` if needed; registration rejects explicitly on other
hosts or without its native module. Registered local/global shortcuts have their
own separate platform support. Importing command helpers does not require the
keyboard or symbol native modules to be installed.

Native keyboard matching never waits for JavaScript. Low-level listeners observe
events without blocking AppKit. Use registered shortcuts or explicitly enabled
commands for native consumption; capture controls temporarily consume all monitored
keys with their own native ownership.
Mounted React lifecycle/capture tests, persistence/routing tests and native syntax
checks cover this cleanup. Actual key dispatch, keyboard layouts, media keys and
focus transitions still need native host acceptance.
