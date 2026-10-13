function mergeEntitlements(...sources) {
  const result = {};
  for (const source of sources) {
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("Entitlements must be an object.");
    for (const [key, value] of Object.entries(source)) {
      if (value === null || !["boolean", "string", "number", "object"].includes(typeof value)) throw new Error(`Invalid entitlement: ${key}`);
      if (key in result && JSON.stringify(result[key]) !== JSON.stringify(value)) {
        if (Array.isArray(result[key]) && Array.isArray(value)) result[key] = [...new Set([...result[key], ...value])];
        else throw new Error(`Conflicting entitlement requirements: ${key}`);
      } else result[key] = value;
    }
  }
  return result;
}

// macos.authentication: the restricted entitlements Sign in with Apple and passkeys need, only when the app asks for them
// (docs/authentication.md#entitlements). Both need a team-signed build with a provisioning profile.
function authenticationEntitlements(authentication) {
  const result = {};
  if (authentication?.signInWithApple) result["com.apple.developer.applesignin"] = ["Default"];
  if (authentication?.passkeyDomains?.length) result["com.apple.developer.associated-domains"] = authentication.passkeyDomains.map((domain) => `webcredentials:${domain}`);
  return result;
}

// macos.capture: the hardened-runtime entitlements the camera and microphone need (docs/capture.md#entitlements), only
// when the app asks for them.
function captureEntitlements(capture) {
  const result = {};
  if (capture?.camera) result["com.apple.security.device.camera"] = true;
  if (capture?.microphone) result["com.apple.security.device.audio-input"] = true;
  return result;
}

function resolveEntitlements(config, packages) {
  const expo = config.expo ?? config;
  return mergeEntitlements(
    ...packages.map((pkg) => pkg.spark?.entitlements?.macos ?? {}),
    authenticationEntitlements(expo.macos?.authentication),
    captureEntitlements(expo.macos?.capture),
    expo.macos?.entitlements ?? {},
  );
}
// macos.sandbox: the App Sandbox (Mac App Store style) variant, made by spark build --sandbox (docs/app-sandbox.md).
const APP_SANDBOX = "com.apple.security.app-sandbox", INHERIT = "com.apple.security.inherit";
/** What every process of the variant other than the main executable carries: Apple requires exactly these two. */
const SANDBOX_INHERIT = Object.freeze({ [APP_SANDBOX]: true, [INHERIT]: true });
/** The native packages the variant leaves out: Sparkle, whose updater the App Store replaces. */
const SANDBOX_EXCLUDED = Object.freeze(["@legendapp/spark-updates"]);
const SANDBOX_KEY = /^com\.apple\.security\.[A-Za-z0-9.-]+$/;
function validateSandbox(sandbox) {
  if (sandbox === undefined) return;
  if (!sandbox || typeof sandbox !== "object" || Array.isArray(sandbox)) throw new Error("macos.sandbox must be an object");
  for (const key of Object.keys(sandbox)) if (key !== "entitlements") throw new Error(`Unknown macos.sandbox field: ${key}`);
  const entitlements = sandbox.entitlements ?? {};
  if (!entitlements || typeof entitlements !== "object" || Array.isArray(entitlements)) throw new Error("macos.sandbox.entitlements must be an object");
  for (const [key, value] of Object.entries(entitlements)) {
    if (!SANDBOX_KEY.test(key)) throw new Error(`macos.sandbox.entitlements: ${key} is not an App Sandbox entitlement (com.apple.security.*); put other entitlements in macos.entitlements`);
    if (key === APP_SANDBOX || key === INHERIT) throw new Error(`macos.sandbox.entitlements: ${key} is implied by the sandbox variant; remove it`);
    if (value === null || !["boolean", "string", "object"].includes(typeof value)) throw new Error(`macos.sandbox.entitlements: invalid value for ${key}`);
  }
}
/** The sandbox variant's main executable: the app's entitlements, macos.sandbox.entitlements, and app-sandbox. */
function sandboxEntitlements(config, appEntitlements) {
  const sandbox = (config.expo ?? config).macos?.sandbox;
  if (!sandbox) throw new Error("A sandboxed build needs macos.sandbox in the app's configuration (docs/app-sandbox.md)");
  return mergeEntitlements(appEntitlements, sandbox.entitlements ?? {}, { [APP_SANDBOX]: true });
}
module.exports = { mergeEntitlements, resolveEntitlements, authenticationEntitlements, captureEntitlements, validateSandbox, sandboxEntitlements, SANDBOX_INHERIT, SANDBOX_EXCLUDED };
