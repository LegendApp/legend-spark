# #393 App Intents & Shortcuts: verification

I opened and checked every image. All come from driver mode, where `@legendapp/spark/app-intents` is simulated in
the app's memory: the Kitchen Sink declares no intents, nothing was registered with Shortcuts, Spotlight or Siri, and
nothing was donated to the system.

## Kitchen Sink screen

From `bun run ks:capture system-integration/app-intents --wait-for system-integration-app-intents-status-ksStartTimer`,
against a Kitchen Sink dev build of this branch (`ks-lock native bun run rebuild:macos`).

| Image | Flags | What it shows |
|---|---|---|
| system-integration-app-intents-light.png | `--appearance light` | Availability `{"available":true}` (simulated), no declared intents, both handlers rejected `SparkError:E_NOT_FOUND` because the Kitchen Sink declares none, and the donation button. Identical to the light/en golden. |
| system-integration-app-intents-dark.png | `--appearance dark` | The same in dark. Identical to the dark/en golden. |
| system-integration-app-intents-light-ar.png | `--appearance light --locale ar` | The same in Arabic, right to left; API results stay untranslated. Identical to the light/ar golden. |

## Driver flow

| Image | Flow | What it shows |
|---|---|---|
| driver-app-intents-handlers.png | `e2e/flows/system-integration/app-intents-handlers.yaml` (`takeScreenshot` at its end) | After the simulation declares the two intents and Listen again, both handlers read `listening` and both intents are listed. |
