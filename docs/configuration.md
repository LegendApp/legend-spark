# Application configuration

`@legendapp/spark/config` exports `SparkConfig`, `SparkApplicationConfig`,
`SparkExpoProjectConfig`, `WindowConfiguration`, platform and capability options,
and typed readers. `toExpo` accepts untrusted JSON and validates Spark-owned settings;
its result has a required name, version, slug and `extra.spark`. General readers
also accept Expo configuration, so their optional fields must be checked before use.

## Spark-owned projects

Author `desktop.config.json`. The CLI prepares Expo's transport configuration from
this file; generated `app.json` is not a second source of truth. Multi-target
projects use the generated `app.config.js` resolver.

```json
{
  "projectId": "keep-the-generated-project-id",
  "name": "Editor",
  "version": "1.0.0",
  "platforms": ["macos"],
  "macos": { "bundleIdentifier": "com.example.editor" },
  "window": {
    "size": { "width": 1000, "height": 700 },
    "minSize": { "width": 500, "height": 300 },
    "restoreBounds": true
  }
}
```

`size`, `minSize` and `maxSize` use outer-frame logical dimensions, just like
runtime windows. Each size supplies width and height. Null min/max constraints use
the supported default range. Restoration constrains saved dimensions to current
limits. AppKit content background materials are explicitly
`window.macos.backgroundMaterial`; traffic lights are
`window.macos.titleBar.trafficLights`. Private flat native transport fields are not
accepted in public configuration.

`macos.testDriverInRelease: true` compiles the in-app test driver into release builds too; Debug
builds always have it. It is off by default, and `spark build` then fails a release build that contains
driver code. Turn it on only for apps that the release gate drives and that are never distributed, such as
the Kitchen Sink ([test driver](test-driver.md#builds)).

`macos.testDriverPrivateEvents: true` compiles the test driver's trackpad gesture and
extra mouse button synthesis, which uses private CoreGraphics functions. It is off by
default. Turn it on only for apps that are tested and never distributed, such as the
Kitchen Sink ([test driver](test-driver.md#private-event-functions)).

`macos.appIntents` declares the actions the app offers to Shortcuts, Spotlight and Siri. `spark build`
compiles them into the app; JavaScript handles them with `@legendapp/spark/app-intents`
([App Intents](app-intents.md)).

`macos.authentication` opts in to the restricted entitlements of Sign in with Apple
(`"signInWithApple": true` adds `com.apple.developer.applesignin`) and passkeys
(`"passkeyDomains": ["example.com"]` adds `webcredentials:example.com` to
`com.apple.developer.associated-domains`). Nothing is added without it. Both need a build signed by
your team with a provisioning profile that grants them; see
[authentication](authentication.md#entitlements).

`macos.capture` opts in to the hardened-runtime entitlements the camera and microphone
need: `"camera": true` adds `com.apple.security.device.camera` and `"microphone": true` adds
`com.apple.security.device.audio-input` (also for speech recognition). Each needs its usage
description in `macos.infoPlist` (`NSCameraUsageDescription`, `NSMicrophoneUsageDescription`), or
configuration fails. Nothing is added without it; see [capture](capture.md#entitlements).

`macos.privilegedHelpers` lists helpers (from `helpers`) that run as launchd daemons through
`@legendapp/spark/privileged-helper`: `spark build` writes `Contents/Library/LaunchDaemons/<bundle identifier>.<name>.plist`
for each. Nothing is added without it. They need a build signed by your team; see
[privileged helpers](privileged-helper.md#configuration).

`localizations` lists the languages the app is translated into, development
language first. On macOS AppKit and Spark show native strings (menus, dialogs,
panels) in the first of the user's languages listed there; see
[Languages](app.md#languages).

Spark owns project identity, initial window settings, document associations,
update signing, helper bundles and desktop lifecycle policy. Expo owns its plugins
and mobile/web settings: put those under `expo`, or `expoByPlatform.<target>`.
Those objects retain Expo's model rather than a renamed Spark facade.

### App icons

`macos.icon` is the macOS app icon, and `expo.icon` the icon for every other target and
the macOS default. Paths are relative to the project. Without either, the app keeps the
template's generic icon.

- An Icon Composer document (`"macos.icon": "./assets/App.icon"`, made with Icon
  Composer in Xcode 26) becomes the target's `AppIcon.icon` resource. Xcode 26 or later
  compiles it into the default, dark, clear and tinted styles of macOS 26, plus the flat
  icons earlier macOS shows. This is the way to get those styles.
- A PNG whose corners are opaque (full-bleed artwork, such as an Expo icon) is wrapped in
  a generated Icon Composer document: macOS masks it to the system shape and derives the
  dark, clear and tinted styles itself. That also needs Xcode 26 or later.
- A PNG with transparent corners already has its own shape. It fills every
  `AppIcon.appiconset` slot (16 to 512 points at 1x and 2x), and macOS 26 shows it as a
  legacy icon, without the styles.
- Windows writes `expo.icon` (`expoByPlatform.windows.icon` overrides it) into the
  executable's `.ico` at 16, 20, 24, 32, 40, 48, 64 and 256 pixels. Use a PNG.

PNGs are scaled to cover a square; give at least 1024×1024 pixels. On macOS, editing the
icon in place prepares the native project again on the next build. `getAppIcon()` returns the
icon as Finder and the Dock draw it ([files](files.md#icons-thumbnails-and-quick-look)).
The release gate audits it with `assertAppIcon`
([e2e-flows](e2e-flows.md#app-icon-audit)).

## Existing Expo projects

Keep Expo's configuration as the source of application name/version and compose it
with `withSparkExpo` from `@legendapp/spark/expo-config`. The desktop sidecar declares
`extends: "expo"`, project identity and supported platforms. It adds Spark's desktop
settings only in the selected desktop or shared development session. See
[adding desktop](add-desktop.md) for the complete setup recipe.

The JSON schema in `/schema.json` checks editor-visible structure. Runtime validation
also checks relationships such as size constraints, selected targets, helper paths
and update feed/key requirements. Tests reconcile schema keys with public types and
verify the native window transport independently.

## Metro and native discovery

All Metro helpers live under `/metro`; native discovery helpers live under `/native`.
Their inputs retain Expo/Metro and React Native CLI types. Removed `/expo-metro` and
`/universal` paths have no forwarding aliases.

For a **Spark-owned project**, `metroConfig` supplies defaults and integration:

```js
// metro.config.js — apply styling or other Metro wrappers to this result.
const { metroConfig } = require('@legendapp/spark/metro');
module.exports = metroConfig(__dirname);
// react-native.config.js
module.exports = require('@legendapp/spark/native').nativeConfig(__dirname);
```

For an **existing Expo project**, preserve its composition:

```js
// metro.config.js
const { getDefaultConfig, withSparkMetro } = require('@legendapp/spark/metro');
const config = getDefaultConfig(__dirname);
// Existing application customizations go here.
module.exports = withSparkMetro(config);
// react-native.config.js
const { withSparkNative } = require('@legendapp/spark/native');
module.exports = withSparkNative({ assets: ['./fonts'] }, __dirname);
```

`getDefaultConfig` follows Expo's options. `withSparkMetro` also accepts a promise
from an asynchronous config wrapper. `withDesktop(config, { runtimes?, watch? })`
is the lower-level composition helper for an already configured desktop Metro
instance. `watch: false` keeps a development session's Runtimes registrations
from each bundle's first build instead of following the app's changes. It is not needed in either ordinary recipe above. Other backend-specific
configuration belongs to the upstream tool; unknown Spark options reject.
