# #426 Sign in with Apple button: verification

All images come from driver mode, where Sign in with Apple answers from simulated state: no `ASAuthorizationController` was created, nothing was presented and Apple was never contacted. Each image was opened and checked.

## Kitchen Sink screen

From `bun run ks:capture authentication/sign-in --appearance <a> --locale <l>` (rendered layers, the CARenderer path), against a dev build of this branch.

| Image | What it shows |
|---|---|
| authentication-sign-in-light-en.png | Apple's buttons: Sign in with Apple (automatic: black on light), Continue with Apple (black), Sign up with Apple (white), Sign in with Apple (white outline, corner radius 16). |
| authentication-sign-in-dark-en.png | The automatic button turns white in dark; the black, white and outline styles keep their colors. |
| authentication-sign-in-light-ar.png, authentication-sign-in-dark-ar.png | AuthenticationServices' own Arabic titles, logo on the right, buttons laid out right to left. |

## Driver flow

| Image | What it shows |
|---|---|
| driver-sign-in-apple-button.png | The end of `e2e/flows/authentication/sign-in-apple-button.yaml`: availability simulated `{"available":true}`, the outlined button's press reported `AuthorizationError:E_UNAVAILABLE:failed` through `onError`. |
