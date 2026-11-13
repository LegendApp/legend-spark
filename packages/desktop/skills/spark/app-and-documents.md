# App lifecycle and documents

Exports: `@legendapp/spark/app`, `/app/documents`, `/links`.

## App lifecycle (`/app`)

- `activate()` brings the app forward; `hide()` hides its windows. To show a window from a tray or menu-bar click, prefer `showWindow(id, { activate: true })` (see [windows.md](windows.md)).
- Save data in a `beforeQuit` guard, not after `await quit()`: once quit is approved the JS runtime may stop before your continuation runs. Every guard must return `true`; `false`, a throw, or the 30 s deadline vetoes.
- `willQuit` is a notification only; it is not an async cleanup opportunity.
- One process runs per project. A second launch forwards to the running app: you get `reopen`, then `secondInstance`, then its files/URLs as ordinary open requests. `secondInstance` is live-only; files/URLs are replayed through `/app/documents`.
- `relaunch()` runs the same quit guards and resolves `{ quitRequested: false, reason: 'vetoed' }` when vetoed.
- Safe mode (`--spark-safe-mode` or Shift at launch) skips Spark's window restoration. Check `getAppContext().launch.safeMode` before restoring your own state (open documents, navigation).
- Startup `macos.lifecycle.mainWindow.glass` uses plain React content before macOS 26 and the public `NSGlassEffectView` on newer systems.

```ts
import { beforeQuit, quit } from '@legendapp/spark/app';

declare const documentStore: { flush(): Promise<void> };
declare function showUnsavedWork(): void;

const guard = await beforeQuit(async () => {
  await documentStore.flush();
  return true;
});
const result = await quit();
if (!result.quitRequested) showUnsavedWork();
await guard.remove();
```

## Opening files and URLs (`/app/documents`)

- Use `subscribeToOpenRequests` for Finder/Explorer opens, Dock drops and deep links. Requests are `{ type: 'file', id, path }` or `{ type: 'url', id, url }`; paths are already decoded native paths, so do not parse file URLs yourself.
- A new subscription replays retained launch requests. Exactly-once import (across subscriptions) is your job: deduplicate by `id` or by your own state.
- `noteRecentDocument(path)` / `getRecentDocuments()` / `clearRecentDocuments()` manage project-scoped history (standalone macOS apps also feed the system Recent menu).
- For document-style apps, `createDocumentAppController` (service) or `useDocumentAppController` (component) owns the open-request listener, the app menu and the document window's open state. `watchDocumentReload` / `useWatchedDocumentReload` debounce file changes into reloads; `onError` is required.

```ts
import { subscribeToOpenRequests } from '@legendapp/spark/app/documents';

declare function loadDocument(path: string): void;
declare function handleDeepLink(url: string): void;

const subscription = await subscribeToOpenRequests(request => {
  if (request.type === 'file') loadDocument(request.path);
  else handleDeepLink(request.url);
});
subscription.remove();
```

## Links (`/links`)

Expo Linking subset: `openURL`, `canOpenURL`, `getInitialURL`, `addEventListener('url', …)`, plus desktop `openPath(path)` to open a file with its default app. Subscribe before awaiting `getInitialURL()`. The live listener excludes launch replay and file opens; use `/app/documents` when you need both. URL scheme associations need a custom build (the generic Spark Runner does not own your scheme).

## Platforms

`/app`: macOS and Windows. `/app/documents`: macOS and Windows hosts. `/links`: macOS, Windows (live URL activation pending), and iOS/Android/web through `expo-linking`.
