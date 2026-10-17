// The gate audit steps by the name a check registers with `audit:` (docs/e2e-flows.md#audits).
import type { Audit } from "../format/primitives.ts";
import { auditApiDocs } from "./api-docs.ts";
import { auditBundle, type AuditOptions, type AuditResult } from "./bundle.ts";
import { auditCli } from "./cli.ts";
import { auditDevLoop } from "./dev-loop.ts";
import { auditPackage } from "./package.ts";
import { auditTemplates } from "./templates.ts";

export const AUDIT_STEPS: Readonly<Record<Audit, (options: AuditOptions) => AuditResult[] | Promise<AuditResult[]>>> = {
  bundle: auditBundle, package: options => auditPackage(options), "api-docs": auditApiDocs, cli: auditCli, templates: auditTemplates, "dev-loop": auditDevLoop,
};
