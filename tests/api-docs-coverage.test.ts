import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { API_DOCS_GAPS, readApiDocs } from "../scripts/api-docs.ts";

// Every public export needs a TSDoc comment (what an editor shows), a type other than `any`, and its subpath a docs
// page. docs/api-undocumented.json lists the known gaps: a new undocumented export or page-less subpath fails here,
// and so does a listed one that is now documented, so the list only shrinks. The gate's api-docs audit (DX-DOCS-01,
// DX-DOCS-03) fails while the list is not empty.
const docs = readApiDocs();
const gaps = JSON.parse(readFileSync(API_DOCS_GAPS, "utf8")) as { pageless: string[]; undocumented: Record<string, string[]> };
const entries = (map: Record<string, string[]>) => Object.entries(map).flatMap(([subpath, names]) => names.map(name => `${subpath}#${name}`));

test("no public export is typed any", () => {
  expect(entries(docs.untyped)).toEqual([]);
}, 20_000);

test("every public export has a TSDoc comment, apart from the known gaps", () => {
  const listed = new Set(entries(gaps.undocumented)), found = entries(docs.undocumented);
  expect(found.filter(entry => !listed.has(entry)), "document these exports (a /** … */ comment on the declaration)").toEqual([]);
  expect([...listed].filter(entry => !found.includes(entry)), `now documented: remove them from ${API_DOCS_GAPS}`).toEqual([]);
});

test("every public subpath has a docs page, apart from the known gaps", () => {
  expect(docs.pageless.filter(subpath => !gaps.pageless.includes(subpath)), "add a docs/*.md page that imports these subpaths").toEqual([]);
  expect(gaps.pageless.filter(subpath => !docs.pageless.includes(subpath)), `now documented: remove them from ${API_DOCS_GAPS}`).toEqual([]);
});
