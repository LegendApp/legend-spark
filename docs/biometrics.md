# Biometrics

`@legendapp/spark/biometrics` asks the person to authenticate with Touch ID (LocalAuthentication), and keeps
secrets in the Keychain that only biometrics (or, if the app chooses, the login password) can read.

```ts
import { authenticateWithBiometrics, getBiometricSecret, getBiometricStatus, setBiometricSecret } from '@legendapp/spark/biometrics';

const status = await getBiometricStatus();            // never prompts
if (status.biometrics === 'available') {
  const result = await authenticateWithBiometrics({ reason: 'unlock your vault' });   // from a button the person pressed
  if (result.success) unlock();
  else if (result.reason === 'userCancel') stayLocked();
}

await setBiometricSecret('vault-key', key, { access: 'biometryCurrentSet' });   // never prompts
const read = await getBiometricSecret('vault-key', { reason: 'unlock your vault' });
if (read.success && read.value !== null) open(read.value);
```

## Availability and status

`getBiometricAvailability()` is synchronous: `{ available: true }` on macOS with the native module,
`missing-module` without it, `unsupported-platform` elsewhere. It says nothing about the hardware.

`getBiometricStatus()` reads `canEvaluatePolicy:` for both policies and never prompts:

- `biometryType`: `touchId`, `none`, or `unknown` (a type this SDK does not name).
- `biometrics`: whether biometrics alone can be evaluated now (fallback `none` or `app`, and the
  `biometryCurrentSet` and `biometryAny` secrets).
- `password`: whether biometrics or the login password can be evaluated now (fallback `password`, and
  `biometryOrPassword` secrets).

Each is `available` or why not: `notAvailable` (no sensor, or it is disabled), `notEnrolled` (no fingerprint),
`lockout` (too many failed attempts, until the person enters their password), `passcodeNotSet` (no login password),
`disconnected` (the Magic Keyboard with Touch ID is not connected), `notPaired` (none is paired). An affirmative
status is advisory: the state can change before a prompt.

## Authentication and fallback policy

`authenticateWithBiometrics({ reason, fallback?, fallbackLabel?, cancelLabel?, signal? })` shows the system prompt.
`reason` (1–300 characters) says why the app asks. `fallback` decides what else the prompt offers, and nothing falls back
to the password unless it asks for that:

| `fallback` | Policy | The prompt |
| --- | --- | --- |
| `none` (default) | `LAPolicyDeviceOwnerAuthenticationWithBiometrics`, empty `localizedFallbackTitle` | Touch ID only, no fallback button. Locked out or not enrolled: rejects. |
| `password` | `LAPolicyDeviceOwnerAuthentication` | Touch ID, and the login password; also when biometrics are locked out or unavailable. |
| `app` | `LAPolicyDeviceOwnerAuthenticationWithBiometrics`, `localizedFallbackTitle` = `fallbackLabel` (default macOS's "Enter Password") | Touch ID and a button that ends the prompt with `userFallback`, for the app's own sign-in. |

The person's answers resolve `{ success: true }` or `{ success: false, reason }`:

| `reason` | LAError |
| --- | --- |
| `userCancel` | `LAErrorUserCancel` |
| `systemCancel` | `LAErrorSystemCancel` (another app came forward, the Mac slept) |
| `userFallback` | `LAErrorUserFallback` (fallback `app` only) |
| `authenticationFailed` | `LAErrorAuthenticationFailed` |

When no prompt can run, or the app ended it, it rejects a `BiometricError` (a `SparkError` with a `reason`):

| `code` | `reason` | LAError / Keychain status |
| --- | --- | --- |
| `E_UNAVAILABLE` | `notAvailable`, `notEnrolled`, `lockout`, `passcodeNotSet`, `disconnected`, `notPaired` | the matching `LAErrorBiometry…` / `LAErrorPasscodeNotSet`; `errSecNotAvailable` |
| `E_UNAVAILABLE` | `notInteractive` | `LAErrorNotInteractive`, `errSecInteractionNotAllowed` |
| `E_UNAVAILABLE` | `missingEntitlement` | `errSecMissingEntitlement` (the app has no Keychain access group) |
| `E_ABORTED` | `appCancel` | `LAErrorAppCancel`: the `signal` aborted, or the JavaScript runtime reloaded |
| `E_CLOSED` | `invalidContext` | `LAErrorInvalidContext` |

Other failures are plain `SparkError`s: `E_INVALID_ARGUMENT` and `E_UNSUPPORTED_OPTION` for arguments (checked before
any native call), `E_BUSY` while another biometric prompt of the app is up (one at a time), `E_NATIVE` for an LAError
code or Keychain status this SDK does not name (never folded into a known reason), `E_INVALID_DATA` for a malformed
native reply. Aborting `signal` invalidates the prompt's `LAContext`, which dismisses it.

Threading: each prompt gets its own `LAContext`, held until it settles and then invalidated. `evaluatePolicy:` replies
on a private queue; Keychain reads block while macOS prompts, so they run on a background queue. Every result is
delivered once, on the main thread, and then to JavaScript.

## Secrets gated by biometry

Secrets are generic passwords in the data protection keychain (`kSecUseDataProtectionKeychain`), service
`<app namespace>.biometrics`, account = the key (1–200 letters, digits, `.`, `-`, `_`), accessible
`WhenPasscodeSetThisDeviceOnly`, with access control:

| `access` | Flags | Who reads it |
| --- | --- | --- |
| `biometryCurrentSet` (default) | `kSecAccessControlBiometryCurrentSet` | The fingerprints enrolled now. Adding or removing one makes the secret unreadable. |
| `biometryAny` | `kSecAccessControlBiometryAny` | Any enrolled fingerprint. |
| `biometryOrPassword` | `kSecAccessControlUserPresence` | Touch ID or the login password. |

- `setBiometricSecret(key, value, { access? })` replaces any secret under `key`. It never prompts: it first checks that
  the access's policy can be evaluated (else a `BiometricError` with that state), then deletes without interaction and
  adds.
- `getBiometricSecret(key, { reason, cancelLabel? })` prompts as the secret's access requires and resolves
  `{ success: true, value }`, with `value: null` and no prompt when there is no secret (also after a fingerprint
  change invalidated a `biometryCurrentSet` one). The person's `userCancel`, `systemCancel` or `authenticationFailed`
  resolve `{ success: false, reason }`.
- `deleteBiometricSecret(key)` never prompts and resolves also when there is none.

The data protection keychain needs a signed app with a Keychain access group (an application identifier); without one
macOS answers `errSecMissingEntitlement`, which rejects `E_UNAVAILABLE` with reason `missingEntitlement`.

## Testing

In driver mode (the in-app test driver, [test-driver.md](test-driver.md)) every call goes to simulated state kept in the
app's memory: no `LAContext` is created, no Touch ID or password prompt appears and no keychain is touched. Touch ID
starts available for both policies, with no answer. Two driver commands, built only with the driver
(`#if SPARK_TEST_DRIVER`):

- `{"command": "simulateBiometrics", "biometryType"?, "biometrics"?, "password"?, "answer"?, "enrollmentChanged"?}` sets
  the sensor, the state of each policy (`password`: `available`, `passcodeNotSet` or `notAvailable`) and how simulated
  prompts end: `success`, `userCancel`, `systemCancel`, `userFallback` (only with fallback `app`, as macOS shows no
  button otherwise), `authenticationFailed`, or `ignore` (the prompt stays up until cancelled, which ends it with
  `appCancel`). Without an answer (`null`), a prompt rejects `E_UNAVAILABLE`. A policy that is not `available` rejects
  with its state before any prompt, as macOS does. `enrollmentChanged: true` removes `biometryCurrentSet` secrets.
- `{"command": "testBiometrics"}` replies `biometrics`: the state, `prompts` shown, `pending` prompts, `lastPrompt`
  (`operation`, `reason`, `fallback`, labels) and `secrets` (key → access, never values).

Flows use them as `simulateBiometrics` and `assertSimulatedBiometrics` ([e2e-flow-commands.md](e2e-flow-commands.md)).
`tests/biometrics.native.mm` checks the LAError and Keychain mappings and the simulation without a prompt. Real prompts
are checked only by the manual flow `e2e/flows/storage-data/biometrics-real.yaml`.

## Platforms

| Platform | Availability |
| --- | --- |
| macOS | Available (Touch ID: Apple silicon Macs and Magic Keyboard with Touch ID). |
| Windows | `getBiometricAvailability()` reports `unsupported-platform`; the other functions reject `E_UNSUPPORTED_PLATFORM` after validating their arguments. Windows Hello (`UserConsentVerifier`, Hello-gated credentials) is tracked in #389. |

The Kitchen Sink's Biometrics screen (`spark-ks://storage-data/biometrics`) shows availability and status, prompts with
each fallback policy, and stores, reads and deletes a secret per access; its flows are in `e2e/flows/storage-data/`.
