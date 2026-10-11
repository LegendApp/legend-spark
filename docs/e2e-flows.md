# E2E verification flows

Kitchen Sink behavior is verified by YAML flows. The format uses Maestro's core
vocabulary with Maestro semantics, plus desktop extensions. This page covers how to
write a flow and check it. The full command list is in
[e2e-flow-commands.md](e2e-flow-commands.md), which is generated from the catalog.
[Running flows](#running-flows) covers the runner, its reports and its backend
interface.

## Layout

```
e2e/
  schema/                     # generated JSON Schemas (do not edit)
  gate.yaml                   # release-gate manifest
  budgets.yaml                # performance baselines per reference machine
  checks/<area>.yaml          # check registry, one file per area
  flows/<area>/<name>.yaml    # one behavior per flow; these are gate flows
  subflows/                   # reusable command lists (runFlow)
  fixtures/                   # docs, volumes, appcasts, clipboard payloads, network mocks
  golden/<platform>/<appearance>/<locale>/<name>.png
```

The CLI knows a file's kind from where it is: `checks/<area>.yaml` is a registry,
`gate.yaml` is the manifest, `budgets.yaml` is the budgets file, anything under `subflows/` is a subflow, and anything
under `flows/` is a flow. A directory scan skips YAML anywhere else, such as fixtures.
A file you name on the command line outside those folders is checked as a flow.

## Workflow for a flows task

1. Add the checks your flow proves to `e2e/checks/<area>.yaml`, with the SDK surface
   each one `covers` (see [Check registry](#check-registry)).
2. Write `e2e/flows/<area>/<name>.yaml`: a header, `---`, then the commands. List
   the check IDs in `checks:`.
3. Run `bun run e2e:lint e2e/flows/<area>` and fix every finding. Lint also runs
   validation, so a clean lint means the files are valid too.
4. Run it: `bun run e2e:run e2e/flows/<area>/<name>.yaml --agent` (see
   [Running flows](#running-flows)).
5. Before you open a PR, run `bun run e2e:lint` with no arguments. It checks all of `e2e/`.
6. Run `bun run e2e:coverage` and fix every problem in your area (see
   [Coverage](#coverage)). Surface outside your area may stay uncovered.

```sh
bun run e2e:validate [paths…]          # syntax + schema + semantic checks
bun run e2e:lint [paths…]              # validate, plus the authoring rules below
bun run e2e:coverage [paths…] [--json] # checks ↔ flows ↔ SDK surface
```

Each problem prints as `file:line:column: message [rule]`. The exit code is 0 when
clean, 1 when there are problems and 2 for a usage error.

## A flow

```yaml
appId: so.legend.kitchensink
name: Reaction button increments
intent: Clicking the heart reaction bumps the count with a pop animation.
checks: [CTRL-BTN-01, FLR-COUNT-01]
tags: [smoke]
---
- launchApp: { clearState: true }
- tapOn: "Tighten the loop"
- tapOn: { id: reaction-heart }
- assertVisible: "❤️ 13"
- takeScreenshot: reacted
```

Header keys: `appId` and `name` are required. The others are `intent`, `checks`,
`tags`, `platforms` (`macos`, `windows`), `build` (`release` or `dev`), `manual`
(`false`, `partial`, `true`), `timeout`, `matrix` (`appearance`, `locale`,
`reduceMotion`; the flow runs once per combination), `env`, `onFlowStart` and
`onFlowComplete` (command lists). Write `intent` in plain English: agents use it to
repair a flow when it breaks. Unknown keys are errors.

A subflow is just a command list, with no header and no `---`.

## Commands

Each list item holds exactly one command. A command has up to three forms:

| Form | Example | Means |
|---|---|---|
| bare | `- launchApp` | no arguments (only for commands with nothing required) |
| value | `- pressKey: Escape` | the command's main key: `{ key: Escape }` |
| mapping | `- pressKey: { key: Escape, timeout: 2s }` | full form |

For selector commands such as `tapOn`, `assertVisible` and `hoverOn`, a bare string is
visible text and the mapping is a selector: `tapOn: { id: reaction-heart }`.

Every mapping form also takes:

- `when`: run the command only if the condition holds. It accepts `{ platform, visible,
  notVisible, matrix }`, for example
  `assertMotion: { target: { id: sheet }, kind: spring, when: { matrix: { reduceMotion: false } } }`.
  Every key in `when.matrix` must be a dimension and value from the header's `matrix`.
  `assertPaused` uses its own `when` argument (the paused state). To make it
  conditional, wrap it: `runFlow: { when: {…}, commands: [ … ] }`.
- `timeout`: overrides the implicit wait for the target (default 5s).

Some commands contain other commands: `repeat.commands`, `runFlow.commands`,
`measure.run`, `assertNoLeaks.run`, `interruptAt.with`, and `during` in
`assertFrames`, `assertNoFlicker` and `assertNoLayoutThrash`. These are validated
like top-level commands.

Durations look like `120ms`, `1.5s` or `2m`. A bare integer is milliseconds, as in
Maestro (`extendedWaitUntil: { visible: Done, timeout: 10000 }`).

`runFlow` paths are relative to `e2e/`, as in `runFlow: subflows/reset-state.yaml`.
Paths that start with `./` or `../` are relative to the current file.

### Selectors

```yaml
- tapOn: "Save"                                  # visible text
- tapOn: "/❤️ \\d+/"                              # /regex/ (must compile)
- tapOn: { id: reaction-heart }                  # testID: AX identifier / UIA AutomationId
- tapOn: { role: button, label: "Close" }
- tapOn: { text: "Row 3", within: { id: sidebar } }
- tapOn: { role: tab, index: 2, window: { title: "notes.md" } }
- tapOn: { below: "Username", role: textField }  # also above / leftOf / rightOf
- tapOn: { text: { macos: "Settings…", windows: "Options" } }
```

A window selector is `key`, `main`, or a mapping with `title`, `index`, `type` or `id`.
Prefer `id`. A `point` selector only passes lint when it sits inside an element with
an id (`{ point: "50%,50%", within: { id: canvas } }`). If the element you need has no
id, give it a testID in the app. Don't click by coordinates.

### `${VAR}` interpolation

Values may reference `${VAR}`: header `env`, `runFlow` env, and runner variables such
as `${FIXTURES}`, `${TMP}` and `${APP_PATH}`. The parser keeps them literal and the
runner substitutes them. Flows are plain YAML, so **quote a `${VAR}` value inside
`{ }` or `[ ]`**. Unquoted, the `{` is YAML syntax:

```yaml
- launchApp: { openFile: "${FIXTURES}/docs/notes.md" }   # flow mapping: quoted
- launchApp:
    openFile: ${FIXTURES}/docs/notes.md                  # block mapping: quotes optional
```

If you forget the quotes, the error points at the `{` and suggests the fix.

### Black-box and driver commands

By default, commands are black-box: they use real OS input and the accessibility tree.
Anything a user can see must be verified this way. Commands marked **driver** in the
reference use the Spark in-app driver ([#52](https://github.com/LegendApp/legend-spark/issues/52)),
so reviewers can spot white-box steps. These include motion and virtual-clock
commands, frame timing, performance, `assertState`, and:

- `setAppAppearance`: overrides the app's own appearance in-process. `setAppearance`
  changes the OS setting instead.
- `takeScreenshot` and `assertScreenshot`: captured in-process by the driver, so they
  need no screen-recording permission.

There is no `retry` and no sleep command. Every command waits for its target, and a
flaky flow counts as a failed flow. Use `extendedWaitUntil` to wait for state, or
`setClock: virtual` with `advanceClock` to step through animation.

## Running flows

```sh
bun run e2e:run [flow|dir…] [--backend name[,name…]] [--agent] [--report dir] [--app path]
```

With no paths it runs every flow under `e2e/flows`. A directory runs the flows under
it. `--backend` picks backends by name; the default is every available backend.
`--app` is the app under test, also available to flows as `${APP_PATH}`. The exit code
is 0 when every flow passed or was skipped, 1 when one failed, and 2 for a usage error.

**No production backend exists yet.** The macOS black-box backend (AX + CGEvent) lands
with [#50](https://github.com/LegendApp/legend-spark/issues/50), and the adapter for the
Spark in-app driver lands with [#226](https://github.com/LegendApp/legend-spark/issues/226).
Until then, `e2e:run` exits 2 and says so. The runner's behavior is covered by
`tests/e2e-runner.test.ts`, which uses an in-memory test backend.

### Semantics

- **Implicit waits.** A command waits for its target, polling every 100ms. The default
  is 5s; a command's `timeout` overrides it. `assertVisible` and
  `extendedWaitUntil: { visible }` wait for at least one match. `assertNotVisible` and
  `extendedWaitUntil: { notVisible }` wait for none. Commands that act on a target, such as
  `tapOn`, wait for exactly one.
- **Zero retries.** Only lookups and checks are polled. An action runs once. The first
  failure ends the flow, and a failed flow is never rerun.
- **Flow timeout.** The header `timeout` bounds the whole flow. The default is 10 minutes.
- **`when`** checks `platform` and `matrix` first, then `visible` and `notVisible` once,
  without waiting. A command whose condition is false is reported as a `skipped` step.
- **Matrix.** The flow runs once per combination of the header `matrix`, in header order.
  Each combination gets its own result, such as `flows/windows/sheet[appearance=dark]`.
  A dimension that no active backend applies is an `unsupported` failure.
- **`platforms`.** A flow that excludes the running platform is reported as `skipped`
  with the reason.
- **Variables.** `${FIXTURES}` is `<e2e root>/fixtures`. `${TMP}` is a fresh directory per
  flow run. `${APP_PATH}` is set by `--app`. Header `env` can use these, and `runFlow`
  env overrides both for its commands. An undefined variable fails the command.
- **`runFlow`.** A file must be a valid subflow, and a cycle is an error. Failures inside
  it report the failing command plus every call site (`stack`).
- **`repeat`** checks `while` before each iteration and stops after `times`. With only
  `while`, the flow timeout bounds it.
- **Restoration.** Commands that change OS or app state register an undo. When the flow
  exits (pass, failure, timeout or Ctrl-C), the runner runs `onFlowComplete`, then the
  undos last-in first-out, then stops the backends. If a restoration fails, a flow that
  otherwise passed fails with kind `restore`.

### Selector semantics

Backends find elements. The runner applies the rest, so every backend behaves the same:

- `text` and `label` match the whole value after trimming. A `/regex/` is a search.
  `id` and `role` are exact. Per-platform text uses the running platform's variant. If
  that variant is missing, the command fails.
- `within`, `window` and relation anchors must each match exactly one element or window.
  An inner part inherits the outer `window`.
- Matches are in reading order (top to bottom, then left to right), and `index` picks one.
  With `below`, `above`, `leftOf` or `rightOf`, matches are ordered nearest first and the
  nearest wins. A relation holds when the element's center is past the anchor's edge.
- `point` is a percentage of, or an offset from the top-left of, its `within` element or
  its window.
- A miss is `not-found` and lists up to five nearby candidates: the elements whose id,
  label or text are closest. More than one match is `ambiguous` and lists every match.

### Reports

Each run writes one directory. The default is `artifacts/e2e/run-<timestamp>`; use
`--report` to choose another.

```
report.json                    # the gate and dashboards read this
junit.xml                      # one testsuite per flow file
index.html                     # static page; open it in a browser
<flow path>/<matrix or "run">/
  tmp/                         # ${TMP}
  output/                      # takeScreenshot and other files the flow asked for
  failure/                     # elements-<backend>.json, screenshot, logs, driver trace
  backend-<name>/              # the backend's private directory (Session.dir)
```

Failure evidence is collected when the failure happens, before `onFlowComplete` and
restoration change anything.

`report.json` has `version`, `startedAt`, `durationMs`, `platform`, `backends`,
`interrupted`, `summary` (`total`, `passed`, `failed`, `skipped`) and `flows`. Each flow
has `id`, `file`, `name`, `intent`, `checks`, `tags`, `matrix`, `status`, `skipReason`,
`durationMs`, `steps` (every command run, with `depth`, `status` and duration), `failure`,
`errors` (problems after the first failure), `artifacts` and `metrics` (see [Metrics](#metrics)). A `failure` has `kind`,
`message`, `command`, `location`, `stack`, `candidates`, `matches`, `artifacts` and, for
invalid flows, `diagnostics`. Artifact paths are relative to the run directory.

Failure kinds: `assertion`, `not-found`, `ambiguous`, `unsupported` (a command, selector
or matrix dimension the active backends cannot handle; never skipped silently),
`invalid` (an undefined variable, an unreadable `runFlow` file, a cycle), `format`,
`timeout`, `interrupted`, `restore` and `error` (an unexpected backend error).

### Agent mode

`--agent` prints one JSON object per line:

| `event` | Fields |
| --- | --- |
| `run-start` | `runDir`, `platform`, `backends`, `files` |
| `flow-start` | `id`, `file`, `name`, `intent`, `matrix` |
| `flow-end` | Everything in the report's flow entry except `steps`. `failure.location` and `failure.stack` are `file:line:column` strings, and artifact paths are absolute. |
| `run-end` | `summary`, `interrupted`, `reports` (`json`, `junit`, `html`) |

To repair a failing flow, read `intent`, go to `failure.location`, and compare the
selector with `failure.candidates`. Then open the screenshot and the
`elements-<backend>.json` dump from `failure.artifacts`.

### Backends

A backend implements `Backend` in `scripts/e2e/runner/backend.ts` and is registered by
name in `BACKENDS` in `scripts/e2e/runner/run.ts`.

- `kind` is `black-box` (OS input and the accessibility tree) or `driver` (in-process).
  Commands marked **driver** run only on a driver backend. Other commands run only on a
  black-box backend, except lifecycle commands, which either kind may own. Visibility
  checks (`assertVisible`, `assertNotVisible`, `extendedWaitUntil`, `when`) use the
  black-box backend.
- `commands` is the dispatch table. If no eligible backend has a command, the flow fails
  with `unsupported`, naming the backend. The runner itself runs `runFlow`, `repeat`,
  `extendedWaitUntil`, `assertVisible` and `assertNotVisible`.
- Selectors: implement `elements()` (every visible element, in screen coordinates, with
  `parent` keys) and the runner matches everything, lists candidates and dumps the tree.
  A backend that cannot list elements implements `query()` with the atom keys it
  supports in `queryKeys`. Any other selector key is `unsupported`. `windows()` lists
  windows front to back.
- Handlers get a `CommandContext`. It has `target()`, `resolve(selector)` and
  `window(selector)` (waits with the shared semantics), `eventually(check)` (polls a
  check that throws `Failure("assertion", …)`), `onRestore(label, undo)`, `run(commands)`
  for nested commands, `outputDir` with `addArtifact` for files the flow asked for, and
  `metric(name, value)` for measurements the gate checks against budgets.
- `matrix` lists the dimensions the backend applies, from `session.matrix` in `start`.
  `collect(dir)` writes failure evidence: a screenshot, logs, a driver trace.

The #52 driver protocol (`ping`, `navigate`, `waitFor`, `setAppAppearance`, `capture`,
`quit`) fits as a `driver` backend:

- `start` and `launchApp` launch the app in driver mode, and `openUrl` maps to `navigate`.
- `query` supports `id` through `waitFor`, and returns at most the first match.
- `matrix` has `appearance` (via `setAppAppearance`) and `locale` (a launch argument).
- `takeScreenshot` and `collect` use `capture`, and `stop` uses `quit`.

## Lint rules

| Rule | Finding |
|---|---|
| `unknown-command` | Not in the catalog. The message suggests the closest command. |
| `no-sleep` | `sleep`, `wait`, `delay`, `pause`, `waitFor…`. |
| `missing-checks` | The flow has no `checks:`, or an empty list. |
| `check-id` | A check ID that is not `PREFIX-NAME-NN`, such as `MW-TEAR-01`. |
| `dev-build` | `build: dev` in a gate flow (under `flows/`). |
| `point-selector` | A `point` selector that is not anchored `within: { id }`. |
| `schema`, `yaml`, `structure` | Validation problems (also reported by `e2e:validate`). |

## Check registry

`e2e/checks/<area>.yaml`. There is one file per area, so parallel agents never edit
the same file:

```yaml
area: windows          # must match the file name
prefix: WIN
checks:
  WIN-FRAME-01:        # <prefix>-<NAME>-<NN>
    title: Frame autosave restores per window ID
    platforms: [macos, windows]
    blocking: true
    spec: "Spec §2 Windows"
    covers:
      - ./windows#openWindow
      - ./windows#setWindowBounds
```

The validator rejects a prefix or file name mismatch, a malformed ID, a missing
`title`, duplicate IDs in a file, and a malformed or repeated `covers` entry.

### Declaring coverage

`covers` lists the `@legendapp/spark` surface the check verifies, as surface IDs:

| Surface | ID | Example |
|---|---|---|
| subpath | `<subpath>` | `./config` |
| export | `<subpath>#<export>` | `./windows#openWindow` |
| availability flag | `<subpath>#<getXAvailability>(<arg>).<flag>` | `./windows#getWindowAvailability().available`, `./ui#getControlAvailability(select).available` |

The subpath is the key in `packages/desktop/package.json` `exports`. A cover also
covers what contains it: a flag covers its function's export, and an export covers
its subpath. Covering `./windows#getWindowAvailability` does not cover its flags,
though. Each flag needs a check that verifies it.

Only list surface the flow really exercises. A cover is a claim that the flow
proves the behavior, and the gate trusts it.

## Coverage

`bun run e2e:coverage` reads every registry and gate flow under `e2e/` and the SDK
surface, then reports:

| Rule | Problem |
|---|---|
| `no-flow` | A registered check that no flow lists in `checks:`. |
| `unregistered-check` | A flow lists a check ID that no registry defines. |
| `duplicate-check` | Two registries define the same check ID. |
| `unknown-cover` | A `covers` entry that is not in the SDK surface (a typo, or a removed export). |
| `schema`, `yaml`, … | A registry or flow that does not validate. The file is left out of coverage. |

Then it lists the uncovered SDK surface, grouped by subpath. The required surface is:

- every subpath in the SDK `exports`, except `./package.json` (package metadata),
- every runtime export of each TypeScript entry, as the type checker sees it
  (type-only exports may be covered, but aren't required),
- every flag of every `get*Availability()` export: one per boolean property of its
  result, and one per value when its first parameter is a string-literal union.

`scripts/api-surface.ts` derives this surface. `tests/api-public-surface.test.ts`
uses the same code for the `docs/api-public-surface.json` snapshot.

Only checks that some flow lists count toward coverage. The exit code is 0 only when
there are no problems and every required item is covered, 1 otherwise, and 2 for a
usage error. Coverage is not part of `bun run test`: most areas have no checks yet,
so it fails today. The [release gate](#release-gate) makes it blocking.

`--json` prints the report for the gate and dashboards:

```jsonc
{
  "ok": false,
  "summary": { "checks": 12, "flows": 9, "required": 313, "covered": 40, "problems": 1 },
  "checks": [{ "id": "WIN-FRAME-01", "area": "windows", "title": "…", "location": { "file": "e2e/checks/windows.yaml", "line": 4, "column": 3 },
               "covers": ["./windows#openWindow"], "flows": ["e2e/flows/windows/frame.yaml"] }],
  "surface": [{ "id": "./windows#openWindow", "kind": "export", "subpath": "./windows", "coveredBy": ["WIN-FRAME-01"] }],
  "problems": [{ "file": "e2e/checks/windows.yaml", "line": 9, "column": 3, "rule": "no-flow", "message": "…", "area": "windows" }]
}
```

`kind` is `subpath`, `export` or `availability`.

## Release gate

```sh
bun run gate                      # run the gate for this machine's target
bun run gate --dry-run            # plan only: the target, checks, flows and budgets
bun run gate --target macos-14/arm64@macbook-air-m1-8gb --dry-run   # plan another target
```

The gate certifies one target per run: the machine it runs on. The verdict is PASS
only when every check below passes. The exit code is 0 on PASS, 1 on FAIL (or an
invalid `e2e/gate.yaml`, whose problems it prints), and 2 for a usage error, such as a
`--target` that is not in the manifest. It never passes vacuously. A missing target,
backend, build, flow, baseline, measurement or sign-off is a failure with its own reason.

**It fails today.** No backend exists yet (#50, #226), coverage is incomplete, and the
budgets are not measured. The release scripts do not run it yet; that is
[#55](https://github.com/LegendApp/legend-spark/issues/55).

### Manifest

`e2e/gate.yaml` (schema: `e2e/schema/gate.schema.json`). Every key is required except
`build.<platform>.verifySignature` and `targets[].machine`.

| Key | Meaning |
|---|---|
| `suite`, `appId` | Names for the report. |
| `build.macos` / `build.windows` | `artifact`: the release build to test, relative to the repository root. `${ARCH}` becomes `arm64` or `x64`. `verifySignature: true` runs `codesign --verify --deep --strict` (macOS; Windows verification is not implemented, so asking for it fails). The flows get the artifact as `${APP_PATH}`. |
| `targets` | `{ os, arch, machine? }`. `os` is `macos-<major>` or `windows-<10\|11>`; `arch` is `arm64` or `x64`, as Spark names them. `machine` names a reference machine from the budgets file: that target runs on that hardware and checks its budgets. |
| `include` | Globs of gate flows, relative to `e2e/`. |
| `blocking` | `{ tags, default }`. A flow blocks the release when it fails if it has one of `tags`, lists a check registered `blocking: true`, or `default` is true. A non-blocking failure is a warning. |
| `retries` | Must be `0`. Flaky means failed; the gate never reruns a flow. |
| `timeBudget` | The longest the whole run may take, such as `45m`. When it passes, the running flow and every later flow fail with `timeout`, and the gate fails. |
| `budgets` | The budgets file, relative to `e2e/`. |
| `coverage` | `{ checks, exports, availability }`. `checks` is the registry directory. `exports` requires every subpath and runtime export, and `availability` requires every availability flag. |
| `signoffs` | The manual sign-off file, relative to the repository root. |
| `report` | `{ json, html }`, relative to the repository root. The runner's own report goes in `run/` next to `json`. |

**Target detection.** The gate reads the macOS major version (`sw_vers`) or the Windows
build (22000 and later is Windows 11), the OS-reported CPU (not the process's, which
may be emulated, and not `SPARK_*_ARCH`), and on macOS the model (`sysctl hw.model`)
and memory. A machine-bound target matches only on its hardware. When both a
machine-bound and a plain target match, the machine-bound one wins. `--target` picks a
target by ID (`os/arch` or `os/arch@machine`). If this machine cannot be that target,
the run fails without running flows; use `--dry-run` to plan other targets.

### What runs

1. **Source:** uncommitted changes fail. The gate certifies a commit.
2. **Lint:** `bun run e2e:lint` over all of `e2e/`, including the manifest and budgets.
3. **Coverage:** `bun run e2e:coverage` over the registries and every gate flow (for
   all targets), with the required surface from `coverage`.
4. **Build:** the target's artifact exists and, if asked, its signature verifies.
5. **Flows:** the gate flows whose `platforms` include the target's platform, every
   matrix combination, run through the runner with every registered backend for that
   platform. Flows with `manual: true` are not run; `manual: partial` flows are run and
   signed off. Any failed or skipped blocking run fails the gate.
6. **Budgets** on a machine-bound target (see [Budgets](#budgets)).
7. **Sign-offs** for every manual run (see [Manual sign-offs](#manual-sign-offs)).
8. **Time budget** for the whole run.

The gate runs every check even after one fails, so one report lists every reason.
Flows don't run when there is no backend, no build, or this machine cannot be the
`--target`.

### Report

`report.json` has `version`, `verdict` (`PASS` or `FAIL`), `reasons` (`{ check, message }`: every
reason for FAIL), `warnings` (non-blocking failures), `suite`, `appId`, `startedAt`,
`durationMs`, `timeBudgetMs`, `host`, `target`, `machine`, `commit`, `dirty`, `build`
(`artifact`, `exists`, `signature`), `backends`, `coverage` (`required`, `covered`,
`problems`), `flows` (one per run ID: `status` is `passed`, `failed`, `skipped`,
`not-run`, `signed-off` or `unsigned`, plus `blocking`, `manual`, `failure`, `signoff`),
`excluded` (flows for other platforms), `budgets` (one entry per measurement:
`metric`, `flow`, `value`, `baseline`, `limit`, `status`) and `run` (the runner's report
directory). `check` is one of `manifest`, `target`, `source`, `lint`, `coverage`,
`build`, `backend`, `flows`, `time-budget`, `budgets` or `signoffs`. The HTML page shows
the same and links to the runner's page.

### Budgets

`e2e/budgets.yaml` (schema: `e2e/schema/budgets.schema.json`) holds baselines per
reference machine:

```yaml
machines:
  macbook-air-m1-8gb:
    name: MacBook Air (M1, 2020), 8 GB, 60 Hz display
    model: MacBookAir10,1        # sysctl hw.model
    memoryGB: 8
budgets:
  - metric: startup.coldMs
    description: Cold launch to the first frame of the catalog
    better: lower                # lower | higher
    tolerance: 10%               # how much worse than the baseline still passes
    baselines: { macbook-air-m1-8gb: not-measured }   # a number once measured
    # blocking: false            # default true
    # flows: [flows/startup/**]  # default: every gate flow that records the metric
```

On a target with `machine: M`, each budget with a baseline for `M` is checked against
every value of its metric that a selected flow recorded. A value worse than the
baseline by more than `tolerance` fails. A blocking budget **fails closed**:
`not-measured` fails (the reason lists the values this run measured, so you can record
one), and so does a budget that no flow recorded. Budgets without a baseline for `M`
do not apply. Every machine with baselines needs a target in `gate.yaml`, and every
`targets[].machine` needs a machine here. Otherwise the gate fails with `manifest`.

To record a baseline, run the gate on the reference machine with the release build,
take the value from the reason or from `budgets` in `report.json`, and replace
`not-measured` with it in a reviewed change.

The Kitchen Sink reference machines are the MacBook Air (M1, 8 GB) for startup,
memory and 60 Hz frame rate (target `macos-14/arm64@macbook-air-m1-8gb`), and the
base 14-inch MacBook Pro for 120 Hz frame rate (target
`macos-27/arm64@macbook-pro-14-base`). No baselines are measured yet.

### Metrics

Backends record measurements with `context.metric(name, value)`. They appear in the
run report as `metrics: { name: [values…] }` on each flow result. Budgets refer to
these names, so backends (the driver adapter, #226) use them for the performance commands:

| Command | Metrics |
|---|---|
| `assertStartup` | `startup.coldMs`, `startup.firstPaintMs` |
| `assertMemory` | `memory.mb` |
| `assertFrames` | `frames.fps`, `frames.dropped` |
| `assertIdleCpu` | `cpu.idlePercent` |
| `measure` | `measure.<name>` (milliseconds) |

### Manual sign-offs

Flows with `manual: true` or `manual: partial` need one passing sign-off per run ID, for
this target and the commit under test. Until the sign-off mode
([#57](https://github.com/LegendApp/legend-spark/issues/57)) writes this file, it is
written by hand, and the runner reports a `manualStep` as `unsupported`, so a
`manual: partial` flow fails. The file is `signoffs` from the manifest (schema:
`e2e/schema/signoffs.schema.json`):

```yaml
signoffs:
  - flow: flows/menus/macos-items[appearance=dark]   # the run ID from the gate report
    target: macos-15/arm64
    commit: 0123456789abcdef0123456789abcdef01234567  # git rev-parse HEAD
    verdict: pass                                     # pass | fail
    by: Jane Doe
    at: 2026-10-10T14:03:00Z
    evidence: [artifacts/gate/manual/macos-items-dark.png]   # optional, must exist
    note: optional
```

A missing file, a missing or duplicated sign-off, `verdict: fail`, or missing evidence
fails the gate with `signoffs`.

### From a flows task

Your flow is a gate flow as soon as it is under `flows/`. Before you open a PR, run
`bun run gate --dry-run` to see it in the plan for your platform, and check that it is
blocking (the default). If it measures performance, record metrics through the driver
commands above. Ask for a budget in `e2e/budgets.yaml`, and leave it `not-measured`
until someone measures it on the reference machine.

## Editor support

`.vscode/settings.json` maps the schemas in `e2e/schema/` onto `e2e/flows`,
`e2e/subflows`, `e2e/checks`, `e2e/gate.yaml`, `e2e/budgets.yaml` and
`artifacts/gate/signoffs.yaml`. With the recommended
[YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml)
(`redhat.vscode-yaml`), the editor validates flows against the schema as you type.
Some checks run only in the CLI: accelerator and regex syntax, `when.matrix` against
the header, the registry prefix and file name, and the lint rules. When the editor and
the CLI disagree, the CLI is right.

## Using the parser from code

```ts
import { parseFlow, parseSubflow, parseCheckRegistry, checkFlow } from "./scripts/e2e/format/parser.ts";

const flow = parseFlow(source, file);   // throws FlowFormatError with every located problem
flow.commands[0];                       // { name, args, when?, timeout?, location: { file, line, column } }
```

`args` is the canonical mapping: value and bare forms are expanded, and nested
commands become `FlowCommand` values. `checkFlow` returns `{ diagnostics, value }`
instead of throwing.

## Changing the format

The catalog in `scripts/e2e/format/commands.ts` is the single source. Each entry lists
the command's mapping keys (as JSON Schema), its value shorthand, and its `driver` and
`maestro` flags. After you edit it:

1. Run `bun run e2e:schema`. This regenerates `e2e/schema/*.json` and
   `docs/e2e-flow-commands.md`. A test fails if either drifts from the catalog.
2. Add the new command's forms to `tests/fixtures/e2e/subflows/all-forms.yaml`. A test
   requires every form of every command to appear in a fixture.
3. Run `bun run test tests/e2e-flow-format.test.ts`.
