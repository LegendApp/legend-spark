# Diagnostics: hang watchdog and crash reporting

`@legendapp/spark/diagnostics` reports main-thread hangs with the main thread's stack, and records
native crashes and fatal JavaScript errors on the user's Mac with their consent ([crash
reporting](#crash-reporting)), so an app can log them or send them to its own tooling. It also has
`getStartupTiming()`.

```ts
import { getHangWatchdogAvailability, startHangWatchdog } from '@legendapp/spark/diagnostics';

if (getHangWatchdogAvailability().available) {
  const watchdog = await startHangWatchdog({
    thresholdMs: 250,
    onHang: report => log.warn('main thread hang', report.durationMs, report.stack.slice(0, 8)),
  });
  // At shutdown, or when the user turns diagnostics off:
  await watchdog.remove();
}
```

## How it works

A watchdog thread pings the main run loop (a block on the main queue). If a ping goes unanswered
for `thresholdMs`, the main thread is hanging: the watchdog suspends it just long enough to read its
registers and walk its frame pointers, resumes it, and then waits for the ping to be answered. When
the main thread answers, `onHang` gets one report for the hang. Reports are delivered after the
hang, because events reach JavaScript through the main thread.

- **Threshold.** Integer milliseconds from 50 to 60000; the default is 250 (the duration from which
  Apple's tools count a hang). The next ping goes out half a threshold after the last answer, so a hang
  shorter than `thresholdMs` is never reported (not even when the watchdog thread runs late) and one longer than 1.5 x `thresholdMs` normally is
  (a heavily loaded Mac can run the watchdog thread late).
- **Duration.** `durationMs` runs from the unanswered ping to the moment the main thread answers it. It is a lower bound: the
  hang can have started up to half a threshold before that ping. Time the Mac spends asleep does
  not count.
- **Cost.** Nothing runs before `startHangWatchdog` or after `remove()`. A running watchdog is one
  thread, asleep except for one ping every half threshold. While the main thread is suspended the
  watchdog only makes Mach calls into a fixed buffer, so it cannot wait on a lock the main thread
  holds; symbols are looked up after the main thread resumes.
- **Lifetime.** Each `startHangWatchdog` call starts its own watchdog with its own threshold.
  `remove()` stops callbacks at once; a report already on its way is dropped. The native watchdogs
  stop when the React Native host reloads or is torn down.
- A debugger that pauses the app makes every watchdog report a hang when it continues.
- A hang that ends in a crash or a forced quit is never reported: there is no recovery to report
  it from.

## Reports

```ts
interface HangReport {
  durationMs: number;    // lower bound, see above
  thresholdMs: number;   // the watchdog's threshold
  startedAt: number;     // wall-clock ms since 1970 of the unanswered ping, like Date.now()
  stack: StackFrame[];   // innermost first, sampled once the threshold passed; [] if it could not be read
}
interface StackFrame {
  address: string;       // hex: the program counter, then return addresses
  image?: string;        // path of the binary containing the address
  imageAddress?: string; // hex load address of that binary
  imageOffset?: number;  // address - imageAddress
  imageUUID?: string;    // LC_UUID, to find the matching dSYM
  symbol?: string;       // nearest symbol known to the dynamic loader
  symbolOffset?: number;
}
```

The stack is the frame-pointer chain, which arm64 and x86_64 macOS code always keeps; on arm64 a
leaf function's caller comes from the link register, which is left out when it points back into
the running function (a stale return address in a function that is not a leaf). Up to 128 frames are reported. Pointer
authentication bits are removed from return addresses.

`symbol` comes from `dladdr` after the main thread resumes. System libraries and debug builds
name every frame. A stripped release build only names exported functions, and `dladdr` then
gives the nearest exported symbol, which can be a neighbour. For those builds, symbolicate the
frames offline with the build's dSYM: `atos -o MyApp.app.dSYM/Contents/Resources/DWARF/MyApp -l <imageAddress> <address>`,
matching the dSYM by `imageUUID`.

The top of a report from the native test harness (`tests/hang-watchdog.native.mm`), blocked in `simulateHang`:

```
0x1868f4308 libsystem_kernel.dylib+17160 __semwait_signal
0x1867cb054 libsystem_c.dylib+57428      nanosleep
0x1867caf6c libsystem_c.dylib+57196      usleep
0x10024872c test+18220                   SparkSimulateHang
0x100244bf8 test+3064                    SparkTestBlockMainThread
0x100244e74 test+3700                    main
0x18655fe80 dyld+204416                  start
```

## Checking your reporting

`simulateHang(durationMs)` blocks the main thread for an integer number of milliseconds (1 to
10000). The app does not respond meanwhile, so use it in development and tests: it checks that
hangs flow from the watchdog to wherever your app sends them. The promise resolves once the main
thread is free again.

## Availability and errors

`getHangWatchdogAvailability()` is synchronous and loads no native code.

| Platform | Availability | `startHangWatchdog`, `simulateHang` |
| --- | --- | --- |
| macOS | `{ available: true }` with the `NativeDesktopDiagnostics` module installed, otherwise `missing-module` | as above; `E_MODULE_UNAVAILABLE` without the module |
| Windows, iOS, Android, web | `{ available: false, reason: 'unsupported-platform' }` | reject `E_UNSUPPORTED_PLATFORM` |

The Windows implementation is tracked in [#304](https://github.com/LegendApp/legend-spark/issues/304).
Invalid options reject `E_INVALID_ARGUMENT`, unknown option keys `E_UNSUPPORTED_OPTION`, both
before anything starts. A native report that does not match the contract is not passed to
`onHang`; it is logged as an `E_INVALID_DATA` `SparkError`.

## Crash reporting

```ts
import { getCrashReportingAvailability, getCrashReports, setCrashReportingConsent, deleteCrashReports } from '@legendapp/spark/diagnostics';

if (getCrashReportingAvailability().available) {
  // Once the user agrees (in onboarding or Settings). Kept across launches; off until then.
  await setCrashReportingConsent(true);
  // At launch: reports of earlier crashes, symbolicated. Send them to your own service, then delete them.
  const reports = await getCrashReports();
  await upload(reports);
  await deleteCrashReports(reports.map(report => report.id));
}
```

Reports stay on the Mac, in `~/Library/Logs/<bundle identifier>/Crashes`. Spark never sends them
anywhere; what leaves the Mac is up to the app.

### Consent

Nothing is recorded without consent. `setCrashReportingConsent(true)` stores it in the app's defaults
and installs the handlers at once; at every later launch they are installed before the app starts
(from an Objective-C `+load`), so early crashes are caught. `setCrashReportingConsent(false)` stops
recording at once: installed handlers then only pass crashes on. Existing reports stay until
`deleteCrashReports`. `getCrashReportingConsent()` reads the stored choice.

### Native crashes

Handlers for SIGABRT, SIGBUS, SIGFPE, SIGILL, SIGSEGV, SIGSYS and SIGTRAP, and an uncaught-exception
handler, are installed once per process.

- **In the crashing process** the signal handler only makes async-signal-safe calls: `open`, `write`
  and `close` from a buffer on its own stack, `clock_gettime`, `vm_read_overwrite` to walk the frame
  pointers, and `sigaction`/`raise`. It allocates nothing, takes no lock and runs no Objective-C.
  Everything it reads is prepared beforehand: the folder, the app version, and the loaded images
  (base, size, UUID, path), kept by dyld callbacks so the handler never asks dyld. It writes a short
  text record (`<ms>-<pid>.sparkcrash`): the signal and fault address, whether it was the main thread,
  up to 128 return addresses and the images that hold them. Only the first thread to crash records.
- **Uncaught Objective-C exceptions**: the exception handler copies the name and reason into a fixed
  buffer, then calls the handler that was there before; the runtime's `abort()` follows, and its
  SIGABRT record carries the exception. AppKit catches exceptions thrown inside event handling on the
  main thread and logs them instead (unless the app sets `NSApplicationCrashOnExceptions`); those do
  not end the app and are not reported.
- **Stack overflow**: the thread that installs the handlers (the main thread) gets a 128 KiB
  alternate signal stack, so a main-thread stack overflow is recorded. Other threads have none, and
  the system ends the process without running the handler when their stack overflows.
- **Passing the crash on**: after recording, the handler restores the handler that was installed
  before Spark's and lets the signal take its course. A fault re-executes and reaches that handler (or
  the default action); a signal from `abort()`, `raise()` or `kill()` is raised again. So other crash
  reporters, the system crash reporter (`~/Library/Logs/DiagnosticReports`) and a debugger still see
  the crash.
- **At the next launch** (and at every `getCrashReports`), records of processes that have exited
  become JSON reports. Frames are symbolicated with `dladdr` against the same binaries loaded in the
  new process, matched by UUID: an image that is no longer loaded, or was rebuilt, keeps its address,
  image, offset and UUID without a symbol.

### JavaScript errors

Importing `@legendapp/spark/diagnostics` on macOS puts a handler in front of React Native's global
error handler (`ErrorUtils`). A fatal error is recorded synchronously, while consent is on, through a
synchronous native call, so the report is on disk before React Native's handler shows the red box or
ends the app; then the error goes to that handler unchanged. Non-fatal errors only pass through. The
report keeps the error's `name`, `message` and the engine's `stack` string. A release bundle's stack
names minified functions; symbolicate it with the bundle's source map.

### Reports

```ts
type CrashReport = NativeCrashReport | JavaScriptCrashReport;
interface NativeCrashReport {
  id: string;            // "<ms since 1970>-<pid>"
  kind: 'native';
  createdAt: number;     // ms since 1970
  simulated: boolean;    // from simulateCrash
  app: { version: string | null; build: string | null };
  signal: 'SIGABRT' | 'SIGBUS' | 'SIGFPE' | 'SIGILL' | 'SIGSEGV' | 'SIGSYS' | 'SIGTRAP';
  signalCode: number;    // si_code
  faultAddress?: string; // SIGSEGV, SIGBUS, SIGILL, SIGFPE
  mainThread: boolean;
  exception?: { name: string; reason: string };
  stack: StackFrame[];   // the crashing thread, innermost first, up to 128 frames
}
interface JavaScriptCrashReport {
  id: string; kind: 'javascript'; createdAt: number; simulated: boolean; app: { version: string | null; build: string | null };
  fatal: true; name: string; message: string; stack?: string;
}
```

`getCrashReports()` lists every report, newest first. `deleteCrashReports(ids)` deletes those
reports (unknown ids are ignored); `deleteCrashReports()` deletes all of them, with any records not
yet processed.

### Symbolication with a dSYM

A release build is stripped, so `dladdr` names only exported functions there (or a neighbouring one).
Every frame keeps `image`, `imageAddress`, `imageOffset` and `imageUUID`; with the build's dSYM,
`spark symbolicate` names each frame and its source line on your Mac:

```sh
spark symbolicate report.json --dsym path/to/MyApp.app.dSYM   # or a folder that holds dSYMs
```

`report.json` holds one report or the array `getCrashReports()` returned. Frames are matched to a
dSYM by `imageUUID` (`dwarfdump --uuid`), then `atos -o <DWARF> -l <imageAddress> <address>…` sets
`symbol` and, when the dSYM has line information, `location` (`file:line`). Frames of images without
a matching dSYM are left as they are. It prints the report as JSON. Keep each release's dSYM: with
`DEBUG_INFORMATION_FORMAT = dwarf-with-dsym`, Xcode writes `MyApp.app.dSYM` next to the app in
`Build/Products/Release`.
It works for hang reports too.

### Checking your reporting

`simulateCrash(kind)` requires consent (otherwise it rejects `E_PERMISSION_DENIED`) and never ends
the app. `badAccess` (SIGSEGV), `abort` (SIGABRT), `uncaughtException` (an NSException, SIGABRT),
`trap` (SIGTRAP on Apple silicon, SIGILL on Intel) and `stackOverflow` (SIGSEGV) start the app's own
executable as a helper process with no window, which installs the handlers and crashes before the
app would start; its handler exits once the record is written, so the system crash reporter does not
see it. The promise resolves with the helper's report (rejects `E_TIMEOUT` after 30 s). The native kinds
exist only in Debug builds and builds with the test driver (`macos.testDriverInRelease`,
[test driver](test-driver.md#builds)): a release build you distribute has no `SPARK_SIMULATE_CRASH` launch
hook, and they reject `E_UNAVAILABLE` there. `javascript` works in every build: it throws a real TypeError
and records it as the handler would for a fatal error, without passing it on.

### Availability and errors

| Platform | `getCrashReportingAvailability()` | Calls |
| --- | --- | --- |
| macOS | `{ available: true }` with the `NativeDesktopDiagnostics` module, otherwise `missing-module` | as above; `E_MODULE_UNAVAILABLE` without the module |
| Windows, iOS, Android, web | `{ available: false, reason: 'unsupported-platform' }` | reject `E_UNSUPPORTED_PLATFORM` after validating arguments |

The Windows implementation is tracked in [#343](https://github.com/LegendApp/legend-spark/issues/343).
A native report that does not match the contract rejects `E_INVALID_DATA`.

## Tests

- `tests/crash-reporting.test.ts`: consent, validation, report contracts, the JavaScript handler
  (fatal errors recorded before the previous handler, non-fatal passed through) and availability,
  against a mocked bridge.
- `tests/crash-reporting-native.test.ts` builds `tests/crash-reporting.native.mm` with the real
  `SparkCrashReporter` (unoptimized and `-O2`) and crashes child copies of it: SIGSEGV, abort,
  uncaught NSException, trap, a stack overflow and a crash on another thread each die of the
  original signal and leave a report naming the crashing function; a handler installed before
  Spark's still runs; without consent nothing is recorded; `simulateCrash` helpers exit without
  reaching the system crash reporter. A stripped `-O2` build shows what a release build reports, and
  `spark symbolicate` with its dSYM names the frames and source lines. The children that reach the
  system crash reporter leave `.ips` files in `~/Library/Logs/DiagnosticReports`; the test deletes
  the ones of its own processes.
- `tests/hang-watchdog.test.ts`: validation, wire shapes, routing reports to their watchdog,
  cleanup and availability, against a mocked bridge.
- `tests/hang-watchdog-native.test.ts` builds `tests/hang-watchdog.native.mm` with the real
  `SparkHangWatchdog` (unoptimized and `-O2`) and hangs its main thread: a 600 ms hang is reported
  once with its duration and a stack from `__semwait_signal` down to `main`; a 30 ms stall is not;
  back-to-back hangs are reported separately; after `stop` nothing is reported and the thread
  exits; two watchdogs keep their own thresholds.
- Kitchen Sink: Reliability & diagnostics → Hang watchdog and Crash reporting, and the `REL-HANG-*`
  and `REL-CRASH-*` flows in `e2e/flows/reliability-diagnostics/`.
