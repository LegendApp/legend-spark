const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { createRequire } = require("node:module");
const { spawnSync } = require("node:child_process");
const { validatePackageSettings } = require("./validation.cjs");

const sources = new Map();
const offeredUpgrades = new Set();
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const exact = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;
function compareVersions(a, b) {
  if (!exact.test(a) || !exact.test(b)) throw new Error(`Expected exact version: ${a}, ${b}`);
  const [av, ap] = a.split("-", 2), [bv, bp] = b.split("-", 2);
  const an = av.split(".").map(Number), bn = bv.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (an[i] !== bn[i]) return an[i] > bn[i] ? 1 : -1;
  if (ap === undefined || bp === undefined) return ap === bp ? 0 : ap === undefined ? 1 : -1;
  const aa = a.slice(av.length + 1).split("."), bb = b.slice(bv.length + 1).split(".");
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    if (aa[i] === bb[i]) continue;
    if (aa[i] === undefined || bb[i] === undefined) return aa[i] === undefined ? -1 : 1;
    const na = /^\d+$/.test(aa[i]), nb = /^\d+$/.test(bb[i]);
    if (na !== nb) return na ? -1 : 1;
    return na ? (BigInt(aa[i]) > BigInt(bb[i]) ? 1 : -1) : aa[i] > bb[i] ? 1 : -1;
  }
  return 0;
}
function object(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Malformed patch registry: ${label} must be an object`);
  for (const key of Object.keys(value)) if (fields && !fields.includes(key)) throw new Error(`Malformed patch registry: unknown ${label}.${key}`);
}
function validateRegistry(value) {
  object(value, ["schema", "libraries"], "registry");
  if (value.schema !== 1) throw new Error("Unsupported patch registry schema");
  object(value.libraries, undefined, "libraries");
  for (const [name, library] of Object.entries(value.libraries)) {
    if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(name) || ["__proto__", "constructor", "prototype"].includes(name)) throw new Error(`Invalid registry library: ${name}`);
    object(library, ["kind", "versions"], name);
    if (!["patch", "sdk", "redirect"].includes(library.kind) || !Array.isArray(library.versions) || !library.versions.length) throw new Error(`Malformed patch registry library: ${name}`);
    const seen = new Set();
    for (const entry of library.versions) {
      object(entry, ["version", "minSpark", "patch", "sha256", "integrity", "requires", "optional", "sdkPatch", "sdkSha256"], name);
      if (typeof entry.version !== "string" || typeof entry.minSpark !== "string" || !exact.test(entry.version) || !exact.test(entry.minSpark)) throw new Error(`Registry versions must be exact: ${name}`);
      const key = `${entry.version}@${entry.minSpark}`;
      if (seen.has(key)) throw new Error(`Duplicate registry patch: ${name}@${key}`);
      seen.add(key);
      if (library.kind === "redirect") {
        if (entry.patch !== undefined || entry.sha256 !== undefined) throw new Error(`Redirect ${name} cannot declare a patch`);
      } else if (typeof entry.patch !== "string" || !/^[A-Za-z0-9@+_.-]+(?:\/[A-Za-z0-9@+_.-]+)*\.patch$/.test(entry.patch) || entry.patch.split("/").some(part => part === "..") || typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(`Invalid registry patch path/hash: ${name}`);
      if (entry.sdkPatch !== undefined || entry.sdkSha256 !== undefined) {
        if (typeof entry.sdkPatch !== "string" || !/^workspace\/[A-Za-z0-9@+_.-]+\.patch$/.test(entry.sdkPatch) || typeof entry.sdkSha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sdkSha256)) throw new Error(`Invalid SDK patch metadata: ${name}`);
      }
      if (entry.optional !== undefined && typeof entry.optional !== "boolean") throw new Error(`Invalid optional metadata: ${name}`);
      if (entry.integrity !== undefined && (typeof entry.integrity !== "string" || !entry.integrity.startsWith("sha512-"))) throw new Error(`Invalid integrity metadata: ${name}`);
      if (entry.requires !== undefined && (!Array.isArray(entry.requires) || entry.requires.some(dep => typeof dep !== "string" || !dep.length) || new Set(entry.requires).size !== entry.requires.length)) throw new Error(`Invalid requires metadata: ${name}`);
    }
  }
  return value;
}
function selectPatch(library, version, sparkVersion) {
  return library.versions.filter(entry => entry.version === version && compareVersions(entry.minSpark, sparkVersion) <= 0)
    .sort((a, b) => compareVersions(b.minSpark, a.minSpark))[0];
}
function resolveManifest(req, name) {
  try { return req.resolve(`${name}/package.json`); }
  catch (error) {
    if (!["ERR_PACKAGE_PATH_NOT_EXPORTED", "MODULE_NOT_FOUND"].includes(error.code)) throw error;
    return (req.resolve.paths(name) ?? []).map(base => path.join(base, name, "package.json")).find(fs.existsSync);
  }
}
function bundledSource(root) {
  const req = createRequire(path.join(root, "package.json"));
  const self = read(path.join(root, "package.json"));
  const sparkFile = self.name === "@legendapp/spark" ? path.join(root, "package.json") : resolveManifest(req, "@legendapp/spark");
  if (!sparkFile) return undefined;
  const spark = read(sparkFile);
  if (!spark.spark?.bundledModuleRoot && fs.realpathSync(sparkFile) !== fs.realpathSync(path.resolve(__dirname, "../desktop/package.json"))) return undefined;
  const directory = spark.spark?.bundledModuleRoot ? path.join(path.dirname(sparkFile), "patches") : path.resolve(__dirname, "../../patches");
  const file = path.join(directory, "registry.json");
  if (!fs.existsSync(file)) return undefined;
  return { registry: validateRegistry(read(file)), directory, sha: "bundled", sparkVersion: spark.version, sparkFile: fs.realpathSync(sparkFile) };
}
function sourceFor(root) {
  const bundled = bundledSource(root);
  if (!bundled) return undefined;
  if (sources.has(bundled.sparkFile)) return sources.get(bundled.sparkFile);
  if (process.env.SPARK_PATCH_REGISTRY_SOURCE) {
    const selected = JSON.parse(process.env.SPARK_PATCH_REGISTRY_SOURCE);
    object(selected, ["sparkFile", "sha", "directory"], "source");
    if (!/^[a-f0-9]{40}$/.test(selected.sha) || typeof selected.directory !== "string" || !path.isAbsolute(selected.directory) || path.basename(selected.directory) !== selected.sha) throw new Error("Invalid inherited patch registry source");
    if (selected.sparkFile === bundled.sparkFile) {
      const source = verifyFiles({ ...bundled, registry: validateRegistry(read(path.join(selected.directory, "registry.json"))), directory: selected.directory, sha: selected.sha });
      sources.set(bundled.sparkFile, source);
      return source;
    }
  }
  return bundled;
}
function readPatch(source, entry) {
  const bytes = source.bytes?.get(entry.patch) ?? fs.readFileSync(path.join(source.directory, entry.patch));
  if (hash(bytes) !== entry.sha256) throw new Error(`Patch registry hash mismatch: ${entry.patch}`);
  return Buffer.from(bytes);
}
function verifyFiles(source) {
  for (const library of Object.values(source.registry.libraries)) for (const entry of library.versions) {
    for (const [file, expected] of [[entry.patch, entry.sha256], [entry.sdkPatch, entry.sdkSha256]]) {
      if (file && hash(fs.readFileSync(path.join(source.directory, file))) !== expected) throw new Error(`Patch registry hash mismatch: ${file}`);
    }
  }
  return source;
}

async function fetchRegistry(root, { fetcher = globalThis.fetch, cache = path.join(process.env.SPARK_HOME || path.join(os.homedir(), ".spark"), "patch-registry"), notice = console.warn, writeCache = true } = {}) {
  const bundled = bundledSource(root);
  if (!bundled) return undefined;
  if (process.env.SPARK_PATCH_REGISTRY_SOURCE) {
    const inherited = sourceFor(root);
    if (inherited.sha !== "bundled") return inherited;
  }
  // A command uses one immutable snapshot, including nested native discovery calls.
  if (sources.has(bundled.sparkFile)) return sources.get(bundled.sparkFile);
  async function get(url) {
    const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(10000), headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }
  let sha, registryText, files;
  try {
    const head = JSON.parse(await get("https://api.github.com/repos/LegendApp/legend-spark/commits/main"));
    sha = head.sha;
    if (!/^[a-f0-9]{40}$/.test(sha)) throw Object.assign(new Error("Invalid GitHub commit SHA"), { registryMetadata: true });
    const directory = path.join(cache, sha);
    if (fs.existsSync(path.join(directory, "registry.json"))) {
      let source;
      try { source = verifyFiles({ ...bundled, registry: validateRegistry(read(path.join(directory, "registry.json"))), directory, sha }); }
      catch (error) { error.registryMetadata = true; throw error; }
      sources.set(bundled.sparkFile, source);
      return source;
    }
    registryText = await get(`https://raw.githubusercontent.com/LegendApp/legend-spark/${sha}/patches/registry.json`);
  } catch (error) {
    if (error.registryMetadata) throw error;
    notice(`Spark patch registry unavailable (${error.message}); using bundled patches.`);
    const source = verifyFiles(bundled);
    sources.set(bundled.sparkFile, source);
    return source;
  }
  // A reachable but malformed registry is a publisher error, never an offline fallback.
  let registry;
  try { registry = validateRegistry(JSON.parse(registryText)); }
  catch (error) { throw new Error(`Malformed GitHub patch registry: ${error.message}`); }
  files = [...new Set(Object.values(registry.libraries).flatMap(lib => lib.versions.flatMap(entry => [entry.patch, entry.sdkPatch]).filter(Boolean)))];
  const bytes = new Map();
  try {
    await Promise.all(files.map(async file => bytes.set(file, await get(`https://raw.githubusercontent.com/LegendApp/legend-spark/${sha}/patches/${file}`))));
  } catch (error) {
    notice(`Spark patch download failed (${error.message}); using bundled patches.`);
    const source = verifyFiles(bundled);
    sources.set(bundled.sparkFile, source);
    return source;
  }
  for (const library of Object.values(registry.libraries)) for (const entry of library.versions) {
    for (const [file, expected] of [[entry.patch, entry.sha256], [entry.sdkPatch, entry.sdkSha256]]) {
      if (file && hash(bytes.get(file)) !== expected) throw new Error(`GitHub patch hash mismatch: ${file}`);
    }
  }
  if (!writeCache) {
    const source = { ...bundled, registry, sha, bytes };
    sources.set(bundled.sparkFile, source);
    return source;
  }
  fs.mkdirSync(cache, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(cache, `${sha}-`));
  try {
    for (const [file, text] of bytes) { fs.mkdirSync(path.dirname(path.join(temporary, file)), { recursive: true }); fs.writeFileSync(path.join(temporary, file), text); }
    fs.writeFileSync(path.join(temporary, "registry.json"), registryText);
    try { fs.renameSync(temporary, path.join(cache, sha)); }
    catch (error) { if (!fs.existsSync(path.join(cache, sha, "registry.json"))) throw error; }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  const source = verifyFiles({ ...bundled, registry, sha, directory: path.join(cache, sha) });
  sources.set(bundled.sparkFile, source);
  return source;
}
function installedRegistryPackages(root, source) {
  const found = [], visited = new Set(), queue = [{ file: path.join(root, "package.json"), app: true }];
  while (queue.length) {
    const { file, app } = queue.shift();
    const real = fs.realpathSync(file);
    if (visited.has(real)) continue;
    visited.add(real);
    const pkg = read(real), directory = path.dirname(real);
    const req = createRequire(path.join(directory, pkg.spark?.bundledModuleRoot ?? ".", "package.json"));
    const dependencies = { ...pkg.dependencies, ...pkg.optionalDependencies, ...(app ? pkg.devDependencies : {}), ...Object.fromEntries(Object.keys(pkg.peerDependencies ?? {}).filter(name => !pkg.peerDependenciesMeta?.[name]?.optional).map(name => [name, true])) };
    if (!app && source.registry.libraries[pkg.name]) found.push({ name: pkg.name, version: pkg.version, file: real, root: directory });
    for (const name of Object.keys(dependencies)) {
      const dependency = resolveManifest(req, name);
      if (dependency) queue.push({ file: dependency, app: false });
    }
  }
  return found;
}
function sharedRoot(root, file) {
  const normalized = fs.realpathSync(file).split(path.sep), index = normalized.lastIndexOf("node_modules");
  // pnpm's virtual store is beneath the actual shared installation root.
  const first = normalized.indexOf("node_modules");
  const owner = index >= 0 ? normalized.slice(0, first).join(path.sep) || path.parse(file).root : root;
  const realRoot = fs.realpathSync(root);
  return fs.existsSync(path.join(owner, "package.json")) && (realRoot === owner || realRoot.startsWith(owner + path.sep))
    ? path.resolve(root, path.relative(realRoot, owner)) : root;
}
function installCommand(root, name, version) {
  const pkg = read(path.join(root, "package.json"));
  const manager = pkg.packageManager?.split("@")[0] ?? (["pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"].find(file => fs.existsSync(path.join(root, file)))?.split(/[.-]/)[0] || "npm");
  if (!["npm", "pnpm", "yarn", "bun"].includes(manager)) throw new Error(`Unsupported package manager: ${manager}`);
  return { manager, command: `${manager} ${manager === "npm" ? "install" : "add"}${manager === "npm" || manager === "yarn" ? " --exact" : " --save-exact"} ${name}@${version}` };
}
function patchDisabled(root, name, file) {
  const app = read(path.join(root, "package.json"));
  const owner = file ? sharedRoot(root, file) : root;
  const settings = read(path.join(owner, "package.json")).spark;
  validatePackageSettings(app.spark, root);
  validatePackageSettings(settings, owner);
  return app.spark?.patches?.[name] === false || settings?.patches?.[name] === false;
}
function registryFindings(root, source = sourceFor(root)) {
  if (!source) return [];
  const app = read(path.join(root, "package.json"));
  validatePackageSettings(app.spark, root);
  for (const name of Object.keys(app.spark?.patches ?? {})) if (!Object.hasOwn(source.registry.libraries, name)) throw new Error(`Unknown package.json spark.patches package: ${name}`);
  const findings = [];
  for (const pkg of installedRegistryPackages(root, source)) {
    const owner = sharedRoot(root, pkg.file), settings = read(path.join(owner, "package.json")).spark;
    validatePackageSettings(settings, owner);
    for (const name of Object.keys(settings?.patches ?? {})) if (!Object.hasOwn(source.registry.libraries, name)) throw new Error(`Unknown package.json spark.patches package: ${name}`);
    if (patchDisabled(root, pkg.name, pkg.file)) continue;
    const library = source.registry.libraries[pkg.name];
    const selected = selectPatch(library, pkg.version, source.sparkVersion);
    const latest = library.versions.filter(entry => entry.version === pkg.version).sort((a, b) => compareVersions(b.minSpark, a.minSpark))[0];
    const versions = [...new Set(library.versions.filter(entry => compareVersions(entry.minSpark, source.sparkVersion) <= 0).map(entry => entry.version))].sort((a, b) => compareVersions(b, a));
    if (!selected || latest && compareVersions(latest.minSpark, source.sparkVersion) > 0) {
      const target = versions[0];
      const fix = !selected && target ? installCommand(owner, pkg.name, target).command : "spark upgrade";
      findings.push({ ...pkg, owner, selected, latest, versions, fix, message: selected
        ? `${pkg.name}@${pkg.version} has a newer patch requiring Spark ${latest.minSpark} (installed ${source.sparkVersion}).`
        : `${pkg.name}@${pkg.version} has no patch compatible with Spark ${source.sparkVersion}.` });
    }
  }
  return findings;
}
function assertRegistryVersions(root) {
  const issues = registryFindings(root).filter(issue => !issue.selected);
  if (issues.length) throw new Error(issues.map(issue => `${issue.message}\nFix: cd ${JSON.stringify(issue.owner)} && ${issue.fix}`).join("\n"));
}
async function question(message) {
  const input = require("node:readline/promises").createInterface({ input: process.stdin, output: process.stdout });
  try { return await input.question(message); } finally { input.close(); }
}
async function ensurePatchRegistry(root, options = {}) {
  object(options, ["fetcher", "cache", "notice", "writeCache", "tty", "ask", "install"], "options");
  const source = await fetchRegistry(root, options);
  if (!source) return;
  if (source.sha !== "bundled") process.env.SPARK_PATCH_REGISTRY_SOURCE = JSON.stringify({ sparkFile: source.sparkFile, sha: source.sha, directory: source.directory });
  else delete process.env.SPARK_PATCH_REGISTRY_SOURCE;
  const tty = !process.env.SPARK_PATCH_REINSTALL && (options.tty ?? (!!process.stdin.isTTY && !process.env.CI));
  const ask = options.ask ?? question;
  const install = options.install ?? ((owner, manager) => {
    const result = spawnSync(manager, ["install"], { cwd: owner, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, SPARK_PATCH_REINSTALL: "1" } });
    if (result.error || result.status !== 0) throw new Error(`Patch version reinstall failed: ${result.error?.message ?? result.status}`);
  });
  const grouped = new Set(), reinstalls = new Map();
  for (const issue of registryFindings(root, source)) {
    const key = `${issue.owner}:${issue.name}`;
    if (grouped.has(key)) continue;
    grouped.add(key);
    const upgradeKey = `${key}:${source.sha}:${issue.latest?.minSpark}`;
    if (issue.latest && compareVersions(issue.latest.minSpark, source.sparkVersion) > 0 && !offeredUpgrades.has(upgradeKey)) {
      offeredUpgrades.add(upgradeKey);
      console.warn(`${issue.message}\nFix: spark upgrade`);
      if (tty && /^y(?:es)?$/i.test((await ask("Run spark upgrade? [y/N] ")).trim())) {
        const cli = createRequire(path.join(path.dirname(source.sparkFile), read(source.sparkFile).spark?.bundledModuleRoot ?? ".", "package.json")).resolve("@legendapp/spark-cli/dist/index.js");
        const result = spawnSync(process.execPath, [cli, "upgrade", "--project", root], { stdio: "inherit" });
        if (result.error || result.status !== 0) throw new Error("spark upgrade failed");
        throw new Error("Spark upgraded. Retry the command with the updated CLI.");
      }
    }
    if (issue.selected) continue;
    const fail = () => new Error(`${issue.message}\nFix: cd ${JSON.stringify(issue.owner)} && ${issue.fix}`);
    if (!tty || process.env.SPARK_PATCH_REINSTALL || !issue.versions.length) throw fail();
    console.log(`${issue.message}\nPatched versions: ${issue.versions.join(", ")}`);
    const answer = (await ask(`Install patched ${issue.name} [${issue.versions[0]}] (version or n to decline)? `)).trim();
    if (/^(n|no)$/i.test(answer)) throw fail();
    const version = answer || issue.versions[0];
    if (!issue.versions.includes(version)) throw new Error(`Choose a listed patched version for ${issue.name}: ${issue.versions.join(", ")}`);
    const ownerFile = path.join(issue.owner, "package.json"), pkg = read(ownerFile);
    let direct = false;
    for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) if (Object.hasOwn(pkg[field] ?? {}, issue.name)) { pkg[field][issue.name] = version; direct = true; }
    if (!direct) (pkg.dependencies ??= {})[issue.name] = version;
    const { manager } = installCommand(issue.owner, issue.name, version);
    const overrides = manager === "yarn" ? (pkg.resolutions ??= {}) : manager === "pnpm" ? ((pkg.pnpm ??= {}).overrides ??= {}) : (pkg.overrides ??= {});
    if (overrides[issue.name] && typeof overrides[issue.name] === "object") overrides[issue.name]["."] = version;
    else overrides[issue.name] = version;
    if (manager === "pnpm") {
      const sdk = read(source.sparkFile);
      const req = createRequire(path.join(path.dirname(source.sparkFile), sdk.spark?.bundledModuleRoot ?? ".", "package.json"));
      const cli = path.dirname(req.resolve("@legendapp/spark-cli/package.json"));
      const { pathToFileURL } = require("node:url");
      const { writePackageConfig } = await import(pathToFileURL(path.join(cli, "dist/package-manager-config.js")).href);
      writePackageConfig(issue.owner, pkg, manager);
    } else fs.writeFileSync(ownerFile, JSON.stringify(pkg, null, 2) + "\n");
    reinstalls.set(issue.owner, manager);
  }
  for (const [owner, manager] of reinstalls) await install(owner, manager);
  assertRegistryVersions(root);
}
function patchSourceSHA(root) { return sourceFor(root)?.sha ?? "bundled"; }
module.exports = { validateRegistry, compareVersions, selectPatch, bundledSource, sourceFor, fetchRegistry, installedRegistryPackages, registryFindings, assertRegistryVersions, ensurePatchRegistry, patchSourceSHA, patchDisabled, readPatch, hash };
