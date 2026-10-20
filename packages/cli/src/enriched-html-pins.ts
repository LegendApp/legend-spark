import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { readJson, writeJson } from "./json.ts";
import { readPnpmConfig } from "./package-manager-config.ts";
import { packageManager, managerCommand, type PackageManager } from "./package-manager.ts";
import { run } from "./commands.ts";
import type { DependencyPinIssue } from "./dependency-pins.ts";

const defaults = JSON.parse(readFileSync(new URL("../templates/blank-typescript/package.json", import.meta.url), "utf8"));
export function enrichedHtmlPinPolicy(overrides: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(overrides).filter(([name]) => name === "dompurify" || name.startsWith("@tiptap/")));
}
export const enrichedHtmlPins = enrichedHtmlPinPolicy(defaults.overrides);
function semver() {
  return createRequire(createRequire(import.meta.url).resolve("npm/package.json"))("semver");
}

// Read installed manifests even when exports hides package.json. Real paths retain
// the importer's dependency context in pnpm's isolated layout.
function manifestFrom(root: string, name: string): string | undefined {
  const req = createRequire(path.join(root, "package.json"));
  const file = req.resolve.paths(name)?.map(base => path.join(base, name, "package.json")).find(existsSync);
  return file ? realpathSync(file) : undefined;
}

export function enrichedHtmlPinIssues(root: string, policy = enrichedHtmlPins): DependencyPinIssue[] {
  const sdk = manifestFrom(root, "@legendapp/spark");
  const html = [manifestFrom(root, "react-native-enriched-html"), sdk && manifestFrom(path.resolve(path.dirname(sdk), readJson(sdk).spark?.bundledModuleRoot ?? "."), "react-native-enriched-html")].filter((file): file is string => !!file);
  if (!html.length) return [];
  const { valid, lt } = semver();
  const react = manifestFrom(root, "react");
  if (!react) throw new Error("Install the app's React dependency before checking enriched-html web dependencies.");
  const expected: Record<string, string> = { ...policy, "react-dom": readJson(react).version };
  const issues: DependencyPinIssue[] = [];
  const queue = [...html], visited = new Set<string>();
  while (queue.length) {
    const file = queue.shift()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const pkg = readJson(file);
    if (pkg.name in expected) {
      const version = expected[pkg.name]!;
      if (!valid(pkg.version) || (pkg.name === "react-dom" ? pkg.version !== version : lt(pkg.version, version)))
        issues.push({ package: pkg.name, found: pkg.version, expected: version, where: [file] });
    }
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies, "react-dom": "*" })) {
      if (!(name in expected)) continue;
      const dependency = manifestFrom(path.dirname(file), name);
      if (dependency) queue.push(dependency);
    }
  }
  return issues;
}

/** App-owned solver policy; never edits enriched-html or its installed metadata. */
export function repairEnrichedHtmlPins(root: string, manager: PackageManager, dryRun = false, policy = enrichedHtmlPins): DependencyPinIssue[] {
  const issues = enrichedHtmlPinIssues(root, policy);
  if (!issues.length) return issues;
  const { validRange, lt, minVersion } = semver();
  function preservePin(spec: unknown, version: string, name: string): boolean {
    if (typeof spec !== "string" || !validRange(spec)) return false;
    const minimum = minVersion(spec);
    return !!minimum && !lt(minimum, version) && (name !== "react-dom" || spec === version || lt(version, minimum));
  }
  const pkg = readJson(path.join(root, "package.json"));
  const yaml = manager === "pnpm" ? readPnpmConfig(root) : undefined;
  const field = manager === "yarn" ? "resolutions" : "overrides";
  const owner = manager === "pnpm" ? (pkg.pnpm ??= {}) : pkg;
  const pins = owner[field] ??= {};
  const expected: Record<string, string> = { ...policy, "react-dom": readJson(manifestFrom(root, "react")!).version };
  let changed = false, yamlChanged = false;
  for (const [name, version] of Object.entries(expected)) {
    if (!version) continue;
    // pnpm 11's YAML wins; mirror it for pnpm 10 without downgrading either pin.
    const yamlPin = yaml?.getIn(["overrides", name]);
    const direct = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
    const entry = pins[name];
    const value = entry && typeof entry === "object" ? entry["."] : entry;
    const current = typeof value === "string" && value.startsWith("$") ? pkg.dependencies?.[value.slice(1)] ?? pkg.devDependencies?.[value.slice(1)] : value;
    const candidates = [yamlPin, current, direct].filter(spec => preservePin(spec, version, name));
    const target = candidates.reduce((best, spec) => lt(minVersion(best), minVersion(spec)) ? spec : best, candidates[0] ?? version);
    if (!preservePin(current, version, name)) {
      if (entry && typeof entry === "object") entry["."] = target;
      else pins[name] = target;
      changed = true;
    }
    if (yaml && !preservePin(yamlPin, version, name)) { yaml.setIn(["overrides", name], target); yamlChanged = true; }
    // npm rejects overrides that differ from a direct dependency's spec.
    for (const section of ["dependencies", "devDependencies"]) {
      if (pkg[section]?.[name] && !preservePin(pkg[section][name], version, name)) {
        pkg[section][name] = target; changed = true;
      }
    }
  }
  if (!dryRun) {
    if (changed) writeJson(path.join(root, "package.json"), pkg);
    if (yamlChanged) writeFileSync(path.join(root, "pnpm-workspace.yaml"), yaml!.toString());
  }
  return issues;
}

export function assertEnrichedHtmlPins(root: string, policy = enrichedHtmlPins) {
  const issues = enrichedHtmlPinIssues(root, policy);
  if (!issues.length) return;
  const manager = packageManager(root);
  repairEnrichedHtmlPins(root, manager, false, policy);
  throw new Error(`Enriched HTML web dependency pins need installation (${[...new Set(issues.map(issue => `${issue.package}@${issue.found} → ${issue.expected}`))].join(", ")}). App-level pins checked and repaired; newer explicit pins preserved. Run ${manager} install, then retry. If versions still differ, align your explicit pins with the app's React and Spark's web dependency policy.`);
}

/** Existing install paths can also repair a newly introduced enriched-html graph. */
export async function installWithEnrichedHtmlPins(root: string, manager: PackageManager, policy = enrichedHtmlPins) {
  repairEnrichedHtmlPins(root, manager, false, policy);
  await run(root, managerCommand(manager, ["install"]));
  if (repairEnrichedHtmlPins(root, manager, false, policy).length) await run(root, managerCommand(manager, ["install"]));
  assertEnrichedHtmlPins(root, policy);
}
