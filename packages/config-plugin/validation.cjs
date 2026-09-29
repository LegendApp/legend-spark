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
    object(value.macos, "macos", ["bundleIdentifier", "buildNumber", "entitlements", "infoPlist", "lifecycle"]);
    if (typeof value.macos.bundleIdentifier !== "string" || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value.macos.bundleIdentifier)) throw new Error("macos.bundleIdentifier must be a reverse-DNS identifier");
    if (value.macos.buildNumber !== undefined && typeof value.macos.buildNumber !== "string") throw new Error("macos.buildNumber must be a string");
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
module.exports = { validateOwned, validatePlatforms };
