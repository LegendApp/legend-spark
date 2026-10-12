# #164 Crash reporting: verification

I opened and checked every image.

## Kitchen Sink screen

From `bun run ks:capture reliability-diagnostics/crash-reporting` (in-process, no window shown) against a dev build of this branch (`ks-lock native bun run rebuild:macos`). Each capture is a fresh isolated session, so consent is off and there are no reports.

| Image | Flags | What it shows |
|---|---|---|
| reliability-diagnostics-crash-reporting-light.png | `--appearance light` | `{"available":true}`, "Allow crash reporting", `consent off`, the six simulate buttons, 0 reports. |
| reliability-diagnostics-crash-reporting-dark.png | `--appearance dark` | The same, in dark. |
| reliability-diagnostics-crash-reporting-light-ar.png | `--appearance light --locale ar` | Arabic labels, right to left. API values (availability, state) stay untranslated. |

## Driver flows

From `bun run e2e:run <flow> --backend driver` under `ks-lock native` (isolated clone; native crashes happen only in helper processes started from the clone's executable; nothing is sent anywhere).

| Image | What it shows |
|---|---|
| driver-crash-native-reports.png | `crash-reporting-native`, scrolled to the reports: SIGSEGV from `SparkCrashNow` called from `+[SparkCrashReporterLaunch load]` in the helper, SIGABRT from `abort()` via `SparkCrashNow`, and the uncaught exception's `objc_terminate` stack. |
| driver-crash-javascript-report.png | `crash-reporting-javascript`: the TypeError report with Hermes' stack starting at `sparkSimulatedJavaScriptCrash`. |
