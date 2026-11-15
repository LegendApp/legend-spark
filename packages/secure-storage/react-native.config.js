// Expo Desktop currently invokes the Apple autolinker with --platform ios.
// Its generated Podfile identifies macOS explicitly; ordinary iOS apps use Expo backends.
module.exports = { dependency: { platforms: {
  ios: process.env.SPARK_DESKTOP_AUTOLINK === "macos" ? {} : null,
  android: null,
} } };

if (process.platform === "win32") {
  module.exports.dependencies = { ...module.exports.dependencies, "react-native-windows": {} };
}
