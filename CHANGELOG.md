# Changelog

## 0.0.1-next.5 — preview

macOS 14+ (Apple Silicon) supported; Windows preview, not yet verified

- Make the app creator publishable as `@legendapp/create-spark`, with the same version and `next` channel as the SDK.
- Accept compatible React 19 versions as peers while keeping the starter on the tested React 19.1.4 baseline.
- Add native Markdown and HTML readers alongside editable rich text, with reviewed public exports.
- Verify local SDK and creator tarballs by scaffolding, installing, and typechecking a fresh npm app in CI.
- Rewrite the quick start and clarify platform support and prerelease installation.
- Keep fresh apps compatible with Runner when native dependencies carry workspace patch receipts.
- Preserve SidebarSplitView pane state and divider behavior.
- Make nonrecursive directory removal preserve children created concurrently.
- Remove build-machine paths and command logs from distributed archives, and include creator and starter READMEs.
- Persist pnpm 11 installation settings, dependency overrides, and local archive build approvals during creation and upgrades.
- Align the Markdown backend peer with the bundled 1.1.1 version.
- Preserve Metro module data when Fast Refresh removes and reuses imports. Keep native component specs registered once across remove/re-add transitions, including recovery from failed updates.
- Keep new and refreshed pnpm 10 apps' native peers on the SDK's patched Nitro archive.

## 0.0.1-next.4 — preview

macOS 14+ (Apple Silicon) supported; Windows preview, not yet verified

- test: allow error logs when native preflight rejects a packed build
- test: allow CLI prefix before native patch preflight summary
- fix: identify native patches in preflight error summary
- fix: make release recovery safe and retryable
- feat: fail release builds that use excluded native modules
- feat: include and automatically patch enriched Markdown
- feat: include camera with automatic native dependency patches
- feat: add @legendapp/create-spark for npm create (#288)
- feat(cli): check and upgrade app dependency pins in spark doctor/upgrade (#279)
- fix(cli): only guard react-native.config.js when spark writes it (#278)
- test: compare 1 MiB streaming-writer payload with Buffer.compare
- Merge pull request #1 from LegendApp/seth/split-view-content-list
- Merge pull request #3 from LegendApp/seth/fresh-macos-product
- Merge remote-tracking branch 'origin/main' into HEAD
- fix(ui): preserve split-view content and divider ownership
- Merge remote-tracking branch 'origin/main' into HEAD
- test: make quit-coordinator test robust to slow run loops
- fix(cli): rebuild when a legacy build receipt lacks verified product metadata
- Merge pull request #4 from LegendApp/seth/swipe-actions
- fix(ui): harden native swipe actions
- docs: record Windows Nitro and notification validation gaps
- fix: nest Windows toast actions and loop call audio
- fix: install Windows Nitro through the RNW JSI initializer
- feat: validate and serialize radio menu items
- fix: preserve native toolbar controls during menu updates
- feat(ui): native trackpad swipe actions (ui/swipe)
- fix(cli): copy the scheme's app product, not the first .app
- fix(ui): steady split view panes during divider drags
- feat(ui): native content-list column for SidebarSplitView; fix drag tearing
- Merge pull request #2 from LegendApp/seth/fix-linux-portable-gates
- test: pin macOS target arch in host-independent tests

## 0.0.1-next.3 — preview

- [Breaking] Public API contracts and window configuration changed. See the
  versioned [app upgrade notes](packages/desktop/skills/spark/UPGRADING.md#001-next3).

macOS 14+ (Apple Silicon) supported; Windows preview, not yet verified

- fix release scripts
- tweak credentials script for release
- fix: upgrade Expo Desktop to stable 1.0.0
- chore: restore Bun repository tooling without limiting consumers
- fix: reapply workspace patches after manifest receipt stamping
- fix: retain CocoaPods and Hermes caches during native preparation
- feat: automate next preview releases and latest promotion
- fix: reuse cached macOS apps and stream native build progress
- fix: await lazy window components when native surfaces restart
- Serialize notification category registration on macOS
- Read cursor position without allocating native events
- Name toolbar menu actions from the windows surfaces
- Fix collapsed parseAIJson return type and readonly invocation args
- Discriminate UpdateEvent by state
- Expose maximized window state
- Present message dialog checked only when a checkbox was shown
- Add getCursorPoint to /windows
- Route animated bounds through the portable setWindowBounds
- Add notification tones and action buttons
- Give global shortcuts the contract's options parameter
- Normalize file dialogs on defaultPath and labeled filters
- Reconcile origin release history with local main
- Checkpoint Windows file, clipboard and toast fixes
- Record patched tooling verification and remaining dependency gates
- Update CLI archive and WebSocket tooling to patched releases
- Record per-export release gates and scoped acceptance evidence
- Run full source gates on Linux and macOS in CI
- Run runtime acceptance against verified existing package archives
- Verify packed SDK consumers with installed framework peers
- Account for verified workspace patch receipts in producer fixtures
- Expose feature registration types and narrow launcher menu contracts
- Verify required native patches before preparing or launching Spark apps
- Wait for browser audio seeks to complete
- Enforce increasing Spark update build numbers
- Verify release dependency archives before portable consumer installation
- Align option validation and preserve SQLite backend error codes
- Clarify main-runtime events and settings fallback limits
- Match public menu types to supported native surfaces
- Bound Codex writes and retain cancellation ownership through startup
- Verify the complete patched package inventory before release assembly
- Retain menu ownership through update and cleanup failures
- Ship Spark license text and use the SDK version in native identity
- Preserve stream errors and expose failed handle cleanup for retry
- Keep consumer runtime singletons exclusively in Spark peers
- Wait for document reload watches to release ownership
- Stage macOS file replacements before publishing them
- Release Runner installation locks when the installer crashes
- Wait for audio player ownership before replacing hook resources
- Publish window focus callbacks only after React commits
- fix: retain an overlaid menu item's semantic role for later placements
- Show toolbar text only for a declared label
- Require the Sidebar selection callback its controlled prop implies
- Drop Apple-only icons from the hotkey settings page
- Keep a successfully opened macOS window when its read-back fails
- Keep symbol-only toolbar items icon-only
- Emit navigation keys as the codes accelerators parse
- Accept React Native view props on the WebView component
- Answer window availability synchronously
- Add copy/move options with an explicit overwrite decision
- Validate openFile, readChunks and writeChunks option keys
- Return the real clipboard write result from setStringAsync
- Read out-of-range SQLite integers as text instead of rejecting them
- Isolate desktop event subscribers from each other's exceptions
- Stop identity-only changes from re-running native menu and keyboard work
- Freeze the public export surface so internals cannot leak by `export *`
- Keep the raw window bridge transport out of the public API module
- fix: honor app overrides in native dependency discovery
- fix: point native probe source to legend-spark
- fix: include Codex in desktop Apple autolinking
- fix: refresh native builds when package paths change
- fix: bind unwired macOS settings menu slot
- Remove SQLite benchmark artifacts
- perf: decide keyboard consumption natively without blocking
- docs: codify direct API execution and performance validation
- perf: pass file clipboard and process bytes through native buffers
- perf: reuse native presentation resources on small updates
- perf: route desktop events directly and remove auth polling
- perf: drive audio readiness and observation from backend events
- perf: compile shortcut bindings when registrations change
- perf: remove redundant settings snapshots and serialization
- perf: submit SQLite queries directly to native backend
- test: benchmark NitroSQLite 10 against Spark SQLite backend
- Move AI execution packages into Spark
- Finish API consistency review and preserve cleanup failures
- Consolidate tooling imports and validate CLI commands
- Type app configuration and align initial window geometry
- Expose imperative lifecycle cores and enforce hook design rules
- Add portable tray images and bind actions to native instances
- Clear stale Android audio artwork and verify hook ownership
- Align file and message dialog window ownership
- Consolidate window ownership, geometry and native chrome APIs
- Unify settings-window pages and selection ownership
- Own specialized UI events and explicit pane composition
- Align common UI control contracts and controlled values
- Consolidate generic drag and drop contracts
- Unify application events and awaited quit decisions
- Unify command bindings and own keyboard listener lifetimes
- Unify process targets, byte IO and termination contracts
- Normalize authentication results and retryable session cleanup
- Separate URL linking from typed document requests and history
- Own application menu lifetimes and target semantic commands
- Give system registrations and launcher menus explicit ownership
- Align tray menus and resource ownership contracts
- Define shared menu items and require context menu ownership
- Share shortcut parsing and make registration cleanup retryable
- Unify media session commands ownership and cleanup
- Make audio readiness commands and disposal consistent
- Separate notification content scheduling and removal contracts
- Consolidate native update configuration and check contracts
- Give observable settings explicit readiness and persistence lifecycle
- Make settings storage explicit and validate typed reads
- Keep one Expo-shaped clipboard and secure storage API
- Scope file scans to each call and consolidate file watching
- Normalize file IO and make resource cleanup retryable
- Consolidate dialog contracts and move file helpers under files
- Own WebView props events and refs behind a Spark adapter
- Own SQLite query and transaction contracts in Spark
- Define shared API contracts and record approved cleanup scope
- Preserve corrupt settings and keep navigator window identities stable
- fix: report Metro readiness before Expo dependency checks
- feat: provide shared desktop app capabilities through Spark
- feat: forward app launch arguments through Spark dev
- fix: discover symlinked native podspecs during autolinking
- fix: resolve analysis entry from the app project root
- fix: support shared Metro roots and native URL scheme arrays
- feat: add configurable native lifecycle and opt-in quit handlers
- feat: support existing macOS AppDelegate hosts in Spark
- fix: preserve active development sessions during CLI rebuilds
- fix: restore upstream package URLs in npm lockfile
- docs: update Spark installation and automatic Runner instructions
- feat: support Intel macOS builds and Runner distribution

## 0.0.1-next.2 — preview

This is an experimental preview of Legend Spark, a React Native and Expo SDK
for desktop applications. The package exposes 51 documented entry paths across
application APIs, UI, configuration, diagnostics, and tooling. The presence of
an export does not certify implementation or runtime support on every platform.

The release workflow now verifies release input provenance and required native
patches, stages dependency archives with the project so clones can reinstall
without the producer machine, and checks consumer dependency integrity before
package-manager lifecycle work. Runner lock recovery, package graph constraints,
update version monotonicity, and packed-consumer resolution also have regression
coverage.

This preview is not a production-readiness claim. Windows native compilation and
runtime acceptance, Intel macOS native acceptance, clean-recipient Runner install
and launch, and Developer ID signing/notarization remain separate release gates.
See [release readiness](docs/release-readiness.md) and the
[release evidence dossier](docs/release-test-dossier.md) for status and required
evidence. The preview channel remains `next`; this entry does not promote the
package to `latest`.
