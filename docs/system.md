# System integration

`@legendapp/spark/system` owns OS information, events, login startup, app badges, attention, power requests and launcher menus. `getSystemAvailability()` does not require an installed native module. Commands return `Promise<void>` and reject shared `SparkError` codes; query results are validated.

```ts
const blocker = await preventSleep({ reason: 'Exporting video', kind: 'display' });
try { await exportVideo(); } finally { await blocker.remove(); }
const attention = await requestAttention({ kind: 'informational' });
await attention.remove();
const events = await onSystemEvent(event => console.log(event.type));
await events.remove();
```

Power prevention defaults to display idle sleep; `kind: 'system'` permits the display to sleep. It does not prevent forced sleep or override OS policy. Attention defaults to informational. Registrations stop callbacks immediately on removal, join concurrent cleanup, and permit retry after failure. System events have independent native ownership; the last removal releases OS observers. Windows power registrations own dedicated [power request handles](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-powercreaterequest), closed on removal.

`getSystemInfo()` returns OS version, process architecture, locale, dark appearance, idle seconds, battery power and a nullable battery fraction from zero to one. `getLoginItemStatus()` distinguishes enabled, disabled, approval required, not found and unavailable; `setLaunchAtLogin(boolean)` requests the change. macOS requires a standalone distribution app; Windows currently reports unavailable. `setAppBadge(string)` controls the macOS Dock badge or Windows taskbar overlay; an empty string clears it.

`createDockMenu({ items, onAction })` is macOS-only; `createTaskbarMenu({ items, onAction })` is Windows-only. Both return an async registration and deliver `{ type: 'action', itemId }`. They use [shared menu items](menus.md). Dock menus support actions, checkboxes, separators and submenus. Taskbar Jump Lists support actions and checkboxes; checked tasks get a checkmark label, and disabled tasks are omitted because the OS cannot display them disabled. Other item kinds, icons and shortcuts reject. Callbacks accept only selectable IDs owned by the registration. There is one menu per application; duplicate creation rejects `E_ALREADY_EXISTS`. Remove it before creating a replacement; failed removal retains ownership for retry. No translated menu title is used as an identity.
