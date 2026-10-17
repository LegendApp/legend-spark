// The gate's api-docs audit: API documentation coverage of the public SDK surface (docs/e2e-flows.md#audits, #171).
// The same facts as tests/api-docs-coverage.test.ts, which keeps docs/api-undocumented.json exact; this fails while
// any gap remains.
import { API_DOCS_GAPS, count, readApiDocs } from "../../api-docs.ts";
import type { AuditResult } from "./bundle.ts";

const listed = (map: Record<string, string[]>) => Object.entries(map).map(([subpath, names]) => `${subpath}: ${names.join(", ")}`);

export function auditApiDocs(): AuditResult[] {
  const { undocumented, untyped, pageless } = readApiDocs();
  const result = (check: string, problems: string[], summary: string, passed: string): AuditResult =>
    ({ check, status: problems.length ? "failed" : "passed", details: problems.length ? [summary, ...problems] : [passed] });
  return [
    result("DX-DOCS-01", listed(undocumented), `${count(undocumented)} public exports have no TSDoc comment (listed in ${API_DOCS_GAPS})`, "every public export has a TSDoc comment"),
    result("DX-DOCS-02", listed(untyped), `${count(untyped)} public exports are typed any`, "no public export, parameter or return type is any"),
    result("DX-DOCS-03", pageless, `${pageless.length} public subpaths have no docs page (listed in ${API_DOCS_GAPS})`, "every public subpath has a docs page"),
  ];
}
