// What the gate needs for manual sign-offs (docs/e2e-flows.md#manual-sign-offs): a flow's content hash, and the manual steps
// of `manual: true` flows, which never run.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkSubflow, formatDiagnostic, type FlowAst, type FlowCommand, type SourceLocation } from "../format/parser.ts";
import type { ManualStep } from "../format/signoff.ts";
import type { Matrix, Platform } from "../runner/backend.ts";
import { runFlowTarget } from "../runner/executor.ts";

export const at = (location: SourceLocation) => `${location.file}:${location.line}:${location.column}`;

/** A manualStep's arguments as the sign-off contract has them. */
export function manualStep(args: Record<string, unknown>, location: string): ManualStep {
  const screenshot = args.screenshot as string | undefined;
  return {
    instruction: String(args.instruction), expect: String(args.expect), location,
    evidence: (args.evidence as ManualStep["evidence"] | undefined) ?? (screenshot ? "screenshot" : "none"), signoff: (args.signoff as ManualStep["signoff"] | undefined) ?? "required",
  };
}

/**
 * Calls `visit` for every command a flow can reach, in order: hooks, nested commands and runFlow files (read and checked,
 * each file once per path). With `only`, commands whose `when` platform or matrix condition does not hold are left out,
 * with what they contain. Throws when a runFlow file cannot be read or is invalid.
 */
function reach(flow: FlowAst, file: string, visit: (command: FlowCommand, source?: { file: string; text: string }) => void, only?: { matrix: Matrix; platform: Platform }) {
  const walk = (commands: FlowCommand[], caller: string, files: string[]) => {
    for (const command of commands) {
      const when = command.when;
      if (only && when?.platform && when.platform !== only.platform) continue;
      if (only && when?.matrix && Object.entries(when.matrix).some(([dimension, value]) => only.matrix[dimension] !== value)) continue;
      visit(command);
      if (command.name === "runFlow" && typeof command.args.file === "string") {
        const target = runFlowTarget(command.args.file, caller, file);
        if (files.includes(target)) throw new Error(`${at(command.location)}: runFlow cycle through ${path.relative(process.cwd(), target)}`);
        let text: string;
        try { text = readFileSync(target, "utf8"); } catch (error) { throw new Error(`${at(command.location)}: runFlow cannot read ${command.args.file}: ${(error as Error).message}`); }
        const checked = checkSubflow(text, path.relative(process.cwd(), target));
        if (!checked.value) throw new Error(`${at(command.location)}: runFlow ${command.args.file} is not a valid subflow:\n${checked.diagnostics.map(formatDiagnostic).join("\n")}`);
        visit(command, { file: target, text });
        walk(checked.value, target, [...files, target]);
      }
      for (const value of Object.values(command.args)) {
        if (Array.isArray(value) && value.every(item => item && typeof item === "object" && "location" in item)) walk(value as FlowCommand[], caller, files);
        else if (value && typeof value === "object" && "location" in value && "name" in value) walk([value as FlowCommand], caller, files);
      }
    }
  };
  walk([...flow.header.onFlowStart ?? [], ...flow.commands, ...flow.header.onFlowComplete ?? []], file, [file]);
}

/**
 * SHA-256 of a flow's content: its file and every runFlow file it can reach, whatever their conditions. A sign-off names
 * it, so editing the flow or a subflow it runs makes its sign-offs stale. Throws when a runFlow file cannot be read.
 */
export function flowHash(flow: FlowAst, file: string): string {
  const hash = createHash("sha256").update(readFileSync(file)), seen = new Set<string>();
  reach(flow, file, (_command, source) => {
    if (!source || seen.has(source.file)) return;
    seen.add(source.file);
    hash.update(`\0${path.relative(path.dirname(file), source.file)}\0`).update(source.text);
  });
  return hash.digest("hex");
}

/**
 * The manualSteps a `manual: true` flow run would reach, for one matrix combination on one platform: nested commands and
 * runFlow files are followed; `when` platform and matrix conditions apply. Visibility conditions cannot be decided without
 * running, so those steps are listed. `${VAR}` stays literal. Throws when a runFlow file cannot be read or is invalid.
 */
export function plannedManualSteps(flow: FlowAst, file: string, matrix: Matrix, platform: Platform): ManualStep[] {
  const steps: ManualStep[] = [];
  reach(flow, file, (command, source) => { if (!source && command.name === "manualStep") steps.push(manualStep(command.args, at(command.location))); }, { matrix, platform });
  return steps;
}
