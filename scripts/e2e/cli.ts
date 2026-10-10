import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readSdkSurface } from "../api-surface.ts";
import { checkCoverage, formatCoverage } from "./coverage.ts";
import { collect, type Kind } from "./files.ts";
import { generatedFiles } from "./format/generate.ts";
import { lintFlow, lintSubflow } from "./format/lint.ts";
import { checkFlow, checkGate, checkRegistry, checkSubflow, formatDiagnostic, type Diagnostic } from "./format/parser.ts";

const repo = path.resolve(import.meta.dirname, "../..");
const LABELS: Record<Kind, [string, string]> = { flow: ["flow", "flows"], subflow: ["subflow", "subflows"], registry: ["check registry", "check registries"], gate: ["gate manifest", "gate manifests"] };

function check(mode: "validate" | "lint", kind: Kind, source: string, file: string): Diagnostic[] {
  if (kind === "registry") return checkRegistry(source, file).diagnostics;
  if (kind === "gate") return checkGate(source, file).diagnostics;
  if (kind === "subflow") return mode === "lint" ? lintSubflow(source, file) : checkSubflow(source, file).diagnostics;
  return mode === "lint" ? lintFlow(source, file, { gate: file.split(path.sep).includes("flows") }) : checkFlow(source, file).diagnostics;
}

/** The e2e files under the given paths (default: the repository's e2e/). Exits 2 when a path does not exist. */
function filesIn(paths: string[]): Array<[string, Kind]> {
  const targets = (paths.length ? paths : [path.join(repo, "e2e")]).map(target => path.resolve(target));
  const missing = targets.filter(target => !existsSync(target));
  if (missing.length) { console.error(`not found: ${missing.join(", ")}`); process.exit(2); }
  return targets.flatMap(collect);
}

const [mode, ...args] = process.argv.slice(2);
if (mode === "schema") {
  for (const [file, content] of Object.entries(generatedFiles())) {
    mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    writeFileSync(path.join(repo, file), content);
    console.log(`wrote ${file}`);
  }
} else if (mode === "coverage") {
  const json = args.includes("--json");
  const files = filesIn(args.filter(arg => arg !== "--json"));
  const report = checkCoverage(files.map(([absolute, kind]) => ({ file: path.relative(process.cwd(), absolute), kind, source: readFileSync(absolute, "utf8") })), readSdkSurface());
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : formatCoverage(report));
  process.exitCode = report.ok ? 0 : 1;
} else if (mode === "validate" || mode === "lint") {
  const files = filesIn(args);
  const counts = new Map<Kind, number>();
  let problems = 0;
  for (const [absolute, kind] of files) {
    const file = path.relative(process.cwd(), absolute);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    for (const diagnostic of check(mode, kind, readFileSync(absolute, "utf8"), file)) { console.log(formatDiagnostic(diagnostic)); problems++; }
  }
  const summary = [...counts].map(([kind, count]) => `${count} ${LABELS[kind][count === 1 ? 0 : 1]}`).join(", ") || "no flows, subflows, check registries or gate manifests";
  console.log(`${mode === "lint" ? "linted" : "validated"} ${files.length} file${files.length === 1 ? "" : "s"} (${summary}): ${problems} problem${problems === 1 ? "" : "s"}`);
  process.exitCode = problems ? 1 : 0;
} else {
  console.error("usage: bun run e2e:validate [paths…] | bun run e2e:lint [paths…] | bun run e2e:coverage [paths…] [--json] | bun run e2e:schema");
  process.exitCode = 2;
}
