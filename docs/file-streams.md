# Streaming files and OS Trash

Available through `@legendapp/spark/files` (or the underlying
`@legendapp/spark-file-system`) on macOS and Windows. These APIs require a rebuilt
native runtime. Mobile/web implementations are not supplied by this desktop module.

## Bounded binary I/O

```ts
import { openFile, readChunks, writeChunks, trash } from '@legendapp/spark/files';

for await (const bytes of readChunks(sourcePath, { chunkSize: 64 * 1024, signal })) {
  await consume(bytes); // pulls the next chunk only after this finishes
}

await writeChunks(destinationPath, readChunks(sourcePath), { mode: 'createNew', signal });

const file = await openFile(existingPath, { mode: 'readWrite' });
try {
  const header = await file.read(128, 0);
  await file.write(new Uint8Array([1, 2, 3]), 12);
  await file.flush();
} finally {
  await file.close();
}
```

Chunks are `Uint8Array`. Handles use explicit byte offsets with no shared cursor.
A read may return fewer bytes than requested; zero bytes means EOF. Reads/writes
accept at most 1 MiB per call; streaming writes split larger input chunks. The
bridge transfers base64 internally, so this is bounded-memory I/O, not zero-copy.
Offsets and offset-plus-length must be nonnegative safe integers.

| Mode | Existing file | Missing file |
| --- | --- | --- |
| `read` (default) | Read only | Reject |
| `readWrite` | Read/write without truncation | Reject |
| `write` | Truncate, then write | Create |
| `createNew` | Reject | Create exclusively |

Only regular files are accepted. Symlinks to regular files are followed. Handles
are owned by the native runtime and closed on teardown; always close explicitly
rather than depending on garbage collection. `close()` is idempotent. Operations
submitted before close run first; later operations reject. Calls run off the UI
thread on the filesystem module's serial queue. `flush()` is intended for writable
handles. Successful writes mean all submitted bytes were written; failure may leave
a partial write. Concurrent external file changes are not snapshot-isolated.

`readChunks` closes on EOF, failure, abort, or `break`. Abort is cooperative between
native calls; it does not interrupt a pending OS read/write. `writeChunks` awaits
each write, flushes on success, and closes even if its input iterator throws. It
cannot interrupt a source iterator that never yields. Input decoding is app-owned:
UTF-8 characters can span chunks, so use an incremental decoder rather than decoding
each chunk independently.

If a stream operation and native handle cleanup both fail, the stream rejects with
`FileCleanupError`. Its `operationError` and `cleanupError` properties preserve both
thrown values, including `null` or `undefined`; `operationFailed` distinguishes a
missing operation error from an operation that threw `undefined`. Catch this error
and await `retryCleanup()` to retry the internally owned handle close. Cleanup starts
as soon as the stream exits, and no further handle I/O is accepted after that point.
If the operation succeeds but close fails, the same error exposes the cleanup failure
and a retry handle.

Streaming writes are not atomic. For publication, write a distinct temporary path
and then move it using the destination/conflict policy your app needs. Never stream
a file into itself; `write` truncates the destination before reading the input.
The existing whole-file `writeText`/`writeBytes` operations retain atomic replacement.

## Trash / Recycle Bin

```ts
await trash(absolutePath);
```

This moves a file or directory to the OS recovery location. It does not permanently
delete as a fallback. Missing paths, permissions, unavailable recycling, or aborted
operations reject. Restore through Finder/Explorer; the framework does not expose
restore or empty-Trash APIs. Permanent deletion remains the explicit `remove` API.

macOS uses `NSFileManager.trashItemAtURL`. Windows uses `IFileOperation` on an STA
thread and a progress sink that vetoes non-recyclable deletion. It checks both the
operation and item result before reporting success. See Microsoft's
[PreDeleteItem contract](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ifileoperationprogresssink-predeleteitem).

## Acceptance

- `npm test -- tests/file-handles.test.ts`: positional bytes, input limits, pull-based
  iteration, early exit, abort/error cleanup, and bounded writes.
- `node scripts/test-file-streams.ts`: builds a macOS Kitchen Sink runtime and runs
  actual native checks. Passed on 2026-09-17, including a 2.5 MiB binary round trip,
  random-access modification, EOF, exclusive creation, truncation, and OS Trash.
- Kitchen Sink exposes **Test streaming files and Trash** on desktop. It recycles
  one clearly named disposable test file; it does not touch user-selected files.
- On Windows x64/ARM64 run that same button, then verify the file is recoverable
  from Recycle Bin. Also check a location where recycling is unavailable: `trash`
  must reject and leave the source intact. Windows native compilation/execution
  has not been performed on this macOS host.
