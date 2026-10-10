// Expo's file scanner ignores Bun file: dependencies' symlinked podspecs.
const fs = require("node:fs");
const path = require("node:path");
const VERSION = "58.0.11";
const before = `        return (await _fs().default.promises.readdir(targetPath, {
            withFileTypes: true
        })).filter((entry)=>entry.isFile() && filter(entry.name))`;
const after = `        const entries = await _fs().default.promises.readdir(targetPath, {
            withFileTypes: true
        });
        const files = await Promise.all(entries.map(async (entry)=>{
            if (!filter(entry.name)) return null;
            if (entry.isFile()) return entry;
            if (!entry.isSymbolicLink()) return null;
            const stat = await _fs().default.promises.stat(_path().default.join(targetPath, entry.name)).catch(()=>null);
            return stat?.isFile() ? entry : null;
        }));
        return files.filter((entry)=>entry !== null)`;
function patchAutolinkingSource(source) {
  if (source.includes(after) && !source.includes(before)) return source;
  if (source.split(before).length !== 2 || source.includes(after))
    throw new Error("Expo autolinking source changed; review the symlink compatibility patch before building.");
  return source.replace(before, after);
}
function installAutolinkingPatch(root) {
  const manifest = require.resolve("expo-modules-autolinking/package.json", { paths: [root] });
  const version = JSON.parse(fs.readFileSync(manifest, "utf8")).version;
  if (version !== VERSION) throw new Error(`spark's autolinking patch requires expo-modules-autolinking@${VERSION}; found ${version}.`);
  const file = path.join(path.dirname(manifest), "build/utils.js");
  const source = fs.readFileSync(file, "utf8");
  const patched = patchAutolinkingSource(source);
  if (source !== patched) {
    const temporary = `${file}.spark-${process.pid}.tmp`;
    fs.writeFileSync(temporary, patched);
    fs.renameSync(temporary, file); // Do not modify package-cache hardlinks.
  }
}
module.exports = { VERSION, patchAutolinkingSource, installAutolinkingPatch };
