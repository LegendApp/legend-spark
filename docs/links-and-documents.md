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
window. `onMenuAction(action, controller)` handles menu selections; read the
controller's current state with `isDocumentWindowOpen()` and change it with
`setDocumentWindowOpen(boolean)`. `subscribe(listener)` observes that state and
returns a removable subscription. `updateMenus(items)` replaces the menu contribution.

```ts
const controller = createDocumentAppController({
  ownerId: 'editor', windowId: 'main', menus,
  onMenuAction: (action, controller) => {
    if (action.itemId === "open") return openDocument(controller);
  },
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

Menu actions can return promises; failures go to `reportError`. The owning hook retries
a failed previous removal before acquiring a replacement. If removal still fails,
replacement reports an error and retains the old handle for cleanup retry.

## Document sessions (macOS)

`createDocumentSession(options)` owns one document: its text, file, saved contents,
edited state and window. It runs in an application service; `useDocumentSessionState(session)`
observes it from a component and never removes it. Operations run one at a time in call order.

```ts
const session = createDocumentSession({
  untitledName: n => n === 1 ? t('Untitled') : t('Untitled {n}', { n }), // localized; the lowest free number is used
  windowId: 'doc-1',                 // edited dot (macos.documentEdited) and proxy icon (macos.representedUri) follow
  autosave: { delayMs: 1000 },       // autosave in place
  onError: reportError,              // autosave, reload and window-update failures
});
await session.open(path);            // or start untitled; createDocumentSession({ text }) for a duplicate
session.setText(next);               // edited: text differs from the disk contents
const result = await session.save(); // { saved: true } | { saved: false, reason: 'conflict' }
if (!result.saved) await session.save({ overwrite: true }); // or session.revertToSaved()
await session.saveAs('/Users/me/Notes.txt');
const copy = session.duplicate();    // { text, name }: open it with createDocumentSession({ text, untitledName })
await session.rename('Renamed.txt');
await session.moveTo('/Users/me/Archive');
await session.setLocked(true);       // Finder's Locked flag; saves then reject E_READ_ONLY
await session.remove();              // awaits accepted work, autosaves pending edits, clears the edited dot
```

- **Conflict-safe writes.** `save()` and autosave use `writeTextIfUnchanged(path, saved, text, { coordinated: true })`:
  the comparison and the replacement run inside one `NSFileCoordinator` write claim, so a coordinated writer
  (another app's `NSDocument`, iCloud) cannot change the file between them. Uncoordinated writers are still only
  detected, not excluded. A conflict leaves the file untouched and sets `state.conflict`; autosave pauses until
  `save({ overwrite: true })` or `revertToSaved()` resolves it.
- **External changes.** The session watches its file. A change to a clean document reloads it; a change under
  unsaved edits sets `conflict`. The session's own writes are not reported. A file moved or deleted by another
  app is reported to `onError` (`E_NOT_FOUND`); the session does not follow it.
- **Versions.** Like `NSDocument`, the contents as opened are recorded before the session's first write, and each
  `save()` / `saveAs()` records the saved contents. Autosaves record nothing. `listDocumentVersions(path)` lists
  saved versions newest first (`{ id, name, path, modifiedAt }`; `path` is a read-only file in the revision store
  to preview with `readText`), `addDocumentVersion(path)` records the current contents, and
  `restoreDocumentVersion(path, id)` (or `session.restoreVersion(id)`, which rejects `E_BUSY` with unsaved edits)
  replaces the file inside one coordinated write after recording the replaced contents, so a restore can be undone.
  Volumes without a revision store (FAT, most network volumes) reject version calls with `E_UNAVAILABLE`; saving
  there still works without versions.
- **One session per file.** `open()` and `saveAs()` reject `E_BUSY` when another live session has the file, and
  `open()` rejects `E_BUSY` when this session has unsaved edits. `findDocumentSession(path)` returns the session that
  has a path open, so reopening a document can `showWindow(session.windowId, { focus: true })`. Paths are compared
  after resolving `.` and `..`; symlinks are not resolved.
- **Locked and read-only.** `state.locked` is Finder's Locked flag; `state.readOnly` means the file cannot be
  replaced (locked, no write permission on the file or its folder, or a read-only volume). Saves, Rename and Move To
  reject `E_READ_ONLY` before writing; autosave skips such documents.
- **Close with unsaved changes** stays application-owned: guard with `beforeWindowClose` / `beforeQuit`, read
  `session.getState().edited`, and ask with `showMessage` (Save / Don't Save / Cancel). With autosave, a document
  that has a file needs no prompt: `remove()` writes its pending edits.
- **Availability.** `getDocumentSessionAvailability()` and `getDocumentVersionsAvailability()` are `available` on
  macOS. On Windows both report `unsupported-platform`; `createDocumentSession` throws and the version functions
  reject `E_UNSUPPORTED_PLATFORM` before native dispatch ([#280](https://github.com/LegendApp/legend-spark/issues/280)).

### Document model audit (#112)

Against the Document model epic (#23). "App" means the application composes it from existing APIs.

| Behavior | Before #112 | Now | Gaps |
|---|---|---|---|
| New, untitled numbering | App | `createDocumentSession({ untitledName })`: lowest free number, freed on removal or first save | |
| Open | `subscribeToOpenRequests`, `openSelectedDocumentPath` (app reads the file) | `session.open(path)`: coordinated read, lock state, watch | |
| Save | App (`writeText`, `writeTextIfUnchanged`) | `session.save()`: conflict check in one coordinated write claim, records a version | |
| Save As | App (`saveFileDialog` + `writeText`) | `session.saveAs(path)` after the app's save panel | |
| Duplicate | None | `session.duplicate()` + a new untitled session with a localized copy name | |
| Rename | None | `session.rename(name)`: coordinated move; proxy icon and versions follow | Title-bar rename popover: AppKit shows it only for an `NSDocument` that owns the window, which Spark windows do not have. Case-only renames on case-insensitive volumes reject `E_INVALID_ARGUMENT`. |
| Move To | None | `session.moveTo(directory)` | |
| Revert to Saved | None | `session.revertToSaved()`; with autosave, restore a version instead | |
| Autosave in place | None | `autosave: { delayMs }` for documents with a file | Untitled documents are not autosaved to drafts (`~/Library/Autosave Information`). |
| Versions browser | None | `listDocumentVersions` / `addDocumentVersion` / `restoreDocumentVersion` (NSFileVersion); the app draws its own browser (the Kitchen Sink's Documents screen) | The system "Browse All Versions" UI is `NSDocument`'s, rendering the document's own AppKit window; not feasible without `NSDocument` ownership. |
| Dirty tracking ↔ edited dot | `macos.documentEdited` window option (#257), app-wired | `windowId` binds `documentEdited` and `representedUri` to the session's state | Windows has no edited dot (#280). |
| Close with unsaved changes | `beforeWindowClose`, `beforeQuit`, `showMessage` | Same, reading `state.edited`; `remove()` flushes autosave | Application-owned by design. |
| Reopening an open document focuses its window | None | `findDocumentSession(path)` + `showWindow(…, { focus: true })`; a second session rejects `E_BUSY` | |
| External-change reload | `watchDocumentReload` | Built into the session: reload when clean, `conflict` under edits | Moves and deletions by other apps are reported, not followed (no `NSFilePresenter`). |
| Read-only and locked documents | Write errors only | `state.locked` / `state.readOnly`, `setLocked`, `E_READ_ONLY` before writing | |
| Windows | | Typed `unsupported-platform` | [#280](https://github.com/LegendApp/legend-spark/issues/280), blocked on #51 |

Kitchen Sink: Document model › Documents (`spark-ks://document-model/documents`) runs each operation on a
document in a temporary folder. Launched with `--ks-documents-run` it runs them all once and shows
`document-model-documents-check-<id>-passed` per check (`e2e/flows/document-model/documents-operations.yaml`).
Native tests: `tests/document-files-native.test.ts` (NSFileVersion, locking, coordinated conditional writes and a FAT
volume on temp files); TypeScript: `tests/document-session.test.ts`.
