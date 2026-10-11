const fs = require('node:fs');
const path = require('node:path');

// Existing Expo projects keep their Expo configuration as the source of truth.
// Only an explicitly selected desktop command applies the Spark overlay.
function withSparkExpo(original, root) {
  return context => {
    require('./native-patches.cjs').prepareNativePatches(root);
    const base = typeof original === 'function' ? original(context) : original;
    const target = process.env.SPARK_PLATFORM;
    const development = process.env.SPARK_DEV_SESSION === '1';
    if (!development && target !== 'macos' && target !== 'windows') return base;
    const { extends: source, ...desktop } = JSON.parse(fs.readFileSync(path.join(root, 'desktop.config.json'), 'utf8'));
    if (source !== 'expo') throw new Error('Expected an Expo-owned desktop configuration');
    const { toExpo, applySelection, developmentConfig } = require('./config.cjs');
    const value = {
      ...desktop,
      name: base.name,
      version: base.version ?? '1.0.0',
      expo: { ...base, ...desktop.expo },
      macos: { ...base.macos, ...desktop.macos },
    };
    if (development) return developmentConfig(value, target);
    return applySelection(root, toExpo(value, target).expo);
  };
}
module.exports = { withSparkExpo };
