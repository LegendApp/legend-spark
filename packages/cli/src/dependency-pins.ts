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

export function dependencyPinIssues(pkg: any, platforms: readonly string[]): DependencyPinIssue[] {
  const required = packages.filter(name => name !== "react-native-macos" || platforms.includes("macos"));
  const issues: DependencyPinIssue[] = [];
  function check(name: string, value: unknown, where: string[]) {
    // npm permits an override to reference a direct dependency's spec.
    const resolved = where[0] === "overrides" && typeof value === "string" && value.startsWith("$")
      ? pkg.dependencies?.[value.slice(1)] ?? pkg.devDependencies?.[value.slice(1)] : value;
    if (typeof resolved === "string" && /^(catalog|workspace):/.test(resolved)) {
      console.log(`Skipping dependency pin check for ${where.join(" → ")}: ${resolved} is managed by the catalog or workspace.`);
      return;
    }
    if (resolved !== expectedDependencyPins[name]) issues.push({ package: name, found: typeof value === "string" ? value : JSON.stringify(value), expected: expectedDependencyPins[name], where });
  }
  for (const name of required) {
    let present = false;
    for (const section of ["dependencies", "devDependencies"]) {
      if (Object.hasOwn(pkg[section] ?? {}, name)) {
        present = true;
        check(name, pkg[section][name], [section, name]);
      }
    }
    if (!present) issues.push({ package: name, found: "(missing)", expected: expectedDependencyPins[name], where: ["dependencies", name], missing: true });
  }
  function overrides(entries: any, where: string[], parent?: string) {
    for (const [selector, value] of Object.entries(entries ?? {})) {
      // Yarn paths/globs, version-qualified npm selectors and pnpm parent>child selectors.
      const child = selector.split(/>(?=[@a-zA-Z])/).at(-1)!;
      const segments = child.split("/");
      const name = selector === "." ? parent : segments.at(-2)?.startsWith("@") ? undefined : required.find(name => new RegExp(`^${name}(?:@[^/]*)?$`).test(segments.at(-1)!));
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
export function upgradeDependencyPins(root: string, dryRun = false): DependencyPinIssue[] {
  const file = path.join(root, "package.json");
  let source = readFileSync(file, "utf8");
  const pkg = JSON.parse(source);
  const issues = dependencyPinIssues(pkg, supportedPlatforms(root));
  if (!issues.length || dryRun) return issues;
  const parsed = ts.parseJsonText(file, source);
  const object = (parsed.statements[0] as ts.ExpressionStatement).expression as ts.ObjectLiteralExpression;
  const edits: { start: number; end: number; text: string }[] = [];
  function property(object: ts.ObjectLiteralExpression, key: string) {
    return object.properties.find(p => ts.isPropertyAssignment(p) && ts.isStringLiteral(p.name) && p.name.text === key) as ts.PropertyAssignment | undefined;
  }
  const missing = issues.filter(issue => issue.missing);
  if (missing.length) {
    if ("dependencies" in pkg && (!pkg.dependencies || typeof pkg.dependencies !== "object" || Array.isArray(pkg.dependencies))) throw new Error("package.json dependencies must be an object. No files were changed.");
    const indent = source.match(/^[\t ]+(?=")/m)?.[0] ?? "  ";
    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    const dependencies = property(object, "dependencies")?.initializer as ts.ObjectLiteralExpression | undefined;
    const target = dependencies ?? object;
    const entries = dependencies ? missing.map(issue => `${JSON.stringify(issue.package)}: ${JSON.stringify(issue.expected)}`)
      : [`"dependencies": ${JSON.stringify(Object.fromEntries(missing.map(issue => [issue.package, issue.expected])), null, indent)}`];
    const last = target.properties.at(-1);
    const baseIndent = source.slice(0, target.getStart(parsed)).match(/(?:^|\n)([\t ]*)[^\n]*$/)![1];
    const multiline = !last || source.slice(target.getStart(parsed), target.end).includes("\n");
    const separator = multiline ? newline + baseIndent + indent : " ";
    const text = entries.map(entry => entry.replaceAll("\n", newline + baseIndent + indent)).join("," + separator);
    edits.push(last ? { start: last.end, end: last.end, text: "," + separator + text }
      : { start: target.getStart(parsed) + 1, end: target.end - 1, text: separator + text + newline + baseIndent });
  }
  for (const issue of issues) {
    if (issue.missing) continue;
    // Fixing the referenced direct dependency also fixes npm's $ref override.
    if (issue.where[0] === "overrides" && issue.found.startsWith("$") && issues.some(direct => ["dependencies", "devDependencies"].includes(direct.where[0]) && direct.package === issue.found.slice(1) && direct.expected === issue.expected)) continue;
    let node: ts.Expression = object;
    for (const key of issue.where) node = property(node as ts.ObjectLiteralExpression, key)!.initializer;
    edits.push({ start: node.getStart(parsed), end: node.end, text: JSON.stringify(issue.expected) });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  writeFileSync(file, source);
  return issues;
}
