// API documentation coverage of the public SDK surface (docs/api-public-surface.json): what an editor shows for
// each export, and the docs page for each subpath. tests/api-docs-coverage.test.ts and the gate's api-docs audit use it.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { sdkProgram } from "./api-surface.ts";

const docs = path.resolve(import.meta.dirname, "../docs");
/** Known gaps, drained as they are documented: tests/api-docs-coverage.test.ts keeps it exact. */
export const API_DOCS_GAPS = "docs/api-undocumented.json";

export type ApiDocs = {
  /** Per subpath, the exports without a TSDoc comment on their declaration. */
  undocumented: Record<string, string[]>;
  /** Per subpath, the runtime exports whose type, a parameter or a return type is `any`. */
  untyped: Record<string, string[]>;
  /** Subpaths that no docs/*.md page imports (`@legendapp/spark/<subpath>` in quotes or backticks). */
  pageless: string[];
};

const isAny = (type: ts.Type) => !!(type.flags & ts.TypeFlags.Any);

export function readApiDocs(): ApiDocs {
  const { checker, modules } = sdkProgram();
  const pages = readdirSync(docs, { recursive: true, encoding: "utf8" }).filter(file => file.endsWith(".md")).map(file => readFileSync(path.join(docs, file), "utf8")).join("\n");
  const result: ApiDocs = { undocumented: {}, untyped: {}, pageless: [] };
  const add = (map: Record<string, string[]>, subpath: string, name: string) => (map[subpath] ??= []).push(name);
  for (const { subpath, source, symbols } of [...modules].sort((a, b) => a.subpath.localeCompare(b.subpath))) {
    const specifier = `@legendapp/spark${subpath.slice(1)}`;
    if (![`"${specifier}"`, `'${specifier}'`, `\`${specifier}\``].some(quoted => pages.includes(quoted))) result.pageless.push(subpath);
    for (const { symbol, target } of [...symbols].sort((a, b) => a.symbol.name.localeCompare(b.symbol.name))) {
      if (!ts.displayPartsToString(target.getDocumentationComment(checker)).trim()) add(result.undocumented, subpath, symbol.name);
      if (!(target.flags & ts.SymbolFlags.Value)) continue;
      const type = checker.getTypeOfSymbolAtLocation(target, source);
      const signatures = type.getCallSignatures();
      if (isAny(type) || signatures.some(signature => isAny(signature.getReturnType()) || signature.parameters.some(parameter => isAny(checker.getTypeOfSymbolAtLocation(parameter, source)))))
        add(result.untyped, subpath, symbol.name);
    }
  }
  return result;
}

export const count = (map: Record<string, string[]>) => Object.values(map).reduce((total, names) => total + names.length, 0);
