# #126 Privacy permissions: verification

I opened and checked every image. All of them come from driver mode, where `@legendapp/spark/permissions` answers from simulated state: no TCC API was called, no prompt appeared and System Settings never opened.

## Kitchen Sink screen

From `bun run ks:capture system-integration/permissions --wait-for system-integration-permissions-listening`, against a Kitchen Sink dev build of this branch (`ks-lock native bun run rebuild:macos`).

| Image | Flags | What it shows |
|---|---|---|
| system-integration-permissions-light.png | `--appearance light` | Availability `{"available":true}` and every kind's simulated initial state: undetermined (notDetermined), or denied (notGranted) for screen recording and accessibility, with Request and Settings per row. |
| system-integration-permissions-dark.png | `--appearance dark` | The same, in dark. |
| system-integration-permissions-light-ar.png | `--appearance light --locale ar` | Arabic labels, right to left. States and availability are API data and stay untranslated; the screen title in the breadcrumb is English, as for every screen. |

## Driver flows

From `bun run e2e:run <flow> --backend driver`; these are the flows' `takeScreenshot` outputs.

| Image | What it shows |
|---|---|
| driver-permissions-requests.png | `permissions-requests`: camera granted after an allowed prompt, microphone denied, screen recording denied (notGranted), automation granted, contacts `SparkError:E_UNAVAILABLE` (no simulated answer), calendar raised from write-only to granted. |
| driver-permissions-events.png | `permissions-events`: location denied and photos unknown (unknown) after changes made outside the app, input monitoring granted after a request, and location's Settings "opened" (counted, not opened). |
