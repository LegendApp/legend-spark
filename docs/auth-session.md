# Browser authentication sessions

`@legendapp/spark/auth-session` supplies browser launch and callback transport. OAuth
request construction, PKCE, code exchange, refresh, token validation and storage
remain in your authentication library/application. It does not bundle Node or
embed a login WebView. Native browser authorization follows the external-browser
approach described in [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html).

```ts
import { createAuthSession } from '@legendapp/spark/auth-session';

// Desktop: binds 127.0.0.1 on an available port before opening the browser.
const session = await createAuthSession({ timeoutMs: 120_000 });
try {
  // Use your OAuth library to construct the request, including PKCE S256.
  const url = await buildAuthorizationURL({
    redirectUri: session.redirectUri,
    state: session.state,
  });
  const result = await session.open(url);
  if (result.type === 'success') {
    // Parse the provider response and validate/exchange the code with your library.
    await handleAuthorizationResponse(result.url);
  }
} finally {
  await session.dismiss();
}
```

Preparing first makes the actual redirect URI available to the OAuth library.
The authorization URL must contain exactly one `state`, matching the session.
If it contains `redirect_uri`, that must match too. State is 32 OS-generated random
bytes encoded as hex. A matching callback means transport succeeded; it may still
contain a provider error. `success` does not mean the user is signed in.

The returned URI is ephemeral. Your provider must allow loopback redirects with
an assigned port; providers that require a fixed port can use
`createAuthSession({ redirectUri: 'http://127.0.0.1:48080/auth/callback' })`.
Port conflicts reject without taking over another listener. Alternatively supply
a registered app URI such as `com.example.app://auth/callback`. Register that
scheme in application configuration and with the provider; preparation does not
modify OS associations. Desktop claimed-HTTPS callbacks and IPv6 loopback are not
implemented in this version.

Only one session per JS runtime may be active. The timeout is measured from the
start of preparation (default two minutes, maximum ten). Native setup must settle
before creation returns; an already expired session never launches the browser.
Pass an `AbortSignal` for cancellation or call `dismiss()`. Results are `success`
(with URL), `cancel`, `dismiss`, or `timeout`; transport/launch failures reject.
The session can be opened once. Errors use Spark error codes: invalid inputs are
`E_INVALID_ARGUMENT`, conflicting sessions are `E_BUSY`, malformed adapter results
are `E_INVALID_DATA`, and a signal already aborted at creation is `E_ABORTED`.
`dismiss()` stops callbacks immediately, joins concurrent cleanup and can be
retried after failure. Ownership remains reserved until cleanup succeeds. If
creation fails before returning a handle, the next creation retries its cleanup.
 Closing a desktop browser tab is not detectable;
use cancellation or timeout. Cancellation ends callback handling but cannot close
the user's desktop browser tab. An in-flight flow does not survive a JS reload.

The native receiver binds only IPv4 loopback, accepts bounded GET requests for
the exact route and host, and expires after ten minutes even if JS stops polling.
The callback must match scheme, host, port, path and exactly one state. Wrong-state
callbacks are ignored on desktop, leaving the session available for its real
response. Request bodies, general HTTP serving, WebSockets and implicit-grant
fragment callbacks over loopback are outside its contract. Use authorization-code
flows with PKCE. Do not log callback URLs or embed provider client secrets.

## Mobile and web

Install `expo-web-browser@~15.0.10` and `expo-crypto@~15.0.8` alongside the adapter
in SDK 54 applications. Supply an explicit registered `redirectUri`; there is no
mobile/web loopback listener. Browser UI and callback completion delegate to
[Expo WebBrowser](https://docs.expo.dev/versions/v54.0.0/sdk/webbrowser/), and
cryptography delegates to Expo Crypto. On web, prepare before the interaction,
then call `session.open()` directly inside the user's gesture. Call
`maybeCompleteAuthSession()` on the web redirect page. This selected Expo method
returns `{ type: "success" | "failed", message }`; native platforms return the
unsupported `failed` result. Spark does not reexport the upstream object model.

On Android, Spark opens a Custom Tab and owns its link/foreground subscriptions.
Cancellation removes those subscriptions and allows a later session immediately;
Android does not support programmatically closing the tab. iOS/web dismissal
failures reject and retain ownership until `dismiss()` succeeds on retry.

For a universal project, keep Expo native browser/crypto modules in the mobile
configuration and exclude `expo-web-browser` and `expo-crypto` from desktop native
autolinking via `expoByPlatform`. The desktop implementation uses the existing
native links module. Keep Expo Desktop on the repository's pinned beta.

The adapter shares a contract across platforms; it is not a drop-in replacement
for every export in Expo AuthSession and does not alias third-party imports.

## Cryptographic primitives

`getRandomBytesAsync(count)` returns a Uint8Array (1–1024 bytes).
`digestStringAsync('SHA-256', value)` returns lowercase hex, with an input limit
of 262144 JS characters. These use platform cryptography; no custom cryptographic
algorithm is implemented. Authentication libraries remain responsible for the
PKCE verifier/challenge encoding and protocol details.

## Validation

```sh
bun run typecheck
bun run test
bun scripts/test-auth-loopback.ts
bun scripts/test-auth.ts
```

The standalone C++ protocol test verifies malformed methods/routes/hosts, bounded
request size, callback delivery and socket cleanup. The macOS app test opens the
system browser against a local test provider, verifies a real redirect to the
native listener, checks the SHA-256 known vector, and exercises cancellation and
timeout. It uses no real account and does not exchange tokens. Its report lives in
`.spark/auth-tests/report.json`. Kitchen Sink also has a provider-configurable
browser-authentication demonstration that avoids displaying callback credentials.

Windows source is included, but compilation and native browser acceptance remain
pending. Compile `tests/auth-loopback.integration.cpp` with a C++20 Windows toolchain,
then test Kitchen Sink's authentication demo and registered-URI activation. Mobile
and browser adapters have mocked transport/lifecycle coverage, including Android
observer disposal, but have not had device/browser acceptance in this change. Rebuild the desktop runtime before using the new native methods.
