import { isMap, isScalar, isSeq, visit, type Node } from "yaml";
import path from "node:path";
import type { Kind } from "../files.ts";
import { checkBudgets, checkFlow, checkGate, checkRegistry, checkSubflow, diagnosticAt, type Diagnostic, type Loaded } from "./parser.ts";
import { CHECK_ID } from "./primitives.ts";

const byPosition = (diagnostics: Diagnostic[]) => diagnostics.sort((a, b) => a.line - b.line || a.column - b.column);

function headerRules(loaded: Loaded, gate: boolean): Diagnostic[] {
  const header = loaded.docs[0]!.contents as Node | null;
  if (!isMap(header)) return [];
  const out: Diagnostic[] = [];
  const checks = header.get("checks", true) as Node | undefined;
  if (!isSeq(checks) || !checks.items.length) out.push(diagnosticAt(loaded, checks ?? header, "missing-checks", "the flow lists no checks: add `checks: [PREFIX-NAME-NN, …]` with the registry IDs it verifies"));
  else for (const item of checks.items as Node[]) {
    if (!isScalar(item) || typeof item.value !== "string" || !new RegExp(CHECK_ID).test(item.value)) out.push(diagnosticAt(loaded, item, "check-id", `check ID ${JSON.stringify(item.toJSON())} must look like PREFIX-NAME-NN, for example MW-TEAR-01`));
  }
  const build = header.get("build", true) as Node | undefined;
  if (gate && isScalar(build) && build.value === "dev") out.push(diagnosticAt(loaded, build, "dev-build", "gate flows run against release builds: remove `build: dev`"));
  return out;
}

/** A point is a last resort: the element should have an id, or the point must sit inside one (`within: { id }`). */
function pointSelectors(loaded: Loaded): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const doc of loaded.docs) visit(doc, {
    Map(_, map) {
      const point = map.items.find(pair => isScalar(pair.key) && pair.key.value === "point");
      const within = map.get("within", true);
      if (point && !(isMap(within) && within.has("id"))) out.push(diagnosticAt(loaded, point.key as Node, "point-selector", "point selector: target the element by id (give it a testID if it has none), or anchor the point inside an element with `within: { id }`"));
    },
  });
  return out;
}

/** Validation problems plus the authoring rules the gate enforces. `gate` marks flows the release gate runs (under flows/). */
export function lintFlow(source: string, file: string, { gate }: { gate: boolean }): Diagnostic[] {
  const { loaded, diagnostics } = checkFlow(source, file);
  if (loaded.diagnostics.length) return diagnostics;
  return byPosition([...diagnostics, ...headerRules(loaded, gate), ...pointSelectors(loaded)]);
}

export function lintSubflow(source: string, file: string): Diagnostic[] {
  const { loaded, diagnostics } = checkSubflow(source, file);
  if (loaded.diagnostics.length) return diagnostics;
  return byPosition([...diagnostics, ...pointSelectors(loaded)]);
}

/** Validates (or lints) one e2e file by kind. Flows under flows/ are gate flows. */
export function checkFile(mode: "validate" | "lint", kind: Kind, source: string, file: string): Diagnostic[] {
  if (kind === "registry") return checkRegistry(source, file).diagnostics;
  if (kind === "gate") return checkGate(source, file).diagnostics;
  if (kind === "budgets") return checkBudgets(source, file).diagnostics;
  if (kind === "subflow") return mode === "lint" ? lintSubflow(source, file) : checkSubflow(source, file).diagnostics;
  return mode === "lint" ? lintFlow(source, file, { gate: file.split(path.sep).includes("flows") }) : checkFlow(source, file).diagnostics;
}
