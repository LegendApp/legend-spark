# Application lifecycle

Import from `@legendapp/spark/app`. Spark owns this desktop lifecycle contract; document history and file/URL launch requests live in `/app/documents`.

`getAppAvailability()` reports unsupported platforms and missing optional native modules without throwing during import. Operations reject with `SparkError` when unavailable. Every feature on this page except [languages](#languages), including the single-instance lock, `relaunch()` and safe mode, is implemented on both macOS and Windows, so this one result covers them. Languages report their own availability. `getAppContext()` returns project identity (`projectId`, `name`, `version`), runtime mode/module versions, the initial process arguments and `launch`:

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

`relaunch(options?)` starts a new instance, then requests quit through the same coordinator as `quit()` (joining one already pending), so every `beforeQuit` guard runs first. It resolves with the same `QuitResult`. On approval the new process waits for this one to exit and takes over the single-instance lock; on a veto it is stopped before it shows anything. `options.arguments` replaces the arguments after the executable; omitted, the new instance gets this launch's arguments. The environment is inherited.

```ts
import { relaunch } from '@legendapp/spark/app';

const result = await relaunch({ arguments: ['--spark-safe-mode'] });
if (!result.quitRequested) showUnsavedWork();
```

Unknown options reject with `E_UNSUPPORTED_OPTION`; non-string arguments or arguments containing NUL reject with `E_INVALID_ARGUMENT`. Failure to start the new process rejects with `E_NATIVE` and does not quit.

## Safe mode

Launch with `--spark-safe-mode`, or hold Shift while the app launches, to start in safe mode. Holding Shift is also the macOS convention for opening an app without restoring its windows. The decision is made once at launch and reported as `getAppContext().launch.safeMode` (`'flag'` wins over `'modifier'`). A test-driver session ignores the keyboard, so typing during an automated launch cannot change it.

Safe mode skips Spark's native restoration. On macOS that is the main window's saved frame and `mainWindow.autosaveName`, managed windows' saved frames, `restoreOnLaunch` startup windows and the saved startup split-view layout; on Windows, saved window frames. Nothing is saved over them during the session, so the next normal launch restores them. State your app restores itself (open documents, navigation) should check `launch.safeMode` too. `relaunch({ arguments: [] })` leaves safe mode.

Validation: `tests/app-instance-native.test.ts` compiles the macOS instance module with a process harness and runs real processes: forwarding of arguments, files and URLs after acknowledgment, six simultaneous launches electing one owner, a SIGKILLed owner's lock and stale socket being replaced, malformed payloads being refused, an approved relaunch child taking over only after its parent exits, and a vetoed one being killed. `tests/windows-launch-native.test.ts` runs the Windows host's forwarding payload, argument classification, command-line quoting and safe-mode helpers (`packages/desktop-host/windows/launch.inc`). The Windows host itself has not been compiled in this repository. JavaScript tests exercise independent guards, stale replies, concurrent quit calls, invalid native output, and cleanup retries. A native macOS coordinator fixture exercises all-handler approval, joins, vetoes, guard changes and timeouts. The changed macOS bridge/transport passes an Objective-C++ syntax check with RN declarations stubbed. Actual application shutdown and Windows compilation remain pending.

## Languages

Menus, dialog buttons, the About panel, the find bar, toolbar customization, window tabs, Services and the open and save panels come from AppKit and from Spark, not from your JavaScript. On macOS they all use one language per launch: the first of the user's languages for this app that the app lists, else the app's development language. List the languages your app is translated into in `desktop.config.json`; the first is the development language:

```json
{ "localizations": ["en", "ar", "fr"] }
```

Spark writes them to `CFBundleLocalizations` and `CFBundleDevelopmentRegion`. An app that lists only English, or nothing, shows AppKit's and Spark's strings in English even for a user whose language is Arabic. Once it lists several, System Settings › General › Language & Region › Applications offers it a per-app language. `getSystemInfo().locale` follows the same choice, so JavaScript that picks its strings from it agrees with the native ones. Declared localizations need an app-specific runtime: the shared Spark Runner cannot carry them.

Spark's own native strings are translated into English, Arabic and French (`framework` below): the desktop template's main menu (File, Edit, Format, View, Window and Help, and the app menu's About, Hide and Quit items, retitled at launch), [menu role items](menus.md#application-menus) published without a label, the default title and buttons of `confirm()`, `showMessage()` and `showPrompt()`, the default placeholder of a toolbar search field, a managed window's fallback title, the drag image's accessibility description and the default Now Playing title. In another listed language they are English, while AppKit's strings still follow it. `packages/desktop-app/macos/Localization` holds them, keyed by their English text.

```ts
import { getAppLanguages, relaunch, setAppLanguage } from '@legendapp/spark/app';

const { supported, current, override, framework } = await getAppLanguages();
await setAppLanguage('ar'); // or null to follow the system again
await relaunch();
```

| `getAppLanguages()` field | Value |
| --- | --- |
| `supported` | The languages the app lists, such as `["en", "ar", "fr"]`. |
| `current` | The language this launch chose. Native strings use it; a launch argument such as `-AppleLanguages "(ar)"` takes precedence. |
| `override` | The per-app language stored by `setAppLanguage` or System Settings, or `null` when the app follows the system. |
| `framework` | The languages Spark's own strings are translated into. |

`setAppLanguage(language)` stores the app's language in its own defaults (`AppleLanguages`, the key System Settings writes); `null` removes it. It applies at the next launch: AppKit chooses a bundle's language once. A language the app does not list rejects with `E_INVALID_ARGUMENT`, as does a value that is not a language identifier or `null`.

`getAppLanguageAvailability()` is available on macOS. On Windows it reports `unsupported-platform` and the functions reject with `E_UNSUPPORTED_PLATFORM`: an unpackaged Win32 app has no per-app language for Spark to set, and Spark's Windows host shows its own strings, including the dialog defaults, in English ([#329](https://github.com/LegendApp/legend-spark/issues/329)).

Validation: `tests/framework-strings.test.ts` checks that every title in the template's main menu, every role title and every string native code or JavaScript asks for exists, with the same keys and placeholders in every language. `tests/app-languages.test.ts` and `tests/dialog-features.test.ts` cover the JavaScript contract and the dialog defaults against a mocked bridge. The Kitchen Sink's Internationalization › Native strings screen and `e2e/flows/internationalization/native-strings.yaml` and `app-language.yaml` check the menus and languages in the running app.
