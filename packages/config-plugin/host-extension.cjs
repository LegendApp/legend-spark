
// Keep Spark's runtime/bootstrap implementation as the superclass. This is an
// escape hatch for an existing native host during incremental adoption, not a
// replacement for the framework's public window and lifecycle contracts.
function composeHostExtension(host, source, header) {
  const implementation = /@implementation AppDelegate\b/g;
  if ((host.match(implementation) || []).length !== 1 || (source.match(implementation) || []).length !== 1)
    throw new Error("Host extension needs exactly one AppDelegate implementation");
  if (!/@interface AppDelegate\s*:\s*RCTAppDelegate\b/.test(header))
    throw new Error("Host extension header must declare AppDelegate : RCTAppDelegate");
  return {
    source: `${host.replace(implementation, "@implementation SparkAppDelegate")}\n${source}\n`,
    header: header.replace(/@interface AppDelegate\s*:\s*RCTAppDelegate\b/,
      "@interface SparkAppDelegate : RCTAppDelegate\n@end\n\n@interface AppDelegate : SparkAppDelegate"),
  };
}
function withHostExtension(config, options) {
  if (!options || typeof options.source !== "string" || typeof options.header !== "string")
    throw new Error("Host extension requires source and header paths");
  config.extra ??= {};
  config.extra.spark ??= {};
  config.extra.spark.hostExtension = options;
  return config;
}
module.exports = withHostExtension;
module.exports.composeHostExtension = composeHostExtension;
