# Release evidence dossier template

Copy this file for each release candidate and fill every field. Use `passed`,
`failed`, `blocked`, `not-tested`, or `not-applicable` for every check. A blank
result is not evidence. Link raw reports/logs or durable artifacts; do not
summarize a simulated, mocked, historical, or ad-hoc-signing result as a
production acceptance pass.

## Candidate identity

- Package/version and channel:
- Source repository and immutable commit:
- Working tree clean (command/output):
- Build date and operator:
- Packed archive filename and SHA-256:
- Release manifest/checksum files:
- Runner archive(s), architecture(s), and SHA-256:
- Intended platform scope and explicit exclusions:

## Environment

| Host | OS/version | Architecture | Node | npm/pnpm/Yarn/Bun version | Xcode/SDK or MSVC | Result/evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Maintainer build host | | | | | | |
| Clean recipient | | | | | | |
| Windows x64 | | | | | | |
| Windows ARM64 | | | | | | |
| Intel macOS | | | | | | |

## Portable source and archive checks

| Check | Status | Exact command | Revision/archive tested | Evidence link or artifact |
| --- | --- | --- | --- | --- |
| Typecheck and portable tests | | | | |
| Package exports and packed manifest | | | | |
| Required patch inventory and provenance | | | | |
| Release asset hashes and version metadata | | | | |
| Real packed consumer, public typecheck, singleton React | | | | |
| Incompatible framework peer rejection | | | | |
| Actual consumer lifecycle scripts | | | | |

For the real packed consumer, record the exact framework dependency versions and
package-manager version. State whether install scripts ran. A package install
with lifecycle scripts disabled does not complete native acceptance.

## Platform and distribution acceptance

| Target/check | Status | Toolchain/device | Features and steps exercised | Evidence link or artifact |
| --- | --- | --- | --- | --- |
| macOS arm64 clean native build and launch | | | | |
| macOS arm64 supported API/UI interactions and reload/recovery | | | | |
| macOS x64 / Intel native build and launch | | | | |
| Windows x64 MSVC build and runtime | | | | |
| Windows ARM64 MSVC build and runtime | | | | |
| iOS / Android / Web scoped API checks, if claimed | | | | |
| Each advertised package manager, including clone reinstall | | | | |
| Clean recipient Runner download, extraction, launch, offline reuse | | | | |
| Developer ID signature, entitlements, notarization, Gatekeeper | | | | |
| Update feed signature, install, rollback/retry behavior | | | | |
| GitHub release asset digest and npm registry digest/tags | | | | |

## Findings and decision

- Open failures and workarounds:
- Known limitations carried into release notes:
- Evidence that is historical or from a different revision:
- Publication URLs and final registry tags (leave empty before publication):
- Decision and approver:

A production decision must identify which platform rows define the supported
scope. “Not tested” means no acceptance result is available; it must never be
converted to a pass based on another platform or an older revision.
