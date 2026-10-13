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
module.exports = { mergeEntitlements, resolveEntitlements, authenticationEntitlements, captureEntitlements };
