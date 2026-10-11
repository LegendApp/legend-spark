# Camera

Spark includes VisionCamera 5.2.3, Nitro Image 0.15.2, and shared Nitro Modules
0.37.0 as pinned npm dependencies. Installing Spark installs these libraries;
their implementations remain ordinary package-manager dependencies. Spark ships
the compatibility patches, not extracted copies of those libraries.

```tsx
import {
  Camera, useCameraDevices, useCameraPermission, usePhotoOutput,
} from "@legendapp/spark/camera";

import { Button } from "react-native";

function PhotoCamera() {
  const devices = useCameraDevices();
  const { hasPermission, requestPermission } = useCameraPermission();
  const photoOutput = usePhotoOutput({ containerFormat: "jpeg" });
  if (!hasPermission) return <Button title="Allow camera" onPress={() => void requestPermission()} />;
  return devices[0] ? <Camera device={devices[0]} isActive outputs={[photoOutput]} /> : null;
}
```

`/camera` is an explicit VisionCamera integration: its component, hooks, and
types retain upstream semantics. It exports the common device, permission,
photo, video, and session APIs, plus `NitroImage` and its `Image` type for displaying
captured photos. Advanced upstream APIs remain available from
`react-native-vision-camera` directly. Spark does not promise backend-independent
camera contracts.

Imperative callers use the same `VisionCamera` factory without mounting React:

```ts
import { VisionCamera } from "@legendapp/spark/camera";

const granted = await VisionCamera.requestCameraPermission();
const factory = await VisionCamera.createDeviceFactory();
const devices = factory.cameraDevices;
// Owners dispose native resources using VisionCamera's documented lifetimes.
factory.dispose();
```

## Automatic patches

Spark's install hook applies the checked-in Nitro, Nitro Image, and VisionCamera
patches. Native preparation verifies/applies them again before native discovery,
autolinking, and compatibility signatures. This covers disabled install scripts,
reinstalls, and interrupted preparation without a camera install command.
Patching is local, idempotent, and version-specific. Conflicting sources or
versions fail with an actionable error. Atomic file replacement preserves
package-manager cache hardlinks. Production selection can prune the camera when
unused; selecting VisionCamera retains Nitro Image and Nitro Modules.

Camera integration does not replace the existing desktop SDK preparation for
Runtimes, Windows Nitro, SQLite, and WebView.

## Platforms and permissions

iOS and Android use the upstream implementations. Spark's macOS patches add
AppKit support on macOS 14+. Windows and web are unsupported. The existing
[macOS prototype evidence and limits](camera-prototype.md) remain applicable;
this delivery change does not establish live capture or mobile acceptance.

Applications supply meaningful camera and microphone usage descriptions in
their native configuration. On macOS, set `NSCameraUsageDescription` and, when
recording audio, `NSMicrophoneUsageDescription` under `macos.infoPlist` in
`desktop.config.json`. Configure the corresponding iOS usage descriptions and
Android manifest permissions through your normal Expo/native configuration.
The framework does not request permissions merely because it is installed.
