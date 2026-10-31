const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const optionalBackends = ["react-native-enriched-markdown", "react-native-enriched-html", "react-native-webview", "@op-engineering/op-sqlite"];
const cameraPackages = ["react-native-nitro-image", "react-native-vision-camera"];

function readManifest(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Find a package's manifest even when its exports map hides package.json, as Node finds the package.
function resolveManifest(req, name) {
  try { return req.resolve(`${name}/package.json`); }
  catch (error) {
    if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
    const file = (req.resolve.paths(name) ?? []).map(directory => path.join(directory, name, "package.json")).find(fs.existsSync);
    if (!file) throw error;
    return file;
  }
}

function prepareNativePatches(root, installed = []) {
  const manifestFile = path.join(root, "package.json");
  if (!fs.existsSync(manifestFile)) return {};
  const app = readManifest(manifestFile);
  if (app.name !== "@legendapp/spark" && !app.dependencies?.["@legendapp/spark"] && !app.devDependencies?.["@legendapp/spark"]) return {};
  const appRequire = createRequire(manifestFile);
  let sparkFile;
  try { sparkFile = appRequire.resolve("@legendapp/spark/package.json"); }
  catch (error) { if (error.code === "MODULE_NOT_FOUND") return {}; throw error; }
  const spark = readManifest(sparkFile);
  const directory = path.dirname(sparkFile);
  const patchesRoot = spark.spark?.bundledModuleRoot
    ? path.join(directory, "patches") : path.resolve(__dirname, "../../patches");
  const dependencies = { ...spark.dependencies, ...app.dependencies, ...app.devDependencies };
  for (const name of [...cameraPackages, ...optionalBackends]) {
    if (app.optionalDependencies?.[name] || installed.some(pkg => pkg.name === name)) dependencies[name] = true;
  }
  const hasCamera = cameraPackages.some(name => dependencies[name]);
  const pins = {};
  if (hasCamera) {
    const cameraPins = JSON.parse(fs.readFileSync(path.join(patchesRoot, "camera/upstream.json"), "utf8"));
    for (const name of ["react-native-nitro-modules", ...cameraPackages]) {
      pins[name] = { ...cameraPins[name], patch: `camera/${name}.patch`,
        requires: name === "react-native-vision-camera" ? ["react-native-nitro-modules", "react-native-nitro-image"] : ["react-native-nitro-modules"] };
    }
  }
  const integrations = path.join(patchesRoot, "dependencies.json");
  if (fs.existsSync(integrations)) Object.assign(pins, JSON.parse(fs.readFileSync(integrations, "utf8")));
  const active = Object.keys(pins).filter(name => dependencies[name] ||
    (hasCamera && name === "react-native-nitro-modules") ||
    (dependencies["react-native-vision-camera"] && name === "react-native-nitro-image"));
  if (!active.length) return {};
  const { parsePatch, applyPatch, reversePatch } = require("diff");
  const queue = [appRequire, createRequire(sparkFile)].map(req => ({ req, optionalOnly: false }));
  if (hasCamera || optionalBackends.some(name => dependencies[name])) queue.push(...installed.map(pkg => ({ req: createRequire(path.join(pkg.root, "package.json")), optionalOnly: true })));
  const visited = new Set();
  const packages = {};
  for (const { req, optionalOnly } of queue) {
    for (const name of active) {
      if (optionalOnly && name !== "react-native-nitro-modules" && !cameraPackages.includes(name) && !optionalBackends.includes(name)) continue;
      let file;
      try { file = resolveManifest(req, name); }
      catch (error) {
        if (error.code !== "MODULE_NOT_FOUND") throw error;
        continue;
      }
      if (!fs.existsSync(file)) throw new Error(`Spark needs ${name}@${pins[name].version}. Finish installing dependencies before native preparation.`);
      const packageRoot = fs.realpathSync(path.dirname(file));
      if (visited.has(packageRoot)) continue;
      visited.add(packageRoot);
      const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
      const pin = pins[name];
      if (pin.optional && manifest.version !== pin.version) {
        console.warn(`Spark's desktop patch for ${name} needs ${pin.version}; found ${manifest.version}, so it stays unpatched.`);
        continue;
      }
      packages[name] = { root: packageRoot };
      queue.push({ req: createRequire(file), optionalOnly });
      if (manifest.version !== pin.version) {
        const owner = readManifest(req.resolve("./package.json"));
        throw new Error(`Spark needs ${name}@${pin.version}; found ${manifest.version} at ${packageRoot}, required by ${owner.name ?? root}. Add an override/resolution for the pinned version.`);
      }
      const bytes = fs.readFileSync(path.join(patchesRoot, pin.patch));
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
        // The receipt rewrites package.json with two-space JSON, so its patch hunks target that form.
        if (relative === "package.json") {
          const original = JSON.parse(current);
          if (manifest.spark?.dependencyPatch) {
            delete original.spark.dependencyPatch;
            delete original.spark.sdk;
            delete original.spark.requires;
            if (!Object.keys(original.spark).length) delete original.spark;
          }
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
      if (name !== "react-native-nitro-modules" && !pin.optional) {
        patched.spark.sdk = true;
        patched.spark.requires = pin.requires ?? [];
      }
      patched.spark.dependencyPatch = { schema: 1, version: pin.version,
        patchHash: createHash("sha256").update(bytes).digest("hex"), upstreamIntegrity: pin.integrity };
      const pkg = installed.find(pkg => pkg.root === packageRoot);
      if (pkg) pkg.json = patched;
      const serialized = JSON.stringify(patched, null, 2) + "\n";
      if (fs.readFileSync(file, "utf8") !== serialized) {
        const temporary = `${file}.spark-${process.pid}.tmp`;
        fs.writeFileSync(temporary, serialized); fs.renameSync(temporary, file);
      }
    }
  }
  for (const name of active) {
    if (!packages[name] && !pins[name].optional) throw new Error(`Spark needs ${name}@${pins[name].version}. Finish installing dependencies before native preparation.`);
  }
  return packages;
}

// RN macOS 0.83 declares UIApplication itself, so Expo's guarded duplicate breaks the build.
// The 55 template's Podfile removes it during pod install, after Spark fingerprints
// expo-modules-core; remove it first so the native fingerprint stays stable.
const applicationAlias = "#ifndef UIApplication\n@compatibility_alias UIApplication NSApplication;\n#endif";
function removeExpoApplicationAlias(rn, expo) {
  const file = path.join(expo, "ios/Platform/Platform.h"), compat = path.join(rn, "ReactApple/Libraries/RCTUIKit/RCTUIKitCompat.h");
  if (!fs.existsSync(file) || !fs.existsSync(compat) || !fs.readFileSync(compat, "utf8").includes("@compatibility_alias UIApplication NSApplication;")) return;
  const source = fs.readFileSync(file, "utf8");
  if (!source.includes(applicationAlias)) return;
  const temporary = `${file}.spark-${process.pid}.tmp`;
  fs.writeFileSync(temporary, source.replace(applicationAlias, ""));
  fs.renameSync(temporary, file); // Preserve package-manager cache hardlinks.
}

module.exports = { prepareNativePatches, removeExpoApplicationAlias };
