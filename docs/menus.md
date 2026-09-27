# Menu contracts

Spark menu items use discriminated `type` values and stable IDs. `label`, `disabled`, `hidden`, `checked`, and accelerator strings have the same meaning across surfaces. The shared model includes actions, checkboxes, separators, submenus, semantic native roles and numeric sliders. Each surface supports an explicit subset; unsupported requested items/options reject before native changes. IDs are unique across the complete tree, including hidden entries. Hidden newly created items are omitted; targeted native items receive a hidden override; disabled ancestors disable selection of their descendants.

Menu images distinguish `{ type: 'symbol', name }` from `{ type: 'image', path }`. An image path is an absolute local native path or local file URL. Support depends on the surface and target. Sliders use numeric min/max/value fields and typed change events, rather than encoding values in IDs.

## Context menus

```ts
import { showContextMenu } from '@legendapp/spark/context-menu';
const result = await showContextMenu({
  windowId: 'main',
  position: { x: 30, y: 80 },
  items: [
    { type: 'action', id: 'open', label: 'Open' },
    { type: 'checkbox', id: 'pinned', label: 'Pinned', checked: true },
    { type: 'separator' },
    { type: 'action', id: 'delete', label: 'Delete', disabled: true },
  ],
});
if (!result.canceled) console.log(result.itemId);
```

Coordinates are logical units from the top-left of the explicit owner's content area. Focus does not select the owner. Empty menus return `{ canceled: true }`; a missing owner rejects `E_NOT_FOUND`. An active popup rejects concurrent requests with `E_BUSY`. Selection returns `{ canceled: false, itemId }`; unknown or disabled native selections reject `E_INVALID_DATA`.

Context menus currently support actions, checkboxes and separators, plus hidden/disabled flags. Submenus, roles, sliders, icons and shortcuts reject as unsupported on this surface. macOS and Windows retain native keyboard navigation and OS dismissal behavior. `getContextMenuAvailability()` is safe without an installed native module and is separate from opening a menu.

Toolbar popup adapters are still being converted to this shared model.

Tray menus use this model for actions, checkboxes, separators and submenus. Tray menu icons, shortcuts, roles and sliders reject until that surface implements them. See [tray ownership and updates](desktop-integrations.md#tray--menu-bar-items).

Dock and taskbar menus now use shared items with explicit OS entry points. See [system integration](system.md) for supported items and ownership.

## Application menus

```ts
import { createMenu } from '@legendapp/spark/menus';
const menu = await createMenu({
  id: 'editor',
  items: [{
    type: 'submenu', id: 'file', label: 'File', target: { menu: 'file' },
    items: [{ type: 'action', id: 'open', label: 'Open…', shortcut: 'CmdOrCtrl+O' }],
  }],
  onAction: event => { if (event.itemId === 'open') openDocument(); },
});
await menu.update({ items: [] });
await menu.remove();
```

Top-level items are submenus. Contributions merge by stable IDs, never labels. Later owners override matching items; updating an owner moves it to the end of precedence, which lets a focused document publish its commands. Removing it restores earlier contributions and native items. Arrays replace the owner's complete contribution. Use `target: { id }` to bind an existing item under a different callback ID; the original target ID remains its anchor for subsequent contributions. `target: { menu: 'app' | 'file' | 'edit' | 'view' | 'window' | 'help' }` selects a native root; a missing root is created using the supplied label. `placement: { before: target }` or `{ after: target }` positions relative to a sibling. Missing item/placement targets reject `E_NOT_FOUND`, retaining the previous publication. Remove dependent contributions before a root they explicitly target.

On macOS, `target: { role: 'copy' }` locates a native command regardless of localization. An action targeting a role dispatches to its JavaScript owner. A `type: 'role'` item keeps native responder-chain behavior; it does not emit a JavaScript action. Roles include document commands, editing, application visibility and window commands. The services role must target the existing native services submenu. Symbol/local-image icons are supported. Windows currently supports actions, checkboxes, separators, submenus and accelerators; native role items and images reject rather than being silently ignored. Sliders are reserved for toolbar popup menus.

Native publication is acknowledged before creation/update resolves. Publication is serialized across owners; callbacks are scoped to a unique registration, filtered to enabled visible actions, and stopped immediately on removal. Removal joins pending work and permits retry after failure. Duplicate owner IDs reject `E_ALREADY_EXISTS`. There is no public native bridge, global clear-all function or separate unowned action listener.

`useMenu({ id, items, onAction, onError?, onCleanupError? })` returns loading, ready (with `menu`) or error state. Keep the `items` array stable when its structure has not changed. Callback changes use the latest committed callback without republishing. Unmount disposes even a registration that finishes late; remount waits for the old hook lifetime to finish cleanup. Cleanup failures are reported through `onCleanupError(error, menu)` so the owner can retry; otherwise they go to `onError` or the console. The hook is exported alongside `createMenu` because Spark assumes React Native.
