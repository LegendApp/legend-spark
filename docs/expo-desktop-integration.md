# Expo Desktop integration

spark delegates project creation and native generation to the tested Expo Desktop release. The pinned CLI is `expo-desktop@1.0.0`; desktop native generation uses `expo-desktop-template-bare-minimum@54.81.1`. Config plugins are pinned to `expo-desktop-config-plugins@1.2.0`. Metro config is `54.81.0` (its `@expo/metro-config` and `@react-native/metro-config` are overridden to the SDK 58 versions); modules-core and stubs are `54.0.14`. The app baseline is Expo 58 / React Native 0.88.0-rc.4; no Expo Desktop release targets SDK 58 yet. Spark pins RN macOS `0.88.0-rc.4` and RN Windows `0.81.35` in overrides as well as direct dependencies, preventing the upstream native template from installing conflicting desktop versions.

## Ownership

| Responsibility | Owner |
| --- | --- |
| Validate destination/name, extract starter, assign native IDs, install dependencies, initialize Git | Expo Desktop `create-app --template` |
| Starter files, scripts, dependency matrix, Settings screen | spark's macOS/Windows/universal template packages |
| Initialize stable spark identity and canonical config | One-time template postinstall, using upstream-assigned identity |
| Generate desktop native projects | Expo Desktop `prebuild --template` with spark config plugins |
| Development terminal, Metro lifecycle, reload/debugger, mobile/web actions | Installed Expo CLI; process-local spark desktop-key patch |
| Mobile prebuild/build/run and web development | Installed Expo CLI |
| Standard desktop Metro configuration | Expo Desktop Metro, extended for spark sessions/runtimes |
| Native SDK module selection, compatibility checks, runtime registration, prebuilt switching | spark |
| Desktop build/launch orchestration | spark pending upstream binary/session and build-only contracts (see below) |

The native bare-minimum template remains upstream-owned. spark config plugins add the host and selected capabilities. The small `/ui` and capability adapters are independent of the creation mechanism.

Existing applications can use [`spark add desktop`](add-desktop.md) to compose desktop support into their Expo config and Metro setup. This path preserves the original entry point and mobile/web commands; it does not create an app from a spark template.

## Templates

`packages/cli/templates/blank-typescript`, `windows`, and `universal` are complete application templates. `scripts/pack.ts` first packs SDK dependencies, then `scripts/pack-templates.ts` resolves the local archive paths into the template manifests and packs them. `artifacts/packages/templates.json` maps each variant to its archive.

`spark create` selects that archive and invokes the real Expo Desktop CLI. It does not copy the starter, rename files, replace platform source files, or maintain an extraction implementation. Upstream validates alphanumeric application directory names; parent paths may include spaces.

Each template has an initial `app.json` for upstream naming and native identifier generation, plus spark configuration defaults. After installation, `init-template.cjs` adopts the assigned name, bundle identifiers, and Windows project GUID into spark configuration. It then prepares the existing Expo configuration bridge. An existing spark project ID makes initialization a no-op, preserving subsequent user edits. If installing with lifecycle scripts disabled or creating with `--no-install`, run the template's postinstall after installing dependencies.

The same tarball works with `expo-desktop create-app --template` without going through `spark create`. Local archives contain absolute SDK tarball references, so keep those archives available and repack on another machine. Publishing templates/packages is outside this change.

## Compatibility handling

**npm 12 local template metadata.** In 1.0.0, `npmPackAsync` accepts an array, or a record keyed by the requested package spec. npm 12 returns a record keyed by the package's name when inspecting a local tarball, so lookup by absolute tarball path fails. The CLI includes npm `11.21.0` and puts its small launcher first on PATH only for the creator subprocess. This npm release bundles `tar` `7.5.22`, which includes the fix for [GHSA-23hp-3jrh-7fpw](https://github.com/advisories/GHSA-23hp-3jrh-7fpw). Expo Desktop performs extraction normally and delegates installation to the selected package manager. Global npm and upstream source remain unchanged.

For direct template creation, use npm 11 on PATH. The installed CLI's `src/npm-bin` directory supplies the same scoped compatibility launcher; `test:templates` exercises this path. Remove this adapter once upstream accepts npm 12 local-tarball metadata and the direct-creation checks pass.

**Prebuild dependency preservation.** The pinned release accepts `skipDependencyUpdate`, but its dependency update implementation does not use it. Its bare-minimum template can add dependencies for other platforms even with `--no-install`. spark therefore retains manifest restoration around native generation. On macOS it runs CocoaPods after restoring the intended graph and clearing stale generated bindings. Native generation/build commands against one checkout must remain sequential.

**Desktop run/launch.** The stable CLI includes `run macos --binary` and `run windows`. The macOS binary path still ensures a native project and resolves Xcode metadata before launching. With 1.0.0, the JavaScript-only probe enters prebuild and fails on the missing Windows-config assertion. The existing-project probe fails because port 8081 belongs to another Metro session, despite `--no-bundler` and a free port supplied through `RCT_METRO_PORT`. The OS launcher is intercepted in this probe; it does not establish native launch correctness. Upstream's launcher still does not provide Spark's app arguments, connection settings, or owned app process, and there is no macOS build-only switch to finalize/register an artifact before launch.

spark therefore retains desktop compilation and process ownership, module selection, build records, and prebuilt compatibility checks. App scripts continue to use spark's development command, which delegates the terminal and Metro to Expo. Changing them directly to `expo-desktop run macos` would bypass this integration. Mobile/web already delegate to Expo's supported commands. See the [beta.6 handoff](expo-desktop-beta6-handoff.md) for reproductions and the proposed delegation boundary.

## React Native macOS Fabric lifecycle compatibility

The pinned `react-native-macos@0.81.7` starts Fabric surfaces asynchronously. An
immediate secondary-window close can stop the shadow tree before startup finishes
installing its animation driver. spark applies `fabric-lifecycle.cjs` from its
config plugin during macOS Podfile generation, before compilation. It serializes
startup/setup with stop, cancels obsolete queued starts and detaches, and tracks
attachment so repeated stops are safe. No timer or minimum window lifetime is
required.

This is a native-source compatibility patch, not an Expo CLI change. It checks the
RN macOS version and exact lifecycle source, is idempotent, and atomically replaces
the installed file to preserve package-manager hardlinks. An unexpected upstream
version/source fails with a review instruction. Review/remove this patch when RN
macOS incorporates an equivalent fix. The plugin ships it in SDK archives and its
source affects runtime compatibility; existing runtimes need a rebuild.

Regression: `bun scripts/test-sidecars.ts` performs 50 immediate window open/close
cycles per run and checks that the app-owned helper survives. After building the
Kitchen Sink development runtime, `bun scripts/test-fabric-reload.ts` verifies
three full React Native reloads with ten immediate window-close cycles per JS
session. See the
[dated macOS report](macos-readiness-2026-09-18.md#fix-and-regression-evidence).

## RN macOS keyboard compatibility patch

The config plugin also patches `react-native-macos@0.81.7` keyboard event handling.
An internal legacy `RCTView` hosted inside Fabric (including WebView) can lack a
React tag. Untagged keyboard events now return nil rather than constructing an
invalid event. `RCTView` only marks JS delivery complete when an event and
its dispatcher exist, preserving propagation and native key filters.

`keyboard-events.cjs` validates both source edits before applying them, rejects
unexpected versions/source, and replaces installed files atomically to preserve
package cache hardlinks. It ships with desktop-config and participates in runtime
compatibility. Existing runtimes need a native rebuild. Review/remove this patch
when upgrading RN macOS. `bun scripts/test-keyboard-events.ts` builds and exercises
the native regression; see [macOS evidence](macos-readiness-2026-09-18.md#webview-keyboard-follow-up).

`expo-root-view-factory.cjs` patches `expo@58.0.7`'s `EXReactRootViewFactory.mm`.
Its macOS branch assumes react-native-macos before 0.84, where `viewWithModuleName:` had no
`bundleConfiguration:` variant. RN macOS 0.88 routes every variant through that selector, so
the patch overrides it on macOS too. Remove it once Expo gates that branch on the RN macOS version.

## Expo development terminal patch

`spark dev` launches the app's installed `expo start` under Node, inheriting stdin/stdout/stderr. Its Node supervisor retains desktop runtime discovery, compatibility enforcement, native builds and owned app processes. It has no keyboard interface. Desktop actions and results travel over a private JSON IPC channel; no HTTP command endpoint is exposed.

frame consumes its own `--project`, `--platform`, `--runner-binary`, and `--no-open` options and forwards the remaining arguments to Expo. Expo retains `--go`/`--dev-client`, networking, cache clearing, validation, and port selection. Its readiness message supplies the actual port and bundle options.

The shared development config advertises all declared platforms and omits native build overlays. Expo Desktop supplies multi-platform Metro defaults; the desktop runtime gate is selected per request and does not block mobile/web. `desktop.config.json` remains separate. Native builds keep target-specific config and state.

`src/expo-dev-patch.cjs` pins `@expo/cli@54.0.27` and verifies SHA-256 hashes for three upstream modules before loading replacements in memory:

- `commandsTable.js`: place desktop runtime switching after Expo's runtime switch, and desktop opening/building after its platform launch actions, in both compact and expanded help.
- `startInterface.js`: dispatch `d`, `g`, and `b` through the desktop extension; log action failures without ending the session. Existing keys remain Expo's.
- `startAsync.js`: notify the supervisor of the actual native server port and bundle options after startup, including noninteractive sessions.

`expo-dev-preload.cjs` changes module loading only inside this Expo process and restores the loader after the three modules load. Installed files are never rewritten. Forked Metro workers inherit Node's preload arguments but skip the extension. Templates pin the CLI version; an unexpected version or modified source produces an explicit startup error rather than silently losing desktop controls. Projects declaring no desktop platforms and direct `expo start` do not load the patch. Selecting `dev --platform ios`, Android, or web in a desktop-capable project keeps the patch and host desktop keys.

On upgrade, review upstream changes, update the three source hashes and insertion points, and run `bun run test -- tests/expo-dev.test.ts` plus a real packed-consumer session. Verify opening/switching, build failures, reload/debugger, Fast Refresh, compatibility invalidation, restart and Ctrl+C. Windows native actions additionally need a Windows host.

Noninteractive sessions still start Expo and can auto-open a compatible runtime, but they do not accept keyboard commands over a pipe. Automation should use explicit build commands and restart the session; `scripts/test-windows.ts` follows that path.

## Work to pair on with Jamie

- Accept npm 12's record-shaped metadata for local template paths.
- Honor dependency-preservation options during prebuild, including template-only additions, so spark can remove manifest restoration and delegate installation more fully.
- Replace the temporary Expo CLI patch with supported desktop development-session actions and lifecycle hooks. Expo CLI owns the terminal; Expo Desktop could register desktop targets and spark could provide the prebuilt launcher.
- Finish the existing `run macos --binary` contract: skip native generation/Xcode resolution, honor external Metro ownership, and support launch arguments/environment and process lifecycle. Add a macOS build-only mode so spark can finalize and register artifacts before opening them.
- Verify a prebuilt launch from a JavaScript-only directory without Xcode, CocoaPods, codegen, or implicit prebuild. Exercise reload, Fast Refresh, custom-build switching, and two apps sharing a runtime at different ports.

spark should retain runtime selection and compatibility policy while handing standard operations to upstream as those contracts become available. No upstream changes are required for the template creation path implemented here.

## Verification

`bun run test:templates` packs the SDK, creates macOS and Windows consumers through `spark create`, and creates a universal consumer directly through Expo Desktop. It checks identity, ignore-file extraction, configuration preservation, absence of native generation during creation, and consumer TypeScript. The consumers use a parent directory containing spaces.

`bun run test:universal` checks real mobile/Windows generation, all five shared-screen bundles, and preservation across target switching. `bun run test:windows:prepare` checks the Windows starter, native fixture addition, and runtime compatibility metadata without claiming Windows native execution.

Validated on macOS on 2026-09-13: 131 unit tests (564 assertions), workspace TypeScript, all three template consumers including direct upstream creation, iOS/Android/Windows native generation, and all five universal Settings bundles. The Windows preparation check also passed for both the starter and the added native-greeting module, including prebuilt incompatibility detection. Windows native compilation and execution still require a Windows machine.

Validated the Expo terminal patch on macOS on 2026-09-14: workspace TypeScript and 163 unit tests passed. A packed kitchen-sink consumer started the real Expo terminal, opened Spark Runner, switched to the missing-development-build state and back without compiling, reloaded through Expo, and launched DevTools. Native configuration invalidation blocked bundles with HTTP 409 and disconnected the owned Hermes runtime; restoring configuration restarted Expo. Fast Refresh delivered source edits, with zero idle updates over 12 seconds. Ctrl+C closed the session. Tests cover simulated Windows key selection, IPC dispatch, build-error recovery, version/source mismatch rejection, and worker preload isolation; native Windows launch and an actual build through the new key remain unverified.


Validated shared development sessions on macOS on 2026-09-14: TypeScript and 168 unit tests (750 assertions) passed. `test:universal:dev` served all five Settings graphs from one Expo process, preserved the platform UI/Uniwind backends, blocked only the incompatible host desktop's bundle, delivered one source edit to iOS and web HMR clients, restarted with desktop still incompatible, and removed the session/server on shutdown. Expo `--clear`, `--offline`, `--go`, and `-p` were exercised. `test:add-desktop` also passed; an additional live shared session preserved the adopted app's original entry, custom Metro resolver, plugin output, and all-platform manifest. These checks do not claim native app execution.

Configuration bridge code participates in spark's conservative native signatures. Rebuild/re-register prebuilt against the repacked SDK when updating existing consumers to this change; the compatibility gate will reject an older host signature.

Validated beta.6 on macOS on 2026-09-16: workspace TypeScript, 226 unit tests (1,017 assertions), and Kitchen Sink native generation/build passed. All four desktop-foundation native probes passed (recursive watching, overlay focus, panel transparency/level, and custom drag negotiation). The upstream binary orchestration probe reproduced the blockers documented above; OS launch was intercepted, so it does not establish upstream native launch correctness. Windows native acceptance remains pending.

Validated stable 1.0.0 on macOS arm64 on 2026-10-07: workspace TypeScript and
131 test files / 707 tests; frozen Bun installation;
fresh macOS, Windows, and direct universal template creation and consumer TypeScript;
iOS/Android/Windows generation and all five universal bundles; a shared Expo Metro
session with HMR, restart, compatibility rejection, and clean shutdown; and adoption
of an existing Expo app with custom config, plugins, entry, Metro resolver, and iOS
native project preserved through Windows prebuild. Packed SDK installation and CLI
exports passed with npm, pnpm, Yarn, and Bun, with Node and Bun CLI execution.

The upgrade checks also corrected the macOS starter's menu-root annotation, desktop
RN overrides for creation/adoption, and cached Runner refresh so it updates the
Expo Desktop toolchain rather than retaining the old beta graph. A native foundation
probe caught a stale window identifier and the loss of the documented status-level
overlay default; the default is restored while explicit levels/always-on-top options
remain honored. All four native foundation probes and nine RN keyboard checks pass.
The keyboard launcher now resolves its entry relative to Metro's actual server root,
including workspaces.

Kitchen Sink and the cached Spark Runner both rebuilt against the stable toolchain.
A fresh packed consumer discovered the registered Runner and passed the secondary
Hermes runtime proof, including isolated heaps, native filesystem calls, destruction,
recreation, and cleanup across a main-app reload. Existing prebuilt runtimes need a
rebuild against this SDK. These checks establish macOS development/runtime behavior;
Windows native compilation/execution, live iOS/Android execution, and signed/notarized
release artifacts were not verified on this Mac. The pre-existing Windows/menu drafts
remain separate from this upgrade.
