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
  dev-flows/<area>/<name>.yaml  # `build: dev` flows: development builds only, outside the gate
  subflows/                   # reusable command lists (runFlow)
  fixtures/                   # docs, volumes, appcasts, clipboard payloads, network mocks
  golden/<platform>/<appearance>/<locale>/<name>.png   # see Visual goldens
```

The CLI knows a file's kind from where it is: `checks/<area>.yaml` is a registry,
`gate.yaml` is the manifest, `budgets.yaml` is the budgets file, anything under `subflows/` is a subflow, and anything
under `flows/` or `dev-flows/` is a flow. The release gate runs `flows/`, which test release builds. `dev-flows/` holds
flows with `build: dev`, for behavior only a development build has (the Developer menu); they list checks for
coverage like any flow, and you run them yourself against a development build. A directory scan skips YAML anywhere else, such as fixtures.
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
7. Run your flow, or your area, through the release gate against the release build:
   `bun run gate --flow e2e/flows/<area> --agent` (see [Scoped runs](#scoped-runs---flow)).

## Run, read and repair (for agents)

| To | Run |
|---|---|
| Run one flow on the last development build | `bun run e2e:run e2e/flows/<area>/<name>.yaml --agent` |
| Run an area | `bun run e2e:run e2e/flows/<area> --agent` |
| Judge one flow or area as the gate does (release build, signature, lint, coverage, budgets, sign-offs) | `bun run gate --flow e2e/flows/<area>[/<name>.yaml] --agent` |
| See what a manual flow's run awaits from a person (you never sign off: see [From an agent](#from-an-agent)) | `bun run gate:signoff --list --scoped` after the `--flow` run |

Both print one JSON object per line ([Agent mode](#agent-mode)). Read the last line:
`run-end` has the `summary`, `gate-end` has the `verdict` and every `reasons` entry. A
failed run has a `bundle` path on its `flow-end` line (and in `gate-end.flows`). Exit
codes are 0 (pass), 1 (fail) and 2 (usage error).

To repair a failed flow, open its [failure bundle](#failure-bundles) and work from it:

1. Read `flow.intent`. It says what the flow proves; the fix keeps that true. Never
   weaken an assertion, raise a timeout or delete a step to make a flow pass.
2. Go to `failure.location` (the innermost failing command; `failure.stack` lists the
   `runFlow` and nested call sites above it). `failure.args` is that command after
   `${VAR}` substitution, and `failure.selector` its selector.
3. Use `failure.kind`:
   - `not-found`: compare `failure.selector` with `failure.candidates`, the closest
     elements on screen. A renamed testID or changed text is a flow fix; a missing
     element is an app bug.
   - `ambiguous`: `failure.matches` lists every match. Add `id`, `within`, `window` or
     `index`.
   - `assertion` from `assertScreenshot`: open the `goldens` entry's `actual`, `golden`
     and `diff`. Approve only an intended change ([Approving goldens](#approving-goldens)).
   - `unsupported`: the active backends cannot run that command. Don't remove it; see
     [Backends](#backends).
   - `format` or `invalid`: `failure.diagnostics` or the message names the problem.
4. Open `screenshot` (the window when the flow failed) and the `elements-<backend>.json`
   dump in `artifacts` to see what was on screen, and the `logs` artifacts for app errors.
5. `steps` lists every command that ran, subflows included, so you can see how far the
   flow got. `flow.env`, `flow.matrix` and `run` show the variables, matrix
   combination, backends, app and machine it ran with.
6. Rerun the flow, then the gate for it, until both pass.

If the app is wrong rather than the flow, fix the app or open a task; don't change the
flow to match a bug.

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
  need no screen-recording permission. See [Visual goldens](#visual-goldens).

Until the black-box backend lands, a run with only the driver backend runs visibility
checks, selectors, input (`tapOn`, `typeText`, `pressKey`, `scroll`, `dragAndDrop`, trackpad
gestures and others), `assertCursor`, `assertText` and `assertA11y` in-process (see [The driver backend](#the-driver-backend)):
events the app dispatches to itself and the views of its own windows, not what a user sees
or does. The runner labels those steps white-box in reports.

### Security audits

Commands marked **runner** in the reference read the build on disk, not the running
app. The runner runs them itself, so they need no backend. A flow made only of them
(no `onFlowStart`, `onFlowComplete` or `when`) starts no backend, so it never opens the
app or its state. Pass the artifact the gate tests as `app: "${APP_PATH}"`. The gate's
`e2e/flows/security/` flows register their checks in `e2e/checks/security.yaml`:

- `assertEntitlements: { app, sandbox, allow }` reads the signed entitlements of every
  Mach-O file. A process may carry only the entitlements in `allow`, which maps each
  entitlement to the reason the release needs it. `get-task-allow` always fails. An
  `allow` entry that no process carries also fails, so the list stays minimal. The
  hardened runtime exceptions (`disable-library-validation`,
  `allow-dyld-environment-variables`, `allow-unsigned-executable-memory`,
  `disable-executable-page-protection`, `allow-jit`, `debugger`) are named when they
  show up. `sandbox: false` is the direct-distribution build, where no process is
  sandboxed. `sandbox: true` is the Mac App Store variant
  ([#154](https://github.com/LegendApp/legend-spark/issues/154)), where every process is.
- `assertCodeSigning: <app>` checks that every Mach-O file is signed by the main
  executable's team, that every process has the hardened runtime, and that no process
  turns off library validation. Ad-hoc signing fails. With the hardened runtime, library
  validation refuses a library from another team, and an ad-hoc signature has no team.
  That is why `bun run build` stays ad-hoc without the hardened runtime: only
  `spark package` signs with a Developer ID ([packaging](packaging.md)). Run this check
  through the [release harness](release-harness.md) on the packaged artifact.
- `assertLoadPaths: <app>` parses the load commands of every Mach-O file itself
  (`otool` is not on release-harness machines). Every `LC_RPATH` has to be
  `@executable_path`/`@loader_path` inside the bundle, or in `/System/` or `/usr/lib/`
  (protected by System Integrity Protection). Every dependency, weak ones included, has
  to resolve to a file inside the bundle or to a system library. `LC_DYLD_ENVIRONMENT`
  fails. A library resolves `@executable_path` against the main executable. A library's
  `@rpath` lookups also use the main executable's run paths, as dyld does. On Windows
  this audits the DLL search order. That part needs Windows hardware and the Windows
  backend ([#51](https://github.com/LegendApp/legend-spark/issues/51)), so it fails as
  `unsupported` until then.

### App icon audit

`assertAppIcon: { app, styles }` is a **runner** command too: it reads the app icon of the
build on disk, with no backend. The gate's `e2e/flows/appearance-theming/app-icon-*.yaml`
flows register their checks in `e2e/checks/appearance-theming.yaml`.

- macOS: Info.plist names the asset catalog icon (`CFBundleIconName`) and the `.icns` file
  (`CFBundleIconFile`). `assetutil --info`, which ships with macOS, lists the catalog: the
  icon needs 32 to 1024 pixel renditions (16 to 512 points at 2x). The `.icns` file older
  macOS uses is parsed and must be valid; without a catalog icon it needs those sizes too.
  `styles` lists the macOS 26 Icon Composer styles the icon must carry: `default`, `dark`,
  and `clear` and `tinted`, which both render the tintable image stack. Only an icon built
  from an Icon Composer document has them ([App icons](configuration.md#app-icons)).
- Windows: `app` is the executable, or the build directory holding one. The first icon
  group (`RT_GROUP_ICON`), which Explorer and the taskbar draw, needs 16, 20, 24, 32, 40,
  48, 64 and 256 pixel images. `styles` is macOS-only.

The driver flow `app-icon-styles.yaml` renders the icon in each style in-process:
`-AppleIconAppearanceTheme` (`RegularLight`, `RegularDark`, `ClearLight`, `ClearDark`,
`TintedLight`, `TintedDark`) in the launch arguments sets the icon and widget style for
the driven app only, and `getAppIcon()` draws the icon the way Finder and the Dock do.

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

One production backend exists: `driver`, the Spark in-app driver on macOS (see
[The driver backend](#the-driver-backend)). The macOS black-box backend (AX + CGEvent)
lands with [#50](https://github.com/LegendApp/legend-spark/issues/50); until then the driver
runs the black-box commands it implements in-process, labelled white-box, and every other
black-box command fails as `unsupported`. The runner's behavior is covered by
`tests/e2e-runner.test.ts`, which uses an in-memory test backend.

```sh
cd examples/kitchen-sink && bun run rebuild:macos            # once, and after native changes
bun run e2e:run e2e/flows/infra/catalog-driver.yaml --backend driver
```

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
- **`manualStep`.** The runner never performs it. It records the step as awaiting sign-off (step status
  `awaiting-signoff`, and an entry in the flow's `manual`) and runs the next command. Its evidence is the capture of
  an earlier `takeScreenshot` that `screenshot` names (with `window` for another window than the main one); a name no
  takeScreenshot of this run captured before it is `invalid`. Defaults are `signoff: required` and `evidence:
  screenshot` with `screenshot`, else `none`. `evidence: recording` is `unsupported`: no backend records the screen.
  A manualStep is valid only in a flow with `manual: partial` or `manual: true` (validation reports an inline one; one in
  a subflow fails with `invalid`), because only those flows get a sign-off. See [Manual sign-offs](#manual-sign-offs).
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
  screenshots/                 # assertScreenshot: <name>.png, and on failure <name>.expected.png, <name>.diff.png
  failure/                     # bundle.json, elements-<backend>.json, screenshot, logs, driver trace
  backend-<name>/              # the backend's private directory (Session.dir)
```

Failure evidence is collected when the failure happens, before `onFlowComplete` and
restoration change anything.

`report.json` has `version`, `startedAt`, `durationMs`, `platform`, `backends`,
`interrupted`, `summary` (`total`, `passed`, `failed`, `skipped`, and `awaitingSignoff`: runs with manual steps) and `flows`. Each flow
has `id`, `file`, `name`, `intent`, `checks`, `tags`, `matrix`, `status`, `skipReason`,
`durationMs`, `steps` (every command run, with `depth`, `status` and duration), `failure`,
`bundle` (the [failure bundle](#failure-bundles) of a failed run), `errors` (problems after the first failure), `artifacts`, `goldens` (see [Visual goldens](#visual-goldens)), `metrics` (see [Metrics](#metrics)) `whiteBox`
(the black-box commands a driver backend ran in-process, sorted; such steps have `whiteBox: true`) and `manual` (each manualStep reached: `instruction`, `expect`, `evidence`, `signoff`, `location`, `stack`, and `screenshot` with `capture`: the takeScreenshot's name and window).
A run with manual steps still passes; the console prints each one as `awaiting sign-off`. A `failure` has `kind`,
`message`, `command`, `args` (that command's arguments after `${VAR}` substitution, when it
got that far), `location`, `stack`, `candidates`, `matches`, `artifacts` and, for
invalid flows, `diagnostics`. Artifact, golden and bundle paths are relative to the run directory.
Artifact kinds are `screenshot`, `golden` (the expected image of a failed
`assertScreenshot`), `diff`, `elements`, `logs`, `trace`, `recording` and `output`. The
HTML page shows `screenshot`, `golden` and `diff` inline.

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
| `flow-end` | Everything in the report's flow entry except `steps`. `failure.location` and `failure.stack` are `file:line:column` strings, and artifact and `bundle` paths are absolute. |
| `run-end` | `summary`, `interrupted`, `reports` (`json`, `junit`, `html`) |

To repair a failing flow, open its `bundle` and follow
[Run, read and repair](#run-read-and-repair-for-agents).

### Failure bundles

Every failed flow run (every matrix combination, invalid flows included) gets one
`failure/bundle.json` in its run directory. The report's flow entry, the `flow-end` line,
the JUnit output, the HTML page, the console and the gate report all point to it. It
holds what a repair needs and refers to the evidence the runner already wrote; it never
copies a file. Its paths are relative to the bundle's directory, so a run directory can
be moved or uploaded whole. Source locations (`failure.location`, `failure.stack`) are
`file:line:column`, relative to the working directory, as in the report.

```jsonc
{
  "version": 1,
  "flow": {
    "id": "flows/menus/availability", "file": "e2e/flows/menus/availability.yaml", "name": "…", "intent": "…",
    "checks": ["MENU-AVAIL-01"], "tags": [], "matrix": {},
    "source": "../…/e2e/flows/menus/availability.yaml",
    "env": { "FIXTURES": "…", "TMP": "…", "APP_PATH": "…" }           // runner variables and header env, resolved
  },
  "failure": {                                                       // the report's failure, plus:
    "kind": "not-found", "message": "…", "command": "tapOn",
    "args": { "id": "menus-open" }, "selector": { "id": "menus-open" },
    "location": "e2e/flows/menus/availability.yaml:9:3", "stack": [],
    "candidates": [], "matches": [], "artifacts": [{ "kind": "elements", "path": "elements-driver.json", "backend": "driver" }]
  },
  "screenshot": "driver-main.png",                                   // the last screenshot
  "goldens": [],                                                     // assertScreenshot runs that did not pass
  "artifacts": [ … ],                                                // all evidence
  "steps": [{ "command": "launchApp", "location": { … }, "depth": 0, "status": "passed", "durationMs": 812 }, …],
  "errors": [],
  "run": { "platform": "macos", "backends": [{ "name": "driver", "kind": "driver" }], "app": "…", "host": { "os": "macos-27", "arch": "arm64", … } }
}
```

| Key | Holds |
|---|---|
| `flow` | The flow's header fields, its matrix combination, its file (`source`) and every variable it ran with (`env`: `FIXTURES`, `TMP`, `APP_PATH` and the header `env`; `runFlow` env is not included) |
| `failure` | The report's `failure`, plus `args` (the failing command's arguments after substitution; absent when substitution itself failed) and `selector` (its selector keys, or its `visible` / `notVisible` selector) |
| `screenshot` | The last screenshot: the capture taken at the failure, or else the last one the flow took |
| `goldens` | Each `assertScreenshot` that failed or had no golden: `id`, `golden`, `actual`, `diff`, `stats` ([Comparison](#comparison)) |
| `artifacts` | The failure evidence (element tree, capture, logs, and anything a backend's `collect` returns), then the files the flow wrote on purpose. Any artifact kind a backend adds appears here with its `kind` and `backend`, so new driver evidence needs no bundle change |
| `steps` | Every command that ran, subflows and nested commands included, in order |
| `errors` | Problems after the first failure (`onFlowComplete`, restoration, stopping a backend) |
| `run` | The platform, backends, `--app` and, from `bun run e2e:run` and the gate, the machine (`host`: OS, arch, model, memory) |

The bundle is written after `onFlowComplete`, restoration and backend shutdown, so
`errors` is complete; the evidence it lists was collected at the failure.

### Backends

A backend implements `Backend` in `scripts/e2e/runner/backend.ts` and is registered by
name in `BACKENDS` in `scripts/e2e/runner/run.ts`.

- `kind` is `black-box` (OS input and the accessibility tree) or `driver` (in-process).
  Commands marked **driver** run only on a driver backend. Lifecycle commands run on
  either kind. Other commands are black-box: they run on a black-box backend, and when no
  black-box backend is active, on a driver backend that implements them. Visibility checks
  (`assertVisible`, `assertNotVisible`, `extendedWaitUntil`, `when`) use the black-box
  backend, or the driver backend when it is the only kind active. A black-box command or
  visibility check answered by a driver backend is a white-box step: the report marks it
  (`whiteBox` on the step and the flow, "white-box" in the HTML page and the console line).
  A flow tagged `black-box` never runs white-box: without a black-box backend, its black-box
  commands and visibility checks are `unsupported`. Use it for behavior the driver cannot
  reproduce, such as keyboard input to AppKit controls.
- The release gate accepts white-box passes for now; they stay labelled in its report. Once the
  black-box backend lands ([#50](https://github.com/LegendApp/legend-spark/issues/50), which needs
  a TCC grant), `gate.yaml` will gain a per-tag `requireBlackBox` option.
- `commands` is the dispatch table. If no eligible backend has a command, the flow fails
  with `unsupported`, naming the backend. The runner itself runs `runFlow`, `repeat`,
  `extendedWaitUntil`, `assertVisible`, `assertNotVisible`, the [security audits](#security-audits) and the [app icon audit](#app-icon-audit).
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
- `screenshot(file, window)` writes a PNG of a window (the main window when `window` is
  undefined) and returns `{ frame, scale }`: the captured area in the coordinate space of
  element frames, and its pixels per point. The runner implements `takeScreenshot` and
  `assertScreenshot` with it, so they behave the same on every backend; it uses the first
  backend of the kind the catalog asks for (driver) that has `screenshot`.
- `matrix` lists the dimensions the backend applies, from `session.matrix` in `start`.
  `collect(dir)` writes failure evidence: a screenshot, logs, a driver trace.

### The driver backend

`--backend driver` (`scripts/e2e/runner/driver-backend.ts`) runs flows in-process through
the Spark in-app driver ([docs/test-driver.md](test-driver.md)). The app never activates
or takes focus, and needs no TCC permission; its windows are on screen only during pointer
input, fully transparent and ignoring the real pointer. It drives the Kitchen Sink:
the `--app` bundle (the gate passes its release build), or the last development build.
A development build loads JavaScript over HTTP, so the backend bundles the current
source once per run (`expo export:embed`, no Metro) and serves it to each launch; a release
build runs its embedded bundle. That bundle is built without `__DEV__`, like a release bundle;
a `build: dev` flow gets a development bundle (`__DEV__` code such as the Developer menu and
LogBox) instead, and fails against a release build, which can only run its embedded bundle. A flow whose `appId` is not the app's bundle identifier
fails with `invalid`.

| Flow | Driver |
|---|---|
| `launchApp` | Quits a running app, deletes the session's state for `clearState: true` ([App state](#app-state)), then launches in driver mode with the flow's `arguments` (after the driver's own, including the [pinned host settings](test-driver.md#pinned-host-settings), which a flow may override) and `env`. Then it delivers `openUrl` with `navigate` and `openFile` with `openFile`, both through `application:openURLs:` once the first render settles. With `stopApp: false` and the app running, it only delivers `openUrl` and `openFile`; `clearState`, `arguments` and `env` there are `invalid`. `openFile` must be an absolute path to an existing file (`invalid` otherwise). The driver reserves `SPARK_TEST_DRIVER_DIR`, `SPARK_BUNDLE_URL`, `CFFIXED_USER_HOME` and `DIRHELPER_USER_DIR_SUFFIX` in `env`, `-RCT_jsLocation` in `arguments`, and `-AppleLanguages`/`-AppleLocale` when the matrix sets `locale`; a flow that sets one is `invalid`. `appId` and `from` are `unsupported`. |
| `preserveAppDefaults` | Before `launchApp`: snapshots `keys` of the app's `defaults` domain and registers a restore ([preserveAppDefaults](#preserveappdefaults)). `invalid` while the app runs. |
| `stopApp`, end of flow | `quit`: the app's normal termination path |
| Selectors (visibility checks, targets, mask selectors), window selectors | `elements`, one snapshot per poll: the in-process accessibility view (testIDs, roles, labels, text, frames, parents) of every window with an identifier. The runner matches every selector key against it. |
| `tapOn`, `doubleClickOn`, `tripleClickOn`, `rightClickOn` (with `modifiers`), `hoverOn` | `tap` (`clickCount` 1-3, `button`) and `hover`. A target with an id is addressed by testID and offset: the driver scrolls it into view and fails when another view would receive the click. Others are addressed by point in their window. `hoverOn` `duration` is `unsupported`. |
| `typeText`, `inputText` (with `into`) | `into` is clicked first; then `typeText`, one key press per character (`inputText` too: the driver has no one-step insert). |
| `pressKey`, `shortcut` | `pressKey` of the parsed accelerator, in the window of the last pointer input. Media keys and Caps Lock are `unsupported`. |
| `scroll` | `scroll` over `on` (required): `amount` (default 100 points when `precise`, else 3 lines) in `direction` (default `down`). `momentum` is `unsupported`. |
| `swipe` | One or two fingers: a precise `scroll` over `from` (required) by the fingers' travel, content following the fingers: `start` to `end`, or half of `from` in `direction`. Three fingers: a `gesture` swipe (`swipeWithEvent:`) in `direction` (required). More than three fingers and `duration` are `unsupported`. |
| `mouseButton` | `tap` with `button` `back` or `forward` (mouse buttons 3 and 4) on `on` (required). |
| `pinch`, `rotate`, `smartZoomOn`, `forceClickOn` | `gesture` over `on` (required for `pinch` and `rotate`): `magnify` by `scale` − 1; `rotate` by `degrees` (clockwise in flows, so AppKit's counterclockwise rotation is −`degrees`); `smartMagnify`; `pressure` up to stage 2 (a force click, with `modifiers`). Each is delivered as AppKit's trackpad events, between a began and an ended phase where AppKit uses them ([test-driver.md](test-driver.md#input)). |
| `assertCursor` | `hover` onto `on`, if given, then `cursor` at the driver's pointer, polled until it matches: AppKit's cursor name (`arrow`, `IBeam`, `pointingHand`, `crosshair`, `openHand`, `operationNotAllowed`, …, `custom(<symbol or file name>)` for Spark custom cursors), or `hidden` while the cursor is hidden until the pointer moves ([test-driver.md](test-driver.md#cursor)). |
| `setClipboard`, `assertClipboard` | `setTestClipboard` and `testClipboard` on the app's private test pasteboard, never the user's clipboard ([clipboard.md](clipboard.md#testing)). `assertClipboard` polls until every listed type is present and the plain text equals `text`; reading the text makes the app provide promised text, as another app's paste would. |
| `dragAndDrop` | From a Spark drag source (a `from` with an id inside a `DragDropView` source): `testDrag` begin, move over `to` (which needs an id), a wait of `holdAt` over it, then drop, with `modifiers` held throughout; `steps` is `unsupported` ([drag-drop.md](drag-drop.md#testing)). From any other view: `drag` from `from` to `to` in one window, with `steps` and `modifiers`; `holdAt` is `unsupported`. Window server drag sessions from other views need the black-box backend. |
| `dragToFinder` | `testDrag` from a Spark drag source, dropped in a private temporary folder the runner creates and removes after the flow: the drag's promised files are written there, and `expectFile` (a file name) must be one of them. The file is kept as an `output` artifact. Any other source is `unsupported`. |
| `assertText`, `assertA11y` | The element's `text`, and its `label`, `role`, `value`, `enabled` and `selected`, from `elements`, polled until they match. `lineEndings` and `hint` are `unsupported`. |
| matrix `appearance` | `setAppAppearance` after each launch (the app override; the OS setting is untouched) |
| matrix `locale` | Launch arguments `-AppleLanguages (<locale>) -AppleLocale <locale>` |
| `setAppAppearance` | `setAppAppearance`; lasts until the app quits |
| `auditAccessibility` | `accessibilityAudit`, judged by the runner ([Accessibility audit](#accessibility-audit)). |
| `assertAppMenu` | `menus`: the menu bar as AppKit holds it, validated as when a user opens it. `path` matches titles; `exists: false` passes when any segment is missing. Polled like other checks. |
| `setClock`, `advanceClock` | The motion engine's `setClock` and `advanceClock` driver commands ([motion.md](motion.md#virtual-clock-for-the-test-driver)); `advanceClock` sends `duration` in milliseconds |
| `captureMotion`, `assertMotion`, `interruptAt` | Motion telemetry: `motionState`, `waitForMotion` and `sampleMotion` ([Motion and frames](#motion-and-frames)). The target needs a testID. |
| `assertFrames` | `startFrames`, the `during` command, `stopFrames` ([Motion and frames](#motion-and-frames)) |
| `assertStartup`, `assertState`, `assertCrashSymbol` | `startup` and `state` ([App inspection](#app-inspection)) |
| `assertNoLayoutThrash`, `assertNoFlicker`, `assertNoLeaks`, `assertMemory` | `startCommits`/`stopCommits`, `counters` and `listeners`, `memory` ([Layout, flicker and leaks](#layout-flicker-and-leaks)) |
| `takeScreenshot`, `assertScreenshot`, failure screenshot | `capture` of the main window, or of the window `window` selects (`id:<identifier>`), its frame view (the content view's superview, title bar included). Element frames are points from the window's top-left, the capture's origin, so masks line up. |
| failure evidence | Each launch's app log, and a capture of the main window while the app runs |

#### Accessibility audit

`auditAccessibility: { scope, maxErrors }` (`scripts/e2e/runner/driver-audit.ts`) audits the main window (`scope:
window`, the default) or every window (`app`) with the rules of the macOS accessibility audit that the driver can
judge in-process ([facts](test-driver.md#accessibility-audit)). Errors:

| Rule | Error |
| --- | --- |
| `description` | An exposed accessibility element whose role is a control or an image (button, check box, radio button, pop-up and menu button, combo box, slider, stepper, text field and area, link, image, disclosure triangle, colour well, segmented control) has neither a label nor a title. A placeholder is not a description. Read-only text fields and areas (a selectable React Native `Text`) are described by their text. |
| `keyboard` | An enabled exposed element whose role is a control (the roles above but image; read-only text excepted) cannot take keyboard focus: an AppKit control that refuses first responder, or another view (a React Native `Pressable` without `focusable`) that does not accept it. Items of a table, outline or collection view are reached with the arrow keys, and parts of a control that takes focus (a search field's buttons) come with it; both pass. |
| `contrast` | Enabled text is below the [HIG](https://developer.apple.com/design/human-interface-guidelines/accessibility#Color-and-effects) contrast ratio against the background rendered behind it: 4.5:1, or 3:1 for text of 18 points or more or bold. The background is the most frequent colour of the text's pixels in the capture; the foreground is each colour the text declares, its alpha and its ancestors' opacity composited over that background, and the worst one counts. Text in a disabled AppKit control or a disabled React Native view (`disabled`, `accessibilityState.disabled`; [the accessibility state patch](expo-desktop-integration.md#rn-macos-accessibility-state-patch)) is exempt, as in WCAG. A colour that does not resolve to sRGB cannot be measured and is an error. |

The window's content view is audited; the title bar and its buttons are AppKit's. It writes the flow's nth audit to
`output/a11y-audit-<n>.a11y.json` (`scope`, `windows`, `counts` of elements, described elements, operable elements, texts,
measured texts and texts no render shows, `errors`, and the `unseen` texts) and copies the captures its errors refer
to into `output/`. More than `maxErrors` (default 0) errors fail the step with `assertion`, listing the first ten.

The step is white-box: it reads the app's views, not the accessibility tree an assistive technology sees. The rules
that need an AX client or real input (the parent/child consistency of the tree, the order Tab visits controls in, what
VoiceOver speaks) belong to the black-box backend ([#50](https://github.com/LegendApp/legend-spark/issues/50)). Text truncation is
`assertNoTruncation`.

The release gate audits every catalog screen and shell page: `e2e/flows/accessibility/audit-<area>.yaml` (one per
area, through `subflows/accessibility/audit-screen.yaml`) and `audit-shell.yaml` (the catalog and every area page),
check `A11Y-AUDIT-01`, in light and dark, English and Arabic. `tests/e2e-driver-audit.test.ts` fails when a registered
screen or an area has no audit.

#### Motion and frames

Motion commands read the engine's telemetry ([motion.md](motion.md#motion-telemetry)), not
pixels: what the engine solved for the `MotionView` with the target's testID (or the
`MotionView` containing it). They all address **the target's motion after the last input**:
the motion it started, an interruption of a running one, or an animation it added to a running one, after the latest driver input
(`tapOn`, `pressKey`, `typeText`, `scroll`, `dragAndDrop`, `openUrl`, …). Each waits for that
motion up to the command's `timeout` (default 5 s) and fails with `timeout` when none starts,
so a command right after the input that triggers the motion is race-free. A motion runs from
rest to rest; a later interruption extends it.

| Command | What it does |
|---|---|
| `captureMotion: { target, until, name }` | Waits until the motion settles (`until: settled`, the default) or until `until` (a duration) from its start, then writes `output/<name>.motion.json`: the motion (`startMs`, `endMs`, `kinds`, `interruptions`, `startValues`), the view's haptic and sound `cues` with the frames they were due on, and its value and velocity of every property at 120 Hz from its start, evaluated from the engine's history, so nothing is missed between driver round trips. |
| `assertMotion: { target, kind, settlesWithin, overshoot, velocityContinuous, frames }` | Waits until the motion settles, then checks it. `kind`: `spring` (every property it moved ended with a spring), `timing` (timing or keyframes), `crossfade` (opacity moved, and every other property it moved changed at once, as a [Reduce Motion](motion.md#reduce-motion) alternate's `jump`), or `none`, which checks at once that the target has not moved since the last input. `settlesWithin`: from its start, or its last interruption, to its settle time. `overshoot: { min, max }`: how far a translation went past its final value in the direction of travel, in points (`px`). `velocityContinuous: true`: the motion was interrupted, and every interruption kept each property's value and velocity (within the engine's rest thresholds); `false` asserts a jump. `frames: { at: [percents], golden, mask, maskRects }` first captures the window at each percent of the motion (its start to its planned end) and compares it with golden `<golden>-<percent>` (`12.5` becomes `12_5`) like `assertScreenshot`, with the same masks; this needs `setClock: virtual` before the motion starts, so every frame is exact, and a flow matrix with `appearance` and `locale`. |
| `assertPaused: { target, when }` | `when: windowHidden` or `occluded` (the same state for motion). Checks the target is animating, hides its window with the motion driver's `simulateOcclusion` ([motion.md](motion.md#hidden-windows)), checks its animation paused and held its values for 250 ms (advanced on the virtual clock), then shows the window and checks the animation resumed. The window is shown again when the check fails. Other `when` values are `unsupported`. |
| `interruptAt: { target, progress, with }` | Waits until the motion reaches `progress` (0-1 of its start to its planned end), then runs `with`. On the virtual clock the clock advances exactly there; on the real clock `with` runs once it got there, a driver round trip late at most. `target` is required. |
| `assertFrames: { during, for, fps, dropped }` | Counts the main thread's display-link frames while `during` runs, and until `for` (a duration) from the start, and records the `frames.fps` and `frames.dropped` [metrics](#metrics). `dropped` is the most missed refresh intervals allowed; `fps: { min, max }` bounds the frames per second. This is the app's main-thread cadence, not what the window server composited. A display link that delivers fewer than two frames fails `unsupported`. Commands return as soon as their input is dispatched, so cover the work with `for`: after `during` the runner sends the app nothing until then. A wait in `during` (a `runFlow` with an `extendedWaitUntil`) works too, but each of its polls walks the view tree on the main thread (about 8 ms in the Kitchen Sink, measured), which can itself drop frames at 120 Hz. |

On the virtual clock, waiting for a settled motion (or a progress point) advances the clock to
it: `assertMotion` after a tap needs no `advanceClock`. Captures (`takeScreenshot`,
`assertScreenshot`, `frames`) render running motion at its presented values, so a capture after
`advanceClock` shows that instant. A typical flow:

```yaml
- setClock: virtual
- tapOn: { id: sheet-open }
- assertMotion: { target: { id: sheet }, kind: spring, settlesWithin: 600ms, frames: { at: [0, 25, 50, 100], golden: sheet-open } }
- tapOn: { id: slider-start }
- interruptAt: { target: { id: slider }, progress: 0.25, with: { tapOn: { id: slider-interrupt } } }
- assertMotion: { target: { id: slider }, kind: spring, velocityContinuous: true }
- captureMotion: { target: { id: slider }, name: slider-interrupted }
```

#### preserveAppDefaults

`preserveAppDefaults: [AppleLanguages]` (`preserveDefaults` in `scripts/e2e/app-state.ts`) is for a flow
that changes the app's own `defaults` through the app, such as a per-app language. Put it before
`launchApp`. It reads each key of the domain the launched app uses (an isolated session's `<bundle id>.driver`
copy, or in exact mode the app's own identifier), or notes that it is absent, and registers a runner restore. Restores
run after `onFlowComplete`, outside the flow and run time limits, so a failed, timed-out or interrupted
flow still runs them: the restore quits the app, then `defaults write`s each previous value or
`defaults delete`s a key that was absent. It refuses (`invalid`) while any process with that bundle
identifier runs, a copy someone is using included, and for any domain but the flow's app or its `.driver` copy.

#### App inspection

| Command | What it does |
|---|---|
| `assertStartup: { coldMs, firstPaintMs, id }` | Reads the startup phases of the running launch ([docs/test-driver.md](test-driver.md#startup-phases)), waiting for its first rendered UI to settle (30 s, or the command's `timeout`), and records `startup.coldMs` (process start to the first UI settled; with `id`, to the first settled UI showing the element with that testID) and `startup.firstPaintMs` (process start to its first mount) as [metrics](#metrics). Each takes `{ min, max }` in milliseconds; the failure lists every phase. The gate's [budgets](#budgets) hold the reference baselines. |
| `assertState: { path, equals }` | The JSON value at `path` of the state the app exposes with `exposeTestState` ([docs/test-driver.md](test-driver.md#exposed-state)), polled until it deeply equals `equals`. A name or key the app does not have is `not-found`; an app whose JavaScript never answers fails with `timeout`. Prefer checks of what a user sees; use it for state the UI does not show. |
| `assertCrashSymbol: { path, symbol }` | Reads the native crash report (`@legendapp/spark/diagnostics`) at `path` of the exposed state, once, and fails unless a frame of its stack is named `symbol`. On a dev build the names are the ones the app found in-process. A release build (it embeds its JavaScript) is stripped, so its report is first symbolicated with the dSYMs in the `dSYMs` folder next to the app given (`--app`, or the gate's artifact), with the code of `spark symbolicate`; an app with no such folder fails (`invalid`, "no dSYM"), and a failure lists the app's images that have no dSYM there. |

```yaml
- launchApp
- assertStartup: { id: infra-shell-home, coldMs: { max: 30000 } }
- assertState: { path: navigation.kind, equals: catalog }
```

#### Layout, flicker and leaks

| Command | What it does |
|---|---|
| `assertNoLayoutThrash: { during }` | Watches every commit of the app's main run loop while `during` runs and until mounted UI updates settle ([docs/test-driver.md](test-driver.md#layout-thrash-and-flicker)), and fails when a view's frame changed in more than one commit: it was laid out again after the frame that showed it. Use one input as `during`: typing a word lays out a growing label once per key. |
| `assertNoFlicker: { during }` | Watches the same way and fails when an element (a view with a testID) visible before went missing for one or more commits and came back (a partial frame), or a window that showed elements showed none (a blank frame). |
| `assertNoLeaks: { run, repeat, since }` | Compares the leak counters (`windows`, `views`, `fileDescriptors`, `listeners`; [docs/test-driver.md](test-driver.md#leak-counters)) after running `run` `repeat` times (default 1) with those before it, or with `since: flowStart` with those taken before the flow's first command on the launch other than `launchApp`, once the UI settled: the app as the flow found it (only flows with that command take them, so it must be in the flow file, not a `runFlow` file). Fails when any counter grew. Run the commands once before, so one-time caches are in the baseline. `since: mark` is `unsupported`: no command sets a mark. |
| `assertMemory: { maxMB }` | The app process's memory footprint (`memory.mb` [metric](#metrics)) must be at most `maxMB`. `window` is `unsupported`: it measures the process. |

A failed `assertNoLayoutThrash` or `assertNoFlicker` writes the driver's report to
`output/<command>-line<line>.commits.json`.

#### Release-safety probe

`assertNoDebugSurface: { for }` checks that a running release build has no debug surface (#274; `DEVT-REL-01`
to `03`, `e2e/flows/devtools/release-probe.yaml`). It quits the app if it runs, starts a decoy development server (a
TCP listener on 127.0.0.1 the runner owns) and launches the app pointed at it, with `-RCT_jsLocation <decoy>` and
`SPARK_BUNDLE_URL=http://<decoy>/index.bundle?…`, the settings a development build reads. Once its first rendered UI
has settled (up to 30 s) and `for` (default 2s) more, it takes one snapshot and fails with every finding:

- **Development server:** any connection to the decoy. A release build loads its embedded JavaScript and opens no
  packager, inspector or HMR connection.
- **Sockets:** `lsof -p <app pid>` (outside the app, not through the driver). Any IPv4 or IPv6 socket, listening or
  connected, is a finding, and so is any bound Unix socket (one with a path) other than the driver's own channel
  (`driver.sock` in the session's run directory). A driven app skips the single-instance lock ([app state](#app-state)),
  so it has no single-instance socket. lsof failing, or not listing the process's files, fails the command.
- **Menus:** the driver's `menus` snapshot, every level and hidden items included: the Developer menu (its
  `spark-developer` identifiers, or any of its titles in English or Arabic, such as Reload or Show Developer Menu) and
  any item whose title names DevTools, an inspector, a debugger or a dev menu.

It is a `build: release` check: a development build connects to the decoy (or the bundle server) and has the Developer
menu, so it fails. The gate runs it on the gate's artifact; `bun run harness` runs the gate with the installed artifact
(`--artifact`), so the probe runs against the signed app it installed.

#### App state

A driver session (one flow, or one `ks:capture`) runs in one of two state modes (`scripts/e2e/app-state.ts`):

- **Isolated** (`bun run e2e:run`, `ks:capture`, `scripts/test-devtools.ts`): a clone of the app with its own
  identity and state, described below. A flow (with or without `clearState`) can run while a developer runs the same
  app, and can never change or delete that instance's data.
- **Exact** (`bun run gate`): the gate flows run against the release artifact itself (the installed app), with its
  real state and no state environment. `clearState` deletes the app's own state (the table below, under the real home
  and `$TMPDIR`), only for the gate manifest's `appId`. A driven app skips the single-instance lock, so the session
  refuses to start while any process with the app's bundle identifier runs, and `clearState` refuses likewise.

An isolated session runs a clone of the app:

- **Its own identity.** An APFS clone (`cp -c`, no copied data) of the app in a new 0700 directory, the session root
  (`$TMPDIR/spark-driver-state-<bundle id>.driver-*`), with `CFBundleIdentifier` `<bundle id>.driver` and
  `SparkProjectIdentifier` `<project id>.driver`, signed ad hoc keeping its entitlements and flags (the hardened
  runtime), with its quarantine attribute removed. Its defaults domain, Keychain service and `<namespace>`
  (`SparkNamespace()`, `spark.desktop.` plus the SHA-256 of the project identifier) are therefore never the app's. An
  app with entitlements an ad hoc signature cannot carry (`keychain-access-groups`, `com.apple.application-identifier`,
  `com.apple.developer.*`, team-prefixed application groups) is refused, as is a sandboxed app (its state is in its
  container, outside the root).
- **Its own home.** `CFFIXED_USER_HOME=<session root>/home` moves `NSHomeDirectory()` and every `~/Library` path
  Foundation and WebKit derive from it (Application Support, Caches, HTTPStorages, WebKit).
- **Its own temporary and cache directories.** `DIRHELPER_USER_DIR_SUFFIX=<bundle id>.driver` makes
  `NSTemporaryDirectory()` `$(getconf DARWIN_USER_TEMP_DIR)<bundle id>.driver/`, and the per-user cache directory
  (`DARWIN_USER_CACHE_DIR`, where React Native's URL cache and Metal shader caches go) likewise. macOS creates these
  directories protected by System Integrity Protection: what they hold can be deleted, they cannot, so sessions share
  them.
- **One session at a time per clone identity.** A session takes the lock `$TMPDIR/spark-driver-<bundle id>.driver.lock`
  (a directory holding its pid; a dead pid's lock is taken over) and refuses while another session's clone runs.
- **A clean start and end.** Under the lock, a session deletes earlier sessions' roots (removing their LaunchServices
  registrations, so no deleted copy claims the app's URL schemes), state of the clone's identity outside a root, the
  defaults domain, and what the temporary and cache directories hold. Its end waits up to 10 s for the clone to exit,
  then deletes the defaults domain, what those directories hold, the clone's LaunchServices registration and the root,
  and releases the lock. A clone still running keeps its state, and the next session refuses until it exits.

Measured on macOS 27 (26A428) with a small AppKit app launched like this:

| Persistence | Where it went |
|---|---|
| Application Support, Caches (`NSFileManager`, `NSSearchPathForDirectoriesInDomains`), `NSURLCache`, `NSHTTPCookieStorage` (HTTPStorages), WebView local storage and IndexedDB (`~/Library/WebKit/<bundle id>`) and WebKit caches | Under `CFFIXED_USER_HOME` |
| `NSTemporaryDirectory()` and the per-user cache directory | Under `DIRHELPER_USER_DIR_SUFFIX` (no slash; with one, macOS ignores it). `TMPDIR` has no effect. |
| `NSUserDefaults` | The real `~/Library/Preferences/<bundle id>.plist`, through `cfprefsd`, whatever `CFFIXED_USER_HOME`, `HOME` or `__CFPREFERENCES_AVOID_DAEMON` say. Hence the clone's own bundle identifier: its domain is `<bundle id>.driver`. |
| WebKit's GPU, WebContent and Networking services | Their own `com.apple.WebKit.*+<bundle id>.driver` directories in the per-user temporary and cache directories. macOS protects them, so nothing deletes them; they are caches of the services, not website data. |

In an isolated session, `launchApp: { clearState: true }` deletes the session's state after the app has quit and
before it launches: the `<bundle id>.driver` defaults domain (`defaults delete`, through `cfprefsd`, so a quit app cannot write a cached domain
back) and everything the session's home, temporary and cache directories hold. That holds everything the Spark,
React Native and React Native WebView code persists:

| State | What lives there |
|---|---|
| The defaults domain | Main and child window frames (`NSWindow Frame <namespace>.main`, `<namespace>.bounds.<id>`), the Spark recent-documents list, window-manager options, Sparkle's skipped versions and settings, React Native dev settings |
| `~/Library/Application Support/<namespace>` | `settings`, file-system `data`, SQLite databases |
| `~/Library/Application Support/<bundle id>` | React Native AsyncStorage |
| `~/Library/Caches/<namespace>`, `~/Library/Caches/<bundle id>` | file-system `cache`; `NSURLCache`, Sparkle downloads, WebKit caches |
| `~/Library/HTTPStorages/<bundle id>`, `<bundle id>.binarycookies` there and in `~/Library/Cookies` | `NSURLSession` cookies and HSTS |
| `~/Library/WebKit/<bundle id>` | WebView website data (`WKWebsiteDataStore.defaultDataStore`) |
| `~/Library/Saved Application State/<bundle id>.savedState` | AppKit window restoration |
| `~/Library/Logs/<bundle id>` | `@legendapp/spark/logging` files; `@legendapp/spark/diagnostics` crash reports in `Crashes/` |
| `$TMPDIR/<namespace>`, `$TMPDIR/<namespace>.setup`, `.lock`, `.sock` | file-system `temp`; the single-instance lock and socket |
| `$TMPDIR/legend-codex-workspace/codex-home-<bundle id>` | the codex package's `CODEX_HOME` |

Each run writes what existed to `clear-state-<launch>.log` in the flow's backend directory.

It fails closed. It refuses while the clone runs (`lsappinfo`), and when any of the locations above exists for the
clone's identity under the real home or temporary directory (state the launch environment did not move), naming
each. It deletes the defaults domain only when `defaults export` shows it holds a key (the messages of `defaults read`
and `defaults delete` for a missing domain differ between macOS releases); `defaults delete` leaves an empty
`~/Library/Preferences/<bundle id>.driver.plist`. Every directory it empties must be a real directory (not a symbolic
link) owned by the user, and it deletes a root only under `$TMPDIR` with the session root's name.

Not deleted:

- **Keychain** (`@legendapp/spark/secure-storage`, service `<namespace>`): an isolated clone's items are in the login
  Keychain under its own namespace, never the app's, and they accumulate there across sessions. Only the clone that
  created them is in the items' access list, so deleting them with `security` from the runner can raise a Keychain
  prompt, and driver runs never show UI. A flow that needs empty secure storage removes its keys in the app.
- **AppKit's recent documents** (`com.apple.sharedfilelist`): macOS denies access to it.
- **Delivered notifications**: the notification center owns them.

A process the app starts inherits `CFFIXED_USER_HOME` and `DIRHELPER_USER_DIR_SUFFIX`. Lookups under the home, such as
the codex package's `~/.codex/auth.json` and `~/.local/bin`, find the session's empty home.

`e2e/flows/infra/launch-state.yaml` checks it end to end: a setting (Application Support) and a recent document
(the defaults domain) saved by one launch are found by the next and gone after `clearState`. Window frames never
persist in driver mode ([docs/test-driver.md](test-driver.md#focus-and-window-state)), with or without `clearState`.

Input is synthesized in the app and dispatched through its own event path
([docs/test-driver.md](test-driver.md#input)): first responders, key equivalents, control
tracking and React Native gestures behave as for real input, but nothing proves the real
input path, local event monitors do not see driver key events, and AppKit controls ignore
driver arrow keys (they take keyboard input only in the key window). A native menu the
input opens is closed at once and the command fails.

Everything else is `unsupported`, never skipped: other black-box commands (menus, windows,
OS state) need [#50](https://github.com/LegendApp/legend-spark/issues/50), and the other
driver commands (`measure`, `assertIdleCpu`, `startTrace`, `stopTrace` and
`assertEnergy`) are not in the driver protocol yet
([#52](https://github.com/LegendApp/legend-spark/issues/52)).
`tests/e2e-driver-backend.test.ts` covers the mapping with a fake driver
(`tests/e2e-driver-fake.ts`), `tests/test-driver.native.mm` the driver's input on real
AppKit controls, and `tests/e2e-app-state.test.ts` and `tests/e2e-kitchen-sink-launch.test.ts` cover the app state and clearState;
`e2e/flows/infra/catalog-driver.yaml` and `e2e/flows/infra/launch-state.yaml` run it end to end.

## Visual goldens

`assertScreenshot` compares a capture with a reviewed PNG in the golden store:

```
e2e/golden/<platform>/<appearance>/<locale>/<name>[+<dimension>-<value>…].png
```

- The path comes from the running platform and the flow run's matrix. `appearance` and
  `locale` are directories, so a flow that uses `assertScreenshot` must have both in its
  header `matrix` (validation reports it; a subflow's screenshot in a flow without them
  fails with `invalid`). Every other dimension is appended to the file name, sorted by
  name: `sheet` with `reduceMotion: true` is `sheet+reduceMotion-true.png`. Header order
  never changes a path.
- `name` (and `takeScreenshot`'s `name`) is 1-100 letters, digits, `_` and `-`.

```yaml
matrix: { appearance: [light, dark], locale: [en, ar] }
---
- launchApp
- assertScreenshot: catalog
- assertScreenshot:
    golden: editor
    threshold: 0.05%                  # share of compared pixels that may differ (default 0%)
    tolerance: 3                      # CIEDE2000 per pixel (default 2)
    mask: [{ id: clock }]             # elements to ignore; each must match exactly one
    maskRects: [{ x: 0, y: 0, w: 120, h: 28 }]   # points from the image's top-left
```

### Comparison

`scripts/e2e/golden/diff.ts`, on 8-bit RGBA:

1. Sizes must match. A capture with a different pixel size fails (a 1x display gives
   half-size captures).
2. Masked pixels are skipped: each `mask` element's frame, mapped through the capture's
   `frame` and `scale`, and each `maskRects` rectangle, both grown to whole pixels.
3. A pixel whose bytes differ is converted to CIELAB (values are read as sRGB; golden and
   capture come from the same capture path) and compared with CIEDE2000. Pixels with
   alpha are composited over white and over black, and the larger difference counts, so
   alpha changes are not hidden. A difference up to `tolerance` is the same pixel. ΔE00
   of 1 is about the smallest difference a person can see side by side; the default 2
   absorbs rounding and color-management noise, not visible changes.
4. A pixel beyond the tolerance is tolerated as anti-aliasing when, in either image, it
   has at most two identical neighbours, lies between its darkest and brightest
   neighbour, and one of those sits in a flat region of both images (after Vysniauskas,
   2009). Text and edge blends that shift by a subpixel pass; a moved or recolored shape
   does not.
5. The assertion fails when the differing pixels exceed `threshold` of the compared
   pixels. The default is 0%: with the tolerance and anti-aliasing rules, an unchanged
   screen compares clean, and a one-glyph change still fails.

A failure lists the capture (`screenshot`), the golden (`golden`, copied into the run) and
the diff image (`diff`) in `failure.artifacts`, and the HTML report shows all three. The
diff shows the golden faded to light gray, differing pixels in red, tolerated
anti-aliasing in yellow and masks in blue. A missing golden fails the same way, with only
the capture. The comparison runs once, after the capture; there is no retry.

Each flow result has `goldens`: one entry per `assertScreenshot` that captured, with
`id` (`<platform>/<appearance>/<locale>/<name>`), `golden`, `actual`, `status`
(`passed`, `failed` or `missing`), `diff` and `stats` (`compared`, `different`,
`antialiased`, `ratio`).

### Approving goldens

A run never writes the golden store, and neither does the gate: a missing golden fails,
it is never accepted. Goldens change only through `e2e:golden approve`, in a reviewed commit:

```sh
bun run e2e:golden approve artifacts/e2e/run-…                       # every changed capture in the run
bun run e2e:golden approve artifacts/e2e/run-…/flows/area/name        # one flow, every matrix run
bun run e2e:golden approve artifacts/e2e/run-…/flows/area/name/appearance-dark+locale-ar
bun run e2e:golden approve artifacts/e2e/run-…/flows/area/name/appearance-dark+locale-ar/screenshots/catalog.png   # one image
bun run e2e:golden approve capture.png --to macos/light/en/infra-shell-catalog   # a capture made outside the runner
```

The path selects the `assertScreenshot` captures at or under it, using the run's
`report.json`. Captures that failed or had no golden are copied to their golden path
byte for byte; captures that passed are left alone. For each image it prints `added`
(with the size), `updated` (the pixels that changed, and how many of those are beyond
the default tolerance, or the old and new size) or `unchanged`. Open the capture and the
diff before you approve, and read the approved PNG afterwards. Two captures in the
selection for the same golden are an error; approve one by its path.

`--to` takes a golden ID and is for captures from `bun run ks:capture` (see
[docs/test-driver.md](test-driver.md)), outside a flow run:

```sh
bun run ks:capture --wait-for infra-shell-root --name catalog --appearance dark --locale en --out /tmp/goldens
bun run e2e:golden approve /tmp/goldens/catalog.png --to macos/dark/en/infra-shell-catalog
```

Committed goldens:

| Golden | Screen | Source |
|---|---|---|
| `macos/light/en/infra-shell-catalog` | Launch catalog (`infra-shell-root`) | `ks:capture --wait-for infra-shell-root --appearance light --locale en` |
| `macos/dark/en/infra-shell-catalog` | The same, dark | `--appearance dark --locale en` |
| `macos/light/ar/infra-shell-catalog` | The same, Arabic (right to left) | `--appearance light --locale ar` |
| `macos/dark/ar/infra-shell-catalog` | The same, Arabic, dark | `--appearance dark --locale ar` |
| `macos/{light,dark}/{en,ar}/<area>-<screen>` | Each screen that `e2e/flows/<area>/visual.yaml` compares | `bun run e2e:run e2e/flows/<area>/visual.yaml --backend driver`, then `e2e:golden approve` |

They come from the development build, so the sidebar subtitle reads `dev · <project ID>`.
A flow that compares them must mask that line (`mask: [{ id: infra-shell-subtitle }]`), as
`e2e/flows/infra/catalog-driver.yaml` does. The `visual.yaml` flows and `assertMotion` frames mask the whole shell sidebar
(`infra-shell-sidebar`; the catalog golden covers it), so a screen's golden changes only when
that screen does, not when an area gains a screen. They also mask what changes between runs
(the launch arguments, the main window frame, the persisted bookmark), and switch the motion
clock to virtual before a screen with a looping animation opens.

The Arabic goldens came after the RTL fixes for scroll content
([#234](https://github.com/LegendApp/legend-spark/issues/234)), text alignment
([#245](https://github.com/LegendApp/legend-spark/issues/245)) and Spark's AppKit views
([#256](https://github.com/LegendApp/legend-spark/issues/256)).

The window size comes from `desktop.config.json` (1000x700 points), unless the shared
user defaults hold a saved `NSWindow Frame spark.desktop.…main` for
`so.legend.spark.examples.kitchensink`. Then the capture has a different size and fails.
Delete that key before you approve goldens.

Screens with a known visual bug have no golden; their flow opens them and asserts the root
only, with a comment naming the bug. A golden of a bug would make the fix fail.

### Determinism

A golden only works if the same build renders the same pixels every time. The driver
(or any backend that implements `screenshot`) must honor these before it captures:

| Source of noise | What the backend must do | #52 driver today |
|---|---|---|
| Layout and React updates in flight | Capture only once mounted UI updates have settled | Yes: `capture` waits for no Fabric mount for 100 ms, else `E_NOT_SETTLED` |
| Animations (Animated, Reanimated, Core Animation) | Capture at rest: settle, or `setClock: virtual` and `advanceClock` to a fixed point; with `reduceMotion` in the matrix, apply it | Settle only; the virtual clock (`setClock`, `advanceClock`) is not implemented |
| Text caret blink | Hide the insertion point, or pin it on, so focused text fields look the same at any moment | Not handled: mask focused fields until it is |
| Clocks and dates on screen | Mask them (`mask: [{ id: … }]`), or pin the app's time and time zone | Not handled: mask |
| Window activation state | Always capture in the same state | Yes: driven apps never activate, so title bars are always inactive |
| Host settings: system appearance, wallpaper tinting, accent and highlight colours, increase contrast, reduce transparency, scroll bars, font smoothing | Pin them for the launched app only, never on the Mac | Yes: launch arguments in the app's argument domain ([pinned host settings](test-driver.md#pinned-host-settings)) |
| Appearance and locale | Apply the matrix values before the first capture | `setAppAppearance` once the first render settles; locale is a launch argument (`-AppleLanguages`) |
| Backing scale | Capture at a fixed scale; goldens are @2x | Captures at the window's backing scale (2x on Retina displays) |
| Color space | Keep it fixed per machine | Captures are tagged with the window's color space (Display P3 on most Macs) |
| Fonts and OS rendering | Record goldens on the gate target's OS; a macOS major update can change text rendering | Not handled; the store has no OS version segment |
| Content composited by the window server | Not capturable in-process | Behind-window vibrancy renders as flat gray; the unemphasized row selection material is drawn as its system color; shadows and rounded corners are not captured |

## Lint rules

| Rule | Finding |
|---|---|
| `unknown-command` | Not in the catalog. The message suggests the closest command. |
| `no-sleep` | `sleep`, `wait`, `delay`, `pause`, `waitFor…`. |
| `missing-checks` | The flow has no `checks:`, or an empty list. |
| `check-id` | A check ID that is not `PREFIX-NAME-NN`, such as `MW-TEAR-01`. |
| `dev-build` | `build: dev` in a gate flow (under `flows/`). |
| `dev-flow-build` | A flow under `dev-flows/` without `build: dev`. |
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

`audit: bundle` makes a check an [audit](#audits) check: the gate's bundle audit verifies it against the release
artifact, and no flow lists it.

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
| `no-flow` | A registered check that no flow lists in `checks:` and no [audit](#audits) verifies. |
| `audit-flow` | A check registered with `audit:` that a flow lists too. |
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
bun run gate --flow e2e/flows/menus --agent   # only these gate flows, JSON lines (see Scoped runs)
bun run gate --artifact /path/to/Applications/KitchenSink.app        # test another copy of the build
```

The gate certifies one target per run: the machine it runs on. The verdict is PASS
only when every check below passes. The exit code is 0 on PASS, 1 on FAIL (or an
invalid `e2e/gate.yaml`, whose problems it prints), and 2 for a usage error, such as a
`--target` that is not in the manifest. It never passes vacuously. A missing target,
backend, build, flow, baseline, measurement or sign-off is a failure with its own reason.

**It fails today.** The only backend is the in-app driver, so a flow that needs a
black-box command the driver cannot run in-process fails as `unsupported` until #50 (the
others pass white-box, labelled in the report); coverage is incomplete, and the
budgets are not measured.

For a release, the [release harness](release-harness.md) (`bun run harness`) runs the
gate against the app installed from the signed distributable, and `bun run release`
refuses to publish without a passing harness report for its revision on every
release target.

### Manifest

`e2e/gate.yaml` (schema: `e2e/schema/gate.schema.json`). Every key is required except
`build.<platform>.verifySignature` and `targets[].machine`.

| Key | Meaning |
|---|---|
| `suite`, `appId` | Names for the report. |
| `build.macos` / `build.windows` | `artifact`: the release build to test, relative to the repository root. `${ARCH}` becomes `arm64` or `x64`. `--artifact <path>` replaces it for one run. `verifySignature: true` runs `codesign --verify --deep --strict` (macOS; Windows verification is not implemented, so asking for it fails). The flows get the artifact as `${APP_PATH}`. `sizeBudgetMB` and `symbols` (the build's dSYM folder, relative to the repository root, with `${ARCH}`) are for the [bundle audit](#audits). |
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
5. **Audits:** the audit steps run against the artifact (see [Audits](#audits)). A scoped run has none.
6. **Flows:** the gate flows whose `platforms` include the target's platform, every
   matrix combination, run through the runner with every registered backend for that
   platform. Flows with `manual: true` are not run; `manual: partial` flows are run, and
   their manual steps are recorded for sign-off. Any failed or skipped blocking run fails the gate.
7. **Budgets** on a machine-bound target (see [Budgets](#budgets)).
8. **Sign-offs** for every manual run (see [Manual sign-offs](#manual-sign-offs)).
9. **Time budget** for the whole run.

The gate runs every check even after one fails, so one report lists every reason.
Flows don't run when there is no backend, no build, or this machine cannot be the
`--target`.

### Report

`report.json` has `version`, `verdict` (`PASS` or `FAIL`), `reasons` (`{ check, message }`: every
reason for FAIL), `warnings` (non-blocking failures), `suite`, `appId`, `startedAt`,
`durationMs`, `timeBudgetMs`, `host`, `target`, `machine`, `commit`, `dirty`, `build`
(`artifact`, `exists`, `signature`), `backends`, `coverage` (`required`, `covered`,
`problems`), `flows` (one per run ID: `status` is `passed`, `failed`, `skipped`,
`not-run`, `signed-off` or `unsigned`, plus `blocking`, `manual`, `failure`, `bundle`, and for manual runs `manualSteps`, `flowHash`
and `signoff`; `manualSteps` screenshot paths are relative to the repository root),
`excluded` (flows for other platforms), `budgets` (one entry per measurement:
`metric`, `flow`, `value`, `baseline`, `limit`, `status`) and `run` (the runner's report
directory) and, for a [scoped run](#scoped-runs---flow), `scope`. `audits` (one entry per audit check: `check`, `audit`, `title`, `blocking`, `status` `passed`, `failed`,
`unsupported` or `not-run`, and `details`, the findings or what a pass found). `check` is one of `manifest`, `target`, `source`, `lint`, `coverage`, `audit`,
`build`, `backend`, `flows`, `time-budget`, `budgets` or `signoffs`. The HTML page shows
the same and links to the runner's page.

### Audits

An audit is a gate step that checks the release artifact itself instead of driving the app. A check registered
with `audit: <name>` is verified by that step, so no flow lists it (coverage reports `audit-flow` if one does). The
gate runs each audit step once, after the build check, and judges every audit check for the target's platform: a
`failed` or `unsupported` result, or no result, fails a blocking check. A scoped run (`--flow`) runs no audits.
`bun run e2e:audit [--artifact <app>] [--package <zip or folder>]` runs only the audits for this machine's target and prints each result.

`bundle` (`scripts/e2e/audit/bundle.ts`, registered in `checks/packaging-distribution.yaml`) audits release bundle
hygiene (#153):

| Check | What it verifies |
|---|---|
| `DIST-HYG-01` | `Contents/Resources/main.jsbundle` exists, and it and every other script in the bundle are Hermes bytecode, so the release needs no Metro. |
| `DIST-HYG-02` | No `.map` files and no `sourceMappingURL` in any script. |
| `DIST-HYG-03` | No `.DS_Store`, `node_modules`, test fixtures, TypeScript, object files, headers or module maps, dSYMs, `*.debug.dylib`, `__preview.dylib`, sanitizer runtimes, project files, keys or certificates. |
| `DIST-HYG-04` | Every Mach-O binary is stripped: no debug map (`nm -ap` stabs) and no `__DWARF` segment. |
| `DIST-HYG-05` | Every Mach-O UUID in the app has a dSYM in `build.<platform>.symbols` (the build's `dSYMs/` folder next to the app). |
| `DIST-HYG-06` | No file holds an absolute path of the build machine (`/Users/<name>/`, `/home/<name>/`, `/var/folders/`, `C:\Users\<name>\`). |
| `DIST-HYG-07` | No file holds a credential: private keys, AWS, GitHub, Slack, Google, Stripe, npm or API secret keys. |
| `DIST-HYG-08` | Info.plist: `CFBundleIdentifier` is the manifest's `appId`; package type `APPL`; name; an executable that exists; numeric versions; `LSMinimumSystemVersion` 14 or earlier; `NSPrincipalClass` `NSApplication`; no `NSAllowsArbitraryLoads`, no App Transport Security exception for localhost and no `NSAllowsLocalNetworking` (development builds only: `spark build` removes it from release builds, #274). |
| `DIST-HYG-09` | The artifact's size is within `build.<platform>.sizeBudgetMB`. |
| `DIST-HYG-10` | `Contents/Resources/ThirdPartyNotices.txt` lists packages, each with a license, including every embedded framework. |

On Windows, 02, 03, 06, 07 and 09 run on the artifact's files; 01, 04, 05, 08 and 10 report `unsupported` until there
is a Windows release build and PE/PDB tooling (#51). Uploading symbols to a crash service is not part of the audit:
Spark has no symbol server; crash reports are symbolicated locally from the dSYMs ([diagnostics](diagnostics.md)). The bundle audit does not check notarization: the
package audit and the [release harness](release-harness.md) do. The in-app test driver ships in the Kitchen Sink release build on
purpose (the gate drives it); keeping it out of consumer release builds is #340.

`package` (`scripts/e2e/audit/package.ts`, registered in `checks/packaging-distribution.yaml`) audits the `spark package`
output (#151): `build.<platform>.package` in `gate.yaml`, `--package`, or the release harness's `--artifact` ZIP. It is
the distribution ZIP, or the folder holding the one `<name>-<version>-<arch>.zip`; the dSYMs archive, the DMG and the
`updates/` feed are read next to it. Try it without credentials on `spark package --ad-hoc` output
(`bun run e2e:audit --package examples/kitchen-sink/dist/ad-hoc`), which fails only `DIST-PKG-06` and `DIST-PKG-09`.

| Check | What it verifies |
|---|---|
| `DIST-PKG-01` | The ZIP is named `<name>-<version>-<arch>.zip`, holds only the `.app`, stores no extended attributes (`__MACOSX/` or `._` AppleDouble entries, such as the build machine's `com.apple.provenance`), and `codesign --verify --deep --strict` accepts the extracted app. |
| `DIST-PKG-02` | `<name>-<version>-<arch>-dSYMs.zip` is next to it and has a dSYM for every Mach-O UUID in the packaged app. |
| `DIST-PKG-03` | The name's version is `CFBundleShortVersionString`; `CFBundleIdentifier` is `appId`; the versions, build number and `spark-runtime.json` `fingerprint` and `sourceRevision` match the release build the gate tests. |
| `DIST-PKG-04` | The package is for the target's architecture: the executable has only that architecture and every binary has it (prebuilt universal ones, such as Sparkle's helpers, are listed); no binary's `minos` is newer than `LSMinimumSystemVersion`. |
| `DIST-PKG-05` | An app with `SUFeedURL` requires a signed feed (`SURequireSignedFeed`), and `updates/<feed>` is signed with `SUPublicEDKey`. Its newest item is this build with the same short version and minimum macOS, an arm64 item requires arm64, and every enclosure is next to the feed, has its length and a valid EdDSA signature; the full update is the package's bytes. An app without `SUFeedURL` passes: it has no feed. |
| `DIST-PKG-06` | Installed from the ZIP as a quarantined download (the release harness's install and verification): Developer ID signature, hardened runtime, secure timestamp, notarized, ticket stapled, Gatekeeper accepts it. Needs Developer ID and notarization credentials: an ad-hoc package fails it. |
| `DIST-PKG-07` | Extracting the quarantined download carries `com.apple.quarantine` to the app, so Gatekeeper assesses its first launch. |
| `DIST-PKG-08` | `<name>-<version>-<arch>.dmg` is next to the ZIP, a compressed read-only image (UDZO, UDBZ, ULFO or ULMO). Mounted with `hdiutil attach -readonly -nobrowse -noautoopen` at a temporary mountpoint (always detached), it holds exactly the ZIP's `.app` (the same files, modes and links; `codesign --verify --deep --strict` accepts it there) and an `Applications` link to `/Applications`, and stores no extended attributes (a link's HFS+ Finder info, which holds its type, aside). |
| `DIST-PKG-09` | The DMG has a Developer ID Application signature of the app's team with a secure timestamp (`codesign --verify --strict`), a stapled notarization ticket (`xcrun stapler validate`), and Gatekeeper accepts opening it as notarized (`spctl --assess --type open --context context:primary-signature`). Needs Developer ID and notarization credentials: an ad-hoc package's DMG is unsigned and fails it. |

Spark makes no DMG, so there is no DMG layout check. App translocation at launch is not checked: it needs a notarized
app launched from its quarantined location.

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
these names, so backends use them for the performance commands (the driver backend records `startup.*`, `memory.mb` and `frames.*`):

| Command | Metrics |
|---|---|
| `assertStartup` | `startup.coldMs`, `startup.firstPaintMs` |
| `assertMemory` | `memory.mb` |
| `assertFrames` | `frames.fps`, `frames.dropped` |
| `assertIdleCpu` | `cpu.idlePercent` |
| `measure` | `measure.<name>` (milliseconds) |

### Manual sign-offs

Some checks need a person: a menu's marks are legible, an IME candidate window sits under
the caret, VoiceOver reads in order. A flow marks them with `manualStep`, and its header says how
the rest runs:

- `manual: partial`: the automated steps run. At each `manualStep` the runner records the
  instruction and the screenshot it names, then runs on. A person signs off what the capture shows,
  or checks the step live in the app.
- `manual: true`: nothing runs. The gate plans the flow's manual steps (following `runFlow` files
  and `when: { platform, matrix }`; steps behind a `visible` condition are listed) and a person
  performs them.

```yaml
manual: partial
---
- launchApp: { openUrl: "spark-ks://windows/window-options" }
- tapOn: { id: windows-window-options-open }
- takeScreenshot: { name: child-opened, window: { id: windows-window-options-child } }
- manualStep:
    instruction: Look at the child window in child-opened.
    expect: The title bar is transparent and the subtitle reads Draft.
    screenshot: child-opened  # the earlier takeScreenshot that shows what to check
    signoff: required         # required | optional (default required)
```

Name the capture that shows the thing to check: a `takeScreenshot` with `window` for a child window.
In-process captures show one window of the app, never menus, context menus, system panels (Look Up,
Writing Tools), the Dock, the menu bar or Spaces. For those, write the step as a live check (where to
go in the Kitchen Sink and what to do, saying why there is no screenshot) with `evidence: none`. A
pass of a step without a screenshot needs a note saying what the person saw.

A run needs one passing sign-off for this target, this commit **and this content of the flow** when it
reaches a step with `signoff: required`. A run whose steps are all `optional` may have one. A manual flow
needs a `signoff: required` step in its own file (`e2e:lint`), and the gate fails a `manual: true` flow
that reaches none and a passed `partial` run that reached none (a `when` can skip one), because no person
would verify it. A `partial` run that fails before its manual step fails as a flow and needs no
sign-off until it passes.

#### Running a manual flow (people)

```sh
cd examples/kitchen-sink && bun run build   # the release build the gate tests
bun run gate --flow e2e/flows/menus/macos-items.yaml   # or the full gate: bun run gate
bun run gate:signoff --scoped   # opens the checklist for that run (without --scoped: the last full gate run)
bun run gate --flow e2e/flows/menus/macos-items.yaml   # applies the sign-offs
```

Commit first: `gate:signoff` refuses uncommitted changes, because a sign-off certifies a commit. It
reads the last gate report (`--scoped`: the last `gate --flow` report) and refuses when it is for another
target or another commit than HEAD, when a manual flow file changed since, or when either run had
uncommitted changes. It writes a session to
`<sign-off file's directory>/manual/<first 12 of the commit>/session.json`, copies the runner's
screenshots next to it (the next gate run deletes its run directory), and opens a new instance of the
release build with `--ks-signoff <session.json>` (`open -W -n`). The release build runs with its real
state and its single-instance lock, so a second launch would forward itself to a running Kitchen Sink
and quit: the command refuses while one runs (driver sessions run isolated clones, which do not count).

The app opens **Gate infrastructure > Manual sign-off** (`spark-ks://infra/sign-off`). It shows the
target, commit and who is signing (`git config user.name` and `user.email`, and the host name and
model), then each run with its name, intent, steps (`instruction`, `expect`, and the screenshot the
step names with what it shows, such as `child-opened (window {"id":"windows-window-options-child"})`)
and a note field. For a step without a screenshot, do it in the app (the checklist keeps its state
while you visit other screens), then come back. **Pass** or **Fail** records the decision at once in
the session's `decisions.json`. The app's quit guard writes them again and quits only once that write
succeeds; while it fails, the app stays open and shows the error:

- **Fail** needs a note that says what was wrong.
- **Pass** needs a screenshot for every step, or a note saying what you saw (a live check, or a
  `manual: true` flow, which never runs).
- A `partial` run whose automated steps did not pass is listed as not ready, with the failure, and
  cannot be signed off.

When the app quits, the command checks the decisions again (each must be a ready run of the session,
with its target, commit, flow hash and signer, follow the note rules above, and name evidence only
inside the session's `evidence/` folder, with no `..` or symlink out of it), prints them, and asks you to type your `user.name` to sign
them. Only then does it replace any earlier sign-off of the same run on this target and write the
sign-off file, validated against its schema. Any other answer writes nothing.

An interrupted session (the command stopped, or you did not confirm) leaves its decisions in
`decisions.json`. The next `gate:signoff` keeps those that still pass the checks above and whose
screenshots no later gate run replaced, lists them as `decided pass, not confirmed yet`, shows them in
the checklist, and asks you to confirm them when the app quits. It prints why it dropped any other.

#### From an agent

**Agents never sign off.** Run the manual flow the way the gate judges it, and report what awaits a
person:

```sh
bun run gate --flow e2e/flows/<area>/<flow>.yaml --agent   # an unsigned manual run fails with check "signoffs"
bun run gate:signoff --list --scoped                         # prints each run, its steps and screenshots; opens nothing
```

`bun run gate:signoff` without `--list` refuses unless stdin and stdout are a terminal, before it
writes anything. Do not run it through a pseudo-terminal, drive the checklist, or write
`decisions.json` or the sign-off file: say in your PR which runs await sign-off and stop.

#### Trust model

This is a local tool, not a cryptographic one. The sign-off file is plain YAML on the machine that ran
the gate (`artifacts/gate/`, not committed), and anyone with a shell there can write a well-formed one
by hand. The tooling makes the honest path the only easy one and fails closed: the gate accepts only a
sign-off for the exact target, commit and flow content it is judging; `gate:signoff` needs a terminal
and a typed confirmation, and names the person from git config. `by` records who confirmed, not proof
of who they are. Treat a sign-off as the statement of whoever controls that machine, and review it
like any other release record.

#### The sign-off file

`signoffs` from the manifest (schema: `e2e/schema/signoffs.schema.json`), written by `gate:signoff`:

```yaml
signoffs:
  - flow: flows/menus/macos-items[appearance=dark]   # the run ID from the gate report
    target: macos-15/arm64
    commit: 0123456789abcdef0123456789abcdef01234567  # git rev-parse HEAD
    flowHash: 2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae  # SHA-256 of the flow and its subflows
    verdict: pass                                     # pass | fail
    by: Jane Doe <jane@example.com>                   # git user.name <user.email>, confirmed at the terminal
    machine: qa-mac (Mac16,5)                         # host name (model)
    at: 2026-10-10T14:03:00Z                          # when the person decided
    evidence: [artifacts/gate/manual/0123456789ab/evidence/flows-menus-macos-items-appearance-dark-1.png]
    note: required with verdict fail
```

`flowHash` is the SHA-256 of the flow file's bytes followed by each `runFlow` file it can reach (path and
bytes, whatever their `when`), so editing a subflow also makes the sign-off stale (the gate report has it
per manual run as `flowHash`). `flowHash` and `machine` are required: a sign-off file written before they
were must be signed again. The
gate fails with `signoffs` when the file is missing or invalid, a required sign-off is missing, a run
has more than one sign-off for this commit and flow content, the only sign-off is stale (for another
commit or flow content: the reason names both and says when the flow changed), the verdict is `fail`
(the reason carries the note), or evidence is missing. In the report, a `manual: true` run is
`signed-off`, `failed` (signed off as failed), `unsigned` (it needs a sign-off and has no valid one) or
`not-run` (it needs none and has none).

`tests/e2e-gate.test.ts` covers each case with fixture gate runs and drives the checklist service
(`examples/kitchen-sink/screens/infra/sign-off.ts`) end to end through `gate:signoff`, with test doubles
for the app launch and the person's typed confirmation; `tests/e2e-runner.test.ts` covers the runner's
manual steps; `e2e/flows/infra/sign-off.yaml` opens the checklist with
`e2e/fixtures/signoff/session.json` through the driver.

### Scoped runs (`--flow`)

```sh
bun run gate --flow e2e/flows/menus/availability.yaml --agent   # one flow
bun run gate --flow e2e/flows/menus --flow e2e/flows/dialogs     # areas; --flow repeats
```

`--flow` takes a gate flow or a directory of them; the run covers every gate flow at or
under each path, all matrix combinations, manual flows included. A path that does not
exist, is not a flow (a subflow, a registry) or is not a gate flow (outside `include`) is
a usage error. A scoped run judges its flows exactly as the full gate does: the same
target, release build and signature check, backends, zero retries, blocking rules, time
budget and sign-offs. Only the checks about the rest of the tree are narrowed:

| Check | Scoped run |
|---|---|
| Source | Uncommitted changes are a warning, not a reason: a scoped run certifies no commit |
| Lint | Every file under `e2e/` except flows outside the scope |
| Coverage | Problems in the scoped flows' areas (`flows/<area>/` and `checks/<area>.yaml`). The whole SDK surface is not required |
| Budgets | Those a scoped flow recorded, or whose `flows` globs match a scoped flow |
| Everything else | Unchanged |

It writes `report.json`, `index.html` and the runner's `run/` under `scoped/` next to the
manifest's report paths (`artifacts/gate/scoped/` for the Kitchen Sink), so it never
replaces a full gate report, and the report's `scope` lists the flows. `--dry-run` with
`--flow` prints the scoped plan.

With `--agent`, the gate prints JSON lines only: `flow-start` and `flow-end` for each run
(as in [Agent mode](#agent-mode), with the absolute `bundle` of a failed run), then one
`gate-end` line:

```jsonc
{ "event": "gate-end", "verdict": "FAIL", "target": "macos-27/arm64", "scope": ["flows/menus/availability.yaml"],
  "reasons": [{ "check": "flows", "message": "flows/menus/availability: …" }], "warnings": [],
  "flows": [{ "id": "flows/menus/availability", "status": "failed", "blocking": true, "failure": "…", "bundle": "/…/artifacts/gate/scoped/run/flows/menus/availability/run/failure/bundle.json" }],
  "report": { "json": "/…/artifacts/gate/scoped/report.json", "html": "/…/artifacts/gate/scoped/index.html" }, "run": "/…/artifacts/gate/scoped/run" }
```

`--agent` works without `--flow` too. The gate report's flow entries have `bundle`
(relative to the repository root) for failed runs.

### From a flows task

Your flow is a gate flow as soon as it is under `flows/`. Before you open a PR, run
`bun run gate --dry-run` to see it in the plan for your platform, and check that it is
blocking (the default). Then run `bun run gate --flow e2e/flows/<area> --agent` against
the release build (`cd examples/kitchen-sink && bun run build`) and fix every reason. If it needs a person, use `manualStep` in a `manual: partial` flow (or
`manual: true` when nothing can be automated), with an `instruction` a stranger can follow and an
`expect` that is true or false at a glance, and say in the PR that it awaits sign-off. If it measures performance, record metrics through the driver
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
