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
