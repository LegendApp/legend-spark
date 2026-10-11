# Files

Import file operations and types from `@legendapp/spark/files`. This capability currently requires a macOS or Windows Spark host. `getFileSystemAvailability()` is safe to call when the native module is missing; operations reject with a `SparkError`. Native runtime changes require a rebuilt host.

All IO is asynchronous. Paths are absolute native paths; local `file://` URLs are also accepted and decoded once. Nonlocal file URLs, queries and fragments reject. Permissions are errors, not missing-file results.

```ts
const entries = await list(await getDirectory("data"));
for (const { name, path } of entries) {
  const info = await stat(path); // type, size in bytes, modifiedAt in Unix milliseconds
}
const bytes = await readBytes(path); // Uint8Array; no base64 transport in public APIs
await writeBytes(destination, bytes);
await writeText(path, "UTF-8 text");
const { written } = await writeTextIfUnchanged(path, "previous text", "new text");
await revealInFileManager(path);
await remove(destination); // void; absence is success
```

`list` returns immediate entries sorted by name, without issuing a metadata request for every child. `stat` describes symlinks themselves. `copy` recursively copies directories and preserves links, and `move` may copy then delete across volumes; both reject an existing destination with `E_ALREADY_EXISTS` unless `{ overwrite: true }` replaces it. Neither promises a transaction across multiple files. `mkdir` defaults to recursive creation; `remove` defaults to nonrecursive removal and rejects nonempty directories.

Whole-file writes replace atomically on supported desktop backends. Conditional writes compare observed UTF-8 text before replacing; another process can still write between those steps. A conflict returns `{ written: false }`; missing files and IO failures reject. Invalid UTF-8 rejects. Use the [streaming APIs](file-streams.md) for bounded memory on large files.

`watch(path, listener, { recursive })` resolves when native registration succeeds and returns an asynchronous `remove()`. Notifications invalidate cached data; they are not an exact change log. Recursive watches require a directory. Removal stops JS callbacks immediately, joins concurrent calls, and permits retry if native cleanup fails. File handles use `close()` with the same cleanup guarantees; new work rejects after closing starts, even if cleanup needs retry.

## Scanning

`scanFiles(paths, { extensions, batchSize, includeHidden, includeStats, skip, onBatch, onProgress, signal })` currently supports macOS. Check `getFileScanAvailability()` when offering this capability. Callbacks belong to that invocation; concurrent scans do not share events. The result contains `totalFiles`, `totalRoots`, and traversal `errors` (partial failures); an invalid native response or failed native operation rejects.

Batches carry `files` with native `path`, `name`, `relativePath`, `extension`, `rootIndex`, optional `size`/`modifiedAt`, and a `skipped` flag. Statistics can be absent when the OS cannot read them. `skip` marks known entries; it does not remove them from results. Extensions omit dots and wildcards. Batches default to 64 entries and accept sizes from 1 to 10000. Enumeration order is filesystem-defined, not sorted. Hidden entries are excluded by default, and package descendants are not traversed.

Abort stops between filesystem operations and suppresses subsequent callbacks. The promise rejects with `E_ABORTED` after native work stops; a pending OS call is not interrupted. Callbacks are synchronous; throwing from a progress callback also cancels and rejects the scan. Await the promise to know the scan and its listeners have been cleaned up.

The previous singleton directory-event API has been removed. Use `watch` and re-read the path: change notifications can be coalesced and cannot promise an exact add/delete log. `useWatchedDocumentReload` now uses this registration and requires an `onError` callback; it disposes registrations that complete after unmount and reads the latest callbacks.

## OS integration

These capabilities have their own availability queries. Each is synchronous, safe without the native module, and reports `unsupported-platform` on a target that does not implement it. On such a target, every operation rejects with `E_UNSUPPORTED_PLATFORM` before any native call; it never falls back to a different behavior.

| Capability | Availability | macOS | Windows |
|---|---|---|---|
| Security-scoped bookmarks | `getBookmarkAvailability()` | yes | no: desktop apps have no per-item sandbox grant to persist |
| Full Disk Access | `getFullDiskAccessAvailability()` | yes | no: there is no equivalent privacy gate |
| Coordination | `getFileCoordinationAvailability()` | yes (`NSFileCoordinator`) | no: there is no coordination service |
| Open with | `getOpenWithAvailability()` | yes | yes (registered handlers) |
| File icons | `getFileIconAvailability()` | yes | yes (`IShellItemImageFactory`) |
| Thumbnails | `getThumbnailAvailability()` | yes (Quick Look thumbnailing) | yes (`IShellItemImageFactory`) |
| Quick Look | `getQuickLookAvailability()` | yes | no: needs a hosted preview handler ([#223](https://github.com/LegendApp/legend-spark/issues/223)) |
| Extended attributes | `getExtendedAttributeAvailability()` | yes | no: alternate data streams have different semantics |
| Quarantine | `getQuarantineAvailability()` | yes (`com.apple.quarantine`) | yes (Mark of the Web) |
| Disk space | `getDiskSpaceAvailability()` | yes | yes |

The Windows implementations of icons, thumbnails, open-with, Mark of the Web, disk space and the typed volume errors have not yet been compiled or run on Windows.

### Typed volume errors

Writes reject with `E_PERMISSION_DENIED` when the user lacks permission, `E_READ_ONLY` on a read-only volume, and `E_NO_SPACE` when the volume is full or the quota is exhausted. On macOS, a Cocoa error that wraps `EROFS` or `ENOSPC` reports that code, not a generic permission error.

### Coordination

```ts
await writeText(path, text, { coordinated: true });
const text = await readText(path, { coordinated: true });
```

`readText`, `readBytes`, `writeText`, `writeBytes`, `copy`, `move` and `remove` accept `coordinated: true`. The operation then runs inside an `NSFileCoordinator` claim: a read claim for reads, a replacing write claim for writes, a deleting claim for `remove`, read plus write claims for `copy`, and moving plus replacing claims for `move`, which also reports the move to file presenters. Use it for files that other processes or iCloud Drive may change. Without the option, operations are uncoordinated, as before. Requesting coordination where it is unavailable rejects; it never runs uncoordinated.

### Security-scoped bookmarks

```ts
const bookmark = await createBookmark(folder, { readOnly: true }); // Uint8Array to persist
await writeBytes(bookmarkFile, bookmark);

// After a relaunch:
const summary = await withBookmarkAccess(await readBytes(bookmarkFile), async access => {
  if (access.stale) await writeBytes(bookmarkFile, await createBookmark(access.path));
  return list(access.path);
});
```

`createBookmark(path, { readOnly })` returns opaque bytes for an existing item. They survive relaunches and follow moves and renames. `readOnly: true` limits the restored access to reading.

`accessBookmark(bookmark)` resolves the bookmark and starts security-scoped access. It returns `{ path, stale, close() }`, where `path` is the item's current location. `stale: true` means the bookmark should be recreated from `path` while access is open. Malformed bytes reject with `E_INVALID_DATA`, a deleted target with `E_NOT_FOUND`, and a refused access with `E_PERMISSION_DENIED`.

Access lasts until `close()` resolves. The only other end is JS runtime teardown (reload or quit), which stops every open access. `close()` is idempotent, concurrent calls share completion, and a failed close can be retried. Pair every `accessBookmark` with `close()`: macOS leaks sandbox kernel resources for each unbalanced access, and after enough leaks the app cannot gain new file access until it relaunches. `withBookmarkAccess(bookmark, callback)` bounds access to the callback: it closes when the callback settles and returns the callback's result. If both the callback and the close fail, it rejects with `FileCleanupError`, which carries both errors and `retryCleanup()`.

Sandboxed apps must declare the bookmark entitlement:

```json
{ "expo": { "macos": { "entitlements": {
  "com.apple.security.app-sandbox": true,
  "com.apple.security.files.bookmarks.app-scope": true
} } } }
```

Without it, a sandboxed app's `createBookmark` and `accessBookmark` reject with `E_UNAVAILABLE`. (macOS itself fails with an opaque `NSFileReadUnknownError` from ScopedBookmarksAgent.) Unsandboxed apps need no entitlement. A test signs the native implementation ad hoc with each entitlement set and runs it in the sandbox. That covers bookmarks to items in the app's container. Items the user grants through an open panel, and bookmarks persisted across launches of a sandboxed app, have not been tested in the sandbox; the Kitchen Sink relaunch check runs unsandboxed.

### Full Disk Access

`getFullDiskAccessStatus()` resolves `"granted"`, `"denied"` or `"indeterminate"`. It tries to open files that TCC protects but that Unix permissions let the user read. macOS attributes access to the responsible process, so an app launched from a terminal inherits that terminal's grant. A sandboxed app always gets `"indeterminate"` unless a probe succeeds: sandbox denials hide TCC's answer, and their error varies by macOS release. Outside the sandbox, if no probe file exists, the call rejects with `E_UNAVAILABLE`.

`openFullDiskAccessSettings()` opens System Settings › Privacy & Security › Full Disk Access. Only the user can grant access, and macOS applies a grant when the app next launches. Neither step can be automated, so both are manual verification steps.

### Open with

`getApplicationsForFile(path)` lists the applications registered to open an existing file, without duplicates. Each entry is `{ name, path, isDefault }`, and at most one is the default. `openWithApplication(path, application)` opens the file with one of them.

- macOS: `application` is an absolute path to an application bundle. Anything else rejects with `E_INVALID_ARGUMENT`, and a missing bundle rejects with `E_NOT_FOUND`. The application is activated.
- Windows: `application` must be a handler `path` from `getApplicationsForFile`, which is the handler's executable. Spark invokes that registered handler and never launches an arbitrary executable with the file as an argument. An unregistered application rejects with `E_NOT_FOUND`.

### Icons, thumbnails and Quick Look

```ts
const icon = await getFileIcon(path, { size: 64 });       // PNG bytes, 64×64
const thumbnail = await getThumbnail(path, { size: 256 }); // PNG bytes within 256×256
await showQuickLook([path]);
```

`size` is the PNG's pixel width and height, an integer from 1 to 1024. `getFileIcon` returns the system icon for an existing item. `getThumbnail` returns a content thumbnail fitted within `size`. A file without one, such as unknown binary content, rejects with `E_UNAVAILABLE`; the icon is never substituted. Both encode PNG natively and return bytes, not base64.

`showQuickLook(paths)` (macOS) shows the shared Quick Look panel for existing items. It activates the app and needs a visible app window: without one it rejects with `E_UNAVAILABLE`. It resolves once the panel is visible, and the user dismisses it.

### Extended attributes

`listExtendedAttributes(path)` returns sorted names. `getExtendedAttribute(path, name)` returns the bytes, or `null` when the attribute is absent. `setExtendedAttribute(path, name, bytes)` replaces the value, and `removeExtendedAttribute(path, name)` treats absence as success. A missing file rejects with `E_NOT_FOUND`. Names must be nonempty, contain no NUL and be at most 127 UTF-8 bytes. Operations follow symlinks.

### Quarantine

`getQuarantine(path)` returns `{ agentName?, originURL?, dataURL?, timestamp? }` (Unix milliseconds), or `null` when the item is not marked as downloaded. `setQuarantine(path, info)` marks an existing item, and `clearQuarantine(path)` removes the mark; an unmarked item is success.

- macOS writes `com.apple.quarantine` through LaunchServices with `agentName` and `timestamp`. LaunchServices accepts origin and data URLs but stores neither: they are missing from the attribute, from the read-back and from `QuarantineEventsV2`. A native test checks this on every run. Passing `originURL` or `dataURL` therefore rejects with `E_UNSUPPORTED_OPTION` rather than being dropped. `getQuarantine` still reports URLs that the OS recorded.
- Windows writes the `Zone.Identifier` stream with `ZoneId=3` (Internet), `originURL` as `ReferrerUrl` and `dataURL` as `HostUrl`. It has no agent or timestamp, so those fields reject with `E_UNSUPPORTED_OPTION`. Zones below Internet read as `null`.

### Disk space

`getDiskSpace(path)` returns `{ totalBytes, availableBytes }` for the volume containing an existing path. `availableBytes` is the space available to this user now. On macOS, `macos.importantUsageBytes` adds purgeable space that the system can free for user-initiated work.
