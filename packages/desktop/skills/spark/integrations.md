# OS integrations

Exports: `@legendapp/spark/notifications`, `/clipboard`, `/system`, `/updates`, `/processes`, `/auth-session`, `/audio`. Links and document opens are in [app-and-documents.md](app-and-documents.md); Dock/Jump List menus in [menus-tray-dock.md](menus-tray-dock.md).

## Notifications

- Ask for permission from a user action (an "Enable notifications" button), not at launch. `getNotificationPermission()` reads without prompting. Showing without permission rejects `E_PERMISSION_DENIED`.
- `showNotification({ id, content })` posts now; `scheduleNotification({ id, content, trigger: { type: 'delay', delaySeconds } })` schedules. `cancel*` affects pending, `dismiss*` delivered.
- Subscribe with `onNotificationResponse` early: it replays responses retained from a cold launch (latest 100).
- The Spark Runner shares its host's notification identity and can't cold-launch your project from a notification; test that in a custom standalone build. No remote push/APNs.

```ts
import { onNotificationResponse, requestNotificationPermission, showNotification } from '@legendapp/spark/notifications';

const responses = await onNotificationResponse(response => console.log(response.action, response.data));
const permission = await requestNotificationPermission();
if (permission.granted) {
  await showNotification({ id: 'export-finished', content: { title: 'Export finished', body: 'Your document is ready.' } });
}
responses.remove();
```

## Clipboard

Expo Clipboard subset (`getStringAsync`, `setStringAsync`, `hasStringAsync`) works on desktop, mobile and web. `setStringAsync` resolves `false` when the platform declines. Desktop adds `readClipboard` / `writeClipboard` for HTML, PNG (`{ format: 'png', bytes: Uint8Array }`) and file lists; check `getRichClipboardAvailability()`.

## System (`/system`)

- `preventSleep({ reason, kind })` returns a registration: always remove it in `finally`.
- `setAppBadge('3')` (Windows takes text only; numbers are macOS-only). `setAppProgress({ state: 'normal', value })` and `null` to clear (macOS only).
- `requestAttention`, `onSystemEvent`, `getSystemInfo`, `getAppearancePreferences` (macOS; accent color, reduce motion, etc.). Use `PlatformColor('controlAccentColor')` etc. for colors that follow appearance.
- `setLaunchAtLogin` needs a standalone distributed macOS app; Windows reports unavailable.

```ts
import { preventSleep } from '@legendapp/spark/system';

declare function exportVideo(): Promise<void>;

const blocker = await preventSleep({ reason: 'Exporting video', kind: 'display' });
try { await exportVideo(); } finally { await blocker.remove(); }
```

## App updates (`/updates`)

Sparkle-based whole-app updates for distributed macOS Release builds; no JS OTA. Run `spark updates init <https feed .xml>` once, then call `startUpdates()` when the app is ready and wire a "Check for Updates…" menu item to `checkForUpdates()`. In the Runner and Debug builds every command rejects `E_UNAVAILABLE`; read `getUpdateStatus()` / `getUpdateAvailability()` instead of assuming. Bump `expo.macos.buildNumber` every release. Windows: unsupported.

## Processes and helpers (`/processes`)

- Targets are explicit: `{ type: 'executable', path }`, `{ type: 'helper', name }` (a binary bundled through `desktop.config.json` `helpers`) or `{ type: 'command', name }` (resolved on PATH; `resolveCommand(name)` checks first).
- `runCommand` buffers output; `spawn` returns a handle with `write`, `closeInput`, `terminate` and `exited`, streaming through `onOutput`. Output is `Uint8Array`, so decode it yourself. Capture is capped (`captureLimitBytes`, at most 8 MiB per stream); streaming stays complete.
- Arguments are passed without a shell. A nonzero exit is a result (`exit: { type: 'exited', code }`), not a rejection. `pty` runs the child on a pseudo-terminal (macOS).

```ts
import { runCommand } from '@legendapp/spark/processes';

const result = await runCommand({ target: { type: 'executable', path: '/usr/bin/uname' }, args: ['-a'] });
if (result.exit.type === 'exited' && result.exit.code === 0) console.log(new TextDecoder().decode(result.stdout));
```

## Auth and audio

- `/auth-session` only opens the system browser and receives the redirect (loopback on desktop). Build the OAuth request, PKCE and token exchange with your auth library. Always `dismiss()` the session in `finally`.
- `/audio`: `createAudioPlayer({ uri })` / `useAudioPlayer`, positions in seconds; `remove()` the player when its owner is done. `createMediaSession` for Now Playing / media keys. Windows has a native player and media session (system media controls).

## Platforms

macOS: all. Windows (dev builds): notifications (no in-app permission prompt), clipboard text/HTML, most of `/system` (no Dock progress or appearance preferences), processes; updates unsupported. iOS/Android/web: only the Expo-shaped subsets (clipboard, auth-session, audio adapters) apply. `/auth-session` runs on `expo-web-browser` and `expo-crypto` on iOS/Android/web (call `maybeCompleteAuthSession()` on the web redirect page). `/audio` runs on `expo-audio` on iOS/Android, where `createMediaSession` reports unavailable, and on HTML audio plus `navigator.mediaSession` on web.
