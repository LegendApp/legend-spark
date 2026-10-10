import path from "node:path";
import { isMap, isScalar, type Document, type Node, type Pair } from "yaml";
import type { SdkSurface } from "../api-surface.ts";
import type { Kind } from "./files.ts";
import { checkFlow, checkRegistry, formatDiagnostic, locate, type Diagnostic, type SourceLocation } from "./format/parser.ts";

export type SurfaceItem = { id: string; kind: "subpath" | "export" | "availability"; subpath: string; coveredBy: string[] };
export type CoverageCheck = { id: string; area: string; title: string; location: SourceLocation; covers: string[]; flows: string[] };
export type CoverageProblem = Diagnostic & { area: string };
export type CoverageReport = {
  ok: boolean;
  summary: { checks: number; flows: number; required: number; covered: number; problems: number };
  checks: CoverageCheck[];
  surface: SurfaceItem[];
  problems: CoverageProblem[];
};
export type E2eFile = { file: string; kind: Kind; source: string };

/** Exported so tooling can read the version: package metadata, not API. */
const NOT_API = new Set(["./package.json"]);

/** Required: every subpath, runtime export and availability flag. Type-only exports may be covered, but are not required. */
function surfaceItems(surface: SdkSurface) {
  const required = new Map<string, SurfaceItem>();
  const known = new Set<string>();
  const add = (id: string, kind: SurfaceItem["kind"], subpath: string) => {
    known.add(id);
    if (!NOT_API.has(subpath)) required.set(id, { id, kind, subpath, coveredBy: [] });
  };
  for (const [subpath, entry] of Object.entries(surface)) {
    add(subpath, "subpath", subpath);
    for (const name of entry.values) add(`${subpath}#${name}`, "export", subpath);
    for (const [name, flags] of Object.entries(entry.flags)) for (const flag of flags) add(`${subpath}#${name}${flag}`, "availability", subpath);
    for (const name of entry.types) known.add(`${subpath}#${name}`);
  }
  return { required, known };
}

/** A cover also covers what contains it: a flag covers its function's export, and an export covers its subpath. */
function withContainers(id: string): string[] {
  const [subpath, member] = id.split("#") as [string, string | undefined];
  const name = member?.replace(/\(.*$/, "");
  return [...new Set([id, subpath, ...(name ? [`${subpath}#${name}`] : [])])];
}

/** Registries are named for their area; flows live in flows/<area>/. */
function areaOf(file: string, kind: Kind): string {
  const segments = file.split(path.sep);
  const flows = segments.lastIndexOf("flows");
  return (kind === "registry" || flows < 0 ? segments.at(-1)! : segments[flows + 1]!).replace(/\.ya?ml$/, "");
}

const keyOf = (doc: Document.Parsed, id: string) => {
  const checks = doc.get("checks", true);
  return isMap(checks) ? (checks.items as Pair<Node>[]).find(pair => isScalar(pair.key) && pair.key.value === id)?.key : undefined;
};
const sortByPosition = (problems: CoverageProblem[]) => problems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);

/**
 * Coverage of the e2e tree: every registered check is listed by a flow, every check a flow lists is registered,
 * every `covers` entry names SDK surface, and every required surface item is covered by a check a flow lists.
 */
export function checkCoverage(files: E2eFile[], surface: SdkSurface): CoverageReport {
  const problems: CoverageProblem[] = [];
  const checks = new Map<string, CoverageCheck>();
  const covers: Array<{ check: CoverageCheck; id: string; location: SourceLocation }> = [];
  const references: Array<{ id: string; area: string; file: string; location: SourceLocation }> = [];
  let flows = 0;
  for (const { file, kind, source } of files) {
    if (kind !== "registry" && kind !== "flow") continue;
    const area = areaOf(file, kind);
    const { loaded, diagnostics, value } = kind === "registry" ? checkRegistry(source, file) : checkFlow(source, file);
    problems.push(...diagnostics.map(diagnostic => ({ ...diagnostic, area })));
    if (!value) continue;
    const doc = loaded.docs[0]!;
    if ("commands" in value) {
      flows++;
      (value.header.checks ?? []).forEach((id, index) => references.push({ id, area, file, location: locate(loaded, doc.getIn(["checks", index], true) as Node) }));
      continue;
    }
    for (const [id, entry] of Object.entries(value.checks)) {
      const location = locate(loaded, keyOf(doc, id));
      const registered = checks.get(id);
      if (registered) { problems.push({ ...location, area, rule: "duplicate-check", message: `${id} is already registered at ${registered.location.file}:${registered.location.line}` }); continue; }
      const check: CoverageCheck = { id, area, title: entry.title, location, covers: entry.covers ?? [], flows: [] };
      checks.set(id, check);
      check.covers.forEach((cover, index) => covers.push({ check, id: cover, location: locate(loaded, doc.getIn(["checks", id, "covers", index], true) as Node) }));
    }
  }
  for (const reference of references) {
    const check = checks.get(reference.id);
    if (!check) problems.push({ ...reference.location, area: reference.area, rule: "unregistered-check", message: `${reference.id} is not registered in any e2e/checks/<area>.yaml` });
    else if (!check.flows.includes(reference.file)) check.flows.push(reference.file);
  }
  for (const check of checks.values()) if (!check.flows.length) problems.push({ ...check.location, area: check.area, rule: "no-flow", message: `${check.id} is not listed in any flow's checks` });
  const { required, known } = surfaceItems(surface);
  for (const { check, id, location } of covers) {
    if (!known.has(id)) problems.push({ ...location, area: check.area, rule: "unknown-cover", message: `${check.id} covers ${id}, which is not in the @legendapp/spark surface` });
    // Only a check that some flow verifies counts toward coverage.
    else if (check.flows.length) for (const item of withContainers(id)) {
      const coveredBy = required.get(item)?.coveredBy;
      if (coveredBy && !coveredBy.includes(check.id)) coveredBy.push(check.id);
    }
  }
  const items = [...required.values()];
  const covered = items.filter(item => item.coveredBy.length).length;
  return {
    ok: !problems.length && covered === items.length,
    summary: { checks: checks.size, flows, required: items.length, covered, problems: problems.length },
    checks: [...checks.values()],
    surface: items,
    problems: sortByPosition(problems),
  };
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** Human-readable report: problems grouped by area, then uncovered SDK surface grouped by subpath. */
export function formatCoverage(report: CoverageReport): string {
  const lines: string[] = [];
  for (const area of [...new Set([...report.checks, ...report.problems].map(item => item.area))].sort()) {
    const checks = report.checks.filter(check => check.area === area);
    lines.push(`${area}: ${count(checks.length, "check")}, ${checks.filter(check => check.flows.length).length} listed by flows`);
    for (const problem of report.problems.filter(problem => problem.area === area)) lines.push(`  ${formatDiagnostic(problem)}`);
  }
  const uncovered = report.surface.filter(item => !item.coveredBy.length);
  if (uncovered.length) {
    if (lines.length) lines.push("");
    lines.push("Uncovered @legendapp/spark surface (covers ID = subpath + suffix):");
    for (const subpath of new Set(uncovered.map(item => item.subpath))) {
      const suffixes = uncovered.filter(item => item.subpath === subpath).map(item => item.id === subpath ? "(subpath)" : item.id.slice(subpath.length));
      lines.push(`  ${subpath}: ${suffixes.join(", ")}`);
    }
  }
  const { summary } = report;
  if (lines.length) lines.push("");
  lines.push(`coverage: ${summary.covered} of ${summary.required} SDK subpaths, exports and availability flags covered; ${count(summary.checks, "check")}, ${count(summary.flows, "flow")}; ${count(summary.problems, "problem")}`);
  return `${lines.join("\n")}\n`;
}
