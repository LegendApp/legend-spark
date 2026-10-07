# Changelog

## 0.0.1-next.3 — preview

Experimental macOS Apple Silicon preview. Native Windows and Intel macOS
acceptance remain pending. Automated package checks do not certify native UI
or clean-recipient Runner acceptance.

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
