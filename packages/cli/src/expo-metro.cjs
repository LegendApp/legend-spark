const { createRequire } = require('node:module');
const path = require('node:path');
const defaults = new Map();
const desktopSession = () => process.env.SPARK_DEV_SESSION === '1' || ['macos', 'windows'].includes(process.env.SPARK_PLATFORM);

// A drop-in getDefaultConfig import: let upstream supply each target's defaults
// before the application's existing Metro customizations are applied.
exports.getDefaultConfig = (root, ...options) => {
  const requireApp = createRequire(path.join(root, 'package.json'));
  const config = desktopSession()
    ? requireApp('expo-desktop-metro-config').makeMetroConfig(root, ...options)
    : requireApp('expo/metro-config').getDefaultConfig(root, ...options);
  defaults.set(path.resolve(root), { resolveRequest: config.resolver.resolveRequest, rewriteRequestUrl: config.server?.rewriteRequestUrl });
  return config;
};

exports.withSparkMetro = config => {
  if (!desktopSession()) return config;
  if (config && typeof config.then === 'function') return config.then(exports.withSparkMetro);
  if (!config || typeof config !== 'object') throw new Error('Spark needs an object or promise from metro.config');
  const upstream = defaults.get(path.resolve(config.projectRoot || process.cwd()));
  if (!upstream) throw new Error('Compose Metro with getDefaultConfig from @legendapp/spark/metro');
  const customResolve = config.resolver?.resolveRequest;
  if (customResolve && customResolve !== upstream.resolveRequest) {
    const desktopResolve = upstream.resolveRequest;
    config = { ...config, resolver: { ...config.resolver, resolveRequest(context, name, platform) {
      return customResolve({ ...context, resolveRequest(nextContext, nextName, nextPlatform) {
        return desktopResolve({ ...nextContext, resolveRequest: context.resolveRequest }, nextName, nextPlatform);
      } }, name, platform);
    } } };
  }
  const rewrite = config.server?.rewriteRequestUrl;
  const result = require('./metro.cjs').withDesktop(config, { runtimes: false });
  return { ...result, server: { ...result.server, rewriteRequestUrl(url) {
    // Existing desktop hosts request index. Expo resolves the application's
    // actual package.json main, including its default AppEntry, without a shim.
    const entry = url.replace(/\/index(?:\.windows)?\.bundle\?/, '/.expo/.virtual-metro-entry.bundle?');
    const rewritten = rewrite ? rewrite(entry) : entry;
    return upstream.rewriteRequestUrl ? upstream.rewriteRequestUrl(rewritten) : rewritten;
  } } };
};
