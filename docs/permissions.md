# Privacy permissions

`@legendapp/spark/permissions` reads and requests the privacy permissions macOS asks a person to grant
(Transparency, Consent and Control), reports changes, and opens the matching pane of System Settings.

```ts
import { addPermissionListener, getPermissionStatus, openPermissionSettings, requestPermission } from '@legendapp/spark/permissions';

const camera = await getPermissionStatus('camera');
if (camera.status === 'undetermined') await requestPermission('camera');   // from a button the person pressed
else if (!camera.granted && !camera.canAskAgain) await openPermissionSettings('camera');

const finder = await getPermissionStatus('automation', { target: 'com.apple.finder' });

const registration = await addPermissionListener(({ kind, permission }) => refresh(kind, permission), { kinds: ['camera', 'microphone'] });
await registration.remove();
```

## Kinds and states

Each call resolves a `PermissionResponse`: `status` (`granted`, `denied`, `undetermined` or `unknown`),
`granted`, `canAskAgain` (whether `requestPermission` can still show the system prompt; `null` when macOS
does not say) and `macos.authorization`, the native state.

| Kind | Status from | Request | Authorizations | Info.plist key a request needs |
| --- | --- | --- | --- | --- |
| `camera` | `AVCaptureDevice authorizationStatusForMediaType:` (video) | `requestAccessForMediaType:` | notDetermined, restricted, denied, authorized | `NSCameraUsageDescription` |
| `microphone` | the same, audio | the same | notDetermined, restricted, denied, authorized | `NSMicrophoneUsageDescription` |
| `screenRecording` | `CGPreflightScreenCaptureAccess` | `CGRequestScreenCaptureAccess` | notGranted, authorized | none |
| `accessibility` | `AXIsProcessTrusted` | `AXIsProcessTrustedWithOptions` with the prompt option | notGranted, authorized | none |
| `inputMonitoring` | `IOHIDCheckAccess(kIOHIDRequestTypeListenEvent)` | `IOHIDRequestAccess` | notDetermined, denied, authorized | none |
| `automation` | `AEDeterminePermissionToAutomateTarget` without asking, for `target` | the same, asking | notDetermined, denied, authorized | `NSAppleEventsUsageDescription` |
| `contacts` | `CNContactStore authorizationStatusForEntityType:` | `requestAccessForEntityType:` | notDetermined, restricted, denied, authorized | `NSContactsUsageDescription` |
| `calendar` | `EKEventStore authorizationStatusForEntityType:` (events) | `requestFullAccessToEventsWithCompletion:` | notDetermined, restricted, denied, authorized (full access), writeOnly | `NSCalendarsFullAccessUsageDescription` |
| `photos` | `PHPhotoLibrary authorizationStatusForAccessLevel:` (read/write) | `requestAuthorizationForAccessLevel:handler:` | notDetermined, restricted, denied, authorized | `NSPhotoLibraryUsageDescription` |
| `location` | `CLLocationManager.authorizationStatus` | `requestWhenInUseAuthorization`, answered through the delegate | notDetermined, restricted, denied, authorized | `NSLocationWhenInUseUsageDescription` (the key `requestWhenInUseAuthorization` documents; the Kitchen Sink also sets the older macOS key `NSLocationUsageDescription`) |
| `speechRecognition` | `SFSpeechRecognizer authorizationStatus` | `requestAuthorization:` | notDetermined, restricted, denied, authorized | `NSSpeechRecognitionUsageDescription` |

Mapping to `status`: authorized is `granted`; notDetermined is `undetermined`; restricted (parental
controls or a device management profile), denied, writeOnly and notGranted are `denied`. A raw value this
SDK does not know (a newer macOS) is `unknown` with `canAskAgain: null`, never guessed. `canAskAgain` is
`true` for notDetermined and writeOnly (asking again offers full calendar access), `null` for notGranted
and unknown, `false` otherwise.

Screen recording and accessibility are reported only as granted or not: macOS does not say whether the
person was asked. Their requests resolve at once with the current state; the person answers in System
Settings, and the change arrives as an event when the app becomes active again. macOS ends an app when its
screen recording permission changes. Automation is per target app: pass its bundle identifier as `target`
(required for automation, rejected for the rest). The target must be running, else `E_NOT_FOUND`.

## Requests

Call `requestPermission` from a person's action. When the state is already decided it resolves at once,
without a prompt. Concurrent requests for the same kind (and target) share one prompt.

- A request without the usage description macOS requires rejects `E_UNAVAILABLE` naming the key. macOS
  would end the app (camera, microphone, contacts, photos) or ignore the request (the others).
- A location request while Location Services are off rejects `E_UNAVAILABLE`.
- Core Location answers a location request only through its delegate, and macOS can drop the request without one
  (a missing entitlement under the hardened runtime). So a location request also settles when the app becomes
  active with the status decided, or after 120 seconds with the current status (`undetermined` if nobody
  answered); a later request then starts afresh.
- An app signed with the hardened runtime also needs the matching entitlement
  (`com.apple.security.device.camera`, `device.audio-input`, `personal-information.addressbook`,
  `personal-information.calendars`, `personal-information.photos-library`, `personal-information.location`,
  `automation.apple-events`); without it macOS answers `denied` without a prompt. Sandboxed apps need the
  same entitlements.

Threading: status reads and requests start on the main thread, except automation (Apple events reach the
target app; `AEDeterminePermissionToAutomateTarget` blocks until the person answers), input monitoring
requests and the Location Services check, which run on a background queue. System completion handlers run on
arbitrary queues; each call settles exactly once, on the main thread. The location manager lives on the main
thread, whose run loop delivers its delegate calls.

## Change events

`addPermissionListener(listener, { kinds?, onError? })` resolves once native observation runs. Native code
re-reads every kind except automation after a request finishes, when the app becomes active (the person may
have changed System Settings meanwhile) and when Core Location reports an authorization change, and emits
when something differs. Observation runs only while a listener holds it. Each event carries `kind`,
`permission` and `previous`.

## System Settings

`openPermissionSettings(kind)` opens `x-apple.systempreferences:com.apple.preference.security?<anchor>`:
`Privacy_Camera`, `Privacy_Microphone`, `Privacy_ScreenCapture`, `Privacy_Accessibility`,
`Privacy_ListenEvent`, `Privacy_Automation`, `Privacy_Contacts`, `Privacy_Calendars`, `Privacy_Photos`,
`Privacy_LocationServices`. It rejects `E_NATIVE` when macOS does not accept the link.

## Testing

In driver mode (the in-app test driver, [test-driver.md](test-driver.md)) every call goes to simulated
state kept in the app's memory: no TCC API is called, no prompt appears and System Settings never opens.
Each kind starts at notDetermined (notGranted for screen recording and accessibility). Two driver commands,
built only with the driver:

- `{"command": "simulatePermission", "kind", "authorization"?, "answer"?: "allow" | "deny" | "ignore" | null}` sets a
  kind's authorization (any authorization of that kind, `unknown` included) and the answer its simulated
  prompt gets. A simulated prompt appears whenever macOS could show one (notDetermined, writeOnly,
  notGranted); without an answer the request rejects `E_UNAVAILABLE`. `ignore` is a prompt that never answers, as when
  macOS drops a request: the request settles as a real location request does, on activation or after the timeout. Changing the authorization reports a
  change to listeners.
- `{"command": "testPermission", "kind"}` replies `permission`: `authorization`, `answer`, and the counts of
  `requests`, `prompts` shown and `settingsOpened`.

Flows use them as `simulatePermission` and `assertSimulatedPermission`
([e2e-flow-commands.md](e2e-flow-commands.md)). Requests still check the Info.plist usage descriptions in
driver mode. Real prompts are checked only by the manual flow `e2e/flows/system-integration/permissions-real.yaml`.

## Platforms

| Platform | Availability |
| --- | --- |
| macOS | Available. |
| Windows | `getPermissionAvailability()` reports `unsupported-platform`; the other functions reject `E_UNSUPPORTED_PLATFORM` after validating their arguments. Tracked in #378. |

The Kitchen Sink's Privacy permissions screen (`spark-ks://system-integration/permissions`) shows every
kind's state, requests, opens settings and logs change events; its flows are in `e2e/flows/system-integration/`.
