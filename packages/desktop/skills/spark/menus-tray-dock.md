# Menus, tray and Dock

Exports: `@legendapp/spark/menus`, `/context-menu`, `/tray`, plus `createDockMenu` / `createTaskbarMenu` from `/system`.

## Shared item model

All surfaces use typed items with stable IDs: `{ type: 'action' | 'checkbox' | 'separator' | 'submenu' | 'role' | 'slider', id, label, … }`. IDs must be unique across the whole tree, including hidden items. Each surface supports a subset and **rejects** unsupported items/options (`E_UNSUPPORTED_OPTION`) instead of ignoring them:

| Surface | Supports |
| --- | --- |
| App menu (`createMenu` / `useMenu`) | actions, checkboxes, separators, submenus, roles (macOS), icons (macOS), shortcuts |
| Context menu (`showContextMenu`) | actions, checkboxes, separators only |
| Tray (`createTray`) | actions, checkboxes, separators, submenus (no icons/shortcuts/roles) |
| Dock menu (`createDockMenu`, macOS) | actions, checkboxes, separators, submenus |
| Taskbar Jump List (`createTaskbarMenu`, Windows) | actions, checkboxes |

Shortcuts use accelerator strings such as `CmdOrCtrl+S`, `Cmd+Shift+N`.

## Application menu

- Top-level items are submenus. Target native roots with `target: { menu: 'file' | 'edit' | 'view' | 'window' | 'help' | 'app' }`; contributions merge by ID, never by label.
- Owners stack: a later or updated owner overrides matching items, and removing it restores earlier ones. A focused document can publish its commands and remove them on blur.
- In components use `useMenu` and keep the `items` array stable (memoize it); callback changes don't republish.
- A published shortcut takes over the key from a host menu item that has it (for example the template's `Ctrl+Cmd+S` Show Sidebar). Pick shortcuts that don't collide.
- `type: 'role'` items keep native responder-chain behavior and emit no JS action. To run your own code for a native command, use an action with `target: { role: 'copy' }`.

```ts
import { createMenu } from '@legendapp/spark/menus';

declare function openDocument(): void;

const menu = await createMenu({
  id: 'editor',
  items: [{
    type: 'submenu', id: 'file', label: 'File', target: { menu: 'file' },
    items: [{ type: 'action', id: 'open', label: 'Open…', shortcut: 'CmdOrCtrl+O' }],
  }],
  onAction: event => { if (event.itemId === 'open') openDocument(); },
});
await menu.remove();
```

## Context menu

Pass the explicit owner `windowId` and a position in that window's content coordinates. Only one popup at a time (`E_BUSY` otherwise). Check `result.canceled`.

```ts
import { showContextMenu } from '@legendapp/spark/context-menu';

const result = await showContextMenu({
  windowId: 'main',
  position: { x: 30, y: 80 },
  items: [{ type: 'action', id: 'open', label: 'Open' }, { type: 'separator' }, { type: 'action', id: 'delete', label: 'Delete' }],
});
if (!result.canceled) console.log(result.itemId);
```

## Tray / menu bar and Dock menu

- Create the tray from a mounted React root and remove it on teardown. Duplicate IDs reject `E_ALREADY_EXISTS`. `update()` merges; arrays replace.
- On macOS `title` is visible text; `macos: { symbol: 'name' }` adds an SF Symbol. On Windows the app icon is used and macOS options reject.
- Opening UI from a tray, menu-bar, popover or Dock-menu click must activate the app: `showWindow('main', { activate: true })` (see [windows.md](windows.md)).
- Menu-bar-only apps (no Dock icon) need `"menuBarOnly": true` at the top level of `desktop.config.json` (`expo.extra.spark.menuBarOnly` in a direct `app.json` project) and a custom build. Always create a tray or another way to reopen the app.
- One Dock menu (macOS) / one Jump List (Windows) per app; remove it before creating a replacement.

```ts
import { createTray } from '@legendapp/spark/tray';
import { showWindow } from '@legendapp/spark/windows';

const tray = await createTray({
  id: 'main',
  title: 'My app',
  menu: [{ type: 'action', id: 'open', label: 'Show app' }],
  onAction(event) {
    if (event.type === 'action' && event.itemId === 'open') void showWindow('main', { activate: true });
  },
});
await tray.remove();
```

## Platforms

macOS: all surfaces. Windows (dev builds): app menu without roles/icons/alternates/lifecycle, context menu, tray, Jump List. Check `getMenuAvailability(feature)` for macOS-only menu features. Mobile/web: none of these APIs.
