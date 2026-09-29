function updateConfiguration(expo) {
  const updates = expo.extra?.spark?.updates;
  if (updates === undefined) return undefined;
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) throw new Error("extra.spark.updates must be an object");
  for (const key of Object.keys(updates)) if (!["feedURL", "publicKey"].includes(key)) throw new Error(`Unknown updates field: ${key}`);
  let url;
  try { url = new URL(updates.feedURL); } catch { throw new Error("Updates need an HTTPS feedURL"); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash || !url.pathname.endsWith(".xml")) throw new Error("Update feedURL must be an HTTPS .xml URL without credentials, query or fragment");
  if (typeof updates.publicKey !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(updates.publicKey) || Buffer.from(updates.publicKey, "base64").length !== 32) throw new Error("Updates need a base64 Ed25519 publicKey; run spark updates init <feedURL>");
  return { feedURL: url.href, publicKey: updates.publicKey };
}
function updatePlist(expo) {
  const updates = updateConfiguration(expo);
  return updates ? {
    SUFeedURL: updates.feedURL,
    SUPublicEDKey: updates.publicKey,
    SUEnableAutomaticChecks: false,
    SUAutomaticallyUpdate: false,
    SUAllowsAutomaticUpdates: false,
    SUEnableSystemProfiling: false,
    SURequireSignedFeed: true,
    SUVerifyUpdateBeforeExtraction: true,
  } : {};
}
module.exports = { updateConfiguration, updatePlist };
