import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseAllDocuments } from "yaml";
import { describe, expect, test } from "vitest";
import { COMMANDS, isBare } from "../scripts/e2e/format/commands.ts";
import { generatedFiles } from "../scripts/e2e/format/generate.ts";
import { lintFlow, lintSubflow } from "../scripts/e2e/format/lint.ts";
import {
  checkFlow, checkGate, checkRegistry, checkSubflow, FlowFormatError, formatDiagnostic, parseCheckRegistry, parseFlow, parseSubflow, type FlowCommand,
} from "../scripts/e2e/format/parser.ts";
import { NESTED } from "../scripts/e2e/format/primitives.ts";
import { ajv, buildFlowSchema, buildGateSchema, buildRegistrySchema } from "../scripts/e2e/format/schemas.ts";

const FIXTURES = "tests/fixtures/e2e";
const read = (file: string) => readFileSync(path.join(FIXTURES, file), "utf8");
const filesIn = (dir: string) => readdirSync(path.join(FIXTURES, dir)).map(name => path.join(dir, name));
const FLOW_FIXTURES = filesIn("flows/spec");
const SUBFLOW_FIXTURES = [...filesIn("subflows/spec"), ...filesIn("subflows").filter(file => file.endsWith(".yaml"))];
const problems = (source: string, kind: "flow" | "subflow" = "subflow") => (kind === "flow" ? checkFlow : checkSubflow)(source, "t.yaml").diagnostics.map(formatDiagnostic);
const flow = (commands: string, header = "") => `appId: so.legend.kitchensink\nname: test\nchecks: [T-A-01]\n${header}---\n${commands}`;

describe("generated schema", () => {
  test("checked-in schema files and command reference match the command catalog", () => {
    for (const [file, content] of Object.entries(generatedFiles())) expect(readFileSync(file, "utf8"), `${file} is stale: run bun run e2e:schema`).toBe(content);
  });

  test("schemas are valid draft-07 and compile under ajv strict mode", () => {
    for (const schema of [buildFlowSchema(), buildRegistrySchema(), buildGateSchema()]) expect(ajv.validateSchema(schema), JSON.stringify(ajv.errors)).toBe(true);
    for (const id of ["flow", "checks", "gate"]) expect(ajv.getSchema(id)).toBeTypeOf("function");
  });

  test("VS Code maps the schemas onto e2e files", () => {
    const settings = JSON.parse(readFileSync(".vscode/settings.json", "utf8"))["yaml.schemas"];
    expect(settings).toEqual({
      "./e2e/schema/flow.schema.json": ["e2e/flows/**/*.yaml", "e2e/subflows/**/*.yaml"],
      "./e2e/schema/checks.schema.json": ["e2e/checks/*.yaml"],
      "./e2e/schema/gate.schema.json": ["e2e/gate.yaml"],
    });
  });
});

describe("spec examples", () => {
  test.each(FLOW_FIXTURES)("flow %s validates", file => expect(checkFlow(read(file), file).diagnostics).toEqual([]));
  test.each(SUBFLOW_FIXTURES)("subflow %s validates", file => expect(checkSubflow(read(file), file).diagnostics).toEqual([]));
  test("check registry and gate manifest validate", () => {
    expect(checkRegistry(read("checks/windows.yaml"), "checks/windows.yaml").diagnostics).toEqual([]);
    expect(checkGate(read("gate.yaml")).diagnostics).toEqual([]);
  });

  test("every command form is exercised by a fixture", () => {
    const used = new Map<string, Set<string>>();
    const visit = (items: unknown[]) => {
      for (const item of items) {
        const [name, value] = typeof item === "string" ? [item, null] : Object.entries(item as object)[0]!;
        const isMapping = !!value && typeof value === "object" && !Array.isArray(value);
        used.set(name, (used.get(name) ?? new Set()).add(value == null ? "bare" : isMapping ? "mapping" : "shorthand"));
        if (!isMapping) continue;
        for (const [field, schema] of Object.entries(COMMANDS[name]!.props)) {
          const nested = (value as Record<string, unknown>)[field], arity = NESTED.get(schema);
          if (arity && nested) visit(arity === "one" ? [nested] : nested as unknown[]);
        }
      }
    };
    for (const file of [...FLOW_FIXTURES, ...SUBFLOW_FIXTURES]) {
      const docs = parseAllDocuments(read(file)) as Array<{ toJS(): unknown }>;
      const header = docs.length === 2 ? docs[0]!.toJS() as Record<string, unknown[] | undefined> : {};
      visit([...header.onFlowStart ?? [], ...docs.at(-1)!.toJS() as unknown[], ...header.onFlowComplete ?? []]);
    }
    const missing = Object.entries(COMMANDS).flatMap(([name, spec]) =>
      ["mapping", ...(isBare(spec) ? ["bare"] : []), ...(spec.shorthand ? ["shorthand"] : [])].filter(form => !used.get(name)?.has(form)).map(form => `${name} (${form})`));
    expect(missing).toEqual([]);
  });

  test("parse into commands with canonical arguments, conditions and nested commands", () => {
    const sheet = parseFlow(read("flows/spec/sheet-spring.yaml"), "sheet-spring.yaml");
    expect(sheet.header.matrix).toEqual({ reduceMotion: [false, true] });
    expect(sheet.commands.map(command => command.name)).toEqual(["launchApp", "setClock", "shortcut", "advanceClock", "pressKey", "captureMotion", "assertMotion", "assertMotion", "assertScreenshot"]);
    expect(sheet.commands[0]).toEqual({ name: "launchApp", args: {}, location: { file: "sheet-spring.yaml", line: 6, column: 3 } });
    expect(sheet.commands[2]!.args).toEqual({ keys: "cmd+shift+n" });
    expect(sheet.commands[7]).toMatchObject({ args: { kind: "crossfade" }, when: { matrix: { reduceMotion: true } } });
    expect(sheet.commands[7]!.args).not.toHaveProperty("when");

    const quit = parseFlow(read("flows/spec/quit-unsaved.yaml"), "quit.yaml");
    expect((quit.commands[1]!.args.commands as FlowCommand[]).map(({ name, args, location }) => [name, args, location.line, location.column]))
      .toEqual([["shortcut", { keys: "cmd+n" }, 6, 37], ["typeText", { text: "draft" }, 6, 58]]);

    const header = parseFlow(read("flows/spec/header.yaml"), "header.yaml").header;
    expect(header.env).toEqual({ DOC: "${FIXTURES}/docs/notes.md" });
    expect(header.onFlowStart).toEqual([{ name: "runFlow", args: { file: "subflows/reset-state.yaml" }, location: { file: "header.yaml", line: 19, column: 5 } }]);
    expect(header.onFlowComplete![0]).toMatchObject({ name: "assertNoLeaks", args: { since: "flowStart" } });
  });
});

describe("command shapes", () => {
  test("selector commands accept the mapping form", () => {
    const commands = parseSubflow("- tapOn: { id: reaction-heart }\n- focusWindow: { title: notes.md }\n- assertMirrored: { id: toolbar }\n- assertFocused: { role: textField, index: 1 }\n- tapOn: Save\n");
    expect(commands.map(({ name, args }) => [name, args])).toEqual([
      ["tapOn", { id: "reaction-heart" }], ["focusWindow", { title: "notes.md" }], ["assertMirrored", { id: "toolbar" }], ["assertFocused", { role: "textField", index: 1 }], ["tapOn", { text: "Save" }],
    ]);
  });

  test("commands without required arguments stand alone", () => {
    expect(parseSubflow("- launchApp\n- launchApp:\n- killApp\n- scroll\n").map(({ name, args }) => [name, args])).toEqual([["launchApp", {}], ["launchApp", {}], ["killApp", {}], ["scroll", {}]]);
    expect(problems("- takeScreenshot\n")).toEqual(["t.yaml:1:3: takeScreenshot needs arguments [schema]"]);
  });

  test("hoverOn takes a duration; other selectors do not", () => {
    expect(parseSubflow("- hoverOn: { id: row, duration: 800ms }\n")[0]!.args).toEqual({ id: "row", duration: "800ms" });
    expect(problems("- tapOn: { id: row, duration: 800ms }\n")).toEqual([expect.stringContaining('t.yaml:1:21: tapOn: unknown key "duration"')]);
  });

  test("when inside arguments is the condition, and it is validated", () => {
    const [command] = parseSubflow("- pressKey: { key: Escape, when: { platform: macos, visible: { id: sheet } }, timeout: 2s }\n");
    expect(command).toMatchObject({ name: "pressKey", args: { key: "Escape" }, when: { platform: "macos", visible: { id: "sheet" } }, timeout: "2s" });
    expect(problems("- tapOn: { id: x, when: { platfrom: macos } }\n")).toEqual(['t.yaml:1:27: tapOn.when: unknown key "platfrom" (expected platform, visible, notVisible, matrix) [schema]']);
    expect(problems("- tapOn: { id: x, when: { platform: linux } }\n")).toEqual(['t.yaml:1:37: tapOn.when.platform: must be one of "macos", "windows" [schema]']);
    expect(problems("- tapOn: { id: x, when: { visible: { bogus: 1 } } }\n")).toEqual([
      't.yaml:1:36: tapOn.when.visible: needs one of "id", "role", "label", "text", "point", "below", "above", "leftOf", "rightOf" [schema]',
      't.yaml:1:38: tapOn.when.visible: unknown key "bogus" (expected id, role, label, text, within, index, window, below, above, leftOf, rightOf, point) [schema]',
    ]);
  });

  test("assertPaused keeps its own when argument", () => {
    const [command] = parseSubflow("- assertPaused: { target: { id: spinner }, when: windowHidden }\n");
    expect(command).toMatchObject({ args: { target: { id: "spinner" }, when: "windowHidden" } });
    expect(command).not.toHaveProperty("when");
  });

  test("commands nested in other commands are parsed and validated", () => {
    const source = [
      "- interruptAt: { progress: 0.4, with: { pressKey: Escape } }",
      "- assertFrames: { during: { runFlow: subflows/scroll.yaml }, fps: { min: 118 } }",
      "- assertNoFlicker: { during: { tapOn: { id: toggle } } }",
      "- assertNoLayoutThrash: { during: { runFlow: { commands: [{ tapOn: Reflow }] } } }",
      "- measure: { name: open, run: [{ shortcut: cmd+o }] }",
      "- assertNoLeaks: { repeat: 10, run: [{ shortcut: cmd+n }, { shortcut: cmd+w }] }",
      "- runFlow: { when: { platform: windows }, commands: [launchApp] }",
      "",
    ].join("\n");
    const commands = parseSubflow(source, "n.yaml");
    const nested = (index: number, field: string) => commands[index]!.args[field] as FlowCommand & FlowCommand[];
    expect(nested(0, "with")).toEqual({ name: "pressKey", args: { key: "Escape" }, location: { file: "n.yaml", line: 1, column: 41 } });
    expect(nested(1, "during")).toMatchObject({ name: "runFlow", args: { file: "subflows/scroll.yaml" } });
    expect(nested(2, "during")).toMatchObject({ name: "tapOn", args: { id: "toggle" } });
    expect((nested(3, "during").args.commands as FlowCommand[])[0]).toMatchObject({ name: "tapOn", args: { text: "Reflow" }, location: { line: 4, column: 61 } });
    expect(nested(4, "run").map(command => command.name)).toEqual(["shortcut"]);
    expect(nested(5, "run").map(command => command.args)).toEqual([{ keys: "cmd+n" }, { keys: "cmd+w" }]);
    expect(commands[6]).toMatchObject({ when: { platform: "windows" }, args: { commands: [{ name: "launchApp", args: {} }] } });

    expect(problems("- interruptAt: { progress: 0.4, with: { presKey: Escape } }\n")).toEqual(['t.yaml:1:41: unknown command "presKey" (did you mean "pressKey"?) [unknown-command]']);
    expect(problems("- assertFrames: { during: { shortcut: cmd+shft+s }, dropped: 0 }\n")).toEqual(['t.yaml:1:39: assertFrames.during.shortcut: "cmd+shft+s" is not a valid accelerator: Invalid or duplicate modifier: shft [schema]']);
    expect(problems("- assertNoFlicker: { during: { tapOn: Save, pressKey: Escape } }\n")).toEqual(["t.yaml:1:30: assertNoFlicker.during: one command per list item; found tapOn, pressKey [schema]"]);
    expect(problems("- assertNoLayoutThrash: { during: { sleep: 1s } }\n")).toEqual([expect.stringMatching(/^t\.yaml:1:37: "sleep" is not a command.*\[no-sleep\]$/)]);
  });

  test("${VAR} interpolation stays literal; unquoted inside { } or [ ] is a located YAML error with a fix", () => {
    expect(parseSubflow('- launchApp: { openFile: "${FIXTURES}/docs/notes.md" }\n- launchApp:\n    openFile: ${DOC}\n').map(command => command.args.openFile)).toEqual(["${FIXTURES}/docs/notes.md", "${DOC}"]);
    expect(problems("- launchApp: { clearState: true, openFile: ${FIXTURES}/docs/notes.md }\n")).toEqual([
      't.yaml:1:45: Unexpected flow-map-start at node end. Quote ${VAR} inside { } and [ ], for example "${FIXTURES}/a.png". [yaml]',
    ]);
    expect(problems("- dragToDock: { files: [${DOC}] }\n")).toEqual([expect.stringMatching(/^t\.yaml:1:26: .*Quote \$\{VAR\}/)]);
  });

  test.each([
    ["- tapOnn: Save", 't.yaml:1:3: unknown command "tapOnn" (did you mean "tapOn"?) [unknown-command]'],
    ["- launchAp", 't.yaml:1:3: unknown command "launchAp" (did you mean "launchApp"?) [unknown-command]'],
    ["- frobnicate: 1", 't.yaml:1:3: unknown command "frobnicate" [unknown-command]'],
    ["- tapOn: Save\n  pressKey: Escape", "t.yaml:1:3: one command per list item; found tapOn, pressKey [schema]"],
    ["- {}", "t.yaml:1:3: empty command [schema]"],
    ["- tapOn: 13", "t.yaml:1:10: tapOn: must be string [schema]"],
    ["- tapOn: \"/[a/\"", 't.yaml:1:10: tapOn: "/[a/" is not a valid text-pattern: Invalid regular expression: missing terminating ] for character class [schema]'],
    ["- crashApp: banana", 't.yaml:1:13: crashApp: must be one of "native", "js" [schema]'],
    ["- advanceClock: soon", 't.yaml:1:17: advanceClock: "soon" is not a duration such as 120ms, 1.5s or 2m (a bare integer is milliseconds) [schema]'],
    ["- repeat: { commands: [{ tapOn: x }] }", 't.yaml:1:11: repeat: needs one of "times", "while" [schema]'],
    ["- extendedWaitUntil: { visible: a, notVisible: b }", 't.yaml:1:22: extendedWaitUntil: takes only one of "visible", "notVisible" [schema]'],
    ["- permission: { grant: camera, reset: camera }", 't.yaml:1:15: permission: takes only one of "grant", "revoke", "reset" [schema]'],
    ["- selectMenu: Export", 't.yaml:1:15: selectMenu: "Export" is not a menu path such as "File > Export > PDF…" [schema]'],
    ["- resizeWindow: { edge: left }", 't.yaml:1:17: resizeWindow: missing required key "to" [schema]'],
    ["- tapOn: { point: 50%, window: key }", 't.yaml:1:19: tapOn.point: "50%" is not a point such as "50%,20%" or "120,48" (percent of the target, or points from its top-left) [schema]'],
    ["- assertWindow: { key: front }", 't.yaml:1:24: assertWindow.key: must be one of "key", "main" [schema]'],
    ["- typeText: { text: hi, into: { id: a }, extra: 1 }", 't.yaml:1:42: typeText: unknown key "extra" (expected text, into, when, timeout) [schema]'],
  ])("%j is reported precisely", (source, expected) => expect(problems(`${source}\n`)).toEqual([expected]));
});

describe("flow structure", () => {
  test.each([
    ["appId: a\nname: b\n- launchApp\n", "t.yaml:3:1: Implicit keys need to be on a single line. [yaml]"],
    ["- launchApp\n", "t.yaml:1:1: expected a header, `---`, then a command list; found 1 YAML document(s) [structure]"],
    ["appId: a\nname: b\n---\n- launchApp\n---\n- killApp\n", "t.yaml:5:1: expected a header, `---`, then a command list; found 3 YAML document(s) [structure]"],
    ["appId: a\nname: b\n---\n", "t.yaml:3:4: commands: must be array [schema]"],
    ["appId: a\n---\n- launchApp\n", 't.yaml:1:1: header: missing required key "name" [schema]'],
    ["appId: a\nname: b\nbuild: debug\n---\n- launchApp\n", 't.yaml:3:8: build: must be one of "release", "dev" [schema]'],
    ["appId: a\nname: b\nretry: 2\n---\n- launchApp\n", 't.yaml:3:1: header: unknown key "retry" (expected appId, name, intent, checks, tags, platforms, build, manual, timeout, matrix, env, onFlowStart, onFlowComplete) [schema]'],
    ["appId: a\nname: b\nonFlowStart:\n  - wait: 1s\n---\n- launchApp\n", expect.stringMatching(/^t\.yaml:4:5: "wait" is not a command.*\[no-sleep\]$/)],
  ])("%j", (source, expected) => expect(problems(source, "flow")).toEqual([expected]));

  test("when.matrix must name declared dimensions and values", () => {
    expect(problems(flow("- tapOn: { id: x, when: { matrix: { reduceMotion: true } } }\n- tapOn: { id: x, when: { matrix: { appearance: dark } } }\n", "matrix: { reduceMotion: [false] }\n"), "flow")).toEqual([
      "t.yaml:6:3: tapOn when.matrix.reduceMotion: true is not in the header matrix (false) [schema]",
      "t.yaml:7:3: tapOn when.matrix.appearance: the header matrix has no appearance dimension [schema]",
    ]);
  });

  test("subflows are a single command list", () => {
    expect(problems("appId: a\n---\n- launchApp\n")).toEqual(["t.yaml:2:1: expected one command list (subflows have no header); found 2 YAML document(s) [structure]"]);
  });

  test("parse functions throw every located problem", () => {
    expect(() => parseFlow("appId: a\n---\n- tapOnn: x\n", "f.yaml")).toThrow(FlowFormatError);
    const error = (() => { try { parseSubflow("- tapOnn: x\n- sleep: 1s\n", "s.yaml"); } catch (thrown) { return thrown as FlowFormatError; } })();
    expect(error?.diagnostics.map(diagnostic => [diagnostic.line, diagnostic.rule])).toEqual([[1, "unknown-command"], [2, "no-sleep"]]);
    expect(error?.message).toMatch(/^s\.yaml:1:3: unknown command "tapOnn"/);
  });
});

describe("catalog", () => {
  test("driver-backed commands are marked", () => {
    expect(Object.keys(COMMANDS).filter(name => COMMANDS[name]!.driver).sort()).toEqual([
      "advanceClock", "assertEnergy", "assertFrames", "assertIdleCpu", "assertMemory", "assertMotion", "assertNoFlicker", "assertNoLayoutThrash", "assertNoLeaks",
      "assertPaused", "assertScreenshot", "assertStartup", "assertState", "captureMotion", "interruptAt", "measure", "setAppAppearance", "setClock", "startTrace",
      "stopTrace", "takeScreenshot",
    ]);
    expect(COMMANDS.setAppearance!.driver).toBeUndefined();
  });

  test("Maestro core vocabulary is present and marked", () => {
    const maestro = ["launchApp", "tapOn", "inputText", "assertVisible", "assertNotVisible", "runFlow", "repeat", "extendedWaitUntil", "scroll", "swipe", "takeScreenshot", "pressKey", "stopApp", "killApp", "runScript"];
    expect(Object.keys(COMMANDS).filter(name => COMMANDS[name]!.maestro).sort()).toEqual(maestro.sort());
    expect(parseSubflow("- extendedWaitUntil: { visible: Done, timeout: 10000 }\n- runFlow: subflows/login.yaml\n- scroll\n").map(({ name, args, timeout }) => [name, args, timeout]))
      .toEqual([["extendedWaitUntil", { visible: "Done" }, 10000], ["runFlow", { file: "subflows/login.yaml" }, undefined], ["scroll", {}, undefined]]);
  });

  test("short forms only stand for non-mapping values", () => {
    for (const [name, spec] of Object.entries(COMMANDS)) {
      if (!spec.shorthand) continue;
      expect(spec.props[spec.shorthand], name).toBeDefined();
      expect(NESTED.has(spec.props[spec.shorthand]!), name).toBe(false);
    }
  });
});

describe("check registry", () => {
  test("parses", () => {
    expect(parseCheckRegistry(read("checks/windows.yaml"), "checks/windows.yaml")).toEqual({
      area: "windows", prefix: "WIN", checks: { "WIN-FRAME-01": { title: "Frame autosave restores per window ID", platforms: ["macos", "windows"], blocking: true, spec: "Spec §2 Windows" } },
    });
  });

  test.each([
    ["area: windows\nprefix: WIN\nchecks:\n  WIN-FRAME-1: { title: x }\n", 'windows.yaml:4:3: checks: invalid key "WIN-FRAME-1" [schema]'],
    ["area: windows\nprefix: WIN\nchecks:\n  MW-TEAR-01: { title: x }\n", 'windows.yaml:4:3: check ID "MW-TEAR-01" must start with the area prefix WIN- [schema]'],
    ["area: window\nprefix: WIN\nchecks:\n  WIN-A-01: { title: x }\n", 'windows.yaml:1:7: area "window" must match the file name windows.yaml (one registry file per area) [schema]'],
    ["area: windows\nprefix: WIN\nchecks:\n  WIN-A-01: { blocking: true }\n", 'windows.yaml:4:13: checks.WIN-A-01: missing required key "title" [schema]'],
    ["area: windows\nprefix: WIN\nchecks:\n  WIN-A-01: { title: x }\n  WIN-A-01: { title: y }\n", "windows.yaml:5:3: Map keys must be unique. [yaml]"],
    ["area: windows\nprefix: win\nchecks: {}\n", 'windows.yaml:2:9: prefix: "win" is not the check ID prefix, such as WIN [schema]'],
  ])("%j", (source, ...expected) => expect(checkRegistry(source, "windows.yaml").diagnostics.map(formatDiagnostic)).toEqual(expect.arrayContaining(expected)));

  test("gate manifest forbids retries", () => {
    expect(checkGate(read("gate.yaml").replace("retries: 0", "retries: 1")).diagnostics.map(formatDiagnostic)).toEqual(["gate.yaml:16:10: retries: must be one of 0 [schema]"]);
  });
});

describe("lint", () => {
  const lint = (source: string, gate = true) => lintFlow(source, "t.yaml", { gate }).map(diagnostic => `${diagnostic.line}:${diagnostic.column} ${diagnostic.rule}`);

  test("missing or empty checks", () => {
    expect(lint("appId: a\nname: b\n---\n- launchApp\n")).toEqual(["1:1 missing-checks"]);
    expect(lint("appId: a\nname: b\nchecks: []\n---\n- launchApp\n")).toEqual(["3:9 missing-checks"]);
  });

  test("check IDs must be PREFIX-NAME-NN", () => {
    expect(lint(flow("- launchApp\n").replace("[T-A-01]", "[MW-TEAR-01, mw-tear-01, MW-TEAR-1, MWTEAR01]"))).toEqual(["3:22 check-id", "3:34 check-id", "3:45 check-id"]);
  });

  test("build: dev only in flows outside the gate", () => {
    expect(lint(flow("- launchApp\n", "build: dev\n"))).toEqual(["4:8 dev-build"]);
    expect(lint(flow("- launchApp\n", "build: dev\n"), false)).toEqual([]);
    expect(lint(flow("- launchApp\n", "build: release\n"))).toEqual([]);
  });

  test("sleeps and unknown commands", () => {
    expect(lint(flow("- sleep: 500ms\n- waitForAnimationToEnd\n- delay: 1s\n- tapOnn: x\n"))).toEqual(["5:3 no-sleep", "6:3 no-sleep", "7:3 no-sleep", "8:3 unknown-command"]);
  });

  test("point selectors unless anchored in an element with an id", () => {
    expect(lint(flow("- tapOn: { point: \"50%,20%\", window: key }\n- dragAndDrop: { from: { point: \"10,10\" }, to: { id: bin } }\n- tapOn: { point: \"50%,50%\", within: { id: canvas } }\n- tapOn: { id: save }\n")))
      .toEqual(["5:12 point-selector", "6:26 point-selector"]);
    expect(lintSubflow("- tapOn: { point: \"1,1\", within: { role: canvas } }\n", "s.yaml").map(diagnostic => diagnostic.rule)).toEqual(["point-selector"]);
  });

  test("validation problems are lint problems; syntax errors stop the rules", () => {
    expect(lint("appId: a\nname: b\n---\n- tapOn: { idd: x }\n")).toEqual(["1:1 missing-checks", "4:10 schema", "4:12 schema"]);
    expect(lint("appId: a\nname: b\n---\n- tapOn: { id: ${X} }\n")).toEqual(["4:17 yaml"]);
  });

  test("spec examples are lint-clean except the documented last-resort point selector", () => {
    expect(FLOW_FIXTURES.flatMap(file => lintFlow(read(file), file, { gate: true }))).toEqual([]);
    expect(SUBFLOW_FIXTURES.flatMap(file => lintSubflow(read(file), file)).map(formatDiagnostic)).toEqual([
      expect.stringMatching(/^subflows\/spec\/selectors\.yaml:8:12: point selector: .*\[point-selector\]$/),
    ]);
  });
});

describe("cli", () => {
  const run = (...args: string[]) => spawnSync(process.execPath, ["scripts/e2e/cli.ts", ...args], { encoding: "utf8" });

  test("validates and lints a tree, classifying files by location", () => {
    const validate = run("validate", FIXTURES);
    expect(validate.status, validate.stderr).toBe(0);
    expect(validate.stdout).toBe(`validated ${FLOW_FIXTURES.length + SUBFLOW_FIXTURES.length + 2} files (1 check registry, ${FLOW_FIXTURES.length} flows, 1 gate manifest, ${SUBFLOW_FIXTURES.length} subflows): 0 problems\n`);
    const lint = run("lint", FIXTURES);
    expect(lint.status).toBe(1);
    expect(lint.stdout).toMatch(/^tests\/fixtures\/e2e\/subflows\/spec\/selectors\.yaml:8:12: point selector: .*\[point-selector\]\n.*: 1 problem\n$/);
  });

  test("reports every problem with its location and fails", () => {
    const root = mkdtempSync(path.join(tmpdir(), "e2e-cli-"));
    for (const dir of ["flows/editor", "checks", "fixtures"]) mkdirSync(path.join(root, dir), { recursive: true });
    writeFileSync(path.join(root, "flows/editor/save.yaml"), "appId: a\nname: Save\nbuild: dev\nchecks: [ED-SAVE-01]\n---\n- launchApp\n- sleep: 1s\n");
    writeFileSync(path.join(root, "checks/editor.yaml"), "area: editor\nprefix: ED\nchecks:\n  ED-SAVE-01: { title: Save writes the file }\n");
    writeFileSync(path.join(root, "fixtures/mock.yaml"), "not: [a flow\n");
    const validate = run("validate", root);
    expect(validate.status).toBe(1);
    expect(validate.stdout).toMatch(/flows\/editor\/save\.yaml:7:3: "sleep" is not a command.*\[no-sleep\]\nvalidated 2 files \(1 check registry, 1 flow\): 1 problem\n$/);
    const lint = run("lint", path.join(root, "flows/editor/save.yaml"));
    expect(lint.stdout).toMatch(/save\.yaml:3:8: gate flows run against release builds.*\[dev-build\]\n.*save\.yaml:7:3: .*\[no-sleep\]\nlinted 1 file \(1 flow\): 2 problems\n$/);
  });

  test("rejects unknown modes and missing paths", () => {
    expect(run("check").status).toBe(2);
    const missing = run("validate", "e2e/does-not-exist");
    expect([missing.status, missing.stderr.trim()]).toEqual([2, `not found: ${path.resolve("e2e/does-not-exist")}`]);
  });
});
