# Links and document requests

`@legendapp/spark/links` exposes the selected Expo Linking methods: `openURL`, `canOpenURL`, `getInitialURL`, and `addEventListener('url', listener)`. Mobile adapters use Expo's implementation. Desktop `openURL` resolves `true` when the OS accepts the launch; `canOpenURL` returns a boolean. The initial URL is stable for the native process, and the live listener excludes launch replay and file-open events. Spark also provides `openPath(path)` on desktop to open an absolute native path or local file URL with its associated application. Unsupported platforms reject this extension explicitly.

Document behavior lives under `@legendapp/spark/app/documents`:

```ts
const subscription = await subscribeToOpenRequests(request => {
  if (request.type === 'file') loadDocument(request.path);
  else handleDeepLink(request.url);
});
await noteRecentDocument('/Users/me/Notes #1.txt');
const recent = await getRecentDocuments(); // [{ path, name }]
await clearRecentDocuments();
subscription.remove();
```

`OpenRequest` is `{ type: 'file', id, path } | { type: 'url', id, url }`. File paths are decoded once at the boundary; applications should not manually parse file URLs. Recent-document input accepts absolute paths or local file URLs, and output is native paths with display names. Strings containing spaces, percent signs or fragments in filenames do not need URL interpolation. Recent history remains project-scoped; standalone macOS apps additionally inform `NSDocumentController`, and the Windows host maintains its existing project-scoped Shell integration.

Each subscription installs its live listener before reading retained launch requests. IDs deduplicate the overlap, including events received while replay is pending. Native retains up to 100 requests; subscribers keep a bounded 200-ID deduplication window after initialization. A new subscription replays retained requests again: application-level exactly-once import decisions belong to the caller. The document controller helper tracks handled requests for its owned lifetime; its hook adapter uses fresh callbacks without resubscribing on controller state changes. Its file callback is named `onOpenDocument`.

Malformed replay rejects registration and removes the listener. Malformed live messages are ignored. Removing the returned subscription is synchronous and stops delivery. The duplicate recent-document native event module and `/app/recent-documents` export are removed; the native document-controller startup plugin forwards through the same application event stream. Document history/request imports no longer eagerly initialize managed window support.

## Application-owned document coordination

`createDocumentAppController(options)` is usable in an application service, outside
React. It installs the document request listener, owns an application menu, and
coordinates initial opening, reopen requests, and closure of the selected logical
window. `createMenuHandlers(controller)` supplies action handlers; read the
controller's current state with `isDocumentWindowOpen()` and change it with
`setDocumentWindowOpen(boolean)`. `subscribe(listener)` observes that state and
returns a removable subscription. `updateMenus(items)` replaces the menu contribution.

```ts
const controller = createDocumentAppController({
  ownerId: 'editor', windowId: 'main', menus,
  createMenuHandlers: controller => ({ open: () => openDocument(controller) }),
  onInitialOpen: (args, controller) => restoreDocument(args, controller),
  onOpenDocument: (path, controller) => loadDocument(path, controller),
  reportError,
});
await controller.ready;
// At application shutdown, including if setup failed:
await controller.remove();
```

The handle is returned immediately so removal can stop setup before native menu
creation finishes. `ready` acknowledges menu and listener installation; it does not
wait for application callbacks to finish. Setup failures reject `ready` and release
acquired resources; a cleanup failure remains retryable through `remove()`. Event
callback failures go to `reportError`. Removal stops new callbacks and waits for
pending setup/native cleanup; already-running application callbacks are not canceled.
A new controller replays retained document requests, so app-wide import deduplication
remains application-owned.

`useDocumentAppController(options)` is the component-owned adapter. It returns
`{ status: 'loading' }`, `{ status: 'ready', controller }`, or `{ status: 'error', error }`.
It observes controller window-state changes, keeps event callbacks current, updates
menus, and removes the controller on unmount. `ownerId`, `windowId`, or enabling/disabling
`onOpenDocument` replaces that lifetime. Failed removal calls
`onCleanupError(error, controller)` when supplied, otherwise `reportError`.

`watchDocumentReload({ path, delayMs?, shouldReload?, onReload, onError })` returns an
async registration. It debounces file invalidations (100 ms default), serializes reloads,
and reports reload failures. Removal cancels queued reloads, stops the native watcher,
and waits for a running reload; do not await removal from inside that same reload.
`useWatchedDocumentReload` wraps this registration for a component and additionally
accepts `enabled`, a nullable `path`, and `onCleanupError(error, registration)`.

For window-only coordination, `/windows` exports
`createPrimaryWindowLifecycle({ windowId, onInitialOpen, onReopenRequested?, onWindowClosed?, onError })`.
It returns a synchronous removable subscription and schedules initial opening once
per registration. Removing immediately cancels queued callbacks. The corresponding
`usePrimaryWindowLifecycle` owns the same registration in an effect.
