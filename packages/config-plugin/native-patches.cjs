const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const cameraPackages = ["react-native-nitro-image", "react-native-vision-camera"];

function prepareNativePatches(root) {
  const manifestFile = path.join(root, "package.json");
  if (!fs.existsSync(manifestFile)) return {};
  const app = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (app.name !== "@legendapp/spark" && !app.dependencies?.["@legendapp/spark"] && !app.devDependencies?.["@legendapp/spark"]) return {};
  const appRequire = createRequire(manifestFile);
  let sparkFile;
  try { sparkFile = appRequire.resolve("@legendapp/spark/package.json"); }
  catch (error) { if (error.code === "MODULE_NOT_FOUND") return {}; throw error; }
  const spark = JSON.parse(fs.readFileSync(sparkFile, "utf8"));
  if (!cameraPackages.some(name => spark.dependencies?.[name])) return {};
  const active = ["react-native-nitro-modules", ...cameraPackages].filter(name => spark.dependencies?.[name]);
  const directory = path.dirname(sparkFile);
  const patchesRoot = spark.spark?.bundledModuleRoot
    ? path.join(directory, "patches/camera") : path.resolve(__dirname, "../../patches/camera");
  const pins = JSON.parse(fs.readFileSync(path.join(patchesRoot, "upstream.json"), "utf8"));
  const { parsePatch, applyPatch, reversePatch } = require("diff");
  const queue = [appRequire, createRequire(sparkFile)];
  const visited = new Set();
  const packages = {};
  for (const req of queue) {
    for (const name of active) {
      let file;
      try { file = req.resolve(`${name}/package.json`); }
      catch (error) {
        if (error.code !== "MODULE_NOT_FOUND") throw error;
        if (req === appRequire) continue;
        throw new Error(`Spark needs ${name}@${pins[name].version}. Finish installing dependencies before native preparation.`);
      }
      if (!fs.existsSync(file)) throw new Error(`Spark needs ${name}@${pins[name].version}. Finish installing dependencies before native preparation.`);
      const packageRoot = fs.realpathSync(path.dirname(file));
      if (visited.has(packageRoot)) continue;
      visited.add(packageRoot);
      packages[name] = { root: packageRoot };
      queue.push(createRequire(file));
      const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
      const pin = pins[name];
      if (manifest.version !== pin.version) throw new Error(`Spark needs ${name}@${pin.version}; found ${manifest.version}. Use the SDK's pinned dependency version.`);
      const bytes = fs.readFileSync(path.join(patchesRoot, `${name}.patch`));
      const writes = [];
      for (const patch of parsePatch(bytes.toString("utf8"))) {
        const relative = patch.newFileName.replace(/^b\//, "");
        const target = path.resolve(packageRoot, relative);
        if (!target.startsWith(packageRoot + path.sep) || patch.newFileName === "/dev/null") throw new Error(`Invalid native patch target: ${relative}`);
        let current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
        if (patch.oldFileName === "/dev/null") {
          const next = applyPatch("", patch);
          if (current === next) continue;
          if (current !== "") throw new Error(`Cannot apply Spark's ${name} patch to ${relative}. Reinstall dependencies before retrying.`);
          writes.push([target, next]);
          continue;
        }
        if (relative === "package.json" && manifest.spark?.dependencyPatch) {
          const original = JSON.parse(current);
          delete original.spark.dependencyPatch;
          delete original.spark.sdk;
          delete original.spark.requires;
          if (!Object.keys(original.spark).length) delete original.spark;
          current = JSON.stringify(original, null, 2) + "\n";
        }
        if (applyPatch(current, reversePatch(patch)) !== false) continue;
        const next = applyPatch(current, patch);
        if (next === false) throw new Error(`Cannot apply Spark's ${name} patch to ${relative}. Reinstall dependencies before retrying.`);
        writes.push([target, next]);
      }
      // Verify every file before writing; rename rather than mutate package-manager cache hardlinks.
      for (const [target, next] of writes) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const temporary = `${target}.spark-${process.pid}.tmp`;
        fs.writeFileSync(temporary, next); fs.renameSync(temporary, target);
      }
      const patched = JSON.parse(fs.readFileSync(file, "utf8"));
      patched.spark ??= {};
      if (name !== "react-native-nitro-modules") {
        patched.spark.sdk = true;
        patched.spark.requires = name === "react-native-vision-camera"
          ? ["react-native-nitro-modules", "react-native-nitro-image"] : ["react-native-nitro-modules"];
      }
      patched.spark.dependencyPatch = { schema: 1, version: pin.version,
        patchHash: createHash("sha256").update(bytes).digest("hex"), upstreamIntegrity: pin.integrity };
      const serialized = JSON.stringify(patched, null, 2) + "\n";
      if (fs.readFileSync(file, "utf8") !== serialized) {
        const temporary = `${file}.spark-${process.pid}.tmp`;
        fs.writeFileSync(temporary, serialized); fs.renameSync(temporary, file);
      }
    }
  }
  return packages;
}

module.exports = { prepareNativePatches };
