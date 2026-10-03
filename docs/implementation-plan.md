# Legend Spark implementation plan

Date: 2026-09-10

Status: local prototype implemented and validated. See [prototype status](prototype-status.md) for evidence and implementation limits. P0–P3 and prototype documentation are complete; package ownership cutover, a real app migration, runtime acquisition, and public-beta distribution remain later gates. This document authorizes no publishing operations by itself.

## Objective

Build a React Native desktop framework on expo-desktop, with Expo-style development and common Electron-style desktop capabilities. A small starter should run immediately in a supplied native runtime, switch to an app-specific development build when needed, and produce a native application containing only its required SDK modules.

The first prototype proves that complete path locally on Apple Silicon macOS, using Hello World, native menus, file dialogs, and a tiny extra native module. It does not need npm publication, GitHub releases, runtime downloads, signing, notarization, or updates.

## Decisions made

- Develop in `../spark`, independently of `legend-apps`.
- Extracted framework modules have one source of truth here. Existing apps eventually consume them as dependencies. App-specific modules can remain in `legend-apps`.
- macOS is the first public-beta platform. The prototype targets Apple Silicon only. Intel support requires separate validation before it is advertised; Windows comes later.
- Do not package Node or Bun in the application. Hermes executes application JavaScript; JS and native build tooling remain development dependencies.
- Go includes all modules in the versioned framework SDK for its platform. It does not include every native package in `legend-apps`.
- Start the SDK with native menus and file dialogs. Keep the native host minimal; do not extract the full existing window-manager/AppDelegate implementation yet.
- One CLI maintains the development-server session and switches launch targets between Go and an app-specific development build.
- Go is built locally once for the prototype. A starter launches that binary without invoking native build tools. Downloading is tested before MVP.
- Custom development builds contain the SDK superset plus the app's additional native dependencies.
- The server automatically detects native dependency/configuration changes and explains incompatibilities. Selecting the build/switch action starts setup and compilation.
- Ordinary package-manager installs must work. A future `spark add` command is a convenience wrapper, not a required installation mechanism.
- CNG manages native projects. Native changes belong in packages and config plugins, not manual edits to generated Xcode files.
- Automatic production pruning initially applies only to framework-owned SDK modules. Keep third-party native dependencies conservatively and support explicit inclusion for native-only behavior.
- The beta must let someone build and distribute a small real desktop app, including signing, notarization, and updates.

Command and npm package names below are working names, not public naming decisions.

## Verified starting point

The earlier independent probe used:

| Dependency | Tested version |
| --- | --- |
| expo-desktop | 1.0.0-beta.5 |
| Blank TypeScript template | 54.81.1-beta.5 |
| Bare-minimum native template | 54.81.1-beta.5 |
| React | 19.1.4 |
| React Native | 0.81.6 |
| React Native macOS | 0.81.7 |
| Expo | 54.0.37 |

The probe established successful creation, CNG plugin application, repeatable selected generated files across clean prebuilds, autolinking, CocoaPods/codegen, a Debug arm64 build, and Metro bundling of menus and dialogs. It did not launch the app or validate production behavior.

Begin with this tested matrix and pin the complete dependency graph. Verify availability and any relevant upstream fixes before implementation; do not silently substitute a newer beta. Helper packages use independent versions, so pinning only expo-desktop is insufficient.

Evidence: [Expo Desktop integration record](expo-desktop-integration.md). The original cross-checkout assessment artifact is not present in this checkout. Source tag commit: `a48ce605e2751682baf261590e80bdf0cd377e42`.

Known integration points to recheck:

- Always select macOS explicitly during prebuild; the tested default generated all platforms.
- The tested beta requires Windows identity metadata even for macOS-only prebuild. Retain the minimal metadata workaround if still needed; isolate it in the adapter and document its removal condition.
- Use desktop-aware config-plugin hooks. The exported window-size helper did not match the tested host template.
- Avoid unnecessary Windows tooling probes on macOS.
- Do not copy all `legend-apps` dependency patches. Verify each against the selected dependency and actual feature requirement.

## Package and project boundaries

Proposed workspace layout:

```text
spark/
  packages/
    cli/                  development session, doctor, builds, packaging
    desktop/              SDK entrypoints and public configuration
    desktop-host/         minimal native host and runtime metadata
    config-plugin/        CNG integration
    file-dialog/          extracted SDK native module
    native-menu/          extracted SDK native module
  templates/
    hello-world/          consumer source and configuration
  runtimes/
    go/                   build project for the SDK superset runtime
  fixtures/
    native-greeting/      extra native module absent from Go
  tests/
    integration/          external packed-package consumer scenarios
  docs/
```

Combine small internal helpers where that keeps implementation simpler; do not publish a package for every directory solely to match this layout.

Each feature package owns its native source, TypeScript API/specs, codegen configuration, podspec, platform support, and required native dependencies. Add framework metadata only for information upstream package formats cannot express: SDK feature mapping, native compatibility, required host features, and associated configuration behavior.

Consumer app identity and capabilities live in Expo app configuration plus our plugin options. Consumers do not maintain a second per-app native-module inclusion manifest. Generated selection reports and compatibility metadata are build outputs.

Use explicit SDK subpath entrypoints for the prototype so importing dialogs does not eagerly import menus. Do not depend on unproven export-level tree shaking in the pinned Metro version.

## Development session behavior

`spark dev` starts a managed Metro session using expo-desktop's configuration and presents the active target, compatibility status, and actions to open, reload, debug, and switch targets. Reuse upstream integration where possible; validate the available integration surface before committing to internal Expo CLI APIs. Do not scrape terminal output as a control protocol.

Target states:

1. **Go ready:** compatible local runtime exists; launch with the project's entrypoint/server connection.
2. **Go unavailable:** explain how to build/register the local runtime in the prototype. Before MVP, resolve/download the compatible runtime.
3. **Custom build needed:** explain missing/incompatible native capabilities or app-specific configuration and offer the switch/build action.
4. **Preparing/building:** check tooling, generate native projects, refresh dependencies, compile, and show meaningful progress while the development session remains usable.
5. **Custom build ready:** launch the app against the existing server and remember the selected target.
6. **Build failed or interrupted:** preserve diagnostics and offer retry; never label a stale binary compatible with the changed project.

Switching targets launches another native process; it does not mutate Go or promise to retain in-memory React state. The same server should remain running when its configuration is unchanged. If native/plugin changes also change Metro configuration, perform a managed restart and reconnect rather than promising the process never restarts.

Watch dependency manifests, the lockfile, and native-affecting config. Debounce installation activity and reevaluate after dependencies resolve consistently. Do not initiate compilation on every filesystem event.

Before allowing incompatible application code to execute, compare app requirements with runtime metadata. JS-only dependencies do not require a rebuild. Installed-but-unused SDK features are not evidence of a new requirement; use the SDK mapping and app graph. Treat unfamiliar third-party native dependencies conservatively.

The prototype may need a small host launch protocol for project identity and bundle URL. Keep Go configuration separate from app-specific identity and document associations: those capabilities require a custom binary. Scope the local connection to the intended development session rather than allowing arbitrary remote bundles to be loaded by default.

## Compatibility and rebuild model

Embed a runtime identifier, platform/architecture, and native module identities/compatibility information in each binary. Define the initial identifier from the exact tested native dependency set and build inputs; do not assume semver ranges prove native compatibility.

Separate these concerns:

- **Compatibility:** can this binary run the current application JavaScript and required native features?
- **Dependency regeneration:** do CocoaPods, codegen, or CNG outputs need refreshing?
- **Native compilation:** did native source or build inputs change, requiring an incremental build?

Fingerprint resolved native package versions/content, specs, plugin/config inputs, host/template/runtime versions, target architecture, and relevant build settings. Include local native source edits in build invalidation. Ordinary app JS edits use Fast Refresh. Favor conservative invalidation initially over incorrectly reusing a stale binary.

Source packages are installed through the package manager, using packed tarballs for local tests. No custom build step should require cloning the original apps monorepo. Xcode installation, first-launch setup, and license steps need explicit diagnostics and guided user action where automation cannot complete them.

## Production module selection

Run a production-configured dependency analysis before native generation/build. Use Metro's resolved dependency graph, not source-text searches or observed runtime execution.

1. Resolve every declared application entrypoint for the target platform and production environment.
2. Map reachable SDK JavaScript modules to their owning native features.
3. Add framework core, explicitly included features, native-only configuration requirements, and transitive native dependencies.
4. Keep third-party native dependencies conservatively. Do not allow pruning to remove an SDK module required by a retained third-party native dependency.
5. Generate one selection consumed consistently by CNG/plugins, autolinking, codegen, native dependency installation, and the final compatibility check. Prevent another discovery phase from silently reintroducing the SDK superset.
6. Produce a human-readable report explaining why each feature is included or excluded.
7. Verify the final bundle's known native requirements are satisfied by the selected binary.

Lazy imports count as reachable. Runtime-selected native features or native startup behavior need explicit metadata/configuration inclusion. An unknown edge must retain the dependency or stop with an actionable diagnostic, not silently produce a broken application.

Keep analysis acyclic: configure JS resolution from the installed project and user config first, then select native features. If applying a plugin changes graph-affecting configuration, detect that and revalidate before building. Do not use a pruned native graph to hide JS imports during analysis.

The prototype removes complete SDK native modules. It does not promise individual native-method elimination, arbitrary third-party tree shaking, or removal of every unused JavaScript export.

## Implementation milestones

### P0 — Scaffold and freeze the integration baseline

- Create the npm workspace, initial package boundaries, lockfile, and consumer template.
- Establish a repeatable packed-package installation flow into a temporary project outside both repositories.
- Port only the demonstrated menu/dialog packages and the minimum required host/config integration.
- Resolve publishable dependency metadata and codegen/package contents. Audit transitive dependencies.
- Record the tested toolchain and dependency matrix and any bounded upstream workaround.

Acceptance: a clean external consumer installs packages and completes macOS CNG, pod installation, codegen, and a Debug arm64 build without reading native source from `legend-apps`.

### P1 — Prove the local Go runtime

- Build a local Go `.app` containing both SDK modules and embedded capability metadata.
- Add a local runtime registration/path mechanism; no downloads or public publication.
- Implement the minimum CLI server session and launch connection.
- Launch Hello World, show a native menu, and exercise a file dialog through the SDK.
- Verify JS edits Fast Refresh without rebuilding the runtime.

Acceptance: after Go is built, a fresh external consumer launches and uses both modules without running prebuild, CocoaPods, codegen, or native compilation. Record tool invocations to establish that property. A machine without native tooling is a later stronger validation; do not infer it solely from a developer-machine run.

### P2 — Prove automatic detection and switching to a custom build

- Implement the native-greeting fixture as an independently installable packed package with one native method.
- Install it using ordinary `npm install`; do not implement `spark add` first.
- Detect the native graph change and report that Go lacks the module before executing incompatible JS.
- On the switch action, check prerequisites, generate the app-specific project, install native dependencies, build, and launch against the current server.
- Cache the successful binary and native inputs. Relaunch unchanged inputs without recompiling.
- Explain why switching back to Go is unavailable while the extra feature is required.

Acceptance: the fixture returns a value from native code in the custom runtime; changing app JS does not rebuild; changing the fixture's native implementation causes a rebuild; failed setup/builds remain recoverable.

### P3 — Prove production selection and clean regeneration

- Change the production acceptance app to use dialogs and the greeting fixture, but not menus.
- Generate the selection with dialogs, greeting, core, and required dependencies retained; menus excluded.
- Validate the reduced graph first in a Debug build, then run one targeted Release build to validate the intended production path.
- Launch the standalone Release `.app` without Metro and exercise the included feature(s).
- Inspect generated registrations/codegen, resolved pod graph, and native build/link evidence to confirm the menu module was not compiled or linked. Binary size alone is insufficient evidence.
- Run clean prebuild again and verify required plugin behavior and module selection survive regeneration without duplication.

Acceptance: the standalone app works with Metro stopped, greeting/dialogs remain functional, and the unused menu module is absent from the native build. Development Go still contains both SDK modules. Local development/ad-hoc signing as required by macOS is acceptable; public distribution signing is not part of this milestone.

### P4 — Finish prototype evidence and establish package ownership

- Run the full external-consumer scenario from packed artifacts and save concise evidence for each acceptance gate.
- Document local Go creation, consumer launch, custom-build switching, prerequisites, known limitations, and production selection.
- Establish `spark` as the canonical owner of successfully extracted modules. Migrate one appropriate app/package consumer in `legend-apps` in a scoped follow-up; keep all other app behavior intact.
- Do not leave permanently divergent copies of extracted modules. A short-lived extraction copy is acceptable while proving portability, but record and complete the cutover.

Prototype completion requires P0–P3 plus reproducible evidence/documentation. An existing app migration is the next real-world integration gate and must not expand the Hello World prototype into a broad app rewrite.

## Prototype validation matrix

| Scenario | Expected result |
| --- | --- |
| Fresh external starter + prebuilt local Go | Hello World opens without native build commands |
| Use menus/dialogs already in Go | Native behavior works; JS edits Fast Refresh |
| Install a JS-only package | No native-build requirement |
| Install/import native-greeting | Clear custom-build requirement before missing-module crash |
| Select custom build with missing tooling | Specific diagnosis, recoverable setup state |
| Build custom runtime | Greeting native method works alongside SDK modules |
| Relaunch unchanged custom app | Existing compatible binary reused |
| Edit fixture native source | Rebuild required and updated behavior observed |
| Attempt incompatible Go launch | Clear explanation, no blind launch |
| Production graph uses dialogs but not menus | Menus excluded across generation and native linking |
| Launch production app with Metro stopped | App and retained native methods work |
| Repeat clean CNG | Configuration and module selection preserved |

Use focused tests for graph closure, compatibility decisions, invalidation, and error recovery. Validate visible native behavior at runtime; build success alone is insufficient. Use Debug builds while iterating, with the single targeted Release validation justified by P3. No performance claims are required for prototype completion.

## Before MVP: runtime acquisition

- Publish a versioned artifact format and release manifest with compatibility identifier, platform/architecture, minimum OS, immutable URL, and checksum.
- Download the runtime matching the project's pinned SDK, not whichever binary is globally newest.
- Implement shared versioned caching, verification, interrupted-download recovery, offline reuse, and useful incompatibility errors.
- Test the full download path using controlled artifacts before selecting public release hosting.
- New-app creation selects a framework version; first development launch acquires its matching runtime. Existing apps retain compatible versions until explicitly upgraded.
- Validate Go on a clean machine without native build tooling. Keep custom builds local initially; hosted builds are deferred.

## Before public beta: ship a small real app

- Expand the SDK based on the reference app's concrete requirements. Likely next modules are window management, app lifecycle, file access/watchers, clipboard, and update integration; do not make the whole wishlist a prerequisite for the prototype.
- Extract reusable lifecycle behavior deliberately. The current window-manager references shell-owned symbols/notifications and is not a standalone drop-in package.
- Complete and test app identity, document/URL handling, relevant entitlements, and lifecycle behavior in custom builds.
- Generalize app packaging, signing, notarization, and update production/installation from existing tooling.
- Distribute signed/notarized Go binaries and versioned npm packages through a repeatable release pipeline. GitHub Releases is the initial hosting candidate, not a prototype dependency.
- Prove one small app can be installed on another machine and updated successfully.
- Publish the actual supported platform/architecture matrix, API scope, prerequisite guidance, and compatibility policy.

Public package naming, GitHub release destination, signing identities, and update credentials are deferred decisions needed before distribution, not blockers for the local prototype. Do not publish or use credentials implicitly.

## Deferred work

- Intel validation, Windows implementation, and mobile/Linux support.
- Hosted native builds and remote build caches.
- Dynamic loading of arbitrary downloaded native libraries.
- `spark add` convenience installer and broad third-party plugin automation.
- Broad Electron API compatibility, DOM/Node compatibility, and heavy specialized SDK modules.
- Preserving hand-edited generated native projects.
- Arbitrary third-party native pruning or method-level native elimination.
- Migration of all existing apps, detailed performance benchmarking, and public API stability guarantees.

## Suggested execution order

Complete P0, P1, P2, and P3 sequentially, resolving a failed architectural gate before expanding the SDK. Keep the artifact-install consumer test throughout. Finish the prototype evidence, then proceed to one real app integration and runtime acquisition. Expand toward the public beta only after those workflows hold outside the framework workspace.
