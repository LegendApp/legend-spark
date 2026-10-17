# The App Sandbox variant

A Mac App Store app runs in the App Sandbox. `spark build --sandbox` makes that variant of a release build, for apps
that declare `macos.sandbox`. It is signed ad hoc for local testing: Mac App Store signing (an Apple Distribution
certificate, a provisioning profile, the `com.apple.application-identifier` and team entitlements), the installer
package and the submission itself are not implemented, and need Apple credentials (see [What is left](#what-is-left)).

## Configuration

```json
{
  "macos": {
    "bundleIdentifier": "com.example.notes",
    "sandbox": {
      "entitlements": {
        "com.apple.security.files.user-selected.read-write": true,
        "com.apple.security.files.bookmarks.app-scope": true,
        "com.apple.security.network.client": true,
        "com.apple.security.print": true
      }
    }
  }
}
```

`macos.sandbox.entitlements` lists the `com.apple.security.*` entitlements the variant needs besides
`com.apple.security.app-sandbox`, which is implied. Other entitlements belong in `macos.entitlements` (both variants
carry them). `macos.sandbox.entitlements` rejects `app-sandbox` and `inherit`, which the build adds itself.

```sh
npx --no-install spark build --sandbox
```

The variant is a release build of its own, in `products/macos-<arch>/release-sandbox/` under `.spark` (the direct build
stays in `release/`):

- **Every process is sandboxed.** The main executable is signed with `app-sandbox`, the app's entitlements and
  `macos.sandbox.entitlements`. Every other process in the bundle (helpers, sidecars, XPC services) is signed with exactly
  `app-sandbox` and `inherit`, as Apple requires, so it runs in the app's sandbox. The direct build carries no sandbox
  entitlement.
- **No Sparkle.** `@legendapp/spark-updates` is left out of the native build, and Sparkle's `SU*` keys out of
  `Info.plist`: the App Store updates the app. `getUpdateStatus()` reports `sandboxed`, and update commands reject
  `E_UNAVAILABLE`.
- **No privileged helpers.** A sandboxed app cannot install a launch daemon or gain admin rights, so
  `macos.privilegedHelpers` plists are not written. `getPrivilegedHelperAvailability()` reports `sandboxed`, and
  registering, messaging and the admin prompt reject `PrivilegedHelperError` `E_UNAVAILABLE` `sandboxed` before
  ServiceManagement or Authorization Services is reached.

`getAppContext().sandboxed` tells JavaScript whether the process runs in the App Sandbox.

## What works in the sandbox

What each API does in the Kitchen Sink's sandbox variant (`bun run build:sandbox` in `examples/kitchen-sink`), with the
evidence. "Flow" means an `e2e/flows/packaging-distribution/sandbox-*` flow that the gate runs against the variant;
"native test" means `tests/app-sandbox-native.test.ts`, which signs a probe with the sandbox entitlements and runs it.

| API | In the sandbox | Evidence |
|---|---|---|
| App state: settings, recent documents, logs, crash reports | Works, in the container | Flow `sandbox-state`; the logging, crash reporting and plugin flows pass against the variant |
| Files outside the container (`@legendapp/spark/file-system` paths) | Fails `E_PERMISSION_DENIED` until the person grants the file (open or save panel, `files.user-selected.read-write`; a drop; opening it with the app); a bookmark keeps the grant | Native test (listing a folder outside the container is denied); the PDF and diagnostics export flows, which write to a temporary folder outside the container, get `E_PERMISSION_DENIED` against the variant |
| Security-scoped bookmarks | Work with `files.bookmarks.app-scope`; without it they reject `E_UNAVAILABLE` | `tests/file-integration.test.ts` (sandboxed runs) |
| Full Disk Access status | `indeterminate` unless a probe succeeds | `tests/file-integration.test.ts` |
| File versions (`@legendapp/spark/documents` versions) | Work for a document in the container: listing, adding, reading (`readDocumentVersionText`) and restoring. On macOS 27 a version's file in the revision store is readable only while its `NSFileVersion` lives (macOS 26 still allows it), so versions are read by id and have no path ([#462](https://github.com/LegendApp/legend-spark/issues/462)) | Flow `document-model/documents-versions-sandbox`; `tests/document-files-native.test.ts` (sandboxed run) |
| Opening a file the app was not given by macOS | Fails: the test driver's `openFile` delivers a path without the sandbox extension Finder's open would carry | `documents-open-file` flow against the variant (passes against the direct build); Finder's open not tested; [#463](https://github.com/LegendApp/legend-spark/issues/463) |
| Child processes (`@legendapp/spark/processes`) | Work; every child inherits the sandbox: the container is its home, and it is denied what the app is denied | Native test |
| Outgoing network connections | Work with `network.client`; `EPERM` without | Native test |
| Listening sockets | Fail without `com.apple.security.network.server` | Native test |
| Global shortcuts (`@legendapp/spark/global-shortcuts`) | Work (Carbon hot keys) | Native test |
| Apple events (automation permission) | Fail: the sandbox answers `procNotFound` (-600), even with `automation.apple-events`, until a temporary exception names the target app | Native test; [#464](https://github.com/LegendApp/legend-spark/issues/464) |
| Clipboard | Works | The clipboard flows pass against the variant (they use the driver's private pasteboard, not the person's) |
| Drag and drop | Drags inside the app work; promised files written to a folder outside the container fail (the driver's drop gives no grant; Finder's drop not tested) | The drag flows pass against the variant except `promised-files` |
| Printing and PDF export | Printing reports available (the variant has `com.apple.security.print`); PDF export to a path outside the container fails `E_PERMISSION_DENIED`; the print and page setup panels were not tested (their flows need a black-box backend) | `printing-availability` passes and `printing-pdf-export-driver` fails against the variant |
| Privileged helpers | Unavailable: `sandboxed` | Flow `sandbox-availability`; `tests/privileged-helper.native.mm` |
| App updates (Sparkle) | Left out: `sandboxed` | Flows `sandbox-availability`, `sandbox-exclusions` |
| Simulated system services: permissions, biometrics, Sign in with Apple and passkeys, capture, speech, sharing, Spotlight, App Intents, dock, attention, system events | The driver's simulations behave as in the direct build | Their flows pass against the variant; the real services were not reached |
| Login items (`getLoginItemStatus`, `setLaunchAtLogin`) | Not tested: registering would add a real login item; Apple documents `SMAppService.mainApp` for sandboxed apps | — |
| Accessibility trust, real permission prompts, the real keychain, Finder drops, open and save panels | Not tested: they need TCC permissions, a person or the real desktop | — |
| The test driver | Works: the socket is linked from the run directory, which the clone may reach through one exception | Every `variant: sandbox` flow |

## Testing

The release gate tests the variant named by `build.macos.sandbox` in `e2e/gate.yaml`: `variant: sandbox` flows run
against it ([flows](e2e-flows.md#a-flow)). The driver runs a clone of it whose state is its own container,
`~/Library/Containers/<bundle id>.driver`, never the app's ([app state](e2e-flows.md#app-state),
[sandboxed apps](test-driver.md#sandboxed-apps)). `assertSandboxVariant` checks the bundle and `assertEntitlements` with
`sandbox: true` its entitlements ([security audits](e2e-flows.md#security-audits)).

```sh
cd examples/kitchen-sink && bun run build:sandbox && cd ../..
bun run e2e:run e2e/flows/packaging-distribution --backend driver \
  --app examples/kitchen-sink/.spark/platforms/macos/products/macos-arm64/release-sandbox/KitchenSink.app
```

## What is left

- **Mac App Store signing and submission.** An Apple Distribution identity and a provisioning profile embedded as
  `Contents/embedded.provisionprofile`, `com.apple.application-identifier` and `com.apple.developer.team-identifier`
  entitlements, a `productbuild` installer signed with a Mac Installer Distribution identity, and validation and upload
  with Apple's tools (TestFlight, App Review). They need Apple credentials; `spark package` does not produce them
  ([#465](https://github.com/LegendApp/legend-spark/issues/465)). `e2e/flows/packaging-distribution/sandbox-app-store.yaml`
  lists the steps a person signs off.
- **Apple events.** A sandboxed app reaches another app only through a temporary exception or scripting targets that
  name it; Spark has no configuration for them yet ([#464](https://github.com/LegendApp/legend-spark/issues/464)).
- **Grants in driver runs.** The driver cannot yet give the app the access a person's open, drop or save would, so flows
  that hand it paths outside the container fail against the variant
  ([#463](https://github.com/LegendApp/legend-spark/issues/463)).
- **The other flows.** The gate runs only `variant: sandbox` flows against the variant. On 2026-10-13, 102 runs of the
  driver flows of 14 areas against the Kitchen Sink's variant passed 81; besides the expected privileged helper
  answers, the failures caused by the sandbox were the file versions (since fixed, #462), `openFile`, promised-file
  drop and export rows above, and the rest also fail against the direct build. Running such flows in the gate is
  [#466](https://github.com/LegendApp/legend-spark/issues/466).
