# E2E verification flows

Kitchen Sink behavior is verified by YAML flows. The format uses Maestro's core
vocabulary with Maestro semantics, plus desktop extensions. This page covers how to
write a flow and check it. The full command list is in
[e2e-flow-commands.md](e2e-flow-commands.md), which is generated from the catalog.
The runner ([#49](https://github.com/LegendApp/legend-spark/issues/49)) executes
flows; this page covers only the format and its tooling.

## Layout

```
e2e/
  schema/                     # generated JSON Schemas (do not edit)
  gate.yaml                   # release-gate manifest
  checks/<area>.yaml          # check registry, one file per area
  flows/<area>/<name>.yaml    # one behavior per flow; these are gate flows
  subflows/                   # reusable command lists (runFlow)
  fixtures/                   # docs, volumes, appcasts, clipboard payloads, network mocks
  golden/<platform>/<appearance>/<locale>/<name>.png
```

The CLI knows a file's kind from where it is: `checks/<area>.yaml` is a registry,
`gate.yaml` is the manifest, anything under `subflows/` is a subflow, and anything
under `flows/` is a flow. A directory scan skips YAML anywhere else, such as fixtures.
A file you name on the command line outside those folders is checked as a flow.

## Workflow for a flows task

1. Add the checks your flow proves to `e2e/checks/<area>.yaml` (see
   [Check registry](#check-registry)).
2. Write `e2e/flows/<area>/<name>.yaml`: a header, `---`, then the commands.
3. Run `bun run e2e:lint e2e/flows/<area>` and fix every finding. Lint also runs
   validation, so a clean lint means the files are valid too.
4. Before you open a PR, run `bun run e2e:lint` with no arguments. It checks all of `e2e/`.

```sh
bun run e2e:validate [paths…]   # syntax + schema + semantic checks
bun run e2e:lint [paths…]       # validate, plus the authoring rules below
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
```

The validator rejects a prefix or file name mismatch, a malformed ID, a missing
`title` and duplicate IDs. Coverage (every check has a flow, and every flow's IDs
exist) is enforced by [#48](https://github.com/LegendApp/legend-spark/issues/48).

## Editor support

`.vscode/settings.json` maps the schemas in `e2e/schema/` onto `e2e/flows`,
`e2e/subflows`, `e2e/checks` and `e2e/gate.yaml`. With the recommended
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
