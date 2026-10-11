exports.withSparkNative = (original, root) => {
  if (!['macos', 'windows'].includes(process.env.SPARK_PLATFORM)) {
    const patched = require('@legendapp/spark-desktop-config/native-patches.cjs').prepareNativePatches(root);
    if (!Object.keys(patched).length) return original;
    return { ...original, dependencies: { ...patched, ...original.dependencies } };
  }
  const generated = require('./universal.cjs').nativeConfig(root);
  const dependencies = { ...original.dependencies };
  for (const [name, config] of Object.entries(generated.dependencies ?? {})) {
    dependencies[name] = { ...dependencies[name], ...config,
      platforms: { ...dependencies[name]?.platforms, ...config.platforms } };
  }
  return { ...original, platforms: { ...generated.platforms, ...original.platforms }, dependencies };
};
