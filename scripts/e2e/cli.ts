import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generatedFiles } from "./format/generate.ts";
import { lintFlow, lintSubflow } from "./format/lint.ts";
import { checkFlow, checkGate, checkRegistry, checkSubflow, formatDiagnostic, type Diagnostic } from "./format/parser.ts";

const repo = path.resolve(import.meta.dirname, "../..");
type Kind = "flow" | "subflow" | "registry" | "gate";
const LABELS: Record<Kind, string> = { flow: "flow", subflow: "subflow", registry: "check registry", gate: "gate manifest" };

/** Kind by location: checks/<area>.yaml, gate.yaml, subflows/**, flows/**. Directory scans skip anything else (fixtures, goldens). */
function classify(file: string, explicit: boolean): Kind | undefined {
  const segments = path.relative(process.cwd(), file).split(path.sep);
  if (segments.at(-1) === "gate.yaml") return "gate";
  if (segments.at(-2) === "checks") return "registry";
  if (segments.includes("subflows")) return "subflow";
  if (segments.includes("flows") || explicit) return "flow";
}

function collect(target: string): Array<[string, Kind]> {
  if (!statSync(target).isDirectory()) return [[target, classify(target, true)!]];
  return (readdirSync(target, { recursive: true }) as string[]).filter(entry => /\.ya?ml$/.test(entry)).sort()
    .map(entry => path.join(target, entry)).flatMap(file => { const kind = classify(file, false); return kind ? [[file, kind] as [string, Kind]] : []; });
}

function check(mode: "validate" | "lint", kind: Kind, source: string, file: string): Diagnostic[] {
  if (kind === "registry") return checkRegistry(source, file).diagnostics;
  if (kind === "gate") return checkGate(source, file).diagnostics;
  if (kind === "subflow") return mode === "lint" ? lintSubflow(source, file) : checkSubflow(source, file).diagnostics;
  return mode === "lint" ? lintFlow(source, file, { gate: file.split(path.sep).includes("flows") }) : checkFlow(source, file).diagnostics;
}

const [mode, ...args] = process.argv.slice(2);
if (mode === "schema") {
  for (const [file, content] of Object.entries(generatedFiles())) {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), content);
    console.log(`wrote ${file}`);
  }
} else if (mode === "validate" || mode === "lint") {
  const targets = (args.length ? args : [path.join(repo, "e2e")]).map(target => path.resolve(target));
  const missing = targets.filter(target => !existsSync(target));
  if (missing.length) { console.error(`not found: ${missing.join(", ")}`); process.exit(2); }
  const files = targets.flatMap(collect);
  const counts = new Map<Kind, number>();
  let problems = 0;
  for (const [absolute, kind] of files) {
    const file = path.relative(process.cwd(), absolute);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    for (const diagnostic of check(mode, kind, readFileSync(absolute, "utf8"), file)) { console.log(formatDiagnostic(diagnostic)); problems++; }
  }
  const summary = [...counts].map(([kind, count]) => `${count} ${LABELS[kind]}${count === 1 ? "" : "s"}`).join(", ") || "no flows, subflows, check registries or gate manifests";
  console.log(`${mode === "lint" ? "linted" : "validated"} ${files.length} file${files.length === 1 ? "" : "s"} (${summary}): ${problems} problem${problems === 1 ? "" : "s"}`);
  process.exitCode = problems ? 1 : 0;
} else {
  console.error("usage: bun run e2e:validate [paths…] | bun run e2e:lint [paths…] | bun run e2e:schema");
  process.exitCode = 2;
}
