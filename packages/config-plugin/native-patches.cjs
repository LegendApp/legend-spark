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

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const warned = new Set();
function warnOnce(message) {
  if (!warned.has(message)) console.warn(message);
  warned.add(message);
}

// App patches by convention: patches/<name>@<version>.patch, with + for / in scoped names. patch-package's
// <name>+<version>.patch files and bun/pnpm patchedDependencies are third-party: the package manager installs them.
function appPatches(root, app) {
  const patches = {};
  const add = (name, version, file, thirdParty) => {
    const error = patches[name] && `Both ${patches[name].file} and ${file} patch ${name}; combine them into one.`;
    // patch-package may split one library's patch in several files; that only matters where Spark layers it.
    if (error && !(thirdParty && patches[name].thirdParty)) throw new Error(error);
    patches[name] = { version, file, thirdParty, error, bytes: fs.readFileSync(path.join(root, file)) };
  };
  const listed = { ...app.pnpm?.patchedDependencies, ...app.patchedDependencies };
  for (const [key, file] of Object.entries(listed)) {
    const at = key.lastIndexOf("@");
    add(at > 0 ? key.slice(0, at) : key, at > 0 ? key.slice(at + 1) : undefined, path.normalize(file), true);
  }
  const files = new Set(Object.values(listed).map(file => path.normalize(file)));
  const directory = path.join(root, "patches");
  // Spark's own repository keeps Spark's patches there, under the same names.
  const appFolder = fs.existsSync(directory) && !fs.existsSync(path.join(directory, "dependencies.json"));
  for (const entry of appFolder ? fs.readdirSync(directory).sort() : []) {
    const file = path.join("patches", entry);
    const own = /^(.+?)@([^@]+)\.patch$/.exec(entry);
    const match = own ?? /^((?:@[^+]+\+)?[^+@]+)\+([^+]+?)(?:\.dev)?(?:\+.*)?\.patch$/.exec(entry);
    if (match && !files.has(file)) add(match[1].replace("+", "/"), match[2], file, !own);
  }
  return patches;
}

// The receipt rewrites package.json with two-space JSON, so patch hunks target that form without the receipt.
function withoutReceipt(text) {
  const manifest = JSON.parse(text);
  if (manifest.spark?.dependencyPatch) {
    delete manifest.spark.dependencyPatch;
    delete manifest.spark.sdk;
    delete manifest.spark.requires;
    if (!Object.keys(manifest.spark).length) delete manifest.spark;
  }
  return JSON.stringify(manifest, null, 2) + "\n";
}

// Layers are [Spark's patch, the app's patch], each { text, apply, error }. A file may hold both layers,
// Spark's alone, the app's alone (installed by a package manager) or neither: undo what it holds, then
// apply the enabled layers. Every file is verified before any is written.
function layerPatches(packageRoot, name, layers) {
  const { parsePatch, applyPatch, reversePatch } = require("diff");
  const files = new Map();
  layers.forEach((layer, index) => {
    for (const patch of layer ? parsePatch(layer.text) : []) {
      let relative = patch.newFileName.replace(/^b\//, "");
      if (relative.startsWith(`node_modules/${name}/`)) relative = relative.slice(`node_modules/${name}/`.length);
      const target = path.resolve(packageRoot, relative);
      if (!target.startsWith(packageRoot + path.sep) || patch.newFileName === "/dev/null") throw new Error(`Invalid native patch target: ${relative}`);
      if (!files.has(relative)) files.set(relative, { target, patches: [] });
      files.get(relative).patches[index] = patch;
    }
  });
  const created = patch => patch?.oldFileName === "/dev/null";
  const undo = (text, patch) => {
    if (text === false || !patch) return text;
    const result = applyPatch(text, reversePatch(patch));
    return created(patch) && result !== "" ? false : result;
  };
  const writes = [];
  for (const [relative, { target, patches }] of files) {
    let current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    if (relative === "package.json") current = withoutReceipt(current);
    let next = [[0, 1], [0], [1]].map(state => state.reduceRight((text, index) => undo(text, patches[index]), current))
      .find(text => text !== false) ?? current;
    layers.forEach((layer, index) => {
      if (!layer?.apply || !patches[index]) return;
      next = created(patches[index]) && next !== "" ? false : applyPatch(next, patches[index]);
      if (next === false) throw new Error(layer.error(relative));
    });
    if (next !== current) writes.push([target, next === "" && patches.some(created) ? null : next]);
  }
  // Rename rather than mutate package-manager cache hardlinks.
  for (const [target, next] of writes) {
    if (next === null) { fs.rmSync(target, { force: true }); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.spark-${process.pid}.tmp`;
    fs.writeFileSync(temporary, next); fs.renameSync(temporary, target);
  }
}

function stamp(file, installed, update) {
  const manifest = readManifest(file);
  manifest.spark ??= {};
  update(manifest);
  const root = fs.realpathSync(path.dirname(file));
  const pkg = installed.find(pkg => pkg.root === root);
  if (pkg) pkg.json = manifest;
  const serialized = JSON.stringify(manifest, null, 2) + "\n";
  if (fs.readFileSync(file, "utf8") !== serialized) {
    const temporary = `${file}.spark-${process.pid}.tmp`;
    fs.writeFileSync(temporary, serialized); fs.renameSync(temporary, file);
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
  const ownPatches = app.name === "@legendapp/spark" ? {} : appPatches(root, app);
  if (!active.length && !Object.keys(ownPatches).length) return {};
  const appPatch = (name, version) => {
    const own = ownPatches[name];
    if (own?.error) throw new Error(own.error);
    if (own?.version && own.version !== version) throw new Error(`${own.file} patches ${name}@${own.version}, but ${version} is installed. Redo it with spark patch ${name}.`);
    return own;
  };
  // Records which app root's patch an install carries; app roots sharing one install must agree on it.
  const appRoot = (name, packageRoot, manifest, own) => {
    const previous = manifest.spark?.dependencyPatch, appPatchHash = own && hash(own.bytes), self = path.resolve(root);
    if (previous?.appRoot && previous.appRoot !== self && previous.appPatchHash !== appPatchHash) {
      throw new Error(`${name} in ${packageRoot} carries the app patch from ${previous.appRoot}, not ${self}'s. App roots that share one install need one patch set: keep the patch at the shared root and give every app the same file, or reinstall ${name}.`);
    }
    return own && (previous?.appPatchHash === appPatchHash && previous.appRoot || self);
  };
  const layered = new Set();
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
      const own = appPatch(name, manifest.version);
      const ownRoot = appRoot(name, packageRoot, manifest, own);
      const enabled = app.spark?.patches?.[name] !== false;
      if (!enabled) warnOnce(`Spark's ${name} patch is disabled by spark.patches in package.json; desktop support for ${name} isn't guaranteed.`);
      if (own?.thirdParty) warnOnce(`Spark applies its ${name} patch first, then ${own.file}.`);
      layerPatches(packageRoot, name, [
        { text: bytes.toString("utf8"), apply: enabled, error: relative => `Cannot apply Spark's ${name} patch to ${relative}. Reinstall dependencies before retrying.` },
        own && { text: own.bytes.toString("utf8"), apply: true, error: relative => `Cannot apply ${own.file} to ${relative}${enabled ? " on top of Spark's patch" : ""}. Redo it with spark patch ${name}.` },
      ]);
      layered.add(name);
      stamp(file, installed, manifest => {
        if (name !== "react-native-nitro-modules" && !pin.optional) {
          manifest.spark.sdk = true;
          manifest.spark.requires = pin.requires ?? [];
        }
        manifest.spark.dependencyPatch = { schema: 1, version: pin.version, patchHash: enabled ? hash(bytes) : undefined,
          appPatchHash: own && hash(own.bytes), appRoot: ownRoot, upstreamIntegrity: pin.integrity };
      });
    }
  }
  // App patches for libraries Spark doesn't patch apply alone; package managers own their own patches.
  for (const [name, own] of Object.entries(ownPatches)) {
    if (own.thirdParty || layered.has(name)) continue;
    let file;
    try { file = resolveManifest(appRequire, name); }
    catch (error) {
      if (error.code !== "MODULE_NOT_FOUND") throw error;
      warnOnce(`${own.file} patches ${name}, which isn't installed.`);
      continue;
    }
    const manifest = readManifest(file), { version } = manifest, packageRoot = fs.realpathSync(path.dirname(file));
    appPatch(name, version);
    const ownRoot = appRoot(name, packageRoot, manifest, own);
    layerPatches(packageRoot, name, [undefined,
      { text: own.bytes.toString("utf8"), apply: true, error: relative => `Cannot apply ${own.file} to ${relative}. Reinstall dependencies or redo it with spark patch ${name}.` }]);
    stamp(file, installed, manifest => { manifest.spark.dependencyPatch = { schema: 1, version, appPatchHash: hash(own.bytes), appRoot: ownRoot }; });
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

module.exports = { prepareNativePatches, removeExpoApplicationAlias, appPatches, layerPatches, resolveManifest, withoutReceipt };
