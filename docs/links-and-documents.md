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

Each subscription installs its live listener before reading retained launch requests. IDs deduplicate the overlap, including events received while replay is pending. Native retains up to 100 requests; subscribers keep a bounded 200-ID deduplication window after initialization. A new subscription replays retained requests again: application-level exactly-once import decisions belong to the caller. The document controller helper tracks handled requests for its mounted lifetime and uses fresh callbacks without resubscribing on controller state changes. Its file callback is named `onOpenDocument`.

Malformed replay rejects registration and removes the listener. Malformed live messages are ignored. Removing the returned subscription is synchronous and stops delivery. The duplicate recent-document native event module and `/app/recent-documents` export are removed; the native document-controller startup plugin forwards through the same application event stream. Document history/request imports no longer eagerly initialize managed window support.
