# System integration

`@legendapp/spark/system` owns OS information, events, login startup, app badges and progress, attention, power requests and launcher menus. `getSystemAvailability()` does not require an installed native module; `getSystemAvailability(feature)` reports one of `appBadge`, `appProgress`, `attention`, `dockMenu`, `taskbarMenu` and the platform-limited features listed under [System events](#system-events) and [Appearance preferences](#appearance-preferences) for the running platform. Commands return `Promise<void>` and reject shared `SparkError` codes; query results are validated.

```ts
const blocker = await preventSleep({ reason: 'Exporting video', kind: 'display' });
try { await exportVideo(); } finally { await blocker.remove(); }
const attention = await requestAttention({ kind: 'informational' });
await attention.remove();
const events = await onSystemEvent(event => console.log(event.type));
await events.remove();
```

Power prevention defaults to display idle sleep; `kind: 'system'` permits the display to sleep. It does not prevent forced sleep or override OS policy. Attention defaults to informational. Registrations stop callbacks immediately on removal, join concurrent cleanup, and permit retry after failure. System events have independent native ownership; the last removal releases OS observers. Windows power registrations own dedicated [power request handles](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-powercreaterequest), closed on removal.

`getSystemInfo()` returns OS version, process architecture, `translated` (Rosetta 2 on macOS, x64 emulation on Windows on Arm), locale, IANA `timeZone`, dark appearance, idle seconds, battery power, a nullable battery fraction from zero to one, `lowPowerMode` (Low Power Mode on macOS, battery saver on Windows) and `thermalState` (`nominal`, `fair`, `serious`, `critical`; `null` on Windows, which has no public thermal-state API; a state newer than the SDK rejects `E_NATIVE`). `getNetworkStatus()` (macOS) rejects `E_TIMEOUT` when the OS reports no path within 5 seconds and `E_NATIVE` when the path is invalid or the proxy settings cannot be read. It returns the current network path: `status` (`online`, `offline`, or `requiresConnection` when, for example, an on-demand VPN must connect first), the interface types it can use, `expensive` (metered) and `constrained` (Low Data Mode), and the system `proxies` (`http`, `https`, `socks` as `host:port`, and `autoConfigURL`; `null` when off). `getLoginItemStatus()` distinguishes enabled, disabled, approval required, not found and unavailable; `setLaunchAtLogin(boolean)` requests the change. macOS requires a standalone distribution app; Windows currently reports unavailable. `setAppBadge(value)` controls the macOS Dock badge or Windows taskbar overlay icon. It takes text or a count; an empty string or `0` clears it. macOS formats a count with the user's locale (`1,250` in English); the Windows overlay fits two digits, so it draws `99+` above 99 and keeps the full number as the overlay's description for screen readers.

`createDockMenu({ items, onAction })` is macOS-only; `createTaskbarMenu({ items, onAction })` is Windows-only. Both return an async registration and deliver `{ type: 'action', itemId }`. They use [shared menu items](menus.md). Dock menus support actions, checkboxes, separators and submenus. Taskbar Jump Lists support actions and checkboxes; checked tasks get a checkmark label, and disabled tasks are omitted because the OS cannot display them disabled. Other item kinds, icons and shortcuts reject. Callbacks accept only selectable IDs owned by the registration. There is one menu per application; duplicate creation rejects `E_ALREADY_EXISTS`. Remove it before creating a replacement; failed removal retains ownership for retry. No translated menu title is used as an identity.

## Dock and taskbar progress

```ts
await setAppProgress({ state: 'normal', value: 0.35 });   // completed fraction, 0 to 1
await setAppProgress({ state: 'indeterminate' });
await setAppProgress({ state: 'paused', value: 0.6 });    // also 'error'
await setAppProgress(null);                               // clears it
```

`setAppProgress` shows one app-wide progress bar: on macOS on the Dock tile, on Windows on the main window's taskbar button (`ITaskbarList3`). Values outside 0–1 and unknown states reject `E_INVALID_ARGUMENT`; extra keys reject `E_UNSUPPORTED_OPTION`. A JavaScript reload clears it.

On macOS the Dock tile gets a content view that draws the app icon (`NSApp.applicationIconImage`) with a capsule along its lower edge. The fill is the system accent color, yellow for paused and red for error; it starts at the right edge in right-to-left languages. Indeterminate progress is a striped full bar. It is not animated: the Dock redraws a tile only when asked. The track follows the system appearance (the Dock's, not an app's appearance override) and redraws when it or the accent color changes. The Dock draws the badge on top of a custom content view, so badges keep working; the bar stays in the lower half, clear of the badge corner. Clearing restores the tile's previous content view. `tests/dock-tile-native.test.ts` renders the real view offscreen at each state and checks its pixels; [e2e/verification/123](../e2e/verification/123/README.md) has the renders.

On Windows `normal`, `paused` and `error` map to `TBPF_NORMAL`, `TBPF_PAUSED` (yellow) and `TBPF_ERROR` (red), and `indeterminate` to the marquee. The Windows code has not been compiled or run yet ([#302](https://github.com/LegendApp/legend-spark/issues/302)).

## Jump Lists

`createTaskbarMenu({ items, onAction, recentDocuments: true })` also adds the Jump List's Recent category, which lists files noted with `noteRecentDocument` whose type is registered to the app. Removing the menu deletes the custom list, so Windows shows its default Jump List again.

## System events

`onSystemEvent(handler, { types?, onError? })` delivers typed invalidations; query `getSystemInfo()` or `getNetworkStatus()` again for current values. Only `memoryPressure` carries data, its `level` (`normal`, `warning`, `critical`), because pressure is not a state that can be queried later; a pressure event without a valid level is reported to `onError` as `E_INVALID_DATA` (rethrown asynchronously when there is no `onError`). `types` limits a registration to the listed events. Each OS source is installed only while some registration needs its events and removed with the last one; the network path monitor, proxy store and memory-pressure source exist only for registrations that include `networkChanged`, `proxyChanged` or `memoryPressure`. A registration without `types` receives every event, so it installs every source; pass `types` (for example `['displaysChanged']`) to avoid that. If a source cannot be created, `onSystemEvent` rejects `E_NATIVE` and the existing registrations keep their sources.

| Event | macOS source | Windows source |
| --- | --- | --- |
| `sleep`, `wake` | `NSWorkspaceWillSleep`/`DidWake` | `PBT_APMSUSPEND`/`PBT_APMRESUMEAUTOMATIC` |
| `lock`, `unlock` | `com.apple.screenIsLocked`/`Unlocked` | `WTS_SESSION_LOCK`/`UNLOCK` |
| `sessionInactive`, `sessionActive` (user switch) | `NSWorkspaceSessionDidResignActive`/`DidBecomeActive` | `WTS_CONSOLE_DISCONNECT`/`CONNECT` |
| `powerChanged` (AC/battery, level) | IOKit power source notifications | `PBT_APMPOWERSTATUSCHANGE` |
| `lowPowerChanged` | `NSProcessInfoPowerStateDidChange` | not implemented |
| `thermalChanged` | `NSProcessInfoThermalStateDidChange` | no public API |
| `networkChanged` (reachability) | `nw_path_monitor` updates after the initial path | not implemented |
| `proxyChanged` | System Configuration `State:/Network/Global/Proxies` | not implemented |
| `localeChanged` | `NSCurrentLocaleDidChange` | `WM_SETTINGCHANGE` "intl" |
| `timeZoneChanged` | `NSSystemTimeZoneDidChange` | not implemented |
| `clockChanged` | `NSSystemClockDidChange` | `WM_TIMECHANGE` |
| `memoryPressure` | `DISPATCH_SOURCE_TYPE_MEMORYPRESSURE` | not implemented |
| `appearanceChanged`, `displaysChanged` | `AppleInterfaceThemeChanged`, screen parameters | `WM_SETTINGCHANGE`/`WM_THEMECHANGED`, `WM_DISPLAYCHANGE` |
| `systemColorsChanged` (accent, highlight) | `NSSystemColorsDidChange` | unsupported ([#342](https://github.com/LegendApp/legend-spark/issues/342)) |
| `accessibilityDisplayChanged` (contrast, transparency, motion, differentiate without color, invert colors) | `NSWorkspaceAccessibilityDisplayOptionsDidChange` | unsupported ([#342](https://github.com/LegendApp/legend-spark/issues/342)) |

Idle time has no event: read `idleSeconds` when needed rather than polling for a threshold. `getSystemAvailability(feature)` reports the platform-limited parts: `thermalState`, `networkStatus` (`getNetworkStatus`, `networkChanged`, `proxyChanged`), `memoryPressure`, `lowPowerChanges` and `timeZoneChanges` are macOS-only; `getNetworkStatus()` rejects `E_UNSUPPORTED_PLATFORM` on Windows. `systemColorsChanged` and `accessibilityDisplayChanged` belong to `appearancePreferences`: where it is unavailable, a registration whose `types` lists either rejects `E_UNSUPPORTED_PLATFORM`, and a registration without `types` leaves them out.

## Appearance preferences

```ts
const preferences = await getAppearancePreferences();
// { appearance: 'dark', automaticAppearance: true, accentColor: '#007aff', highlightColor: '#b3d7ff',
//   increaseContrast: false, reduceTransparency: false, reduceMotion: true, differentiateWithoutColor: false,
//   invertColors: false, keyboardNavigation: true }
const events = await onSystemEvent(() => refresh(), { types: ['appearanceChanged', 'systemColorsChanged', 'accessibilityDisplayChanged'] });
```

`getAppearancePreferences()` (macOS; `getSystemAvailability('appearancePreferences')`) reads the user's settings when called:

| Field | macOS source | Invalidated by |
| --- | --- | --- |
| `appearance` (`light`/`dark`), `automaticAppearance` | System Settings > Appearance (`AppleInterfaceStyle`, `AppleInterfaceStyleSwitchesAutomatically`) | `appearanceChanged` |
| `accentColor`, `highlightColor` | `NSColor.controlAccentColor`, `selectedTextBackgroundColor` as sRGB `#rrggbb`, resolved in the app's effective appearance | `systemColorsChanged` |
| `increaseContrast`, `reduceTransparency`, `reduceMotion`, `differentiateWithoutColor`, `invertColors` | `NSWorkspace.accessibilityDisplayShould…` | `accessibilityDisplayChanged` |
| `keyboardNavigation` | `NSApp.fullKeyboardAccessEnabled`: System Settings > Keyboard > Keyboard navigation, not the separate Accessibility > Full Keyboard Access | none: macOS posts no change notification, so read it when needed |

`appearance` is the system setting. The app can render otherwise: an app appearance override, a per-window override, or `NSRequiresAquaSystemAppearance` (which the test driver pins). `getSystemInfo().dark` is the app's effective appearance. A system color without an sRGB form rejects `E_NATIVE`; a malformed native value rejects `E_INVALID_DATA`. macOS has no system-wide text size setting with a public API, so there is no text scale field. Windows (accent, high contrast, transparency, animations and text scaling) is [#342](https://github.com/LegendApp/legend-spark/issues/342): `getAppearancePreferences()` rejects `E_UNSUPPORTED_PLATFORM` there.

Per-window appearance is a window option ([window contract](api-window-contract.md)): `openWindow({ appearance })` and `setWindowOptions(windowId, { appearance: 'system' | 'light' | 'dark' })`; `system` follows the app. Semantic system colors come from react-native-macos: `PlatformColor('controlAccentColor')`, `PlatformColor('labelColor')` and the other `NSColor` names resolve in each view's effective appearance, so they follow app and window overrides. The Kitchen Sink's Appearance & theming > Appearance preferences screen shows all three.

### Testing system events

Sleep, locking, user switching and thermal pressure cannot be caused by a test without changing the machine. In a [test-driver](test-driver.md) run, the system module registers the driver command `simulateSystemEvent` (flow command `simulateSystemEvent`, [e2e-flow-commands.md](e2e-flow-commands.md)). It delivers an event through the same native emitter as the OS observers, so registrations, routing and the app's handling are exercised; it fails with `E_NO_OBSERVER` when no `onSystemEvent` registration receives that event type. `thermalChanged` with `thermalState`, `lowPowerChanged` with `lowPowerMode`, `powerChanged` with `onBattery` and `networkChanged` with `network` (`online`/`offline`; an offline override reports no interfaces and neither expensive nor constrained) also override what `getSystemInfo()` and `getNetworkStatus()` report until the app quits; `memoryPressure` needs `level`. `appearanceChanged` with `appearance` (`light`/`dark`) and `automaticAppearance`, `systemColorsChanged` with `accentColor` and `highlightColor` (`#rrggbb`), and `accessibilityDisplayChanged` with any of `increaseContrast`, `reduceTransparency`, `reduceMotion`, `differentiateWithoutColor` and `invertColors` override those fields of `getAppearancePreferences()` the same way; a field that does not belong to the event type rejects `E_INVALID_ARGUMENT`. The app's rendering does not change. A driver run installs no OS observers, so registrations receive only simulated events, whatever the host's network, power, displays or settings do.

Until a simulation sets them, a driver run reports fixed values instead of the host's: `getSystemInfo()` reports `onBattery: false`, `batteryLevel: null`, `idleSeconds: 0`, `timeZone: 'UTC'`, `lowPowerMode: false` and `thermalState: 'nominal'`; `getNetworkStatus()` reports `{ status: 'online', interfaces: ['wired'], expensive: false, constrained: false }` with every proxy `null`, without reading the network path (`network: 'offline'` makes it offline with no interfaces); `getAppearancePreferences()` reports `invertColors` and `keyboardNavigation` `false`. Its other fields come from the [pinned host settings](test-driver.md#pinned-host-settings) launch arguments: light, not automatic, blue accent and highlight, and every accessibility option off. A flow can read real preferences with other known values by passing the settings as launch `arguments` (for example `-AppleAccentColor 0 -reduceMotion YES`): they reach only the driven process. `osVersion`, `architecture`, `translated`, `locale` and `dark` are still the process's own: the macOS version, the build, Rosetta, the launch locale and the app's effective appearance (pinned light unless the app sets one). `tests/system-events.native.mm` checks both modes.
