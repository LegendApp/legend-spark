# Keyboard shortcuts and commands

Exports: `@legendapp/spark/shortcuts`, `/shortcuts/commands`, `/shortcuts/keyboard`, `/global-shortcuts`.

## Pick the right layer

| Need | Use |
| --- | --- |
| Shortcut shown in the menu bar | A menu item `shortcut` ([menus-tray-dock.md](menus-tray-dock.md)) |
| Named, user-rebindable commands scoped to a window or the app | `createHotkeyRouter` / `useRoutedHotkeys` from `/shortcuts/commands` |
| One focused-app accelerator | `registerShortcut(accelerator, handler, { windowId? })` from `/shortcuts` |
| Works while another app is frontmost | `registerGlobalShortcut` from `/global-shortcuts` |
| Raw key events / physical key codes | `addKeyboardListener` from `/shortcuts/keyboard` |

All share one accelerator syntax: `CmdOrCtrl+S`, `Alt+Left`, `Shift+Up`, `F5`.

## Rules

- `defaultBindings` is always an array; an empty array disables the command.
- Window-scoped registrations (priority 100) run before app-scoped ones (0). A handler returning `false` passes to the next Spark handler, but cannot hand the key back to AppKit: native consumption is decided before JS runs.
- Only definitions with `repeat: true` fire on key repeat.
- `setEnabled`, `suspend` and `remove` resolve after native matching acknowledges; await them before assuming the key is free.
- Global shortcuts that conflict with another app reject `E_BUSY`. Keys resolve with the layout at registration time; re-register after a layout change if needed.
- Persist user bindings with the commands module's hotkey store/file helpers rather than inventing a format.

```ts
import { createHotkeyRouter } from '@legendapp/spark/shortcuts/commands';

declare function saveDocument(): void;

const definitions = [{ id: 'save', title: 'Save', defaultBindings: ['CmdOrCtrl+S'] }] as const;
const router = createHotkeyRouter();
const registration = await router.register({
  definitions,
  scope: { kind: 'window', windowId: 'editor' },
  handlers: { save: () => { saveDocument(); } },
});
await registration.remove();
```

```ts
import { registerGlobalShortcut } from '@legendapp/spark/global-shortcuts';

declare function togglePanel(): void;

const shortcut = await registerGlobalShortcut('Cmd+Shift+K', () => togglePanel());
await shortcut.remove();
```

If a global shortcut opens a window while another app is frontmost, show it with `activate: true` ([windows.md](windows.md)).

## Platforms

macOS: all. Windows (dev builds): `/shortcuts`, `/global-shortcuts` and `/shortcuts/commands` (bindings display `Ctrl`/`Win`); `/shortcuts/keyboard` is macOS only and reports `unsupported-platform`. The macOS-only command keys (`Home`, `End`, `PageUp`, `PageDown`, media keys, `Fn`/`CapsLock`) reject on other surfaces. Mobile/web: not covered.
