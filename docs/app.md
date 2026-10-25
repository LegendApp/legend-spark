# Application lifecycle

Import from `@legendapp/spark/app`. Spark owns this desktop lifecycle contract; document history and file/URL launch requests live in `/app/documents`.

`getAppAvailability()` reports unsupported platforms and missing optional native modules without throwing during import. Operations reject with `SparkError` when unavailable. Every feature on this page, including the single-instance lock, `relaunch()` and safe mode, is implemented on both macOS and Windows, so this one result covers them; there is no per-feature difference to report. `getAppContext()` returns project identity (`projectId`, `name`, `version`), runtime mode/module versions, the initial process arguments and `launch`:

| `launch` field | Values |
| --- | --- |
| `instance` | `'primary'`: this process owns the project's single-instance lock. `'test-driver'`: a [test-driver](test-driver.md) session, which never takes the lock or forwards to a running copy. |
| `safeMode` | `'flag'`, `'modifier'` or `null`; see [Safe mode](#safe-mode). |
| `relaunched` | `true` when `relaunch()` started this process. |

`activate()` brings the application forward; `hide()` hides its windows. `quit()` joins an in-progress request and resolves with `{ quitRequested: true }` when shutdown is approved, or `{ quitRequested: false, reason: 'vetoed' }`. Approval is the last observable decision before shutdown: the JavaScript runtime may stop before a continuation executes. Save data in a quit guard, not after awaiting an approved quit.

```ts
import { beforeQuit, quit } from '@legendapp/spark/app';

const guard = await beforeQuit(async () => {
  await documentStore.flush();
  return true;
}, { onError: reportError });

const result = await quit();
if (!result.quitRequested) showUnsavedWork();

// On owner disposal; concurrent removals join and failed cleanup can be retried.
await guard.remove();
```

Every registered guard must return `true`. A false result, thrown/rejected handler, native 30-second deadline, or a guard added/removed during a pending decision vetoes it. Errors are sent to `onError` (default: `console.error`). Removal stops future callbacks immediately; late completions cannot approve a later quit request. Forced process termination cannot be vetoed. Failed registration cleans up its guard; if cleanup also fails, the next registration or programmatic quit retries that cleanup before proceeding.

`addAppListener(type, listener)` returns a synchronous `Subscription` with `remove()`. Events are typed and live-only:

| Event | Additional fields |
| --- | --- |
| `activate`, `deactivate`, `willQuit` | None |
| `reopen` | `hasVisibleWindows`, `mainWindowWasVisible` |
| `secondInstance` | `arguments`, `workingDirectory`, `files` (absolute paths) and `urls` (non-file URLs) of a later launch; see [Single instance](#single-instance) |
| `windowOpened`, `windowClosed` | `windowId`; application-wide registry changes, including reused IDs |

All payloads include `type`. Window registry events follow logical IDs across instances; use `/windows` listeners to bind to one native window lifetime. `finishWindowRestoration()` completes the macOS startup-shell restoration coordinator after the application has opened its restored roots. `willQuit` is a notification, not an asynchronous cleanup opportunity. Use `getAppContext()` for initial identity and `/app/documents` for replayable open requests. There is no public raw native event stream or separate `/app/exit` API.

## Single instance

One process runs per project ID. This is always on rather than opt-in: windows, frame autosave, restorable window records, settings stores and databases all assume a single writer per project. macOS LaunchServices already keeps normal launches to one copy of a bundle; Spark extends that to `open -n`, running the executable directly, and the Spark Runner, which hosts many projects in one bundle. Windows has no equivalent, so without the lock every launch would start a new process. Different projects remain independent.

A later launch forwards itself to the running process and exits. The running process brings its windows forward (the same path as clicking the Dock or taskbar icon, so `reopen` fires as well), emits `secondInstance` and then queues the launch's files and URLs as ordinary open requests, so `/app/documents` and `/links` subscribers receive them like any other open. `secondInstance` is live-only: a launch forwarded before JavaScript subscribes is not replayed, but its files and URLs are, through `/app/documents`.

```ts
import { addAppListener } from '@legendapp/spark/app';

const subscription = addAppListener('secondInstance', ({ arguments: args, workingDirectory, files, urls }) => {
  if (args.includes('--new-window')) openEditor({ cwd: workingDirectory });
});
```

- **macOS:** the lock is an advisory `flock` in the per-user temporary directory, keyed by a SHA-256 of the project ID; the kernel releases it if the owner crashes. The owner listens on a Unix-domain socket next to it. A second lock, held only while an owner starts listening, guarantees that a launch which loses the race always finds a listening owner. The second process stays invisible (no Dock icon) until AppKit has delivered the files and URLs it was opened with, sends `{ arguments, workingDirectory, files, urls }`, and exits with status 0 only after the owner acknowledges delivery (10-second limit); otherwise it reports the failure and exits with status 1. Distributed notifications are not used: they cannot carry data from sandboxed apps and confirm nothing.
- **Windows:** a named mutex in the session namespace, with the launch's working directory and command line sent to the owner's main window by `WM_COPYDATA` (5-second limit). Files are absolute-path arguments and URLs are `scheme:` arguments, which is how shell associations and protocol activations arrive; other arguments stay in `arguments` with `workingDirectory` to resolve them.

## Relaunch

`relaunch(options?)` starts a new instance, then requests quit through the same coordinator as `quit()` (joining one already pending), so every `beforeQuit` guard runs first. It resolves with the same `QuitResult`. On approval the new process waits for this one to exit and takes over the single-instance lock; on a veto it is stopped before it shows anything. `options.arguments` replaces the arguments after the executable; omitted, the new instance gets this launch's arguments except `--spark-safe-mode`. This lets `relaunch()` leave safe mode; pass the flag explicitly to keep it. Holding Shift during the new launch can still request safe mode. The environment is inherited.

```ts
import { relaunch } from '@legendapp/spark/app';

const result = await relaunch({ arguments: ['--spark-safe-mode'] });
if (!result.quitRequested) showUnsavedWork();
```

Unknown options reject with `E_UNSUPPORTED_OPTION`; non-string arguments or arguments containing NUL reject with `E_INVALID_ARGUMENT`. Failure to start the new process rejects with `E_NATIVE` and does not quit.

## Safe mode

Launch with `--spark-safe-mode`, or hold Shift while the app launches, to start in safe mode. Holding Shift is also the macOS convention for opening an app without restoring its windows. The decision is made once at launch and reported as `getAppContext().launch.safeMode` (`'flag'` wins over `'modifier'`). A test-driver session ignores the keyboard, so typing during an automated launch cannot change it.

Safe mode skips Spark's native restoration. On macOS that is the main window's saved frame and `mainWindow.autosaveName`, managed windows' saved frames, `restoreOnLaunch` startup windows and the saved startup split-view layout; on Windows, saved window frames. Nothing is saved over them during the session, so the next normal launch restores them. State your app restores itself (open documents, navigation) should check `launch.safeMode` too. `relaunch()` leaves safe mode by default; `relaunch({ arguments: [] })` also clears all other arguments.

Validation: `tests/app-instance-native.test.ts` compiles the macOS instance module with a process harness and runs real processes: forwarding of arguments, files and URLs after acknowledgment, six simultaneous launches electing one owner, a SIGKILLed owner's lock and stale socket being replaced, malformed payloads being refused, an approved relaunch child taking over only after its parent exits, and a vetoed one being killed. `tests/windows-launch-native.test.ts` runs the Windows host's forwarding payload, argument classification, command-line quoting and safe-mode helpers (`packages/desktop-host/windows/launch.inc`). The Windows host itself has not been compiled in this repository. JavaScript tests exercise independent guards, stale replies, concurrent quit calls, invalid native output, and cleanup retries. A native macOS coordinator fixture exercises all-handler approval, joins, vetoes, guard changes and timeouts. The changed macOS bridge/transport passes an Objective-C++ syntax check with RN declarations stubbed. Actual application shutdown and Windows compilation remain pending. The four app-lifecycle e2e flows have not run: their black-box commands require a backend not yet registered in this repository, so the flows require manual signoff until that backend is available.
