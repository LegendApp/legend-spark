# Capture

`@legendapp/spark/capture` records the microphone, runs the camera with a live preview and photos (AVFoundation), and
captures the screen (ScreenCaptureKit).

```ts
import { CameraView, captureScreenshot, startAudioRecording, startCamera } from '@legendapp/spark/capture';
import { requestPermission } from '@legendapp/spark/permissions';

// From a person's action: capture never prompts by itself.
await requestPermission('microphone');
const recording = await startAudioRecording({ onLevel: ({ average }) => meter(average) });
const outcome = await recording.stop(); // { status: 'recorded', uri, duration, size } | { status: 'cancelled' }

await requestPermission('camera');
const camera = await startCamera();
// <CameraView session={camera} style={{ width: 320, height: 180 }} />
const photo = await camera.takePhoto(); // { uri, width, height }, a JPEG
await camera.stop();

await requestPermission('screenRecording');
const screenshot = await captureScreenshot(); // the main display, as a PNG
```

## Permissions and devices

Capture never prompts. Every call that would reach a device checks its permission first, without asking, and rejects
`E_PERMISSION_DENIED` unless it is granted: `microphone` for audio recording, `camera` for the camera, and
`screenRecording` for screen sources, screenshots and screen recordings ([permissions.md](permissions.md)). Request them
from a person's action first.

`getCaptureAvailability(kind)` says whether `camera`, `microphone` or `screen` capture can work in this build:
`unsupported-platform` off macOS, and `missing-entitlement` for the camera or microphone in a hardened-runtime build
without its entitlement (below). It neither prompts nor opens a device; permissions and connected devices are separate.

### Entitlements

Under the hardened runtime (every distributed build) macOS lets an app use the camera and microphone only with the
entitlements `com.apple.security.device.camera` and `com.apple.security.device.audio-input`. Spark adds them only when
the app asks, in its config:

```json
{
  "macos": {
    "capture": { "camera": true, "microphone": true },
    "infoPlist": {
      "NSCameraUsageDescription": "Shows you to the people in your call.",
      "NSMicrophoneUsageDescription": "Records your voice notes."
    }
  }
}
```

Each needs its usage description in `macos.infoPlist`, or configuration fails ([configuration.md](configuration.md)).
Speech recognition listens to the microphone, so it needs `microphone` too ([speech.md](speech.md)). A build with the
hardened runtime and without an entitlement reports `missing-entitlement` (read from its own signature with
`SecTaskCopyValueForEntitlement`), and starting that device rejects `E_UNAVAILABLE` before anything opens. A development
build without the hardened runtime needs neither. Screen capture needs no entitlement.

`getCaptureDevices(kind)` lists the connected cameras or microphones (`camera` or `microphone`): `id` (stable while
connected), `name`, `kind` and `default`, the one macOS uses unless another is chosen. It neither prompts nor opens a
device. A `deviceId` that is not connected rejects `E_NOT_FOUND`; with none connected, starting rejects `E_UNAVAILABLE`.

One session of each kind runs at a time per app: a second audio recording, camera or screen recording rejects `E_BUSY`.
When a JavaScript runtime reloads or closes, the sessions it started are cancelled; when the app quits, recordings in
progress are stopped and their files finished first. A camera or microphone that another app interrupts ends its
session `E_UNAVAILABLE`. Output goes to files: `uri` is an
absolute path or `file:` URL with the format's extension, in an existing directory, and not an existing file
(`E_ALREADY_EXISTS`); without it, a new file in the temporary directory.

## Microphone

`startAudioRecording(options?)` records AAC to an `.m4a` file and resolves a session once recording runs. Options:
`deviceId`, `uri`, `onLevel` (`{ average, peak }` in dBFS, ten times a second) and `signal` (aborting cancels).

A recording session's `result` settles once: `recorded` with `uri` (an absolute path), `duration` (seconds) and `size`
(bytes), or `cancelled`. `stop()` stops and resolves it; `cancel()` stops and deletes the file. If the microphone is
unplugged or fails, `result` rejects (`E_UNAVAILABLE`, or `E_NATIVE`) and the partial file is deleted.

## Camera

`startCamera(options?)` (`deviceId`, `signal`) starts a camera at its high-quality preset and resolves a session once it
runs. `<CameraView session={camera} contentFit? />` shows its live preview (`contain`, the default, `cover` or `fill`);
several views may show one camera, and `session={null}` shows nothing. `takePhoto({ uri? })` writes a JPEG and resolves
`{ uri, width, height }`; one photo is taken at a time (`E_BUSY`). `getStatus()` gives the frame size. `stop()` stops it;
`ended` resolves then, or rejects `E_UNAVAILABLE` when the camera goes away.

## Screen

`getScreenCaptureSources()` lists `displays` (`id`, `width`, `height` in points) and on-screen `windows` (`id`, `title`,
`app`, `width`, `height`). `captureScreenshot(options?)` writes a PNG of a display (`display`, default the main one) or a
window (`window`) at its pixel size, with the cursor unless `showsCursor: false`; an unknown id rejects `E_NOT_FOUND`.

`startScreenRecording(options?)` records the same sources to a QuickTime movie (`.mov`) through `SCRecordingOutput`, so it
needs macOS 15: `getScreenRecordingAvailability()` reports `host-restriction` before, and starting rejects `E_UNAVAILABLE`.
Its session works like an audio recording's. macOS shows its recording indicator meanwhile; stopping from it rejects
`result` `E_ABORTED`. From macOS 15 macOS also asks the person, from time to time, whether to keep allowing the app to
record the screen (the "continue to allow" alert); the app cannot suppress it, and declining it revokes the
`screenRecording` permission, so later captures reject `E_PERMISSION_DENIED`.

## Testing

In driver mode (the in-app test driver, [test-driver.md](test-driver.md)) capture is simulated in the app's memory and
never opens an `AVCaptureDevice`, ScreenCaptureKit or TCC: a "Simulated Camera" and a "Simulated Microphone"; synthetic
levels; synthetic camera frames (color bars and a moving white bar, 1280×720 at 15 frames a second) shown by
`CameraView` and written as photos; one 1440×900 display and one 800×600 window, captured as synthetic images and
recorded as a movie of synthetic frames. Recordings, photos and screenshots are real files. Permissions are still
checked natively, against the permissions package's own simulation ([permissions.md](permissions.md#testing)).
Entitlements start as the build's real state and can be simulated; screen recording availability stays real. Two driver commands, built only with the driver (`#if SPARK_TEST_DRIVER`):

- `{"command": "simulateCapture", "cameras"?, "microphones"?, "cameraEntitled"?, "microphoneEntitled"?}` connects or
  disconnects the simulated camera and microphone (disconnecting one ends its running session with `E_UNAVAILABLE`, as
  unplugging it would), and sets whether the build has their entitlements.
- `{"command": "testCapture"}` replies `capture`: the connected devices, whether an audio recording (`recordingAudio`),
  the camera (`cameraRunning`) and a screen recording (`recordingScreen`) run, and the counts of synthetic `frames` and
  `levels`, `photos`, `screenshots` and finished `recordings`.

Flows use them as `simulateCapture` and `assertSimulatedCapture` ([e2e-flow-commands.md](e2e-flow-commands.md)).
`tests/media.native.mm` checks validation, output files and the simulation; a real microphone, camera and screen are
checked only by the manual flow `e2e/flows/media/capture-real.yaml`.

## Platforms

| Platform | Availability |
| --- | --- |
| macOS | Available (macOS 14 and later); screen recording needs macOS 15; the camera and microphone need `macos.capture` in hardened-runtime builds. |
| Windows | `getCaptureAvailability()` reports `unsupported-platform` and `getScreenRecordingAvailability()` resolves it; the other functions, and `CameraView`, reject or throw `E_UNSUPPORTED_PLATFORM` after validating their arguments. Tracked in #425. |

The Kitchen Sink's Capture screen (`spark-ks://media/capture`) records the microphone with levels, runs the camera with
its preview and photos, and lists, screenshots and records the screen; its flows are in `e2e/flows/media/`.
