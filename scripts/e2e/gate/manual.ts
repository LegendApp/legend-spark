// What the gate needs for manual sign-offs (docs/e2e-flows.md#manual-sign-offs): a flow's content hash, and the manual steps
// of `manual: true` flows, which never run.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkSubflow, formatDiagnostic, type FlowAst, type FlowCommand, type SourceLocation } from "../format/parser.ts";
import type { ManualStep } from "../format/signoff.ts";
import type { Matrix, Platform } from "../runner/backend.ts";
import { runFlowTarget } from "../runner/executor.ts";

/** SHA-256 of a flow file's content. A sign-off names it, so editing the flow makes its sign-offs stale. */
export const flowHash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

export const at = (location: SourceLocation) => `${location.file}:${location.line}:${location.column}`;

/** A manualStep's arguments as the sign-off contract has them. */
export function manualStep(args: Record<string, unknown>, location: string): ManualStep {
  return {
    instruction: String(args.instruction), expect: String(args.expect), location,
    evidence: (args.evidence as ManualStep["evidence"] | undefined) ?? "none", signoff: (args.signoff as ManualStep["signoff"] | undefined) ?? "required",
  };
}

/**
 * The manualSteps a `manual: true` flow run would reach, for one matrix combination on one platform: nested commands and
 * runFlow files are followed; `when` platform and matrix conditions apply. Visibility conditions cannot be decided without
 * running, so those steps are listed. `${VAR}` stays literal. Throws when a runFlow file cannot be read or is invalid.
 */
export function plannedManualSteps(flow: FlowAst, file: string, matrix: Matrix, platform: Platform): ManualStep[] {
  const steps: ManualStep[] = [];
  const walk = (commands: FlowCommand[], caller: string, files: string[]) => {
    for (const command of commands) {
      const when = command.when;
      if (when?.platform && when.platform !== platform) continue;
      if (when?.matrix && Object.entries(when.matrix).some(([dimension, value]) => matrix[dimension] !== value)) continue;
      if (command.name === "manualStep") steps.push(manualStep(command.args, at(command.location)));
      if (command.name === "runFlow" && typeof command.args.file === "string") {
        const target = runFlowTarget(command.args.file, caller, file);
        if (files.includes(target)) throw new Error(`${at(command.location)}: runFlow cycle through ${path.relative(process.cwd(), target)}`);
        let source: string;
        try { source = readFileSync(target, "utf8"); } catch (error) { throw new Error(`${at(command.location)}: runFlow cannot read ${command.args.file}: ${(error as Error).message}`); }
        const checked = checkSubflow(source, path.relative(process.cwd(), target));
        if (!checked.value) throw new Error(`${at(command.location)}: runFlow ${command.args.file} is not a valid subflow:\n${checked.diagnostics.map(formatDiagnostic).join("\n")}`);
        walk(checked.value, target, [...files, target]);
      }
      for (const value of Object.values(command.args)) {
        if (Array.isArray(value) && value.every(item => item && typeof item === "object" && "location" in item)) walk(value as FlowCommand[], caller, files);
        else if (value && typeof value === "object" && "location" in value && "name" in value) walk([value as FlowCommand], caller, files);
      }
    }
  };
  walk([...flow.header.onFlowStart ?? [], ...flow.commands, ...flow.header.onFlowComplete ?? []], file, [file]);
  return steps;
}
