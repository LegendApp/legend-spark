# Logging and diagnostics export

`@legendapp/spark/logging` writes structured log entries to the system's unified log and to
rotating files, and zips those files with app and system details into a diagnostics bundle
the user can attach to a report.

```ts
import { configureLogging, createLogger, exportDiagnostics } from '@legendapp/spark/logging';
import { saveFileDialog } from '@legendapp/spark/dialogs';

const log = createLogger('sync');
log.info('Sync started', { account: 'work', pending: 12 });
log.error('Upload failed', { file: 'notes.md', status: 503, attempt: 2 });

await configureLogging({ level: __DEV__ ? 'debug' : 'info' });

// A "Save diagnostics…" command.
const target = await saveFileDialog({ defaultName: 'Diagnostics.zip', filters: [{ name: 'Zip', extensions: ['zip'] }] });
if (!target.canceled) await exportDiagnostics(target.path, { info: { plan: 'pro' } });
```

macOS only for now. On Windows `getLoggingAvailability()` reports `unsupported-platform`,
`createLogger` throws and the other functions reject `E_UNSUPPORTED_PLATFORM`; the ETW
implementation is tracked in [#319](https://github.com/LegendApp/legend-spark/issues/319).

## Entries

`createLogger(category, { publicMessages? })` returns a logger with one method per level:
`debug`, `info`, `notice`, `error` and `fault`, least to most severe. Each takes a message and
optional fields, a plain object. Calls return at once: the entry is handed to the native module
without a promise, and entries from all loggers reach it in call order.

Entries below the configured level (`info` by default) are dropped in JavaScript before
anything is serialized. A category is 1 to 100 characters. A message that is not a string, or
fields that are not an object, throw `E_INVALID_ARGUMENT` from the call. Field values JSON
cannot hold never throw, so logging the error in a `catch` block cannot hide it: an `Error`
becomes `{ name, message }`, a BigInt `"12n"`, an object inside itself `"[Circular]"`, and
`undefined` and functions are left out. When a `toJSON` throws, the fields are written as
`{ "unserializable": "<its message>" }`.

## Unified log (os_log)

Every entry that passes the level goes to the unified log with the app's bundle identifier as
the subsystem and the logger's category, at the matching type: `debug`, `info`, `default`
(for `notice`), `error` and `fault`. Read it in Console or with

```sh
log stream --level debug --predicate 'subsystem == "so.legend.spark.examples.kitchensink"'
```

Messages and fields are logged as private by default, as Apple advises for dynamic strings: the
system shows `<private>` for them unless the app is being debugged. A logger created with
`{ publicMessages: true }` logs its messages as written; use it only for fixed text without
personal data. Fields are always private there. macOS decides what it keeps: debug and info
entries are usually held in memory only.

**The log files hold everything in full**: every message and every field, whatever the unified
log shows, and a diagnostics export copies those files. Do not log secrets or personal data you
would not want in a file the user may attach to a report.

## Log files

Files are on by default. Each entry is one JSON line:

```json
{"time":"2026-10-11T22:00:00.123Z","level":"error","category":"sync","message":"Upload failed","fields":{"file":"notes.md","status":503,"attempt":2}}
```

`time` is when JavaScript made the call, in UTC with milliseconds. `fields` is omitted when
there are none. The current file is `app.log` in `~/Library/Logs/<bundle identifier>` (shown
in Console under Log Reports). Before an entry would take it past `maxFileBytes`, it becomes
`app.1.log`, the previous `app.1.log` becomes `app.2.log`, and so on; the file past
`maxFiles - 1` is deleted. One entry is never split across files; an entry larger than
`maxFileBytes` gets a file of its own.

```ts
await configureLogging({
  level: 'debug',                    // The least severe level written.
  files: {
    directory: '/Users/me/Logs/App', // Absolute path or file URL; created if missing.
    maxFileBytes: 256 * 1024,        // 4,096 to 1,073,741,824; default 1 MiB.
    maxFiles: 3,                     // app.log plus 2 rotated files; 1 to 100; default 5.
  },
});
await configureLogging({ files: { maxFiles: 10 } }); // Other file settings stay.
await configureLogging({ files: null });             // Stop writing files.
```

Omitted options keep their values, and a `files` group merges into the current file settings
(into the defaults when files are off). Lowering `maxFiles` in the same folder deletes the files
past the new end; moving to another folder leaves the old folder's files alone.
`configureLogging` opens the log file before it resolves, so a folder that cannot be created or
written rejects there (`E_PERMISSION_DENIED`, `E_NOT_FOUND`, ...) and the previous settings
stay. A new level applies to entries logged right after the call; if the call rejects, the
previous level is restored. File settings apply to entries logged after the call.

When `app.log` is deleted, moved or replaced by another program (a log rotation tool, a user
clearing logs), the next entry notices and opens a new `app.log`.

## Write failures

A write that fails (a full disk, a folder made read-only, the folder replaced by a file) cannot
throw from the entry call, and is never dropped silently:

- The entry still reaches the unified log. A write cut short is truncated back, so the file
  never holds a torn line.
- The first failure is logged once to the unified log (category `spark.logging`).
- `addLoggingErrorListener(listener)` hears `{ code, message, dropped: 1, recovered: false }`
  when entries stop reaching the file, and `{ ..., dropped, recovered: true }` with the total
  when writing works again. It returns `{ remove() }`.
- `flushLogs()` rejects with a `LogWriteError` (a `SparkError` with `dropped`) for the first
  failure since the last flush, then starts counting again. It resolves once every earlier
  entry has been written.

Entries wait in one native queue. When more than 10,000 are waiting (an app logging in a tight
loop, or during a long export), new entries are dropped and counted the same way, with code
`E_BUSY`. Entries still queued when the process exits are lost, so flush before a deliberate
quit if the last entries matter.

`getLogFiles()` lists `{ path, bytes, modifiedAt }` for `app.log` and its rotated files,
newest first, after earlier entries are written. It is empty while files are off.

## Diagnostics bundle

`exportDiagnostics(path, { info })` writes a zip to `path`, replacing a regular file there, and
resolves `{ path, bytes, entries }`. A folder or symbolic link at `path` rejects
`E_ALREADY_EXISTS` and is left alone:

```
Diagnostics/
  diagnostics.json
  logs/app.log
  logs/app.1.log ...
```

`diagnostics.json` holds:

| Key | Contents |
|---|---|
| `format` | `1` |
| `createdAt` | ISO 8601 time of the export |
| `app` | `name`, `bundleIdentifier`, `version`, `build`, `processIdentifier` |
| `system` | `os`, `osVersion`, `osBuild`, `model` (such as `Mac16,5`), `architecture`, `translated` (Rosetta), `processorCount`, `physicalMemoryBytes`, `thermalState`, `lowPowerMode`, `uptimeSeconds`, `locale`, `preferredLanguages`, `timeZone` |
| `logging` | The current `level` and `files` settings, the folder written with `~` for the home folder |
| `info` | The `info` option, or `null` |

`diagnostics.json` contains no user name, host name or serial number. The log files are copied
as they are, so the zip contains every message and field the app logged, in full.

The export stays on the Mac. Nothing is uploaded or sent: Foundation zips the folder into a
temporary file (a file coordinator read "for uploading", which only produces the archive),
the archive is moved to `path`, and the staging folder is deleted. Send it nowhere yourself
unless the user chooses to. Exports run on the logging queue after every earlier entry, so the
bundle includes them. A missing destination folder rejects `E_NOT_FOUND`.

## Availability

`getLoggingAvailability(feature?)` takes `systemLog`, `files` or `diagnostics`. On macOS all
are available when `NativeDesktopLogging` is installed (`missing-module` otherwise). It is
synchronous and loads no native code.

## Tests

- `tests/logging.test.ts`: the JavaScript contract against a mocked bridge.
- `tests/logging-native.test.ts` compiles `tests/logging.native.mm` with the real
  `SparkLogging.mm`: JSON lines, rotation (300 entries through 4 KiB files), lowering
  `maxFiles` and changing folders, a failed configure, `app.log` moved and deleted underneath,
  a write cut short by the file size limit (no torn line), failure and recovery events with
  counts, the queue cap, files off, entries read back from the process's unified log with
  `OSLogStore` (private by default, public when asked), folders and symbolic links refused as
  export destinations, and a diagnostics zip that the test then lists and reads with `unzip`.
- Kitchen Sink: Reliability & diagnostics → Logging, checks `REL-LOG-*` in
  `e2e/checks/reliability-diagnostics.yaml`.
