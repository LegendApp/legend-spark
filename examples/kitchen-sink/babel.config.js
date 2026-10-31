module.exports = api => {
  api.cache(true);
  // Each library's Babel plugin also rewrites code outside its demo (other libraries' worklets,
  // React Native imports), so each one only processes its own demo.
  return {
    presets: ["babel-preset-expo"],
    overrides: [
      { test: /screens\/appearance-theming\/unistyles\//, plugins: [["react-native-unistyles/plugin", { root: "screens/appearance-theming/unistyles" }]] },
      { test: /screens\/processes-ipc\/WorkletsCoreDemo\.tsx$/, plugins: ["react-native-worklets-core/plugin"] },
    ],
  };
};
