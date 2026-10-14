import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { migrations } from "../packages/cli/src/migrations.cjs";

const notes = readFileSync("packages/desktop/skills/spark/UPGRADING.md", "utf8");
const changelog = readFileSync("CHANGELOG.md", "utf8");

function sections(markdown: string) {
  return [...markdown.matchAll(/^## (\d+\.\d+\.\d+(?:-[\w.]+)?)[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)]
    .map(([, version, body]) => ({ version, body }));
}

test("every changelog release and the package version have packaged upgrade notes", () => {
  const versions = sections(notes).map(note => note.version);
  for (const release of sections(changelog)) expect(versions, release.version).toContain(release.version);
  expect(versions).toContain(JSON.parse(readFileSync("packages/desktop/package.json", "utf8")).version);
  expect(readFileSync("packages/desktop/skills/spark/SKILL.md", "utf8")).toContain("(UPGRADING.md)");
});

test("breaking releases require a note and a marked migration", () => {
  const breaking = new Set([
    ...sections(changelog).filter(release => /\[Breaking\]|BREAKING CHANGE|\b\w+(?:\([^)]*\))?!:/i.test(release.body)).map(release => release.version),
    ...sections(notes).filter(note => /Breaking: yes/.test(note.body)).map(note => note.version),
    ...migrations.filter(step => step.breaking).map(step => step.version),
  ]);
  expect(breaking.size).toBeGreaterThan(0);
  for (const version of breaking) {
    expect(sections(notes).find(note => note.version === version)?.body, version).toMatch(/Breaking: yes/);
    expect(migrations.some(step => step.version === version && step.breaking), version).toBe(true);
  }
  for (const step of migrations) expect(sections(notes).some(note => note.version === step.version), step.version).toBe(true);
});
