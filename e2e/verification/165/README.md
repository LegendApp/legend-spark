# #165 Structured logging with rotation and diagnostics export: verification

I opened and checked every image.

## Kitchen Sink screen

These come from `bun run ks:capture reliability-diagnostics/logging --wait-for reliability-diagnostics-logging-entry-0-message`, run against a Kitchen Sink dev build of this branch (`ks-lock native bun run rebuild:macos`). I took them after the driver flows below had written entries and rotated the files.

| Image | Flags | What it shows |
|---|---|---|
| reliability-diagnostics-logging-light.png | `--appearance light` | Availability for logging, the unified log, files and diagnostics, each `{"available":true}`. The demo settings: level debug, 4096-byte files, 3 kept. The write buttons, including "Simulate a write failure", and the error events (`[]` in a fresh launch). app.log, app.1.log and app.2.log (4025 bytes each) with `{"count":3,"withinLimit":true}`, the log folder as native reports it, and the Diagnostics section. |
| reliability-diagnostics-logging-dark.png | `--appearance dark` | The same, in dark. |
| reliability-diagnostics-logging-light-ar.png | `--appearance light --locale ar` | Arabic labels, right to left, with Arabic-Indic digits from the app's number formatting, as in the sidebar. JSON readouts, file names and log entries stay untranslated. |

## Driver flows

From `bun run e2e:run <flow> --backend driver`, after deleting `~/Library/Logs/so.legend.spark.examples.kitchensink`. Seth's own Kitchen Sink was running, so `clearState` refused. I ran copies of the flows without `clearState: true` from /tmp; the committed flows keep it.

| Image | What it shows |
|---|---|
| driver-logging-exported.png | `logging-diagnostics-export-driver`: after one entry per level, Export with `--ks-diagnostics-dir` wrote Diagnostics.zip, `{"entries":["diagnostics.json","logs/app.log"]}`. |
| driver-logging-rotated.png | `logging-rotation`: after 100 entries, app.log, app.1.log and app.2.log, with `{"count":3,"withinLimit":true}`. |
| driver-logging-write-failure.png | `logging-write-failure`: a file put where the log folder was. Flush rejected `{"error":"E_ALREADY_EXISTS","dropped":2}`, and the listener heard the failure (dropped 1), then the recovery (dropped 2). |

`log show --predicate 'subsystem == "so.legend.spark.examples.kitchensink"'` showed one `spark.logging` error line, "Log entries are not being written: …", between the two lost entries and "Written again".
