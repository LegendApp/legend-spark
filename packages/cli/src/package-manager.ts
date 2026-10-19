import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { which } from "./executable.ts";

export const managers = ["npm", "pnpm", "yarn", "bun"] as const;
export type PackageManager = typeof managers[number];
export function packageManager(root: string, explicit?: string, env: Record<string, string | undefined> = process.env): PackageManager {
  const file = path.join(root, "package.json");
  const pkg = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const declared = explicit ?? pkg.packageManager?.split("@")[0];
  let selected = declared;
  if (!selected) {
    const locks: Record<PackageManager, string[]> = { npm: ["package-lock.json", "npm-shrinkwrap.json"], pnpm: ["pnpm-lock.yaml"], yarn: ["yarn.lock"], bun: ["bun.lock", "bun.lockb"] };
    const found = managers.filter(manager => locks[manager].some(lock => existsSync(path.join(root, lock))));
    if (found.length > 1) throw new Error("Set packageManager in package.json or pass --package-manager to choose between the existing lockfiles.");
    const agent = env.npm_config_user_agent?.split("/")[0];
    selected = found[0] ?? (managers.includes(agent as PackageManager) ? agent : undefined) ?? managers.find(manager => which(manager, env));
  }
  if (!managers.includes(selected as PackageManager)) throw new Error(`Unsupported or unavailable package manager: ${selected ?? "none"}. Install npm, pnpm, Yarn, or Bun.`);
  if (!which(selected!, env) && !(env.npm_execpath && env.npm_config_user_agent?.startsWith(selected + "/"))) throw new Error(`This project uses ${selected}, but it is not installed. Install it or choose --package-manager explicitly.`);
  return selected as PackageManager;
}
export function managerCommand(manager: PackageManager, args: string[], env: Record<string, string | undefined> = process.env) {
  // npm run / pnpm exec / Corepack expose their actual JS entry point. Using it
  // preserves the caller's version and avoids platform-specific shell shims.
  const entry = env.npm_execpath;
  return entry && env.npm_config_user_agent?.startsWith(`${manager}/`) && /\.[cm]?js$/.test(entry)
    ? [process.execPath, entry, ...args]
    : [manager, ...args];
}
export function applyOverrides(pkg: any, overrides: Record<string, string>, manager: PackageManager) {
  // pnpm 10 can auto-install a registry peer beside an overridden file archive.
  // Provide Nitro at the installation root so camera/runtimes peers share the patched copy.
  const nitro = overrides["react-native-nitro-modules"];
  if (manager === "pnpm" && nitro?.startsWith("file:")) pkg.dependencies = { ...pkg.dependencies, "react-native-nitro-modules": nitro };
  const existing = { ...pkg.overrides, ...pkg.resolutions, ...pkg.pnpm?.overrides };
  delete pkg.overrides;
  delete pkg.resolutions;
  if (pkg.pnpm) delete pkg.pnpm.overrides;
  if (manager === "pnpm") pkg.pnpm = { ...pkg.pnpm, overrides: { ...existing, ...overrides } };
  else if (manager === "yarn") pkg.resolutions = { ...existing, ...overrides };
  else pkg.overrides = { ...existing, ...overrides };
}
export function localArchive(file: string) { return `file:${path.resolve(file).replaceAll("\\", "/")}`; }


/** Match Yarn paths, version-qualified npm selectors and pnpm parent>child selectors. */
export function overridePackageName(selector: string, checked: readonly string[]): string | undefined {
  // Comparators after @, whitespace or || belong to the version range.
  const child = selector.split(/(?<![@\s|])>(?=[@a-zA-Z])/).at(-1)!;
  const segments = child.split("/");
  const childName = segments.at(-2)?.startsWith("@") ? segments.slice(-2).join("/") : segments.at(-1)!;
  return checked.find(name => childName === name || childName.startsWith(name + "@"));
}
