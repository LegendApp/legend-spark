# Release readiness

## Current decision

`@legendapp/spark` is `0.0.1-next.2`, an experimental `next` preview. The source
and package gates below are useful evidence, but this page does not certify a
production release. Do not promote this version to `latest` or describe all
exports as supported on every platform. Record new evidence in a completed
[release dossier](release-test-dossier.md) tied to an immutable source revision
and exact archive digest.

The package currently declares **51 export paths**. Forty-nine are functional
or tooling entry paths and two expose package/schema metadata. An export is a
public import boundary; it is not evidence that every platform implements or
passes that feature. Platform-specific support is determined by native package
availability and the evidence for that platform.

## Public export inventory

| Group | Export paths |
| --- | --- |
| Application and desktop APIs | `./app`, `./app/documents`, `./audio`, `./auth-session`, `./clipboard`, `./context-menu`, `./dialogs`, `./drag-drop`, `./files`, `./global-shortcuts`, `./links`, `./menus`, `./notifications`, `./processes`, `./secure-storage`, `./settings`, `./settings/observable`, `./settings/window`, `./shortcuts`, `./shortcuts/commands`, `./shortcuts/keyboard`, `./sqlite`, `./system`, `./tray`, `./updates`, `./webview`, `./windows`, `./windows/macos` |
| UI | `./ui`, `./ui/classnames`, `./ui/glass`, `./ui/search`, `./ui/sidebar`, `./ui/split-view`, `./ui/symbol`, `./ui/swipe`, `./ui/uniwind` |
| AI and diagnostics | `./ai`, `./ai/codex`, `./diagnostics`, `./contracts` |
| Configuration and build integration | `./config`, `./config-plugin`, `./expo-config`, `./metro`, `./runtime-entry`, `./metro-gate`, `./init-template`, `./native`, `./cli` |
| Metadata | `./package.json`, `./schema.json` |

## Target capability map

The [51-row support matrix](release-support-matrix.md) shows every import path,
its provider, intended targets, target-specific acceptance status, related
source tests, and exact platform command. The corresponding
[machine-readable matrix](release-support-matrix.json) is checked against the
package export map by `tests/release-support-matrix.test.ts`.

`not-tested` means there is no target-specific release acceptance evidence for
that API, architecture, and candidate. Source/unit checks do not change it.
`not-applicable` appears only for explicit platform contracts or exports that
are metadata/tooling rather than runtime APIs. Selected Expo adapters such as
audio, clipboard, links, auth sessions, secure storage, and core UI controls are
listed as applicable on their adapter targets; they do not inherit the desktop
API's not-applicable status. The case catalog in
`examples/kitchen-sink/contract-report.ts` remains the shared execution contract.

This list is generated from `packages/desktop/package.json`'s export map at
review time. Update it when that map changes; CI's package distribution test
checks the manifest and packaged declarations, while the release dossier should
record the exact archive tested.

## Evidence matrix

| Target / promise | Current evidence | Release gate before production claims |
| --- | --- | --- |
| Source and package structure | Portable source tests, typecheck, archive/manifest checks, patch preflight, update policy tests; see CI and dossier | All portable CI jobs green on the final revision; archive SHA and test report recorded |
| Actual npm consumer | Full packed `0.0.1-next.2` archive installed in an isolated consumer with Expo 54.0.37, React 19.1.4, React Native 0.81.6, and TypeScript/React declarations; public declarations typechecked, internal package resolved the same React instance, React 18.2.0 peer conflict rejected | Repeat against the release-candidate archive; record package-manager version and archive digest. This check disabled lifecycle scripts and did not compile native code |
| macOS arm64 native app | Current local Go/Debug Runner build and prebuilt Runtime probe passed in development mode (7/7); see the [current run report](release-evidence/0.0.1-next.2-checkout.md). Historical Apple Silicon UI evidence is documented in `macos-readiness-2026-09-18.md` and remains scoped to its recorded revision | Re-run current-revision clean prebuild, native build, launch, feature interactions, reload/recovery, and consumer install on the exact release archive; separately complete native API and signed distribution acceptance |
| macOS x64 / Intel | Architecture selection and runner installer tests exist; no current Intel native compile/runtime acceptance | Build and exercise on Intel hardware or a supported Intel runner; test clean recipient install and architecture-specific Runner archive |
| Windows x64 and ARM64 | Source preparation and feature-project generation checks exist; current native compiler/runtime acceptance is pending; see [Windows issues](windows-issues.md) | Resolve known native build blockers, compile with supported MSVC toolchains, run on x64 and ARM64 Windows, exercise supported features, and test clean package/Runner installation |
| iOS / Android / Web | Cross-platform contract catalog identifies desktop-only checks as not applicable; no general desktop-runtime parity claim | Keep desktop-only APIs explicitly scoped. For any advertised cross-platform feature, attach platform-specific build/runtime evidence from the release revision |
| Runner acquisition and clone portability | Deterministic tests validate archive integrity and project-relative dependency references; package-manager fixtures cover the installed managers stated in their test output | On clean recipient machines, create, launch, clone, reinstall, and verify offline reuse for each advertised manager/platform. Record missing managers as not tested |
| Signed distribution | No Developer ID Application identity is configured in the maintainer environment; prior local Sparkle signing tests use an ad-hoc fixture identity | A real Developer ID signed/notarized Runner, Gatekeeper assessment, clean download/install/launch, and update acceptance are required before production distribution claims |
| Hosted release and registry | No hosted release or npm publication is established by repository tests | Verify repository visibility, publish the exact staged bytes, verify GitHub and registry digests/tags, and record the resulting URLs and identities in the dossier |

The current local machine is Apple Silicon. A successful local macOS arm64 run
cannot substitute for Intel, Windows, or recipient-machine evidence. Current
Windows diagnostic and macOS readiness documents contain known limitations;
read them before marking any native row complete.

## Portable CI gate

`.github/workflows/portable.yml` runs source typecheck and the full Vitest suite
on Linux and macOS with the Node version in `.nvmrc`.
Both jobs install from the frozen Bun lockfile and run the complete Vitest suite under Bun; on macOS it includes the Foundation and
Codex compiler-backed fixtures guarded for Darwin. This catches source, manifest,
archive, peer, patch-inventory, update-policy, and package-manager regressions.
These focused native fixtures do not claim a complete app build, UI acceptance,
signed Runner validation, or Windows/MSVC support. Windows native acceptance
remains a separately recorded gate, rather than an unverified workflow matrix
entry.

For a local equivalent after dependencies are installed:

```sh
bun run typecheck
bun run test
```

Latest in-progress checkout evidence is recorded in
[the current run report](release-evidence/0.0.1-next.2-checkout.md). It is
explicitly tied to a dirty working tree and is not release-candidate evidence.

The full real consumer check is intentionally an explicit release evidence
step, not a routine CI job that resolves and installs the entire native graph.
Run `bun tests/packed-consumer.integration.ts` against the final source before
staging. Its report must state that install lifecycle and native compilation
were skipped; separate native gates remain mandatory.

The focused dependency-audit baseline, package call paths, and unresolved
upstream gates are recorded in the [dependency triage note](release-evidence/dependency-triage.md).

## Promotion criteria

Before a production release, attach a completed dossier for the exact candidate
revision and archive. Resolve every row labeled as a gate for the intended
platforms, or state the narrower supported scope in release notes. A measured
status in the matrix requires an evidence reference and a narrowly stated
claim; it does not mark neighboring APIs or targets as passed. Keep
`not-applicable` cells tied to their documented target contract, and do not
treat historical evidence as evidence for a changed source revision. The
preview channel stays `next` until a deliberate release decision promotes a
verified version.
