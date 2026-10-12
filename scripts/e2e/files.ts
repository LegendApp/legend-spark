import { readdirSync, statSync } from "node:fs";
import path from "node:path";

export type Kind = "flow" | "subflow" | "registry" | "gate" | "budgets";
/** `flows/` holds gate flows (the release gate runs them); `dev-flows/` holds `build: dev` flows, which it cannot. */
export const FLOW_DIRS: readonly string[] = ["flows", "dev-flows"];

/** Kind by location: checks/<area>.yaml, gate.yaml, budgets.yaml, subflows/**, flows/** and dev-flows/**. Directory scans skip anything else (fixtures, goldens). */
function classify(file: string, explicit: boolean): Kind | undefined {
  const segments = path.relative(process.cwd(), file).split(path.sep);
  if (segments.at(-1) === "gate.yaml") return "gate";
  if (segments.at(-1) === "budgets.yaml") return "budgets";
  if (segments.at(-2) === "checks") return "registry";
  if (segments.includes("subflows")) return "subflow";
  if (segments.some(segment => FLOW_DIRS.includes(segment)) || explicit) return "flow";
}

/** The e2e files under a target (or the target itself), sorted, with their kinds. */
export function collect(target: string): Array<[string, Kind]> {
  if (!statSync(target).isDirectory()) return [[target, classify(target, true)!]];
  return (readdirSync(target, { recursive: true }) as string[]).filter(entry => /\.ya?ml$/.test(entry)).sort()
    .map(entry => path.join(target, entry)).flatMap(file => { const kind = classify(file, false); return kind ? [[file, kind] as [string, Kind]] : []; });
}
