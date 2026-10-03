# Dependency audit triage (bounded)

Date: 2026-10-03. This is a focused review of the supplied pre-bump audit
snapshot `luna-spark-runtime-audit-20261003.json` (local scratch input, not a
repository artifact). It is not a fresh audit of the current lockfile. The
snapshot has 107 package-name rows, 127 affected-node references, and exactly 43
unique advisory URLs. Its severity summary is 1 critical, 95 high, 10 moderate,
and 1 low. These counts describe an audit graph with propagated ancestor rows;
they do not establish that every affected dependency ships in a native app.

The audit's aggregate `@legendapp/spark` row is a propagation summary across
its dependency graph. It does not establish that every listed package or
vulnerability is reachable in the installed app binary. This review separates
the SDK/CLI and Metro/build toolchain from ordinary app runtime, and records
unresolved upstream exposure rather than dismissing it.

## First-party bounded updates

A separate package owner updated the first-party bundled CLI metadata and lock
to npm 11.21.0, tar 7.5.22, and ws 8.21.0. The final packed-consumer check
passed with npm 12.0.2, pnpm 11.21.0, Yarn 1.22.22, and Bun 1.3.14. The worker
tested archive SHA-256
`04eb80e408139a3c7e02c6af1f13ece4b69a754cfdc1ff634c04c9cb8879ab8c`; its log
is `scratch/luna-spark-packed-consumer-20261003.log`. The coordinator then
independently passed the full consumer assertions on archive SHA-256
`00ff988e18f9a32d7058df50716464267de55e9a634709ab51c2857f88412d2d` with the
same four package managers; log:
`scratch/spark-final-tooling-verification.log`. An earlier pnpm failure came
from the test harness resolving a symlinked path logically; the harness now
canonicalizes with the physical realpath, with assertions retained. The
coordinator also verified 143 generated npm child lock records and parent
metadata against the actual bundled npm tree. The fresh npm consumer audit recorded 100 package-name rows, 120
affected-node references, 21 unique advisory URLs, and severity counts of 0
critical, 91 high, and 9 moderate. Its graph reported 1,262 production, 0
development, 15 optional, and 2 peer dependencies (1,278 total). This is not a
clean graph or a release pass. These counts use the same definitions as the
pre-bump snapshot and apply only to this consumer audit.

### npm and tar

The pre-bump snapshot records bundled `npm@11.11.0` at `node_modules/npm` and
installed `tar@7.5.9` nested at `node_modules/npm/node_modules/tar`. The updated
worktree targets npm 11.21.0 and tar 7.5.22. The advisories affect tar through
7.5.20. Spark's CLI carries npm as a
dependency and routes Expo Desktop's template extraction through the packaged
npm executable from `packages/cli/src/create.ts` and
`packages/cli/src/npm-bin/npm`; npm's tar path is therefore CLI/archive
handling, not ordinary native-app runtime. The snapshot's npm aggregate row
propagates the tar and npm subdependency advisories to Spark; it is not a single
app-binary flaw.

The audit lists tar advisories including
[GHSA-23hp-3jrh-7fpw](https://github.com/advisories/GHSA-23hp-3jrh-7fpw)
(unlimited-input parse/decompression DoS, through 7.5.18) and
[GHSA-r292-9mhp-454m](https://github.com/advisories/GHSA-r292-9mhp-454m)
(uncontrolled recursion, through 7.5.20), plus path traversal and parser
confusion findings in the same range. The first-party target is npm 11.21.0
with tar 7.5.22. The fresh consumer audit contains neither a tar nor a ws
vulnerability row. The four-manager packed-consumer check resolves the patched
versions. This addresses those specific tar findings; it does not clear npm's
remaining aggregate row. The fresh audit still reports bundled `npm@11.21.0`
high because its installed subtree includes `http-cache-semantics@4.2.0`,
`@sigstore/tuf@4.0.2` / `tuf-js@4.1.0`, and `brace-expansion@5.0.9`, plus
`ip-address@10.5.0` (moderate). The audit paths are all under
`node_modules/npm/node_modules/`. `http-cache-semantics` is reached through
`make-fetch-happen` and npm's registry fetch/cache path; the audit reports no
available fix for its cross-user cached-response disclosure
([GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)).
The sigstore/TUF findings propagate through npm's signing and publish-related
dependencies; the bundled CLI includes those code paths, but the normal Spark
template-install path is not itself proof that signing or publishing executes.
The audit reports no npm-compatible fix for that chain. `brace-expansion`
under npm's `node_modules` is affected through 5.0.11; the fresh audit reports
a fix available, but the bundled npm tree has not been updated or verified
against the newer version. Its affected advisories include
[GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7) and
[GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p).
`ip-address` is used in npm's registry/network helper subtree; the fresh audit
reports a fix available, but compatibility has not been tested in the bundled
npm. Its findings include
[GHSA-j6r3-76f7-8jcv](https://github.com/advisories/GHSA-j6r3-76f7-8jcv) and
[GHSA-h3mg-xc3c-68pw](https://github.com/advisories/GHSA-h3mg-xc3c-68pw).
Treat these as open bundled-CLI/upstream compatibility gates, not as findings
that have been repaired by the tar update or as proof of ordinary app-runtime
reachability.

### ws

The pre-bump snapshot records `ws@8.18.3`; the fresh consumer resolves
`ws@8.21.0` with no ws vulnerability row. Spark's public desktop package
depends on its private CLI package, whose manifest pins `ws` exactly. The CLI
imports it in `packages/cli/src/windows-metro.ts`; `packages/cli/src/dev.ts`
uses this adapter for Windows development/preview configurations. The adapter
binds its relay to loopback (`127.0.0.1`) on an ephemeral port and proxies to
the local Metro server. This is real CLI/dev-tool reachability, but not code
executing inside a compiled native app.

GitHub's reviewed [GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p)
marks `ws` versions below 8.21.0 affected by memory-exhaustion denial of
service. [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx)
marks versions below 8.20.1 affected by an uninitialized-memory disclosure.
The bounded same-major target is the exact `8.21.0` pin. The four-manager
packed-consumer check confirms the patched CLI version across npm, pnpm, Yarn,
and Bun. Keep Metro WebSocket behavior tests and the packed-resolution
assertion in final verification.

## Expo/Metro toolchain findings

These packages are reached through Expo and Metro in the JavaScript build/dev
toolchain. They can affect development or packaging when they process project
inputs. They are not thereby native-app runtime dependencies. Their presence
still matters for SDK developers and must remain tracked.

| Package in supplied snapshot | Actual call path and exposure | Triage |
| --- | --- | --- |
| Pre-bump `postcss@8.5.22`; fresh consumer `postcss@8.4.49` | `@expo/metro-config`'s `transform-worker/postcss.js` invokes PostCSS for CSS transforms. The fresh consumer path is `expo-desktop-metro-config@54.81.0-beta.3` → `@expo/metro-config@54.0.17`. An untrusted CSS `sourceMappingURL` can reach source-map file-reading behavior. This is a local bundler/build path, not the compiled app's PostCSS runtime. | The fresh audit still reports PostCSS vulnerable and has `fixAvailable: false`. [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) affects through 8.5.22 and reports 8.5.23 as patched; [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q) covers the earlier source-map issue. Keep a patched minimum version as an open policy gate; test CSS/source-map compatibility and resolve all duplicate paths before claiming fixed. |
| `image-size@1.2.1` (pre-bump and fresh consumer) | Metro's `src/Assets.js` calls `image-size` while resolving dimensions of imported assets; fresh path is Expo 54.0.37 → `@expo/metro@54.2.0` → Metro 0.83.3. A crafted image can hang Metro during asset processing. This is a build-time denial of service, not a native app parser. | [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) and [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) report `2.0.3` as patched, but Metro's declared `^1.0.2` range does not include major 2. The fresh audit still reports this; keep it as an upstream Metro compatibility gate absent a separately tested override. |
| `node-forge@1.4.0` (fresh consumer) | The snapshot routes this through Expo CLI's `@expo/code-signing-certificates`; Expo CLI's `codesigning.js` and iOS `Security.js` contain the verification/signing helpers. No Spark-owned call site was found. Scope is Expo CLI signing/certificate work, not generic native app execution. | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) lists no patched version; the fresh audit still reports it with `fixAvailable: false`. Keep as an upstream Expo/code-signing gate. The advisory describes a constrained RSA signature-verification flaw; this review did not establish that Spark's ordinary app runtime exercises it. |
| `braces@3.0.3` (fresh consumer) | The fresh path is `@react-native-community/cli@20.1.3` → cli-clean → fast-glob 3.3.3 → micromatch 4.0.8. It is glob tooling, not native runtime. | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) lists no patched release; the fresh audit still reports it with `fixAvailable: false`. Keep as an upstream glob-tooling gate. |

The package paths and call sites above are based on the supplied snapshot, the
workspace source, and the installed Expo/Metro source. The advisory descriptions
are not proof of exploitability in every Spark configuration. No denial-of-
service proof of concept was run.

## What remains open

- Repeat these checks against a clean release-candidate revision and archive;
  the worker and coordinator checks both pass on all four tested package
  managers, but the current artifacts include uncommitted Windows drafts.
- Keep the fresh-consumer PostCSS 8.4.49 issue open until a patched minimum and
  CSS/source-map compatibility are verified.
- The consumer archive SHA values and audit input are recorded above; preserve
  their distinct source and artifact identities in subsequent reports.
- The bundled npm subtree still has high propagated advisories through
  `http-cache-semantics`, sigstore/TUF, and `brace-expansion`, plus moderate
  `ip-address`; evaluate npm-compatible upstream fixes and rerun the packed
  audit before claiming the CLI dependency chain is clean.
- Track PostCSS source-map compatibility and upstream Expo/Metro duplication,
  Metro's `image-size` major-version constraint, and upstream fixes for
  `braces` and `node-forge`.

Until that evidence is recorded, do not describe the SDK dependency graph as
clean or claim that the current audit has zero advisories.
