import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";

// The packaged Spark skill keeps one reference file per public API area. Each file's
// "Exports:" line names the subpaths it covers; every subpath in the public surface
// snapshot must appear in one. ```ts/```tsx samples typecheck against the SDK; a fence
// marked `no-check` (an API not yet on main) is skipped.
const repo = path.resolve(import.meta.dirname, "..");
const skill = path.join(repo, "packages/desktop/skills/spark");
const references = readdirSync(skill).filter(file => file.endsWith(".md") && file !== "SKILL.md" && file !== "UPGRADING.md" && file !== "external-libraries.md");
const read = (file: string) => readFileSync(path.join(skill, file), "utf8");

test("every public export area maps to a skill reference file", () => {
  const surface = Object.keys(JSON.parse(readFileSync(path.join(repo, "docs/api-public-surface.json"), "utf8")));
  const covered = new Set<string>();
  for (const file of references) {
    const line = read(file).split("\n").find(text => text.startsWith("Export"));
    expect(line, `${file} needs an "Exports:" line`).toBeDefined();
    for (const [, subpath] of line!.matchAll(/`(?:@legendapp\/spark)?(\/[a-z/-]+)`/g)) covered.add(`.${subpath}`);
  }
  expect(surface.filter(entry => !covered.has(entry))).toEqual([]);
});

test("SKILL.md indexes every reference file", () => {
  const index = read("SKILL.md");
  expect(references.filter(file => !index.includes(`](${file})`))).toEqual([]);
});

test("the packaged external-libraries table matches docs/external-libraries.md", () => {
  // The packaged copy drops links to repository docs; every row must otherwise match.
  const rows = (text: string) => text.split("\n").filter(line => line.startsWith("| ")).map(line => line.replace(/ See \[[^\]]*\]\([^)]*\.md[^)]*\)\./g, ""));
  expect(rows(read("external-libraries.md"))).toEqual(rows(readFileSync(path.join(repo, "docs/external-libraries.md"), "utf8")));
});

test("skill code samples typecheck against the SDK", () => {
  // A node_modules link lets `@legendapp/spark` resolve through the workspace from a temp directory.
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-skill-samples-"));
  symlinkSync(path.join(repo, "node_modules"), path.join(directory, "node_modules"), "junction");
  const samples: string[] = [];
  for (const file of references) {
    let index = 0;
    for (const [, lang, info, code] of read(file).matchAll(/^```(tsx?)([^\n]*)\n([\s\S]*?)^```/gm)) {
      index++;
      if (info!.includes("no-check")) continue;
      const sample = path.join(directory, `${file.replace(/\.md$/, "")}-${index}.${lang}`);
      writeFileSync(sample, `${code}\nexport {};\n`);
      samples.push(sample);
    }
  }
  const config = ts.readConfigFile(path.join(repo, "tsconfig.json"), ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, repo).options;
  const program = ts.createProgram(samples, { ...options, noUnusedLocals: false });
  const errors = ts.getPreEmitDiagnostics(program).filter(diagnostic => diagnostic.file && samples.includes(path.normalize(diagnostic.file.fileName)));
  const messages = errors.map(diagnostic => {
    const { line } = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start!);
    return `${path.basename(diagnostic.file!.fileName)}:${line + 1} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`;
  });
  rmSync(directory, { recursive: true, force: true });
  expect(messages).toEqual([]);
}, 60_000);
