import { overridePackageName } from "./package-manager.ts";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { supportedPlatforms } from "@legendapp/spark-desktop-config/config.cjs";

const packages = ["react", "react-native", "react-native-macos", "expo"] as const;
// create/refreshLocalPackages use this starter's tested compatibility matrix too.
const defaults = JSON.parse(readFileSync(new URL("../templates/blank-typescript/package.json", import.meta.url), "utf8"));
export const expectedDependencyPins: Record<string, string> = Object.fromEntries(packages.map(name => [name, defaults.dependencies[name]]));

export interface DependencyPinIssue {
  package: string;
  found: string;
  expected: string;
  where: string[];
  missing?: boolean;
}

export function dependencyPinIssues(pkg: any, platforms: readonly string[], expected = expectedDependencyPins): DependencyPinIssue[] {
  const required = [...packages, ...(expected["@legendapp/spark"] ? ["@legendapp/spark"] : [])].filter(name => name !== "react-native-macos" || platforms.includes("macos"));
  const checked = Object.keys(expected).filter(name => name !== "react-native-macos" || platforms.includes("macos"));
  const issues: DependencyPinIssue[] = [];
  function check(name: string, value: unknown, where: string[]) {
    // npm and pnpm permit an override to reference a direct dependency's spec.
    const resolved = ["overrides", "pnpm"].includes(where[0]) && typeof value === "string" && value.startsWith("$")
      ? pkg.dependencies?.[value.slice(1)] ?? pkg.devDependencies?.[value.slice(1)] : value;
    if (typeof resolved === "string" && /^(catalog|workspace):/.test(resolved)) {
      console.log(`Skipping dependency pin check for ${where.join(" → ")}: ${resolved} is managed by the catalog or workspace.`);
      return;
    }
    if (resolved !== expected[name]) issues.push({ package: name, found: typeof value === "string" ? value : JSON.stringify(value), expected: expected[name], where });
  }
  for (const name of checked) {
    let present = false;
    for (const section of ["dependencies", "devDependencies"]) {
      if (Object.hasOwn(pkg[section] ?? {}, name)) {
        present = true;
        check(name, pkg[section][name], [section, name]);
      }
    }
    if (!present && required.includes(name)) issues.push({ package: name, found: "(missing)", expected: expected[name], where: ["dependencies", name], missing: true });
  }
  function overrides(entries: any, where: string[], parent?: string) {
    for (const [selector, value] of Object.entries(entries ?? {})) {
      const name = selector === "." ? parent : overridePackageName(selector, checked);
      const location = [...where, selector];
      if (value && typeof value === "object" && !Array.isArray(value)) overrides(value, location, name);
      else if (name) check(name, value, location);
    }
  }
  overrides(pkg.overrides, ["overrides"]);
  overrides(pkg.resolutions, ["resolutions"]);
  overrides(pkg.pnpm?.overrides, ["pnpm", "overrides"]);
  return issues;
}

export function printDependencyPins(issues: DependencyPinIssue[]) {
  if (!issues.length) {
    console.log("Dependency pins match Spark's expected versions.");
    return;
  }
  const rows = [["Package", "Found", "Expected", "Where"], ...issues.map(issue => [issue.package, issue.found, issue.expected, issue.where.join(" → ")])];
  const widths = rows[0].map((_, column) => Math.max(...rows.map(row => row[column].length)));
  for (const row of rows) console.log(row.map((value, column) => value.padEnd(widths[column])).join("  ").trimEnd());
}

/** Edit only mismatched values and insert missing pins, preserving existing formatting. */
export function upgradeDependencyPins(root: string, dryRun = false, expected = expectedDependencyPins, requiredOverrides?: { where: string[]; pins: Record<string, string> }): DependencyPinIssue[] {
  const file = path.join(root, "package.json");
  let source = readFileSync(file, "utf8");
  const pkg = JSON.parse(source);
  const parsed = ts.parseJsonText(file, source);
  const object = (parsed.statements[0] as ts.ExpressionStatement).expression as ts.ObjectLiteralExpression;
  function property(object: ts.ObjectLiteralExpression, key: string) {
    return object.properties.find(p => ts.isPropertyAssignment(p) && ts.isStringLiteral(p.name) && p.name.text === key) as ts.PropertyAssignment | undefined;
  }
  function rejectDuplicates(node: ts.Expression | undefined, where: string[], nested = true) {
    if (!node || !ts.isObjectLiteralExpression(node)) return;
    const keys = new Set<string>();
    for (const entry of node.properties) {
      if (!ts.isPropertyAssignment(entry) || !ts.isStringLiteral(entry.name)) continue;
      const key = entry.name.text;
      if (keys.has(key)) throw new Error(`package.json has duplicate key ${JSON.stringify(key)} in ${where.join(" → ") || "root"}. No files were changed.`);
      keys.add(key);
      if (nested) rejectDuplicates(entry.initializer, [...where, key]);
    }
  }
  rejectDuplicates(object, [], false);
  for (const section of ["dependencies", "devDependencies", "overrides", "resolutions"]) rejectDuplicates(property(object, section)?.initializer, [section]);
  const pnpm = property(object, "pnpm")?.initializer;
  rejectDuplicates(pnpm, ["pnpm"], false);
  if (pnpm && ts.isObjectLiteralExpression(pnpm)) rejectDuplicates(property(pnpm, "overrides")?.initializer, ["pnpm", "overrides"]);
  const issues = dependencyPinIssues(pkg, supportedPlatforms(root), expected);
  if (requiredOverrides) {
    let entries = pkg;
    for (const key of requiredOverrides.where) entries = entries?.[key];
    for (const [name, version] of Object.entries(requiredOverrides.pins)) {
      if (!Object.hasOwn(entries ?? {}, name)) issues.push({ package: name, found: "(missing)", expected: version, where: [...requiredOverrides.where, name], missing: true });
    }
  }
  if (!issues.length) return issues;
  const edits: { start: number; end: number; text: string }[] = [];
  const missing = issues.filter(issue => issue.missing);
  if (missing.length) {
    const indent = source.match(/^[\t ]+(?=")/m)?.[0] ?? "  ";
    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    const additions: any = {};
    for (const issue of missing) {
      let entries = additions;
      for (const key of issue.where.slice(0, -1)) entries = entries[key] ??= {};
      entries[issue.where.at(-1)!] = issue.expected;
    }
    function insert(target: ts.ObjectLiteralExpression, additions: any, where: string[]) {
      const entries: string[] = [];
      for (const [key, value] of Object.entries(additions)) {
        const existing = property(target, key)?.initializer;
        if (existing) {
          if (!ts.isObjectLiteralExpression(existing)) throw new Error(`package.json ${[...where, key].join(" → ")} must be an object. No files were changed.`);
          insert(existing, value, [...where, key]);
        } else entries.push(`${JSON.stringify(key)}: ${JSON.stringify(value, null, indent)}`);
      }
      if (!entries.length) return;
      const last = target.properties.at(-1);
      const baseIndent = source.slice(0, target.getStart(parsed)).match(/(?:^|\n)([\t ]*)[^\n]*$/)![1];
      const multiline = !last || source.slice(target.getStart(parsed), target.end).includes("\n");
      const separator = multiline ? newline + baseIndent + indent : " ";
      const text = entries.map(entry => entry.replaceAll("\n", newline + baseIndent + indent)).join("," + separator);
      edits.push(last ? { start: last.end, end: last.end, text: "," + separator + text }
        : { start: target.getStart(parsed) + 1, end: target.end - 1, text: separator + text + newline + baseIndent });
    }
    insert(object, additions, []);
  }
  for (const issue of issues) {
    if (issue.missing) continue;
    // Fixing the referenced direct dependency also fixes npm/pnpm's $ref override.
    if (["overrides", "pnpm"].includes(issue.where[0]) && issue.found.startsWith("$") && issues.some(direct => ["dependencies", "devDependencies"].includes(direct.where[0]) && direct.package === issue.found.slice(1) && direct.expected === issue.expected)) continue;
    let node: ts.Expression = object;
    for (const key of issue.where) node = property(node as ts.ObjectLiteralExpression, key)!.initializer;
    edits.push({ start: node.getStart(parsed), end: node.end, text: JSON.stringify(issue.expected) });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  if (!dryRun) writeFileSync(file, source);
  return issues;
}
