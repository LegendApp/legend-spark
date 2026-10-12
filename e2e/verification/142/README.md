# #142 Biometrics: verification

I opened and checked every image. All of them come from driver mode, where `@legendapp/spark/biometrics` answers from simulated state: no `LAContext` was created, no Touch ID or password prompt appeared and no keychain was touched.

## Kitchen Sink screen

From `bun run ks:capture storage-data/biometrics`, against a Kitchen Sink dev build of this branch (`ks-lock native bun run rebuild:macos`).

| Image | Flags | What it shows |
|---|---|---|
| storage-data-biometrics-light.png | `--appearance light` | Availability `{"available":true}`, the simulated status (Touch ID, both policies available), a Prompt per fallback policy, Cancel prompt, and Store/Read/Delete per secret access. |
| storage-data-biometrics-dark.png | `--appearance dark` | The same, in dark. |
| storage-data-biometrics-light-ar.png | `--appearance light --locale ar` | Arabic labels, right to left. Status, results and availability are API data and stay untranslated; the breadcrumb's screen title is English, as for every screen. |

## Driver flows

From `bun run e2e:run <flow> --backend driver`; these are the flows' `takeScreenshot` outputs.

| Image | What it shows |
|---|---|
| driver-biometrics-prompts.png | `biometrics-prompts`: the last outcome, `app: userFallback`, after success, userCancel, systemCancel and authenticationFailed. |
| driver-biometrics-errors.png | `biometrics-errors`: the aborted prompt (`none: BiometricError:E_ABORTED:appCancel`) after lockout, notEnrolled, passcodeNotSet and E_BUSY. |
| driver-biometrics-secrets.png | `biometrics-secrets`: biometrics locked out; the biometryCurrentSet secret gone after a fingerprint change (`value: null`), biometryAny unreadable (`BiometricError:E_UNAVAILABLE:lockout`), biometryOrPassword deleted. |
