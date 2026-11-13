const platforms = ["macos", "windows", "ios", "android", "web"];
function object(value, name, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  if (keys) for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`Unknown ${name} field: ${key}`);
}
function validatePlatforms(value) {
  if (!Array.isArray(value) || !value.length || new Set(value).size !== value.length || value.some(p => !platforms.includes(p))) throw new Error("platforms must list unique supported targets: macos, windows, ios, android, web");
  return value;
}
function validateOwned(value) {
  if (value.macos !== undefined) {
    object(value.macos, "macos", ["bundleIdentifier", "buildNumber", "entitlements", "infoPlist", "testDriverInRelease", "lifecycle"]);
    if (typeof value.macos.bundleIdentifier !== "string" || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value.macos.bundleIdentifier)) throw new Error("macos.bundleIdentifier must be a reverse-DNS identifier");
    if (value.macos.buildNumber !== undefined && typeof value.macos.buildNumber !== "string") throw new Error("macos.buildNumber must be a string");
    if (value.macos.testDriverInRelease !== undefined && typeof value.macos.testDriverInRelease !== "boolean") throw new Error("macos.testDriverInRelease must be a boolean");
    for (const key of ["entitlements", "infoPlist"]) if (value.macos[key] !== undefined) object(value.macos[key], `macos.${key}`);
    require("./lifecycle.cjs").validateLifecycle(value.macos.lifecycle);
  }
  if (value.documentTypes !== undefined) {
    if (!Array.isArray(value.documentTypes)) throw new Error("documentTypes must be an array");
    for (const document of value.documentTypes) object(document, "documentType", ["name", "contentTypes", "role"]);
  }
  if (value.signing !== undefined) {
    object(value.signing, "signing", ["macos"]);
    const macos = value.signing.macos;
    if (macos !== undefined) {
      object(macos, "signing.macos", ["identity", "teamId", "entitlementsByPath"]);
      for (const key of ["identity", "teamId"]) if (macos[key] !== undefined && (typeof macos[key] !== "string" || !macos[key].trim())) throw new Error(`signing.macos.${key} must be a nonempty string`);
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
  if (platform === "windows" && value.window?.macos !== undefined) throw new Error("window.macos options require macOS");
  if (platform === "windows" && value.window?.titleBarStyle === "overlay") throw new Error("Windows does not support overlay title bars");
  if (value.include !== undefined && (!Array.isArray(value.include) || value.include.some(name => typeof name !== "string"))) throw new Error("include must be a list of package names");
  if (value.supportedPlatforms !== undefined) validatePlatforms(value.supportedPlatforms);
  require("./helpers.cjs").validateHelpers(value.helpers);
  require("./customize.cjs").validateCustomize(value.customize);
  require("./updates.cjs").updateConfiguration({ extra: { spark: value } });
}
function validatePackageSettings(value) {
  if (value === undefined) return;
  object(value, "package.json spark", ["sdk", "nativeModules", "pod", "platforms", "requires", "testOnly", "entitlements", "patches", "bundledModules", "bundledModuleRoot", "windowsAdapter", "patchHash", "upstreamIntegrity", "upstreamRevision", "workspacePatch", "dependencyPatch", "nativePatchRequirements"]);
  for (const key of ["sdk", "testOnly", "windowsAdapter"]) if (value[key] !== undefined && typeof value[key] !== "boolean") throw new Error(`package.json spark.${key} must be boolean`);
  for (const key of ["requires", "bundledModules"]) if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].some(name => typeof name !== "string" || !name.length))) throw new Error(`package.json spark.${key} must list nonempty strings`);
  for (const key of ["pod", "bundledModuleRoot"]) if (value[key] !== undefined && (typeof value[key] !== "string" || !value[key].length)) throw new Error(`package.json spark.${key} must be a nonempty string`);
  if (value.platforms !== undefined) validatePlatforms(value.platforms);
  if (value.entitlements !== undefined) {
    object(value.entitlements, "package.json spark.entitlements", ["macos"]);
    if (value.entitlements.macos !== undefined) object(value.entitlements.macos, "package.json spark.entitlements.macos");
  }
  if (value.patches !== undefined) {
    object(value.patches, "package.json spark.patches");
    for (const [name, enabled] of Object.entries(value.patches)) if (typeof enabled !== "boolean") throw new Error(`package.json spark.patches.${name} must be boolean`);
  }
}
module.exports = { validateOwned, validatePlatforms, validateSettings, validatePackageSettings };
