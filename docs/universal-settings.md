# Shared Settings starter

The universal starter keeps one `App.tsx` and one dependency/configuration source for iOS, Android, web, macOS, and Windows. It uses ordinary React Native layout and text, the existing clipboard/secure-storage/linking adapters, and three controls from `@legendapp/spark/ui`.

## Create and run

From the framework checkout:

```sh
bun install
bun run settings /tmp/MySettings
```

This packs the local SDK and passes its universal template to `expo-desktop@1.0.0 create-app`. Expo Desktop extracts it, assigns app/native identity, installs dependencies, and initializes Git. A postinstall initializes spark configuration once. Equivalently, after `bun run pack:local`, use `bun run spark create /tmp/MySettings --universal`. Existing desktop-only creation remains available through separate templates. App directory names must be alphanumeric; parent directories can contain spaces.

Inside that consumer:

```sh
# Browser
npm run web

# macOS: build once, then start the development session
npx --no-install spark build --dev --platform macos
npm run macos

# iOS: build/install on the selected simulator, then develop
npx --no-install spark build --dev --platform ios --device "<simulator UDID>"
npm run ios

# Android: build/install on the selected emulator/device, then develop
npx --no-install spark build --dev --platform android --device "<device name or ID>"
npm run android
```

Mobile commands delegate to the installed Expo CLI. The starter includes `expo-dev-client`; mobile `dev` opens a development client containing Expo UI. Install the native toolchain for the target, and boot/select its simulator or device first. The current pins remain Expo 54, React Native 0.81, and Expo UI 0.2.0-beta.9. Android's Compose controls require a development build. `spark prebuild --platform ios|android|windows` generates a native project without building it or installing native dependencies.

Use `npm run dev --no-open` for one Metro session, then `i`, `a`, `w`, and `d` to open mobile, web, and the host desktop. All five declared platforms remain available even when a script selects an initial target. Expo chooses the host/port (LAN and port 8081 by default); use `--localhost`, `--offline`, `--clear`, or `--port` as with `expo start`. Separate sessions are only necessary for separate projects or deliberately different server settings. Mobile production/distribution remains an Expo workflow; this slice adds development commands only.

Windows uses the existing [integrated Windows host and CLI](windows-slice.md). The same Settings screen renders there without excluding Windows. The three controls now have WinUI implementations and the shared APIs have native backends. Missing or failed UI initialization displays a noninteractive placeholder; native Windows compilation and execution remain pending. These are tracked in [known Windows issues](windows-issues.md). Build/run on Windows with `spark build --dev --platform windows` and `npm run windows` once that machine's prerequisites are installed.

## What the screen demonstrates

- Enter a display name and choose light, dark, or system appearance; the screen applies the theme through Uniwind.
- Resize the screen: app-owned Tailwind tokens style ordinary React Native content and optional bindings size the native controls. See [styling with Uniwind](styling.md).
- Copy the preferences using the shared Clipboard contract.
- Round-trip a disposable synthetic SecureStore value and delete it. Web reports that secure storage is unavailable.
- Open the spark website through the Linking adapter.

Preferences and theme selection are held in memory; this example does not yet persist them. There is no router or declarative window manager in this slice.

## Configuration and target switching

`desktop.config.json` remains the canonical source despite its historical name. `platforms` declares every supported target. `expo` contains shared Expo configuration; `expoByPlatform` overlays the selected native build/prebuild target. Shared development uses `expo` without a target overlay, so desktop autolinking exclusions cannot affect mobile JavaScript. Put runtime values needed in the shared manifest under `expo`; platform-specific native values can use `expo.ios`, `expo.android`, and the desktop options. Nested objects merge and arrays replace. For example:

```json
{
  "platforms": ["ios", "android", "web", "macos", "windows"],
  "expo": {
    "ios": { "bundleIdentifier": "com.example.settings" },
    "android": { "package": "com.example.settings" }
  },
  "expoByPlatform": {
    "ios": { "ios": { "supportsTablet": true } }
  }
}
```

This is an excerpt; retain the starter's name, version, stable project ID, macOS identifier, and platform-specific autolinking exclusions. The exclusions keep mobile-only Expo modules out of desktop native builds.

`build/prebuild --platform` sets `SPARK_PLATFORM` for native generation. `dev --platform` chooses the initial launch target; the supervisor selects desktop runtime state separately and its Expo child receives shared development configuration. The managed `app.config.js` resolves configuration dynamically, so switching targets does not rewrite shared config, application source, or the root React Native/Metro configuration. Put custom Expo settings under `expo` or `expoByPlatform`; an existing custom `app.config.js`/`.ts` needs explicit composition before adopting this starter.

Native projects coexist in `ios/`, `android/`, `macos/`, and `windows/`. Desktop build records, native selections, products, and session gates live under `.spark/platforms/<target>/`. Upstream prebuild may update its selected native project; the CLI restores the package manifest after generation, including failed runs. Do not run two native generation/build commands against the same checkout concurrently: upstream tools temporarily mutate shared files. Switching development targets is safe; preserving in-memory React state between processes is not promised.

For direct Expo commands, set the target explicitly, for example `SPARK_PLATFORM=ios npx expo config` on macOS/Linux or `$env:SPARK_PLATFORM="ios"` before the command in PowerShell. An omitted target defaults to the host desktop if supported, then the first supported platform.

## Verification

`bun run test:universal:dev` creates a packed Settings consumer and checks all five graphs in one live Expo process, per-platform runtime gating, iOS/web HMR from the same edit, Expo option forwarding, restart while desktop is incompatible, and shutdown cleanup. It does not launch native applications.

`bun run test:universal [fresh-directory]` creates a packed starter, generates real iOS/Android/Windows projects, and bundles the same screen for all five platforms. It compares shared files and previously generated native project contents and checks that mobile/web/Windows bundles exclude AppKit bindings. Reports live in the consumer's `.spark/universal-checks/`.

`bun run test:ui` exercises mounted AppKit controls and their React callbacks in the kitchen sink. See [UI contracts and current validation](ui.md). Native Android and Windows execution still require their respective machines/devices; successful generation or bundling is not proof of native execution.
