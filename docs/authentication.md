# Sign in with Apple and passkeys

`@legendapp/spark/apple-authentication` shows the Sign in with Apple sheet, and `@legendapp/spark/passkeys` creates
and uses passkeys. Both drive AuthenticationServices' `ASAuthorizationController` over the app's window. For OAuth in
the browser, use [`/auth-session`](auth-session.md).

```ts
import { getAppleAuthenticationAvailability, signInWithApple } from '@legendapp/spark/apple-authentication';
import { digestStringAsync, getRandomBytesAsync } from '@legendapp/spark/auth-session';
import { createPasskey, getPasskey } from '@legendapp/spark/passkeys';

if (getAppleAuthenticationAvailability().available) {
  // A fresh raw nonce per sign-in; Apple only sees its SHA-256, the server gets the raw value.
  const rawNonce = Array.from(await getRandomBytesAsync(32), byte => byte.toString(16).padStart(2, '0')).join('');
  const nonce = await digestStringAsync('SHA-256', rawNonce);
  const result = await signInWithApple({ scopes: ['fullName', 'email'], nonce, windowId });  // from a button the person pressed
  if (result.type === 'success') {
    const { identityToken, authorizationCode, user } = result.credential;
    await server.signInWithApple({ identityToken, authorizationCode, rawNonce, user });
  }
}

const options = await server.registrationOptions();     // WebAuthn options: challenge and user.id are base64url
const created = await createPasskey({ relyingPartyId: 'example.com', challenge: options.challenge, userId: options.user.id, userName: options.user.name, windowId });
if (created.type === 'success') await server.register(created.credential);

const signedIn = await getPasskey({ relyingPartyId: 'example.com', challenge: (await server.assertionOptions()).challenge, windowId });
if (signedIn.type === 'success') await server.verify(signedIn.credential);
```

## Entitlements

Both features need restricted entitlements, which macOS only honors in a build signed by your team with a
provisioning profile that grants them (a Developer ID or Mac App Store profile with the capability enabled for the App
ID). Spark adds them only when the app asks, in `desktop.config.json`:

```json
{ "macos": { "bundleIdentifier": "com.example.app", "authentication": { "signInWithApple": true, "passkeyDomains": ["example.com"] } } }
```

| Option | Entitlement |
| --- | --- |
| `signInWithApple: true` | `com.apple.developer.applesignin: ["Default"]` |
| `passkeyDomains: ["example.com"]` | `webcredentials:example.com` in `com.apple.developer.associated-domains` (a `?mode=developer` suffix is kept) |

For passkeys the domain must also serve `/.well-known/apple-app-site-association` listing the app under
`webcredentials.apps` (`<team ID>.<bundle ID>`). `spark package` does not embed provisioning profiles yet (#424),
so these builds are signed and checked with the profile by hand.

The availability functions read the running app's signed entitlements (`SecTaskCopyValueForEntitlement`):

- `getAppleAuthenticationAvailability()`: `{ available: true }` with `com.apple.developer.applesignin`, else
  `{ available: false, reason: 'missing-entitlement' }`.
- `getPasskeyAvailability(relyingPartyId)`: available with `webcredentials:<relyingPartyId>`, else `missing-entitlement`.
  It cannot see whether the domain's association file lists the app; when it does not, requests reject reason `failed`.
  A wildcard entry (`webcredentials:*.example.com`, written in `macos.entitlements`) counts for subdomains of
  example.com only; example.com itself needs its own entry.

Both report `missing-module` without the native module and `unsupported-platform` off macOS. A request without its
entitlement rejects reason `missingEntitlement` before anything is created or shown, rather than AuthenticationServices'
unexplained `unknown` error.

## Sign in with Apple

`signInWithApple({ scopes?, state?, nonce?, windowId?, signal? })` resolves `{ type: 'success', credential }` or
`{ type: 'cancel' }` when the person cancels. The credential:

| Field | |
| --- | --- |
| `user` | The stable identifier of this person for your team. Store it. |
| `identityToken`, `authorizationCode` | A JWT and a short-lived code for your server to verify with Apple. |
| `email`, `fullName` | Only the first time the person signs in to the app, and only for the scopes asked; the email may be a private relay address. Otherwise `null`. |
| `state` | The `state` passed in, or `null`. |
| `authorizedScopes`, `realUserStatus` | What the person shared; `likelyReal`, `unknown` or `unsupported`. |

### Verifying on your server

The credential proves nothing until your server verifies it; never trust `user` or `email` from the app alone.

1. Verify the `identityToken` JWT's signature with Apple's public keys (`https://appleid.apple.com/auth/keys`, picked
   by the token's `kid`), and check its claims: `iss` is `https://appleid.apple.com`, `aud` is the app's bundle
   identifier, `exp` is in the future, and `nonce` equals the SHA-256 (hex) of the raw nonce the app sent. Its `sub` is
   the `user`.
2. Exchange the `authorizationCode` at `https://appleid.apple.com/auth/token` (with your client secret, a JWT signed
   by your Sign in with Apple key) for a refresh token, which you need to revoke the account later.

Use a new raw nonce for every sign-in and reject one the server has seen before.

`getAppleIDCredentialState(user)` asks Apple whether the person still authorizes the app: `authorized`, `revoked`,
`notFound` or `transferred`. Check it at launch and sign out when it is not `authorized`. It shows nothing, so it never
resolves a cancel: an AuthenticationServices cancel there is `E_NATIVE`.

### The Sign in with Apple button

Apple requires apps that offer Sign in with Apple to use its button. `AppleSignInButton` is AuthenticationServices'
`ASAuthorizationAppleIDButton`: Apple draws the logo and the title in the app's language (right to left where that
language is), and the accessibility label.

```tsx
import { AppleSignInButton, getAppleAuthenticationAvailability, signInWithApple } from '@legendapp/spark/apple-authentication';

// The button runs signInWithApple(signInOptions) over its own window and reports the outcome:
<AppleSignInButton signInOptions={{ scopes: ['email'], nonce }} onSignIn={result => ...} onError={error => ...} />
// Or the app runs the request, with its own signal:
<AppleSignInButton buttonType="continue" onPress={({ windowId }) => signInWithApple({ windowId, nonce, signal })} />
```

| Prop | |
| --- | --- |
| `buttonType` | `signIn` (default), `continue` or `signUp`: Sign in with Apple, Continue with Apple, Sign up with Apple. |
| `buttonStyle` | `automatic` (default): black on a light appearance, white on a dark one, following the window as it changes. `black`, `white`, or `whiteOutline` for white backgrounds. |
| `cornerRadius` | Points, 0 or more. Default: the system's. |
| `onPress` | The app handles the press; `windowId` is the button's window (undefined in a window Spark did not make). |
| `signInOptions`, `onSignIn`, `onError` | Without `onPress`: each press calls `signInWithApple({ windowId: <the button's window>, ...signInOptions })`; the result goes to `onSignIn`, a rejection (an `AuthorizationError`, or `E_BUSY`, `E_INVALID_ARGUMENT`) to `onError`. |

Give it `onPress`, or `onSignIn` and `onError`; anything else, or an unknown type or style, throws `E_INVALID_ARGUMENT`
while rendering. Size it with `style`; it is at least Apple's minimum, 140 × 30 points. It shows whatever the build's
entitlements, and a press without them rejects `missingEntitlement`, so decide with
`getAppleAuthenticationAvailability()` whether to show it. macOS only: rendering it on Windows throws
`E_UNSUPPORTED_PLATFORM` (#423). In driver mode a press reaches the simulated request like any other.

## Passkeys

Binary values (challenge, user ID, credential IDs and responses) are unpadded base64url strings, as in WebAuthn's JSON
serialization (`PublicKeyCredential.toJSON()`), so server options and responses pass through unchanged.

- `createPasskey({ relyingPartyId, challenge, userId, userName, displayName?, userVerification?, attestation?, excludeCredentials?, windowId?, signal? })`
  resolves `{ credentialId, clientDataJSON, attestationObject }` (attestation `none` by default). `excludeCredentials`
  needs macOS 15 (`E_UNAVAILABLE` before); a listed passkey on this Mac rejects `matchedExcludedCredential`.
- `getPasskey({ relyingPartyId, challenge, allowCredentials?, userVerification?, windowId?, signal? })` resolves
  `{ credentialId, userId, clientDataJSON, authenticatorData, signature }`.

The challenge is 16–1024 bytes, the user ID 1–64 bytes, `userVerification` `required`, `preferred` (default) or
`discouraged`. Your server verifies the responses; Spark never sees a private key.

## Requests, cancellation and errors

One authorization request shows at a time; another rejects `E_BUSY`. The sheet is presented over the window named
`windowId` (`useWindowId()`, `"main"` for the main window), else the key window; `E_NOT_FOUND` when there is none.
Aborting `signal` cancels the controller and rejects `E_ABORTED` reason `appCancel`; so does a JavaScript reload. Each
request's controller and delegate live until the request settles; delegate callbacks are handled on the main thread and
each request completes exactly once.

Failures reject an `AuthorizationError` (a `SparkError` with `reason`):

| `code` | `reason` | ASAuthorizationError |
| --- | --- | --- |
| `E_UNAVAILABLE` | `missingEntitlement` | none: the entitlement is missing, checked first |
| `E_UNAVAILABLE` | `notInteractive`, `notHandled`, `failed`, `deviceNotConfigured` | `NotInteractive`, `NotHandled`, `Failed` (for passkeys often a domain that does not list the app), `DeviceNotConfiguredForPasskeyCreation` |
| `E_ALREADY_EXISTS` | `matchedExcludedCredential` | `MatchedExcludedCredential` |
| `E_INVALID_DATA` | `invalidResponse` | `InvalidResponse` |
| `E_ABORTED` | `appCancel` | `Canceled` after the app cancelled |
| `E_NATIVE` | `unknown` | `Unknown` |

`Canceled` by the person resolves `{ type: 'cancel' }`. Other failures are plain `SparkError`s: `E_INVALID_ARGUMENT`
and `E_UNSUPPORTED_OPTION` for arguments (checked before any native call), `E_NATIVE` for an error the SDK does not
name, `E_INVALID_DATA` for a malformed native reply.

## Testing

In driver mode (the in-app test driver, [test-driver.md](test-driver.md)) every request goes to simulated state kept in
the app's memory: no `ASAuthorizationController` is created, nothing is presented and neither Apple nor a relying party
is reached. The simulation starts from the build's real entitlements, so availability stays truthful (the Kitchen Sink
has none) until a flow changes it. Two driver commands, built only with the driver (`#if SPARK_TEST_DRIVER`):

- `{"command": "simulateAuthorization", "appleId"?, "webCredentials"?, "answer"?, "credentialState"?}` sets the simulated
  entitlements (`appleId`: Sign in with Apple; `webCredentials`: passkey domains), how requests end (`success`, `cancel`,
  a failure reason, or `ignore`: the request stays up until cancelled, which ends it with `appCancel`; without an answer,
  `null`, a request rejects `E_UNAVAILABLE`) and the credential state (`null`: users signed in during the run are
  `authorized`, others `notFound`). A success returns made-up credentials (`simulated.identity.token`, a
  `simulated@privaterelay.appleid.com` email, `Spark Tester`); a created passkey is kept and answers later assertions
  for its relying party, and `getPasskey` with none rejects `E_UNAVAILABLE`.
- `{"command": "testAuthorization"}` replies `authorization`: that state, `requests` shown, `pending`, `lastRequest`
  (`operation`, the `window` identifier it was presented over, scopes or relying party) and `passkeys`.

Flows use them as `simulateAuthorization` and `assertSimulatedAuthorization` ([e2e-flow-commands.md](e2e-flow-commands.md)).
`tests/authentication.native.mm` checks the error and entitlement mappings, that an unentitled real request stops before
a controller, and the simulation. The real sheets are checked only by the manual flow
`e2e/flows/authentication/sign-in-real.yaml`, on a team-signed build.

## Platforms

| Platform | Availability |
| --- | --- |
| macOS | Available in team-signed builds with the entitlements (macOS 14 and later; `excludeCredentials` macOS 15). |
| Windows | Both availability functions report `unsupported-platform`; the other functions reject `E_UNSUPPORTED_PLATFORM` after validating their arguments. Passkeys through WebAuthn (Windows Hello) and a decision for Sign in with Apple are tracked in #423. |

The Kitchen Sink's Sign in with Apple and passkeys screen (`spark-ks://authentication/sign-in`) shows availability,
signs in, checks the credential state, creates and uses a passkey, and cancels; its flows are in
`e2e/flows/authentication/`.
