# Third-party libraries

Export: `@legendapp/spark/contracts` (`SparkError`, `Availability`, `Subscription`, `AsyncRegistration`). This file also covers how Spark treats other npm packages.

## Rules

- **Keep the library's own import.** Write `import { Image } from 'expo-image'`, not a Spark path. Where a library has no macOS native view, Spark redirects that import to a stand-in (for example `expo-image` and `react-native-fast-image` become JS stand-ins on React Native's `Image`; `react-native-screens` uses its web implementation; native-stack uses a JS stack). Stand-ins cover a documented subset; check the integration table before relying on advanced features.
- **Spark doesn't wrap external libraries.** Use them directly: `react-native-vision-camera` for camera, `react-native-reanimated`, `@shopify/react-native-skia`, `expo-router`, `react-native-mmkv`, etc. Spark only patches them for macOS, pins tested versions and handles native setup. Exceptions are the deliberate Spark contracts: `/webview`, `/sqlite`, `/clipboard`, `/secure-storage`, `/links`.
- **Install the version Spark tested.** Patches apply to exact versions; another version builds unpatched and may fail on macOS. Declare libraries you import in the app's `package.json` and keep Spark's overrides/resolutions.
- **Native libraries need a custom build.** Adding one means `b` in `spark dev` or `spark build --dev`; the prebuilt Runner won't contain it.
- **Data locations are fixed for you.** Spark moves MMKV storage from `~/Documents/mmkv` to the app's Application Support folder; Release Profiler traces and Image Manipulator output go to the app's Caches folder. Nitro SQLite uses `~/Library/Application Support/<bundle id>`. Don't override these to user-visible folders.
- iOS-only modules on macOS typically become no-ops or report unavailable (Keyboard Controller events never fire, Tracking Transparency reports `unavailable`, Splash Screen does nothing). Don't build features that depend on them on desktop.

## Patch a library

Fix bugs every Spark app would hit in Spark's own patch (`patches/` in the Spark repository), not in one app. For an app-specific change:

1. Run `spark patch <lib>`. It prints a temporary copy of the installed library with Spark's patch applied.
2. Edit that copy, then run `spark patch <lib> --done`. It saves `patches/<lib>@<version>.patch` (scoped names use `+` for `/`) against the Spark-patched library and updates `node_modules`. From a monorepo root or a subfolder, it uses the nearest Spark app or folder with `patches/`; `--root <dir>` sets where the library is installed and `--out <dir>` where `patches/` goes.
3. Commit the patch file. Native preparation applies Spark's patch first, then the app's; this works for any library, Spark-patched or not.

App roots that share one `node_modules` (monorepo workspaces) need the same app patches: native preparation stops when another root's patch for that library differs. Keep the patch at the shared root and copy it to every app.

App patches are pinned to the installed version. When Spark moves a pin, native preparation stops and names the patch to redo with `spark patch <lib>`; nothing is half-applied. Editing or deleting a patch file needs no reinstall: the library keeps the app patch it carries in `.spark-app.patch`, and native preparation undoes it before applying the current one. If preparation still can't apply a patch (the library was patched before Spark kept that file, or the patch targets a library that isn't a direct dependency), delete `node_modules/<lib>` and reinstall.

patch-package (`patches/<lib>+<version>.patch`) and Bun/pnpm `patchedDependencies` keep working. For a library Spark also patches, Spark treats that patch as the app layer and warns; prefer `spark patch` there, because package-manager patches are made against the unpatched library.

To drop Spark's patch for one library, set `"spark": { "patches": { "<lib>": false } }` in the app's `package.json`. The app's patch still applies alone; native preparation warns that desktop support for that library isn't guaranteed.

[external-libraries.md](external-libraries.md) lists every integrated library with the version Spark tested and its per-library limits on desktop.

## Spark errors and availability

Every Spark capability exposes a `get<Feature>Availability()` that is safe without the native module installed; use it to decide whether to show a feature. Operations still reject when unavailable. Branch on `error.code`, never on the message:

```ts
import { SparkError } from '@legendapp/spark/contracts';
import { getTrayAvailability } from '@legendapp/spark/tray';

if (!getTrayAvailability().available) console.log('No menu-bar item on this platform');

export function isMissing(error: unknown) {
  return error instanceof SparkError && error.code === 'E_NOT_FOUND';
}
```

Common codes: `E_INVALID_ARGUMENT`, `E_UNSUPPORTED_OPTION` (unknown or inapplicable option, never silently ignored), `E_UNSUPPORTED_PLATFORM`, `E_MODULE_UNAVAILABLE`, `E_PERMISSION_DENIED`, `E_NOT_FOUND`, `E_ALREADY_EXISTS`, `E_BUSY`, `E_TIMEOUT`, `E_NATIVE`.

## Lifecycle conventions

Synchronous subscriptions return `{ remove(): void }`; async registrations (`createMenu`, `createTray`, `watch`, `preventSleep`, close/quit guards) return `{ remove(): Promise<void> }`. Always keep the handle and remove it when the owner unmounts; prefer the provided hooks (`useMenu`, `useRoutedHotkeys`, `useDocumentAppController`) in components because they dispose late registrations correctly.

## Platforms

macOS: shipped. Windows: development builds; external library integrations are implemented in source but not yet verified on hardware. Mobile/web: Expo owns the runtime; Spark's desktop APIs don't apply there except the Expo-shaped adapters.
