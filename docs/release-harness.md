# Release harness

```sh
bun run harness --artifact examples/kitchen-sink/dist/<app>.zip    # release run on this machine's target
bun run harness --local                                            # ad-hoc build, never releasable
bun run harness --target macos-15/arm64 --artifact <zip|dmg> \
  --vm ghcr.io/cirruslabs/macos-sequoia-vanilla:latest              # install in a disposable tart VM
```

The harness tests the release as a person receives it. It installs the distributable
the way a download is installed, asks macOS what it thinks of the signature, then
runs the [release gate](e2e-flows.md#release-gate) against the installed app, not
against the build folder. `bun run release` and `bun run release:publish` refuse to
publish without a passing report for the exact source revision they publish (see
[The publish guard](#the-publish-guard)).

Exit codes: 0 on PASS (a `--local` PASS too, which is never releasable), 1 on FAIL,
and 2 for a usage error.

## What one run does

1. **Artifact.** `--artifact` is the `.dmg` or `.zip` to install. Build the release
   with the commit it certifies, then package it:
   `cd examples/kitchen-sink && SPARK_RELEASE_REVISION=$(git rev-parse HEAD) bun run build && bun run package`.
   `spark package` writes a signed, notarized, stapled `.zip` to
   `examples/kitchen-sink/dist/` ([packaging](packaging.md)), and the build records the
   revision as `sourceRevision` in the app's `Contents/Resources/spark-runtime.json`
   (inside the signature), as the Runner build does. The build refuses a revision
   other than the checkout's `HEAD`, or a working tree with uncommitted or untracked
   changes, so the recorded revision is the source that was built. Without
   `--artifact`, `--local` packages the gate's release build
   (`cd examples/kitchen-sink && bun run build`) as a compressed DMG with the app and
   an `/Applications` link, as a release DMG is laid out. That DMG is kept in the
   report directory. A release run requires `--artifact`.
2. **Download.** The artifact is copied to a fresh temporary `Downloads/` folder, and
   `com.apple.quarantine` is set on it as a browser does (`0081;<time>;Spark release harness;`).
3. **Install** into a fresh temporary `Applications/` folder. A `.dmg` is mounted with
   `hdiutil attach -readonly -nobrowse`, and its single `.app` is copied out with
   `ditto`. A `.zip` is extracted with `ditto -x -k`, as Archive Utility does. Both
   carry the download's quarantine to the installed app. An installed app without
   the attribute fails with `quarantine`.
4. **Verify** the installed app: `codesign --verify --deep --strict`,
   `codesign -dvvv` (signer, team, hardened runtime, timestamp),
   `spctl --assess --type execute` (Gatekeeper's verdict and `source=`) and
   `xcrun stapler validate` (the notarization ticket is stapled, so Gatekeeper
   accepts the app offline). The harness never submits anything for notarization.
   The console and report print one line, such as `ad-hoc / not notarized / not stapled`
   or `Developer ID Application: Example Corp (ABCDE12345) / notarized / stapled`.
   It also reads the installed app's `sourceRevision`: a release report certifies the
   commit, so the app must have been built from it. An old signed artifact next to
   today's checkout is another build, and fails with `revision`.
5. **Gate.** `bun run gate --target <target> --artifact <installed app>` runs in
   process. Like every gate run it drives the installed app itself with its real state
   (`state: "exact"`), not the isolated `.driver` copy `e2e:run` uses. Its report goes to
   `gate/` in the harness report directory.
6. **Report:** `artifacts/harness/<commit>/<target>/report.json`, where `<target>` is
   the target ID with `/` replaced by `-`, such as `macos-15-arm64`.

### Release mode and `--local`

| | Release (default) | `--local` |
|---|---|---|
| Signature that does not verify | fails | fails |
| Not Developer ID, no hardened runtime, no timestamp | fails | recorded |
| Not notarized (Gatekeeper rejects it, or `source` is not `Notarized Developer ID`) | fails | recorded |
| Notarized, but the ticket is not stapled | fails | recorded |
| `sourceRevision` missing, or not the report's commit | fails | recorded |
| Gate after one of these failures | not run | runs |
| Quarantine when the gate launches the app | kept | removed from the installed copy, after it is recorded, when Gatekeeper rejects the app (`install.quarantineRemoved`) |
| `releasable` | PASS on a clean tree | always `false` |

Local builds are ad-hoc signed and not notarized, so a release run fails them with
`signature` and `notarization`. macOS holds the launch of a quarantined app that
Gatekeeper rejects before any of its code runs, so the driver would never start;
that is why `--local` removes the quarantine before the gate. Use `--local` to exercise the install and gate path
without Apple credentials. Its report says `"local": true, "releasable": false`, and
the publish guard rejects it.

The driver launches the app's executable directly, not through Launch Services, so
macOS does not show its first-launch Gatekeeper prompt. The harness relies on
`spctl --assess` as Gatekeeper's verdict instead, and fails a release that
Gatekeeper rejects before launching it.

### Report

`report.json` has `version` (1), `verdict` (`PASS` or `FAIL`), `releasable`, `local`,
`target`, `commit`, `dirty`, `startedAt`, `durationMs`, `environment`
(`kind` `host` or `vm`; `clean`; the `host` the app was installed on; and `vm.driver` and
`vm.image` for a VM), `artifact` (`file`, `format`, `sha256`, and `packagedFrom` for a
`--local` DMG), `install` (`app`, `quarantine`, `sourceRevision` when the app
records one, and `quarantineRemoved` under `--local`), `signature` (the verification above, `stapled` included, plus
`summary`), `gate` (`verdict`, `report`, `reasons`) and `reasons`
(`{ check, message }`). `check` is one of `usage`, `target`, `source`, `artifact`,
`install`, `quarantine`, `signature`, `notarization`, `revision`, `gate` or `vm`. A
disk image that does not detach, even with `hdiutil detach -force`, is an `install`
reason of its own and does not hide the error that stopped the install.

`environment.clean` is `true` only for a fresh clone of a VM image. A run on this
machine is `false`: it runs in the current account, with whatever developer tools it
has, and the harness cannot tell a new account from a development one. The guard
does not require `clean` yet (see [The publish guard](#the-publish-guard)).

## The machine matrix

The targets are `e2e/gate.yaml`'s. Each needs a clean machine of its kind:

| Target | Where it runs |
|---|---|
| `macos-14/arm64@macbook-air-m1-8gb`, `macos-27/arm64@macbook-pro-14-base` | The reference machine itself. Budgets measure that hardware, so a VM cannot stand in. |
| `macos-14/arm64`, `macos-15/arm64`, `macos-26/arm64`, `macos-27/arm64` | A tart VM of that macOS on an Apple Silicon host, or a clean Mac. |
| `macos-15/x64` | An Intel Mac: tart runs only Apple Silicon macOS guests. |
| `windows-11/x64`, `windows-11/arm64` | Not yet. Spark has no Windows release build, and `gate.yaml` has no `build.windows`, so there is nothing to install. The harness fails these with that reason. Windows 10 is out of scope (end of life). |

On a physical machine, use a new user account with no checkout, SDK, Bun or Xcode
when you can. The harness itself runs from a checkout, so record which account you
used. A run on a development account still installs and verifies the real
artifact, but it is not a clean machine.

## Virtual machines

`--vm <image>` installs in a disposable clone instead of on this machine. It needs
`--target`, and the image must be that target's macOS (the guest's gate fails
otherwise). Nothing boots without `--vm`. Reference-machine, Intel and Windows
targets fail with `vm` before anything boots, and so does a working tree with
uncommitted changes, because the guest gets a git archive of `HEAD`.

The run:

1. Shares a temporary host folder holding the artifact, `git archive` of the commit
   and this Bun executable.
2. Clones the image and boots the clone (`VmDriver.boot`).
3. Runs a script in the guest that unpacks the archive into `~/spark-harness`,
   installs dependencies with the shared Bun (`bun install --frozen-lockfile`, which
   needs network), runs `bun scripts/harness/cli.ts --target … --artifact … --commit <sha>`,
   and copies `artifacts/harness/` back to the share, also on failure. `--commit` is
   only for this: the archive has no `.git`, and the harness refuses it in a checkout.
4. Stops and deletes the clone, also when a step fails or the run is interrupted
   (Ctrl-C or `SIGTERM` stops the boot or the guest's command first), and keeps the
   guest's report with `environment.kind: vm` and `clean: true`.

Nothing is installed in the guest system-wide: Bun and the checkout stay in the
share and in `~/spark-harness`, and the app goes to a temporary `Applications/`.

The driver interface is in `scripts/harness/vm.ts`:

```ts
type VmDriver = { name: string; boot(image: string, share: string, signal?: AbortSignal): Promise<Guest> };
type Guest = { share: string; exec(argv: string[], signal?: AbortSignal): Promise<{ code: number; output: string }>; dispose(): Promise<void> };
```

**tart** (`tartDriver`, macOS guests): `tart clone <image> <name>`,
`tart run <name> --no-graphics --dir=harness:<share>` (the share appears at
`/Volumes/My Shared Files/harness`), `tart ip <name> --wait 300`, then
`tart exec <name> true` until the Tart Guest Agent answers (at most 2 minutes), and
`tart exec` for the script. Disposal is `tart stop` and `tart delete`. Use a Tart
version that has `tart exec`, and an image without developer tools that has the Tart
Guest Agent, such as a cirruslabs `macos-<name>-vanilla` image for the target's macOS
(check that it includes the agent). The guest's output is printed when the guest
finishes.

**Windows:** no driver yet. When Spark has a Windows release build, a Parallels
driver implements the same interface: `prlctl clone` from a clean snapshot,
`prlctl start`, a shared folder (`prlctl set --shf-host-add`) for the share, and
`prlctl exec` for the guest script, plus a Windows install step for its installer.

**Status:** the VM orchestration and the tart driver are covered by unit tests with a
fake driver (`tests/release-harness-doubles.ts`) and a fake `tart`. They have not
been run against real tart yet.

## The publish guard

`bun run release` checks before it tags or pushes, and `bun run release:publish`
checks before it touches GitHub or npm. Both call `requireHarnessPass`
(`scripts/harness/guard.ts`). For the release's source revision (`release.json`
`revision`, the commit the Runner records and `prepare-release` verifies), each
release target needs `artifacts/harness/<revision>/<target>/report.json` with
`verdict: PASS`, `releasable: true`, `local: false`, `dirty: false`, the same
`target` and `commit`, and `install.sourceRevision` equal to the revision (the
installed app was built from it). Otherwise publication stops. The message names
every target without such a report, and for a missing one says where it has to run:
on the reference machine itself, or on a Mac or tart VM running that macOS. Agents
run no VMs on the shared development Mac, so those reports come from Seth.

The release targets are every `macos-*/arm64` target in `e2e/gate.yaml`, reference
machines included, because the automated release publishes macOS Apple Silicon.
That is strict on purpose (it fails closed); narrowing it, and whether a release
needs `environment.clean`, are open decisions.

The release commit (`release: prepare <version>`) exists only on the release Mac
until the workflow pushes it, so the workflow stops at the guard the first time.
Then:

1. On the release Mac, at the release commit, build and package the Kitchen Sink with
   `SPARK_RELEASE_REVISION=$(git rev-parse HEAD)` (step 1 above), so the `.zip`
   records that commit.
2. For each VM target, on the release Mac:
   `bun run harness --target <target> --artifact <zip> --vm <image>`. The VM gets the
   commit through `git archive`, so it does not need to be pushed.
3. For each physical target (reference machines), get the commit there, for example
   with `git bundle`, check it out cleanly, run `bun run harness --artifact <zip>`, and
   copy its `artifacts/harness/<revision>/<target>/` folder back to the release Mac.
4. Run `bun run release --resume`.

The reports are plain JSON. The guard checks their contents, not who wrote them;
review copied reports as you would any release evidence.

## CI

The repository has no release CI: releases run on the signing Mac
([releases](releases.md)), and `.github/workflows/portable.yml` runs typecheck and the
unit tests, including the harness tests, on Linux and macOS. GitHub-hosted macOS
runners are themselves VMs without nested virtualization, so they cannot run tart. To run the harness in CI, use a
self-hosted Apple Silicon runner with tart and a job like:

```yaml
harness:
  runs-on: [self-hosted, macOS, ARM64, tart]
  strategy: { matrix: { target: [macos-14/arm64, macos-15/arm64, macos-26/arm64] } }
  steps:
    - uses: actions/checkout@v4
    - uses: oven-sh/setup-bun@v2
    - run: bun install --frozen-lockfile
    - run: bun run harness --target ${{ matrix.target }} --artifact dist/<artifact>.zip --vm <image for the target>
    - uses: actions/upload-artifact@v4
      with: { name: harness-${{ strategy.job-index }}, path: artifacts/harness/ }
```

The signed artifact comes from the release Mac or a signing job. Download the
uploaded `artifacts/harness/` folders into the release checkout before
`bun run release --resume`.

## From a flows task

Flows do not change for the harness: every gate flow runs against the installed app.
To check that yours works there, build the release, then run
`bun run harness --local` on your Mac (it launches the app in driver mode, without
taking focus) and look for your flow in `gate/index.html` in the report directory.
A `--local` PASS is not release evidence. The release harness runs with a signed,
notarized artifact on every release target.
