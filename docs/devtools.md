# React Native DevTools

Development builds on macOS debug their JavaScript with React Native DevTools: the Chrome DevTools frontend with
the Hermes debugger, served by the development server that `spark dev` starts. It has breakpoints and stepping, the
console, sources with source maps from the development bundle, pause on exceptions, and Hermes profiling. Release
builds contain none of it. Windows is typed unsupported.

## Open DevTools

- In the app, press **⌥⌘I**. It opens DevTools for the shared runtime. The I key is matched by position, so it works
  in every keyboard layout.
- In the `spark dev` terminal, press **j**. With more than one JavaScript runtime, Expo lists each by its title.
- From the Developer menu ([#270](https://github.com/LegendApp/legend-spark/issues/270)), choose **Open DevTools**. It
  opens DevTools for the key window's runtime, shared or isolated.
- From code, call `openDevTools()`.

Each JavaScript runtime is its own debug target, listed at the development server's `/json/list`:

| Runtime | Target title |
| --- | --- |
| The app's shared runtime | `<CFBundleName> (shared runtime)` |
| An isolated runtime, such as an isolated window's or a worker's (`@react-native-runtimes/core`) | `<CFBundleName> (isolated runtime: <name>)` |

React Native 0.81's inspector proxy attaches one debugger per app process. Opening DevTools for another runtime
closes the previous DevTools session, which reports that a new debugger opened; reopen it to switch back
([#292](https://github.com/LegendApp/legend-spark/issues/292)).

A debugger session survives source edits and full reloads (`r`, or reload from DevTools): the shared runtime keeps its
target, so its DevTools window stays attached. Spark destroys isolated runtimes on reload; each would come back as a
new target with the same title when the app starts it again, but today isolated runtimes do not restart after a reload
([#291](https://github.com/LegendApp/legend-spark/issues/291)). In the Kitchen Sink, edits currently arrive as full
reloads rather than hot updates (#291).

## API

```ts
import { getDevToolsAvailability, openDevTools } from "@legendapp/spark/devtools";

getDevToolsAvailability(); // { available: true } | { available: false, reason }
await openDevTools();                                     // the runtime that calls it
await openDevTools({ runtime: "shared" });                // the app's shared runtime
await openDevTools({ runtime: { isolated: "plugins" } }); // an isolated runtime by name
```

`getDevToolsAvailability()` is synchronous. It reports `unsupported-platform` outside macOS, `development-only`
unless the JavaScript is a development bundle (`__DEV__`), and `missing-module` without Spark's desktop module.

`openDevTools(options?)` finds the runtime's target at the development server, then asks the server to open DevTools
for it. It resolves once the server has the request; the server opens the DevTools window. It rejects:

| Code | When |
| --- | --- |
| `E_INVALID_ARGUMENT`, `E_UNSUPPORTED_OPTION` | Options other than `runtime: "shared" \| { isolated: string }` |
| `E_UNSUPPORTED_PLATFORM`, `E_UNAVAILABLE`, `E_MODULE_UNAVAILABLE` | Unavailable, as `getDevToolsAvailability()` reports |
| `E_UNAVAILABLE` | The JavaScript did not come from a development server, or the server does not list targets |
| `E_NOT_FOUND` | No target for that runtime: it is not running |

When the browser launch itself fails, the server answers with an error status and the app logs a warning. After a
successful launch React Native's default browser launcher never answers, so `openDevTools` does not wait for it,
just as Expo's `j` key does not.

### The Developer menu

In development bundles, `@legendapp/spark/runtime-entry` registers `openDevTools` as the Developer menu's DevTools
opener (`packages/desktop-app/src/devtools-opener.ts`, through `registerDevToolsOpener`). The menu passes the key
window's runtime, which becomes `{ runtime: "shared" }` or `{ runtime: { isolated: name } }`. Without an opener (no
DevTools in the build) the menu's Open DevTools item stays disabled with a tooltip.

### Native

`packages/desktop-app/macos/SparkDevTools.h` (compiled only when `RCT_DEV`):

- `SparkOpenDevTools(NSString *runtime, completion)`: what `openDevTools` and ⌥⌘I call. `runtime` nil is the shared runtime.
  `completion(code, message)` runs on the main queue; `code` is nil on success, otherwise `E_UNAVAILABLE` or
  `E_NOT_FOUND`.
- `SparkDevToolsTargetTitle(NSString *runtime)`: a runtime's target title.
- `SparkInstallDevTools(bundleURL)`: called once by the app delegate. It installs ⌥⌘I and records where the main
  runtime's JavaScript comes from; that server hosts the targets.

## Release builds

React Native compiles `RCT_DEV` to 0 in release builds, which removes Spark's ⌥⌘I monitor, the target lookup and the
native `openDevTools` operation. React Native registers debug targets only when Fusebox is enabled, which it is in
development builds only. In JavaScript, `getDevToolsAvailability()` reports `development-only` and `openDevTools`
rejects `E_UNAVAILABLE` without native work. `tests/devtools.test.ts` checks these guards in the sources. The release
gate's [release-safety probe](e2e-flows.md#release-safety-probe) ([#274](https://github.com/LegendApp/legend-spark/issues/274))
runs the release build pointed at a decoy development server and fails if it connects to it, holds a network or
listening socket, or shows a Developer menu or other debug menu item.

## How it works

React Native macOS 0.81.7 lists every runtime (each `RCTHost`) as the same target, `<bundle id> ()`, because
macOS reports no device name. The `devtools-targets.cjs` config-plugin patch names each target by its runtime instead.
An isolated runtime is named only once its runtime delegate has set `__THREADED_RUNTIME_ENV__.runtimeName`, so
`RCTHost` lists its target after the runtime initializes, on the main queue, once per host. Like Spark's other
React Native macOS patches, it checks the version and exact source, is idempotent, and replaces files atomically.
Existing runtimes need a native rebuild.

Spark's Expo CLI patch (`packages/cli/src/expo-dev-patch.cjs`) makes the `j` prompt list targets by title rather
than by the shared device name.

As on iOS, targets do not fetch sources natively (`nativeSourceCodeFetching`); the DevTools frontend loads source
maps from the development server. The inspector proxy reports the macOS device as `Unknown`.

## Verification

The driver backend serves bundled JavaScript itself, without Metro or its inspector proxy, so it cannot reach
DevTools. `bun scripts/test-devtools.ts` runs a real development session instead, headless:

1. It starts `spark dev --no-open` for the Kitchen Sink, then launches the dev build in driver mode (no window, no
   focus) with development JavaScript from that server (`KitchenSinkApp` with a `devServer`).
2. It checks that `/json/list` lists `KitchenSink (shared runtime)`, and `KitchenSink (isolated runtime: ks-devtools)`
   once the DevTools screen starts its worker runtime.
3. Over CDP it evaluates, receives a console call, maps `screens/devtools/probe.ts` through the bundle's source map
   and pauses at a breakpoint there.
4. It evaluates in the worker target (which closes the shared runtime's session: one debugger per app process) and
   reconnects, then calls `openDevTools` for both runtimes and an absent one (`CHROME_PATH` points React Native's
   browser launcher at a recorder, so no browser opens).
5. It edits a source file and restores it, pauses on an uncaught exception, and reloads, checking that the shared
   runtime's session stays attached throughout. It reports, without failing, whether the worker restarted after the
   reload (#291).

`bun run ks:capture <area>/<screen> --dev-server http://127.0.0.1:<port>` captures a screen with development
JavaScript from a running `spark dev`. The Kitchen Sink's DevTools screen is `spark-ks://devtools/devtools`. Its
checks are in `e2e/checks/devtools.yaml`: release flows in `e2e/flows/devtools/`, and development flows (including
this script, as a manual step) in `e2e/dev-flows/devtools/`.
