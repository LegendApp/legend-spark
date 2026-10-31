# Release process

macOS 14+ (Apple Silicon) supported; Windows preview, not yet verified

## Create an app

Choose a channel explicitly with any supported package manager:

| Manager | Next preview | Latest |
| --- | --- | --- |
| npm | `npm create @legendapp/spark@next MyApp -- --next` | `npm create @legendapp/spark@latest MyApp -- --latest` |
| Bun | `bun create @legendapp/spark@next MyApp --next` | `bun create @legendapp/spark@latest MyApp --latest` |
| pnpm | `pnpm create @legendapp/spark MyApp --next` | `pnpm create @legendapp/spark MyApp --latest` |
| Yarn (including Yarn 1) | `yarn create @legendapp/spark MyApp --next` | `yarn create @legendapp/spark MyApp --latest` |

pnpm can drop the creator tag, and Yarn 1 cannot take a tag in `yarn create`.
The self-contained creator resolves explicit channel flags through npm dist-tags.
It pins the SDK to its bundled release metadata. If the selected version differs,
it prints an exact `npx @legendapp/create-spark@<version>` command to run; version
selection downloads no SDK. `--spark-version <version|tag>` selects another release;
use only one selection flag. With no flag, the creator uses its own release.
These commands require the matching creator and release assets to be published.

## App upgrade contract

Each release must retain the cumulative app-facing notes in
`packages/desktop/skills/spark/UPGRADING.md`, shipped in the SDK. Add a heading for
the exact version (including previews), list breaking/behavior changes, show
before/after app code/config/native examples, and describe required validation.
Mark breaking releases `Breaking: yes` in the notes and `[Breaking]` in that
version's changelog section. Keep released version thresholds and notes fixed.

Add an entry to `packages/cli/src/migrations.cjs` for each breaking release and
for any automated change. Set `breaking: true` for breaking entries. If a release
only needs app decisions, its migration still emits actionable `manualStep`
entries linked to its version notes. Nonbreaking releases with no migration must
still have notes. `tests/upgrade-release-policy.test.ts` gates changelog versions,
breaking markers and migration coverage; the release workflow runs it in the
full suite after selecting/bumping the version. The workflow fails before building
if the selected version has no reviewed `UPGRADING.md` section. Supply notes/migrations for that exact version and retry;
app-facing upgrade guidance is not generated from commit titles.

Migration `apply(context)` uses the typed `MigrationContext` in
`migration-helpers.d.cts`; helpers work on an in-memory file view shared by the
whole ordered chain. **Do not write files directly or run installers from a
migration.** The planner powers both dry runs and application. Helpers:

- `editJson(file, edit)` edits existing JSON (including package scripts/fields,
  config and app.json) while retaining indentation and unrelated fields. Missing
  optional files are skipped; invalid JSON becomes a manual step.
- `renameFile(from, to)` moves text files; existing destinations require a manual
  merge. `readFile`/`writeFile` support other source/config updates.
- `updateTemplate(file, previous, next)` installs missing templates or updates an
  exact old template; customized files require a manual merge. Pass the exact
  released content, not the moving current template.
- `replaceImport(from, to, names?)` uses the existing TypeScript parser to update
  import/re-export module literals and unambiguous require/dynamic imports.
  Named API renames preserve local names through aliases. Namespace/dynamic API
  changes and unsupported references produce manual steps. Changed call semantics
  need a specific codemod or a manual step, not an import alias.
- `manualStep(message)` records the version and link to its packaged note; upgrade
  prints it and retains a checkbox in `.spark/upgrade-notes.md` across retries.

Example release entry (substitute the actual release version):

```js
{
  version: '0.0.1-next.5', automatic: false, breaking: true,
  apply(context) {
    context.editJson('package.json', /** @param {{ scripts?: Record<string, string> }} pkg */ pkg => {
      pkg.scripts ??= {};
      if (pkg.scripts.check === 'old-check') pkg.scripts.check = 'spark doctor';
    });
    context.renameFile('src/old-entry.ts', 'src/entry.ts');
    context.replaceImport('old-module', 'new-module', { oldAPI: 'newAPI' });
    context.manualStep('Update native startup options as shown in this release note.');
  },
}
```

Use `automatic: true` only for steps safe during dev/build/doctor, without an
install or an automatic change requiring an app decision; recording optional
native validation reminders is safe. Unrecorded existing apps with unsafe history
must use upgrade; newly created starters stamp their current baseline explicitly. Upgrade
uses the recorded version (installed version only if unrecorded), executes every
step in semantic-version order, applies install inputs before installation, and
records the destination only after success. All steps must be idempotent because
failed attempts can leave edits while retaining the old receipt. There is no
cross-file or package-manager rollback. Preserve user changes, report conflicts,
and retain unresolved notes; a receipt is not proof of native/app validation.

Test the helpers, an ordered multi-version jump, dry-run output with no writes,
manual notes, failure/retry and a second no-op run. The packed-distribution test
must include both SKILL.md and UPGRADING.md. Run `bun run typecheck` and the full
suite before release. Rebuilding native runtimes and affected app acceptance are
separate checks from source migrations.

Legend Spark currently identifies itself as `0.0.1` and publishes through
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
bun run release
```

To release stable **0.0.1** from the current `0.0.1-next.N` line:

```sh
bun run release --stable
```

`--stable` removes the `-next.N` suffix, uses the latest published preview on
that version line (or, with none, the highest published version below it) as the
release-notes baseline, and defaults both npm packages to `latest`. While `0.0.1`
is unpublished, a checkout already versioned `0.0.1` can use `bun run release`.
`--stable` rejects an already published stable version. Without it, `bun run release`
on a published stable `0.0.1` starts the next line at `0.0.2-next.0`, or continues
that line's published previews. A new version line with no published previews
(`0.0.2-next.0`, or a checkout already versioned `0.0.2`) uses the highest published
version below it, such as `v0.0.1`, as its release-notes baseline. The release
refuses a version below a published stable or below its channel's current npm
dist-tag; pull main first.
Add reviewed `UPGRADING.md` notes for the selected version before starting. Finish any unfinished
preview release before promoting. Stable releases are normal GitHub releases marked
Latest; preview versions stay GitHub prereleases even with npm `--latest`.

The command releases the checkout's unpublished `-next.N` version, or selects
the next preview when that version is already published. Each release moves
exactly one npm dist-tag on both packages: `latest` for a stable version such as
`0.0.1`, `next` for a prerelease such as `0.0.1-next.8`. Pass `--latest` or
`--next` to override that channel, for example `--latest` to put a prerelease on
`latest`. A resumed release keeps its original channel and refuses a conflicting
flag. When a version bump
is needed, it updates workspace manifests, `bun.lock`, templates, CLI version,
and current release documentation. It preserves an existing changelog section
for the selected version, or generates notes from committed changes since the
previous published preview tag. It checks GitHub/npm authentication,
repository identity, Developer ID signing, and notarization credentials before
changing versions. Signing secrets remain in Keychain; `.env` may select an
identity and Keychain profile using the existing `SPARK_*` configuration.

Interactive signing setup lists the available matching Developer ID certificates
first, followed by saved notarization Keychain profiles. Notarization setup offers
explicit choices to select a saved profile, enter another name, or create one;
creation is never selected automatically. A profile such
as `Moo.do` must have been stored by `notarytool`, independently of the certificate
name. A missing profile returns to the setup choices before any build begins. The chosen
certificate and profile persist in `.spark/release-signing/.spark/signing.json` and
are passed through the environment to Runner signing and subsequent resumes,
without a second selection prompt. Explicit `SPARK_*` values override saved choices.

It runs `bun install --frozen-lockfile`, typechecking, and portable tests before committing the version
change. It then builds/signs/notarizes the Runner, assembles immutable artifacts,
and runs the packed-consumer integration against the **exact staged npm archive**.
After successful checks it tags the release locally, creates a draft GitHub release
with verified assets, and publishes both npm packages to the release's channel. Only
after both packages are verified on the registry does it atomically push `main` and
the tag and publish the GitHub release. Before publishing npm it fetches and stops if
`origin/main` is not an ancestor of the release. If `main` moves after npm is live, it
pushes the tag alone, publishes the GitHub release, and stops so you can merge `origin/main` and push `main`.

If notarization is pending or a later step fails, retry the same release command
to continue the unfinished release automatically, or run:

```sh
bun run release --resume
```

Resume retains the original version and channel choice, reuses a matching Runner
build and staged artifacts, and verifies an already published npm version has the
same archive integrity before finishing tag promotion. Once artifact verification
has succeeded, its checkpoint skips installation, tests,
Runner packaging and signing setup on subsequent resumes. It refuses changed source,
changed archives, conflicting tags, and unrelated working-tree edits. A failed
check can leave the script's version edits uncommitted; preserve them for resume.
The ignored `.spark/release-workflow.json` records the selected inputs, and a PID
lock prevents two local release runs. Do not remove the checkpoint to restart an
unresolved notarization submission.

To skip all build/sign steps and publish an already assembled candidate, run:

```sh
bun run release --resume-from publish
```

This requires the saved committed candidate, its clean source revision, and
`artifacts/releases/<version>/`. It verifies artifact checksums and the creator's
embedded `dist/release.json` and package version against the SDK version before
publication. Dev packs under `artifacts/packages/` cannot be published. The local
release tag must already exist; like a full release, it pushes `main` and the tag
only after npm publication.

npm publish and dist-tag changes require **both stdin and stdout attached to a
TTY**. Run directly in a terminal, without `tee` or output redirection, so npm can
show its browser authentication URL and complete its prompt. npm output stays
attached to the terminal; the workflow does not intercept authentication URLs.

If npm already accepted the archive and only tag promotion/completion remains,
including a release started with older scripts, run:

```sh
bun run release --finish
```

This uses the saved version and channels, verifies local artifact checksums, the
remote release tag, published GitHub asset digests and npm archive integrity, then
promotes only missing tags and marks the checkpoint complete once `origin/main`
contains the release commit. It never builds,
signs, uploads or runs `npm publish`. It can preserve newer commits and drafts in
the checkout because it uses the original candidate's artifacts and revision.
If npm is still processing, a saved successful-submission record lets it wait.

Failures show a short explanation, a recovery step when available, and a diagnostic
log path instead of a stack trace. Set `SPARK_DEBUG=1` to also print the full details.
Signing menus reprompt on invalid choices. When Apple’s notarization service is
unreachable, interactive setup offers to retry validation with the same profile;
creating a profile always requires choosing the explicit create option.

The SDK and then the creator publish straight to their channel with `--tag next`
or `--tag latest`; the other tag stays where it was. Each npm write needs its own
browser approval, so a release needs two (one publish per package). The
publisher checks each archive’s availability every 15 seconds while npm processes
it and verifies the exact archive integrity, then waits for the requested tags to
become visible before marking the release complete. There is no timeout for the
processing delay; Ctrl+C pauses the release. The ignored
`.spark/npm-publications/<version>.json` records the SDK submission; a separate
`legendapp-create-spark-<version>.json` records the creator submission. Resume
waits instead of publishing either again and adds the channel tag if it is missing.
Because publishing moves the channel immediately, a creator failure after the SDK
publishes leaves the SDK on the new version and the creator, which pins its SDK
release, on the previous one until the release resumes.
Authentication failures or changed archive bytes still stop the release.

The workflow checks disk space immediately before heavy steps (dependency
installation, tests, native builds and packed-consumer installs). It preserves a
30 GB reserve and requires an additional 10 GB of build headroom. It does not run
a disk monitor that can terminate signing, notarization or npm authentication.
If a space check fails, review cleanup and rerun with `--resume`.

This workflow publishes releases for macOS Apple Silicon. Its
automated checks do not perform native UI or clean-recipient Runner acceptance.
Record those separately in the dossier. Intel macOS is not yet verified.
Promoting npm `latest` does not change the platform support listed above.

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
- Run the Kitchen Sink release gate, `bun run gate`, on each target in
  `e2e/gate.yaml` (see [Release gate](e2e-flows.md#release-gate)). It fails today:
  no e2e backend exists yet and coverage is incomplete. `bun run release` does not
  run it yet ([#55](https://github.com/LegendApp/legend-spark/issues/55)).
- On macOS, also run the pointer flows the gate leaves out:
  `bun run gate:pointer --app <KitchenSink.app>` (needs Accessibility access).
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

Publishing is a separate explicit operation. First create the matching local
`v<version>` tag on the reviewed source. Then run:

```sh
bun run release:publish
```

The publisher verifies staged checksums and repository visibility, creates a
draft release, uploads and verifies assets, publishes both exact assembled npm archives (`@legendapp/spark` and the peer-free `@legendapp/create-spark`) under the version's channel (`next` for a prerelease, `latest` for a stable version; `--latest` or `--next` overrides it) with matching versions and tags, then atomically pushes `main` and the tag,
requires the remote tag to resolve to the staged revision, and publishes the
GitHub release. After a failure at any step, rerun the same command to continue,
except when `origin/main` moved (or could not be checked) after npm publication: then
it still pushes the tag and publishes the release, and you merge `origin/main` and push
`main`, then run `bun run release --finish`, which marks the release complete only once
`origin/main` contains the release commit. It does not replace
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
npm create @legendapp/spark@next MyApp
cd MyApp
npm run dev
```

`npx @legendapp/create-spark@next MyApp` uses the same creator. The installed `spark create` command also remains available.

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
