const fs = require("node:fs");
const path = require("node:path");
const { gate } = require("./metro-gate.cjs");
const ENTRY = "@legendapp/spark/runtime-entry";

// Production discovery omits the registry: otherwise scanning an unused task
// would itself make that task (and all its native dependencies) reachable.
function runtimePlan(root, env = process.env) {
  if (env.SPARK_RUNTIME_DISCOVERY === "1") return { enabled: false, roots: [] };
  if (env.SPARK_RUNTIME_SOURCES) {
    const sources = JSON.parse(fs.readFileSync(env.SPARK_RUNTIME_SOURCES, "utf8"));
    return { enabled: sources.enabled, roots: sources.roots, production: true };
  }
  return { enabled: true, roots: fs.readdirSync(root, { withFileTypes: true })
    .filter(e => e.isFile() && /\.[jt]sx?$/.test(e.name) && !/^(metro|babel|react-native)\.config\./.test(e.name))
    .map(e => e.name).concat(["src"]) };
}
function withDesktop(config, options = {}) {
  // Expo 54 sets the react-native export condition only for iOS/Android.
  // Desktop must also select native package exports (e.g. Uniwind's runtime).
  const conditions = { ...config.resolver?.unstable_conditionsByPlatform };
  for (const platform of ["macos", "windows"]) {
    conditions[platform] = [...new Set([...(conditions[platform] || []), "react-native"])];
  }
  config = { ...config, resolver: { ...config.resolver, unstable_conditionsByPlatform: conditions } };
  const root = path.resolve(config.projectRoot || process.cwd());
  // Keep the configured workspace root so lazy imports outside the app have
  // valid URLs. Only the prebuilt host's fixed entry URLs are app-relative.
  const serverRoot = path.resolve(config.server?.unstable_serverRoot || root);
  const entryPrefix = path.relative(serverRoot, root).split(path.sep).map(encodeURIComponent).join("/");
  if (entryPrefix && (entryPrefix === ".." || entryPrefix.startsWith("../"))) {
    throw new Error("Metro's server root must contain the Spark project");
  }
  const rewrite = config.server?.rewriteRequestUrl;
  config = { ...config, server: { ...config.server, unstable_serverRoot: serverRoot,
    rewriteRequestUrl(value) {
      const url = new URL(value, "http://localhost");
      const platform = url.searchParams.get("platform");
      if (entryPrefix && (!platform || ["macos", "windows"].includes(platform)) &&
          /^\/(index|\.threaded-runtime\/entry)\.(bundle|map|delta)$/.test(url.pathname)) {
        url.pathname = `/${entryPrefix}${url.pathname}`;
        value = value.startsWith("/") ? `${url.pathname}${url.search}${url.hash}` : url.href;
      }
      return rewrite ? rewrite(value) : value;
    },
  } };
  let core;
  try { core = require.resolve("@react-native-runtimes/core/metro", { paths: [root] }); } catch {}
  if (!core || options.runtimes === false) {
    const enhance = config.server?.enhanceMiddleware;
    return { ...config, server: { ...config.server, enhanceMiddleware(middleware, server) {
      return gate(root, enhance ? enhance(middleware, server) : middleware);
    } } };
  }
  const { withThreadedRuntime, generateThreadedRuntimeEntry } = require(core);
  const plan = runtimePlan(root);
  const generatedEntry = path.join(root, ".threaded-runtime/entry.js");
  if (plan.enabled) {
    config = withThreadedRuntime(config, { ...options, roots: plan.roots, watch: plan.production ? false : options.watch });
    // Production roots come from Metro's resolved graph, including worker files
    // shipped by dependencies. Do not register unrelated index.<name>.ts files.
    if (plan.production) generateThreadedRuntimeEntry({ projectRoot: root, generatedEntry, roots: plan.roots, runtimeEntries: [] });
  } else {
    config = { ...config, transformer: { ...config.transformer,
      babelTransformerPath: path.join(path.dirname(core), "metro-transformer.js") } };
  }
  const resolveRequest = config.resolver?.resolveRequest;
  const enhanceMiddleware = config.server?.enhanceMiddleware;
  return { ...config,
    resolver: { ...config.resolver, resolveRequest(context, name, platform) {
      if (name === ENTRY || name === "@legendapp/spark-cli/src/runtime-entry.cjs") return { type: "sourceFile", filePath: plan.enabled ? generatedEntry : path.join(__dirname, "runtime-entry.cjs") };
      return resolveRequest ? resolveRequest(context, name, platform) : context.resolveRequest(context, name, platform);
    } },
    server: { ...config.server, enhanceMiddleware(middleware, server) {
      return gate(root, enhanceMiddleware ? enhanceMiddleware(middleware, server) : middleware);
    } },
  };
}
module.exports = { withDesktop, runtimePlan };
