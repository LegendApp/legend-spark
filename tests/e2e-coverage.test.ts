import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { readSdkSurface, type SdkSurface } from "../scripts/api-surface.ts";
import { checkCoverage, formatCoverage, type CoverageReport } from "../scripts/e2e/coverage.ts";
import { collect } from "../scripts/e2e/files.ts";
import { checkRegistry, formatDiagnostic } from "../scripts/e2e/format/parser.ts";

const FIXTURES = "tests/fixtures/e2e-coverage";
const SURFACE: SdkSurface = {
  "./windows": { values: ["getWindowAvailability", "openWindow"], types: ["WindowOpenOptions"], flags: { getWindowAvailability: ["().available"] } },
  "./ui": { values: ["getControlAvailability"], types: [], flags: { getControlAvailability: ["(button).available", "(select).available"] } },
  "./config": { values: [], types: [], flags: {} },
  "./package.json": { values: [], types: [], flags: {} },
};
const coverage = (fixture: string, surface = SURFACE) =>
  checkCoverage(collect(path.join(FIXTURES, fixture)).map(([file, kind]) => ({ file, kind, source: readFileSync(file, "utf8") })), surface);
const coveredBy = (report: CoverageReport) => Object.fromEntries(report.surface.map(item => [item.id, item.coveredBy]));
const problems = (report: CoverageReport) => report.problems.map(problem => `${problem.area} ${formatDiagnostic(problem).replace(`${FIXTURES}/broken/`, "")}`);

describe("coverage engine", () => {
  test("complete coverage passes", () => {
    const report = coverage("complete");
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.summary).toEqual({ checks: 4, flows: 3, required: 9, covered: 9, problems: 0 });
    expect(coveredBy(report)).toEqual({
      "./windows": ["WIN-OPEN-01", "WIN-AVAIL-01"],
      "./windows#getWindowAvailability": ["WIN-AVAIL-01"],
      "./windows#openWindow": ["WIN-OPEN-01"],
      "./windows#getWindowAvailability().available": ["WIN-AVAIL-01"],
      "./ui": ["UI-CTRL-01"],
      "./ui#getControlAvailability": ["UI-CTRL-01"],
      "./ui#getControlAvailability(button).available": ["UI-CTRL-01"],
      "./ui#getControlAvailability(select).available": ["UI-CTRL-01"],
      "./config": ["CFG-PLUGIN-01"],
    });
    expect(report.checks.find(check => check.id === "WIN-OPEN-01")).toEqual({
      id: "WIN-OPEN-01", area: "windows", title: "openWindow opens a second window", covers: ["./windows#openWindow"],
      location: { file: `${FIXTURES}/complete/checks/windows.yaml`, line: 4, column: 3 }, flows: [`${FIXTURES}/complete/flows/windows/open.yaml`],
    });
  });

  test("detects every failure mode with its location and area", () => {
    const report = coverage("broken");
    expect(report.ok).toBe(false);
    expect(problems(report)).toEqual([
      "windows checks/windows.yaml:7:3: WIN-ORPHAN-01 is not listed in any flow's checks [no-flow]",
      "windows checks/windows.yaml:12:14: WIN-TYPO-01 covers ./windows#openWindw, which is not in the @legendapp/spark surface [unknown-cover]",
      "zoom checks/zoom.yaml:4:3: WIN-OPEN-01 is already registered at tests/fixtures/e2e-coverage/broken/checks/windows.yaml:4 [duplicate-check]",
      'ui flows/ui/invalid.yaml:5:3: unknown command "tapOnn" (did you mean "tapOn"?) [unknown-command]',
      "windows flows/windows/open.yaml:3:51: WIN-MISSING-01 is not registered in any e2e/checks/<area>.yaml [unregistered-check]",
    ]);
    expect(report.surface.filter(item => !item.coveredBy.length).map(item => item.id)).toEqual([
      "./windows#getWindowAvailability().available", // covering the export does not cover its flags
      "./ui#getControlAvailability(select).available", // each argument of a parameterized availability call is its own flag
      "./config", // claimed only by WIN-ORPHAN-01, which no flow lists
    ]);
    expect(report.summary).toEqual({ checks: 5, flows: 2, required: 9, covered: 6, problems: 5 });
  });

  test("an empty tree covers nothing and fails", () => {
    const report = checkCoverage([], SURFACE);
    expect([report.ok, report.problems, report.summary.covered]).toEqual([false, [], 0]);
  });

  test("type-only exports may be covered but are not required; package.json is not API", () => {
    const report = checkCoverage([
      { file: "checks/windows.yaml", kind: "registry", source: "area: windows\nprefix: WIN\nchecks:\n  WIN-A-01: { title: x, covers: [./windows#WindowOpenOptions, ./package.json] }\n" },
      { file: "flows/windows/a.yaml", kind: "flow", source: "appId: a\nname: a\nchecks: [WIN-A-01]\n---\n- launchApp\n" },
    ], SURFACE);
    expect(report.problems).toEqual([]);
    expect(report.surface.map(item => item.id)).not.toContain("./windows#WindowOpenOptions");
    expect(report.surface.map(item => item.id)).not.toContain("./package.json");
    expect(coveredBy(report)["./windows"]).toEqual(["WIN-A-01"]);
  });

  test("text output groups problems by area and lists uncovered surface by subpath", () => {
    expect(formatCoverage(coverage("broken")).replaceAll(`${FIXTURES}/broken/`, "")).toBe(`ui: 1 check, 1 listed by flows
  flows/ui/invalid.yaml:5:3: unknown command "tapOnn" (did you mean "tapOn"?) [unknown-command]
windows: 4 checks, 3 listed by flows
  checks/windows.yaml:7:3: WIN-ORPHAN-01 is not listed in any flow's checks [no-flow]
  checks/windows.yaml:12:14: WIN-TYPO-01 covers ./windows#openWindw, which is not in the @legendapp/spark surface [unknown-cover]
  flows/windows/open.yaml:3:51: WIN-MISSING-01 is not registered in any e2e/checks/<area>.yaml [unregistered-check]
zoom: 0 checks, 0 listed by flows
  checks/zoom.yaml:4:3: WIN-OPEN-01 is already registered at checks/windows.yaml:4 [duplicate-check]

Uncovered @legendapp/spark surface (covers ID = subpath + suffix):
  ./windows: #getWindowAvailability().available
  ./ui: #getControlAvailability(select).available
  ./config: (subpath)

coverage: 6 of 9 SDK subpaths, exports and availability flags covered; 5 checks, 2 flows; 5 problems
`);
    expect(formatCoverage(coverage("complete"))).toBe(`config: 1 check, 1 listed by flows
ui: 1 check, 1 listed by flows
windows: 2 checks, 2 listed by flows

coverage: 9 of 9 SDK subpaths, exports and availability flags covered; 4 checks, 3 flows; 0 problems
`);
  });
});

describe("registry covers", () => {
  test("must be well-formed, unique SDK surface IDs", () => {
    const registry = (covers: string) => checkRegistry(`area: windows\nprefix: WIN\nchecks:\n  WIN-A-01: { title: x, covers: ${covers} }\n`, "windows.yaml").diagnostics.map(formatDiagnostic);
    expect(registry('[./windows, "./windows#openWindow", "./ui#getControlAvailability(text-input).available"]')).toEqual([]);
    expect(registry("[windows#openWindow]")).toEqual(['windows.yaml:4:34: checks.WIN-A-01.covers: "windows#openWindow" is not an SDK surface ID: ./subpath, ./subpath#export or ./subpath#getXAvailability(arg).flag [schema]']);
    expect(registry("[./windows, ./windows]")).toEqual([expect.stringMatching(/^windows\.yaml:4:33: checks\.WIN-A-01\.covers: must NOT have duplicate items/)]);
    expect(registry("[]")).toEqual([expect.stringMatching(/^windows\.yaml:4:33: checks\.WIN-A-01\.covers: must NOT have fewer than 1 items/)]);
  });
});

describe("SDK surface", () => {
  const surface = readSdkSurface();

  test("has every package.json subpath, split into runtime and type-only exports", () => {
    const exports = JSON.parse(readFileSync("packages/desktop/package.json", "utf8")).exports as Record<string, string>;
    expect(Object.keys(surface)).toEqual(Object.keys(exports).sort());
    expect(surface["./windows"]!.values).toContain("openWindow");
    expect(surface["./windows"]!.types).toContain("WindowOpenOptions");
    expect(surface["./config"]).toEqual({ values: [], types: [], flags: {} });
  });

  test("derives a flag for every get*Availability export from its signature", () => {
    const flagged = Object.entries(surface).flatMap(([subpath, entry]) => Object.keys(entry.flags).sort().map(name => `${subpath}#${name}`));
    const availability = Object.entries(surface).flatMap(([subpath, entry]) => entry.values.filter(name => /^get\w*Availability$/.test(name)).map(name => `${subpath}#${name}`));
    expect(flagged).toEqual(availability);
    expect(surface["./windows"]!.flags).toEqual({ getIsolatedRuntimeAvailability: ["().available"], getWindowAvailability: ["().available"] });
    const controls = ["button", "text-input", "select", "segmented-control", "checkbox", "radio-group", "switch", "slider", "stepper", "combo-box", "token-field", "path-control", "progress", "level-indicator", "disclosure-triangle"];
    expect(surface["./ui"]!.flags.getControlAvailability).toEqual(controls.map(kind => `(${kind}).available`));
    expect(surface["./ui"]!.flags.getButtonAvailability).toEqual(["().available"]);
    expect(surface["./ai"]!.flags.getAICommandAvailability).toEqual(["().claude", "().codex"]);
  });
});

describe("cli", () => {
  const run = (...args: string[]) => spawnSync(process.execPath, ["scripts/e2e/cli.ts", "coverage", ...args], { encoding: "utf8" });

  test("--json reports problems with locations and fails", () => {
    const result = run(path.join(FIXTURES, "broken"), "--json");
    expect(result.status, result.stderr).toBe(1);
    const report = JSON.parse(result.stdout) as CoverageReport;
    expect(report.ok).toBe(false);
    expect(report.problems.map(problem => `${problem.file}:${problem.line} ${problem.rule}`)).toEqual([
      `${FIXTURES}/broken/checks/windows.yaml:7 no-flow`,
      `${FIXTURES}/broken/checks/windows.yaml:12 unknown-cover`,
      `${FIXTURES}/broken/checks/zoom.yaml:4 duplicate-check`,
      `${FIXTURES}/broken/flows/ui/invalid.yaml:5 unknown-command`,
      `${FIXTURES}/broken/flows/windows/open.yaml:3 unregistered-check`,
    ]);
    expect(report.surface.find(item => item.id === "./windows#openWindow")).toEqual({ id: "./windows#openWindow", kind: "export", subpath: "./windows", coveredBy: ["WIN-OPEN-01"] });
    expect(report.summary.covered).toBeLessThan(report.summary.required);
  });

  test("text output lists the uncovered SDK surface and fails", () => {
    const result = run(path.join(FIXTURES, "complete"));
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).toMatch(/^Uncovered @legendapp\/spark surface .*\n {2}\.\/ai: \(subpath\), #buildAIInvocation, /m);
    expect(result.stdout).toMatch(/\ncoverage: \d+ of \d+ SDK subpaths, exports and availability flags covered; 4 checks, 3 flows; 0 problems\n$/);
  });

  test("rejects missing paths", () => {
    expect(run("e2e/does-not-exist").status).toBe(2);
  });
});
