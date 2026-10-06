import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

const matrix = JSON.parse(readFileSync("docs/release-support-matrix.json", "utf8")) as {
  package: string;
  version: string;
  targets: string[];
  entries: Array<{
    path: string;
    sourceTarget: string;
    kind: string;
    scope: string;
    provider: string;
    providerSources: string[];
    platformSourceEvidence: Record<string, string[]>;
    intendedTargets: string[];
    workflowTargets?: string[];
    relatedCatalogCases: string[];
    verification: {
      unitTests: string[];
      portableCommand: string;
      platformAcceptance: Record<string, { status: string; acceptanceCommand?: string; reason?: string; evidenceRef?: string; evidenceClaim?: string }>;
      workflowAcceptance?: Record<string, { status: string; acceptanceCommand: string; evidenceRef?: string; evidenceClaim?: string }>;
    };
  }>;
};

test("release support matrix covers each public export with explicit target status and evidence", () => {
  const { exports } = JSON.parse(readFileSync("packages/desktop/package.json", "utf8")) as { exports: Record<string, string> };
  const catalog = readFileSync("examples/kitchen-sink/contract-report.ts", "utf8");
  const markdown = readFileSync("docs/release-support-matrix.md", "utf8");
  const catalogIds = new Set<string>([...catalog.matchAll(/definition\("([^\"]+)"/g)].map(match => match[1]!));
  for (const id of ["desktop.sqlite", "desktop.webview", "desktop.nitro", "desktop.runtimes"]) catalogIds.add(id);
  expect(matrix.package).toBe("@legendapp/spark");
  expect(matrix.version).toBe(JSON.parse(readFileSync("packages/desktop/package.json", "utf8")).version);
  expect(matrix.entries.map(entry => entry.path).sort()).toEqual(Object.keys(exports).sort());
  expect([...markdown.matchAll(/^\| \[`([^`]+)`\]\(/gm)].map(match => match[1]).sort()).toEqual(Object.keys(exports).sort());
  expect(new Set(matrix.targets)).toEqual(new Set(["macos-arm64", "macos-x64", "windows-x64", "windows-arm64", "ios", "android", "web"]));

  for (const entry of matrix.entries) {
    expect(entry.provider, entry.path).toBeTruthy();
    expect(entry.providerSources.length, entry.path).toBeGreaterThan(0);
    for (const source of entry.providerSources) expect(existsSync(source), `${entry.path} provider source ${source}`).toBe(true);
    for (const platform of ["macos", "windows", "ios", "android", "web"]) {
      expect(Array.isArray(entry.platformSourceEvidence[platform]), `${entry.path} ${platform} source evidence`).toBe(true);
      for (const source of entry.platformSourceEvidence[platform]!) expect(existsSync(source.replace(/\/$/, "")), `${entry.path} platform source ${source}`).toBe(true);
    }
    expect(entry.sourceTarget, entry.path).toBe(exports[entry.path]);
    expect(entry.verification.unitTests.length, entry.path).toBeGreaterThan(0);
    for (const testFile of entry.verification.unitTests) expect(existsSync(testFile), `${entry.path} references ${testFile}`).toBe(true);
    for (const caseId of entry.relatedCatalogCases) expect(catalogIds.has(caseId), `${entry.path} references catalog case ${caseId}`).toBe(true);
    expect(Object.keys(entry.verification.platformAcceptance).sort()).toEqual([...matrix.targets].sort());
    const intended = new Set(entry.intendedTargets);
    if (entry.kind === "tooling") {
      expect(new Set(entry.workflowTargets)).toEqual(new Set(["macos", "windows", "ios", "android", "web"]));
      expect(Object.keys(entry.verification.workflowAcceptance ?? {}).sort()).toEqual([...matrix.targets].sort());
    }
    for (const target of matrix.targets) {
      const platform = target.startsWith("macos-") ? "macos" : target.startsWith("windows-") ? "windows" : target;
      const cell = entry.verification.platformAcceptance[target]!;
      if (intended.has(platform)) {
        expect(["not-tested", "passed", "failed", "blocked", "missing"], `${entry.path} ${target}`).toContain(cell.status);
        expect(cell.acceptanceCommand, `${entry.path} ${target}`).toContain("bun run test:platform");
        if (cell.status !== "not-tested") {
          expect(cell.evidenceRef, `${entry.path} ${target} evidence reference`).toBeTruthy();
          expect(cell.evidenceClaim, `${entry.path} ${target} evidence scope`).toBeTruthy();
          expect(existsSync(cell.evidenceRef!.split("#")[0]!), `${entry.path} ${target} evidence file`).toBe(true);
        }
      } else {
        expect(cell.status, `${entry.path} ${target}`).toBe("not-applicable");
        expect(cell.reason, `${entry.path} ${target}`).toBeTruthy();
      }
      if (entry.kind === "tooling") {
        const workflowCell = entry.verification.workflowAcceptance?.[target];
        expect(["not-tested", "passed", "failed", "blocked", "missing"], `${entry.path} workflow ${target}`).toContain(workflowCell?.status);
        expect(workflowCell?.acceptanceCommand, `${entry.path} workflow ${target}`).toContain("bun run test:platform");
        if (workflowCell?.status !== "not-tested") {
          expect(workflowCell?.evidenceRef, `${entry.path} workflow ${target} evidence reference`).toBeTruthy();
          expect(workflowCell?.evidenceClaim, `${entry.path} workflow ${target} evidence scope`).toBeTruthy();
          expect(existsSync(workflowCell!.evidenceRef!.split("#")[0]!), `${entry.path} workflow ${target} evidence file`).toBe(true);
        }
      }
    }
  }
});
