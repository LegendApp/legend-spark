import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export function buildCLI(root = path.resolve(import.meta.dirname, "..")) {
  const source = path.join(root, "packages/cli/src");
  const output = path.join(root, "packages/cli/dist");
  // Running development sessions load helpers from dist after startup. Never
  // remove the directory while another app may be starting a Metro process.
  const generated = new Set();
  function write(relative, content) {
    const destination = path.join(output, relative);
    generated.add(relative);
    const data = Buffer.from(content);
    if (existsSync(destination) && readFileSync(destination).equals(data)) return;
    const temporary = `${destination}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, data);
      renameSync(temporary, destination);
    } finally { rmSync(temporary, { force: true }); }
  }
  function visit(relative) {
    const directory = path.join(source, relative);
    mkdirSync(path.join(output, relative), { recursive: true });
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) visit(name);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        const result = ts.transpileModule(readFileSync(path.join(source, name), "utf8"), {
          fileName: name,
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, rewriteRelativeImportExtensions: true, verbatimModuleSyntax: true },
          reportDiagnostics: true,
        });
        const errors = result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) ?? [];
        if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, { getCanonicalFileName: f => f, getCurrentDirectory: () => root, getNewLine: () => "\n" }));
        write(name.replace(/\.ts$/, ".js"), result.outputText);
      } else write(name, readFileSync(path.join(source, name)));
    }
  }
  visit("");
  for (const entry of readdirSync(output, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name.endsWith(".tmp")) continue;
    const relative = path.relative(output, path.join(entry.parentPath, entry.name));
    if (!generated.has(relative)) rmSync(path.join(output, relative), { force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildCLI();
