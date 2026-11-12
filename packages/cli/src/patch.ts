import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import { appPatches, layerPatches, prepareNativePatches, resolveManifest, withoutReceipt } from "@legendapp/spark-desktop-config/native-patches.cjs";
import { readJson } from "./project.ts";

function files(directory: string, relative = ""): string[] {
  if (!existsSync(path.join(directory, relative))) return [];
  return readdirSync(path.join(directory, relative), { withFileTypes: true }).flatMap(entry => {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.name === "node_modules" || entry.name === ".git") return [];
    return entry.isDirectory() ? files(directory, child) : [child];
  });
}

const read = (file: string) => existsSync(file) ? readFileSync(file, "utf8") : undefined;

/** The nearest folder from start that owns app patches: a Spark app, a patches/ folder or a package.json with a spark field. */
export function patchRoot(start: string) {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, "package.json");
    if (existsSync(path.join(dir, "patches")) || (existsSync(manifest) &&
      (existsSync(path.join(dir, "app.json")) || existsSync(path.join(dir, "desktop.config.json")) || readJson(manifest).spark))) return dir;
    if (path.dirname(dir) === dir) throw new Error("No patches/ folder or Spark app found. Run spark patch inside your app or pass --root.");
  }
}

/**
 * Two steps, like patch-package: the first copies the library installed for root with Spark's patch (and
 * without the app's) to a temporary folder for editing; `done` saves the edits as <out>/patches/<name>@<version>.patch.
 * The installed copy follows only patches saved in root's own patches/.
 */
export function patchLibrary(root: string, name: string, { done = false, force = false, out = root } = {}) {
  prepareNativePatches(root);
  let manifest: string;
  try { manifest = resolveManifest(createRequire(path.join(root, "package.json")), name); }
  catch { throw new Error(`${name} is not installed in ${root}.`); }
  const installed = realpathSync(path.dirname(manifest));
  const { version } = readJson(manifest);
  const manifestOut = path.join(out, "package.json");
  const own = appPatches(out, existsSync(manifestOut) ? readJson(manifestOut) : {})[name];
  if (own?.thirdParty) throw new Error(`${own.file} already patches ${name} through your package manager. Remove it and reinstall ${name} before using spark patch.`);
  const file = path.join("patches", `${name.replace("/", "+")}@${version}.patch`);
  const work = path.join(os.tmpdir(), "spark-patch", createHash("sha256").update(root).digest("hex").slice(0, 12), `${name.replace("/", "+")}@${version}`);
  const base = path.join(work, "base"), edit = path.join(work, "edit");
  if (!done) {
    if (existsSync(edit) && !force) {
      console.log(`${name} is already prepared for editing in ${edit}\nRun spark patch ${name} --done to save it, or --force to start over.`);
      return edit;
    }
    rmSync(work, { recursive: true, force: true });
    cpSync(installed, base, { recursive: true, filter: source => !["node_modules", ".git", ".spark-app.patch"].includes(path.relative(installed, source).split(path.sep)[0]!) });
    writeFileSync(path.join(base, "package.json"), withoutReceipt(readFileSync(path.join(base, "package.json"), "utf8")));
    if (own) layerPatches(base, name, [undefined, { text: own.bytes.toString("utf8"), apply: false, error: () => "" }]);
    cpSync(base, edit, { recursive: true });
    console.log(`Edit ${name}@${version} in ${edit}\nThen run spark patch ${name} --done to save ${file}.`);
    return edit;
  }
  if (!existsSync(edit)) throw new Error(`Run spark patch ${name} first, edit the copy it prints, then rerun with --done.`);
  let diff = "";
  for (const relative of [...new Set([...files(base), ...files(edit)])].sort()) {
    const before = read(path.join(base, relative)), after = read(path.join(edit, relative));
    if (before === after) continue;
    if (after === undefined) throw new Error(`App patches can't delete ${relative}; empty it instead.`);
    if (after.includes("\0")) throw new Error(`App patches can't change binary file ${relative}.`);
    diff += `diff --git a/${relative} b/${relative}\n` + createTwoFilesPatch(before === undefined ? "/dev/null" : `a/${relative}`, `b/${relative}`, before ?? "", after).replace(/^=+\n/, "");
  }
  if (diff) {
    mkdirSync(path.join(out, "patches"), { recursive: true });
    writeFileSync(path.join(out, file), diff);
  } else rmSync(path.join(out, file), { force: true });
  if (out === root) prepareNativePatches(root);
  rmSync(work, { recursive: true, force: true });
  console.log(diff ? `Saved ${file}.` : `No changes to ${name}; ${file} is absent.`);
  return path.join(out, file);
}
