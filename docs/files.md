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

`list` returns immediate entries sorted by name, without issuing a metadata request for every child. `stat` describes symlinks themselves. `copy` recursively copies directories and preserves links, and `move` may copy then delete across volumes; both reject existing destinations. Neither promises a transaction across multiple files. `mkdir` defaults to recursive creation; `remove` defaults to nonrecursive removal and rejects nonempty directories.

Whole-file writes replace atomically on supported desktop backends. Conditional writes compare observed UTF-8 text before replacing; another process can still write between those steps. A conflict returns `{ written: false }`; missing files and IO failures reject. Invalid UTF-8 rejects. Use the [streaming APIs](file-streams.md) for bounded memory on large files.

`watch(path, listener, { recursive })` resolves when native registration succeeds and returns an asynchronous `remove()`. Notifications invalidate cached data; they are not an exact change log. Recursive watches require a directory. Removal stops JS callbacks immediately, joins concurrent calls, and permits retry if native cleanup fails. File handles use `close()` with the same cleanup guarantees; new work rejects after closing starts, even if cleanup needs retry.
