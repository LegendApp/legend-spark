# Diagnostics: main-thread hang watchdog

`@legendapp/spark/diagnostics` reports main-thread hangs with the main thread's stack, so an app
can log them or send them to its own crash and performance tooling. It also has `getStartupTiming()`.

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
  shorter than `thresholdMs` is never reported and one longer than 1.5 x `thresholdMs` always is.
- **Duration.** `durationMs` runs from the unanswered ping to the answer. It is a lower bound: the
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
  stack: HangStackFrame[]; // innermost first, sampled once the threshold passed; [] if it could not be read
}
interface HangStackFrame {
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
leaf function's caller comes from the link register. Up to 128 frames are reported. Pointer
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

## Tests

- `tests/hang-watchdog.test.ts`: validation, wire shapes, routing reports to their watchdog,
  cleanup and availability, against a mocked bridge.
- `tests/hang-watchdog-native.test.ts` builds `tests/hang-watchdog.native.mm` with the real
  `SparkHangWatchdog` (unoptimized and `-O2`) and hangs its main thread: a 600 ms hang is reported
  once with its duration and a stack from `__semwait_signal` down to `main`; a 30 ms stall is not;
  back-to-back hangs are reported separately; after `stop` nothing is reported and the thread
  exits; two watchdogs keep their own thresholds.
- Kitchen Sink: Reliability & diagnostics → Hang watchdog, and the `REL-HANG-*` flows in
  `e2e/flows/reliability-diagnostics/`.
