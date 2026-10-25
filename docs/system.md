# System integration

`@legendapp/spark/system` owns OS information, events, login startup, app badges and progress, attention, power requests and launcher menus. `getSystemAvailability()` does not require an installed native module; `getSystemAvailability(feature)` reports one of `appBadge`, `appProgress`, `attention`, `dockMenu`, `taskbarMenu` and `appearancePreferences` ([Appearance preferences](#appearance-preferences)) for the running platform. Commands return `Promise<void>` and reject shared `SparkError` codes; query results are validated.

```ts
const blocker = await preventSleep({ reason: 'Exporting video', kind: 'display' });
try { await exportVideo(); } finally { await blocker.remove(); }
const attention = await requestAttention({ kind: 'informational' });
await attention.remove();
const events = await onSystemEvent(event => console.log(event.type));
await events.remove();
```

Power prevention defaults to display idle sleep; `kind: 'system'` permits the display to sleep. It does not prevent forced sleep or override OS policy. Attention defaults to informational. Registrations stop callbacks immediately on removal, join concurrent cleanup, and permit retry after failure. System events have independent native ownership; the last removal releases OS observers. Windows power registrations own dedicated [power request handles](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-powercreaterequest), closed on removal.

`getSystemInfo()` returns OS version, process architecture, locale, dark appearance, idle seconds, battery power and a nullable battery fraction from zero to one. `getLoginItemStatus()` distinguishes enabled, disabled, approval required, not found and unavailable; `setLaunchAtLogin(boolean)` requests the change. macOS requires a standalone distribution app; Windows currently reports unavailable. `setAppBadge(value)` controls the macOS Dock badge or Windows taskbar overlay icon. It takes text or, on macOS, a count; an empty string or `0` clears it. macOS formats a count with the user's locale (`1,250` in English). Windows takes text only: a count rejects `E_UNSUPPORTED_PLATFORM`.

`createDockMenu({ items, onAction })` is macOS-only; `createTaskbarMenu({ items, onAction })` is Windows-only. Both return an async registration and deliver `{ type: 'action', itemId }`. They use [shared menu items](menus.md). Dock menus support actions, checkboxes, separators and submenus. Taskbar Jump Lists support actions and checkboxes; checked tasks get a checkmark label, and disabled tasks are omitted because the OS cannot display them disabled. Other item kinds, icons and shortcuts reject. Callbacks accept only selectable IDs owned by the registration. There is one menu per application; duplicate creation rejects `E_ALREADY_EXISTS`. Remove it before creating a replacement; failed removal retains ownership for retry. No translated menu title is used as an identity.

## Appearance preferences

```ts
const preferences = await getAppearancePreferences();
// { appearance: 'dark', automaticAppearance: true, accentColor: '#007aff', highlightColor: '#b3d7ff',
//   increaseContrast: false, reduceTransparency: false, reduceMotion: true, differentiateWithoutColor: false,
//   invertColors: false, keyboardNavigation: true }
```

`getAppearancePreferences()` (macOS; `getSystemAvailability('appearancePreferences')`) reads the user's settings when called:

| Field | macOS source | Invalidated by |
| --- | --- | --- |
| `appearance` (`light`/`dark`), `automaticAppearance` | System Settings > Appearance (`AppleInterfaceStyle`, `AppleInterfaceStyleSwitchesAutomatically`) | `appearanceChanged` |
| `accentColor`, `highlightColor` | `NSColor.controlAccentColor`, `selectedTextBackgroundColor` as sRGB `#rrggbb`, resolved in the app's effective appearance | `systemColorsChanged` (`NSSystemColorsDidChange`) |
| `increaseContrast`, `reduceTransparency`, `reduceMotion`, `differentiateWithoutColor`, `invertColors` | `NSWorkspace.accessibilityDisplayShould…` | `accessibilityDisplayChanged` (`NSWorkspaceAccessibilityDisplayOptionsDidChange`) |
| `keyboardNavigation` | `NSApp.fullKeyboardAccessEnabled`: System Settings > Keyboard > Keyboard navigation, not the separate Accessibility > Full Keyboard Access | none: macOS posts no change notification, so read it when needed |

`onSystemEvent` delivers `systemColorsChanged` and `accessibilityDisplayChanged` on macOS only. `appearance` is the system setting. The app can render otherwise: an app appearance override, a per-window override, or `NSRequiresAquaSystemAppearance` (which the test driver pins). `getSystemInfo().dark` is the app's effective appearance. A system color without an sRGB form rejects `E_NATIVE`; a malformed native value rejects `E_INVALID_DATA`. macOS has no system-wide text size setting with a public API, so there is no text scale field. Windows (accent, high contrast, transparency, animations and text scaling) is [#342](https://github.com/LegendApp/legend-spark/issues/342): `getAppearancePreferences()` rejects `E_UNSUPPORTED_PLATFORM` there. To read real preferences with known values, a test can pass the settings as launch arguments (for example `-AppleAccentColor 0 -reduceMotion YES`): they reach only that process's argument domain.

Per-window appearance is a window option ([window contract](api-window-contract.md)): `openWindow({ appearance })` and `setWindowOptions(windowId, { appearance: 'system' | 'light' | 'dark' })`; `system` follows the app. Semantic system colors come from react-native-macos: `PlatformColor('controlAccentColor')`, `PlatformColor('labelColor')` and the other `NSColor` names resolve in each view's effective appearance, so they follow app and window overrides. The Kitchen Sink's Appearance & theming > Appearance preferences screen shows all three.

## Dock progress

```ts
await setAppProgress({ state: 'normal', value: 0.35 });   // completed fraction, 0 to 1
await setAppProgress({ state: 'indeterminate' });
await setAppProgress({ state: 'paused', value: 0.6 });    // also 'error'
await setAppProgress(null);                               // clears it
```

`setAppProgress` shows one app-wide progress bar on the macOS Dock tile. It is macOS-only for now: on Windows it rejects `E_UNSUPPORTED_PLATFORM` and `getSystemAvailability('appProgress')` reports `unsupported-platform`. Values outside 0–1 and unknown states reject `E_INVALID_ARGUMENT`; extra keys reject `E_UNSUPPORTED_OPTION`. A JavaScript reload clears it.

On macOS the Dock tile gets a content view that draws the app icon (`NSApp.applicationIconImage`) with a capsule along its lower edge. The fill is the system accent color, yellow for paused and red for error; it starts at the right edge in right-to-left languages. Indeterminate progress is a striped full bar. It is not animated: the Dock redraws a tile only when asked. The track follows the system appearance (the Dock's, not an app's appearance override) and redraws when it or the accent color changes. The Dock draws the badge on top of a custom content view, so badges keep working; the bar stays in the lower half, clear of the badge corner. Clearing restores the tile's previous content view. `tests/dock-tile-native.test.ts` renders the real view offscreen at each state and checks its pixels; [e2e/verification/123](../e2e/verification/123/README.md) has the renders.
