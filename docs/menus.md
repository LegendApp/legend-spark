# Menu contracts

Spark menu items use discriminated `type` values and stable IDs. `label`, `disabled`, `hidden`, `checked`, and accelerator strings have the same meaning across surfaces. The shared model includes actions, checkboxes, separators, submenus, semantic native roles and numeric sliders. Each surface supports an explicit subset; unsupported requested items/options reject before native changes. IDs are unique across the complete tree, including hidden entries. Hidden items are omitted from the published snapshot; disabled ancestors disable selection of their descendants.

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

Application menu and toolbar adapters are being converted to this shared model; this document does not claim those conversions are complete.

Tray menus use this model for actions, checkboxes, separators and submenus. Tray menu icons, shortcuts, roles and sliders reject until that surface implements them. See [tray ownership and updates](desktop-integrations.md#tray--menu-bar-items).

Dock and taskbar menus now use shared items with explicit OS entry points. See [system integration](system.md) for supported items and ownership.
