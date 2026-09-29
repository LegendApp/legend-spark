<p align="center">
  <img src="assets/branding/legend-spark.png" width="160" alt="Legend Spark logo" />
</p>

# Legend Spark

**Experimental — not ready for production use.** APIs, native implementations, and tooling may change.

Legend Spark is an experimental framework for building native desktop applications with React Native and Expo Desktop. It combines desktop APIs with an Expo-style development workflow: start in **Spark Runner**, the shared development runtime, switch to a custom development build when you need additional native code, and build a standalone application containing the native modules it needs.

The public package is `@legendapp/spark`; the CLI and short name are `spark`.
APIs are imported from paths such as `@legendapp/spark/files` and
`@legendapp/spark/ui`. Private implementation modules are bundled inside the single `@legendapp/spark` archive; they are not published separately.
See the [rename and migration guide](docs/legend-spark-migration.md) when updating
an existing prototype checkout.

Application JavaScript runs in **Hermes**. Node and Bun are development tools; neither is embedded as the application's JavaScript runtime. The UI uses React Native's native renderer.

**Current scope:** macOS 14+ with Apple Silicon and Intel build targets. Intel native compilation and runtime acceptance remain pending; see [Intel macOS](docs/macos-intel.md). The packages, CLI, and native runtime are prototypes. A [transferable SDK with optional Spark Runner runtimes](docs/sdk-distribution.md) works outside the checkout; experimental npm packages use the `next` tag; matching SDK archives and macOS development runtimes are distributed through [GitHub prereleases](https://github.com/LegendApp/legend-spark/releases). Windows x64/ARM64 prebuilt and custom development builds are integrated, with native verification still pending; see the [Windows development guide](docs/windows-slice.md). Mobile/web development delegates to Expo. Linux and Mac App Store distribution are not supported by this framework's current workflow.

The checkout currently targets Expo SDK 54 / React Native 0.81 and pins **Expo Desktop 1.0.0-beta.6**. Expo Desktop owns template creation and native project generation; Expo CLI owns Metro and the development terminal. spark adds desktop actions, runtime compatibility checks, native capabilities, and build orchestration. See the [integration boundary](docs/expo-desktop-integration.md) for the remaining upstream launch requirements.

## Start here

- **Build an app:** follow the [quick start](#quick-start) and [development guide](docs/development.md).
- **Add desktop to an existing Expo app:** use [the integration guide](docs/add-desktop.md) to preserve its entry point and mobile/web setup.
- **Test Windows development:** use the [integrated Windows workflow](docs/windows-slice.md) and `npm run test:windows`.
- **Use desktop APIs:** see the [SDK guide](docs/sdk.md) and [expanded API reference](docs/desktop-api-expansion.md).
- **Try an application:** explore [Kitchen Sink](#explore-the-kitchen-sink), [Notes/Music/Diff Lite](#small-application-examples), or the [native helper example](#native-helper-example).
- **Understand or change the framework:** read [ARCHITECTURE.md](ARCHITECTURE.md), including its source map and implementation invariants.
- **Work on Expo Desktop integration:** start with the [integration handoff](docs/expo-desktop-integration.md).
- **Check what has actually been tested:** see [validation and limitations](#validation-and-limitations). Implementation and recorded acceptance are different things.

## The development model

| Target | Native contents | JavaScript | When to use it |
| --- | --- | --- | --- |
| Spark Runner | The supported SDK and its required native dependencies | Served by Metro | Start developing without compiling a native app |
| Custom development build | The SDK plus the app's additional native dependencies and configuration | Served by Metro | Add a native library or an app-specific native capability |
| Standalone application | The production-selected native module set | Embedded in the application | Run without Metro; prepare a distribution build |

The CLI checks the project's native requirements against the selected runtime. Ordinary JavaScript edits use Fast Refresh. Installing JavaScript-only packages does not itself require native compilation. A changed native dependency, incompatible SDK, or app-specific native configuration can require another binary.

The development terminal explains incompatibilities and offers a build/switch action. It does not silently compile on every file change. Switching binaries or restarting Metro can reset application state.

## Install the experimental prerelease

The release workflow publishes one npm package, `@legendapp/spark`, containing the CLI and private implementation modules. Published prereleases use the `next` tag and require Node 24.19.0 or newer. Bun is optional.

Once the matching npm package and GitHub assets have been published:

```sh
npx @legendapp/spark@next create MyApp
cd MyApp
npm run macos
```

The published CLI resolves patched dependencies from the matching GitHub prerelease and downloads the macOS ARM64 Spark Runner on first desktop launch. A source/local archive without embedded release metadata still needs a registered local SDK. Windows native acceptance remains pending; this release workflow does not supply a Windows Runner.

## Quick start from source

The steps below are for macOS; use the [Windows guide](docs/windows-slice.md) for its native prerequisites and development-only workflow.

This is a **local SDK workflow**. Run the following from a clone of this repository, not from a newly created consumer app.

### 1. Prepare the SDK

You need Node 24.19.0 or newer and npm, pnpm, Yarn, or Bun as your package manager. Bun is optional; the CLI and SDK installer run on Node. The repository tests and integration scripts also run on Node. Building native binaries also requires a Mac, full Xcode with first-launch setup completed, and CocoaPods. The SDK pack step uses Git and tar, and fetches pinned upstream Runtimes source and library archives on its first run. Patches are applied in JavaScript.

```sh
npm install
npm run typecheck
npm test
npm run spark -- sdk pack
npm run spark -- sdk build-runner
```

Use Node 24.19.0 (`nvm install && nvm use` in this checkout). Older Node 24 releases can fail on Expo Desktop beta's CommonJS imports; see [native prerequisites](docs/development.md#native-prerequisites).

`pack` creates SDK package archives and Expo Desktop-compatible application templates, then registers their manifest. `build-runner` creates or refreshes the SDK's managed build project, compiles the generic native runtime, and registers it for app development.

If you already have a compatible runtime, register it instead of building it:

```sh
npm run spark -- sdk register /absolute/path/to/SparkRunner.app
```

Registration records the path; keep the binary at that location. A compatible Spark Runner can be launched without invoking Xcode, CocoaPods, or codegen. Native build tools are needed when creating or rebuilding a binary.

### 2. Create and run an app

After preparing the SDK, run from the framework checkout:

```sh
npm run spark -- create /tmp/MySparkApp
cd /tmp/MySparkApp
npm run macos
```

`npm run macos`, `npm start`, and `npm run dev` all run the same managed development session. The CLI discovers the registered runtime and chooses an available Metro port. The terminal provides actions to open, reload, debug, change runtime, build when required, and quit.

Edit `App.tsx` to change the application. The development terminal is Expo CLI with desktop actions: `d` opens macOS or Windows, `g` switches Spark Runner/development build, `b` builds when required, and Ctrl+C exits. Expo retains its normal reload, debugger, mobile, and web keys. See the [development guide](docs/development.md) for flags, logs, debugger behavior, and adding native dependencies.

### 3. Build a standalone app

From the generated application:

```sh
npm run build
```

This produces a local ad-hoc-signed `.app` with embedded JavaScript and prints its path. It runs without the development server. To reopen the last standalone build:

```sh
npx --no-install spark open
```

To prepare a Developer ID-signed, notarized distribution ZIP:

```sh
npm run package
```

Packaging requires signing credentials and a notarization profile. It signs a staging copy, supports resuming a pending submission, and validates the final archive. It does not publish the app. Read the [packaging guide](docs/packaging.md), especially its validation status, before relying on this as a production release pipeline.

## Windows development

Windows uses the same CLI, starter, prebuilt registry, native compatibility checks, and managed Metro session. The Windows starter includes the native host; the SDK prebuilt profile includes the desktop modules and external integrations. Their Windows source implementations are ready for native acceptance. There is no separate source kit to install.

On Windows 11 x64 or ARM64 (including Parallels), install the prerequisites in the [Windows guide](docs/windows-slice.md), including Visual Studio 2026 / MSVC v145 for the pinned RNW 0.81.35 template. Then run from the framework checkout:

```powershell
npm install
npm run spark -- sdk pack --platform windows
npm run spark -- sdk build-runner --platform windows
npm run spark -- create C:\dev\MySparkApp --platform windows
cd C:\dev\MySparkApp
npm run windows
```

Creation defaults to Windows on a Windows machine. `npm run windows`, `npm run dev`, and `npm start` enter the normal `spark dev` session. Additional Windows native dependencies use the normal custom-build path: the session detects incompatible prebuilt code and offers `b`, or you can run `npx --no-install spark build --dev` explicitly. Windows builds default to the native CPU architecture, including ARM64 on Apple Silicon Parallels; runtime registration distinguishes Windows/x64, Windows/arm64, macOS/arm64, and macOS/x64. See the Windows guide for the ARM64 compiler tools and `SPARK_WINDOWS_ARCH` override.

For the automated prebuilt → Fast Refresh → added native module → custom-build check, run from the framework checkout with a fresh destination:

```powershell
npm run test:windows -- --project C:\dev\SparkWindowsVerification
```

The verifier uses the real CLI and existing native-greeting fixture, and saves `.spark/windows-verification.json` plus `.spark/logs`. On macOS, `npm run test:windows:prepare -- --project /tmp/SparkWindowsCheck` checks generation and both development bundles without executing a native binary.

Windows host source now includes display enumeration, window frame/centering/fullscreen operations, size constraints and basic presentation options, menu following between React windows, and an atomic single-instance guard. The native UI package implements React Native Appearance overrides for WinUI controls. Run `npm run test:windows:features` on Windows to compile and exercise these additions, including simultaneous launches and owner-termination recovery.

**Native Windows verification is still pending.** Local generation/bundle checks do not prove compilation, autolinking, Hermes startup, or Fast Refresh on Windows. Windows production builds, preview builds, signing/MSIX, and clean-machine runtime distribution are outside this development scope. Desktop modules, Nitro, SQLite, WebView2, and secondary Hermes runtimes now have Windows integrations; run `npm run test:platform -- --platform windows` to exercise their shared contracts. See the [Windows guide](docs/windows-slice.md) for the full setup, test, and diagnostic workflow.

## What the SDK provides

The feature set below describes the macOS SDK; it is not a Windows API support matrix.

Framework-owned capabilities are imported from `@legendapp/spark/<feature>`. Use individual entry points so production analysis can associate JavaScript imports with native modules.

| Area | Entry points and capabilities |
| --- | --- |
| Application and windows | `app`, `windows`: identity, lifecycle, single-instance forwarding, secondary React roots, window styles, spark restoration, close/quit guards |
| Files and persistence | `files`, `settings`, `secure-storage`: filesystem operations, bounded binary streaming and positional I/O, recursive watches, Trash/Recycle Bin, JSON settings, project-scoped Keychain values |
| Desktop commands | `menus`, `context-menu`, `shortcuts`, `global-shortcuts`: menus, command handling, focused and system-wide shortcuts |
| User interaction | `dialogs`, `message-dialog`, `clipboard`, `drag-drop`: file panels, alerts, clipboard formats, drag sources and drop targets |
| OS integration | `links`, `notifications`, `tray`, `system`: URLs/documents, local notifications, menu-bar items, Dock/startup/power integration |
| Processes and distribution | `processes`, `updates`: child process I/O, timeouts and managed target-specific helper bundles, signed whole-app update integration |
| Native controls and styling | `@legendapp/spark/ui`: native buttons, text inputs and selects; optional Uniwind bindings and system/light/dark themes |
| Audio and authentication | `@legendapp/spark/audio`, `@legendapp/spark/auth-session`: playback and system media controls, external-browser authentication callback transport |
| External libraries | React Native WebView, OP-SQLite, and Margelo Runtimes; see [integrated external libraries](docs/external-libraries.md) |

For example, application code can use project-scoped storage without a Node filesystem API:

```ts
import { getDirectory, writeText } from '@legendapp/spark/files';
import { settings } from '@legendapp/spark/settings';

const dataDirectory = await getDirectory('data');
await writeText(`${dataDirectory}/draft.txt`, 'Hello from spark');
await settings.set('theme', 'dark');
```

The SDK guide documents error behavior, disposal, event delivery, and platform-specific coordinate systems. Project-scoped storage separates app identities; it is not an OS security sandbox.

For large files, `readChunks` and `writeChunks` transfer bounded `Uint8Array`
chunks without loading the entire file into JavaScript. `openFile` exposes
positional reads/writes and explicit flush/close. Iteration closes its handle on
completion, cancellation, errors, or an early loop exit. `trash(path)` moves an
item to the OS Trash/Recycle Bin and rejects if recycling is unavailable; it does
not fall back to permanent deletion. See [streaming files and Trash](docs/file-streams.md)
for limits, partial-write behavior, and platform acceptance.

For external libraries, prefer their upstream imports and documentation. spark supplies integration, native setup, tested pins, and supported production pruning. For example, background work uses `@react-native-runtimes/core` directly. It runs in independent Hermes heaps inside the application process and ends when the app quits. Read the [Runtimes guide](docs/runtimes.md) for serialization, cleanup, native-module restrictions, and production reachability.

## One app for mobile, web, and desktop

`npm run settings /tmp/MySettings` packs the shared Settings template and creates it through Expo Desktop beta. It uses the existing capability adapters, ordinary React Native layout, and native `Button`, `TextInput`, and `Select` controls from `@legendapp/spark/ui`. Mobile controls use the pinned Expo UI backend; desktop and web select their own implementations. The starter uses [Uniwind](docs/styling.md) for responsive layout and light/dark/system themes, with optional native control bindings at `@legendapp/spark/ui/uniwind`. Ordinary `style` props remain supported.

Run `npm run web`, `npm run ios`, `npm run android`, or `npm run macos` inside the generated app. Native targets first need their development build. Windows uses WinUI controls with visible, noninteractive fallbacks if native initialization fails; native Windows acceptance is still pending. Track remaining work in [known Windows issues](docs/windows-issues.md). See [the shared Settings guide](docs/universal-settings.md) for build commands, platform status, and verification.

A universal project declares all targets together. Switching with `--platform` preserves its shared configuration/source and the other generated native projects. Router integration and declarative windows remain deferred.

## Application configuration

New starters use static `desktop.config.json`. For single-target desktop starters, the CLI validates it and generates the `app.json` consumed by Expo Desktop. Universal starters use a managed dynamic `app.config.js` and target-specific overrides instead. Legacy projects containing only `app.json` remain supported. When desktop config is present, edit that source rather than the generated Expo file.

A typical generated configuration looks like this; retain the `projectId` assigned to your app:

```json
{
  "$schema": "./node_modules/@legendapp/spark/schema.json",
  "name": "MySparkApp",
  "projectId": "f478dff4-f9a1-4ff2-8096-64df89e1c470",
  "version": "0.0.1",
  "window": { "size": { "width": 1000, "height": 700 }, "restoreBounds": true },
  "macos": { "bundleIdentifier": "com.example.mysparkapp" }
}
```

The stable project ID scopes storage and runtime identity across renames and builds. Window settings can be supplied to the Spark Runner. Registering URL/document associations, configuring a menu-bar-only app or update feed, and embedding helper executables require a custom binary. The CLI also checks additional config plugins and native settings.

See [desktop configuration](docs/desktop-api-expansion.md#configuration) for fields and [architecture](ARCHITECTURE.md#configuration-and-identity) for ownership rules. Dynamic application config and unrelated JavaScript entry bundles are outside the current supported model.

## Explore the kitchen sink

Kitchen Sink is a checked-in app. From the checkout:

```sh
cd examples/kitchen-sink
npm install
npm run macos
# Or on Windows:
npm run windows
```

The app uses workspace packages and the repository lockfile. Installation applies
checked-in desktop library adapters; startup delegates to the normal spark/Expo
CLI. It does not create a second app, pack SDK archives, or compile native code.
Edit the screens and CSS directly for Fast Refresh. `npm run kitchen-sink` from the
repository root is a shortcut for this app's `dev` command.

A matching native Spark Runner must be registered. There is no hosted download
service yet. If you do not have one, explicitly run `npm run rebuild:macos` or
`npm run rebuild:windows` from the app directory with the native toolchain installed.
That builds and registers its reusable runtime; repeat only after native changes.
See the [Kitchen Sink guide](examples/kitchen-sink/README.md) for registration and
startup options.

`npm run kitchen-sink:prepare` remains a separate packed-SDK consumer test. It does
not modify the checked-in app's manifest, configuration, or native projects.

The example exercises desktop APIs with windows, an editor, menus, persistence, and an event log. **Test streaming files and Trash** runs binary file checks and recycles one clearly named disposable test file; it does not touch user-selected files. Its actions use native buttons and show progress, results, and errors beneath the button; each demo also shows its recent callback events, and the event log retains detailed output. The header theme button cycles System → Light → Dark → System, starting with the system appearance; Uniwind tokens theme the screen and React Native Appearance updates native controls.

## Commands and tests

Run framework commands from this repository; run app commands from a generated application.

| Location | Command | Purpose |
| --- | --- | --- |
| Framework | `npm run spark -- sdk pack` | Pack and register local SDK archives |
| Framework | `npm run spark -- sdk build-runner` | Build/register the generic runtime |
| Framework | `npm run spark -- create <directory>` | Create a consumer from the packaged starter |
| App | `npm run macos` / `npm run windows` / `npm run dev` / `npm start` | Managed development session for the project target |
| App | `npx --no-install spark build --dev` | Build an app-specific development runtime |
| Framework | `npm run test:windows` | Verify the integrated Windows native development path |
| Framework | `npm run test:windows:prepare` | Check Windows generation and development bundles without native execution |
| App | `npx --no-install spark analyze` | Explain macOS production native module selection |
| App | `npm run build` | Build a standalone macOS Release app |
| App | `npm run package` | Prepare a signed, notarized macOS distribution archive |
| App | `npm run doctor` | Diagnose native build prerequisites |

For framework changes, begin with the checks relevant to the change:

```sh
npm run typecheck
npm test
```

Native integration checks are separate and require Xcode, CocoaPods, and an unlocked/logged-in macOS desktop where UI interaction is involved:

```sh
npm run test:native
npm run test:expansion
npm run test:runtimes:all
# Streaming/Trash checks; builds a Kitchen Sink development runtime:
node scripts/test-file-streams.ts
# Helper checks; reuses that development runtime:
node scripts/test-sidecars.ts
# Complete configured suite, including native builds:
npm run test:all
```

`test:all` does not include every standalone probe above; run the file and helper probes separately when changing those APIs. `test:all` is substantial: it includes packaging/update tests, desktop integration tests, native application builds, and the Runtimes matrix. See [SDK tests](docs/sdk.md#tests), [Runtimes tests](docs/runtimes.md), and the root [package.json](package.json) for the current commands and prerequisites. Use an external packed consumer to verify distribution behavior; workspace symlinks alone cannot prove the CLI archive is complete.

## Validation and limitations

Use the [Mac and Windows manual acceptance checklist](docs/desktop-manual-acceptance.md)
to validate a checkout on real machines, including runtime rebuilds and OS interactions.

The macOS prebuilt → custom runtime → reduced standalone workflow has recorded native validation. Desktop API expansion and integrated background runtimes have their own dated reports. Test counts and feature coverage change; consult the specific report rather than treating an old count as the current suite size.

| Evidence | What it covers |
| --- | --- |
| [macOS readiness — September 18](docs/macos-readiness-2026-09-18.md) | Current native/UI checks, rapid-window-close fix, and unresolved acceptance cases |
| [Prototype status](docs/prototype-status.md) | Original workflow, milestones, and remaining release gates |
| [SDK validation](docs/sdk-validation.md) | Initial desktop SDK and project isolation |
| [Desktop expansion validation](docs/desktop-expansion-validation.md) | Expanded APIs, native pruning, and interactive acceptance limits |
| [Integration validation](docs/integrations-validation.md) | Notifications, tray, updater startup and signing tooling |
| [Runtimes validation](docs/runtimes-validation.md) | Direct upstream imports, worker behavior, reload, and pruned Release builds |
| [Streaming files and Trash](docs/file-streams.md#acceptance) | Native macOS binary I/O, handle cleanup and Trash; Windows acceptance pending |
| [Helper-process example](examples/sidecar/README.md#complete-requestresponse-example) | Framed requests, deadlines, crash/restart and native macOS process/quit cleanup |
| [Windows development](docs/windows-slice.md) | Integrated CLI, generation and bundle checks; native acceptance pending |
| [Packaging status](docs/packaging.md#validation-status) | Simulated notarization pipeline versus real distribution acceptance |

Automatic SDK/runtime downloads, real Developer ID/notarization acceptance, production update installation/relaunch, and broader platform support remain separate release gates. Some OS interaction cases also remain outstanding in their feature reports. No current test result establishes full Windows support.

## Repository and documentation

The main boundaries are `packages/cli` for orchestration, `packages/config-plugin` for configuration/native generation, `packages/desktop-host` for application startup, and feature packages for desktop APIs. `packages/desktop` provides the public framework entry points. `scripts`, `fixtures`, and `examples` provide packaging and validation workflows.

[ARCHITECTURE.md](ARCHITECTURE.md) explains these boundaries, runtime compatibility, production pruning, generated artifacts, and where to change code. It also documents the integrated Windows adapter and the work remaining beyond the development slice. The [Expo Desktop handoff](docs/expo-desktop-integration.md) documents the beta.6 `--binary` implementation and the remaining session/build contracts needed to delegate desktop launching.

The [Expo API adapters](docs/expo-api-adapters.md) document the current clipboard, secure-storage, and linking migration and its kitchen-sink checks. [Native UI](docs/ui.md) starts with an AppKit button and Expo UI mobile adapters. The [API ownership policy](docs/external-libraries.md#public-contracts-and-replaceable-implementations) describes stable framework contracts with replaceable native, Expo, or community implementations. Router integration and the broader UI catalog remain deferred.

The [universal API plan](docs/universal-api-plan.md) proposes one web/mobile/desktop codebase, Expo-aligned capability APIs, Expo UI adapters, and declarative window presentation through Expo Router. It is awaiting review and does not describe implemented functionality. The earlier [API structure review](docs/api-structure-review.md) retains the current SDK inventory.

Use the [implementation plan](docs/implementation-plan.md) for original decisions and milestones; newer feature guides and dated validation reports describe subsequent work. These documents describe an evolving source checkout, not a claim that every feature is published or production-qualified.

## Shared application and SDK transfer

`spark create MyEditor --example document-editor` creates a [shared document editor](docs/document-editor.md) using Expo adapters on mobile, browser file operations on web, and native desktop dialogs. The macOS example exercises windows, menus, shortcuts, file-open events, and unsaved-change guards. Windows includes native control/API/file-dialog implementations, with remaining native acceptance and lifecycle gaps listed in [known Windows issues](docs/windows-issues.md).

[SDK export/import](docs/sdk-distribution.md) packages the CLI, module archives, and optional Spark Runner runtimes into a transferable directory. The recipient installs it without this checkout; Expo Desktop beta still owns creation and desktop generation, and spark retains native compatibility checks.

## Small application examples

[Notes Lite, Music Lite, and Diff Lite](docs/example-apps.md) are standalone universal
CLI examples, created with `spark create MyApp --example notes-lite` (or
`music-lite` / `diff-lite`). They share application models and screens, with
platform files for native lifecycle, selected-file access, and playback. Source
ships with the CLI and depends only on public package imports.

Notes Lite includes search, import/export, recoverable deletion, appearance settings,
and desktop window/session restoration. See its [acceptance checklist](docs/notes-lite-acceptance.md)
for save failures, recovery, and multiwindow behavior.

The examples use upstream AsyncStorage with project-scoped keys and recoverable
snapshots. The unpackaged Windows host configures its supported database-path
override. The small [audio contract](docs/audio.md) delegates to Expo Audio on
mobile, AVPlayer on macOS, MediaPlayer on Windows, and HTML audio on web. Queue and
note models remain application-owned. The maintained prebuilt profile now includes audio
and AsyncStorage; existing clients require a rebuild for those native additions.

Windows host source also supplies window roots sharing the host's React runtime,
close/quit guards, focused shortcuts, basic menus, spark restoration, and launch
forwarding. Native compilation and acceptance remain tracked in
[known Windows issues](docs/windows-issues.md); generated bundles do not prove them.
See [extension development](docs/extensions.md) for adding a native library or
replacing a backend while preserving a framework contract.

## Native helper example

Use an app-supplied executable for work outside Hermes. The framework packages
helpers by OS/architecture and manages process I/O and lifetime; it does not
bundle Node. The [complete C helper example](examples/sidecar/README.md#complete-requestresponse-example)
includes a React screen, binary request/response framing, readiness, concurrent
requests, timeouts, crash handling, explicit restart, and shutdown cleanup.

From the framework checkout, with the native toolchain installed:

```sh
npm run pack:local
node scripts/prepare-sidecar.ts /absolute/path/to/HelperDemo
cd /absolute/path/to/HelperDemo
npm run macos
# On Windows, use a fresh Windows path and run npm run windows instead.
```

The preparer compiles the worker and creates an independent consumer app. On
Windows, run it in a Visual Studio developer shell targeting the native architecture.
Choose **Build** in the development terminal: app-owned helpers require a custom
runtime and are not included in the generic Spark Runner. Later JavaScript
edits use Fast Refresh; helper binary changes require rebuilding. A helper is not
a persistent background service. See [sidecar lifecycle limits](docs/sidecars.md).

## Cross-platform acceptance

Run `npm run test:platform -- --platform macos` (or `windows`, `ios`, `android`, `web`) for a fresh shared test app. `--prepare-only` checks generation/bundling; `--api-only` runs API assertions without claiming UI acceptance. Collect JSON reports from each machine and run `npm run test:report -- --output .spark/platform-coverage.md` to see passed, failed, missing, inapplicable, and untested cases. See [platform testing](docs/platform-testing.md) for devices, commands, cleanup, and current coverage.

App-supplied backend executables can be packaged as target-specific helper bundles. See the [sidecar guide](docs/sidecars.md) for configuration, lifecycle, distribution limits, and a runnable C example. No Node runtime is included.

See [desktop foundations](docs/desktop-foundations.md) for nonactivating overlay windows, recursive directory watching, and custom drag payloads with hover and copy/move/link negotiation. Kitchen Sink demonstrates these contracts; Windows native acceptance remains pending.

Optional [audio/media sessions](docs/audio.md) and [browser authentication](docs/auth-session.md) provide system media controls and external-browser callback transport. Provider SDKs, queues, and OAuth token exchange remain application/library responsibilities.

Release maintainers: see the [preview release workflow](docs/releases.md) for Runner signing, artifact staging, publishing order, and clean-machine acceptance.
