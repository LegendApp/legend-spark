# React Native DevTools

Development builds on macOS debug their JavaScript with React Native DevTools: the Chrome DevTools frontend with
the Hermes debugger, served by the development server that `spark dev` starts. It has breakpoints and stepping, the
console, sources with source maps from the development bundle, pause on exceptions, and Hermes profiling and heap
snapshots per runtime. Spark adds a [network inspector](#network-inspector) and an app-wide [profiler](#profiling).
Release builds contain none of it. Windows is typed unsupported.

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

## React DevTools

React Native DevTools includes React DevTools: the **Components** panel (the component tree, props, state and hooks,
which you can edit, Select element, highlight updates) and the **Profiler** (commit timings, and why each component
rendered). They work per debug target, so open DevTools for the runtime you want ([Open DevTools](#open-devtools)) and
choose Components or Profiler. There is no other API: `getDevToolsAvailability()` and `openDevTools()` cover it.

- **Roots:** each window is its own React root in its runtime, so the shared runtime's tree lists the main window's
  root and one per other window (`spark.window.<name>(RootComponent)`). An isolated runtime's target lists only its
  own roots: an isolated-runtime window is `ThreadedRuntimeHost(RootComponent)`.
- **Select element:** pressing it covers every window of the runtime; a click in a window selects the component under
  it, within that window's root. React Native ends inspecting only in the window that was clicked, so in development
  bundles `@legendapp/spark/runtime-entry` installs `packages/desktop-app/src/react-devtools/install.ts`, which ends
  it in every window. To select in an isolated-runtime window, open DevTools for that runtime.
- **Highlight updates** (Components settings) outline the views that re-rendered, through React Native's debugging
  overlay in each window.
- **Editing hooks:** React keeps two hook objects for a `useSyncExternalStore` or `useTransition` and three for a
  `useActionState`, and edits a hook by its index among them. `react-devtools-core` (6.1.5 through 8.0.0, and
  React's main branch) numbers each as one hook, so editing a later hook's state changed the wrong hook and could
  unmount the window ([#417](https://github.com/LegendApp/legend-spark/issues/417)). `spark dev` patches the app's
  `react-devtools-core` before starting Metro (`packages/cli/src/react-devtools-hook-ids.cjs`) so hook ids count
  React's hook objects; it rejects a `react-devtools-core` whose source no longer matches.

React Native's `setUpReactDevTools` connects the backend (`react-devtools-core`) in every development runtime. React
Native DevTools' frontend reaches it through `__FUSEBOX_REACT_DEVTOOLS_DISPATCHER__`: it adds the dispatcher's CDP
binding, initializes the `react-devtools` domain, and exchanges the React DevTools bridge's messages over CDP. React
Native also tries the standalone `react-devtools` app on port 8097; Spark does not check that path.

Release bundles contain none of it: React Native's setup and Spark's module are inside `__DEV__` branches that Metro
removes (`tests/developer-menu-release.test.ts`, `tests/react-devtools.test.ts`), and the release gate's
[release-safety probe](e2e-flows.md#release-safety-probe) (`DEVT-REL-06`) fails a release build whose JavaScript
contains `__FUSEBOX_REACT_DEVTOOLS_DISPATCHER__`, `connectWithCustomMessagingProtocol` or the Select element fix's marker
(`spark-react-devtools`, `packages/desktop-app/src/react-devtools/marker.ts`).

`bun scripts/test-react-devtools.ts` checks it headlessly in a development session like `scripts/test-devtools.ts`, as
a frontend speaking the bridge over CDP (`scripts/testing/react-devtools-client.ts`): it lists the shared runtime's
roots, reads and edits the Kitchen Sink's `ReactDevToolsSample` (DevTools › React DevTools,
`spark-ks://devtools/react-devtools`), turns on highlight updates and looks for their outlines in a capture of the
window, records a profile, selects elements by clicking in the main window and a note window (and checks that the main
window takes clicks again), and does the same in an isolated-runtime window's target.

## Network inspector

In development bundles on macOS, React Native DevTools' **Network** panel lists the JavaScript runtime's `fetch`,
`XMLHttpRequest` and `WebSocket` traffic: method, URL, headers, the request body, status, MIME type, the URL that
answered after redirects, timing, the initiator's stack (source-mapped by DevTools), the response body
(`Network.getResponseBody`), and a WebSocket's handshake, text and binary frames and close. React Native has no
`EventSource`; a polyfill built on `XMLHttpRequest` or `fetch` is covered through them.

- **Redaction:** `Authorization`, `Cookie` and `Set-Cookie` values read `[redacted]`, in any letter case, before
  anything reaches DevTools or the log. The request itself carries the real values.
- **Size caps:** each body and WebSocket frame keeps its first 64 KiB (text: characters), with its whole size; the
  log keeps the latest 100 entries and at most 4 MiB, and a WebSocket its latest 50 frames.
- **No cost while nobody looks:** the inspector records only while DevTools is attached to the runtime or a
  JavaScript listener exists. Otherwise it keeps nothing, listens to no networking events, and adds one check to each
  request. Nothing about a request changes: arguments reach React Native as given, and events reach their
  listeners as before.
- **Logs:** the inspector never logs a request, header or body. If it cannot reach the development server while DevTools is
  attached, it warns once per session, with that server's address.

Requests that Spark's native modules make themselves do not pass through the JavaScript runtime and are not listed:
Sparkle's appcast and update downloads in `@legendapp/spark/updates`
([#395](https://github.com/LegendApp/legend-spark/issues/395)).

```ts
import { addNetworkListener, configureNetworkInspector, getNetworkInspectorAvailability, getNetworkLog } from "@legendapp/spark/devtools";

getNetworkInspectorAvailability(); // { available: true } | { available: false, reason }
const subscription = addNetworkListener(entry => console.log(entry.method, entry.url, entry.state, entry.status));
getNetworkLog();                   // readonly NetworkEntry[], oldest first
configureNetworkInspector({ redactHeaders: ["Authorization", "Cookie", "Set-Cookie", "X-Api-Key"], maxBodySize: 16384 });
subscription.remove();
```

`getNetworkInspectorAvailability()` reports `unsupported-platform` outside macOS, `development-only` without `__DEV__`,
and `missing-module` if `@legendapp/spark/runtime-entry` did not install it. The other functions throw
`E_UNSUPPORTED_PLATFORM`, `E_UNAVAILABLE` or `E_MODULE_UNAVAILABLE` when it is unavailable, `E_INVALID_ARGUMENT` for a
listener that is not a function or an invalid option, and `E_UNSUPPORTED_OPTION` for an unknown option.

A `NetworkEntry` has `id`, `source` (`fetch`, `xhr` or `websocket`), `method`, `url`, `requestHeaders`, `requestBody`,
`initiator` (call frames, lines and columns from 1), `state`, `startedAt`, `respondedAt`, `endedAt` (milliseconds since
the epoch), `status`, `responseURL`, `responseHeaders`, `responseBody`, a WebSocket's `frames` and `close`, and
`error`. An HTTP request is `pending`, then `finished`, `failed` or `canceled`; a WebSocket is `pending`, `open`, then
`closed` or `failed`. A body (`NetworkBody`) holds `data` (text, or base64 when `base64`), `size` and `truncated`;
FormData and file uploads have neither `data` nor `size`. `getNetworkLog()` returns the same array until an entry
changes, so it works with `useSyncExternalStore`; it is empty while nothing observes.

`configureNetworkInspector(options)` changes `redactHeaders`, `maxEntries` (default 100), `maxBodySize` (bytes,
default 65536) and `maxLogSize` (bytes, default 4 MiB) for its runtime; lower limits apply at once.

### How the inspector works

`@legendapp/spark/runtime-entry` installs it inside `if (__DEV__)` on macOS, in every JavaScript runtime
(`packages/desktop-app/src/network-inspector/`). It wraps the JavaScript entry points of React Native's networking
modules (`RCTNetworking`, which `XMLHttpRequest` and `fetch` use, and the WebSocket module) and, while it records,
listens to their events. React Native 0.81's own Network domain is off, so the inspector sends Chrome DevTools
Protocol `Network.*` events to the development server's `/inspector/network` socket, which Expo CLI (`spark dev`)
passes to the attached DevTools; it also hands over response bodies for `Network.getResponseBody`. A runtime counts
as attached while React Native's debugger session observer reports an active session. Expo CLI passes the events
to every attached DevTools session.

Release bundles contain none of it: Metro removes the `__DEV__` branch and the module with it
(`tests/developer-menu-release.test.ts`), and the release gate's [release-safety probe](e2e-flows.md#release-safety-probe)
(`DEVT-REL-04`) fails a release build whose JavaScript contains the inspector's marker.

## Profiling

Development builds on macOS profile every JavaScript runtime at once with Hermes's sampling profiler and record a
**frame timeline** of the main thread and MotionView animations, saved as one Chrome trace. React Native DevTools
profiles, traces and snapshots the heap of the one runtime it is attached to.

- **Developer › Start Profiling** starts a recording; **Developer › Stop Profiling…** asks for a folder and saves it
  there. Both act on the whole app, whatever window is key.
- From code, `startProfiling()` and `stopProfiling()`:

```ts
import { addProfilingListener, getProfilerAvailability, isProfiling, startProfiling, stopProfiling } from "@legendapp/spark/devtools";

getProfilerAvailability();                     // { available: true } | { available: false, reason }
await startProfiling({ samplesPerSecond: 1000 });
// ... the work to profile
const result = await stopProfiling({ directory: "/Users/me/Profiles" }); // default: a new temporary directory
result.trace;    // .../spark-profiler-20261012-143000-123.trace.json
result.profiles; // [{ runtime: "shared", path: ".../spark-profiler-…-shared.cpuprofile", samples, sourceMaps: "applied" }, …]
result.missing;  // [] or [{ runtime: { isolated: "plugins" }, code: "E_TIMEOUT", message }]
result.frames;   // { frames, droppedFrames, maxFrameGapMs, durationMs, fps, refreshRate }

await isProfiling();                                 // whichever runtime or the Developer menu started it
const subscription = addProfilingListener(recording => console.log(recording));
subscription.remove();
```

`getProfilerAvailability()` reports `unsupported-platform` outside macOS, `development-only` without `__DEV__`, and
`missing-module` if `@legendapp/spark/runtime-entry` did not install it. One recording runs per app, whichever runtime
started it. `startProfiling` and `stopProfiling` reject:

| Code | When |
| --- | --- |
| `E_INVALID_ARGUMENT` | `samplesPerSecond` is not an integer from 1 to 10000 (default 1000), or `directory` is not an absolute path |
| `E_UNSUPPORTED_OPTION` | An unknown option |
| `E_UNSUPPORTED_PLATFORM`, `E_UNAVAILABLE`, `E_MODULE_UNAVAILABLE` | Unavailable, as `getProfilerAvailability()` reports |
| `E_BUSY` | `startProfiling` while a recording runs |
| `E_UNAVAILABLE` | `startProfiling` without a display: the frame timeline needs one |
| `E_NOT_FOUND` | `stopProfiling` with nothing recording, or a `directory` that is not an existing directory; the recording keeps running |
| `E_ALREADY_EXISTS` | Files of those names are already in `directory`, even after trying 19 other names; nothing is replaced |

A runtime whose samples cannot be collected does not fail the recording: the other runtimes' profiles are written, and
`missing` lists it with `E_TIMEOUT` (its JavaScript thread did not hand over its samples within 10 s), `E_UNAVAILABLE`
(it is not Hermes) or `E_INVALID_DATA` (Hermes's profile was unreadable). `isProfiling()` and
`addProfilingListener(listener)` follow the app's one recording, so a screen can show a recording the Developer menu or
another runtime started. Writing happens on a background queue, never on the main thread.

`stopProfiling` writes, into `directory`:

- `spark-profiler-<time>.trace.json` (`<time>` is local time to the millisecond; when those names are taken it adds
  `-2`, `-3`… rather than lose the recording): a Chrome trace (Trace Event Format) for Chrome DevTools' Performance panel,
  React Native DevTools or [Perfetto](https://ui.perfetto.dev). It has a track for the main thread's frames, a
  compositor track with each MotionView's animation, and a track per JavaScript runtime with its sampled stacks, all
  on one clock.
- `spark-profiler-<time>-shared.cpuprofile` and `spark-profiler-<time>-isolated-<name>.cpuprofile` (characters other
  than letters, digits, `_` and `-` become `-`, and names that then collide get `-2`, `-3`…): each runtime's samples in the DevTools `Profiler.Profile` format, which Chrome DevTools and speedscope open.

Stacks are source-mapped: each frame names its source file and line, through the development server's `/symbolicate`
endpoint (Metro's, which LogBox uses). A profile reports `sourceMaps: "applied"` only when at least one frame was
mapped; otherwise `"unavailable"` with the `reason` (no server, an error, a profile with no bundle frames, or source maps
that cover none of them), and its frames keep their bundle positions.

#### With React Native DevTools

Hermes has one sampling profiler per process, and React Native DevTools' JavaScript profiler and Performance panel
drive the same one. They do not tell each other:

- Hermes ignores a second start while sampling runs, so `startProfiling` during a DevTools recording resolves but
  shares DevTools' sampling rate, and DevTools started during a Spark recording shares Spark's.
- Either side's stop turns sampling off for both, so whichever stops second has no samples after the first stop.
- `isProfiling()` and the Developer menu reflect only Spark's recordings.

Record with one at a time. Detecting a DevTools recording and rejecting `E_BUSY` is
[#409](https://github.com/LegendApp/legend-spark/issues/409).

### Frame timeline

The frame timeline is the same recorder as the test driver's frame counter (`startFrames` and `stopFrames`,
[test-driver.md](test-driver.md#frame-timing)): a display link on the main screen in the common run loop modes at the
display's maximum rate. Every callback is a frame the main thread was free to produce; a gap of more than one refresh
interval is drawn as a `Dropped <n> frames` slice. Each frame also records which MotionViews are animating, by
testID (or `MotionView <tag>`), from `@legendapp/spark/motion`'s engine, which become the compositor track's slices.
It measures the main thread's cadence, not what the window server composited (#50). A recording keeps the
timestamps of its first 72,000 frames (10 minutes at 120 Hz) and its first 10,000 motion slices, and still counts
every frame; `truncated` says it dropped some.

The release gate's frame budgets use the same telemetry: `assertFrames`
([e2e-flows.md](e2e-flows.md#motion-and-frames)) counts frames on this recorder, and with `trace: true` records the
timeline too and writes it with the same trace
builder (`packages/desktop-app/src/profiler/trace.ts`) as the artifact `frames-<n>.trace.json`, so a failed frame
budget opens in the same tools as a developer's profile
([#163](https://github.com/LegendApp/legend-spark/issues/163)).

### Heap snapshots and allocation timelines

React Native DevTools' **Memory** panel takes heap snapshots, records allocation timelines and samples allocations
of the runtime it is attached to (Hermes's `HeapProfiler` domain). Each runtime is its own target, so a snapshot holds
only that runtime's heap: open DevTools for an isolated runtime (`openDevTools({ runtime: { isolated: name } })`, or
Developer › Open DevTools in its window) to snapshot it. The **Performance** panel records the attached runtime's
JavaScript samples too.

### How the profiler works

`@legendapp/spark/runtime-entry` installs it inside `if (__DEV__)` on macOS, in every JavaScript runtime
(`packages/desktop-app/src/profiler/`). Its native half, `packages/desktop-app/macos/SparkProfiler.mm`, compiles only
when `RCT_DEV`. Start enables Hermes's sampling profiler, which samples every Hermes runtime React Native registered for
profiling, and starts the frame timeline. Stop disables it and collects each running runtime's samples on that
runtime's own JavaScript thread, through its `NativeDesktopApp` module's call invoker, then JavaScript source-maps
them, builds the trace and asks native code to write the files.

Release bundles contain none of it: Metro removes the `__DEV__` branch and the module with it, and release builds
compile none of `SparkProfiler.mm` (`tests/developer-menu-release.test.ts`). The release gate's
[release-safety probe](e2e-flows.md#release-safety-probe) (`DEVT-REL-05`) fails a release build whose JavaScript or
native code contains the profiler's marker (`spark-profiler`, which starts every file name it writes). The frame
timeline's recorder (`SparkFrameTimeline.mm`) also compiles into builds with the test driver, which the gate needs; it
holds no profiler code.

## Release builds

React Native compiles `RCT_DEV` to 0 in release builds, which removes Spark's ⌥⌘I monitor, the target lookup and the
native `openDevTools` operation. React Native registers debug targets only when Fusebox is enabled, which it is in
development builds only. In JavaScript, `getDevToolsAvailability()` reports `development-only` and `openDevTools`
rejects `E_UNAVAILABLE` without native work. `tests/devtools.test.ts` checks these guards in the sources. The release
gate's [release-safety probe](e2e-flows.md#release-safety-probe) ([#274](https://github.com/LegendApp/legend-spark/issues/274))
runs the release build pointed at a decoy development server and fails if it connects to it, holds a network or
listening socket, shows a Developer menu or other debug menu item, has the network inspector in its JavaScript, or has
the profiler in its JavaScript or native code.

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
DevTools. It serves the worker entry isolated runtimes load, the source maps and `/symbolicate`
([e2e-flows.md](e2e-flows.md#the-driver-backend)), so `build: dev` flows run worker runtimes and get source-mapped
profiles (`e2e/dev-flows/devtools/profiling-dev.yaml`). `bun scripts/test-devtools.ts` runs a real development session
instead, headless:

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

`bun scripts/test-network-inspector.ts` checks the network inspector the same way, against loopback fixtures
(`scripts/testing/network-fixtures.ts`, 127.0.0.1 only). It attaches to the shared runtime over CDP and runs the
Network screen's scenarios (`screens/devtools/network-demo.ts`): it checks that nothing is recorded or reported
before a session is active and after it ends, and that fetch, XMLHttpRequest, binary uploads and downloads, a
redirect, a streamed response, an abort, a 200 KB body and a WebSocket echo reach the app and the server unchanged
while DevTools gets their events, redacted headers, capped bodies and frames. The Network screen is
`spark-ks://devtools/network`; for a person, `bun scripts/testing/network-fixtures.ts` prints the address to paste
into it.

`bun scripts/test-profiler.ts` checks profiling the same way, on the Kitchen Sink's Profiling screen
(`spark-ks://devtools/profiling`) with its worker runtime running. Over CDP, as React Native DevTools does, it records
each runtime with the `Profiler` domain and maps its samples through the bundle's source map, records a Performance
panel trace, takes a heap snapshot of each runtime (each holds only its own runtime's marker object) and records an
allocation timeline and allocation sampling. Then it calls `startProfiling` and `stopProfiling` while both runtimes
run `screens/devtools/profiling-workload.ts` and a MotionView slides, and checks the errors, the files (written only
into a temporary directory it removes), the source-mapped `fibonacci` frames of each runtime's `.cpuprofile` and trace
track, and the frame and motion tracks. The display link delivers no frames while the display sleeps; the script then
reports the frame checks as skipped instead of failing.

`bun run ks:capture <area>/<screen> --dev-server http://127.0.0.1:<port>` captures a screen with development
JavaScript from a running `spark dev`. The Kitchen Sink's DevTools screen is `spark-ks://devtools/devtools`. Its
checks are in `e2e/checks/devtools.yaml`: release flows in `e2e/flows/devtools/`, and development flows (including
this script, as a manual step) in `e2e/dev-flows/devtools/`.
