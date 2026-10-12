# #146 Sign in with Apple and passkeys: verification

I opened and checked every image. All come from driver mode, where `@legendapp/spark/apple-authentication` and `/passkeys` answer from simulated state: no `ASAuthorizationController` was created, nothing was presented, and neither Apple nor a relying party was contacted.

## Kitchen Sink screen

From `bun run ks:capture authentication/sign-in`, against a Kitchen Sink dev build of this branch (`ks-lock native bun run rebuild:macos`).

| Image | Flags | What it shows |
|---|---|---|
| authentication-sign-in-light.png | `--appearance light` | Both features report `missing-entitlement`, because the Kitchen Sink is not built with `macos.authentication`. It also shows Sign in, Credential state (disabled until someone signs in) and Cancel request, plus Create passkey, Sign in with passkey and Cancel request for example.com. |
| authentication-sign-in-dark.png | `--appearance dark` | The same screen in dark mode. |
| authentication-sign-in-light-ar.png | `--appearance light --locale ar` | Arabic labels, right to left, with the localized screen title in the breadcrumb. Availability and results are API data and stay untranslated. |

## Driver flows

From `bun run e2e:run <flow> --backend driver`. These are the flows' `takeScreenshot` outputs.

| Image | What it shows |
|---|---|
| driver-sign-in-availability.png | `sign-in-availability`: Sign in with Apple is entitled and available. Passkeys report `missing-entitlement` again after the simulated domain changed away from example.com. |
| driver-sign-in-apple.png | `sign-in-apple`: the last sign-in was cancelled (`cancel`), and the credential state is `revoked` after Apple's simulated answer changed. |
| driver-sign-in-passkeys.png | `sign-in-passkeys`: a created passkey `c2ltdWxhdGVkIHBhc3NrZXkgMQ`, and then a cancelled assertion. |
| driver-sign-in-errors.png | `sign-in-errors`: the aborted request (`AuthorizationError:E_ABORTED:appCancel`) and the request that was refused while it was pending (`SparkError:E_BUSY`). |
