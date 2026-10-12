# #125 Sharing & Spotlight: verification

I opened and checked every image. All come from driver mode, where `@legendapp/spark/sharing` and the default URL
handler of `/links` use in-memory simulated state: no share picker appeared, the Spotlight index, pbs and the Services
provider were never touched, and LaunchServices was never read or changed.

## Kitchen Sink screen

From `bun run ks:capture system-integration/sharing --wait-for system-integration-sharing-service-status`, against a
Kitchen Sink dev build of this branch (`ks-lock native bun run rebuild:macos`).

| Image | Flags | What it shows |
|---|---|---|
| system-integration-sharing-light.png | `--appearance light` | Availability of share, services, spotlight and the default URL handler (all available), the three share buttons, and the Services listener rejected `SparkError:E_UNAVAILABLE` because the Kitchen Sink declares no Services. Identical to the light/en golden. |
| system-integration-sharing-dark.png | `--appearance dark` | The same in dark. Identical to the dark/en golden. |
| system-integration-sharing-light-ar.png | `--appearance light --locale ar` | The same in Arabic, right to left; API results stay untranslated. |

## Driver flow

| Image | Flow | What it shows |
|---|---|---|
| driver-sharing-share.png | `e2e/flows/system-integration/sharing-share.yaml` (`takeScreenshot` at its end) | After four simulated shares (no answer, Mail, AirDrop, dismiss), the result reads `dismissed`. |
