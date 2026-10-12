const platforms = ["macos", "windows", "ios", "android", "web"];
function object(value, name, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  if (keys) for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`Unknown ${name} field: ${key}`);
}
function validatePlatforms(value) {
  if (!Array.isArray(value) || !value.length || new Set(value).size !== value.length || value.some(p => !platforms.includes(p))) throw new Error("platforms must list unique supported targets: macos, windows, ios, android, web");
  return value;
}
// The languages of Spark's own native strings (packages/desktop-app/macos/Localization; tests/framework-strings.test.ts).
const FRAMEWORK_LANGUAGES = ["ar", "en", "fr"];
const warned = new Set();
/** In a listed language Spark has no strings for, AppKit's menu items follow it and Spark's stay English: a mixed menu. */
function warnUntranslated(languages) {
  const missing = languages.filter(language => !FRAMEWORK_LANGUAGES.includes(language.split(/[-_]/)[0].toLowerCase()) && !warned.has(language));
  if (!missing.length) return;
  for (const language of missing) warned.add(language);
  console.warn(`localizations lists ${missing.join(", ")}, which Spark's own native strings (menus, dialog defaults) are not translated into; they show in English there while AppKit's follow the language. Spark has ${FRAMEWORK_LANGUAGES.join(", ")}.`);
}
function validateOwned(value) {
  if (value.macos !== undefined) {
    object(value.macos, "macos", ["bundleIdentifier", "buildNumber", "icon", "entitlements", "infoPlist", "testDriverInRelease", "testDriverPrivateEvents", "lifecycle"]);
    if (typeof value.macos.bundleIdentifier !== "string" || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value.macos.bundleIdentifier)) throw new Error("macos.bundleIdentifier must be a reverse-DNS identifier");
    if (value.macos.buildNumber !== undefined && typeof value.macos.buildNumber !== "string") throw new Error("macos.buildNumber must be a string");
    if (value.macos.icon !== undefined && (typeof value.macos.icon !== "string" || !value.macos.icon.trim())) throw new Error("macos.icon must be a path to a PNG or an Icon Composer .icon document");
    for (const key of ["testDriverInRelease", "testDriverPrivateEvents"]) if (value.macos[key] !== undefined && typeof value.macos[key] !== "boolean") throw new Error(`macos.${key} must be a boolean`);
    for (const key of ["entitlements", "infoPlist"]) if (value.macos[key] !== undefined) object(value.macos[key], `macos.${key}`);
    require("./lifecycle.cjs").validateLifecycle(value.macos.lifecycle);
  }
  if (value.localizations !== undefined) {
    const languages = value.localizations;
    if (!Array.isArray(languages) || !languages.length || new Set(languages).size !== languages.length || languages.some(language => typeof language !== "string" || !/^[A-Za-z]{2,3}([-_][A-Za-z0-9]+)*$/.test(language))) throw new Error("localizations must list unique language identifiers such as en, ar or pt-BR");
    if (value.macos?.infoPlist?.CFBundleLocalizations !== undefined || value.macos?.infoPlist?.CFBundleDevelopmentRegion !== undefined) throw new Error("Declare the app's languages with localizations, not macos.infoPlist");
    warnUntranslated(languages);
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
module.exports = { validateOwned, validatePlatforms, FRAMEWORK_LANGUAGES };
