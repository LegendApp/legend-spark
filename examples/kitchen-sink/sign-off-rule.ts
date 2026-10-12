// The note rule of a manual sign-off (docs/e2e-flows.md#manual-sign-offs), shared by the Kitchen Sink checklist and
// `bun run gate:signoff`, which checks the decisions again. It lives in the app because Metro bundles only the app's files.
import type { Signoff, SignoffItem } from "../../scripts/e2e/format/signoff";

/** Why a decision cannot be recorded. */
export type SignOffProblem = "not-ready" | "fail-needs-note" | "evidence-needs-note";

/**
 * A failed sign-off needs a note saying what was wrong. A pass needs evidence for every step: the screenshot the step
 * names, or a note saying what the person saw (a `manual: true` flow never runs, so it has none). The checklist and
 * `bun run gate:signoff` both apply it.
 */
export function signOffProblem(item: Pick<SignoffItem, "ready" | "steps">, verdict: Signoff["verdict"], note: string | undefined): SignOffProblem | undefined {
  if (!item.ready) return "not-ready";
  if (note?.trim()) return undefined;
  if (verdict === "fail") return "fail-needs-note";
  if (item.steps.some(step => !step.screenshot)) return "evidence-needs-note";
}
