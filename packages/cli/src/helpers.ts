import { copyFileSync, lstatSync, mkdirSync, realpathSync, chmodSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { architecture, type DesktopPlatform } from "./platform.ts";
export type HelperBundle = { directory: string; executable: string };
export type Helpers = Record<string, string | Partial<Record<`${DesktopPlatform}-${"arm64" | "x64"}`, HelperBundle>>>;

export function resolveHelpers(root: string, helpers: Helpers = {}, platform: DesktopPlatform = "macos", arch: "arm64" | "x64" = architecture(platform)) {
  const { validateHelpers } = createRequire(import.meta.url)("@legendapp/spark-desktop-config/helpers.cjs");
  validateHelpers(helpers);
  const base = realpathSync(root);
  function inspect(file: string) {
    // Reject symlinks at every level, including parent directories. Bundles are
    // relocatable plain directories; links and special files aren't portable.
    const relative = path.relative(base, file);
    let current = base;
    for (const part of relative.split(path.sep)) {
      current = path.join(current, part);
      if (lstatSync(current).isSymbolicLink()) throw new Error(`Helper contains a symlink: ${current}`);
    }
    return lstatSync(file);
  }
  return Object.entries(helpers).map(([name, value]) => {
    const bundle = typeof value === "string" ? undefined : value[`${platform}-${arch}`];
    if (typeof value !== "string" && !bundle) throw new Error(`Helper ${name} has no ${platform}-${arch} bundle`);
    const directory = bundle ? path.join(base, bundle.directory) : undefined;
    const file = bundle ? path.join(directory!, bundle.executable) : path.join(base, value as string);
    if (!inspect(file).isFile()) throw new Error(`Helper must be a regular file: ${name}`);
    const files: string[] = [];
    const directories: string[] = [];
    const modes: [string, number][] = [];
    function visit(entry: string) {
      const stat = inspect(entry);
      if (stat.isDirectory()) {
        directories.push(path.relative(directory!, entry));
        for (const child of readdirSync(entry).sort()) visit(path.join(entry, child));
      } else if (stat.isFile()) {
        files.push(path.relative(base, entry));
        modes.push([path.relative(base, entry), stat.mode & 0o777]);
      }
      else throw new Error(`Helper contains a special file: ${entry}`);
    }
    visit(directory ?? file);
    if (bundle && readdirSync(directory!).some(name => name.toLowerCase() === ".spark-entry")) throw new Error(".spark-entry is reserved for helper metadata");
    return { name, file, relative: path.relative(base, file), directory, files, directories, modes, executable: bundle?.executable };
  });
}
export function copyHelpers(root: string, app: string, helpers: Helpers = {}, platform: DesktopPlatform = "macos", arch: "arm64" | "x64" = architecture(platform)) {
  const bundles = resolveHelpers(root, helpers, platform, arch);
  const destination = path.join(app, platform === "windows" ? "Helpers" : "Contents/Helpers");
  // This directory is framework-owned. Removed helpers must not survive rebuilds.
  rmSync(destination, { recursive: true, force: true });
  if (!bundles.length) return;
  mkdirSync(destination, { recursive: true });
  for (const helper of bundles) {
    if (!helper.directory) {
      const file = path.join(destination, helper.name + (platform === "windows" ? ".exe" : ""));
      copyFileSync(helper.file, file); chmodSync(file, 0o755);
      continue;
    }
    const directory = path.join(destination, `${helper.name}.helper`);
    for (const relative of helper.directories) mkdirSync(path.join(directory, relative), { recursive: true });
    for (const relative of helper.files) {
      const source = path.join(realpathSync(root), relative);
      const target = path.join(directory, path.relative(helper.directory, source));
      mkdirSync(path.dirname(target), { recursive: true }); copyFileSync(source, target);
    }
    chmodSync(path.join(directory, helper.executable!), 0o755);
    writeFileSync(path.join(directory, ".spark-entry"), helper.executable!, "utf8");
  }
}
