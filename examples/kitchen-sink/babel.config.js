module.exports = api => {
  api.cache(true);
  // Unistyles rewrites only its own demo folder; the rest of the app keeps plain React Native styles.
  return { presets: ["babel-preset-expo"], plugins: [["react-native-unistyles/plugin", { root: "screens/appearance-theming/unistyles" }]] };
};
