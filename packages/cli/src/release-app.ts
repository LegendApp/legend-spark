import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type { Runner } from "./credentials.ts";

export function checkReleasePayload(app: string, runner: boolean, info: Record<string, unknown>) {
  const runtime = path.join(app, "Contents/Resources/spark-runtime.json");
  if (!existsSync(runtime)) throw new Error("Distribution app is missing spark-runtime.json.");
  if (!runner) {
    const bundle = path.join(app, "Contents/Resources/main.jsbundle");
    if (!existsSync(bundle)) throw new Error("Distribution app is missing its JavaScript bundle.");
    if (readFileSync(bundle).subarray(0, 8).toString("hex") !== "c61fbc03c103191f") {
      throw new Error("The release main.jsbundle must contain Hermes bytecode.");
    }
    const ats = info.NSAppTransportSecurity as Record<string, unknown> | undefined;
    if (ats?.NSAllowsLocalNetworking === true || ats?.NSAllowsArbitraryLoads === true) {
      throw new Error("The release Info.plist allows local networking or arbitrary loads.");
    }
  }
  for (const entry of readdirSync(app, { recursive: true, withFileTypes: true })) {
    if (/(?:^\.(?:git|DS_Store)$|^node_modules$|^__tests__$|\.(?:map|dSYM|o|a|p12|p8)$|^libclang_rt\..*\.dylib$)/i.test(entry.name) ||
        (!runner && entry.name.endsWith(".debug.dylib"))) {
      throw new Error(`Development artifact in the distribution app: ${path.relative(app, path.join(entry.parentPath, entry.name))}`);
    }
    if (entry.isFile() && /\.(?:mjs|cjs|js)$/.test(entry.name) &&
        /(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL\s*=/.test(readFileSync(path.join(entry.parentPath, entry.name), "utf8"))) {
      throw new Error(`Source map reference in the distribution app: ${path.relative(app, path.join(entry.parentPath, entry.name))}`);
    }
  }
}

type Image = { file: string; arch: string; type: string; rpaths: string[]; loads: string[]; id?: string };

function loadCommands(file: string, output: string): Image[] {
  const images = output.split(/^Mach header$/m).slice(1).map(slice => {
    const header = /^MH_\S+\s+(\S+)\s+\S+\s+\S+\s+(\S+)\s/m.exec(slice);
    if (!header) throw new Error(`Cannot read the Mach-O header in ${file}.`);
    const image: Image = { file, arch: header[1]!, type: header[2]!, rpaths: [], loads: [] };
    for (const command of slice.split(/^Load command \d+$/m).slice(1)) {
      const kind = /^\s*cmd (LC_\w+)$/m.exec(command)?.[1];
      if (kind === "LC_DYLD_ENVIRONMENT") throw new Error(`LC_DYLD_ENVIRONMENT in ${file}.`);
      if (!kind || !/^LC_(?:RPATH|ID_DYLIB|LOAD_DYLINKER|(?:LOAD(?:_WEAK|_UPWARD)?|LAZY_LOAD|REEXPORT)_DYLIB)$/.test(kind)) continue;
      const value = /^\s*(?:name|path) (.+) \(offset \d+\)$/m.exec(command)?.[1];
      if (!value) throw new Error(`Cannot read ${kind} in ${file}.`);
      if (kind === "LC_RPATH") image.rpaths.push(value);
      else if (kind === "LC_ID_DYLIB") image.id = value;
      else image.loads.push(value);
    }
    return image;
  });
  if (!images.length) throw new Error(`Cannot read Mach-O load commands in ${file}.`);
  return images;
}

const systemPath = (file: string) => /^\/(?:usr\/lib|System\/Library)(?:\/|$)/.test(file);
const cleanRpath = (value: string) => value.startsWith("@rpath/") && !value.split("/").includes("..");

export async function checkReleaseLoadPaths(root: string, app: string, main: string, files: string[], execute: Runner) {
  const byFile = new Map<string, Image[]>();
  for (const file of files) {
    byFile.set(file, loadCommands(file, await execute(root, ["otool", "-arch", "all", "-hv", "-l", file], { capture: true })));
  }
  const mainImages = byFile.get(realpathSync(main));
  if (!mainImages?.every(image => image.type === "EXECUTE")) throw new Error("Distribution app is missing its Mach-O executable.");

  let sdk: string | undefined;
  const visited = new Map<Image, Set<string>>();
  const inside = (file: string) => file === app || file.startsWith(app + path.sep);
  function expand(value: string, loader: string, executable: string) {
    const token = /^@(loader_path|executable_path)(?:\/|$)/.exec(value);
    if (token) {
      const directory = path.dirname(token[1] === "loader_path" ? loader : executable);
      const resolved = path.resolve(directory, value.slice(token[0].length));
      if (inside(resolved)) return resolved;
    } else if (systemPath(value) && systemPath(path.normalize(value))) return path.normalize(value);
  }

  async function inspect(image: Image, loader: string, executable: string, inherited: string[], ancestors = new Set<Image>()) {
    if (ancestors.has(image)) return;
    const rpaths = [...new Set([...image.rpaths.map(value => {
      const expanded = expand(value, loader, executable);
      if (!expanded) throw new Error(`Invalid LC_RPATH ${value} in ${image.file}.`);
      return expanded;
    }), ...inherited])];
    const context = JSON.stringify([loader, executable, rpaths]);
    let contexts = visited.get(image);
    if (contexts?.has(context)) return;
    if (!contexts) visited.set(image, contexts = new Set());
    contexts.add(context);
    if (image.id && !cleanRpath(image.id) && !expand(image.id, loader, executable)?.startsWith(app + path.sep)) {
      throw new Error(`Invalid LC_ID_DYLIB ${image.id} in ${image.file}.`);
    }
    const chain = new Set([...ancestors, image]);
    for (const load of image.loads) {
      const expanded = expand(load, loader, executable);
      if (expanded && systemPath(expanded)) continue;
      const candidates = cleanRpath(load) ? rpaths.map(dir => path.join(dir, load.slice("@rpath/".length))) : expanded ? [expanded] : [];
      let resolved = false;
      for (const candidate of candidates) {
        if (systemPath(candidate)) {
          // Swift libraries may live in the dyld cache. The SDK stubs also keep this from accepting a missing bundled library.
          sdk ??= (await execute(root, ["xcrun", "--sdk", "macosx", "--show-sdk-path"], { capture: true })).trim();
          if (existsSync(candidate) || existsSync(path.join(sdk, candidate.replace(/\.dylib$/, ".tbd")))) resolved = true;
        } else if (existsSync(candidate)) {
          const dependency = byFile.get(realpathSync(candidate))?.find(other => other.arch === image.arch && other.type === "DYLIB");
          if (dependency) {
            await inspect(dependency, candidate, executable, rpaths, chain);
            resolved = true;
          }
        }
        if (resolved) break;
      }
      if (!resolved) throw new Error(`Unresolved load path ${load} in ${image.file} (${image.arch}).`);
    }
  }

  const images = [...byFile.values()].flat();
  for (const image of images.filter(image => image.type === "EXECUTE")) {
    await inspect(image, image.file, image.file, []);
  }
  // Plug-ins and unused universal slices can still load in the main process's context.
  for (const image of images.filter(image => !visited.has(image))) {
    const host = mainImages.find(other => other.arch === image.arch) ?? mainImages[0]!;
    const rpaths = host.rpaths.map(value => expand(value, main, main)!);
    await inspect(image, image.file, main, rpaths);
  }
}
