# Preview release process

Legend Spark currently identifies itself as `0.0.1-next.2` and publishes through
the `next` preview channel. That identity remains experimental until the
[release readiness matrix](release-readiness.md) and a completed
[release evidence dossier](release-test-dossier.md) support a deliberate
promotion decision.

The npm package and Runner are artifacts of one SDK version. Release assembly
validates source/recipe provenance, the five required patched native packages,
archive hashes, size and version metadata. Patched dependency archives are staged
under project-relative `spark-packages/` paths so generated projects and ordinary
clones retain the exact verified inputs. Installation verifies those bytes before
invoking the selected package manager. See the packer and release tests for the
current implementation; do not substitute an unverified cache or producer
workspace path.

## Automated release

From a clean `main` checkout on the signing Apple Silicon Mac, use Bun 1.3.14
and Node 24.19.0 or newer, install dependencies once with `bun install --frozen-lockfile`, and run:

```sh
bun run release --latest
```

The command selects the next `-next.N` version above the checkout and npm
registry versions, updates workspace manifests, `bun.lock`, templates, CLI version,
and current release documentation, and generates changelog notes from committed
changes since the previous release tag. It checks GitHub/npm authentication,
repository identity, Developer ID signing, and notarization credentials before
changing versions. Signing secrets remain in Keychain; `.env` may select an
identity and Keychain profile using the existing `SPARK_*` configuration.

It runs `bun install --frozen-lockfile`, typechecking, and portable tests before committing the version
change. It then builds/signs/notarizes the Runner, assembles immutable artifacts,
and runs the packed-consumer integration against the **exact staged npm archive**.
After successful checks it atomically pushes `main` and the matching release tag,
publishes the GitHub prerelease and npm `next`, and assigns npm `latest` when
`--latest` was supplied. Omit `--latest` to publish only through `next`.

If notarization is pending or a later step fails, run:

```sh
bun run release --resume
```

Resume retains the original version and channel choice, reuses a matching Runner
build and staged artifacts, and verifies an already published npm version has the
same archive integrity before finishing tag promotion. It refuses changed source,
changed archives, conflicting tags, and unrelated working-tree edits. A failed
check can leave the script's version edits uncommitted; preserve them for resume.
The ignored `.spark/release-workflow.json` records the selected inputs, and a PID
lock prevents two local release runs. Do not remove the checkpoint to restart an
unresolved notarization submission.

The workflow checks disk space before commands and every 30 seconds while they
run, preserves a 50 GB reserve, and requires an additional 10 GB of headroom before
dependency installation, native builds, and packed-consumer installs. If it stops
for space, review cleanup and rerun with `--resume`.

This workflow publishes an experimental **macOS Apple Silicon** preview. Its
automated checks do not perform native UI or clean-recipient Runner acceptance.
Record those separately in the dossier; Windows and Intel native acceptance
remain pending. Promoting npm `latest` does not change that support scope.

## Manual release prerequisites

- Start from the exact reviewed source revision and retain the preview version
  and intended `next` channel unless a separately approved release decision says
  otherwise.
- Run `bun install --frozen-lockfile`, `bun run typecheck`, and the portable test command in
  [release readiness](release-readiness.md).
- Run `bun tests/packed-consumer.integration.ts` for the actual packed SDK
  consumer graph. This validates package installation and declarations, not
  native builds or runtime behavior.
- Complete the dossier for the exact source and archive. Resolve platform gates
  for every platform advertised by the candidate.
- Verify the configured GitHub repository visibility and npm identity before
  publishing; do not change either as an implicit release step.
- For signed production Runner distribution, configure the authorized Developer
  ID identity and notarization profile in Keychain. Never put secret values in
  the repository or dossier.

## Build and stage

From a clean, committed release revision on a supported Mac, run:

```sh
bun install --frozen-lockfile
bun run release:runner
```

This command packs the SDK and patched third-party archives, refreshes the
managed Runner project, forces a native Go/Debug Runner build from the committed
revision, and asks the packaging flow to sign and notarize a staging copy. The
Runner retains its development runtime mode and full native module set; this is
not a pruned standalone application build. The machine must have the Apple
toolchain and configured identities. Local Sparkle fixture tests or an ad-hoc
signature do not establish Developer ID or notarization acceptance.

If Apple is still processing, the command exits with status 2. Resume unchanged
inputs by running:

```sh
bun run release:runner --resume
```

If submission outcome is unknown, recover it explicitly with
`spark sdk package-runner --submission-id <Apple submission UUID>`; do not
discard state and resubmit. The managed project's `.spark/packaging` directory
holds the signed archive, submission identity, and recovery state. Preserve it
until the submission is resolved.

To assemble an existing signed Runner archive without rebuilding, provide its
`.zip` path to the assembly script:

```sh
bun scripts/prepare-release.ts /path/to/signed-SparkRunner.zip
```

Assembly requires the archive to match the current committed source revision
and requires `artifacts/packages/manifest.json` plus `provenance.json` from the
matching package staging run. It checks the native signature, notarization,
runtime architecture, source revision, package inventory, and package bytes.
It refuses to overwrite `artifacts/releases/<version>`; preserve staged bytes
and use a new version when inputs change.

Successful assembly writes `artifacts/releases/<version>` with the public npm
tarball, patched dependency tarballs, Runner ZIP, `runner-manifest.json`,
`checksums.txt`, and source/artifact provenance. Do not replace existing release
bytes to recover from a checksum mismatch; investigate and stage a new candidate
when inputs change.

## Publish a reviewed preview

Publishing is a separate explicit operation. First push the reviewed source and
its matching `v<version>` tag to the configured public repository. The publisher
requires the remote tag to resolve to the staged revision. Then run:

```sh
bun run release:publish
```

The publisher verifies staged checksums and repository visibility, creates a
draft prerelease, uploads and verifies assets, publishes the GitHub release,
and publishes the exact assembled npm archive under `next`. It does not replace
existing assets or move tags. Run interactively if npm needs browser
authentication. Inspect registry tags after publication: npm may assign `latest`
to an initial release, and `--tag next` does not by itself prove that no
`latest` tag exists.

No release should be described as generally production-ready until the dossier
records clean-recipient, platform-specific, and signed-distribution evidence for
the claimed support scope. See [Intel macOS targets](macos-intel.md) and
[Windows issues](windows-issues.md) for known platform-specific gates.

## Clean recipient acceptance

Run from a recipient account that has no checkout, registered SDK, cached Runner,
Bun, or Xcode. The exact manager and host version belong in the dossier:

```sh
npx @legendapp/spark@next create MyApp
cd MyApp
npm run dev
```

Press `d` and verify download progress, app launch, native controls, Fast Refresh,
close/reopen, and offline reuse of the cached Runner. Interrupt a download and
verify retry/recovery. Clone the generated project to another directory and
reinstall from its preserved lockfile and project-relative package archives.
Repeat create, clone, and reinstall for each manager advertised in the release
notes (npm, pnpm, Yarn, or Bun); list unavailable managers as `not-tested`. A
successful package fixture or bundle is not a substitute for this recipient
exercise. Record native UI acceptance separately from source, archive, and
declaration checks.

## Archive compatibility notes

The public archive contains private implementation modules under
`vendor/node_modules`, while its ordinary dependency list contains only external
packages. Spark's wrappers and native discovery resolve the bundled modules
from that vendor anchor because Yarn 4 can replace top-level `node_modules`
during linking. The packer temporarily uses npm bundle metadata to collect
implementation modules, then removes that metadata from the final manifest:
npm normalizes it into registry dependencies, which makes Yarn Classic attempt
to fetch private modules. Validate both normalized manifest metadata and actual
archive installation when changing the package format. Patched packages use the
same archive writer as other packages and a single `package/` prefix for Yarn 4
extraction.
