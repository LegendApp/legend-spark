# VisionCamera macOS prototype

This optional kitchen-sink example ports the published VisionCamera 5.2.3 packages to native AppKit on the framework's existing React Native version. It is a working compatibility prototype, not a claim of complete upstream macOS support.

## Compatibility evidence

| Component | Tested version |
| --- | --- |
| React | 19.1.4 |
| React Native | 0.81.6 |
| React Native macOS | 0.81.7, Fabric/New Architecture |
| Nitro Modules / Nitrogen | 0.37.0 with the checked-in patches |
| Nitro Image | 0.15.2 with the checked-in patch |
| VisionCamera | 5.2.3 with the checked-in patch |
| Target | macOS 14+, arm64 |
| Build environment | Xcode 26.6, macOS SDK 26.5 |

The React Native version did **not** change. Nitro 0.37 is isolated to this generated example; the framework's ordinary apps retain their existing dependency selection.

The Debug app compiled and linked. Its generated Nitro view passed mount, prop update, native resize, unmount, exactly-once cleanup, and remount checks. The camera app passed 13 additional native runtime checks: RGBA color and row stride, pixel order, horizontal mirroring, PNG encoding/decoding, resizing, image file round-trip, camera discovery, session creation, preview output creation, an actual AppKit VisionCamera preview view mount, photo/video output creation, and explicit rejection of unsupported multi-camera requests. Camera discovery correctly returned zero devices on this machine.

The machine-readable evidence is in `docs/camera-validation.json`. The extracted Release ZIP also passed all 13 native checks from a separate directory with development environment variables removed; its code signature verified.

Both example and framework TypeScript checks passed. The framework suite passed 115 tests with 439 assertions. The standalone Release app also passed all 13 native checks without Metro. Native UI verification covered readable text, correct solid-red image rendering, the no-camera/disabled-start state, switching to the ordinary kitchen sink and back, and saving a hardware log through the native file dialog.

These results establish source, link, and camera-free runtime compatibility for this exact version combination. They do not establish live preview quality, photo/video capture, microphone recording, USB reconnect behavior, iOS/Android regression safety, Intel support, or behavior on older macOS hardware. Those require the hardware checks below.

## Try the standalone app

The deliverable is `artifacts/camera/spark-camera-macos-arm64-test-kit.zip`. Extract it on an Apple Silicon Mac running macOS 14 or later and open `SparkCameraKitchenSink.app`. It embeds its JavaScript; it needs neither Metro nor Xcode nor Bun. It is a local test build, not a signed and notarized distribution release.

1. Open **Camera prototype**. The automatic checks should all pass. With no camera, the example explicitly reports that hardware checks remain pending.
2. On a Mac with a camera, allow camera access, select the camera, and press **Start camera**. Check that the preview is live, upright, and correctly sized; resize the window.
3. Take a photo. Inspect the image in the app, then use **Show captured file in Finder** to open the saved JPEG. Check orientation, colors, mirroring, and resolution.
4. Record and stop a short video. Open the saved file and verify playback. Then stop the camera, enable microphone access, restart, and repeat with audio.
5. Stop/restart the session and switch between cameras. For USB cameras, unplug/reconnect and check that the device list updates and capture recovers.
6. Use **Export hardware test log…** and retain it alongside notes about what you saw and heard. A native session-start event alone does not prove visible preview frames.

Captures are saved to temporary files; copy any results you want to keep. Leaving the camera page requests that an active recording stop. Permission denial can be changed in System Settings → Privacy & Security → Camera or Microphone.

## Reproduce from this repository

Requires the framework's normal macOS build prerequisites: Xcode, CocoaPods, and Node.

```sh
# Reproduce just the RN/Fabric/Nitro compatibility gate.
bun run test:camera /tmp/SparkNitroProbe --probe-only

# Prepare, build, launch, and run the complete camera-free proof.
bun run test:camera /tmp/SparkCameraKitchenSink

# Build a standalone Release app and run the same proof without Metro.
bun run test:camera /tmp/SparkCameraKitchenSink --release

# Open an already-built app for manual testing.
bun run test:camera /tmp/SparkCameraKitchenSink --run-only --interactive
```

Use `--release --run-only --interactive` for the existing Release app. `--prepare-only` generates the consumer without building. Generated consumers have the usual kitchen-sink managed-directory marker; the script refuses to overwrite an unrelated app. Reports are written under the consumer's `.spark/camera-proof/`. The exact built app path is printed after a successful run. A successful full Release run also creates the test-kit ZIP and its SHA-256 checksum in `artifacts/camera/`.

For this machine, builds were staged under `/tmp` because Bun file reads in the Documents checkout stalled. All camera source changes and patches are saved in the workspace paths below; temporary working copies are not required to reproduce them.

## Patch layout and upstream path

`patches/camera/upstream.json` pins each published archive and SHA-512 integrity. `scripts/prepare-camera.ts` verifies the archives, applies patches without fuzz, and installs content-addressed tarballs. No upstream branch is silently substituted. Generated bindings are included in the patches, so application builds do not need to rerun Nitrogen.

- **Nitro Modules:** expose a UIKit/AppKit platform view alias; keep Fabric-only C++ template headers out of Swift's public umbrella on RN 0.81.
- **Nitrogen:** generate AppKit view imports/casts; use the macOS RN 0.81 `ViewProps` constructor; provide the private-header search path; call guarded view cleanup from deallocation for older RN versions. Both generator source and published JavaScript are patched. The probe and camera/image bindings were generated with this patched generator.
- **Nitro Image:** add a macOS pod target and CGImage/AppKit implementation with native image encoding, decoding, file operations, and image views. Explicit sRGB handling preserves pixel values.
- **VisionCamera:** add macOS autolinking/pod support, AppKit views and gestures, desktop orientation handling, desktop device discovery, file-based photo decoding, and availability guards around iOS-only APIs. Unsupported requests reject explicitly where the API permits errors; capability properties report neutral/unsupported values.

The proof fixture is `examples/camera/nitro-view-probe/`. The camera page and manual controls are in `examples/camera/`; the ordinary kitchen sink is copied into the generated app and accessible from its second tab.

A reasonable upstream sequence is the Nitro/Nitrogen compatibility fixes first, then Nitro Image's AppKit backend, then VisionCamera's macOS target and example. Before proposing production support, get actual capture results and run iOS/Android build checks. The broad camera patch should be reviewed and split into focused changes; nothing has been sent to maintainers.

## Prototype limits

Multi-camera sessions, depth capture/output synchronization, metadata object scanning, stabilization, RAW photos, preview thumbnails, custom movie codec/bit-rate selection, manual zoom/exposure/white-balance gains, and subject-area monitoring are unsupported. Custom capture rotation is unsupported; desktop camera buffers retain their native upright orientation. Preview first-frame notifications are unavailable on macOS and are not faked from session-start events. Basic video recording uses the normal nonpersistent recorder; persistent/frame processing paths are not hardware-validated.

Nitro Image's ThumbHash and non-RGBA raw input paths are not implemented. Some advanced image transforms and loading paths compile but have not been exhaustively tested. The minimum deployment target is macOS 14, but runtime validation was on this machine's OS; a macOS 14 hardware run is still needed before asserting that whole range works.
