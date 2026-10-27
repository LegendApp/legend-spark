module.exports = api => {
  api.cache(true);
  // Unistyles rewrites only its own demo folder; the rest of the app keeps plain React Native styles.
  // Worklets Core's plugin also rewrites other libraries' worklets (Skia's would read the optional
  // Reanimated at load), so it only processes the Worklets Core demo.
  return {
    presets: ["babel-preset-expo"],
    plugins: [["react-native-unistyles/plugin", { root: "screens/appearance-theming/unistyles" }]],
    overrides: [{ test: /screens\/processes-ipc\/WorkletsCoreDemo\.tsx$/, plugins: ["react-native-worklets-core/plugin"] }],
  };
};
