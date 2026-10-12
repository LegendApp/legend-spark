// Third-party license notices for a macOS release build: Contents/Resources/ThirdPartyNotices.txt (#153).
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { sourceRoot } from "./macos-release.ts";

export const NOTICES_FILE = "ThirdPartyNotices.txt";

export type Notice = { name: string; version?: string; license: string; text?: string; source: "npm" | "CocoaPods" };

const LICENSE_FILE = /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i;

/** The package.json directory that owns `file`, or undefined when none does below the filesystem root. */
function packageRoot(file: string): string | undefined {
  for (let dir = path.dirname(file); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, "package.json")) && JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).name) return dir;
  }
}

/** Name, version, license id and license text of an npm package directory. `UNKNOWN` when it declares and ships no license. */
export function npmNotice(dir: string): Notice {
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const file = readdirSync(dir).find(name => LICENSE_FILE.test(name));
  const license = typeof pkg.license === "string" ? pkg.license : pkg.license?.type ?? (Array.isArray(pkg.licenses) ? pkg.licenses.map((entry: { type: string }) => entry.type).join(" OR ") : undefined);
  const text = file ? readFileSync(path.join(dir, file), "utf8").trim() : undefined;
  return { name: pkg.name, version: pkg.version, license: license ?? (text ? "see text" : "UNKNOWN"), ...(text ? { text } : {}), source: "npm" };
}

/** The app target's CocoaPods acknowledgements plist: native code the pods vendor (folly, boost, Hermes, Sparkle, …). */
export function acknowledgementsFile(nativeRoot: string): string {
  const support = path.join(nativeRoot, "Pods/Target Support Files");
  const target = existsSync(support) ? readdirSync(support).find(name => name.startsWith("Pods-") && existsSync(path.join(support, name, `${name}-acknowledgements.plist`))) : undefined;
  if (!target) throw new Error(`No CocoaPods acknowledgements in ${support}; run pod install`);
  return path.join(support, target, `${target}-acknowledgements.plist`);
}

/** Notices from the acknowledgements plist, converted to JSON. Entries without a license are the header and footer. */
export function podNotices(acknowledgements: { PreferenceSpecifiers: Array<{ Title?: string; License?: string; FooterText?: string }> }): Notice[] {
  return acknowledgements.PreferenceSpecifiers.filter(entry => entry.Title && entry.License)
    .map(entry => ({ name: entry.Title!, license: entry.License!, ...(entry.FooterText?.trim() ? { text: entry.FooterText.trim() } : {}), source: "CocoaPods" as const }));
}

/**
 * First-party code is not listed: a `"private": true` package, or one inside the app's workspace root (or the app) that
 * is not installed under node_modules, such as the app itself and its monorepo's workspace packages.
 */
export function isFirstParty(dir: string, workspace: string): boolean {
  if (JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).private === true) return true;
  const inside = path.relative(workspace, dir);
  return !inside.startsWith("..") && !path.isAbsolute(inside) && !inside.split(path.sep).includes("node_modules");
}

/**
 * Notices for every third-party npm package whose code the app bundles (`sources`: the production JavaScript's source
 * files) or links natively (`nativePackages`), and every pod with an acknowledgement.
 */
export function collectNotices(appRoot: string, sources: string[], nativePackages: string[], pods: Notice[]): Notice[] {
  const workspace = realpathSync(sourceRoot(appRoot));
  const roots = new Set<string>();
  for (const file of sources) {
    if (!existsSync(file)) continue;
    const root = packageRoot(realpathSync(file));
    if (root) roots.add(root);
  }
  for (const dir of nativePackages) roots.add(realpathSync(dir));
  for (const dir of roots) if (isFirstParty(dir, workspace)) roots.delete(dir);
  const byName = new Map<string, Notice>();
  for (const notice of [...[...roots].map(npmNotice), ...pods]) {
    const key = `${notice.source}:${notice.name}`;
    if (!byName.has(key)) byName.set(key, notice);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
}

/** The notices file: a `## <name> <version>` section per package, its license id, then its license text. */
export function formatNotices(appName: string, notices: Notice[]): string {
  const sections = notices.map(notice => [
    `## ${notice.name}${notice.version ? ` ${notice.version}` : ""}`,
    `License: ${notice.license}`,
    `Source: ${notice.source}`,
    ...(notice.text ? ["", notice.text] : []),
  ].join("\n"));
  return `Third-party software notices for ${appName}\n\n${appName} includes the following third-party software.\n\n${sections.join("\n\n")}\n`;
}
