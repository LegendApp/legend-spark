# Privileged helpers, the admin prompt and XPC

`@legendapp/spark/privileged-helper` runs work as root through a helper the app ships: a launchd daemon registered
with `SMAppService`, the system admin prompt for an administrator's consent, and XPC between the app and the helper.
macOS only; Windows reports `unsupported-platform` (#440).

```ts
import {
  getPrivilegedHelperAvailability, getPrivilegedHelperStatus, registerPrivilegedHelper, openPrivilegedHelperSettings,
  requestAdminAuthorization, sendPrivilegedHelperMessage,
} from "@legendapp/spark/privileged-helper";

if (getPrivilegedHelperAvailability().available) {
  let status = await getPrivilegedHelperStatus("disk-tool");
  if (status === "notRegistered") status = await registerPrivilegedHelper("disk-tool");
  if (status === "requiresApproval") await openPrivilegedHelperSettings(); // the person allows it in Login Items
  if (status === "enabled") {
    const prompt = await requestAdminAuthorization({ prompt: "Disk Tool needs to repair permissions." });
    if (prompt.type === "authorized") {
      try { await sendPrivilegedHelperMessage("disk-tool", { command: "repair", volume: "/" }, { authorization: prompt.authorization }); }
      finally { await prompt.authorization.close(); }
    }
  }
}
```

## API

| Function | Result |
|---|---|
| `getPrivilegedHelperAvailability()` | `{ available: true }`, or `false` with `unsigned` (no team signature), `missing-module` or `unsupported-platform`. Synchronous. |
| `getPrivilegedHelperStatus(name)` | `notRegistered`, `enabled`, `requiresApproval` (registered, waiting for the person in Login Items) or `notFound` (the app embeds no plist for it). Never prompts. |
| `registerPrivilegedHelper(name)` | Registers the daemon; resolves its status afterwards, `requiresApproval` the first time. Registering again changes nothing. |
| `unregisterPrivilegedHelper(name)` | Removes the registration, stopping the daemon. Resolves when it is not registered, including when it was not. |
| `openPrivilegedHelperSettings()` | Opens System Settings > General > Login Items. |
| `requestAdminAuthorization({ prompt })` | Shows the admin prompt for `system.privilege.admin` with the app's reason. Resolves `{ type: "authorized", authorization }` or `{ type: "cancel" }`. One prompt at a time (`E_BUSY`). |
| `sendPrivilegedHelperMessage(name, message, { authorization?, timeoutMs?, signal? })` | Sends a JSON value (at most 1 MiB) over XPC and resolves the helper's JSON reply. `timeoutMs` defaults to 30000; abort rejects `E_ABORTED`. After a timeout or abort the helper may still act on the message. |

`name` is the helper's name in `helpers` (1–64 letters, digits, `-`, `_`). The helper's launchd label and Mach service
are `<bundle identifier>.<name>`, which is also its signing identifier. An `AdminAuthorization` holds the granted rights until `close()` (concurrent closes
share completion) or until the JavaScript runtime is torn down (a prompt answered after that has its rights destroyed
at once). Its rights lapse after `system.privilege.admin`'s timeout in the authorization database (300 seconds on
current macOS); `expiresAt` reports when (Unix ms, `null` when the right sets none), and a message sent with lapsed
rights rejects `authorizationExpired`, so the app can prompt again. It is passed by handle and its native identifier is
never exposed. The app itself never runs anything with it: AuthorizationExecuteWithPrivileges is deprecated and is not
used. The rights travel to the helper, which checks them.

Failures the system or the helper reports reject a `PrivilegedHelperError` (a `SparkError` with `reason`):

| Reason | Code | Meaning |
|---|---|---|
| `unsigned` | `E_UNAVAILABLE` | The app is unsigned or ad-hoc signed; nothing reached ServiceManagement or XPC. |
| `notFound` | `E_NOT_FOUND` | The app embeds no plist for the helper. |
| `notRegistered`, `requiresApproval` | `E_UNAVAILABLE`, `E_PERMISSION_DENIED` | A message to a helper that is not `enabled`. |
| `invalidSignature` | `E_UNAVAILABLE` | SMAppService rejected the helper's signature, or the helper on the Mach service is not signed by the app's team. |
| `invalidPlist`, `serviceUnavailable` | `E_INVALID_DATA`, `E_UNAVAILABLE` | ServiceManagement's answers. |
| `denied`, `notInteractive` | `E_PERMISSION_DENIED`, `E_UNAVAILABLE` | The admin prompt was not answered by an administrator, or cannot be shown in this session. |
| `authorizationExpired` | `E_PERMISSION_DENIED` | The admin rights sent with a message lapsed (past `expiresAt`, or the helper found they no longer hold). Prompt again. |
| `connectionInvalid`, `connectionInterrupted` | `E_CLOSED` | The helper is not running, refused the connection (as it does for a client that is not the app) or exited with the request in flight. |
| `helperFailed` | the helper's code | The helper's handler replied with an error. |
| `unknown` | `E_NATIVE` | An error the SDK does not name; the system's message is kept. |

`E_TIMEOUT`, `E_ABORTED`, `E_BUSY`, `E_CLOSED` (a closed authorization) and `E_INVALID_ARGUMENT` reject a plain
`SparkError`. There is no hook: these are commands an app calls from its own service. SMAppService sends no event when
the person approves a helper, so query the status again when the app becomes active.

## Configuration

The helper is an executable the app supplies, declared in `helpers` like any [helper process](sidecars.md), and opted
in to running as a daemon with `macos.privilegedHelpers`:

```json
{
  "helpers": { "disk-tool": "helpers/disk-tool/build/disk-tool" },
  "macos": { "bundleIdentifier": "com.example.disktool", "privilegedHelpers": ["disk-tool"] }
}
```

`spark build` copies the helper into `Contents/Helpers` and, only for helpers listed in `macos.privilegedHelpers`,
writes `Contents/Library/LaunchDaemons/<bundle identifier>.<name>.plist` with its `Label`, `BundleProgram`, the Mach
service and `AssociatedBundleIdentifiers` (so Login Items shows the app's name and icon). An app without the option
gets no plist and no daemon. `spark build` and `spark package` sign the helper with the app's team and the hardened
runtime, like every executable in the bundle, and with its launchd label as signing identifier (`spark package`
checks it).

### Signing

SMAppService registers a daemon only for an app signed by a team (Developer ID for distribution, Apple Development
while developing), and each side of the connection checks the other's team. A development build signed ad hoc
reports `unsigned`. The helper adds no entitlements.

## Writing the helper

Spark does not compile helpers. Compile `helper/SparkPrivilegedHelperService.m` from `@legendapp/spark-privileged-helper`
into the helper (Foundation and Security), and serve from `main`:

```objc
#import "SparkPrivilegedHelperService.h"

int main(void) {
  return SparkPrivilegedHelperMain(@"com.example.disktool.disk-tool", @"com.example.disktool",
    ^(id message, BOOL authorized, SparkPrivilegedHelperReply reply) {
      if (!authorized) { reply(nil, @"E_PERMISSION_DENIED", @"Administrator rights are required"); return; }
      reply(@{ @"repaired": @YES }, nil, nil);
    });
}
```

`SparkPrivilegedHelperMain(machServiceName, clientIdentifier, handler)` listens on the Mach service for clients signed
by the helper's own team with the signing identifier `clientIdentifier` (the app's bundle identifier), and refuses to
start (exit 1, logged) when the helper is unsigned or ad-hoc signed. The handler runs on one serial queue with the
decoded JSON message and whether the app sent admin rights that hold; call `reply` exactly once with a JSON value, or
with a Spark error code and message. The Kitchen Sink's helper (`examples/kitchen-sink/helpers/privileged-helper`)
is a complete example.

## Threat model

The helper runs as root, so it is the most valuable target in the app. What Spark guarantees, and what stays the
helper author's job:

- **Who can talk to the helper.** The helper's listener has a code signing requirement (`setConnectionCodeSigningRequirement:`,
  checked by the system for every message): `anchor apple generic`, the helper's own team, and the app's signing
  identifier. When the helper is Developer ID signed it also requires a Developer ID leaf certificate
  (`certificate leaf[field.1.2.840.113635.100.6.1.13]`), so a development build of the same team, signed with an Apple
  Development certificate, is refused by a distributed helper. When a client connects, the helper also reads its
  signature through the connection's audit token (`SecCodeCopyGuestWithAttributes` with `kSecGuestAttributeAudit`, not
  the reusable pid) and refuses it unless it runs with the hardened runtime (`kSecCodeSignatureRuntime`) and lacks
  `get-task-allow`, so no debugger or injected library can speak through a debuggable app. NSXPCConnection keeps the
  audit token as a private property; when it cannot be read the connection is refused. Another app, a script, or a
  copy of the app re-signed by anyone else is refused before the handler runs. The requirement is built only from a
  ten-character team and a reverse-DNS identifier, so neither can inject requirement syntax. A helper without a team
  never serves.
- **Who the app talks to.** The app connects to the Mach service as a privileged launchd job (`NSXPCConnectionPrivileged`:
  only a daemon in the system domain can hold the name) and requires the helper to be signed by the app's team with its
  launchd label as signing identifier, so another helper of the same team cannot stand in for it. NSXPCConnection
  checks a peer when it receives from it, not before sending, so the app's first message on every connection is an empty
  verification; messages and authorizations are sent only after its reply passed the check. The connection's
  interruption handler marks it stale at once, on XPC's queue, and nothing is sent over a stale connection: a helper
  launchd relaunched behind it is verified again first.
- **Administrator consent.** The admin prompt is the system's (SecurityAgent); the app never sees the password. The app
  sends only the authorization's external form. The helper checks that it holds `system.privilege.admin` itself, with
  no flags (no interaction and no extending), so it only confirms rights the prompt already granted and never
  authenticates anyone; it never takes the app's word. The right is the system's `system.privilege.admin`, not an
  app-specific right: its rule (an administrator, a 300-second timeout, not shared) is the system's. Rights that lapsed
  end the request with `authorizationExpired` before the handler runs, never with a silent `authorized: false`. A compromised app that runs as the same
  user can still send any message without rights, so the handler must require `authorized` for anything an
  administrator alone should do, and validate every field of every message.
- **Installation.** The daemon is installed only by `registerPrivilegedHelper`, approved by the person in Login Items
  (which asks for an administrator), and launchd runs only the helper inside the app bundle that registered it, checking
  its signature. `unregisterPrivilegedHelper` removes it.
- **Not covered.** Spark does not sandbox the helper, limit what its handler does, rate-limit messages or protect
  against a malicious administrator or a root process. Keep the handler's commands few and specific: never run a path,
  command line or script the app sends.

## Testing

In a test-driver run (docs/test-driver.md) every call answers from simulated state: SMAppService, Authorization
Services and launchd are never reached, no prompt is shown, no connection is made and nothing runs as root. The
`simulatePrivilegedHelper` flow command sets the signature (it starts from the build's), each helper's status, whether
registering needs approval, the admin prompt's answer and how the simulated helper's connection behaves; the simulated
helper echoes `{ received, authorized, uid: 0 }`, and `expireAuthorizations: true` lapses held rights. `assertSimulatedPrivilegedHelper` checks what reached the simulation.
The Kitchen Sink's flows are in `e2e/flows/processes-ipc/`.

`tests/privileged-helper.native.mm` runs the real XPC path between the app side and the helper side against an
anonymous listener inside the test process, never launchd: round trips, the helper's errors, timeouts and aborts, a
helper that refuses a client of another team and an app that refuses a helper of another team without sending it the
message, and a client without the hardened runtime is refused (the test signs itself ad hoc with it). The real
registration, approval, admin prompt, the helper's check of granted rights as root and the Developer ID requirement
need a team-signed build and a person:
`e2e/flows/processes-ipc/privileged-helper-real.yaml` is a manual flow.
