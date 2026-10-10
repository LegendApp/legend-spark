// Run reports: report.json (the gate and dashboards read it), junit.xml and a static index.html.
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Artifact, Backend, Platform } from "./backend.ts";
import type { FailureReport, FlowResult } from "./executor.ts";

export type RunReport = {
  version: 1;
  startedAt: string;
  durationMs: number;
  platform: Platform;
  backends: Array<{ name: string; kind: Backend["kind"] }>;
  interrupted: boolean;
  summary: { total: number; passed: number; failed: number; skipped: number };
  /** Artifact paths are relative to the run directory (the directory holding report.json). */
  flows: FlowResult[];
};

export function buildReport(results: FlowResult[], meta: { startedAt: Date; durationMs: number; backends: Backend[]; runDir: string; interrupted: boolean }): RunReport {
  const relative = (artifacts: Artifact[]) => artifacts.map(artifact => ({ ...artifact, path: path.relative(meta.runDir, artifact.path) }));
  const count = (status: FlowResult["status"]) => results.filter(result => result.status === status).length;
  return {
    version: 1, startedAt: meta.startedAt.toISOString(), durationMs: Math.round(meta.durationMs), platform: meta.backends[0]!.platform,
    backends: meta.backends.map(({ name, kind }) => ({ name, kind })), interrupted: meta.interrupted,
    summary: { total: results.length, passed: count("passed"), failed: count("failed"), skipped: count("skipped") },
    flows: results.map(result => ({
      ...result, artifacts: relative(result.artifacts),
      ...(result.failure ? { failure: { ...result.failure, artifacts: relative(result.failure.artifacts) } } : {}),
    })),
  };
}

const at = (failure: FailureReport) => `${failure.location.file}:${failure.location.line}:${failure.location.column}`;
const label = (flow: FlowResult) => flow.name ? `${flow.name}${Object.keys(flow.matrix).length ? ` [${flow.id.slice(flow.id.indexOf("[") + 1, -1)}]` : ""}` : flow.id;

/** The failure as plain text: location, message, call sites, candidates, artifacts. Shared by JUnit and the console. */
export function failureText(failure: FailureReport, artifactPath = (artifact: Artifact) => artifact.path): string {
  return [
    `${at(failure)}: ${failure.command ? `${failure.command}: ` : ""}${failure.message} [${failure.kind}]`,
    ...(failure.diagnostics ?? []),
    ...failure.stack.map(location => `  called from ${location.file}:${location.line}:${location.column}`),
    ...(failure.matches.length ? ["matches:", ...failure.matches.map(match => `  ${JSON.stringify(match)}`)] : []),
    ...(failure.candidates.length ? ["nearby candidates:", ...failure.candidates.map(candidate => `  ${JSON.stringify(candidate)}`)] : []),
    ...failure.artifacts.map(artifact => `artifact ${artifact.kind}${artifact.backend ? ` (${artifact.backend})` : ""}: ${artifactPath(artifact)}`),
  ].join("\n");
}

const escape = (text: string) => text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/[<>&"]/g, char => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[char]!);
const seconds = (ms: number) => (ms / 1000).toFixed(3);

export function junit(report: RunReport): string {
  const files = [...new Set(report.flows.map(flow => flow.file))];
  const suites = files.map(file => {
    const flows = report.flows.filter(flow => flow.file === file);
    const cases = flows.map(flow => {
      const body = flow.status === "skipped" ? `<skipped message="${escape(flow.skipReason ?? "")}"/>`
        : flow.failure ? `<failure type="${flow.failure.kind}" message="${escape(flow.failure.message.split("\n")[0]!)}">${escape(failureText(flow.failure))}</failure>` : "";
      const out = [...flow.errors, ...flow.artifacts.map(artifact => `artifact ${artifact.kind}: ${artifact.path}`)];
      return `    <testcase classname="${escape(file)}" name="${escape(label(flow))}" time="${seconds(flow.durationMs)}">${body}${out.length ? `<system-out>${escape(out.join("\n"))}</system-out>` : ""}</testcase>`;
    });
    const n = (status: FlowResult["status"]) => flows.filter(flow => flow.status === status).length;
    return `  <testsuite name="${escape(file)}" tests="${flows.length}" failures="${n("failed")}" skipped="${n("skipped")}" time="${seconds(flows.reduce((sum, flow) => sum + flow.durationMs, 0))}">\n${cases.join("\n")}\n  </testsuite>`;
  });
  const { summary } = report;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="e2e" tests="${summary.total}" failures="${summary.failed}" skipped="${summary.skipped}" time="${seconds(report.durationMs)}">\n${suites.join("\n")}\n</testsuites>\n`;
}

export function html(report: RunReport): string {
  const link = (artifact: Artifact) => {
    const href = escape(artifact.path.split(path.sep).map(encodeURIComponent).join("/"));
    const name = `${artifact.kind}${artifact.backend ? ` (${artifact.backend})` : ""}: ${escape(artifact.path)}`;
    return artifact.kind === "screenshot" ? `<figure><a href="${href}"><img src="${href}" alt="${name}"></a><figcaption>${name}</figcaption></figure>` : `<li><a href="${href}">${name}</a></li>`;
  };
  const flows = report.flows.map(flow => {
    const failure = flow.failure;
    const steps = flow.steps.map(step => `<li class="${step.status}" style="margin-left:${step.depth * 1.5}em">${step.command} <span>${step.location.file}:${step.location.line} · ${step.status} · ${step.durationMs}ms</span></li>`).join("");
    const artifacts = [...failure?.artifacts ?? [], ...flow.artifacts];
    return `<details class="${flow.status}"${flow.status === "failed" ? " open" : ""}><summary><b>${flow.status.toUpperCase()}</b> ${escape(label(flow))} <span>${escape(flow.file)} · ${flow.durationMs}ms</span></summary>
${flow.intent ? `<p>${escape(flow.intent)}</p>` : ""}${flow.skipReason ? `<p>Skipped: ${escape(flow.skipReason)}</p>` : ""}
${failure ? `<pre>${escape(failureText(failure, artifact => artifact.path))}</pre>` : ""}${flow.errors.length ? `<pre>${escape(flow.errors.join("\n"))}</pre>` : ""}
${artifacts.length ? `<ul class="artifacts">${artifacts.map(link).join("")}</ul>` : ""}${steps ? `<ol class="steps">${steps}</ol>` : ""}</details>`;
  }).join("\n");
  const { summary } = report;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>E2E run ${escape(report.startedAt)}</title>
<style>
body{font:14px/1.45 -apple-system,system-ui,sans-serif;margin:2em;color:#1d1d1f;background:#fff}
@media (prefers-color-scheme:dark){body{color:#f5f5f7;background:#1d1d1f}pre{background:#2c2c2e!important}}
details{border-left:4px solid #8e8e93;padding:.25em .75em;margin:.5em 0}details.passed{border-color:#34c759}details.failed{border-color:#ff3b30}
summary{cursor:pointer}summary span,.steps span{opacity:.6;font-size:12px}pre{background:#f2f2f7;padding:.75em;overflow:auto;white-space:pre-wrap}
.steps{font-family:ui-monospace,monospace;font-size:12px}.steps .failed{color:#ff3b30}.steps .skipped{opacity:.5}
.artifacts{list-style:none;padding:0}figure{margin:.5em 0}img{max-width:min(100%,900px);border:1px solid #8e8e93}
</style></head><body>
<h1>E2E run</h1>
<p>${escape(report.startedAt)} · ${report.platform} · backends ${report.backends.map(backend => `${escape(backend.name)} (${backend.kind})`).join(", ")} · ${report.durationMs}ms${report.interrupted ? " · <b>interrupted</b>" : ""}</p>
<p><b>${summary.passed}</b> passed · <b>${summary.failed}</b> failed · <b>${summary.skipped}</b> skipped · ${summary.total} total</p>
${flows}
</body></html>
`;
}

/** Writes report.json, junit.xml and index.html into the run directory and returns their paths. */
export function writeReports(report: RunReport, runDir: string) {
  const files = { json: path.join(runDir, "report.json"), junit: path.join(runDir, "junit.xml"), html: path.join(runDir, "index.html") };
  writeFileSync(files.json, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(files.junit, junit(report));
  writeFileSync(files.html, html(report));
  return files;
}
