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
// Stops dispatch immediately; resolves after native observer cleanup.
await registration.remove();
```

`defaultBindings` is always an array. A supplied empty array disables a command;
omitted overrides use the definition defaults. Each registration snapshots its
configuration. Higher priority runs first; the defaults are 100 for window scope
and 0 for application scope. Equal priorities use the newest registration first.
A handler returning `false` lets dispatch continue; other synchronous results
consume the event. Handlers must make that decision synchronously; launch async
work explicitly and handle its errors. Only definitions with `repeat: true` run
on repeated keydowns. `allowExtraModifiers` opts into subset modifier matching.

Routing uses the native event's window ID when present, then the configured
active-window reader or `setActiveWindowId`. Changing windows resets pressed-key
state. `router.suspend(scope?)` returns a synchronous subscription; remove it to
resume. Suspension of the active window also blocks application handlers there.
The router shares a pair of native listeners and stops them after its last
registration. Registration readiness and cleanup failures reject with Spark
errors; failed cleanup can be retried on the same handle.

`useRoutedHotkeys({ router, definitions, bindings, handlers, ... })` returns
`loading`, `ready` (with the registration), or `error`. It reads current handlers
and enabled state without replacing the registration for callback identity
changes, and disposes late registrations after unmount. `onError` reports setup
failure; `onCleanupError(error, registration)` exposes failed cleanup for retry.
`useHotkeySuspension` provides effect-owned suspension.

`HotkeyCapture` owns listeners only while recording, commits one accelerator on
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
`/shortcuts/keyboard` resolves to an `AsyncRegistration`. Events contain `eventId`,
`windowId` (or null), a layout-derived unmodified `key`, physical `keyCode`, and
modifier flags. Window filtering applies equally to keydown and keyup. The last
registration removal stops the native monitor and removes bridge observers.
Failed removal can be retried. The raw native module, singleton keyboard manager
and global stop function are no longer public.

The low-level backend and command router currently require macOS. Query
`getKeyboardAvailability()` if needed; registration rejects explicitly on other
hosts or without its native module. Registered local/global shortcuts have their
own separate platform support. Importing command helpers does not require the
keyboard or symbol native modules to be installed.

Keyboard consumption still uses the existing native response deadline. Late JS
responses are ignored and released, and cannot consume a key after the deadline.
Mounted React lifecycle/capture tests, persistence/routing tests and native syntax
checks cover this cleanup. Actual key dispatch, keyboard layouts, media keys and
focus transitions still need native host acceptance.
