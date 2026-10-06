# Platform acceptance tests

The framework has one case catalog and shared API assertions, with execution on each real platform. A successful bundle is build evidence only. A native control placeholder does not satisfy its interaction case. This test system is an inventory and execution foundation, not a claim that every framework API already has an automated test.

For the hands-on sequence on both desktop machines, including rebuilding native
fixes, WebView keyboard checks and OS interactions, follow the
[manual desktop acceptance checklist](desktop-manual-acceptance.md).

## Run a shared consumer

From the framework checkout:

```sh
bun run test:platform --platform macos
bun run test:platform --platform windows
bun run test:platform --platform ios --device <simulator-UDID>
bun run test:platform --platform android --device <adb-serial>
bun run test:platform --platform web
```

Each run creates a fresh, disposable universal consumer from packed SDK archives. It uses the same `PlatformChecks` screen and assertions on all five platforms. Expo Desktop stays on the pinned beta template. spark owns desktop compilation; Expo owns mobile compilation/install/launch and the Metro/web server. Windows automatically selects x64 or ARM64, with the existing `SPARK_WINDOWS_ARCH` override.

The runner automatically executes clipboard, secure-storage, and URL assertions where applicable. Press the native/browser button, replace the input text with `Native edit`, select `Second`, then press **Finish run**. Assertions are recorded from the React callbacks. Merely mounting the controls does not pass them. The screen shows its in-app results; build and launch evidence is added by the host runner to the JSON report.

Useful options:

- `--api-only`: finish after automatic API assertions; UI checks remain `not-tested`.
- `--prepare-only`: generate and bundle without launching or compiling a native binary. Native and UI checks retain their unexecuted status.
- `--project <fresh-directory>`: choose a disposable consumer. Expo Desktop requires an alphanumeric final directory name. Existing directories are rejected.
- `--no-open`: print the web URL for an external browser/automation driver.
- `--timeout 180`: runtime/report wait in seconds, after compilation. Failure preserves the partial report.
- `--report-dir <directory>`: choose where portable reports are written.

Use an interactive desktop and the target toolchain. iOS simulator execution requires macOS and an explicit simulator UDID. Android requires a running device/emulator and an explicit adb serial, so report-port forwarding cannot affect a different device. The runner uses `adb reverse` for its local report server and removes that forwarding afterward. Physical iOS devices and remote devices without loopback forwarding are not supported by this runner yet. Browser/device capabilities and versions still need a broader acceptance matrix.

Clipboard round-trip tests temporarily replace clipboard contents and restore **text**; run in a disposable test session if rich clipboard data matters. Browser clipboard is excluded from automatic checks because permissions and user gestures vary; its separate button runs the same assertion. Permission denial is not silently converted into a pass. The macOS kitchen-sink API runner retains its native driver for full clipboard snapshot/restoration. Credential tests use a unique key and remove it in `finally`. File-conflict tests use the generated consumer's scratch file.

## Existing desktop runners

These runners now use the shared contract assertions and also emit the common report format:

```sh
bun run test:api-adapters
bun run test:windows:features --project C:\dev\SparkWindowsFeatures
```

The macOS runner retains its stronger HTML/legacy API and cold/warm URL checks. Its shared case results are mapped explicitly; the remaining assertions stay in its original detailed report. The Windows feature runner retains its real UI Automation, window geometry, Appearance, simultaneous-launch, and owner-recovery checks. It emits shared API results as they arrive, preserving failures during later phases.

On macOS, Windows source generation and bundling can be checked with:

```sh
SPARK_WINDOWS_ARCH=arm64 bun run test:windows:features --prepare-only
```

Other existing suites (`test:ui`, `test:native`, `test:integrations`, `test:runtimes`, packaging tests, and the full Windows development-session verifier) remain available. Their results are **not** automatically represented as feature passes in the common report until they are mapped to exact cases. Migrating those suites and filling uncovered assertions is remaining work.

## Read and combine results

The shared runner writes `.spark/test-results/<run-id>.json` before setup and checkpoints partial failures. The migrated legacy runners start their common reports after consumer setup. Keep these as CI artifacts or copy them between machines. Each report includes:

- Git commit, dirty flag, and a content fingerprint of tracked and unignored source files.
- Target platform, architecture when known, device selection, runtime mode, and build-only/runtime scope.
- Host platform, installed framework versions, runtime identity when available, start/end times, and execution outcome.
- Every catalog case, its status, failure detail, duration when measured, and evidence references when available.

Build logs and older runner-specific reports remain in the generated project's `.spark` directory. Copy those alongside the common JSON report when investigating a failure; local evidence paths alone are not portable attachments.

```sh
bun run test:report --output .spark/platform-coverage.md
bun run test:report ./reports-from-mac ./reports-from-windows --output coverage.md
bun run test:report ./reports --strict --output coverage.md
```

The report tool keeps different source fingerprints in separate sections and shows each run separately. It never selects the best result across retries or architectures to imply parity. Repeated observations inside one run cannot erase a failure. An unfinished, blocked, or failed run makes the report command exit nonzero. `--strict` also fails for missing implementations or untested applicable cases. Default execution can finish successfully with incomplete coverage; the summary always says so.

| Status | Meaning |
| --- | --- |
| `passed` | The assertion executed successfully in this run and scope. |
| `failed` | An assertion or required execution stage failed. An unavailable backend that is expected to exist is a failure. |
| `missing-implementation` | The catalog identifies intended platform support that has not been implemented. |
| `not-applicable` | Outside this case's platform contract; for example a desktop-only integration case on mobile. |
| `not-tested` | No execution evidence, including missing automation or device access. |

Web secure storage has its own unavailable-behavior test. Passing it does not claim functional secure storage. UI availability/fallback checks must likewise remain separate from working-control cases. Preparation reports cannot claim native compilation or runtime passes.

## Add a capability test

1. Add a stable ID, layer, title, and explicit platform support to `examples/kitchen-sink/contract-report.ts`.
2. Put shared assertions in `contract-cases.ts`, taking only the public API binding and any owned test resource. Avoid Node/native imports in that file.
3. Execute it against the actual package in a runner or screen, with cleanup in `finally`. Exceptions become failures; do not catch an unavailable backend and mark the capability passed.
4. Add native/browser interaction drivers where necessary. Keep OS-specific behavior in separate cases rather than weakening the shared contract.
5. Record results with source/platform/runtime evidence. Add failure-injection tests for the harness when changing result semantics.

The current catalog covers build, API, UI, lifecycle, and distribution areas. Many broader desktop/module and lifecycle entries intentionally remain untested. Future work includes migrating remaining macOS suites, real mobile UI automation, restart/persistence and Fast Refresh assertions, device-only camera/audio/notification checks, and signed distribution tests on clean machines. Neither an empty case body nor an expected unsupported result counts as implementation coverage.

The desktop shared screen also runs filesystem and settings acceptance against the
same public APIs on macOS and Windows. Cases cover Unicode/file URLs, binary and
empty files, error codes, copying/moving/deleting directories, atomic replacement
watch notifications and unsubscribe, and serialized JSON settings updates. The
Windows feature runner also verifies settings across process termination/relaunch.
All filesystem cases use a disposable subdirectory of the app's temporary storage.

On desktop, use **Check message dialogs** and **Check context menus** before
finishing. The dialog check verifies missing-parent/busy errors, a four-button
result with a changed checkbox, and configured cancellation with a prechecked
checkbox. The menu check verifies semantic selection, busy rejection, and `null`
on dismissal. Follow the onscreen instructions; these are interactive native
checks, and `--api-only` leaves them untested. Use `--timeout 600` for manual runs.
Checked/disabled appearance, mixed-DPI placement, secondary-parent modality, and
runtime teardown while UI is open also need visual/manual acceptance.

### Remaining Windows feature acceptance

`bun run test:platform --platform windows --timeout 600` now packages all desktop
ports, Nitro, OP-SQLite, WebView, and the patched Margelo Runtimes library. API
checks include SQLite rollback/blob persistence, native Nitro identity/buffers,
and independent Hermes heaps with timers, exceptions and destruction/recreation.
The screen adds WebView messaging plus notification, modal/menu, tray/shortcut,
system/taskbar, and drag/drop interactions. Run these before **Finish run**.

A passing notification click does not prove cold activation or delayed delivery
while closed. A passing process test does not prove every descendant-cleanup race.
A successful worker function does not prove threaded surface input or native
module safety in every worker. Complete the explicit native checks in
[windows-issues.md](windows-issues.md); unexecuted cases stay untested.

Source SDK packing on Windows now also includes the pinned Runtimes source. It
uses Git and tar, with patch application in JavaScript; Unix `patch` is not needed.
Installed SDK consumers receive ordinary package archives and need no source checkout.
