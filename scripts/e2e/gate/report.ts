// The gate report (JSON + HTML) and the console text for `bun run gate` and `--dry-run`.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { escape } from "../runner/report.ts";
import type { GateReport } from "./gate.ts";
import type { GatePlan, Reason } from "./plan.ts";

const flowKind = (manual: boolean | "partial") => manual === true ? "manual" : manual === "partial" ? "run + sign-off" : "run";

/** What `--dry-run` prints: the target, the checks, the flows and the budgets this run would use. */
export function planText(plan: GatePlan, backends: string[]): string {
  const { manifest, target, machine } = plan;
  const lines = [
    `Gate plan: ${manifest.suite} (${manifest.appId})`,
    `Target: ${target?.id ?? "none"} (this machine: ${plan.host.os}/${plan.host.arch}${plan.host.model ? `, ${plan.host.model}, ${plan.host.memoryGB} GB` : ""})`,
    `Build: ${plan.artifact ? path.relative(plan.repo, plan.artifact) : "none"}${target && manifest.build[target.platform]?.verifySignature ? " (signature will be verified)" : ""}`,
    `Backends: ${backends.join(", ") || `none for ${target?.platform ?? "this target"}: the gate will fail`}`,
    "Checks:",
    "  lint: every file under e2e/",
    `  coverage: registries in ${manifest.coverage.checks}, every gate flow; required: ${[manifest.coverage.exports && "subpaths and exports", manifest.coverage.availability && "availability flags"].filter(Boolean).join(", ") || "none"}`,
    `  retries: ${manifest.retries}; whole-run time budget: ${manifest.timeBudget}`,
    `  sign-offs: ${manifest.signoffs}`,
    `  report: ${manifest.report.json}, ${manifest.report.html}`,
    `Flows for ${target?.id ?? "no target"}: ${plan.flows.length}`,
    ...plan.flows.map(flow => `  ${flowKind(flow.manual).padEnd(15)}${(flow.blocking ? "blocking" : "non-blocking").padEnd(14)}${flow.path}${flow.ids.length > 1 ? ` (${flow.ids.length} matrix runs)` : ""}`),
    ...(plan.excluded.length ? [`Not for this target: ${plan.excluded.length}`, ...plan.excluded.map(flow => `  ${flow.path} (${flow.reason})`)] : []),
    machine ? `Budgets on ${machine.id} (${machine.name}): ${plan.budgets.length}` : "Budgets: none (this target has no reference machine)",
    ...plan.budgets.map(budget => `  ${budget.metric.padEnd(24)}${budget.better} is better, tolerance ${budget.tolerance}, baseline ${budget.baseline}${budget.baseline === "not-measured" && budget.blocking !== false ? " (fails until measured)" : ""}${budget.blocking === false ? " (non-blocking)" : ""}`),
    ...(plan.problems.length ? ["Problems found while planning:", ...plan.problems.map(reason => `  [${reason.check}] ${reason.message.replace(/\n/g, "\n    ")}`)] : []),
  ];
  return lines.join("\n");
}

export const reasonText = (reason: Reason) => `[${reason.check}] ${reason.message}`;

export function verdictText(report: GateReport, files: { json: string; html: string }): string {
  return [
    ...report.warnings.map(warning => `warning: ${warning}`),
    ...report.reasons.map(reasonText),
    `Gate ${report.verdict} on ${report.target ?? "no target"}: ${report.reasons.length} reason${report.reasons.length === 1 ? "" : "s"}. Report: ${path.relative(process.cwd(), files.html)}`,
  ].join("\n");
}

function html(report: GateReport, runIndex: string | undefined): string {
  const table = (head: string[], rows: string[][]) => rows.length
    ? `<table><tr>${head.map(cell => `<th>${cell}</th>`).join("")}</tr>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")}</table>` : "<p>None.</p>";
  const pre = (text: string) => `<pre>${escape(text)}</pre>`;
  const runLink = runIndex ? `<a href="${escape(runIndex.split(path.sep).map(encodeURIComponent).join("/"))}">run report</a>` : "no flows ran";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Release gate ${report.verdict}: ${escape(report.target ?? "no target")}</title>
<style>
body{font:14px/1.45 -apple-system,system-ui,sans-serif;margin:2em;color:#1d1d1f;background:#fff}
@media (prefers-color-scheme:dark){body{color:#f5f5f7;background:#1d1d1f}pre{background:#2c2c2e!important}}
.verdict{font-size:28px;font-weight:700}.PASS{color:#34c759}.FAIL{color:#ff3b30}
pre{background:#f2f2f7;padding:.75em;overflow:auto;white-space:pre-wrap}table{border-collapse:collapse}td,th{padding:.25em .75em;text-align:left;border-bottom:1px solid #8e8e9355}
</style></head><body>
<h1>Release gate: <span class="verdict ${report.verdict}">${report.verdict}</span></h1>
<p>${escape(report.suite)} · ${escape(report.appId)} · target <b>${escape(report.target ?? "none")}</b>${report.machine ? ` on ${escape(report.machine)}` : ""} · commit ${escape(report.commit)}${report.dirty ? " (uncommitted changes)" : ""} · ${escape(report.startedAt)} · ${report.durationMs}ms of ${report.timeBudgetMs}ms</p>
<p>Build ${escape(report.build.artifact ?? "none")} · ${report.build.exists ? "present" : "missing"} · signature ${report.build.signature} · backends ${escape(report.backends.join(", ") || "none")} · ${runLink}</p>
<h2>Reasons (${report.reasons.length})</h2>
${report.reasons.length ? report.reasons.map(reason => `<h3>${escape(reason.check)}</h3>${pre(reason.message)}`).join("\n") : "<p>None.</p>"}
${report.warnings.length ? `<h2>Warnings (${report.warnings.length})</h2>${pre(report.warnings.join("\n"))}` : ""}
<h2>Coverage</h2>
<p>${report.coverage ? `${report.coverage.covered} of ${report.coverage.required} required items covered; ${report.coverage.problems} problems` : "not run"}</p>
<h2>Flows (${report.flows.length})</h2>
${table(["Run", "Kind", "Blocking", "Status", "Time", "Failure or sign-off"], report.flows.map(flow => [
    escape(flow.id), flowKind(flow.manual), flow.blocking ? "yes" : "no", `<b>${flow.status}</b>`, flow.durationMs === undefined ? "" : `${flow.durationMs}ms`,
    escape(flow.failure ?? (flow.signoff ? `${flow.signoff.verdict} by ${flow.signoff.by}, ${flow.signoff.at}` : "")),
  ]))}
${report.excluded.length ? `<h2>Not for this target (${report.excluded.length})</h2>${table(["Flow", "Why"], report.excluded.map(flow => [escape(flow.path), escape(flow.reason)]))}` : ""}
<h2>Budgets${report.machine ? ` on ${escape(report.machine)}` : ""}</h2>
${table(["Metric", "Run", "Value", "Baseline", "Limit", "Blocking", "Status"], report.budgets.map(budget => [
    escape(budget.metric), escape(budget.flow ?? ""), String(budget.value ?? ""), String(budget.baseline), budget.limit === undefined ? "" : String(budget.limit), budget.blocking ? "yes" : "no", `<b>${budget.status}</b>`,
  ]))}
</body></html>
`;
}

/** Writes report.json and the HTML page at the manifest's paths (absolute here). `repo` resolves the report's relative paths. */
export function writeGateReport(report: GateReport, files: { json: string; html: string }, repo: string) {
  for (const file of Object.values(files)) mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(files.json, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(files.html, html(report, report.run && path.relative(path.dirname(files.html), path.join(repo, report.run, "index.html"))));
}
