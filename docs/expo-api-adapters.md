# Expo-aligned clipboard, secure storage, and linking

These adapters define deliberately selected Expo API subsets. Router, declarative windows, UI primitives, and a universal starter remain deferred. The framework stays on Expo SDK 54.

## Imports and implementations

Use the individual framework packages when sharing these capabilities with mobile/web:

```tsx
import * as Clipboard from '@legendapp/spark/clipboard';
import * as SecureStore from '@legendapp/spark/secure-storage';
import * as Linking from '@legendapp/spark/links';

await Clipboard.setStringAsync('Hello');
const text = await Clipboard.getStringAsync();

if (await SecureStore.isAvailableAsync()) {
  await SecureStore.setItemAsync('session-token', 'example');
  const token = await SecureStore.getItemAsync('session-token');
  await SecureStore.deleteItemAsync('session-token');
}

const subscription = Linking.addEventListener('url', ({ url }) => {
  console.log('Opened URL:', url);
});
const initialURL = await Linking.getInitialURL();
// On cleanup:
subscription.remove();
```

The kitchen sink uses the existing `@legendapp/spark/clipboard`, `/secure-storage`, and `/links` entry points, which reexport the same APIs. The desktop umbrella is still desktop-focused; using the three individual packages does not imply that the rest of that umbrella is portable.

| Platform | Clipboard | Secure storage | Linking |
| --- | --- | --- | --- |
| macOS | Existing AppKit backend, including text/HTML conversion | Existing project-scoped Keychain backend | Existing native URL opening plus host launch/event tracking |
| iOS / Android | `expo-clipboard` | `expo-secure-store` | `expo-linking` |
| Web | `expo-clipboard` and browser restrictions | Unavailable; no local-storage fallback | `expo-linking` |
| Windows | Native text/HTML clipboard | Project-scoped Credential Manager, 2560-byte value limit | Open/query URLs and initial command-line URL; live activation pending |

Mobile/web consumers declare the libraries used by their platform as dependencies. Tested versions are `expo-clipboard@8.0.8`, `expo-secure-store@15.0.8`, and `expo-linking@8.0.12`. These are optional peers of the individual framework packages; they are development dependencies in this repository for adapter verification, not new required dependencies of the desktop SDK.

Package entry points intentionally omit the `.ts` suffix so Metro selects `.ios`, `.android`, `.web`, or `.windows` implementations before the macOS default. Mobile resolution must not evaluate AppKit TurboModules. Mobile autolinking excludes the three AppKit pods and their desktop-app dependency. Because the pinned Expo Desktop template invokes the Apple autolinker as `ios`, the desktop config plugin marks its Podfile with `SPARK_DESKTOP_AUTOLINK=macos` to retain those pods on macOS.

## Supported contracts

**Clipboard:** `getStringAsync`, `setStringAsync`, `hasStringAsync`, `StringFormat`, `GetStringOptions`, and `SetStringOptions`. `setStringAsync` resolves to the native write result — `false` when the platform declines the copy, and failures still reject; web and mobile preserve Expo's boolean result. `preferredFormat` and `inputFormat` support plain text and HTML. On macOS, HTML is available as plain text through conversion, and HTML/RTF count as string content. Redundant text aliases have been removed. Rich desktop operations use owned payload types; PNG images are `{ format: "png", bytes: Uint8Array }`, and file lists are written separately from text/image content. This is a subset of [Expo Clipboard](https://docs.expo.dev/versions/v54.0.0/sdk/clipboard/), not its complete component/image/event API.

**Secure storage:** `getItemAsync`, `setItemAsync`, `deleteItemAsync`, and `isAvailableAsync`. Missing values are `null`; an empty string is an existing value. Writes/deletes resolve `undefined`. Shared keys use Expo's alphanumeric/period/hyphen/underscore character set, with the existing desktop limit of 200 characters. Only default storage options are supported: authentication, service, access-group, and accessibility overrides reject explicitly rather than being ignored. Desktop storage retains its existing project-scoped service and accessibility policy; it does not claim to match every mobile Keychain default. The duplicate `secureStorage.get/set/remove` API and unused synchronous service-based keychain API have been removed. See [Expo SecureStore](https://docs.expo.dev/versions/v54.0.0/sdk/securestore/) for the larger upstream API.

**Linking:** `openURL`, `canOpenURL`, `getInitialURL`, and `addEventListener('url', listener)`. Successful `openURL` now resolves `true`; invalid/open failures reject. On macOS, `getInitialURL` returns the first non-file URL delivered before application launch completes, or `null`. It stays stable across subsequent URLs and JavaScript reloads within that process. Live listeners return a synchronous removable subscription, omit launch events and file-open events, and do not replay history. Subscribe before awaiting the initial URL. The existing asynchronous `onOpen` remains the queued, deduplicated desktop URL/file API; recent documents are unchanged. The smaller interface does not implement all of [Expo Linking](https://docs.expo.dev/versions/v54.0.0/sdk/linking/).

A rebuilt desktop runtime is required: clipboard native operations and initial-URL host tracking changed. The existing runtime compatibility signatures detect these changes. URL scheme associations require a configured custom application; the generic prebuilt binary does not acquire every project's scheme.

## Kitchen-sink validation

The kitchen sink now uses the canonical methods in its copy/read, HTML copy, secret storage, and linking controls. Its **Expo-aligned APIs** card runs checks in the mounted app. Clipboard mutation and injected URL tests require the dedicated test driver so the original clipboard can be fully restored.

```sh
bun run test:api-adapters
bun run test:api-platforms
```

`test:api-adapters` prepares a packed kitchen-sink consumer and builds a custom macOS runtime with the test-only driver. It temporarily stages the test app under `~/Applications` because LaunchServices excludes `/tmp` apps from URL-handler lookup, and unregisters/removes that copy afterward. It executes six checks on a normal launch and again on a real LaunchServices URL launch. Coverage includes text/HTML/empty clipboard values, temporary Keychain values and cleanup, unsupported options, initial URLs, URL opening, live events, file separation, and listener removal. Test reports live in the consumer's `.spark/api-results` directory. The driver remains excluded from prebuilt and production builds by the existing validation rules.

`test:api-platforms` installs a minimal packed consumer, bundles the actual iOS/Android/web entry points, rejects any desktop-native import in their source maps, and verifies that mobile autolinking excludes AppKit pods. It does not claim mobile device execution. Windows backend execution is a separate native acceptance check.

On this host, Bun execution in Documents can stall; the saved project environment recommends a synchronized `/tmp` checkout for execution. Validation results should identify that checkout and the tested source, rather than imply the app was run directly from Documents.

## Recorded validation — 2026-09-13

- TypeScript: passed in the source checkout.
- Unit/config/codegen suite: 123 tests passed, 490 assertions.
- macOS kitchen sink: all 12 focused native checks passed, including a real cold URL launch and opening a URL back into the app. Local report: `docs/evidence/expo-api-adapters/native.json`.
- Visible kitchen sink: clicked **Run Expo API checks** and verified four readable PASS results in the regular app; the six-check native-driver variant ran separately above.
- Packed iOS, Android, and web consumers: bundles select their platform adapters without desktop TurboModules; mobile autolinking excludes AppKit pods. Local report: `docs/evidence/expo-api-adapters/platforms.json`.

Execution used `/tmp/spark-api-clean`, synchronized from this checkout. Evidence JSON is a local generated artifact under the ignored `docs/evidence` directory. Mobile device execution and Windows native backends are not covered by these results.

Windows backends await native acceptance via `bun run test:windows:features`. Live URL events, association registration, recent documents, and rich clipboard parity are tracked in [Windows issues](windows-issues.md).
