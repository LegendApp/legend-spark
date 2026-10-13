const fs = require("node:fs");
const path = require("node:path");
const { gate } = require("./metro-gate.cjs");
// @legendapp/spark/runtime-entry (packages/desktop/runtime-entry.cjs) requires this worker registry stub.
const REGISTRY = ["@legendapp/spark-cli/dist/runtime-entry.cjs", "@legendapp/spark-cli/src/runtime-entry.cjs"];

// Production discovery omits the registry: otherwise scanning an unused task
// would itself make that task (and all its native dependencies) reachable.
// Development discovers from Metro's graphs as the app bundles (graphDiscovery).
function runtimePlan(root, env = process.env) {
  if (env.SPARK_RUNTIME_DISCOVERY === "1") return { enabled: false, roots: [] };
  if (env.SPARK_RUNTIME_SOURCES) {
    const sources = JSON.parse(fs.readFileSync(env.SPARK_RUNTIME_SOURCES, "utf8"));
    return { enabled: sources.enabled, roots: sources.roots, production: true };
  }
  return { enabled: true, roots: [] };
}
// Text that a file registering threaded components or runtime functions contains (the upstream scanner's forms:
// threadedComponent(...), runtimeFunction(...), <OnRuntime>, and a function whose first statement names a runtime).
const REGISTERS = /\bthreadedComponent\b|\bruntimeFunction\b|<OnRuntime\b|\{\s*(["'])(?!use strict\1|worklet\1|threaded\1|use asm\1)[^"'\\\n]+\1\s*[;\n]/;
const RUNTIMES = /["']@react-native-runtimes\/core["']/;
/**
 * Registers what the app's bundles reach, as production does (build.ts): app files, and dependency files that import
 * Runtimes, that may register. Called with each Metro graph update (serializer.experimentalSerializerHook), so a
 * threaded component added under Fast Refresh is registered when the app imports it. `roots` were generated last.
 */
function graphDiscovery({ root, generatedEntry, generate, roots = [], watch = true }) {
  const real = fs.realpathSync(root), core = `${path.sep}@react-native-runtimes${path.sep}core${path.sep}`;
  const entries = new Set([generatedEntry, path.join(real, path.relative(root, generatedEntry))]);
  const inApp = file => !path.relative(real, file).startsWith("..") && !file.includes(`${path.sep}node_modules${path.sep}`);
  const registers = new WeakMap();
  const candidate = (file, module) => {
    if (!registers.has(module)) {
      const source = /\.[jt]sx?$/.test(file) && !file.endsWith(".d.ts") && !file.includes(core) ? module.getSource().toString("utf8") : "";
      registers.set(module, REGISTERS.test(source) && (inApp(file) || RUNTIMES.test(source)));
    }
    return registers.get(module);
  };
  const graphs = new Map();
  let generated = JSON.stringify(roots);
  return (graph, delta) => {
    // The worker bundle's own graph holds what is registered, not what the app reaches.
    if ([...graph.entryPoints].some(file => entries.has(file))) return;
    if (!delta.reset && (!watch || !delta.added.size && !delta.modified.size && !delta.deleted.size)) return;
    const found = new Set([...graph.dependencies].filter(([file, module]) => candidate(file, module)).map(([file]) => file));
    graphs.set(JSON.stringify([[...graph.entryPoints], graph.transformOptions]), found);
    const next = [...new Set([...graphs.values()].flatMap(files => [...files]))].sort();
    // A reset (a new graph) adds every file; the entry was generated from the current sources of `roots` already.
    const touched = !delta.reset && [...delta.added.keys(), ...delta.modified.keys()].some(file => found.has(file));
    if (JSON.stringify(next) === generated && !touched) return;
    generated = JSON.stringify(next);
    generate(next);
  };
}
function withDesktop(config, options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("Expected desktop Metro options");
  for (const [key, value] of Object.entries(options)) {
    if (!["runtimes", "watch"].includes(key)) throw new Error(`Unknown desktop Metro option: ${key}`);
    if (value !== undefined && typeof value !== "boolean") throw new Error(`${key} must be boolean`);
  }
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
  if (plan.enabled && plan.production) {
    config = withThreadedRuntime(config, { roots: plan.roots, watch: false });
    // Production roots come from Metro's resolved graph, including worker files
    // shipped by dependencies. Do not register unrelated index.<name>.ts files.
    generateThreadedRuntimeEntry({ projectRoot: root, generatedEntry, roots: plan.roots, runtimeEntries: [] });
  } else if (plan.enabled) {
    // Development workers load the generated entry's own bundle; the app's bundle keeps the stub, so a registration
    // change does not reload the app. The last discovered roots seed a new Metro process (for example a separate
    // export of the worker entry) until the app's graph is built.
    const known = path.join(path.dirname(generatedEntry), "roots.json");
    const roots = fs.existsSync(known) ? JSON.parse(fs.readFileSync(known, "utf8")).filter(file => fs.existsSync(file)) : [];
    config = withThreadedRuntime(config, { roots, watch: false });
    const discover = graphDiscovery({ root, generatedEntry, roots, watch: options.watch, generate(next) {
      generateThreadedRuntimeEntry({ projectRoot: root, generatedEntry, roots: next });
      fs.writeFileSync(known, `${JSON.stringify(next, null, 2)}\n`);
    } });
    const hook = config.serializer?.experimentalSerializerHook;
    config = { ...config, serializer: { ...config.serializer, experimentalSerializerHook(graph, delta) {
      discover(graph, delta);
      hook?.(graph, delta);
    } } };
  } else {
    config = { ...config, transformer: { ...config.transformer,
      babelTransformerPath: path.join(path.dirname(core), "metro-transformer.js") } };
  }
  const resolveRequest = config.resolver?.resolveRequest;
  const enhanceMiddleware = config.server?.enhanceMiddleware;
  return { ...config,
    resolver: { ...config.resolver, resolveRequest(context, name, platform) {
      if (REGISTRY.includes(name)) return { type: "sourceFile", filePath: plan.enabled && plan.production ? generatedEntry : path.join(__dirname, "runtime-entry.cjs") };
      return resolveRequest ? resolveRequest(context, name, platform) : context.resolveRequest(context, name, platform);
    } },
    server: { ...config.server, enhanceMiddleware(middleware, server) {
      return gate(root, enhanceMiddleware ? enhanceMiddleware(middleware, server) : middleware);
    } },
  };
}
module.exports = { withDesktop, runtimePlan, graphDiscovery };
