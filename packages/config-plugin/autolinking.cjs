// Expo 54's file scanner ignores Bun file: dependencies' symlinked podspecs.
const fs = require("node:fs");
const path = require("node:path");
const before = `        return (await fs_1.default.promises.readdir(targetPath, { withFileTypes: true }))
            .filter((entry) => entry.isFile() && filter(entry.name))`;
const after = `        const entries = await fs_1.default.promises.readdir(targetPath, { withFileTypes: true });
        const files = await Promise.all(entries.map(async (entry) => {
            if (!filter(entry.name)) return null;
            if (entry.isFile()) return entry;
            if (!entry.isSymbolicLink()) return null;
            const stat = await fs_1.default.promises.stat(path_1.default.join(targetPath, entry.name)).catch(() => null);
            return stat?.isFile() ? entry : null;
        }));
        return files
            .filter((entry) => entry !== null)`;
function patchAutolinkingSource(source) {
  if (source.includes(after) && !source.includes(before)) return source;
  if (source.split(before).length !== 2 || source.includes(after))
    throw new Error("Expo autolinking source changed; review the symlink compatibility patch before building.");
  return source.replace(before, after);
}
function installAutolinkingPatch(root) {
  const manifest = require.resolve("expo-modules-autolinking/package.json", { paths: [root] });
  const version = JSON.parse(fs.readFileSync(manifest, "utf8")).version;
  if (version !== "3.0.27") throw new Error(`spark's autolinking patch requires expo-modules-autolinking@3.0.27; found ${version}.`);
  const file = path.join(path.dirname(manifest), "build/utils.js");
  const source = fs.readFileSync(file, "utf8");
  const patched = patchAutolinkingSource(source);
  if (source !== patched) {
    const temporary = `${file}.spark-${process.pid}.tmp`;
    fs.writeFileSync(temporary, patched);
    fs.renameSync(temporary, file); // Do not modify package-cache hardlinks.
  }
}
// The native selection's exclusions go to the Podfile's autolinkers: Expo modules' (use_expo_modules!, which would
// otherwise read them from package.json) and React Native's, which ignores an app-level `ios: null` override when the
// package's own react-native.config.js declares iOS. React Native's autolinker also writes a copy of its output under
// the project's iOS source directory (an ios/ folder by default) for codegen, which would read it only from macos/ and
// would then skip its dependency scan, losing Expo Desktop's specs. .spark/ keeps that copy out of the app's files at
// the depth of macos/, from which the autolinker writes pods' relative paths.
function excludeNativeModules(podfile, excluded) {
  const call = /use_native_modules!\(config_command(?: \+ \[[^\]]*\])*\)/;
  const expo = /use_expo_modules!(?:\(exclude: \[[^\]]*\]\))?$/m;
  if (!call.test(podfile)) throw new Error("The macOS Podfile no longer calls use_native_modules!(config_command); review spark's native selection.");
  if (!expo.test(podfile)) throw new Error("The macOS Podfile no longer calls use_expo_modules!; review spark's native selection.");
  return podfile
    .replace(expo, `use_expo_modules!(exclude: ${JSON.stringify(excluded)})`)
    .replace(call, `use_native_modules!(config_command + ["--source-dir", File.expand_path("../.spark", __dir__)] + ${JSON.stringify(excluded.flatMap(name => ["--exclude", name]))})`);
}
module.exports = { patchAutolinkingSource, installAutolinkingPatch, excludeNativeModules };
