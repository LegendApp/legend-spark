class SparkError extends Error {
  constructor(message, code = "E_INVALID_ARGUMENT") {
    super(message);
    this.name = "SparkError";
    this.code = code;
  }
}
const platforms = ["macos", "windows", "ios", "android", "web"];
function object(value, name, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SparkError(`${name} must be an object`);
  if (keys) for (const key of Object.keys(value)) if (!keys.includes(key)) throw new SparkError(`Unknown ${name} field: ${key}`, "E_UNSUPPORTED_OPTION");
}
function validatePlatforms(value) {
  if (!Array.isArray(value) || !value.length || new Set(value).size !== value.length || value.some(p => !platforms.includes(p))) throw new SparkError("platforms must list unique supported targets: macos, windows, ios, android, web");
  return value;
}
function validateOwned(value) {
  if (value.macos !== undefined) {
    object(value.macos, "macos", ["bundleIdentifier", "buildNumber", "entitlements", "infoPlist", "testDriverInRelease", "lifecycle"]);
    if (typeof value.macos.bundleIdentifier !== "string" || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value.macos.bundleIdentifier)) throw new SparkError("macos.bundleIdentifier must be a reverse-DNS identifier");
    if (value.macos.buildNumber !== undefined && typeof value.macos.buildNumber !== "string") throw new SparkError("macos.buildNumber must be a string");
    if (value.macos.testDriverInRelease !== undefined && typeof value.macos.testDriverInRelease !== "boolean") throw new SparkError("macos.testDriverInRelease must be a boolean");
    for (const key of ["entitlements", "infoPlist"]) if (value.macos[key] !== undefined) object(value.macos[key], `macos.${key}`);
    require("./lifecycle.cjs").validateLifecycle(value.macos.lifecycle);
  }
  if (value.documentTypes !== undefined) {
    if (!Array.isArray(value.documentTypes)) throw new SparkError("documentTypes must be an array");
    for (const document of value.documentTypes) object(document, "documentType", ["name", "contentTypes", "role"]);
  }
  if (value.signing !== undefined) {
    object(value.signing, "signing", ["macos"]);
    const macos = value.signing.macos;
    if (macos !== undefined) {
      object(macos, "signing.macos", ["identity", "teamId", "entitlementsByPath"]);
      for (const key of ["identity", "teamId"]) if (macos[key] !== undefined && (typeof macos[key] !== "string" || !macos[key].trim())) throw new SparkError(`signing.macos.${key} must be a nonempty string`);
      if (macos.entitlementsByPath !== undefined) {
        object(macos.entitlementsByPath, "entitlementsByPath");
        for (const [path, entitlements] of Object.entries(macos.entitlementsByPath)) object(entitlements, `entitlementsByPath.${path}`);
      }
    }
  }
}
function validateSettings(value, platform) {
  if (value === undefined) return;
  object(value, "extra.spark", ["projectId", "window", "documentTypes", "menuBarOnly", "updates", "include", "signing", "helpers", "customize", "supportedPlatforms"]);
  validateOwned(value);
  require("@legendapp/spark-window-options").validateWindow(value.window ?? {});
  if (platform === "windows" && value.window?.titleBarStyle === "overlay") throw new SparkError("Windows does not support overlay title bars");
  if (value.include !== undefined && (!Array.isArray(value.include) || value.include.some(name => typeof name !== "string"))) throw new SparkError("include must be a list of package names");
  if (value.supportedPlatforms !== undefined) validatePlatforms(value.supportedPlatforms);
  require("./helpers.cjs").validateHelpers(value.helpers);
  require("./customize.cjs").validateCustomize(value.customize);
  require("./updates.cjs").updateConfiguration({ extra: { spark: value } });
}
function validatePackageSettings(value, root) {
  if (value === undefined) return;
  object(value, "package.json spark", ["sdk", "nativeModules", "requires", "testOnly", "entitlements", "patches", "bundledModules", "bundledModuleRoot", "patchHash", "upstreamIntegrity", "upstreamRevision", "workspacePatch", "dependencyPatch", "nativePatchRequirements"]);
  for (const key of ["sdk", "testOnly"]) if (value[key] !== undefined && typeof value[key] !== "boolean") throw new SparkError(`package.json spark.${key} must be boolean`);
  for (const key of ["requires", "bundledModules"]) if (value[key] !== undefined && (!Array.isArray(value[key]) || new Set(value[key]).size !== value[key].length || value[key].some(name => typeof name !== "string" || !name.trim()))) throw new SparkError(`package.json spark.${key} must list nonempty strings`);
  if (value.nativeModules !== undefined && value.nativeModules !== true) throw new SparkError("package.json spark.nativeModules must be true; native binding names come from codegen");
  for (const key of ["bundledModuleRoot", "patchHash", "upstreamIntegrity", "upstreamRevision"]) if (value[key] !== undefined && (typeof value[key] !== "string" || !value[key].length)) throw new SparkError(`package.json spark.${key} must be a nonempty string`);
  if (value.bundledModuleRoot !== undefined) {
    const path = require("node:path"), fs = require("node:fs");
    const directory = path.resolve(root, value.bundledModuleRoot);
    if (path.isAbsolute(value.bundledModuleRoot) || value.bundledModuleRoot.includes("\\") || path.relative(root, directory).split(path.sep).includes("..") || !fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) throw new SparkError("package.json spark.bundledModuleRoot must name a directory inside its package");
  }
  for (const key of ["workspacePatch", "dependencyPatch"]) if (value[key] !== undefined) {
    const receipt = value[key];
    object(receipt, `package.json spark.${key}`, ["schema", "version", "patchHash", "appPatchHash", "appRoot", "upstreamIntegrity", "upstreamRevision"]);
    if (receipt.schema !== undefined && receipt.schema !== 1) throw new SparkError(`package.json spark.${key}.schema must be 1`);
    for (const field of ["version", "patchHash", "appPatchHash", "appRoot", "upstreamIntegrity", "upstreamRevision"]) if (receipt[field] !== undefined && (typeof receipt[field] !== "string" || !receipt[field].length)) throw new SparkError(`package.json spark.${key}.${field} must be a nonempty string`);
  }
  if (value.nativePatchRequirements !== undefined) {
    const requirements = value.nativePatchRequirements;
    object(requirements, "package.json spark.nativePatchRequirements", ["schema", "frameworkVersion", "packages"]);
    if (requirements.schema !== 1 || typeof requirements.frameworkVersion !== "string" || !requirements.frameworkVersion.length) throw new SparkError("package.json spark.nativePatchRequirements needs schema 1 and frameworkVersion");
    object(requirements.packages, "package.json spark.nativePatchRequirements.packages");
    for (const [name, record] of Object.entries(requirements.packages)) {
      object(record, `package.json spark.nativePatchRequirements.packages.${name}`, ["version", "patchHash", "upstreamIntegrity", "upstreamRevision"]);
      for (const field of ["version", "patchHash"]) if (typeof record[field] !== "string" || !record[field].length) throw new SparkError(`package.json spark.nativePatchRequirements.packages.${name}.${field} must be a nonempty string`);
      for (const field of ["upstreamIntegrity", "upstreamRevision"]) if (record[field] !== undefined && (typeof record[field] !== "string" || !record[field].length)) throw new SparkError(`package.json spark.nativePatchRequirements.packages.${name}.${field} must be a nonempty string`);
    }
  }
  if (value.entitlements !== undefined) {
    object(value.entitlements, "package.json spark.entitlements", ["macos"]);
    if (value.entitlements.macos !== undefined) object(value.entitlements.macos, "package.json spark.entitlements.macos");
  }
  if (value.patches !== undefined) {
    object(value.patches, "package.json spark.patches");
    for (const [name, enabled] of Object.entries(value.patches)) if (typeof enabled !== "boolean") throw new SparkError(`package.json spark.patches.${name} must be boolean`);
  }
}
module.exports = { SparkError, validateOwned, validatePlatforms, validateSettings, validatePackageSettings };
