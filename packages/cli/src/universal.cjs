const fs = require("node:fs");
const { readConfig, statePath, supportedPlatforms } = require("@legendapp/spark-desktop-config/config.cjs");

exports.nativeConfig = root => {
  const patched = require("@legendapp/spark-desktop-config/native-patches.cjs").prepareNativePatches(root);
  const { expo } = readConfig(root);
  const platform = expo.platforms[0];
  const platforms = process.platform === "win32" ? {} : { windows: { npmPackageName: "react-native-windows" } };
  // Expo autolinking and React Native codegen have separate exclusion inputs.
  // An excluded desktop provider must not enter an iOS module registry either.
  const excluded = (expo.autolinking?.exclude ?? []).map(name => [name, { platforms: { ios: null, macos: null, android: null, windows: null } }]);
  if (!["macos", "windows"].includes(platform)) return { platforms, dependencies: { ...patched, ...Object.fromEntries(excluded) } };
  const file = statePath(root, "native-selection.json");
  const selection = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { included: [], excluded: [] };
  return { platforms, dependencies: Object.fromEntries([
    ...selection.included.map(p => [p.name, { root: p.root }]),
    ...selection.excluded.map(name => [name, { platforms: { ios: null, macos: null, android: null, windows: null } }]),
    ...excluded,
  ]) };
};

exports.metroConfig = root => {
  const platform = readConfig(root).expo.platforms[0];
  if ((process.env.SPARK_DEV_SESSION !== "1" || !supportedPlatforms(root).some(p => ["macos", "windows"].includes(p))) && ["ios", "android", "web"].includes(platform)) {
    return require(require.resolve("expo/metro-config", { paths: [root] })).getDefaultConfig(root);
  }
  const config = require(require.resolve("expo-desktop-metro-config", { paths: [root] })).makeMetroConfig(root);
  return require("./metro.cjs").withDesktop(config);
};
